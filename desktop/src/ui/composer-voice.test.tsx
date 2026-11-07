// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

let resolveTranscribe: ((res: { text: string }) => void) | null = null;

vi.mock("../voice/audio-recorder", () => {
  // A class mock must be implemented with `function`, not an arrow: the composer
  // constructs it with `new`, and vitest cannot construct an arrow implementation.
  const AudioRecorder = vi.fn(function () {
    return {
      recording: true,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue({ audioData: new Float32Array(100), durationSeconds: 1 }),
      cancel: vi.fn(),
    };
  });
  return { AudioRecorder };
});

vi.mock("../voice/transcriber", () => {
  return {
    speechTranscriber: {
      transcribe: vi.fn(
        (
          _audio: Float32Array,
          options?: { signal?: AbortSignal; onProgress?: (p: TranscribeProgress) => void },
        ) =>
          new Promise<{ text: string }>((resolve, reject) => {
            resolveTranscribe = resolve;
            const signal = options?.signal;
            if (!signal) return;
            const onAbort = () => {
              const err = new Error("Transcription cancelled.");
              err.name = "AbortError";
              reject(err);
            };
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
          }),
      ),
      reset: vi.fn(),
    },
  };
});

afterEach(cleanup);

import {
  AudioRecorder,
  type AudioRecorderOptions,
  type AudioRecordingProgress,
} from "../voice/audio-recorder";
import { type TranscribeProgress, speechTranscriber } from "../voice/transcriber";
import { Composer } from "./composer";
import { makeComposerBaseProps } from "./composer-test-fixtures";

const baseProps = makeComposerBaseProps();

describe("Composer Voice Input Button", () => {
  it("renders the voice input button with idle title", () => {
    render(<Composer {...baseProps} />);

    const voiceBtn = screen.getByTitle("Voice input");
    expect(voiceBtn).toBeTruthy();
    expect(voiceBtn.classList.contains("voice-btn")).toBe(true);
    expect(voiceBtn.classList.contains("recording")).toBe(false);
  });

  it("disables voice button when composer is disabled, but keeps it enabled when busy for queueing", async () => {
    const { rerender } = render(<Composer {...baseProps} disabled={true} />);
    let voiceBtn = screen.getByTitle("Voice input") as HTMLButtonElement;
    expect(voiceBtn.disabled).toBe(true);

    // When conversation is active (busy=true), voice input remains enabled so users can queue voice messages
    rerender(<Composer {...baseProps} busy={true} />);
    voiceBtn = screen.getByTitle("Voice input") as HTMLButtonElement;
    expect(voiceBtn.disabled).toBe(false);

    // Can start recording while busy
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    expect(voiceBtn.classList.contains("recording")).toBe(true);
  });

  it("reports microphone startup failures through the durable chat callback", async () => {
    const onVoiceError = vi.fn();
    vi.mocked(AudioRecorder).mockImplementationOnce(function () {
      return {
        recording: false,
        start: vi.fn().mockRejectedValue(new Error("name=NotAllowedError, message=Blocked")),
        stop: vi.fn(),
        cancel: vi.fn(),
      } as unknown as AudioRecorder;
    });
    render(<Composer {...baseProps} onVoiceError={onVoiceError} />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Voice input"));
    });

    expect(onVoiceError).toHaveBeenCalledWith(
      "Voice input failed during microphone startup: name=NotAllowedError, message=Blocked",
    );
  });

  it("reports an empty recognizer result through the durable chat callback", async () => {
    const onVoiceError = vi.fn();
    vi.mocked(speechTranscriber.transcribe).mockResolvedValueOnce({ text: "" });
    render(<Composer {...baseProps} onVoiceError={onVoiceError} />);

    const voiceButton = screen.getByTitle("Voice input");
    await act(async () => {
      fireEvent.click(voiceButton);
    });
    await act(async () => {
      fireEvent.click(voiceButton);
    });

    expect(onVoiceError).toHaveBeenCalledWith(
      "Voice input failed during transcription: The speech recognizer returned no transcript.",
    );
  });

  it("shows the transcribing throbber even while the chat is busy (queueing)", async () => {
    render(<Composer {...baseProps} busy={true} />);

    const voiceBtn = screen.getByTitle("Voice input") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    expect(voiceBtn.classList.contains("transcribing")).toBe(true);
    const throbber = voiceBtn.querySelector(".voice-throbber");
    expect(throbber).toBeTruthy();
  });

  it("shows circular throbber as processing indicator when finished talking and transcribing", async () => {
    render(<Composer {...baseProps} />);

    const voiceBtn = screen.getByTitle("Voice input") as HTMLButtonElement;
    expect(voiceBtn.querySelector(".voice-throbber")).toBeNull();

    // Start recording
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    expect(voiceBtn.classList.contains("recording")).toBe(true);

    // Stop recording (finished talking) -> enters transcribing state
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    expect(voiceBtn.classList.contains("transcribing")).toBe(true);
    expect(voiceBtn.disabled).toBe(false);
    expect(voiceBtn.getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getByTitle("Transcribing, window 1 of 1, 0.0s / 1.0s. Click to cancel"),
    ).toBeTruthy();

    const throbber = voiceBtn.querySelector(".voice-throbber");
    expect(throbber).toBeTruthy();
    expect(throbber?.classList.contains("spin")).toBe(true);
    expect(throbber?.classList.contains("processing-indicator")).toBe(true);
    expect(throbber?.getAttribute("role")).toBe("status");
    expect(throbber?.getAttribute("aria-label")).toBe("Transcribing audio...");

    // Complete transcription
    await act(async () => {
      if (resolveTranscribe) {
        resolveTranscribe({ text: "testing audio transcription" });
      }
    });

    expect(voiceBtn.classList.contains("transcribing")).toBe(false);
    expect(voiceBtn.getAttribute("aria-busy")).toBe("false");
    expect(voiceBtn.querySelector(".voice-throbber")).toBeNull();
  });

  it("cancels an in-flight transcription when the voice button is clicked again", async () => {
    const onVoiceError = vi.fn();
    render(<Composer {...baseProps} onVoiceError={onVoiceError} />);
    const voiceBtn = screen.getByTitle("Voice input") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    expect(voiceBtn.classList.contains("transcribing")).toBe(true);

    // A click while transcribing cancels.
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    expect(voiceBtn.classList.contains("transcribing")).toBe(false);
    expect(voiceBtn.querySelector(".voice-throbber")).toBeNull();
    expect(screen.getByTitle("Voice input")).toBeTruthy();
    // A user-initiated cancel is silent: no durable error.
    expect(onVoiceError).not.toHaveBeenCalled();
  });

  it("times out a stuck model load, recovers, and reports a durable error", async () => {
    vi.mocked(speechTranscriber.reset).mockClear();
    vi.useFakeTimers();
    const onVoiceError = vi.fn();
    try {
      render(<Composer {...baseProps} onVoiceError={onVoiceError} />);
      const voiceBtn = screen.getByTitle("Voice input") as HTMLButtonElement;

      await act(async () => {
        fireEvent.click(voiceBtn);
      });
      await act(async () => {
        fireEvent.click(voiceBtn);
      });
      expect(voiceBtn.classList.contains("transcribing")).toBe(true);

      // A load gets the init budget: the host's 300 s load plus one generation.
      await act(async () => {
        vi.advanceTimersByTime(420_000);
      });
      await act(async () => {});

      expect(voiceBtn.classList.contains("transcribing")).toBe(false);
      expect(speechTranscriber.reset).toHaveBeenCalledTimes(1);
      expect(onVoiceError).toHaveBeenCalledWith(
        expect.stringContaining("speech model did not finish loading within 420 seconds"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a window that never finishes, naming it", async () => {
    vi.mocked(speechTranscriber.reset).mockClear();
    vi.useFakeTimers();
    const onVoiceError = vi.fn();
    try {
      vi.mocked(speechTranscriber.transcribe).mockImplementationOnce(
        (_audio, options) =>
          new Promise((_resolve, reject) => {
            // Reports a window, then never settles: the per-window budget runs out.
            options?.onProgress?.({
              status: "transcribing",
              window: {
                window: 2,
                windows: 3,
                windowSeconds: 0,
                windowLengthSeconds: 30,
                processedSeconds: 30,
                totalSeconds: 61,
                decodeMs: 0,
              },
            });
            options?.signal?.addEventListener("abort", () => {
              const err = new Error("Transcription cancelled.");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );
      render(<Composer {...baseProps} onVoiceError={onVoiceError} />);
      const voiceBtn = screen.getByTitle("Voice input") as HTMLButtonElement;

      await act(async () => {
        fireEvent.click(voiceBtn);
      });
      await act(async () => {
        fireEvent.click(voiceBtn);
      });

      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });
      await act(async () => {});

      expect(voiceBtn.classList.contains("transcribing")).toBe(false);
      expect(onVoiceError).toHaveBeenCalledWith(
        expect.stringContaining("No window finished within 120 seconds in window 2 of 3"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the live window and its position while recording", async () => {
    let emit: ((progress: AudioRecordingProgress) => void) | null = null;
    vi.mocked(AudioRecorder).mockImplementationOnce(function (options?: AudioRecorderOptions) {
      emit = options?.onProgress ?? null;
      return {
        recording: true,
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        cancel: vi.fn(),
      } as unknown as AudioRecorder;
    });
    render(<Composer {...baseProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Voice input"));
    });
    expect(screen.getByText("Recording, window 1, 0.0s / 30.0s")).toBeTruthy();

    await act(async () => {
      emit?.({ seconds: 64.2, window: 3, windowSeconds: 4.2, windowLengthSeconds: 30 });
    });
    expect(screen.getByText("Recording, window 3, 4.2s / 30.0s")).toBeTruthy();
  });

  it("shows which window is decoding and the time inside it", async () => {
    vi.mocked(speechTranscriber.transcribe).mockImplementationOnce(() => new Promise(() => {}));
    render(<Composer {...baseProps} />);

    const voiceBtn = screen.getByTitle("Voice input");
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    // The recording is one second long, so it is one window, seeded before the
    // first engine call reports.
    expect(screen.getByText("Transcribing, window 1 of 1, 0.0s / 1.0s")).toBeTruthy();
  });

  it("reports the window the transcriber advanced to", async () => {
    let report: ((progress: TranscribeProgress) => void) | null = null;
    let finish: (() => void) | null = null;
    vi.mocked(speechTranscriber.transcribe).mockImplementationOnce(
      (_audio, options) =>
        new Promise((resolve) => {
          report = options?.onProgress ?? null;
          finish = () => resolve({ text: "hello" });
        }),
    );
    render(<Composer {...baseProps} />);

    const voiceBtn = screen.getByTitle("Voice input");
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    await act(async () => {
      report?.({
        status: "transcribing",
        window: {
          window: 2,
          windows: 3,
          windowSeconds: 0,
          windowLengthSeconds: 30,
          processedSeconds: 30,
          totalSeconds: 61,
          decodeMs: 1200,
        },
      });
    });

    expect(screen.getByText("Transcribing, window 2 of 3, 0.0s / 30.0s")).toBeTruthy();
    expect(screen.getByText("1.2s elapsed")).toBeTruthy();

    await act(async () => {
      finish?.();
    });
    expect(voiceBtn.classList.contains("transcribing")).toBe(false);
  });

  it("reports a failed window through the durable chat callback", async () => {
    const onVoiceError = vi.fn();
    const onVoiceEvent = vi.fn();
    vi.mocked(speechTranscriber.transcribe).mockRejectedValueOnce(
      new Error("Transcription failed in window 2 of 3 (name=Error, message=decoder crashed)."),
    );
    render(<Composer {...baseProps} onVoiceError={onVoiceError} onVoiceEvent={onVoiceEvent} />);

    const voiceBtn = screen.getByTitle("Voice input");
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    expect(onVoiceError).toHaveBeenCalledWith(
      "Voice input failed during transcription: Transcription failed in window 2 of 3 (name=Error, message=decoder crashed).",
    );
    const settled = onVoiceEvent.mock.calls.map(([event]) => event).at(-1);
    expect(settled?.outcome).toBe("failed");
    expect(settled?.result).toContain("decoder crashed");
  });

  it("records a whole run in Events without touching the transcript", async () => {
    const onVoiceEvent = vi.fn();
    vi.mocked(speechTranscriber.transcribe).mockResolvedValueOnce({ text: "hello" });
    render(<Composer {...baseProps} onVoiceEvent={onVoiceEvent} />);

    const voiceBtn = screen.getByTitle("Voice input");
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    const records = onVoiceEvent.mock.calls.map(([event]) => event);
    expect(records[0]?.type).toBe("voice");
    expect(records[0]?.outcome).toBe("started");
    const settled = records.at(-1);
    expect(settled?.id).toBe(records[0]?.id);
    expect(settled?.outcome).toBe("done");
    expect(settled?.steps?.join(" ")).toContain("microphone open");
    expect(settled?.result).toContain("5 characters");
  });

  it("settles a cancelled run as cancelled and keeps the chat silent", async () => {
    const onVoiceError = vi.fn();
    const onVoiceEvent = vi.fn();
    render(<Composer {...baseProps} onVoiceError={onVoiceError} onVoiceEvent={onVoiceEvent} />);

    const voiceBtn = screen.getByTitle("Voice input");
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    await act(async () => {
      fireEvent.click(voiceBtn);
    });
    await act(async () => {
      fireEvent.click(voiceBtn);
    });

    expect(onVoiceError).not.toHaveBeenCalled();
    const settled = onVoiceEvent.mock.calls.map(([event]) => event).at(-1);
    expect(settled?.outcome).toBe("cancel");
  });
});
