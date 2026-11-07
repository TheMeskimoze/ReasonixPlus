/**
 * Proof of one voice run, shaped as one Events row.
 *
 * A run is a microphone open, a model that may load or decode first, and one or
 * more 30 s windows turned into text. Recording every step with its measured
 * duration is what makes a cold boot, a cache read, a retry or a crash
 * reviewable after the fact, without putting any of it in the transcript.
 */

import type { SessionEventRecord } from "../protocol";
import { formatDuration } from "../ui/format";

/** The row a trace produces: everything but the parts App fills in. */
export type VoiceTraceRecord = Omit<SessionEventRecord, "ts" | "turn">;

export type VoiceRunOutcome = "started" | "done" | "failed" | "cancel";

/** How the model answered: a first load, or one already in memory. */
export type VoiceBootKind = "cold" | "warm";

/** One measured step, in the order it ran. */
export interface VoiceTraceStep {
  name: string;
  ms: number;
  detail?: string;
}

/** What identifies the run: the row id plus the model and engine it used. */
export interface VoiceRunFacts {
  /** Stable id: one row per run, so a settle refines the row a start wrote. */
  id: string;
  /** Display name shown as the row's label. */
  model: string;
  /** Persisted model id, kept in the detail line for a bug report. */
  modelId: string;
  engine: string;
}

const BOOT_LABEL: Record<VoiceBootKind, string> = {
  cold: "cold boot",
  warm: "warm start",
};

function elapsed(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A run's running record: steps, facts and the totals its result line needs. */
export class VoiceTrace {
  private readonly recorded: VoiceTraceStep[] = [];
  /** Extra summary fields, in insertion order (`device=wasm`, `cache=hit`, ...). */
  private readonly summary = new Map<string, string>();
  private bootKind: VoiceBootKind | null = null;
  private audioSeconds: number | null = null;
  private windowCount: number | null = null;
  private retries = 0;
  private characters: number | null = null;
  private decodeMs: number | null = null;
  private error: string | null = null;
  private readonly startedAt = elapsed();

  constructor(private readonly run: VoiceRunFacts) {}

  /** The row this run writes, so a caller can settle a row it started. */
  get id(): string {
    return this.run.id;
  }

  get steps(): readonly VoiceTraceStep[] {
    return this.recorded;
  }

  /** The first boot report wins: a run is cold only if its model had to load. */
  boot(kind: VoiceBootKind): void {
    if (this.bootKind === null) this.bootKind = kind;
  }

  audio(seconds: number): void {
    this.audioSeconds = seconds;
  }

  windows(count: number): void {
    this.windowCount = count;
  }

  retried(times = 1): void {
    this.retries += times;
  }

  result(characters: number): void {
    this.characters = characters;
  }

  decoded(ms: number): void {
    this.decodeMs = ms;
  }

  fact(name: string, value: string | number): void {
    this.summary.set(name, String(value));
  }

  failed(error: unknown): void {
    this.error = error instanceof Error ? error.message : String(error);
  }

  /** Record a step that already finished, e.g. a value only the engine knows. */
  mark(name: string, ms: number, detail?: string): void {
    this.recorded.push({ name, ms: Math.max(0, ms), ...(detail ? { detail } : {}) });
  }

  /** Run one step and record how long it took, even when it throws. */
  async step<T>(
    name: string,
    work: () => T | Promise<T>,
    describe?: (value: T) => string | undefined,
  ): Promise<T> {
    const startedAt = elapsed();
    try {
      const value = await work();
      this.mark(name, elapsed() - startedAt, describe?.(value));
      return value;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.mark(name, elapsed() - startedAt, `failed: ${reason}`);
      throw error;
    }
  }

  /** This run as an Events row; `ts` and `turn` are App's to fill in. */
  record(outcome: VoiceRunOutcome): VoiceTraceRecord {
    const boot = this.bootKind ? `, ${BOOT_LABEL[this.bootKind]}` : "";
    const detail = [`model=${this.run.modelId}`, `engine=${this.run.engine}`]
      .concat([...this.summary].map(([name, value]) => `${name}=${value}`))
      .join(" ");
    const steps = this.recorded.map((step) => {
      const timing = formatDuration(step.ms);
      return step.detail ? `${step.name}: ${timing}, ${step.detail}` : `${step.name}: ${timing}`;
    });
    const result = this.resultLine(outcome);
    return {
      id: this.run.id,
      type: "voice",
      outcome,
      label: `${this.run.model}${boot}`,
      detail,
      ...(steps.length > 0 ? { steps } : {}),
      ...(result ? { result } : {}),
    };
  }

  private resultLine(outcome: VoiceRunOutcome): string | undefined {
    if (outcome === "started") return undefined;
    if (outcome === "failed") return `failed: ${this.error ?? "no error detail reported"}`;
    const parts: string[] = [];
    if (this.windowCount !== null) parts.push(count(this.windowCount, "window", "windows"));
    if (this.audioSeconds !== null) parts.push(`${this.audioSeconds.toFixed(1)}s audio`);
    if (this.decodeMs !== null) parts.push(`transcribed in ${formatDuration(this.decodeMs)}`);
    if (this.retries > 0) parts.push(count(this.retries, "retry", "retries"));
    if (this.characters !== null) {
      parts.push(count(this.characters, "character", "characters"));
    }
    if (outcome === "cancel") parts.push("cancelled");
    if (parts.length === 0) parts.push(`ended after ${formatDuration(elapsed() - this.startedAt)}`);
    return parts.join(", ");
  }
}
