/**
 * The priority scheduler (design "LLM Gateway": "Interactive calls run in the
 * order intent → voice → narrator → extraction").
 *
 * The Gateway runs against a single local endpoint that serves one model line
 * at a time, so concurrent calls contend for a small number of slots. This
 * scheduler is that gate: callers {@link PriorityScheduler.submit} a job with a
 * {@link CallPriority}, and the scheduler dispatches jobs in priority order up
 * to a concurrency limit. When a slot frees, the highest-priority waiting job
 * runs next; ties keep submission order (FIFO within a band), so same-band work
 * stays fair.
 *
 * **Preemption.** When a higher-priority job is waiting and the only thing
 * holding a slot is a lower-priority, preemptible job, the scheduler cancels
 * that running job to free the slot. The narrator submits its job as
 * preemptible (design: "A narrator call is cancelled if the player issues the
 * next action before its first sentence"), so an incoming intent or voice call
 * reclaims the slot from an in-flight narration that has not yet committed to a
 * sentence. A job is cancelled through the {@link AbortSignal} handed to it, so
 * the work it wraps decides what cancellation means (the narrator stops its
 * stream); the scheduler only frees the slot once the job settles.
 *
 * The scheduler is transport-agnostic: a job is any function from an
 * {@link AbortSignal} to a promise. Retry/fallback and the actual model call
 * compose on top of it.
 */

import { CallPriority } from './priority.js';

/** The reason a scheduled job's signal was aborted. */
export class SchedulerAbortError extends Error {
  constructor(message = 'scheduled job was preempted') {
    super(message);
    this.name = 'SchedulerAbortError';
  }
}

/** A unit of work the scheduler runs once a slot is free. */
export type SchedulerJob<T> = (signal: AbortSignal) => Promise<T>;

/** Options for a single {@link PriorityScheduler.submit}. */
export interface SubmitOptions {
  /** The job's priority band. Lower bands run and preempt ahead of higher. */
  readonly priority: CallPriority;
  /**
   * Whether a waiting higher-priority job may cancel this one to take its slot.
   * The narrator sets this so its call yields the slot to a new action; the
   * interactive reply and intent calls leave it false so they are never cut off
   * mid-flight.
   */
  readonly preemptible?: boolean;
}

/** Options for constructing a {@link PriorityScheduler}. */
export interface SchedulerOptions {
  /**
   * How many jobs may run at once. The local endpoint serves one model line, so
   * the default is 1: calls run strictly in priority order, one at a time.
   */
  readonly concurrency?: number;
}

/** Internal bookkeeping for one submitted-but-not-finished job. */
interface Entry<T> {
  readonly priority: CallPriority;
  readonly preemptible: boolean;
  /** Monotonic submission index, for FIFO tie-breaking within a band. */
  readonly seq: number;
  readonly job: SchedulerJob<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  /** Set once the entry is dispatched; aborting it preempts the running job. */
  controller?: AbortController;
}

/**
 * A priority-ordered dispatcher with a fixed concurrency limit and preemption
 * of lower-priority preemptible jobs. One instance guards the Gateway's calls.
 */
export class PriorityScheduler {
  private readonly concurrency: number;
  private readonly waiting: Entry<unknown>[] = [];
  private readonly running = new Set<Entry<unknown>>();
  private seq = 0;

  constructor(options: SchedulerOptions = {}) {
    this.concurrency = options.concurrency ?? 1;
  }

  /** How many jobs are running right now. Exposed for tests and metrics. */
  get activeCount(): number {
    return this.running.size;
  }

  /** How many jobs are waiting for a slot. Exposed for tests and metrics. */
  get waitingCount(): number {
    return this.waiting.length;
  }

  /**
   * Submit a job. It resolves with the job's result, or rejects with the job's
   * error. If the job is preempted before it settles, its signal aborts and the
   * promise rejects with whatever the job throws for that abort (commonly a
   * {@link SchedulerAbortError} the job surfaces). The returned promise lets the
   * caller await the scheduled work as if it had called the job directly.
   */
  submit<T>(job: SchedulerJob<T>, options: SubmitOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: Entry<T> = {
        priority: options.priority,
        preemptible: options.preemptible ?? false,
        seq: this.seq++,
        job,
        resolve,
        reject,
      };
      this.waiting.push(entry as Entry<unknown>);
      this.pump();
    });
  }

  /**
   * Drive the queue: fill free slots with the highest-priority waiting jobs,
   * and when no slot is free but a waiting job outranks a running preemptible
   * job, cancel that running job to make room. Called after every submit and
   * every settle, so the queue always converges to the right dispatch.
   */
  private pump(): void {
    // Fill any genuinely free slots first.
    while (this.running.size < this.concurrency && this.waiting.length > 0) {
      this.dispatch(this.takeNextWaiting());
    }

    // No free slot: see if the best waiting job should preempt a running one.
    if (this.waiting.length === 0 || this.running.size < this.concurrency) {
      return;
    }
    const next = this.peekNextWaiting();
    if (next === undefined) {
      return;
    }
    const victim = this.lowestPreemptibleRunning();
    if (victim !== undefined && victim.priority > next.priority) {
      // Abort the victim; its settle handler frees the slot and re-pumps.
      victim.controller?.abort(new SchedulerAbortError());
    }
  }

  /** Remove and return the highest-priority waiting entry (FIFO within band). */
  private takeNextWaiting(): Entry<unknown> {
    const index = this.bestWaitingIndex();
    const [entry] = this.waiting.splice(index, 1);
    return entry;
  }

  /** The highest-priority waiting entry without removing it. */
  private peekNextWaiting(): Entry<unknown> | undefined {
    if (this.waiting.length === 0) {
      return undefined;
    }
    return this.waiting[this.bestWaitingIndex()];
  }

  /** Index of the highest-priority waiting entry, ties broken by submission. */
  private bestWaitingIndex(): number {
    let best = 0;
    for (let i = 1; i < this.waiting.length; i++) {
      const a = this.waiting[i];
      const b = this.waiting[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) {
        best = i;
      }
    }
    return best;
  }

  /**
   * The running preemptible entry with the lowest priority (largest rank), the
   * best candidate to give up its slot. Returns undefined if none is
   * preemptible.
   */
  private lowestPreemptibleRunning(): Entry<unknown> | undefined {
    let victim: Entry<unknown> | undefined;
    for (const entry of this.running) {
      if (!entry.preemptible) {
        continue;
      }
      if (victim === undefined || entry.priority > victim.priority) {
        victim = entry;
      }
    }
    return victim;
  }

  /** Start an entry: give it a signal, run it, and settle its promise. */
  private dispatch(entry: Entry<unknown>): void {
    const controller = new AbortController();
    entry.controller = controller;
    this.running.add(entry);

    void (async () => {
      try {
        const value = await entry.job(controller.signal);
        entry.resolve(value);
      } catch (err) {
        entry.reject(err);
      } finally {
        this.running.delete(entry);
        this.pump();
      }
    })();
  }
}
