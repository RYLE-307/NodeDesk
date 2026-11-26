/** Ordered, bounded async rendering. Reset invalidates even an in-flight decode. */
export function createFrameQueue(limit = 64, maxWeight = 128 * 1024 * 1024) {
  type Job = (current: () => boolean) => Promise<void> | void;
  let epoch = 0;
  let running = false;
  let weight = 0;
  const jobs: Array<{job: Job; epoch: number; weight: number}> = [];
  function reset() {
    epoch++;
    for (const job of jobs) weight -= job.weight;
    jobs.length = 0;
  }
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (jobs.length) {
        const next = jobs.shift()!;
        try {
          if (next.epoch === epoch) await next.job(() => next.epoch === epoch);
        } catch {
          if (next.epoch === epoch) reset();
        } finally {
          weight -= next.weight;
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    enqueue(job: Job, cost = 0): boolean {
      if (!Number.isSafeInteger(cost) || cost < 0 ||
          jobs.length + Number(running) >= limit || cost > maxWeight - weight) return false;
      jobs.push({job, epoch, weight: cost});
      weight += cost;
      void drain();
      return true;
    },
    reset,
  };
}
