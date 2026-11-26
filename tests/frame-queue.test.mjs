import test from "node:test";
import assert from "node:assert/strict";
import {createFrameQueue} from "../src/frameQueue.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return {promise, resolve};
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test("rectangle decodes and resize jobs retain wire order", async () => {
  const queue = createFrameQueue();
  const first = deferred();
  const seen = [];
  queue.enqueue(async current => { await first.promise; if (current()) seen.push("rectangle"); });
  queue.enqueue(() => { seen.push("resize"); });
  queue.enqueue(() => { seen.push("new rectangle"); });
  await tick();
  assert.deepEqual(seen, []);
  first.resolve(); await tick();
  assert.deepEqual(seen, ["rectangle", "resize", "new rectangle"]);
});
test("reset invalidates in-flight decode and discards queued old frames", async () => {
  const queue = createFrameQueue(); const first = deferred(); const seen = [];
  queue.enqueue(async current => { await first.promise; if (current()) seen.push("stale"); });
  queue.enqueue(() => { seen.push("old pending"); });
  queue.reset(); queue.enqueue(() => { seen.push("replacement"); });
  first.resolve(); await tick();
  assert.deepEqual(seen, ["replacement"]);
});
test("queue refuses overload without dropping accepted rectangles", async () => {
  const queue = createFrameQueue(2); const first = deferred(); const seen = [];
  assert.equal(queue.enqueue(async () => { await first.promise; seen.push(1); }), true);
  assert.equal(queue.enqueue(() => { seen.push(2); }), true);
  assert.equal(queue.enqueue(() => { seen.push(3); }), false);
  first.resolve(); await tick();
  assert.deepEqual(seen, [1, 2]);
  assert.equal(queue.enqueue(() => { seen.push(4); }), true); await tick();
  assert.deepEqual(seen, [1, 2, 4]);
});
test("payload budget includes active decode and recovers after reset", async () => {
  const queue = createFrameQueue(64, 10); const first = deferred();
  queue.enqueue(async () => { await first.promise; }, 6);
  assert.equal(queue.enqueue(() => {}, 5), false);
  assert.equal(queue.enqueue(() => {}, 4), true);
  queue.reset();
  assert.equal(queue.enqueue(() => {}, 5), false);
  assert.equal(queue.enqueue(() => {}, 4), true);
  assert.equal(queue.enqueue(() => {}, -1), false);
  first.resolve(); await tick();
  assert.equal(queue.enqueue(() => {}, 10), true); await tick();
});
test("obsolete decode failure cannot clear replacement frames", async () => {
  const queue = createFrameQueue(); const first = deferred(); const seen = [];
  queue.enqueue(async () => { await first.promise; throw new Error("fixture decode"); });
  queue.reset(); queue.enqueue(() => { seen.push("replacement"); });
  first.resolve(); await tick();
  assert.deepEqual(seen, ["replacement"]);
});
