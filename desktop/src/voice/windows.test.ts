import { describe, expect, it } from "vitest";
import { CACTUS_MAX_SECONDS } from "./whistle-engine";
import {
  TRANSCRIBE_SAMPLE_RATE,
  TRANSCRIBE_WINDOW_SAMPLES,
  TRANSCRIBE_WINDOW_SECONDS,
  transcribeWindows,
  windowPosition,
  windowSecondsLabel,
} from "./windows";

describe("transcription windows", () => {
  it("stays within every engine's per-call limit", () => {
    expect(TRANSCRIBE_WINDOW_SECONDS).toBe(30);
    expect(TRANSCRIBE_WINDOW_SECONDS).toBeLessThanOrEqual(CACTUS_MAX_SECONDS);
    expect(TRANSCRIBE_WINDOW_SAMPLES).toBe(TRANSCRIBE_SAMPLE_RATE * TRANSCRIBE_WINDOW_SECONDS);
  });

  it("keeps a recording shorter than one window in a single window", () => {
    expect(transcribeWindows(TRANSCRIBE_WINDOW_SAMPLES - 1)).toEqual([
      { start: 0, end: TRANSCRIBE_WINDOW_SAMPLES - 1 },
    ]);
    expect(transcribeWindows(1)).toEqual([{ start: 0, end: 1 }]);
  });

  it("covers exactly one window of audio with one window", () => {
    expect(transcribeWindows(TRANSCRIBE_WINDOW_SAMPLES)).toEqual([
      { start: 0, end: TRANSCRIBE_WINDOW_SAMPLES },
    ]);
  });

  it("cuts a long recording into consecutive windows with a short tail", () => {
    const windows = transcribeWindows(TRANSCRIBE_SAMPLE_RATE * 61);
    expect(windows).toEqual([
      { start: 0, end: TRANSCRIBE_SAMPLE_RATE * 30 },
      { start: TRANSCRIBE_SAMPLE_RATE * 30, end: TRANSCRIBE_SAMPLE_RATE * 60 },
      { start: TRANSCRIBE_SAMPLE_RATE * 60, end: TRANSCRIBE_SAMPLE_RATE * 61 },
    ]);
  });

  it("never emits an empty trailing window at an exact multiple", () => {
    expect(transcribeWindows(TRANSCRIBE_SAMPLE_RATE * 60)).toHaveLength(2);
  });

  it("reports no window for an empty recording", () => {
    expect(transcribeWindows(0)).toEqual([]);
  });

  it("places a recording position inside its window", () => {
    expect(windowPosition(0)).toEqual({ window: 1, windowSeconds: 0, windowLengthSeconds: 30 });
    expect(windowPosition(29.9)).toEqual({
      window: 1,
      windowSeconds: 29.9,
      windowLengthSeconds: 30,
    });
    expect(windowPosition(30)).toEqual({ window: 2, windowSeconds: 0, windowLengthSeconds: 30 });
    expect(windowPosition(61.5)).toEqual({
      window: 3,
      windowSeconds: 1.5,
      windowLengthSeconds: 30,
    });
  });

  it("labels a window position with one decimal", () => {
    expect(windowSecondsLabel(0)).toBe("0.0s");
    expect(windowSecondsLabel(12.44)).toBe("12.4s");
    expect(windowSecondsLabel(-1)).toBe("0.0s");
  });
});
