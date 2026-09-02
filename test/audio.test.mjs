// The audio shell is effectful by definition, so it is tested the way the
// render shell is: against a recording fake. What matters is not the timbre
// (a browser has to judge that) but the *shape* — which events build voices,
// which build none on purpose, that mute and pause and teardown really do
// silence things, and that the music scheduler keeps its lookahead full.

import test from "node:test";
import assert from "node:assert/strict";

import { createAudio } from "../src/shell/audio.js";
import { fakeWindow, view } from "./fake-audio.mjs";

// ---------- fixtures ----------

function boot() {
  const win = fakeWindow();
  const audio = createAudio(win);
  audio.resume();                  // the user gesture
  return { win, audio, ac: win.ctxs[0] };
}

/** Sources created by `fn`. */
function spawned(ac, fn) {
  const before = ac.sources.length;
  fn();
  return ac.sources.slice(before);
}

/** Nodes of any kind created by `fn`. */
function built(ac, fn) {
  const before = ac.nodes.length;
  fn();
  return ac.nodes.slice(before);
}

/** Does `node` reach the context destination by following connections? */
function reachesOutput(node, ac, seen = new Set()) {
  if (node === ac.destination) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  const outs = node.outputs || [];
  for (const o of outs) {
    if (o === ac.destination) return true;
    if (reachesOutput(o, ac, seen)) return true;
  }
  // an AudioParam target (the charge tremolo) is a legitimate dead end
  return !!(node.name || node.events);
}

const HZ = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---------- autoplay ----------

test("no context exists until something asks for one", () => {
  const win = fakeWindow();
  const audio = createAudio(win);
  assert.equal(win.ctxs.length, 0);
  // the per-frame observer must never be the thing that unlocks audio
  audio.observe(view(), false, false);
  audio.observe(view({ mode: "ready" }), false, false);
  assert.equal(win.ctxs.length, 0, "observe() created an AudioContext before any gesture");
  audio.resume();
  assert.equal(win.ctxs.length, 1);
  audio.close();
});

// ---------- the sfx bank ----------

test("a shot is layered, not a single blip, and reaches the output", () => {
  const { audio, ac } = boot();
  const nodes = built(ac, () => audio.handle({ type: "shot", tier: "normal" }));
  const srcs = nodes.filter((n) => n.kind === "oscillator" || n.kind === "buffer");
  assert.ok(srcs.length >= 3, `expected a layered shot, got ${srcs.length} sources`);
  assert.ok(srcs.some((s) => s.kind === "buffer"), "a shot needs a noise transient");
  assert.ok(nodes.some((n) => n.kind === "filter"), "a shot needs filtering");
  for (const s of srcs) assert.ok(reachesOutput(s, ac), "a voice was left unrouted");
  for (const s of srcs) assert.notEqual(s.stopped, null, "a voice was left with no stop time");
  audio.close();
});

test("a charged shot is bigger in kind than a normal one", () => {
  const { audio, ac } = boot();
  const normal = spawned(ac, () => audio.handle({ type: "shot", tier: "normal" }));
  const charged = spawned(ac, () => audio.handle({ type: "shot", tier: "charged" }));
  assert.ok(charged.length > normal.length, "charged should layer more voices");
  const nLong = Math.max(...normal.map((s) => s.stopped - s.started));
  const cLong = Math.max(...charged.map((s) => s.stopped - s.started));
  assert.ok(cLong > nLong * 2, "charged should also ring far longer");
  audio.close();
});

test("the four big moments are audibly different in kind", () => {
  const { audio, ac } = boot();
  const sizes = {};
  for (const [name, ev] of [
    ["normal", { type: "hit", enemyType: "mett", tier: "normal", chain: 1 }],
    ["charged", { type: "hit", enemyType: "mett", tier: "charged", chain: 1 }],
    ["guard", { type: "hit", enemyType: "guard", tier: "charged", chain: 1 }],
    ["rare", { type: "hit", enemyType: "rare", tier: "normal", chain: 1 }],
  ]) {
    const s = spawned(ac, () => audio.handle(ev));
    sizes[name] = { voices: s.length, tail: Math.max(...s.map((x) => x.stopped)) - ac.currentTime };
  }
  assert.ok(sizes.charged.voices > sizes.normal.voices);
  assert.ok(sizes.guard.voices > sizes.normal.voices);
  assert.ok(sizes.rare.voices > sizes.guard.voices, "the jackpot should be the biggest event");
  assert.ok(sizes.rare.tail > 0.7, "the jackpot should ring on");
  assert.ok(sizes.normal.tail < 0.3, "the bread-and-butter delete must stay short");
  audio.close();
});

test("the delete pitch climbs with the chain, then caps instead of going ultrasonic", () => {
  const { audio, ac } = boot();
  const top = (chain) => {
    const s = spawned(ac, () => audio.handle({ type: "hit", enemyType: "mett", tier: "normal", chain }));
    return Math.max(...s.filter((x) => x.kind === "oscillator").map((x) => x.frequency.events[0].value));
  };
  const f1 = top(1), f5 = top(5), f12 = top(12), f40 = top(40);
  assert.ok(f5 > f1 * 1.4, "five in a row must be audibly higher than one");
  assert.ok(f12 > f5);
  assert.ok(f40 <= f12 * 4.1, "past the ladder the fundamental must stop climbing");
  assert.ok(f40 >= f12, "…but not fall back either");
  audio.close();
});

test("the multiplier fanfare grows with the multiplier", () => {
  const { audio, ac } = boot();
  const n = (mult) => spawned(ac, () => audio.handle({ type: "multiplierUp", mult, chain: 5 })).length;
  const x2 = n(2), x3 = n(3), x4 = n(4);
  assert.ok(x3 > x2 && x4 > x3, `expected escalation, got ${x2}/${x3}/${x4}`);
  audio.close();
});

test("losing a chain sounds only when the chain was worth something", () => {
  const { audio, ac } = boot();
  assert.equal(spawned(ac, () => audio.handle({ type: "chainBroken", chain: 1, cause: "whiff" })).length, 0);
  assert.equal(spawned(ac, () => audio.handle({ type: "chainBroken", chain: 4, cause: "whiff" })).length, 0);
  assert.ok(spawned(ac, () => audio.handle({ type: "chainBroken", chain: 5, cause: "whiff" })).length > 0);
  assert.ok(spawned(ac, () => audio.handle({ type: "chainBroken", chain: 22, cause: "hurt" })).length > 0);
  audio.close();
});

test("the deliberate silences stay silent", () => {
  const { audio, ac } = boot();
  const silent = [
    { type: "whiff", tier: "normal", row: 1 },
    { type: "enemyEscaped", enemyType: "mett" },
    { type: "enemySpawned", enemyType: "mett" },
    { type: "enemySpawned", enemyType: "guard" },
    { type: "enemySpawned", enemyType: "hopper" },
    { type: "statsChanged" },
    { type: "resumed" },
    { type: "chargeReady" },     // owned by the charge sweep, not by an event
  ];
  for (const ev of silent) {
    assert.equal(spawned(ac, () => audio.handle(ev)).length, 0, `${ev.type} should be silent`);
  }
  // …and the two spawns that change what the player must do are not silent
  assert.ok(spawned(ac, () => audio.handle({ type: "enemySpawned", enemyType: "rare" })).length > 0);
  assert.ok(spawned(ac, () => audio.handle({ type: "enemySpawned", enemyType: "ally" })).length > 0);
  audio.close();
});

test("a heavy bolt is pitched below a light one", () => {
  const { audio, ac } = boot();
  const low = (heavy) => {
    const s = spawned(ac, () => audio.handle({ type: "enemyFired", heavy }));
    return Math.min(...s.filter((x) => x.kind === "oscillator").map((x) => x.frequency.events[0].value));
  };
  assert.ok(low(true) < low(false), "a guard's bolt should be the lower one");
  audio.close();
});

// ---------- mute ----------

test("mute silences everything and builds nothing", () => {
  const { win, audio, ac } = boot();
  audio.handle({ type: "runStarted" });
  ac.currentTime = 1;
  win.runTimers(3);
  assert.ok(ac.sources.length > 0);

  assert.equal(audio.toggleMute(), true);
  assert.equal(audio.muted, true);

  // the master gain is at zero within a frame or two
  assert.ok(ac.currentTime <= 1);
  const master = ac.nodes.find((n) => n.kind === "gain" && n.gain.events.some((e) => e.value === 0));
  assert.ok(master, "expected a gain automated to zero");

  const during = spawned(ac, () => {
    audio.handle({ type: "hit", enemyType: "mett", tier: "charged", chain: 9 });
    audio.handle({ type: "playerHit" });
    audio.observe(view({ level: 9 }), true, false);
    ac.currentTime = 2;
    win.runTimers(4);          // the music transport keeps time but stays quiet
  });
  assert.equal(during.length, 0, "muted audio must not build a single node");

  audio.toggleMute();
  assert.equal(audio.muted, false);
  ac.currentTime = 3;
  win.runTimers(2);
  assert.ok(ac.sources.length > 0);
  audio.close();
});

test("mute survives being toggled before the context exists", () => {
  const win = fakeWindow();
  const audio = createAudio(win);
  assert.equal(audio.toggleMute(), true);
  audio.resume();
  const ac = win.ctxs[0];
  assert.equal(spawned(ac, () => audio.handle({ type: "shot", tier: "normal" })).length, 0);
  audio.close();
});

// ---------- music ----------

test("music starts on the run, not on mount, and keeps its lookahead full", () => {
  const { win, audio, ac } = boot();
  assert.equal(audio._music.running, false);

  audio.handle({ type: "runStarted" });
  assert.equal(audio._music.running, true);
  assert.ok(win.timers.size > 0, "the scheduler must arm a pump");

  // the credit jingle gets the first half second to itself
  assert.ok(audio._music.nextAt >= 0.5);

  let last = 0;
  for (let t = 0.1; t < 8; t += 0.05) {
    ac.currentTime = t;
    win.runTimers(1);
    audio.observe(view(), false, false);
    // the transport is always scheduled ahead of the clock: that is what makes
    // the loop seamless rather than stuttering at the bar line
    assert.ok(audio._music.nextAt > t, `schedule fell behind the clock at t=${t}`);
    last = t;
  }
  assert.ok(last > 7);
  assert.ok(ac.sources.length > 70, `eight seconds of music should be many voices, got ${ac.sources.length}`);
  assert.equal(ac.unstopped.length, 0, "every music voice needs a stop time");
  audio.close();
});

test("intensity rises with level and overclock is a different loop", () => {
  const { win, audio, ac } = boot();
  audio.handle({ type: "runStarted" });

  const density = (v) => {
    audio.observe(v, false, false);
    const before = ac.sources.length;
    const t0 = ac.currentTime;
    for (let i = 1; i <= 40; i++) {
      ac.currentTime = t0 + i * 0.05;
      win.runTimers(1);
      audio.observe(v, false, false);
    }
    return ac.sources.length - before;
  };

  const lo = density(view({ level: 1 }));
  const mid = density(view({ level: 5 }));
  const hi = density(view({ level: 9 }));
  const oc = density(view({ level: 13, overclock: true }));

  assert.ok(mid > lo, `tier 1 should be busier than tier 0 (${lo} -> ${mid})`);
  assert.ok(hi > mid, `tier 2 should be busier than tier 1 (${mid} -> ${hi})`);
  assert.equal(audio._music.tier, 3, "overclock must select its own tier");
  assert.ok(oc > hi * 0.9, "overclock should not thin out");
  audio.close();
});

test("low time changes the groove and beats the alarm", () => {
  const { win, audio, ac } = boot();
  audio.handle({ type: "runStarted" });
  ac.currentTime = 1;
  audio.observe(view({ timeLeft: 20 }), false, false);
  assert.equal(audio._music.lowTime, false);

  const beeps = spawned(ac, () => {
    for (let i = 0; i < 60; i++) {
      ac.currentTime = 1 + i * 0.1;
      win.runTimers(1);
      audio.observe(view({ timeLeft: 5 }), false, false);
    }
  });
  assert.equal(audio._music.lowTime, true, "under six seconds the music must know it");
  // ~6 seconds at one alarm every 0.84s
  const alarmish = beeps.filter((s) => s.kind === "oscillator" && s.frequency.events[0].value === HZ(76));
  assert.ok(alarmish.length >= 5, `expected repeated alarms, saw ${alarmish.length}`);

  // and it gets tighter when it is dire
  const dire = spawned(ac, () => {
    for (let i = 0; i < 20; i++) {
      ac.currentTime = 8 + i * 0.1;
      win.runTimers(1);
      audio.observe(view({ timeLeft: 2 }), false, false);
    }
  });
  const direBeeps = dire.filter((s) => s.kind === "oscillator" && s.frequency.events[0].value === HZ(81));
  assert.ok(direBeeps.length > alarmish.length / 3, "the dire alarm should be more frequent");
  audio.close();
});

test("pause silences the music, and resuming keeps the phrase", () => {
  const { win, audio, ac } = boot();
  audio.handle({ type: "runStarted" });
  for (let i = 1; i <= 30; i++) { ac.currentTime = i * 0.05; win.runTimers(1); audio.observe(view(), false, false); }
  const stepAtPause = audio._music.step;
  assert.ok(stepAtPause > 0, "the transport should have moved");

  audio.observe(view({ paused: true }), false, false);
  assert.equal(audio._music.playing, false);

  // the music bus is riding to zero
  const busGain = ac.nodes.filter((n) => n.kind === "gain")
    .find((n) => n.gain.events.some((e) => e.type === "lin" && e.value === 0));
  assert.ok(busGain, "the music bus must be ramped to silence on pause");

  const quiet = spawned(ac, () => {
    for (let i = 31; i <= 90; i++) {
      ac.currentTime = i * 0.05;
      win.runTimers(1);
      audio.observe(view({ paused: true }), false, false);
    }
  });
  assert.equal(quiet.length, 0, "a paused game must build no music voices at all");

  audio.observe(view(), false, false);
  assert.equal(audio._music.playing, true);
  assert.notEqual(audio._music.step, 0, "resuming must not restart the loop from the top");
  assert.ok(audio._music.nextAt > ac.currentTime, "resuming must re-anchor ahead of the clock");
  audio.close();
});

test("the interlevel card holds the music, the game over card stops it", () => {
  const { win, audio, ac } = boot();
  audio.handle({ type: "runStarted" });
  for (let i = 1; i <= 30; i++) { ac.currentTime = i * 0.05; win.runTimers(1); audio.observe(view(), false, false); }

  audio.handle({ type: "stageGate", stage: {}, index: 0, title: "T", desc: "d", timeBonus: 2 });
  audio.observe(view({ mode: "interlevel" }), false, false);
  assert.equal(audio._music.running, true, "the card holds the transport, it does not end it");
  assert.equal(audio._music.playing, false);
  const held = audio._music.step;

  audio.observe(view(), false, false);
  assert.ok(audio._music.step >= held, "continuing must not rewind the loop");

  audio.handle({ type: "gameOver", score: 1, rank: "B", deletions: 3, bestChain: 2, best: 1, newBest: false });
  assert.equal(audio._music.running, false);
  assert.equal(audio._music.step, 0, "a finished run resets the loop");
  assert.equal(win.timers.size, 0, "no pump should survive the run");
  audio.close();
});

test("a retry restarts the loop from the top", () => {
  const { win, audio, ac } = boot();
  audio.handle({ type: "runStarted" });
  for (let i = 1; i <= 40; i++) { ac.currentTime = i * 0.05; win.runTimers(1); audio.observe(view(), false, false); }
  audio.handle({ type: "gameOver", score: 1, rank: "B", deletions: 3, bestChain: 2, best: 1, newBest: false });
  audio.observe(view({ mode: "over" }), false, false);
  audio.handle({ type: "runStarted" });
  assert.equal(audio._music.step, 0);
  assert.equal(audio._music.running, true);
  audio.close();
});

// ---------- charge ----------

test("holding fire runs a sweep that resolves, and never outlives the hold", () => {
  const { audio, ac } = boot();

  // the same frame also starts the music transport, so the sweep is the part
  // with no stop time: it runs until the player lets go
  const all = spawned(ac, () => audio.observe(view(), true, false));
  const sweep = all.filter((s) => s.stopped === null);
  assert.ok(sweep.length >= 3, `the charge sweep should be a stack, got ${sweep.length}`);
  // it really does sweep: every voice ramps its pitch
  const ramped = sweep.filter((s) => s.frequency && s.frequency.events.some((e) => e.type === "exp"));
  assert.equal(ramped.length, sweep.length);

  // filling resolves into the ready chime without spawning a second sweep
  ac.currentTime = 0.7;
  const chime = spawned(ac, () => audio.observe(view(), true, true));
  assert.ok(chime.length > 0, "a filled charge must announce itself");
  for (const s of sweep) assert.equal(s.stopped, null, "the hum keeps going while held");

  // release
  ac.currentTime = 1.2;
  audio.observe(view(), false, false);
  for (const s of sweep) assert.ok(s.stopped !== null && s.stopped <= 1.3, "the sweep must stop on release");
  audio.close();
});

test("an interrupted charge leaves nothing running", () => {
  const { audio, ac } = boot();
  audio.observe(view(), true, false);
  const sweep = ac.sources.slice();
  // a hit spills the charge: the core clears it, so `charging` simply goes false
  ac.currentTime = 0.3;
  audio.observe(view(), false, false);
  for (const s of sweep) assert.notEqual(s.stopped, null);
  audio.close();
});

test("muting kills a held charge immediately", () => {
  const { audio, ac } = boot();
  audio.observe(view(), true, false);
  const sweep = ac.sources.slice();
  audio.toggleMute();
  for (const s of sweep) assert.notEqual(s.stopped, null, "a muted charge must not keep ringing");
  audio.close();
});

// ---------- teardown ----------

test("close() leaves nothing running", () => {
  const { win, audio, ac } = boot();
  audio.handle({ type: "runStarted" });
  for (let i = 1; i <= 60; i++) {
    ac.currentTime = i * 0.05;
    win.runTimers(1);
    audio.observe(view({ level: 9 }), i > 30, i > 50);
  }
  audio.handle({ type: "hit", enemyType: "rare", tier: "charged", chain: 12 });
  assert.ok(ac.sources.length > 50);

  const beforeClose = ac.sources.length;
  audio.close();

  assert.equal(win.timers.size, 0, "the scheduler timer outlived destroy()");
  assert.equal(ac.closed, true, "the AudioContext was not closed");
  for (const s of ac.sources) {
    assert.notEqual(s.started, null);
    assert.notEqual(s.stopped, null, `source #${s.id} (${s.kind}) was left running`);
  }
  assert.equal(ac.ringingAt(1e6).length, 0, "something is still sounding after teardown");

  // nothing may schedule after teardown
  audio.handle({ type: "hit", enemyType: "rare", tier: "charged", chain: 30 });
  audio.handle({ type: "runStarted" });
  audio.observe(view(), true, true);
  audio.resume();
  audio.toggleMute();
  assert.equal(ac.sources.length, beforeClose, "a node was built after close()");
  assert.equal(win.ctxs.length, 1, "a new context was built after close()");
  assert.equal(audio._ctx, null);
  assert.equal(audio._live.size, 0);
});

test("close() is idempotent", () => {
  const { audio } = boot();
  audio.handle({ type: "runStarted" });
  audio.close();
  audio.close();
});

test("the shell survives a browser with no Web Audio at all", () => {
  const audio = createAudio({});
  audio.resume();
  audio.handle({ type: "runStarted" });
  audio.handle({ type: "hit", enemyType: "rare", tier: "charged", chain: 3 });
  audio.observe(view(), true, true);
  audio.toggleMute();
  audio.close();
});

// ---------------------------------------------------------------------------
// Detonation, damage, stereo, and the extended form.
// ---------------------------------------------------------------------------

/** Every pan value set by `fn`, in creation order. */
function pans(ac, fn) {
  const before = ac.nodes.length;
  fn();
  return ac.nodes.slice(before)
    .filter((n) => n.kind === "panner")
    .map((n) => n.pan.events[0].value);
}

test("a deletion is panned to the column it happened in", () => {
  const { audio, ac } = boot();
  const at = (col) =>
    pans(ac, () => audio.handle({ type: "hit", enemyType: "mett", tier: "normal", chain: 1, col }));
  const left = at(0), right = at(5), mid = at(3);
  assert.ok(left.length > 0, "the delete should place at least one panned voice");
  assert.ok(Math.max(...left) < 0, "column 0 belongs on the left");
  assert.ok(Math.min(...right) > 0, "column 5 belongs on the right");
  // never hard-panned: a voice pushed all the way over vanishes on one earbud
  assert.ok(Math.max(...right) <= 0.63, "keep it short of hard-panned");
  assert.ok(Math.abs(mid[0]) < Math.abs(left[0]), "the middle of the board is near centre");
  audio.close();
});

test("the aim cue is panned hardest, because the lane is the information", () => {
  const { audio, ac } = boot();
  const aim = pans(ac, () => audio.handle({ type: "enemyAim", col: 5 }));
  const hit = pans(ac, () => audio.handle({ type: "hit", enemyType: "mett", chain: 1, col: 5 }));
  assert.ok(aim.length > 0 && hit.length > 0);
  assert.ok(Math.max(...aim) >= Math.max(...hit), "the telegraph must be at least as placed");
  audio.close();
});

test("taking a hit is a bigger event than any kill", () => {
  const { audio, ac } = boot();
  const size = (ev) => spawned(ac, () => audio.handle(ev)).length;
  const hurt = size({ type: "playerHit", col: 1 });
  const charged = size({ type: "hit", enemyType: "mett", tier: "charged", chain: 8, col: 3 });
  assert.ok(hurt >= charged, `damage (${hurt} voices) should not be smaller than a charged kill (${charged})`);
  audio.close();
});

test("a mett pop stays short even though it now detonates", () => {
  const { audio, ac } = boot();
  const s = spawned(ac, () => audio.handle({ type: "hit", enemyType: "mett", tier: "normal", chain: 1, col: 2 }));
  const tail = Math.max(...s.map((x) => x.stopped)) - ac.currentTime;
  // at wave density you hear a lot of these; a long tail on each smears
  assert.ok(tail < 0.3, `bread-and-butter delete tail ${tail.toFixed(3)}s must stay under 0.3s`);
  audio.close();
});

test("only a wave the player actually cleared gets the fanfare", () => {
  const { audio, ac } = boot();
  const cleared = spawned(ac, () => audio.handle({ type: "waveEnded", cleared: true, virusCount: 4 })).length;
  const lapsed = spawned(ac, () => audio.handle({ type: "waveEnded", cleared: false, virusCount: 4 })).length;
  assert.ok(cleared > 0, "clearing a wave should sound");
  assert.equal(lapsed, 0, "a wave that merely expired is not an achievement");
  audio.close();
});

test("the stage card gets a pad instead of dead air", () => {
  const { audio, ac } = boot();
  const s = spawned(ac, () => audio.handle({ type: "stageGate", index: 0, title: "T", desc: "d" }));
  const tail = Math.max(...s.map((x) => x.stopped)) - ac.currentTime;
  assert.ok(tail > 1.4, `the card should still be sounding at 1.4s, got ${tail.toFixed(2)}s`);
  audio.close();
});

test("the music form is longer than four bars, and comes back changed", () => {
  const { audio, ac, win } = boot();
  audio.handle({ type: "runStarted" });

  // Bars must be sampled on the transport's own grid or the fingerprints drift
  // and always differ, which would make this test pass for the wrong reason.
  // Tier 0 is 128bpm: a sixteenth is 60/(128*4)s, a bar is sixteen of them.
  const STEP = 60 / (128 * 4);
  const bars = [];
  let seen = 0;
  for (let b = 0; b < 22; b++) {
    for (let k = 0; k < 16; k++) { ac.currentTime += STEP; win.runTimers(2); }
    const fresh = ac.sources.slice(seen);
    seen = ac.sources.length;
    bars.push(
      fresh
        .filter((x) => x.kind === "oscillator" && x.frequency.events.length)
        .map((x) => Math.round(x.frequency.events[0].value))
        .sort((p, q) => p - q)
        .join(","),
    );
  }

  // Skip the lead-in: the run jingle holds the downbeat for half a second.
  const usable = bars.slice(3).filter((x) => x.length);
  assert.ok(usable.length >= 12, `expected a filled transport, got ${usable.length} bars`);

  // A four-bar loop makes every bar identical to the one four bars later.
  let same = 0, pairs = 0;
  for (let b = 3; b + 4 < bars.length; b++) {
    if (!bars[b].length || !bars[b + 4].length) continue;
    pairs++;
    if (bars[b] === bars[b + 4]) same++;
  }
  assert.ok(pairs >= 8, `not enough comparable bars (${pairs})`);
  // Allow some repetition — A and A'' share material by design — but not all.
  assert.ok(
    same <= pairs * 0.5,
    `${same}/${pairs} bars repeat at a four-bar period: the form is still a 4-bar loop`,
  );
  audio.close();
});
