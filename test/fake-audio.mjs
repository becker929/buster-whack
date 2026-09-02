/*!
 * A recording fake of the slice of Web Audio the shell uses.
 *
 * It is not a synthesizer — it builds no samples. It records every node that
 * was created, what it was connected to, when it was started and stopped, and
 * every automation point written to every AudioParam, so a test can assert on
 * the *shape* of the graph a run produced: how many voices an event spawned,
 * that mute drove the master gain to zero, that teardown stopped every source.
 *
 * `currentTime` is manual. Nothing advances unless a test says so, which is
 * what makes the music scheduler testable at all.
 */

let nextId = 1;

/** A tiny AudioParam that can be read back at an arbitrary time. */
class FakeParam {
  constructor(name, value) {
    this.name = name;
    this._initial = value;
    this.events = [];      // { type, value, time }
  }
  setValueAtTime(v, t) { this.events.push({ type: "set", value: v, time: t }); return this; }
  linearRampToValueAtTime(v, t) { this.events.push({ type: "lin", value: v, time: t }); return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push({ type: "exp", value: v, time: t }); return this; }
  setTargetAtTime(v, t, tc) { this.events.push({ type: "target", value: v, time: t, tc }); return this; }
  cancelScheduledValues(t) {
    const held = this.valueAt(t);
    this.events = this.events.filter((e) => e.time < t);
    this._cancelled = { time: t, value: held };
    return this;
  }
  /** Value at `t`, interpolating ramps the way the real thing would. */
  valueAt(t) {
    let v = this._initial;
    let prevT = -Infinity;
    for (const e of this.events) {
      if (e.time <= t) { v = e.value; prevT = e.time; continue; }
      if (e.type === "lin" || e.type === "exp") {
        const span = e.time - prevT;
        if (span <= 0 || prevT === -Infinity) return v;
        const p = (t - prevT) / span;
        return e.type === "lin"
          ? v + (e.value - v) * p
          : (v <= 0 ? e.value : v * Math.pow(e.value / v, p));
      }
      break;
    }
    return v;
  }
  get value() { return this.valueAt(this._ctx ? this._ctx.currentTime : 0); }
  set value(v) { this._initial = v; this.events.length = 0; }
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.id = nextId++;
    this.outputs = [];
    this.disconnected = false;
    ctx.nodes.push(this);
  }
  connect(dest) { this.outputs.push(dest); return dest; }
  disconnect() { this.disconnected = true; this.outputs.length = 0; }
  _param(name, v) {
    const p = new FakeParam(name, v);
    p._ctx = this.ctx;
    return p;
  }
}

class FakeSource extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind);
    this.started = null;
    this.stopped = null;
    this.onended = null;
    ctx.sources.push(this);
  }
  start(t, offset) {
    if (this.started !== null) throw new Error("already started");
    this.started = t === undefined ? this.ctx.currentTime : t;
    this.offset = offset;
  }
  stop(t) {
    if (this.started === null) throw new Error("cannot stop before start");
    const at = t === undefined ? this.ctx.currentTime : t;
    // last call wins, like the real node
    this.stopped = this.stopped === null ? at : Math.min(this.stopped, at);
  }
}

class FakeOscillator extends FakeSource {
  constructor(ctx) {
    super(ctx, "oscillator");
    this.type = "sine";
    this.periodicWave = null;
    this.frequency = this._param("frequency", 440);
    this.detune = this._param("detune", 0);
  }
  setPeriodicWave(w) { this.periodicWave = w; this.type = "custom"; }
}

class FakeBufferSource extends FakeSource {
  constructor(ctx) {
    super(ctx, "buffer");
    this.buffer = null;
    this.loop = false;
    this.playbackRate = this._param("playbackRate", 1);
  }
}

export class FakeAudioContext {
  constructor(opts = {}) {
    this.currentTime = 0;
    this.sampleRate = opts.sampleRate || 8000;
    this.state = "running";
    this.closed = false;
    this.destination = { kind: "destination", connect() {} };
    this.nodes = [];
    this.sources = [];
    this.buffers = [];
    this.waves = [];
    FakeAudioContext.instances.push(this);
  }

  createOscillator() { return new FakeOscillator(this); }
  createBufferSource() { return new FakeBufferSource(this); }

  createGain() {
    const n = new FakeNode(this, "gain");
    n.gain = n._param("gain", 1);
    return n;
  }
  createBiquadFilter() {
    const n = new FakeNode(this, "filter");
    n.type = "lowpass";
    n.frequency = n._param("frequency", 350);
    n.Q = n._param("Q", 1);
    n.gain = n._param("gain", 0);
    return n;
  }
  createDynamicsCompressor() {
    const n = new FakeNode(this, "compressor");
    for (const k of ["threshold", "knee", "ratio", "attack", "release"]) n[k] = n._param(k, 0);
    n.reduction = 0;
    return n;
  }
  createBuffer(channels, len, rate) {
    const data = new Float32Array(len);
    const buf = { numberOfChannels: channels, length: len, sampleRate: rate, getChannelData: () => data };
    this.buffers.push(buf);
    return buf;
  }
  createPeriodicWave(real, imag) {
    const w = { real, imag };
    this.waves.push(w);
    return w;
  }

  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.closed = true; this.state = "closed"; return Promise.resolve(); }

  // ---- test helpers ----

  /** Sources that are still sounding at time `t`. */
  ringingAt(t) {
    return this.sources.filter(
      (s) => s.started !== null && s.started <= t && (s.stopped === null || s.stopped > t),
    );
  }
  /** Sources with no stop time at all — the ones that would run forever. */
  get unstopped() {
    return this.sources.filter((s) => s.started !== null && s.stopped === null);
  }
}
FakeAudioContext.instances = [];

/**
 * A minimal `win` for `createAudio`: the fake context plus a manual timer
 * queue, so the music scheduler's lookahead pump runs exactly when a test
 * says it does.
 */
export function fakeWindow(opts = {}) {
  const timers = new Map();
  let id = 1;
  const win = {
    AudioContext: class extends FakeAudioContext {
      constructor() { super(opts); win.ctxs.push(this); }
    },
    ctxs: [],
    timers,
    setTimeout(fn, ms) { const t = id++; timers.set(t, { fn, ms }); return t; },
    clearTimeout(t) { timers.delete(t); },
    /** Run every pending timer callback once (they usually re-arm). */
    runTimers(n = 1) {
      for (let i = 0; i < n; i++) {
        for (const [t, entry] of Array.from(timers)) {
          timers.delete(t);
          entry.fn();
        }
      }
    },
  };
  return win;
}

/** The view model `observe()` expects, with sane defaults. */
export function view(o = {}) {
  return {
    score: "000000",
    chain: o.chain === undefined ? 0 : o.chain,
    mult: o.mult === undefined ? 1 : o.mult,
    level: o.level === undefined ? 1 : o.level,
    timeLeft: o.timeLeft === undefined ? 30 : o.timeLeft,
    timeFrac: 1,
    overclock: !!o.overclock,
    overclockFactor: 1,
    paused: !!o.paused,
    mode: o.mode || "playing",
  };
}
