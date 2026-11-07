// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPipeline = vi.fn();
const mockEnv = {
  allowRemoteModels: false,
  allowLocalModels: true,
  backends: {
    onnx: {
      logLevel: "info",
      wasm: {
        wasmPaths: "",
        proxy: true,
      },
    },
  },
};

vi.mock("@huggingface/transformers", () => ({
  pipeline: (...args: unknown[]) => mockPipeline(...args),
  env: mockEnv,
}));

import { isWebGPUSupported, speechTranscriber, suppressOnnxOptimizerNoise } from "./transcriber";

describe("LocalSpeechTranscriber", () => {
  beforeEach(() => {
    localStorage.clear();
    mockPipeline.mockReset();
    mockEnv.backends.onnx.wasm.proxy = true;
    mockEnv.backends.onnx.wasm.wasmPaths = "";
    speechTranscriber.reset();
    speechTranscriber.setModel("Xenova/whisper-base.en");
    speechTranscriber.setModel("whisper-tiny.en");
  });

  it("initializes with idle status and default tiny model", () => {
    expect(speechTranscriber.status).toBe("idle");
    expect(speechTranscriber.activeModel).toBe("whisper-tiny.en");
  });

  it("updates active model via setModel", () => {
    speechTranscriber.setModel("Xenova/whisper-base.en");
    expect(speechTranscriber.activeModel).toBe("Xenova/whisper-base.en");
    expect(localStorage.getItem("reasonix.voiceModel")).toBe("Xenova/whisper-base.en");
  });

  it("reports when no microphone audio was captured", async () => {
    await expect(speechTranscriber.transcribe(new Float32Array(0))).rejects.toThrow(
      "No microphone audio was captured.",
    );
  });

  it("reports the captured duration when audio is shorter than 200 ms", async () => {
    await expect(speechTranscriber.transcribe(new Float32Array(1600))).rejects.toThrow(
      "Recording was too short to transcribe (100 ms captured; minimum is 200 ms).",
    );
  });

  it("omits task and language options for English-only models during transcribe", async () => {
    const fakePipe = vi.fn().mockResolvedValue({ text: "Recognized text" });
    mockPipeline.mockResolvedValueOnce(fakePipe);

    speechTranscriber.setModel("whisper-tiny.en");
    const dummyAudio = new Float32Array(16000);
    const result = await speechTranscriber.transcribe(dummyAudio);

    expect(result.text).toBe("Recognized text");
    expect(fakePipe).toHaveBeenCalledWith(dummyAudio, {
      return_timestamps: false,
    });
  });

  it("transcribes a recording longer than 30 s as consecutive 30 s windows", async () => {
    // Whisper's feature extractor slices anything past its 30 s clip, so the
    // pipeline must never see more than one window at a time.
    const fakePipe = vi.fn().mockImplementation(async () => ({ text: "window text" }));
    mockPipeline.mockResolvedValueOnce(fakePipe);
    speechTranscriber.setModel("whisper-tiny.en");

    const result = await speechTranscriber.transcribe(new Float32Array(16000 * 61));

    expect(fakePipe).toHaveBeenCalledTimes(3);
    expect(fakePipe.mock.calls.map(([window]) => window.length)).toEqual([
      16000 * 30,
      16000 * 30,
      16000 * 1,
    ]);
    expect(result.text).toBe("window text window text window text");
  });

  it("reports the window counter and the position inside the recording", async () => {
    const fakePipe = vi.fn().mockResolvedValue({ text: "ok" });
    mockPipeline.mockResolvedValueOnce(fakePipe);
    speechTranscriber.setModel("whisper-tiny.en");

    const windows: Array<Record<string, number>> = [];
    await speechTranscriber.transcribe(new Float32Array(16000 * 45), {
      onProgress: (progress) => {
        if (progress.window) windows.push(progress.window as unknown as Record<string, number>);
      },
    });

    expect(windows.length).toBeGreaterThan(0);
    for (const report of windows) {
      expect(report.windows).toBe(2);
      expect(report.totalSeconds).toBeCloseTo(45, 5);
      expect(report.windowLengthSeconds).toBeLessThanOrEqual(30);
      expect(report.windowSeconds).toBeGreaterThanOrEqual(0);
      expect(report.processedSeconds).toBeLessThanOrEqual(45);
    }
    // Window 1 completes with its whole 30 s, window 2 holds the remaining 15 s.
    expect(windows.some((report) => report.window === 1 && report.windowSeconds === 30)).toBe(true);
    expect(
      windows.some(
        (report) =>
          report.window === 2 &&
          report.windowLengthSeconds === 15 &&
          report.windowSeconds === 15 &&
          report.processedSeconds === 45,
      ),
    ).toBe(true);
  });

  it("names the window that failed", async () => {
    const fakePipe = vi
      .fn()
      .mockResolvedValueOnce({ text: "first" })
      .mockRejectedValueOnce(new Error("decoder crashed"));
    mockPipeline.mockResolvedValueOnce(fakePipe);
    speechTranscriber.setModel("whisper-tiny.en");

    await expect(speechTranscriber.transcribe(new Float32Array(16000 * 45))).rejects.toThrow(
      /Transcription failed in window 2 of 2 .*decoder crashed/,
    );
    expect(speechTranscriber.status).toBe("error");
  });

  it("treats a silent window as silence and keeps the spoken ones", async () => {
    const fakePipe = vi
      .fn()
      .mockResolvedValueOnce({ text: "  " })
      .mockResolvedValueOnce({ text: " later words " });
    mockPipeline.mockResolvedValueOnce(fakePipe);
    speechTranscriber.setModel("whisper-tiny.en");

    const result = await speechTranscriber.transcribe(new Float32Array(16000 * 45));

    expect(result.text).toBe("later words");
    expect(fakePipe).toHaveBeenCalledTimes(2);
  });

  it("fails only when every window is silent", async () => {
    const fakePipe = vi.fn().mockResolvedValue({ text: "" });
    mockPipeline.mockResolvedValueOnce(fakePipe);
    speechTranscriber.setModel("whisper-tiny.en");

    await expect(speechTranscriber.transcribe(new Float32Array(16000 * 45))).rejects.toThrow(
      /No speech was recognized/,
    );
  });

  it("configures transformers env with proxy=false and loads using repoId", async () => {
    const fakePipe = vi.fn().mockResolvedValue({ text: "Hello world" });
    mockPipeline.mockResolvedValueOnce(fakePipe);

    const pipe = await speechTranscriber.getPipeline("whisper-tiny.en");
    expect(pipe).toBe(fakePipe);

    expect(mockEnv.backends.onnx.wasm.proxy).toBe(false);
    expect(mockEnv.backends.onnx.wasm.wasmPaths).toBe("/wasm/");
    expect(mockEnv.allowRemoteModels).toBe(true);
    expect(mockEnv.allowLocalModels).toBe(false);

    expect(mockPipeline).toHaveBeenCalledWith(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny.en",
      { device: "wasm", dtype: "q8" },
    );
  });

  it("passes repoId when downloading model", async () => {
    const fakePipe = vi.fn();
    mockPipeline.mockResolvedValueOnce(fakePipe);

    await speechTranscriber.downloadModel("Xenova/whisper-small.en");

    expect(mockEnv.backends.onnx.wasm.proxy).toBe(false);
    expect(mockPipeline).toHaveBeenCalledWith(
      "automatic-speech-recognition",
      "onnx-community/whisper-small.en",
      expect.objectContaining({ device: "wasm", dtype: "q8" }),
    );
  });

  it("selects webgpu device when GPU adapter is available", async () => {
    const fakePipe = vi.fn().mockResolvedValue({ text: "GPU output" });
    mockPipeline.mockResolvedValueOnce(fakePipe);

    const originalGpu = (navigator as unknown as { gpu?: unknown }).gpu;
    try {
      Object.defineProperty(navigator, "gpu", {
        value: {
          requestAdapter: vi.fn().mockResolvedValue({}),
        },
        configurable: true,
      });

      expect(await isWebGPUSupported()).toBe(true);

      speechTranscriber.setModel("Xenova/whisper-base.en");
      await speechTranscriber.getPipeline("Xenova/whisper-base.en");

      expect(mockPipeline).toHaveBeenCalledWith(
        "automatic-speech-recognition",
        "onnx-community/whisper-base.en",
        {
          device: "webgpu",
          dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        },
      );
    } finally {
      Object.defineProperty(navigator, "gpu", {
        value: originalGpu,
        configurable: true,
      });
    }
  });

  it("suppresses ONNX Runtime graph optimizer noise while preserving real warnings", () => {
    const originalWarn = console.warn;
    const originalError = console.error;
    const warnSpy = vi.fn();
    const errorSpy = vi.fn();
    console.warn = warnSpy;
    console.error = errorSpy;

    suppressOnnxOptimizerNoise();

    // ONNX optimizer and EP assignment noise should be dropped from warn and error:
    console.warn(
      "2026-09-05 00:04:11.843900 [W:onnxruntime:, graph.cc:3490 CleanUnusedInitializersAndNodeArgs] Removing initializer '/model/decoder/layers.8/encoder_attn_layer_norm/Constant_1_output_0'. It is not used by any node and should be removed from the model.",
    );
    console.warn(
      "2026-09-05 00:44:21.507599 [W:onnxruntime:, session_state.cc:1280 VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the preferred execution providers which may or may not have an negative impact on performance.",
    );
    console.warn(
      "Unable to determine content-length from response headers. Will expand buffer when needed.",
    );
    console.error(
      "2026-09-05 04:04:01.164499 [W:onnxruntime:, session_state.cc:1280 VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the preferred execution providers which may or may not have an negative impact on performance.",
    );
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    // Legitimate warnings and errors should still be emitted:
    console.warn("User microphone input is clipping.");
    console.error("Audio decoding failed.");
    expect(warnSpy).toHaveBeenCalledWith("User microphone input is clipping.");
    expect(errorSpy).toHaveBeenCalledWith("Audio decoding failed.");

    console.warn = originalWarn;
    console.error = originalError;
  });

  it("aborts an in-flight transcription and returns to idle", async () => {
    mockPipeline.mockReturnValueOnce(new Promise(() => {})); // pipeline() hangs during load
    const controller = new AbortController();
    const promise = speechTranscriber.transcribe(new Float32Array(16000), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(speechTranscriber.status).toBe("idle");
  });

  it("reset() drops the cached pipeline so the next load rebuilds it", async () => {
    mockPipeline.mockResolvedValueOnce(vi.fn());
    await speechTranscriber.getPipeline("whisper-tiny.en");
    expect(mockPipeline).toHaveBeenCalledTimes(1);

    speechTranscriber.reset();
    expect(speechTranscriber.status).toBe("idle");

    mockPipeline.mockResolvedValueOnce(vi.fn());
    await speechTranscriber.getPipeline("whisper-tiny.en");
    expect(mockPipeline).toHaveBeenCalledTimes(2);
  });
});
