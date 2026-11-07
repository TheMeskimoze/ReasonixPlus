// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BarkTranscribeResult } from "./bark-engine";
import { VoiceTrace } from "./trace";

const BARK_MODEL = "underdog/bark-3.0";

const { barkRuntimeStatus, installBarkRuntime, fetchBarkModel, transcribeWithBark } = vi.hoisted(
  () => ({
    barkRuntimeStatus: vi.fn(async () => ({ installed: true, dir: "/voice/runtimes/b", bytes: 10 })),
    installBarkRuntime: vi.fn(async () => ({
      installed: true,
      dir: "/voice/runtimes/b",
      bytes: 10,
    })),
    fetchBarkModel: vi.fn(async () => ({
      engine: "bark",
      repoId: "ConwayResearch/Underdog-Bark-3.0",
      revision: "85db2ad18ab4",
      files: [{ name: "model.bark", bytes: 12 }],
      bytes: 12,
    })),
    transcribeWithBark: vi.fn(
      async (_option: unknown, _audio: Float32Array): Promise<BarkTranscribeResult> => ({
        text: "hello from bark",
        cold: false,
        cache: "warm",
        spawnMs: 0,
        loadMs: 0,
        transcribeMs: 1,
        attempts: 1,
        stderrTail: "",
        error: null,
      }),
    ),
  }),
);

vi.mock("./bark-engine", () => ({
  BARK_SAMPLE_RATE: 16000,
  barkRuntimeStatus,
  installBarkRuntime,
  fetchBarkModel,
  transcribeWithBark,
  removeBarkModel: vi.fn(async () => {}),
  installedBarkModels: vi.fn(async () => []),
}));

vi.mock("./whistle-engine", () => ({
  CACTUS_SAMPLE_RATE: 16000,
  CACTUS_MAX_SECONDS: 30,
  cactusSpeechEngine: {
    loadModel: vi.fn(async () => {}),
    transcribe: vi.fn(async () => ({ text: "", language: "en", ttftMs: 0, decodeTps: 0 })),
    isModelLoaded: false,
  },
}));

vi.mock("./whistle-weights", () => ({
  downloadWhistleWeights: vi.fn(async () => new Uint8Array()),
  getCachedWhistleWeights: vi.fn(async () => null),
  isWhistleWeightsCached: vi.fn(async () => false),
  deleteWhistleWeights: vi.fn(async () => {}),
}));

import { speechTranscriber } from "./transcriber";

/** One host answer, defaulting to a warm generation of `text`. */
function barkRun(text: string, extra: Partial<BarkTranscribeResult> = {}): BarkTranscribeResult {
  return {
    text,
    cold: false,
    cache: "warm",
    spawnMs: 0,
    loadMs: 0,
    transcribeMs: 1,
    attempts: 1,
    stderrTail: "",
    error: null,
    ...extra,
  };
}

describe("LocalSpeechTranscriber (Bark)", () => {
  beforeEach(() => {
    localStorage.clear();
    barkRuntimeStatus.mockClear();
    installBarkRuntime.mockClear();
    fetchBarkModel.mockClear();
    transcribeWithBark.mockClear();
    speechTranscriber.setModel(BARK_MODEL);
  });

  it("installs the runtime before fetching the weights", async () => {
    barkRuntimeStatus.mockResolvedValueOnce({ installed: false, dir: "/r", bytes: 0 });

    await speechTranscriber.downloadModel(BARK_MODEL);

    expect(installBarkRuntime).toHaveBeenCalledTimes(1);
    expect(fetchBarkModel).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`reasonix.voiceModel.downloaded.${BARK_MODEL}`)).toBe("true");
  });

  it("reuses an installed runtime instead of reinstalling it", async () => {
    await speechTranscriber.downloadModel(BARK_MODEL);

    expect(installBarkRuntime).not.toHaveBeenCalled();
    expect(fetchBarkModel).toHaveBeenCalledTimes(1);
    expect(barkRuntimeStatus).toHaveBeenCalledTimes(1);
  });

  it("transcribes through the host engine instead of a pipeline", async () => {
    const result = await speechTranscriber.transcribe(new Float32Array(16000));

    expect(result.text).toBe("hello from bark");
    expect(transcribeWithBark).toHaveBeenCalledTimes(1);
  });

  it("cuts a long recording into 30 s windows for the host engine", async () => {
    await speechTranscriber.transcribe(new Float32Array(16000 * 61));

    expect(transcribeWithBark).toHaveBeenCalledTimes(3);
    expect(transcribeWithBark.mock.calls.map(([, audio]) => audio.length)).toEqual([
      16000 * 30,
      16000 * 30,
      16000 * 1,
    ]);
  });

  it("keeps a silent window from failing the spoken ones", async () => {
    transcribeWithBark
      .mockResolvedValueOnce(barkRun(""))
      .mockResolvedValueOnce(barkRun("second window"));

    const result = await speechTranscriber.transcribe(new Float32Array(16000 * 45));

    expect(result.text).toBe("second window");
    expect(transcribeWithBark).toHaveBeenCalledTimes(2);
  });

  it("reports an empty transcript rather than returning blank text", async () => {
    transcribeWithBark.mockResolvedValueOnce(barkRun(""));

    await expect(speechTranscriber.transcribe(new Float32Array(16000))).rejects.toThrow(
      /No speech was recognized/,
    );
  });

  it("records a cold boot, the decoded cache and the load time", async () => {
    transcribeWithBark.mockResolvedValueOnce(
      barkRun("cold words", { cold: true, cache: "hit", spawnMs: 412, loadMs: 41_200, attempts: 2 }),
    );
    const trace = new VoiceTrace({
      id: "voice-1",
      model: "Bark 3.0 (English)",
      modelId: BARK_MODEL,
      engine: "bark",
    });

    await speechTranscriber.transcribe(new Float32Array(16000), { trace });

    const steps = trace.steps.map((step) => step.name);
    expect(steps).toContain("worker spawn");
    expect(steps).toContain("model load");
    expect(steps).toContain("window 1/1");
    expect(trace.record("done").label).toBe("Bark 3.0 (English), cold boot");
    expect(trace.record("done").detail).toContain("cache=hit");
    expect(trace.record("done").result).toContain("1 retry");
  });

  it("surfaces a host failure with the worker stderr tail", async () => {
    transcribeWithBark.mockResolvedValueOnce(
      barkRun("", {
        cold: true,
        cache: "decode",
        error: "the Bark worker exited: RuntimeError: boom",
        stderrTail: "Traceback (most recent call last)",
      }),
    );

    await expect(speechTranscriber.transcribe(new Float32Array(16000))).rejects.toThrow(
      /RuntimeError: boom.*Traceback/,
    );
  });

  it("refuses a Transformers.js pipeline for a Bark model", async () => {
    await expect(speechTranscriber.getPipeline(BARK_MODEL)).rejects.toThrow(
      /Transformers\.js pipeline/,
    );
  });
});
