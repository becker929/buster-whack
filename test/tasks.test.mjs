// Bonus tasks: the ledger, the counters, and the exchange that happens
// inside a conversation.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, addEnemy, step, fire, fireCharged, T } from "./helpers.mjs";
import {
  TASKS, newTaskState, nextTask, takeTask, progress, claimTask, taskExchange,
} from "../src/core/tasks.js";
import { bumpTask } from "../src/core/tasks-count.js";

test("every task is complete and watches a counter the ledger keeps", () => {
  const ledger = newTaskState();
  const ids = new Set();
  for (const t of TASKS) {
    assert.ok(t.id && !ids.has(t.id), "a unique id: " + t.id);
    ids.add(t.id);
    assert.ok(t.text.length > 0 && t.text.length < 60, t.id + " asks in one short line");
    assert.equal(typeof ledger.counts[t.counter], "number", t.id + " watches a real counter");
    assert.ok(t.need >= 1, t.id + " wants something");
    const r = t.reward;
    assert.ok(r.pulse || r.points || r.bombs, t.id + " pays something");
  }
});

test("progress is counted from when the task was taken, not before", () => {
  const l = newTaskState();
  l.counts.spared = 5;                       // five before anyone asked
  takeTask(l, "spare");
  assert.equal(progress(l).have, 0, "the old five do not count");
  l.counts.spared += 3;
  assert.equal(progress(l).met, true);
  const paid = claimTask(l);
  assert.equal(paid.id, "spare");
  assert.equal(paid.pulse, 4);
  assert.equal(l.active, null);
  assert.deepEqual(l.done, ["spare"]);
});

test("one task at a time, in order, and each only once", () => {
  const l = newTaskState();
  const first = nextTask(l);
  assert.equal(first.id, TASKS[0].id);
  takeTask(l, first.id);
  assert.equal(nextTask(l), null, "nothing new while one is open");
  assert.equal(takeTask(l, TASKS[1].id), false);
  l.counts[first.counter] += first.need;
  claimTask(l);
  assert.equal(nextTask(l).id, TASKS[1].id, "then the next one");
  assert.equal(takeTask(l, first.id), false, "and never the same one twice");
});

test("the counters follow what actually happened in a run", () => {
  const s = newGame();
  const c = s.tasks.counts;
  addEnemy(s, { type: "guard", col: 3, row: 1 });
  fireCharged(s);
  assert.equal(c.guards, 1, "a steel guard counts as steel");
  assert.equal(c.charged, 1, "and as a charged deletion");
  bumpTask(s, "spared");
  assert.equal(c.spared, 1);
  bumpTask(s, "arenaEntered");
  bumpTask(s, "arenaTaken");
  assert.equal(c.arenas, 1);
  assert.equal(c.cleanArenas, 1, "taken without a hit");
  bumpTask(s, "arenaEntered");
  bumpTask(s, "hurt");
  bumpTask(s, "arenaTaken");
  assert.equal(c.arenas, 2);
  assert.equal(c.cleanArenas, 1, "a hit spoils the clean take");
});

test("a chain of eight counts once, and again at sixteen", () => {
  const s = newGame();
  for (let n = 1; n <= 17; n++) bumpTask(s, "kill", { type: "mett", tier: "normal", chain: n });
  assert.equal(s.tasks.counts.chain8, 2);
});

test("talking to someone asks, reports, then pays -- once per person", () => {
  const s = newGame();
  s.tasks.counts.spared = 0;
  const ev1 = [];
  taskExchange(s, "npc.keeper.01", ev1);
  assert.equal(ev1[0].type, "taskGiven", "the first person asks for something");
  const asked = ev1[0].id;
  const ev2 = [];
  taskExchange(s, "npc.keeper.01", ev2);
  assert.deepEqual(ev2, [], "and does not ask again however long you talk");

  const task = TASKS.find((t) => t.id === asked);
  s.tasks.counts[task.counter] += task.need;
  const ev3 = [];
  taskExchange(s, "npc.side.tally", ev3);
  assert.equal(ev3[0].type, "taskDone", "the next person pays it out");
  assert.ok(ev3[0].text.startsWith("Done."));
  assert.ok(ev3.some((e) => e.type === "statsChanged"));
});

test("an unmet task is reported with its count, and pays nothing", () => {
  const s = newGame();
  taskExchange(s, "a", []);
  const id = s.tasks.active.id;
  const task = TASKS.find((t) => t.id === id);
  s.tasks.counts[task.counter] += Math.max(0, task.need - 1);
  const before = s.timeLeft;
  const ev = [];
  taskExchange(s, "b", ev);
  assert.equal(ev[0].type, "taskProgress");
  assert.ok(ev[0].text.includes("of " + task.need));
  assert.equal(s.timeLeft, before, "and the clock is untouched");
  assert.equal(s.tasks.active.id, id, "the task is still open");
});

test("a reward is really paid, and pulse never passes the cap", () => {
  const s = newGame();
  takeTask(s.tasks, "steel");
  s.tasks.counts.guards += 4;
  const score = s.score;
  taskExchange(s, "someone", []);
  assert.equal(s.score, score + 2000);

  const s2 = newGame();
  takeTask(s2.tasks, "spare");
  s2.tasks.counts.spared += 3;
  s2.timeLeft = T.TIME_CAP - 1;
  taskExchange(s2, "someone", []);
  assert.equal(s2.timeLeft, T.TIME_CAP, "the cap still holds");

  const s3 = newGame();
  takeTask(s3.tasks, "clean");
  s3.tasks.counts.perfectWaves += 3;
  const bombs = s3.bombs;
  taskExchange(s3, "someone", []);
  assert.equal(s3.bombs, bombs + 1);
});

test("when everything has been asked for, nobody asks again", () => {
  const s = newGame();
  for (const t of TASKS) { takeTask(s.tasks, t.id); s.tasks.counts[t.counter] += t.need; claimTask(s.tasks); }
  const ev = [];
  taskExchange(s, "last", ev);
  assert.equal(ev[0].type, "taskNone");
  assert.equal(ev.length, 1);
});

test("a run starts with an empty ledger", () => {
  const s = newGame();
  assert.equal(s.tasks.active, null);
  assert.deepEqual(s.tasks.done, []);
  for (const v of Object.values(s.tasks.counts)) assert.equal(v, 0);
});
