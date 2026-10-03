import { describe, expect, it } from 'vitest';

import { CallPriority } from './priority.js';
import {
  PriorityScheduler,
  SchedulerAbortError,
  type SchedulerJob,
} from './scheduler.js';

/** A promise plus its resolve/reject, for driving jobs by hand. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let microtasks flush so dispatch/settle propagate. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('PriorityScheduler', () => {
  it('runs a single job and resolves with its result', async () => {
    const scheduler = new PriorityScheduler();
    const result = await scheduler.submit(async () => 42, {
      priority: CallPriority.Voice,
    });
    expect(result).toBe(42);
  });

  it('runs one job at a time at concurrency 1', async () => {
    const scheduler = new PriorityScheduler({ concurrency: 1 });
    const a = deferred<string>();
    const b = deferred<string>();

    const first = scheduler.submit(() => a.promise, {
      priority: CallPriority.Voice,
    });
    const second = scheduler.submit(() => b.promise, {
      priority: CallPriority.Voice,
    });
    await flush();

    expect(scheduler.activeCount).toBe(1);
    expect(scheduler.waitingCount).toBe(1);

    a.resolve('a');
    await expect(first).resolves.toBe('a');
    await flush();
    expect(scheduler.activeCount).toBe(1);

    b.resolve('b');
    await expect(second).resolves.toBe('b');
  });

  it('dispatches waiting jobs in priority order', async () => {
    const scheduler = new PriorityScheduler({ concurrency: 1 });
    const order: string[] = [];
    const blocker = deferred<void>();

    // Occupy the only slot.
    const held = scheduler.submit(() => blocker.promise, {
      priority: CallPriority.Voice,
    });
    await flush();

    // Submit lower then higher priority; higher must run first.
    const low = scheduler.submit(
      async () => {
        order.push('extraction');
      },
      { priority: CallPriority.Extraction },
    );
    const high = scheduler.submit(
      async () => {
        order.push('intent');
      },
      { priority: CallPriority.Intent },
    );

    blocker.resolve();
    await held;
    await Promise.all([low, high]);
    expect(order).toEqual(['intent', 'extraction']);
  });

  it('keeps FIFO order within a priority band', async () => {
    const scheduler = new PriorityScheduler({ concurrency: 1 });
    const order: number[] = [];
    const blocker = deferred<void>();
    const held = scheduler.submit(() => blocker.promise, {
      priority: CallPriority.Intent,
    });
    await flush();

    const jobs = [0, 1, 2].map((n) =>
      scheduler.submit(
        async () => {
          order.push(n);
        },
        { priority: CallPriority.Voice },
      ),
    );

    blocker.resolve();
    await held;
    await Promise.all(jobs);
    expect(order).toEqual([0, 1, 2]);
  });

  it('preempts a running preemptible job when a higher one waits', async () => {
    const scheduler = new PriorityScheduler({ concurrency: 1 });
    let aborted = false;

    const narration: SchedulerJob<string> = (signal) =>
      new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason);
        });
        // Otherwise never settles on its own.
      });

    const narrate = scheduler.submit(narration, {
      priority: CallPriority.Narrator,
      preemptible: true,
    });
    await flush();
    expect(scheduler.activeCount).toBe(1);

    // A higher-priority action arrives and reclaims the slot.
    const action = scheduler.submit(async () => 'acted', {
      priority: CallPriority.Voice,
    });

    await expect(narrate).rejects.toBeInstanceOf(SchedulerAbortError);
    expect(aborted).toBe(true);
    await expect(action).resolves.toBe('acted');
  });

  it('does not preempt a running non-preemptible job', async () => {
    const scheduler = new PriorityScheduler({ concurrency: 1 });
    const voice = deferred<string>();
    let aborted = false;

    const held = scheduler.submit(
      (signal) => {
        signal.addEventListener('abort', () => (aborted = true));
        return voice.promise;
      },
      { priority: CallPriority.Voice, preemptible: false },
    );
    await flush();

    const intent = scheduler.submit(async () => 'intent', {
      priority: CallPriority.Intent,
    });
    await flush();

    // The high-priority intent waits; the non-preemptible voice is untouched.
    expect(aborted).toBe(false);
    expect(scheduler.waitingCount).toBe(1);

    voice.resolve('voice');
    await expect(held).resolves.toBe('voice');
    await expect(intent).resolves.toBe('intent');
  });

  it('does not preempt when the waiting job is lower priority', async () => {
    const scheduler = new PriorityScheduler({ concurrency: 1 });
    let aborted = false;
    const narration: SchedulerJob<string> = (signal) =>
      new Promise<string>((resolve) => {
        signal.addEventListener('abort', () => (aborted = true));
        setTimeout(() => resolve('narrated'), 5);
      });

    const narrate = scheduler.submit(narration, {
      priority: CallPriority.Narrator,
      preemptible: true,
    });
    await flush();

    // Extraction is lower priority than the running narration: no preemption.
    const extract = scheduler.submit(async () => 'extracted', {
      priority: CallPriority.Extraction,
    });
    await flush();
    expect(aborted).toBe(false);

    await expect(narrate).resolves.toBe('narrated');
    await expect(extract).resolves.toBe('extracted');
  });

  it('surfaces a job rejection to its submitter', async () => {
    const scheduler = new PriorityScheduler();
    await expect(
      scheduler.submit(async () => {
        throw new Error('job failed');
      }, { priority: CallPriority.Voice }),
    ).rejects.toThrow('job failed');
  });
});
