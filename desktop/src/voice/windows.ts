/**
 * Fixed transcription windows.
 *
 * Every engine decodes at most 30 s of audio per call: Whisper's feature
 * extractor truncates anything longer to its first 30 s clip, and the Cactus
 * engine rejects it. A recording is therefore cut into consecutive windows of
 * this length, and each engine only ever receives one window at a time.
 */

/** Rate the recorder delivers and every engine expects. */
export const TRANSCRIBE_SAMPLE_RATE = 16000;

/** Length of one transcription window in seconds. */
export const TRANSCRIBE_WINDOW_SECONDS = 30;

/** Length of one transcription window in samples. */
export const TRANSCRIBE_WINDOW_SAMPLES = TRANSCRIBE_SAMPLE_RATE * TRANSCRIBE_WINDOW_SECONDS;

/** One window of a recording, as sample offsets into the whole buffer. */
export interface TranscribeWindow {
  /** Offset of the window's first sample. */
  start: number;
  /** Offset one past the window's last sample. */
  end: number;
}

/** Consecutive windows covering `totalSamples`; only the last one may be shorter. */
export function transcribeWindows(totalSamples: number): TranscribeWindow[] {
  const windows: TranscribeWindow[] = [];
  for (let start = 0; start < totalSamples; start += TRANSCRIBE_WINDOW_SAMPLES) {
    windows.push({ start, end: Math.min(start + TRANSCRIBE_WINDOW_SAMPLES, totalSamples) });
  }
  return windows;
}

/** Where a recording of `seconds` sits among its windows. */
export interface WindowPosition {
  /** 1-based window holding that moment. */
  window: number;
  /** Seconds inside that window. */
  windowSeconds: number;
  /** Length of that window; the last one is only measured once the recording ends. */
  windowLengthSeconds: number;
}

/** Position of `seconds` of recorded audio inside its window. */
export function windowPosition(seconds: number): WindowPosition {
  const index = Math.max(0, Math.floor(seconds / TRANSCRIBE_WINDOW_SECONDS));
  return {
    window: index + 1,
    windowSeconds: seconds - index * TRANSCRIBE_WINDOW_SECONDS,
    windowLengthSeconds: TRANSCRIBE_WINDOW_SECONDS,
  };
}

/** One-decimal seconds for the window readout ("12.4s"), matching the card durations. */
export function windowSecondsLabel(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(1)}s`;
}
