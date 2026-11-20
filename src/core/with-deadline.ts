/** Shared "run a task under a wall-clock deadline" primitive. */

import { abortReason } from "@reasonix/core-utils";

export interface DeadlineSignal {
  /** Combined parent + deadline signal to hand to the work. */
  signal: AbortSignal;
  /** True once the deadline fired, as opposed to a parent abort. */
  timedOut: () => boolean;
  /** Raw timer, for callers that must clear at a specific point. Prefer cancel(). */
  timer: ReturnType<typeof setTimeout>;
  /** Clear the timer without aborting, for a caller whose signal stays live for a body read. */
  clearTimer: () => void;
  /** Clear the timer and abort the deadline branch. Safe to call more than once. */
  cancel: () => void;
}

/** One timer, one controller: the shape every request timeout in the codebase needs. */
export function deadlineSignal(
  deadlineMs: number,
  timeoutMessage: string,
  parentSignal?: AbortSignal,
): DeadlineSignal {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new Error(timeoutMessage));
  }, deadlineMs);
  return {
    signal: parentSignal ? AbortSignal.any([parentSignal, ctrl.signal]) : ctrl.signal,
    timedOut: () => timedOut,
    timer,
    clearTimer: () => clearTimeout(timer),
    cancel: () => {
      clearTimeout(timer);
      ctrl.abort();
    },
  };
}

// Run `task` under a wall-clock deadline. The deadline aborts its own
// AbortController (combined via AbortSignal.any) and rejects with
// `new Error(timeoutMessage)`; the timer always clears and the controller
// aborts on settle so no request work survives completion. A `parentSignal`
// abort rejects the deadline promise immediately — even when the task itself
// ignores the combined signal (e.g. it awaits an unrelated promise) — so a
// hung task is cut off by either the caller's abort or the deadline,
// whichever comes first.
export async function withDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  deadlineMs: number,
  timeoutMessage: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const deadline = deadlineSignal(deadlineMs, timeoutMessage, parentSignal);
  let onParentAbort: (() => void) | undefined;
  const deadlinePromise = new Promise<never>((_, reject) => {
    if (deadline.timedOut()) {
      reject(new Error(timeoutMessage));
      return;
    }
    deadline.signal.addEventListener(
      "abort",
      () => {
        if (deadline.timedOut()) reject(new Error(timeoutMessage));
      },
      { once: true },
    );
  });
  const parentAbortPromise =
    parentSignal !== undefined
      ? new Promise<never>((_, reject) => {
          if (parentSignal.aborted) {
            reject(abortReason(parentSignal));
            return;
          }
          onParentAbort = () => reject(abortReason(parentSignal));
          parentSignal.addEventListener("abort", onParentAbort, { once: true });
        })
      : null;
  try {
    const result = task(deadline.signal);
    return await Promise.race(
      parentAbortPromise
        ? [result, deadlinePromise, parentAbortPromise]
        : [result, deadlinePromise],
    );
  } catch (err) {
    // Whichever promise wins, preserve the terminal timeout identity instead of
    // misclassifying the abort as a transient provider drop.
    if (deadline.timedOut()) throw new Error(timeoutMessage);
    throw err;
  } finally {
    if (onParentAbort && parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
    deadline.cancel();
  }
}
