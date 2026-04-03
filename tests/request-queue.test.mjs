import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createRequestQueue } from "../scripts/lib/request-queue.mjs";

describe("createRequestQueue", () => {
  it("executes a single task", async () => {
    const queue = createRequestQueue();
    const result = await queue.enqueue(() => Promise.resolve(42));
    assert.equal(result, 42);
  });

  it("serializes concurrent tasks", async () => {
    const queue = createRequestQueue();
    const order = [];

    const task1 = queue.enqueue(async () => {
      order.push("start-1");
      await delay(50);
      order.push("end-1");
      return 1;
    });

    const task2 = queue.enqueue(async () => {
      order.push("start-2");
      await delay(10);
      order.push("end-2");
      return 2;
    });

    const task3 = queue.enqueue(async () => {
      order.push("start-3");
      order.push("end-3");
      return 3;
    });

    const results = await Promise.all([task1, task2, task3]);

    assert.deepEqual(results, [1, 2, 3]);
    assert.equal(order[0], "start-1");
    assert.equal(order[1], "end-1");
    assert.equal(order[2], "start-2");
    assert.equal(order[3], "end-2");
    assert.equal(order[4], "start-3");
    assert.equal(order[5], "end-3");
  });

  it("tracks active count", async () => {
    const queue = createRequestQueue();
    assert.equal(queue.getActiveCount(), 0);

    let resolveTask;
    const taskPromise = queue.enqueue(
      () => new Promise((resolve) => { resolveTask = resolve; })
    );

    await delay(5);
    assert.equal(queue.getActiveCount(), 1);

    resolveTask("done");
    await taskPromise;
    assert.equal(queue.getActiveCount(), 0);
  });

  it("continues after a task failure", async () => {
    const queue = createRequestQueue();

    const task1 = queue.enqueue(() => Promise.reject(new Error("fail")));
    await assert.rejects(task1, { message: "fail" });

    const task2 = queue.enqueue(() => Promise.resolve("recovered"));
    const result = await task2;
    assert.equal(result, "recovered");
  });

  it("handles many tasks without deadlock", async () => {
    const queue = createRequestQueue();
    const count = 50;
    const results = [];

    const promises = Array.from({ length: count }, (_, i) =>
      queue.enqueue(async () => {
        await delay(1);
        results.push(i);
        return i;
      })
    );

    const returnValues = await Promise.all(promises);

    assert.equal(returnValues.length, count);
    assert.deepEqual(results, Array.from({ length: count }, (_, i) => i));
  });
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
