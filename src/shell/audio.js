/*!
 * Web Audio shell.
 *
 * Owns the AudioContext and the sfx bank, and maps core events to sounds.
 * The core never makes a noise; it emits `{ type: "hit", … }` and this module
 * decides what that sounds like.
 */

export function createAudio(win) {
  const state = { on: true, ac: null };

  function ctx() {
    if (!state.ac) {
      try { state.ac = new (win.AudioContext || win.webkitAudioContext)(); } catch (e) {}
    }
    if (state.ac && state.ac.state === "suspended") state.ac.resume();
    return state.ac;
  }

  function tone(freq, dur, opts) {
    opts = opts || {};
    if (!state.on) return;
    const c = ctx();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = opts.type || "square";
    const t = c.currentTime + (opts.delay || 0);
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + opts.slide), t + dur);
    g.gain.setValueAtTime(opts.gain || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  const sfx = {
    shoot:   () => tone(880, 0.05, { slide: -300, gain: 0.03 }),
    charged: () => { tone(220, 0.18, { type: "sawtooth", slide: -120, gain: 0.07 }); tone(440, 0.12, { slide: -200, gain: 0.04 }); },
    hit:     () => { tone(520, 0.07, { slide: -260, gain: 0.05 }); tone(390, 0.08, { delay: 0.03, slide: -200, gain: 0.04 }); },
    guardBreak: () => { tone(160, 0.2, { type: "sawtooth", slide: -80, gain: 0.08 }); tone(640, 0.08, { slide: -400, gain: 0.04 }); },
    plink:   () => tone(1500, 0.03, { type: "triangle", gain: 0.035 }),
    stagger: () => tone(700, 0.05, { type: "triangle", slide: -300, gain: 0.04 }),
    ready:   () => { tone(660, 0.06, { gain: 0.04 }); tone(990, 0.09, { delay: 0.06, gain: 0.04 }); },
    hop:     () => tone(300, 0.04, { type: "triangle", slide: 120, gain: 0.025 }),
    rankup:  () => { tone(523, 0.06, { gain: 0.04 }); tone(659, 0.06, { delay: 0.06, gain: 0.04 }); tone(784, 0.09, { delay: 0.12, gain: 0.04 }); },
    alarm:   () => { tone(440, 0.12, { type: "sawtooth", gain: 0.06 }); tone(440, 0.12, { type: "sawtooth", delay: 0.16, gain: 0.06 }); },
    allyHit: () => { tone(110, 0.3, { type: "sawtooth", gain: 0.09 }); tone(116, 0.3, { type: "sawtooth", gain: 0.09 }); },
    rareSpawn: () => { tone(1047, 0.05, { gain: 0.035 }); tone(1319, 0.05, { delay: 0.05, gain: 0.035 }); tone(1568, 0.08, { delay: 0.1, gain: 0.035 }); },
    rareGet: () => { tone(784, 0.07, { gain: 0.05 }); tone(988, 0.07, { delay: 0.07, gain: 0.05 }); tone(1175, 0.07, { delay: 0.14, gain: 0.05 }); tone(1568, 0.14, { delay: 0.21, gain: 0.05 }); },
    over:    () => { tone(392, 0.12, { gain: 0.05 }); tone(311, 0.12, { delay: 0.13, gain: 0.05 }); tone(233, 0.25, { delay: 0.26, gain: 0.05 }); },
    aim:     () => tone(190, 0.10, { type: "sawtooth", slide: 110, gain: 0.03 }),
    bolt:    () => tone(300, 0.07, { type: "square", slide: -170, gain: 0.035 }),
    hurt:    () => { tone(150, 0.22, { type: "sawtooth", slide: -70, gain: 0.09 }); tone(92, 0.28, { type: "square", delay: 0.02, slide: -40, gain: 0.07 }); },
  };

  /** Core event -> sound. One place to widen when the sfx get bolder. */
  function handle(ev) {
    switch (ev.type) {
      case "shot":          (ev.tier === "charged" ? sfx.charged : sfx.shoot)(); break;
      case "hit":
        (ev.enemyType === "rare" ? sfx.rareGet :
         ev.enemyType === "guard" ? sfx.guardBreak : sfx.hit)();
        break;
      case "guardBlocked":  sfx.plink(); break;
      case "hopperStagger": sfx.stagger(); break;
      case "hopperHop":     sfx.hop(); break;
      case "chargeReady":   sfx.ready(); break;
      case "multiplierUp":  sfx.rankup(); break;
      case "stageGate":     sfx.rankup(); break;
      case "progHit":       sfx.allyHit(); break;
      case "playerHit":     sfx.hurt(); break;
      case "enemySpawned":  if (ev.enemyType === "rare") sfx.rareSpawn(); break;
      case "enemyAim":      sfx.aim(); break;
      case "enemyFired":    sfx.bolt(); break;
      case "gameOver":      sfx.over(); break;
      default: break;
    }
  }

  return {
    sfx,
    handle,
    handleAll(events) { for (const ev of events) handle(ev); },
    /** Called from a user gesture: creates/unsuspends the context. */
    resume() { ctx(); },
    get muted() { return !state.on; },
    toggleMute() { state.on = !state.on; return !state.on; },
    close() {
      try { if (state.ac) state.ac.close(); } catch (e) {}
    },
  };
}
