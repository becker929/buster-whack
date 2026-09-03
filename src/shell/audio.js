/*!
 * Web Audio shell.
 *
 * Owns the AudioContext, the sfx bank and the music engine, and maps core
 * events to sound. The core never makes a noise; it emits `{ type: "hit", … }`
 * and this module decides what that sounds like.
 *
 * Everything is synthesized — no samples, no dependencies, so the game is
 * still one bundled JS file with nothing to fetch.
 *
 * Signal flow:
 *
 *     sfx voices ─────────────────► sfxBus ──┐
 *                                            ├─► master ─► limiter ─► out
 *     music voices ─► musicBus ─► duck ──────┘
 *
 * `master` is the mute switch — one gain, so muting is instant and also
 * silences notes already scheduled ahead of the clock. `duck` is the
 * sidechain: big sfx pull the music down for a moment so they cut through.
 *
 * Two things drive this module:
 *   - `handleAll(events)` — discrete core events become one-shot sounds.
 *   - `observe(view, charging, chargeFull)` — a per-frame read of the game's
 *     view model. Everything continuous (the music transport, the charge
 *     sweep, the low-time alarm) is derived from it declaratively, so no
 *     transition can be missed and nothing can be left stuck on.
 */

import { COLS } from "../core/constants.js";

// ---------- mix ----------

const MASTER_GAIN = 0.85;
const SFX_GAIN = 0.9;
const MUSIC_GAIN = 0.34;

// ---------- music transport ----------

const LOOKAHEAD = 0.14;   // seconds of music scheduled ahead of the audio clock
const PUMP_MS = 25;       // how often the scheduler wakes to top that back up
const STEPS = 16;         // sixteenths per bar
const BARS = 4;           // bars per chord cycle
// Four bars is a ringtone. The form is four chord cycles: A A' B A'', so the
// same material comes back changed rather than merely repeating, and the last
// bar of every cycle takes a fill. At 128bpm that is a 30s form -- long enough
// that a two-minute run never hears the same bar twice in a row.
const PHRASES = 4;
const FORM_BARS = BARS * PHRASES;
// Per phrase: does the lead sit an octave up, do the stabs double, is the bass
// pushed. Phrase 2 is the B section -- lead up, stabs on, a different arp.
const PH_LEAD_OCT = [0, 0, 12, 0];
const PH_STABS    = [false, true, true, true];
const PH_BSECTION = [false, false, true, false];

// ---------- misc ----------

// Mirrors the core's CHARGE_MS. Kept local rather than imported so the shell
// does not break if the core retunes it; the sweep resolves on `chargeReady`
// either way, so a mismatch only shifts where the ramp is when it lands.
const CHARGE_MS = 700;
const LOW_TIME = 6;       // matches the HUD's red timer
const A4 = 440;

/** MIDI note number -> Hz. */
const hz = (n) => A4 * Math.pow(2, (n - 69) / 12);

// Four-bar chord roots. The main loop is a driving i–VI–VII–v in A minor;
// overclock swaps it for a chromatic descent, which reads as "the floor is
// falling away" without having to be any louder.
const PROG_MAIN = [45, 41, 43, 40];   // A2 F2 G2 E2
const PROG_OC   = [45, 44, 43, 42];   // A2 G#2 G2 F#2

const ARP_MIN = [0, 3, 7, 12, 15, 12, 7, 3];   // minor triad, up and back
const ARP_DIM = [0, 3, 6, 9, 12, 9, 6, 3];     // diminished — overclock

// Step patterns, one char per sixteenth. The index is the intensity tier
// (0..2 track the level ramp, 3 is overclock).
// Even tier 0 is a groove, not a sprinkle of blips: a loop with holes in it
// reads as the game glitching rather than as music, so every tier keeps a
// continuous eighth-note floor and the tiers differ in weight and busyness.
const KICK  = ["x.......x.......", "x.......x...x...", "x..x....x...x..x", "x...x...x...x..."];
const SNARE = ["....x.......x...", "....x.......x...", "....x.......x...", "....x...x...x..x"];
const HAT   = ["..x...x...x...x.", "x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxxxx"];
const LEAD  = ["x...x...x...x...", "x.x.x.x.x.x.x.x.", "xxx.xx.xxx.xx.x.", "xxx.xx.xxx.xx.x."];
const STAB  = ["................", "..x.......x.....", "..x...x...x...x.", "..x...x...x...x."];
const BPM   = [128, 140, 150, 162];

const KICK_LOW_TIME = "x...x...x...x..."; // under six seconds: four on the floor

/**
 * @param {Window} win
 * @returns {object} the audio shell
 */
export function createAudio(win) {
  // ---------- lifecycle / graph ----------

  let ac = null;
  let master = null, sfxBus = null, musicBus = null, duck = null;
  let on = true;         // false while muted
  let dead = false;      // set by close(); every entry point no-ops afterwards

  /** Every source node currently alive, so teardown can silence all of them. */
  const live = new Set();

  const AC = win.AudioContext || win.webkitAudioContext;

  function build() {
    ac = new AC();

    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 3;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    master = ac.createGain();
    master.gain.value = on ? MASTER_GAIN : 0;
    sfxBus = ac.createGain();
    sfxBus.gain.value = SFX_GAIN;
    musicBus = ac.createGain();
    musicBus.gain.value = 0;          // faded up when the transport starts
    duck = ac.createGain();
    duck.gain.value = 1;

    musicBus.connect(duck);
    duck.connect(master);
    sfxBus.connect(master);
    master.connect(limiter);
    limiter.connect(ac.destination);
  }

  /** The context, created on first use. Null if Web Audio is unavailable. */
  function ctx() {
    if (dead) return null;
    if (!ac && AC) {
      try { build(); } catch (e) { ac = null; }
    }
    if (ac && ac.state === "suspended") { try { ac.resume(); } catch (e) {} }
    return ac;
  }

  /** True when it is worth building nodes at all. */
  function audible() {
    return !dead && on && !!ctx();
  }

  // ---------- node bookkeeping ----------

  /** Register a source so teardown can find it; it unregisters when it ends. */
  function track(node, stopAt) {
    live.add(node);
    node.onended = () => {
      live.delete(node);
      try { node.disconnect(); } catch (e) {}
    };
    if (stopAt !== undefined) { try { node.stop(stopAt); } catch (e) {} }
    return node;
  }

  function stopAll() {
    for (const n of Array.from(live)) {
      try { n.onended = null; } catch (e) {}
      try { n.stop(0); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
    }
    live.clear();
  }

  // ---------- primitives ----------

  // A deterministic round-robin rather than Math.random: rapid fire still gets
  // per-shot variation, but a recorded run is reproducible.
  let vi = 0;
  const vary = (spread) => { vi = (vi + 1) % 5; return (vi - 2) * spread; };

  const waves = new Map();
  /** A duty-cycle pulse wave — the sound a square oscillator cannot make. */
  function pulse(duty) {
    let w = waves.get(duty);
    if (!w) {
      const n = 24;
      const real = new Float32Array(n), imag = new Float32Array(n);
      for (let i = 1; i < n; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
      w = ac.createPeriodicWave(real, imag);
      waves.set(duty, w);
    }
    return w;
  }

  /** `pulse()` needs a context; fall back so the bank can be read without one. */
  function pulseSafe(duty) {
    return ac ? pulse(duty) : "square";
  }

  let whiteBuf = null, crushBuf = null;
  /** A second of noise, cached. `crushed` sample-and-holds it into 8-bit grit. */
  function noiseBuffer(crushed) {
    if (crushed && crushBuf) return crushBuf;
    if (!crushed && whiteBuf) return whiteBuf;
    const len = Math.max(1, Math.floor(ac.sampleRate));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    if (crushed) {
      // sample-and-hold at 1/12 rate, quantized to 16 levels: NES noise channel
      let held = 0;
      for (let i = 0; i < len; i++) {
        if (i % 12 === 0) held = Math.round((Math.random() * 2 - 1) * 8) / 8;
        d[i] = held;
      }
      crushBuf = buf;
    } else {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      whiteBuf = buf;
    }
    return buf;
  }

  function osc(type, freq, t) {
    const o = ac.createOscillator();
    if (typeof type === "string") o.type = type; else o.setPeriodicWave(type);
    o.frequency.setValueAtTime(freq, t);
    return o;
  }

  /**
   * The board is six columns wide and every gameplay event carries the column
   * it happened in, so position is free information: pan a voice to where the
   * thing actually is and you can hear which lane is aiming at you. Kept well
   * short of hard-panned so nothing disappears on one earbud or in mono.
   */
  const PAN_SPREAD = 0.62;
  function panOf(col) {
    if (col === undefined || col === null) return 0;
    return Math.max(-1, Math.min(1, ((col - (COLS - 1) / 2) / ((COLS - 1) / 2)) * PAN_SPREAD));
  }
  /** A panner, or null where the platform lacks StereoPannerNode. */
  function panner(pan, t) {
    if (!pan || !ac.createStereoPanner) return null;
    const n = ac.createStereoPanner();
    n.pan.setValueAtTime(pan, t);
    return n;
  }

  function gain(v, t) {
    const g = ac.createGain();
    g.gain.setValueAtTime(v, t);
    return g;
  }

  function filt(type, freq, q, t) {
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (q !== undefined) f.Q.setValueAtTime(q, t);
    return f;
  }

  function bufSrc(crushed, t) {
    const s = ac.createBufferSource();
    s.buffer = noiseBuffer(crushed);
    s.loop = true;
    s.playbackRate.setValueAtTime(1, t);
    return s;
  }

  /** Percussive envelope: silent -> peak over `a` -> exponential fall by `dur`. */
  function perc(param, t, peak, a, dur) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + dur);
    param.setValueAtTime(0, t + dur + 0.001);
  }

  /**
   * One tone: body oscillator, optional pitch glide, optional filter (with its
   * own sweep), percussive envelope. The workhorse for everything below.
   */
  function tone(o) {
    if (!audible()) return null;
    const dest = o.dest || sfxBus;
    const t = ac.currentTime + (o.delay || 0);
    const dur = o.dur || 0.1;
    const src = osc(o.wave || "square", o.freq, t);
    if (o.detune) src.detune.setValueAtTime(o.detune, t);
    if (o.to) src.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.glide || dur));
    const g = gain(0, t);
    perc(g.gain, t, o.gain === undefined ? 0.1 : o.gain, o.attack === undefined ? 0.004 : o.attack, dur);
    if (o.filter) {
      const f = filt(o.filter, o.cutoff, o.q, t);
      if (o.cutoffTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.cutoffTo), t + dur);
      src.connect(f); f.connect(g);
    } else {
      src.connect(g);
    }
    const pn = panner(o.pan, t);
    if (pn) { g.connect(pn); pn.connect(dest); } else { g.connect(dest); }
    src.start(t);
    track(src, t + dur + 0.03);
    return src;
  }

  /** One noise burst — the transient half of nearly every sound below. */
  function hiss(o) {
    if (!audible()) return null;
    const dest = o.dest || sfxBus;
    const t = ac.currentTime + (o.delay || 0);
    const dur = o.dur || 0.06;
    const s = bufSrc(!!o.crushed, t);
    const f = filt(o.filter || "highpass", o.cutoff || 2000, o.q, t);
    if (o.cutoffTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.cutoffTo), t + dur);
    const g = gain(0, t);
    perc(g.gain, t, o.gain === undefined ? 0.1 : o.gain, o.attack === undefined ? 0.002 : o.attack, dur);
    s.connect(f); f.connect(g);
    const pn = panner(o.pan, t);
    if (pn) { g.connect(pn); pn.connect(dest); } else { g.connect(dest); }
    // a rolling offset so consecutive bursts are not literally the same noise
    s.start(t, 0.5 + vary(0.07));
    track(s, t + dur + 0.02);
    return s;
  }

  /** A run of notes: fanfares, arpeggios, jingles. */
  function seq(notes, o) {
    o = o || {};
    const step = o.step || 0.06;
    const dur = o.dur || 0.09;
    const g = o.gain === undefined ? 0.14 : o.gain;
    for (let i = 0; i < notes.length; i++) {
      tone({
        wave: o.wave || pulseSafe(0.25), freq: hz(notes[i]), dur, gain: g,
        delay: (o.delay || 0) + i * step, dest: o.dest,
        filter: "lowpass", cutoff: 6000, q: 0.7,
      });
      if (o.octave) {
        tone({
          wave: "triangle", freq: hz(notes[i] + 12), dur: dur * 0.8, gain: g * 0.45,
          delay: (o.delay || 0) + i * step, dest: o.dest,
        });
      }
    }
  }

  /**
   * A detonation: broadband transient, a crushed body swept down through a
   * resonant lowpass, and a sub that drops a fifth as it decays. `size` scales
   * duration, level and how far the sweep travels, so a mett pop and a rare
   * jackpot are the same gesture at different magnitudes rather than two
   * unrelated noises. The crushed noise buffer (sample-and-hold, 1/12 rate,
   * 16 levels) is what makes it read as *bit* crush and not just noise.
   */
  function blast(size, pan, delay) {
    const d = delay || 0;
    // Duration scales hard with size: at wave density you hear a lot of small
    // deletes, and a long tail on each would smear into mush. A mett pop is
    // deliberately kept under the ~0.3s the sfx suite pins.
    const dur = 0.1 + 0.34 * size;
    // transient: the click that makes it sound like it happened *now*
    hiss({
      dur: 0.02 + 0.02 * size, filter: "highpass", cutoff: 1800, q: 0.6,
      gain: 0.1 + 0.13 * size, delay: d, pan,
    });
    // crushed body, sweeping down: the bit-crush character lives here
    hiss({
      dur, filter: "lowpass", cutoff: 4200 + 3000 * size, cutoffTo: 180,
      q: 3 + 7 * size, gain: 0.1 + 0.16 * size, delay: d + 0.006,
      crushed: true, pan,
    });
    // a second, drier crushed layer an instant later: debris
    hiss({
      dur: dur * 0.7, filter: "bandpass", cutoff: 1400, cutoffTo: 300, q: 2,
      gain: 0.05 + 0.08 * size, delay: d + 0.03 + 0.03 * size, crushed: true, pan,
    });
    // sub: the weight. Drops a fifth, which reads as collapse rather than pitch.
    tone({
      wave: "sine", freq: 120 - 40 * size, to: (120 - 40 * size) * 0.66,
      glide: dur, dur: dur + 0.09 * size, gain: 0.16 + 0.16 * size,
      attack: 0.006, delay: d, pan,
    });
  }

  // ---------- sidechain ----------

  /** Pull the music down by `depth` (0..1) for `hold` seconds, then let it back. */
  function duckMusic(depth, hold) {
    if (dead || !ac || !duck) return;
    const t = ac.currentTime;
    const g = duck.gain;
    try { g.cancelScheduledValues(t); } catch (e) {}
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(Math.max(0.05, 1 - depth), t + 0.012);
    g.linearRampToValueAtTime(1, t + 0.012 + hold);
  }

  // ================================================================
  // SFX BANK
  // ================================================================

  // The chain ladder: a minor-pentatonic climb, so every delete in a streak is
  // one step further up the scale. Past the top it stops climbing and gains a
  // shimmer octave instead — a maxed chain should sound maxed, not ultrasonic.
  const CHAIN_LADDER = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];

  const sfx = {
    /** The buster. Fired constantly, so: short, bright and never fatiguing. */
    shoot() {
      const d = vary(14);
      hiss({ dur: 0.035, cutoff: 5200, cutoffTo: 2600, q: 1, gain: 0.075 });
      tone({
        wave: pulseSafe(0.25), freq: 1180 + d, to: 420, glide: 0.05,
        dur: 0.07, gain: 0.11, filter: "lowpass", cutoff: 7000, q: 1,
      });
      tone({ wave: "triangle", freq: 300 + d, to: 150, dur: 0.06, gain: 0.05 });
    },

    /** The payoff of a held button: a detuned saw cannon, a sub and a whoosh. */
    charged() {
      duckMusic(0.35, 0.28);
      hiss({ dur: 0.28, filter: "bandpass", cutoff: 900, cutoffTo: 5200, q: 1.2, gain: 0.1 });
      for (const dt of [-9, 0, 9]) {
        tone({
          wave: "sawtooth", freq: 300, to: 96, glide: 0.22, detune: dt,
          dur: 0.3, gain: 0.1, attack: 0.006,
          filter: "lowpass", cutoff: 4200, cutoffTo: 420, q: 6,
        });
      }
      tone({ wave: "sine", freq: 150, to: 44, glide: 0.24, dur: 0.34, gain: 0.22, attack: 0.008 });
      tone({ wave: pulseSafe(0.5), freq: 1400, to: 500, dur: 0.09, gain: 0.06 });
    },

    /**
     * A deletion. The pitch climbs with the chain, which is the whole game
     * loop. Body + transient + tail, heavier for a charged kill.
     */
    hit(chain, heavy, pan) {
      const i = Math.min(Math.max(chain, 1) - 1, CHAIN_LADDER.length - 1);
      const n = CHAIN_LADDER[i];
      const maxed = chain - 1 >= CHAIN_LADDER.length;
      duckMusic(heavy ? 0.42 : 0.26, heavy ? 0.24 : 0.15);

      // the detonation sits under the ladder note, never over it: the pitched
      // body stays the loudest thing so a streak still reads as a melody
      blast(heavy ? 0.62 : 0.3, pan);
      hiss({ dur: 0.05, cutoff: 3400, cutoffTo: 1200, q: 1, gain: heavy ? 0.14 : 0.09, pan });
      tone({
        wave: pulseSafe(0.35), freq: hz(n), to: hz(n) * 0.55, glide: 0.1,
        dur: heavy ? 0.18 : 0.13, gain: heavy ? 0.17 : 0.13, pan,
        filter: "lowpass", cutoff: 9000, cutoffTo: 2200, q: 1,
      });
      tone({
        wave: pulseSafe(0.35), freq: hz(n) * 1.005, to: hz(n) * 0.55, glide: 0.1,
        dur: heavy ? 0.18 : 0.13, gain: heavy ? 0.1 : 0.07, delay: 0.006,
      });
      tone({
        wave: "triangle", freq: heavy ? 190 : 260, to: heavy ? 52 : 90,
        dur: heavy ? 0.22 : 0.14, gain: heavy ? 0.2 : 0.11,
      });
      if (heavy) {
        // a charged kill gets a second body and a tail of its own, so it is
        // bigger in kind and not just in level
        tone({
          wave: "sawtooth", freq: hz(n - 12), to: hz(n - 12) * 0.5, glide: 0.2,
          dur: 0.26, gain: 0.08, filter: "lowpass", cutoff: 3200, cutoffTo: 400, q: 5,
        });
        tone({ wave: "sine", freq: 70, to: 40, dur: 0.3, gain: 0.16, attack: 0.008 });
        hiss({
          dur: 0.22, filter: "lowpass", cutoff: 2400, cutoffTo: 300, q: 2,
          gain: 0.07, delay: 0.02, crushed: true,
        });
      }
      if (maxed) {
        tone({ wave: "sine", freq: hz(n + 12), dur: 0.24, gain: 0.06, delay: 0.02 });
        tone({ wave: "sine", freq: hz(n + 19), dur: 0.2, gain: 0.04, delay: 0.05 });
      }
    },

    /** Steel guard cracked open: inharmonic ring, crunch, and a sub drop. */
    guardBreak(pan) {
      duckMusic(0.5, 0.36);
      blast(0.8, pan);
      hiss({ dur: 0.09, filter: "highpass", cutoff: 2600, q: 0.8, gain: 0.16, crushed: true });
      // non-integer ratios: metal, not a note
      for (const [f, g, d] of [[1830, 0.09, 0.34], [2710, 0.07, 0.28], [4390, 0.05, 0.2]]) {
        tone({ wave: "sine", freq: f, dur: d, gain: g, filter: "bandpass", cutoff: f, q: 14 });
      }
      tone({
        wave: "sawtooth", freq: 220, to: 55, glide: 0.26, dur: 0.34, gain: 0.16,
        filter: "lowpass", cutoff: 2600, cutoffTo: 260, q: 8,
      });
      tone({ wave: "sine", freq: 110, to: 38, dur: 0.4, gain: 0.24, attack: 0.01 });
      hiss({
        dur: 0.3, filter: "lowpass", cutoff: 1400, cutoffTo: 200, q: 3,
        gain: 0.1, delay: 0.02, crushed: true,
      });
    },

    /** Jackpot: a rising run, a bright held chord, sparkle. Unmistakable. */
    rareGet(pan) {
      duckMusic(0.62, 0.9);
      blast(1, pan);
      seq([69, 76, 81, 88, 93, 100], { step: 0.055, dur: 0.075, gain: 0.13, octave: true });
      for (const n of [81, 85, 88, 93]) {
        tone({
          wave: pulseSafe(0.5), freq: hz(n), dur: 0.55, gain: 0.075, delay: 0.33, attack: 0.01,
          filter: "lowpass", cutoff: 8000, q: 0.7,
        });
        tone({ wave: "sawtooth", freq: hz(n), detune: 8, dur: 0.5, gain: 0.03, delay: 0.33, attack: 0.02 });
      }
      tone({ wave: "sine", freq: hz(45), dur: 0.5, gain: 0.2, delay: 0.33, attack: 0.01 });
      hiss({
        dur: 0.5, filter: "highpass", cutoff: 5000, cutoffTo: 11000, q: 0.7,
        gain: 0.05, delay: 0.33,
      });
    },

    /** A rare has surfaced and you have 650ms. An alert, not a decoration. */
    rareSpawn() {
      seq([88, 95, 100], { step: 0.055, dur: 0.06, gain: 0.11, octave: true });
      tone({ wave: "sine", freq: hz(100), dur: 0.3, gain: 0.045, delay: 0.11 });
    },

    /** A prog is surfacing: a soft, friendly two-note "hold fire". */
    progWarn() {
      tone({ wave: "sine", freq: hz(74), dur: 0.11, gain: 0.05 });
      tone({ wave: "sine", freq: hz(69), dur: 0.16, gain: 0.05, delay: 0.09 });
    },

    /** Wrong tool: a normal shot off steel. Hard, metallic, short. */
    plink() {
      hiss({ dur: 0.045, filter: "bandpass", cutoff: 5200, q: 5, gain: 0.13 });
      tone({
        wave: "square", freq: 2400, to: 1900, dur: 0.05, gain: 0.06,
        filter: "bandpass", cutoff: 3000, q: 9,
      });
      tone({ wave: "sine", freq: 6100, dur: 0.09, gain: 0.03, filter: "bandpass", cutoff: 6100, q: 18 });
    },

    /** A hopper took a tap and bolted. Rubbery — "one more". */
    stagger() {
      tone({ wave: "triangle", freq: 420, to: 900, glide: 0.05, dur: 0.09, gain: 0.11 });
      tone({ wave: pulseSafe(0.15), freq: 900, to: 300, glide: 0.08, dur: 0.1, gain: 0.06, delay: 0.05 });
      hiss({ dur: 0.03, cutoff: 4000, gain: 0.05 });
    },

    /** Hopper movement. Deliberately tiny: texture, not an event. */
    hop() {
      tone({ wave: "triangle", freq: 300, to: 460, glide: 0.035, dur: 0.045, gain: 0.045 });
    },

    /** Charge complete. Bright, and it hands over to the idle hum. */
    ready() {
      tone({ wave: pulseSafe(0.25), freq: hz(81), dur: 0.07, gain: 0.11 });
      tone({ wave: pulseSafe(0.25), freq: hz(88), dur: 0.14, gain: 0.11, delay: 0.055 });
      tone({ wave: "sine", freq: hz(93), dur: 0.2, gain: 0.05, delay: 0.055 });
      hiss({ dur: 0.14, filter: "highpass", cutoff: 6000, cutoffTo: 12000, q: 0.7, gain: 0.045 });
    },

    /** ×2 / ×3 / ×4. A real fanfare, and it grows with the multiplier. */
    rankup(mult) {
      duckMusic(0.4, 0.5);
      if (mult >= 4) {
        seq([69, 73, 76, 81, 85, 88, 93], { step: 0.05, dur: 0.07, gain: 0.13, octave: true });
        for (const n of [81, 85, 88]) {
          tone({ wave: "sawtooth", freq: hz(n), detune: 7, dur: 0.6, gain: 0.045, delay: 0.35, attack: 0.02 });
          tone({ wave: "sawtooth", freq: hz(n), detune: -7, dur: 0.6, gain: 0.045, delay: 0.35, attack: 0.02 });
        }
        tone({ wave: "sine", freq: hz(45), dur: 0.6, gain: 0.18, delay: 0.35, attack: 0.01 });
        hiss({
          dur: 0.45, filter: "highpass", cutoff: 4000, cutoffTo: 12000, q: 0.7,
          gain: 0.05, delay: 0.32,
        });
      } else if (mult === 3) {
        seq([72, 76, 79, 84], { step: 0.055, dur: 0.08, gain: 0.13, octave: true });
        tone({ wave: "sine", freq: hz(48), dur: 0.35, gain: 0.15, delay: 0.16, attack: 0.008 });
        hiss({
          dur: 0.3, filter: "highpass", cutoff: 5000, cutoffTo: 10000, q: 0.7,
          gain: 0.04, delay: 0.16,
        });
      } else {
        seq([72, 76, 79], { step: 0.06, dur: 0.09, gain: 0.12 });
        tone({ wave: "sine", freq: hz(48), dur: 0.3, gain: 0.13, delay: 0.12, attack: 0.008 });
      }
    },

    /**
     * A chain worth having, gone. A deflating minor fall.
     *
     * `after` pushes it behind the impact that caused it: the core emits
     * `chainBroken` *before* `playerHit` / `progHit`, and the loss should land
     * as the consequence of the hit, not underneath it.
     */
    chainLost(chain, after) {
      const big = chain >= 10;
      const d = after || 0;
      duckMusic(0.2, 0.3 + d);
      seq([69, 66, 62], { step: 0.075, dur: 0.11, gain: big ? 0.1 : 0.075, wave: "triangle", delay: d });
      tone({
        wave: "sawtooth", freq: 190, to: 60, glide: 0.34, dur: 0.4, gain: big ? 0.09 : 0.06,
        filter: "lowpass", cutoff: 1600, cutoffTo: 260, q: 3, delay: d + 0.05,
      });
    },

    /** Every second under six. Two beeps; tighter and higher when it is dire. */
    alarm(dire) {
      const f = dire ? hz(81) : hz(76);
      const gap = dire ? 0.11 : 0.16;
      for (let i = 0; i < 2; i++) {
        tone({
          wave: "sawtooth", freq: f, dur: 0.09, gain: dire ? 0.09 : 0.065, delay: i * gap,
          filter: "bandpass", cutoff: f * 2, q: 3,
        });
        tone({ wave: "square", freq: f / 2, dur: 0.09, gain: dire ? 0.05 : 0.035, delay: i * gap });
      }
    },

    /** You shot a friendly. The anti-spam tax should sound like a mistake. */
    allyHit() {
      duckMusic(0.6, 0.5);
      // a beating minor second, then a siren down
      tone({
        wave: "sawtooth", freq: 116, dur: 0.42, gain: 0.13, attack: 0.006,
        filter: "lowpass", cutoff: 2000, cutoffTo: 400, q: 4,
      });
      tone({ wave: "sawtooth", freq: 123, dur: 0.42, gain: 0.13, attack: 0.006 });
      tone({ wave: "square", freq: 520, to: 180, glide: 0.34, dur: 0.4, gain: 0.08 });
      hiss({
        dur: 0.35, filter: "lowpass", cutoff: 2600, cutoffTo: 300, q: 2,
        gain: 0.1, crushed: true,
      });
    },

    /** A prog reached cover untouched. Small, warm, and worth +0.5s. */
    spared() {
      tone({ wave: "triangle", freq: hz(76), dur: 0.1, gain: 0.055 });
      tone({ wave: "triangle", freq: hz(83), dur: 0.16, gain: 0.055, delay: 0.075 });
    },

    /** Taking a bolt. Meant to be genuinely unpleasant. */
    hurt(pan) {
      // the deepest duck in the game, held longest: for a moment the music
      // simply gets out of the way, which is most of why this reads as bad
      duckMusic(0.94, 0.6);
      // a detonation centred on the player, so a hit is physically the biggest
      // event on the board -- larger than any kill
      blast(0.85, pan);
      // an inverted transient: near-silence for 25ms, then everything at once.
      // The hole is what makes the impact land.
      hiss({
        dur: 0.34, filter: "lowpass", cutoff: 4200, cutoffTo: 180, q: 12,
        gain: 0.3, crushed: true, delay: 0.025, pan,
      });
      hiss({
        dur: 0.06, filter: "highpass", cutoff: 900, q: 0.7, gain: 0.26, pan,
      });
      // a tritone sliding down: the least resolved interval there is
      tone({
        wave: "sawtooth", freq: 196, to: 62, glide: 0.34, dur: 0.42, gain: 0.14, attack: 0.002,
        filter: "lowpass", cutoff: 2600, cutoffTo: 240, q: 6,
      });
      tone({ wave: "sawtooth", freq: 277, to: 88, glide: 0.34, dur: 0.42, gain: 0.11, attack: 0.002 });
      tone({ wave: "square", freq: 58, dur: 0.6, gain: 0.2, attack: 0.004, pan });
      // a siren tail wobbling down well after the impact: the recovery, so the
      // i-frames have a sound and you know you are still reeling
      tone({
        wave: "sawtooth", freq: 150, to: 66, glide: 0.5, dur: 0.62, gain: 0.07,
        attack: 0.05, delay: 0.12, filter: "bandpass", cutoff: 520, q: 7, pan,
      });
      tone({
        wave: pulseSafe(0.1), freq: 330, to: 150, glide: 0.2, dur: 0.22, gain: 0.07,
        filter: "bandpass", cutoff: 800, q: 4, delay: 0.02,
      });
    },

    /** A virus has marked your row. Pure gameplay information — it must read. */
    aim(pan) {
      // panned hardest of anything in the game: which lane is aiming at you is
      // the single most useful thing position can tell you
      tone({
        wave: "sawtooth", freq: 210, to: 430, glide: 0.16, dur: 0.18, gain: 0.055,
        filter: "bandpass", cutoff: 900, cutoffTo: 1900, q: 5, pan,
      });
      tone({ wave: "square", freq: 1500, dur: 0.035, gain: 0.035, pan });
      tone({ wave: "square", freq: 1500, dur: 0.035, gain: 0.035, delay: 0.1, pan });
    },

    /** Bolt away. Heavy (a guard's) is lower, so you can hear which is coming. */
    bolt(heavy, pan) {
      hiss({
        dur: heavy ? 0.09 : 0.05, filter: "bandpass",
        cutoff: heavy ? 900 : 2200, cutoffTo: heavy ? 300 : 900, q: 2,
        gain: heavy ? 0.11 : 0.07, pan,
      });
      tone({
        wave: heavy ? "sawtooth" : "square",
        freq: heavy ? 300 : 520, to: heavy ? 90 : 190, glide: 0.1,
        dur: heavy ? 0.16 : 0.1, gain: heavy ? 0.1 : 0.065, pan,
        filter: "lowpass", cutoff: heavy ? 2200 : 5000, q: 2,
      });
      if (heavy) tone({ wave: "sine", freq: 110, to: 50, dur: 0.2, gain: 0.1, pan });
    },

    /**
     * A wave wiped out. Short and bright — it lands in the lull that follows,
     * so it has room, but it must not compete with the next wave arriving.
     * Scaled by how big the wave was.
     */
    waveClear(n) {
      const size = Math.min(1, (n || 1) / 5);
      duckMusic(0.3, 0.3);
      seq([76, 81, 88], { step: 0.05, dur: 0.07, gain: 0.09 + 0.04 * size, octave: size > 0.6 });
      tone({ wave: "sine", freq: hz(57), dur: 0.3, gain: 0.1, attack: 0.006 });
    },

    /**
     * The interlevel card used to be about 1.4s of dead air after the sting's
     * tail. A quiet held pad under it: the run has not ended, it is holding.
     */
    cardPad() {
      for (const n of [45, 57, 64]) {
        tone({
          wave: "sawtooth", freq: hz(n), detune: n === 57 ? 7 : -5,
          dur: 2.6, gain: 0.035, attack: 0.35, delay: 0.5,
          filter: "lowpass", cutoff: 1400, q: 0.8,
        });
      }
    },

    /** Credit accepted. Also the proof that audio unlocked on the gesture. */
    boot() {
      seq([57, 64, 69], { step: 0.07, dur: 0.06, gain: 0.11 });
      tone({ wave: pulseSafe(0.5), freq: hz(81), dur: 0.22, gain: 0.11, delay: 0.21 });
      tone({ wave: "sine", freq: hz(45), dur: 0.3, gain: 0.16, delay: 0.21, attack: 0.006 });
      hiss({ dur: 0.24, filter: "highpass", cutoff: 400, cutoffTo: 9000, q: 1, gain: 0.06 });
    },

    /** A stage gate. Its own motif — this is not another multiplier. */
    stageSting() {
      seq([64, 69, 71, 76], { step: 0.1, dur: 0.11, gain: 0.13, octave: true });
      for (const n of [64, 71, 76]) {
        tone({ wave: "sawtooth", freq: hz(n), detune: 6, dur: 0.7, gain: 0.045, delay: 0.3, attack: 0.03 });
        tone({ wave: "sawtooth", freq: hz(n), detune: -6, dur: 0.7, gain: 0.045, delay: 0.3, attack: 0.03 });
      }
      tone({ wave: "sine", freq: hz(40), dur: 0.7, gain: 0.2, delay: 0.3, attack: 0.01 });
      hiss({
        dur: 0.4, filter: "highpass", cutoff: 3000, cutoffTo: 11000, q: 0.7,
        gain: 0.05, delay: 0.28,
      });
    },

    /** Run over: a minor cadence into a power-down. */
    over() {
      seq([69, 65, 62, 57], { step: 0.16, dur: 0.2, gain: 0.11, wave: "square" });
      tone({
        wave: "sawtooth", freq: 400, to: 34, glide: 1.1, dur: 1.25, gain: 0.11, delay: 0.62,
        attack: 0.02, filter: "lowpass", cutoff: 3000, cutoffTo: 140, q: 4,
      });
      tone({ wave: "square", freq: 200, to: 24, glide: 1.1, dur: 1.2, gain: 0.06, delay: 0.62, attack: 0.02 });
    },

    /** UI: the run stopped, or started again. Confirmation, nothing more. */
    pauseBlip(down) {
      seq(down ? [76, 69] : [69, 76], { step: 0.07, dur: 0.07, gain: 0.07, wave: "triangle" });
    },

    /** A step across the grid. Below the buster in level; reads as a footfall. */
    step() {
      hiss({ dur: 0.022, filter: "bandpass", cutoff: 2600, q: 1.5, gain: 0.035 });
      tone({ wave: "triangle", freq: 180, to: 120, dur: 0.03, gain: 0.03 });
    },
  };

  // ---------- the charge sweep ----------
  // A held mechanic deserves a held sound: a filtered saw pair climbs for
  // CHARGE_MS under an accelerating tremolo, resolves into `ready()`, then
  // idles as a quiet "brimming" hum until the button comes up. Every node
  // is in `live`, so mute, pause and destroy all kill it.

  let chargeVoices = null;

  function chargeStart() {
    chargeStop(0);
    if (!audible()) return;
    const t = ac.currentTime;
    const secs = CHARGE_MS / 1000;

    const out = gain(0, t);
    out.gain.linearRampToValueAtTime(0.075, t + secs * 0.75);
    out.connect(sfxBus);

    const f = filt("lowpass", 300, 7, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + secs);
    f.connect(out);

    const oscs = [];
    for (const dt of [-6, 6]) {
      const o = osc("sawtooth", 150, t);
      o.detune.setValueAtTime(dt, t);
      o.frequency.exponentialRampToValueAtTime(560, t + secs);
      o.connect(f);
      o.start(t);
      track(o);
      oscs.push(o);
    }
    // a tremolo that speeds up as the meter fills: the "almost there" tell
    const lfo = osc("sine", 6, t);
    lfo.frequency.exponentialRampToValueAtTime(22, t + secs);
    const lfoAmt = gain(0.035, t);
    lfo.connect(lfoAmt); lfoAmt.connect(out.gain);
    lfo.start(t);
    track(lfo);

    chargeVoices = { out, oscs, lfo };
  }

  /** Wind the sweep down over `fade` seconds and forget it. */
  function chargeStop(fade) {
    const cv = chargeVoices;
    chargeVoices = null;
    if (!cv || !ac) return;
    const t = ac.currentTime;
    const f = fade === undefined ? 0.06 : fade;
    try {
      cv.out.gain.cancelScheduledValues(t);
      cv.out.gain.setValueAtTime(cv.out.gain.value, t);
      cv.out.gain.linearRampToValueAtTime(0, t + f);
    } catch (e) {}
    for (const o of cv.oscs.concat([cv.lfo])) {
      try { o.stop(t + f + 0.02); } catch (e) {}
    }
  }

  /** The meter filled: cut the sweep into the chime, then idle on the hum. */
  function chargeFullNow() {
    const cv = chargeVoices;
    if (!cv || !ac) { sfx.ready(); return; }
    const t = ac.currentTime;
    try {
      cv.out.gain.cancelScheduledValues(t);
      cv.out.gain.setValueAtTime(cv.out.gain.value, t);
      cv.out.gain.linearRampToValueAtTime(0, t + 0.05);
      cv.out.gain.linearRampToValueAtTime(0.03, t + 0.22);
    } catch (e) {}
    for (const o of cv.oscs) {
      try {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(o.frequency.value, t);
        o.frequency.linearRampToValueAtTime(660, t + 0.12);
      } catch (e) {}
    }
    try {
      cv.lfo.frequency.cancelScheduledValues(t);
      cv.lfo.frequency.setValueAtTime(cv.lfo.frequency.value, t);
      cv.lfo.frequency.linearRampToValueAtTime(13, t + 0.12);
    } catch (e) {}
    sfx.ready();
  }

  // ================================================================
  // MUSIC
  // ================================================================

  const music = {
    running: false,     // the transport is advancing
    playing: false,     // …and audible (not paused, not behind a card)
    step: 0,            // global sixteenth index
    nextAt: 0,          // ac.currentTime at which the next step sounds
    tier: 0,
    lowTime: false,
    startAfter: 0,      // hold the downbeat until here, so a jingle lands first
    timer: null,
  };

  function stepDur() {
    const bpm = BPM[music.tier] + (music.lowTime ? 10 : 0);
    return 60 / bpm / 4;
  }

  function bass(t, root, dur) {
    const g = gain(0, t);
    perc(g.gain, t, 0.5, 0.005, dur);
    const f = filt("lowpass", music.tier >= 2 ? 1400 : 900, 4, t);
    f.frequency.exponentialRampToValueAtTime(300, t + dur);
    f.connect(g); g.connect(musicBus);
    for (const dt of [-8, 8]) {
      const o = osc("sawtooth", hz(root), t);
      o.detune.setValueAtTime(dt, t);
      o.connect(f); o.start(t);
      track(o, t + dur + 0.02);
    }
    const sub = osc("triangle", hz(root - 12), t);
    const sg = gain(0, t);
    perc(sg.gain, t, 0.42, 0.005, dur);
    sub.connect(sg); sg.connect(musicBus); sub.start(t);
    track(sub, t + dur + 0.02);
  }

  function lead(t, note, dur, oc) {
    const o = osc(pulse(oc ? 0.125 : 0.25), hz(note), t);
    const g = gain(0, t);
    perc(g.gain, t, 0.2, 0.004, dur);
    const f = filt("lowpass", 5200, 1, t);
    o.connect(f); f.connect(g); g.connect(musicBus);
    o.start(t);
    track(o, t + dur + 0.02);
    if (oc) {
      // overclock doubles the lead an octave up and a little sharp: unstable
      const o2 = osc(pulse(0.5), hz(note + 12), t);
      o2.detune.setValueAtTime(14, t);
      const g2 = gain(0, t);
      perc(g2.gain, t, 0.09, 0.004, dur * 0.8);
      o2.connect(g2); g2.connect(musicBus);
      o2.start(t);
      track(o2, t + dur + 0.02);
    }
  }

  function stab(t, root, oc) {
    for (const iv of oc ? [0, 3, 6] : [0, 3, 7]) {
      const o = osc(pulse(0.5), hz(root + 24 + iv), t);
      const g = gain(0, t);
      perc(g.gain, t, 0.075, 0.003, 0.075);
      o.connect(g); g.connect(musicBus);
      o.start(t);
      track(o, t + 0.1);
    }
  }

  function kick(t) {
    const o = osc("sine", 160, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.085);
    const g = gain(0, t);
    perc(g.gain, t, 0.85, 0.002, 0.19);
    o.connect(g); g.connect(musicBus);
    o.start(t);
    track(o, t + 0.22);
    const n = bufSrc(true, t);
    const f = filt("highpass", 1600, 1, t);
    const ng = gain(0, t);
    perc(ng.gain, t, 0.16, 0.001, 0.02);
    n.connect(f); f.connect(ng); ng.connect(musicBus);
    n.start(t, 0.3);
    track(n, t + 0.04);
  }

  function snare(t) {
    const n = bufSrc(false, t);
    const f = filt("bandpass", 1900, 0.9, t);
    const g = gain(0, t);
    perc(g.gain, t, 0.34, 0.002, 0.14);
    n.connect(f); f.connect(g); g.connect(musicBus);
    n.start(t, 0.5 + vary(0.09));
    track(n, t + 0.16);
    const o = osc("triangle", 210, t);
    const og = gain(0, t);
    perc(og.gain, t, 0.18, 0.002, 0.09);
    o.connect(og); og.connect(musicBus);
    o.start(t);
    track(o, t + 0.11);
  }

  function hat(t, open) {
    const n = bufSrc(true, t);
    const f = filt("highpass", 7200, 0.8, t);
    const g = gain(0, t);
    perc(g.gain, t, open ? 0.11 : 0.07, 0.001, open ? 0.09 : 0.028);
    n.connect(f); f.connect(g); g.connect(musicBus);
    n.start(t, 0.5 + vary(0.11));
    track(n, t + (open ? 0.11 : 0.04));
  }

  /** Everything that happens on one sixteenth. */
  function scheduleStep(i, t) {
    const tier = music.tier;
    const oc = tier === 3;
    const s = i % STEPS;
    const absBar = Math.floor(i / STEPS) % FORM_BARS;
    const bar = absBar % BARS;
    const phrase = Math.floor(absBar / BARS);
    const bSection = PH_BSECTION[phrase];
    // the B section leans on the relative major, so it lifts without modulating
    const root = (oc ? PROG_OC : PROG_MAIN)[bar] + (bSection && !oc ? 3 : 0);
    const arp = oc || bSection ? ARP_DIM : ARP_MIN;
    const sd = stepDur();
    // last bar of a phrase, second half: the fill
    const fill = bar === BARS - 1 && s >= 8;

    if ((music.lowTime ? KICK_LOW_TIME : KICK[tier])[s] === "x") kick(t);
    if (SNARE[tier][s] === "x" || (fill && tier >= 1 && s % 2 === 0)) snare(t);
    if (HAT[tier][s] === "x" || (fill && s % 2 === 1)) hat(t, s % 8 === 6 || (fill && s === 15));

    // bass: a continuous eighth-note floor, with sixteenth pickups from tier 2
    if (s % 2 === 0 || (tier >= 2 && s % 4 === 3)) {
      bass(t, root + (s % 8 === 6 ? 12 : 0), sd * (tier >= 2 ? 1.5 : 2.4));
    }

    // lead: silent when the clock is nearly out — the alarm owns that space
    if (!music.lowTime && LEAD[tier][s] === "x") {
      lead(t, root + 24 + PH_LEAD_OCT[phrase] + arp[(i + bar + phrase) % arp.length],
           sd * 1.6, oc);
    }

    if (STAB[tier][s] === "x" || (PH_STABS[phrase] && tier >= 1 && s === 10)) {
      stab(t, root, oc);
    }
  }

  /**
   * Top the schedule back up to LOOKAHEAD. Idempotent and cheap, so it is safe
   * to call from both the timer and the frame loop — which is the point: the
   * timer keeps time when rAF is throttled, rAF fills in when the timer is
   * late, and the notes themselves are placed on the audio clock either way.
   */
  function pump() {
    if (dead || !music.running || !ac) return;
    const horizon = ac.currentTime + LOOKAHEAD;
    let guard = 256;   // never let a stalled clock spin this loop forever
    while (music.nextAt < horizon && guard-- > 0) {
      // Muted or carded: advance the transport but build nothing. The position
      // is kept, so unmuting drops back into the groove mid-phrase.
      if (on && music.playing && music.nextAt >= music.startAfter) {
        scheduleStep(music.step, music.nextAt);
      }
      music.step = (music.step + 1) % (STEPS * FORM_BARS);
      music.nextAt += stepDur();
    }
    schedulePump();
  }

  function schedulePump() {
    clearPump();
    if (!music.running || dead) return;
    music.timer = (win.setTimeout || setTimeout).call(win, pump, PUMP_MS);
  }

  function clearPump() {
    if (music.timer !== null) {
      (win.clearTimeout || clearTimeout).call(win, music.timer);
      music.timer = null;
    }
  }

  function musicStart(delaySec) {
    if (!ctx()) return;
    const d = delaySec || 0;
    music.step = 0;
    music.running = true;
    music.playing = true;
    music.nextAt = ac.currentTime + 0.06 + d;
    music.startAfter = ac.currentTime + d;
    rampMusic(MUSIC_GAIN, 0.12 + d);
    pump();
  }

  /** Silence the music but keep the position, so resuming continues the phrase. */
  function musicHold() {
    if (!music.running) return;
    music.playing = false;
    rampMusic(0, 0.07);
  }

  function musicResume() {
    if (!ctx() || !music.running) return;
    music.playing = true;
    music.nextAt = ac.currentTime + 0.06;   // the clock ran while the game did not
    music.startAfter = 0;
    rampMusic(MUSIC_GAIN, 0.1);
    pump();
  }

  function musicStop() {
    music.running = false;
    music.playing = false;
    music.step = 0;
    clearPump();
    rampMusic(0, 0.12);
  }

  /**
   * Ride the music bus to `to`. Anything already scheduled inside the lookahead
   * window rides down with it, which is what keeps a pause from leaving a note
   * hanging on.
   */
  function rampMusic(to, secs) {
    if (!ac || !musicBus) return;
    const t = ac.currentTime;
    const g = musicBus.gain;
    try { g.cancelScheduledValues(t); } catch (e) {}
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + secs);
  }

  // ================================================================
  // EVENT MAPPING
  // ================================================================

  /**
   * Core event -> sound. The deliberate silences matter as much as the sounds:
   *
   *   whiff          the shot already spoke; a miss cue on every stray tap
   *                  would nag. Losing a *multiplier* is the news, and
   *                  `chainBroken` covers that.
   *   enemyEscaped   fires for every virus that sinks — constant, and it costs
   *                  the player nothing.
   *   enemySpawned   for metts, guards and hoppers: up to four a second, and
   *                  they are already on screen. Only the two that change what
   *                  you must do get a cue (rare: shoot it now; prog: hold fire).
   *   resumed        the music coming back in *is* the sound.
   *   statsChanged   fires several times a second and means nothing on its own.
   */
  function handle(ev) {
    if (dead) return;
    switch (ev.type) {
      case "shot":
        (ev.tier === "charged" ? sfx.charged : sfx.shoot)();
        break;
      case "hit": {
        const p = panOf(ev.col);
        if (ev.enemyType === "rare") sfx.rareGet(p);
        else if (ev.enemyType === "guard") sfx.guardBreak(p);
        else sfx.hit(ev.chain || 1, ev.tier === "charged", p);
        break;
      }
      case "guardBlocked":  sfx.plink(); break;
      case "hopperStagger": sfx.stagger(); break;
      case "hopperHop":     sfx.hop(); break;
      case "multiplierUp":  sfx.rankup(ev.mult || 2); break;
      case "chainBroken":
        // only a chain that was worth something: below ×2 the loss is not news
        if ((ev.chain || 0) >= 5) sfx.chainLost(ev.chain, ev.cause === "whiff" ? 0 : 0.22);
        break;
      case "progHit":       sfx.allyHit(); break;
      case "allySpared":    sfx.spared(); break;
      case "playerHit":     sfx.hurt(panOf(ev.col)); break;
      case "playerMoved":   sfx.step(); break;
      case "enemySpawned":
        if (ev.enemyType === "rare") sfx.rareSpawn();
        else if (ev.enemyType === "ally") sfx.progWarn();
        break;
      case "enemyAim":      sfx.aim(panOf(ev.col)); break;
      case "enemyFired":    sfx.bolt(!!ev.heavy, panOf(ev.col)); break;
      case "runStarted":
        alarmAt = 0;
        sfx.boot();
        musicStart(0.5);     // let the credit jingle land before the downbeat
        break;
      case "paused":        sfx.pauseBlip(true); break;
      case "unpaused":      sfx.pauseBlip(false); break;
      case "stageGate":
        sfx.stageSting();
        sfx.cardPad();     // the card is a hold, not an ending — fill the air
        break;
      case "bombThrown":
        // a lob: a short rising whoosh, panned from where it left
        hiss({ dur: 0.22, filter: "bandpass", cutoff: 500, cutoffTo: 2400, q: 1.5, gain: 0.08, pan: panOf(ev.col) });
        tone({ wave: "triangle", freq: 220, to: 520, glide: 0.2, dur: 0.22, gain: 0.05, pan: panOf(ev.col) });
        break;
      case "bombBlast":
        // the biggest detonation in the game, and a longer duck than a kill
        duckMusic(0.7, 0.5);
        blast(1, panOf(ev.col));
        tone({ wave: "sine", freq: 60, to: 34, glide: 0.5, dur: 0.6, gain: 0.26, attack: 0.006, pan: panOf(ev.col) });
        break;
      case "pickup":
        seq([76, 83, 88], { step: 0.05, dur: 0.07, gain: 0.1, octave: true });
        break;
      case "bombEmpty":
        // a dry click: nothing to throw
        tone({ wave: "square", freq: 160, to: 120, dur: 0.06, gain: 0.05 });
        break;
      case "talk":
        // a word said: two soft notes, no attack to speak of
        seq([64, 71], { step: 0.07, dur: 0.11, gain: 0.07 });
        break;
      case "sentinelHit":
        // armour taking a real hit: a ring, not a note
        tone({ wave: "sine", freq: 1320, dur: 0.14, gain: 0.07, filter: "bandpass", cutoff: 1320, q: 12, pan: panOf(ev.col) });
        tone({ wave: "square", freq: 330, to: 200, dur: 0.08, gain: 0.05, pan: panOf(ev.col) });
        break;
      case "waveEnded":
        // only a wave the player actually wiped: a lapsed wave ends too, and
        // rewarding that would be rewarding nothing
        if (ev.cleared) sfx.waveClear(ev.virusCount || ev.size || 1);
        break;
      case "gameOver":
        musicStop();
        sfx.over();
        break;
      default: break;
    }
  }

  // ---------- per-frame observation ----------

  let alarmAt = 0;        // ac.currentTime of the next low-time beep
  let wasCharging = false, wasFull = false;

  /**
   * Called once per frame with the game's view model. Drives everything
   * continuous: music transport, intensity, the charge sweep and the alarm.
   * Derived rather than event-driven, so no transition can be missed.
   *
   * Never creates the context: before the first user gesture there is no
   * `ac`, so this is a no-op and nothing can sound. That is the whole
   * autoplay story — see `resume()`.
   *
   * @param {object} view - `hudView(state)`
   * @param {boolean} charging - the fire button is down and the meter filling
   * @param {boolean} chargeFull - the meter has filled
   */
  function observe(view, charging, chargeFull) {
    if (dead || !ac || !view) return;

    // --- intensity ---
    music.tier = view.overclock ? 3 : view.level >= 7 ? 2 : view.level >= 3 ? 1 : 0;
    music.lowTime = view.mode === "playing" && !view.paused && !view.safe && view.timeLeft < LOW_TIME;

    // --- transport ---
    if (view.mode === "playing" && !view.paused) {
      if (!music.running) musicStart(0);
      else if (!music.playing) musicResume();
    } else if (view.mode === "interlevel" || view.paused) {
      if (music.playing) musicHold();
    } else if (music.running) {
      musicStop();
    }
    // rAF is the second pump: it tops the schedule up between timer ticks.
    if (music.running) pump();

    // --- charge ---
    if (charging && !wasCharging) chargeStart();
    else if (!charging && wasCharging) chargeStop();
    if (charging && chargeFull && !wasFull) chargeFullNow();
    wasCharging = !!charging;
    wasFull = !!(charging && chargeFull);

    // --- low time ---
    if (music.lowTime && on) {
      if (ac.currentTime >= alarmAt) {
        const dire = view.timeLeft < 3;
        sfx.alarm(dire);
        alarmAt = ac.currentTime + (dire ? 0.42 : 0.84);
      }
    } else {
      alarmAt = 0;
    }
  }

  // ---------- mute ----------

  function setMuted(muted) {
    on = !muted;
    if (!ac) return;
    if (!on) chargeStop(0.02);
    const t = ac.currentTime;
    const g = master.gain;
    try { g.cancelScheduledValues(t); } catch (e) {}
    g.setValueAtTime(g.value, t);
    // short but audibly instant; a hard set would click
    g.linearRampToValueAtTime(on ? MASTER_GAIN : 0, t + (on ? 0.03 : 0.015));
  }

  // ---------- public surface ----------

  return {
    sfx,
    handle,
    handleAll(events) { for (const ev of events) handle(ev); },
    observe,

    /** Called from a user gesture: creates/unsuspends the context. */
    resume() { ctx(); },

    get muted() { return !on; },
    toggleMute() { setMuted(on); return !on; },

    // test / diagnostic seams
    get _ctx() { return ac; },
    get _live() { return live; },
    get _music() { return music; },

    /**
     * Leave nothing running: no scheduler timer, no oscillator, no buffer
     * source, no context — and no way for a late event to start one.
     */
    close() {
      if (dead) return;
      dead = true;
      music.running = false;
      music.playing = false;
      clearPump();
      chargeVoices = null;
      stopAll();
      try { if (ac) ac.close(); } catch (e) {}
      ac = null;
      master = sfxBus = musicBus = duck = null;
      waves.clear();
      whiteBuf = crushBuf = null;
    },
  };
}
