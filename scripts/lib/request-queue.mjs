export function createRequestQueue() {
  let pending = Promise.resolve();
  let activeCount = 0;

  function enqueue(fn) {
    activeCount++;
    const next = pending.then(() => fn()).finally(() => {
      activeCount--;
    });
    pending = next.catch(() => {});
    return next;
  }

  function getActiveCount() {
    return activeCount;
  }

  return { enqueue, getActiveCount };
}

const globalQueue = createRequestQueue();

export { globalQueue };
