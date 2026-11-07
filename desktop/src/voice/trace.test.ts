import { describe, expect, it } from "vitest";
import { VoiceTrace } from "./trace";

const RUN = {
  id: "voice-1",
  model: "Bark 3.0 (English)",
  modelId: "underdog/bark-3.0",
  engine: "bark",
};

describe("VoiceTrace", () => {
  it("names the model and whether the run had to boot it", () => {
    const cold = new VoiceTrace(RUN);
    cold.boot("cold");
    expect(cold.record("started").label).toBe("Bark 3.0 (English), cold boot");

    const warm = new VoiceTrace(RUN);
    warm.boot("warm");
    expect(warm.record("started").label).toBe("Bark 3.0 (English), warm start");

    const unknown = new VoiceTrace(RUN);
    expect(unknown.record("started").label).toBe("Bark 3.0 (English)");
  });

  it("identifies the model and engine in the detail line", () => {
    const trace = new VoiceTrace(RUN);
    trace.fact("device", "cpu");
    trace.fact("format", "bark");
    expect(trace.record("started").detail).toBe(
      "model=underdog/bark-3.0 engine=bark device=cpu format=bark",
    );
  });

  it("records a step with the time it took and what it produced", async () => {
    const trace = new VoiceTrace(RUN);
    const value = await trace.step(
      "model load",
      async () => "decoded cache hit",
      (detail) => detail,
    );

    expect(value).toBe("decoded cache hit");
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]?.name).toBe("model load");
    expect(trace.steps[0]?.ms).toBeGreaterThanOrEqual(0);
    const steps = trace.record("started").steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/^model load: .+, decoded cache hit$/);
  });

  it("records a failing step before letting the failure through", async () => {
    const trace = new VoiceTrace(RUN);
    await expect(
      trace.step("worker spawn", async () => {
        throw new Error("python exited");
      }),
    ).rejects.toThrow("python exited");

    expect(trace.steps[0]?.detail).toBe("failed: python exited");
  });

  it("summarises windows, audio, decode time, retries and characters", () => {
    const trace = new VoiceTrace(RUN);
    trace.boot("cold");
    trace.windows(3);
    trace.audio(64.2);
    trace.decoded(12400);
    trace.retried();
    trace.result(1842);

    expect(trace.record("done").result).toBe(
      "3 windows, 64.2s audio, transcribed in 12.4s, 1 retry, 1842 characters",
    );
  });

  it("says one window, one retry and one character in the singular", () => {
    const trace = new VoiceTrace(RUN);
    trace.windows(1);
    trace.audio(4);
    trace.retried();
    trace.result(1);

    expect(trace.record("done").result).toBe("1 window, 4.0s audio, 1 retry, 1 character");
  });

  it("leaves the result empty while the run has only started", () => {
    const trace = new VoiceTrace(RUN);
    expect(trace.record("started").result).toBeUndefined();
  });

  it("carries the failure text on a failed run", () => {
    const trace = new VoiceTrace(RUN);
    trace.failed(new Error("the Bark worker exited: RuntimeError: boom"));
    expect(trace.record("failed").result).toBe(
      "failed: the Bark worker exited: RuntimeError: boom",
    );
  });

  it("marks a cancelled run", () => {
    const trace = new VoiceTrace(RUN);
    trace.windows(2);
    expect(trace.record("cancel").result).toContain("cancelled");
  });

  it("keeps steps in the order they ran", () => {
    const trace = new VoiceTrace(RUN);
    trace.mark("runtime check", 3, "installed");
    trace.mark("worker spawn", 412);
    expect(trace.record("started").steps).toEqual([
      "runtime check: 3 ms, installed",
      "worker spawn: 412 ms",
    ]);
  });

  it("upserts every record of a run under one id", () => {
    const trace = new VoiceTrace(RUN);
    trace.mark("microphone open", 12);
    expect(trace.record("started").id).toBe("voice-1");
    expect(trace.record("done").id).toBe("voice-1");
    expect(trace.record("done").type).toBe("voice");
  });
});
