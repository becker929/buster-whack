/*!
 * Bonus tasks: a thing to do on the road, asked for by the people on the
 * towers, paid out when you have done it.
 *
 * A task is data: an id, the plain sentence the player reads, the counter it
 * watches and how much of it is wanted, and what it pays. Progress is counted
 * from the moment the task was taken -- the baseline is snapshotted then --
 * so nothing can be claimed by walking up with it already done.
 *
 * The core owns the counters and the ledger; the shell decides when someone
 * says any of it out loud. The text here is the player's instructions, not
 * canon: plain, mechanical, and safe to read in a reply.
 *
 * Pure module. No DOM, no clock, no randomness.
 */

/**
 * @typedef {object} Task
 * @property {string} id
 * @property {string} text     what the player is asked to do, in plain words
 * @property {string} counter  which counter in state.counts it watches
 * @property {number} need     how much of it, counted from when it was taken
 * @property {{pulse?: number, points?: number, bombs?: number}} reward
 */

/** @type {Task[]} */
export const TASKS = [
  { id: "sweep", text: "Take an arena without being hit.", counter: "cleanArenas", need: 1, reward: { pulse: 3 } },
  { id: "spare", text: "Let three runners past.", counter: "spared", need: 3, reward: { pulse: 4 } },
  { id: "steel", text: "Break four steel guards.", counter: "guards", need: 4, reward: { points: 2000 } },
  { id: "chain", text: "Delete eight in a row without missing.", counter: "chain8", need: 1, reward: { pulse: 4 } },
  { id: "clean", text: "Clear three waves with nothing left standing.", counter: "perfectWaves", need: 3, reward: { bombs: 1 } },
  { id: "charge", text: "Take six with a charged shot.", counter: "charged", need: 6, reward: { pulse: 5 } },
  { id: "shutter", text: "Break two sentinels while they are open.", counter: "sentinels", need: 2, reward: { points: 3000 } },
  { id: "far", text: "Take five arenas.", counter: "arenas", need: 5, reward: { pulse: 6 } },
];

export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

/** A fresh ledger: no counters, nothing taken, nothing owed. */
export function newTaskState() {
  return {
    lastNpc: null,       // one task exchange per person, however long you talk
    counts: {
      cleanArenas: 0, spared: 0, guards: 0, sentinels: 0,
      chain8: 0, perfectWaves: 0, charged: 0, arenas: 0,
    },
    active: null,          // { id, base } -- base is the counter when taken
    done: [],              // ids, in the order they were paid
    hitThisArena: false,   // reset when an arena is entered; a clean take needs it false
  };
}

/** How far along the active task is, and what is left. */
export function progress(tasks) {
  if (!tasks.active) return null;
  const task = TASK_BY_ID[tasks.active.id];
  if (!task) return null;
  const have = Math.max(0, (tasks.counts[task.counter] || 0) - tasks.active.base);
  return { task, have: Math.min(have, task.need), need: task.need, met: have >= task.need };
}

/** The next task nobody has been given yet, or null when they are all done. */
export function nextTask(tasks) {
  if (tasks.active) return null;
  for (const t of TASKS) if (!tasks.done.includes(t.id)) return t;
  return null;
}

/** Take a task: the baseline is now, so the work has to happen after this. */
export function takeTask(tasks, id) {
  const task = TASK_BY_ID[id];
  if (!task || tasks.active || tasks.done.includes(id)) return false;
  tasks.active = { id, base: tasks.counts[task.counter] || 0 };
  return true;
}

/**
 * Pay out the active task if it is met. Returns the reward paid, or null.
 * The caller applies it: this module knows nothing about the clock.
 */
export function claimTask(tasks) {
  const p = progress(tasks);
  if (!p || !p.met) return null;
  tasks.done.push(p.task.id);
  tasks.active = null;
  return { id: p.task.id, ...p.task.reward };
}


/**
 * The task half of talking to someone: they pay out what you have done, or
 * they ask for the next thing, or they have nothing to ask. One exchange per
 * person, however many times you press TALK at them.
 *
 * Pushes exactly one event, carrying the plain sentence the shell shows.
 */
export function taskExchange(state, npcId, events) {
  const t = state.tasks;
  if (!t || t.lastNpc === npcId) return;
  t.lastNpc = npcId;

  const p = progress(t);
  if (p && p.met) {
    const paid = claimTask(t);
    const parts = [];
    if (paid.pulse) {
      state.timeLeft = Math.min(state.tuning.TIME_CAP, state.timeLeft + paid.pulse);
      parts.push("+" + paid.pulse.toFixed(1) + "s");
    }
    if (paid.points) { state.score += paid.points; parts.push("+" + paid.points); }
    if (paid.bombs) { state.bombs += paid.bombs; parts.push("+" + paid.bombs + " bomb"); }
    events.push({ type: "taskDone", npc: npcId, id: paid.id, text: "Done. " + parts.join(", ") + ".", reward: paid });
    events.push({ type: "statsChanged" });
    return;
  }
  if (p) {
    events.push({
      type: "taskProgress", npc: npcId, id: p.task.id,
      text: p.task.text + " (" + p.have + " of " + p.need + ")", have: p.have, need: p.need,
    });
    return;
  }
  const next = nextTask(t);
  if (!next) { events.push({ type: "taskNone", npc: npcId }); return; }
  takeTask(t, next.id);
  events.push({ type: "taskGiven", npc: npcId, id: next.id, text: next.text });
}
