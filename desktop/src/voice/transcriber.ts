/**
 * Local speech-to-text transcription with selectable Whisper models.
 * Models are downloaded on demand into the local browser cache.
 */

import {
  type BarkRuntimePhase,
  barkRuntimeStatus,
  fetchBarkModel,
  installBarkRuntime,
  transcribeWithBark as transcribeWithBarkHost,
} from "./bark-engine";
import {
  getActiveVoiceModelId,
  markVoiceModelDownloaded,
  setActiveVoiceModelId,
} from "./model-cache";
import {
  type VoiceModelId,
  type VoiceModelOption,
  getVoiceModelOption,
  isVoiceModelAvailable,
} from "./model-registry";
import type { VoiceTrace } from "./trace";
import { cactusSpeechEngine } from "./whistle-engine";
import { downloadWhistleWeights, getCachedWhistleWeights } from "./whistle-weights";
import { TRANSCRIBE_SAMPLE_RATE, transcribeWindows } from "./windows";

export type TranscriberStatus =
  | "idle"
  | "loading-model"
  | "downloading"
  | "transcribing"
  | "ready"
  | "error";

/** How far the run is through the fixed windows a recording is cut into. */
export interface TranscribeWindowState {
  /** 1-based window whose audio is being transcribed. */
  window: number;
  /** Windows the recording was cut into. */
  windows: number;
  /** Audio seconds inside the current window transcribed so far. */
  windowSeconds: number;
  /** Audio length of the current window, never above one full window. */
  windowLengthSeconds: number;
  /** Audio seconds of the whole recording transcribed so far. */
  processedSeconds: number;
  /** Whole-recording length in seconds. */
  totalSeconds: number;
  /** Milliseconds spent decoding the current window so far. */
  decodeMs: number;
}

export interface TranscribeProgress {
  status: TranscriberStatus;
  detail?: string;
  /** Whole-recording completion in percent, derived from transcribed audio. */
  progress?: number;
  /** Window state, present on every `transcribing` report. */
  window?: TranscribeWindowState;
}

export interface DownloadProgress {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
  /** Provisioning phase while a host runtime installs, instead of file bytes. */
  stage?: BarkRuntimePhase;
}

export interface TranscribeResult {
  text: string;
}

export interface TranscribeOptions {
  onProgress?: (status: TranscribeProgress) => void;
  /** Cancels the transcription; the call rejects with an AbortError. */
  signal?: AbortSignal;
  /** Where every step of this run is recorded, for the Events row. */
  trace?: VoiceTrace;
}

function errorDetails(err: unknown): string {
  if (!(err instanceof Error)) {
    return `unknown error: ${String(err)}`;
  }
  return `name=${err.name || "Error"}, message=${err.message || "No message"}`;
}

/** True when an error came from an aborted transcription. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function abortError(): Error {
  const err = new Error("Transcription cancelled.");
  err.name = "AbortError";
  return err;
}

/** Rejects a model whose engine this build ships no loader for. */
function assertRunnable(opt: VoiceModelOption): void {
  if (isVoiceModelAvailable(opt)) return;
  throw new Error(
    `${opt.name} runs on the ${opt.engine} engine, which this build does not include.`,
  );
}

/**
 * Settles with `promise`, or rejects with an AbortError as soon as `signal`
 * aborts. The underlying work keeps running; its later settle is ignored
 * (handlers stay attached, so it cannot surface as an unhandled rejection).
 */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

type ASRPipeline = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text: string } | string>;

/** How often the window being decoded re-reports its measured decode time. */
const TRANSCRIBE_PROGRESS_INTERVAL_MS = 250;

/** One wording for a recording no engine heard speech in. */
const NO_SPEECH_ERROR = "No speech was recognized in the recording.";

/** Text of an ASR pipeline result; throws for a shape the pipeline never returns. */
function outputText(output: { text: string } | string): string {
  if (typeof output === "string") return output;
  if (output && typeof output.text === "string") return output.text;
  throw new Error(
    `Speech recognizer returned an unsupported result (${Object.prototype.toString.call(output)}).`,
  );
}

type TransformersEnv = typeof import("@huggingface/transformers").env;

const ONNX_NOISE_MARKER = Symbol.for("reasonix.onnxNoiseSuppressed");

/**
 * Suppresses repetitive ONNX Runtime graph-optimizer noise.
 * During model loading, ONNX Runtime logs hundreds of "Removing initializer"
 * warnings for unused graph nodes, which floods the browser developer console.
 */
export function suppressOnnxOptimizerNoise(): void {
  if (typeof console === "undefined") return;

  if (console.warn && !(console.warn as unknown as Record<symbol, unknown>)[ONNX_NOISE_MARKER]) {
    const originalWarn = console.warn;
    const filteredWarn = (...args: unknown[]) => {
      const first = args[0];
      if (
        typeof first === "string" &&
        (first.includes("CleanUnusedInitializersAndNodeArgs") ||
          first.includes("VerifyEachNodeIsAssignedToAnEp") ||
          first.includes("powerPreference option is currently ignored") ||
          first.includes("Unable to determine content-length") ||
          (first.includes("[W:onnxruntime:") && first.includes("Removing initializer")))
      ) {
        return;
      }
      originalWarn.apply(console, args);
    };
    (filteredWarn as unknown as Record<symbol, unknown>)[ONNX_NOISE_MARKER] = true;
    console.warn = filteredWarn;
  }

  if (console.log && !(console.log as unknown as Record<symbol, unknown>)[ONNX_NOISE_MARKER]) {
    const originalLog = console.log;
    const filteredLog = (...args: unknown[]) => {
      const first = args[0];
      if (
        typeof first === "string" &&
        (first.includes("CleanUnusedInitializersAndNodeArgs") ||
          first.includes("VerifyEachNodeIsAssignedToAnEp") ||
          first.includes("powerPreference option is currently ignored") ||
          first.includes("Unable to determine content-length") ||
          (first.includes("[W:onnxruntime:") && first.includes("Removing initializer")))
      ) {
        return;
      }
      originalLog.apply(console, args);
    };
    (filteredLog as unknown as Record<symbol, unknown>)[ONNX_NOISE_MARKER] = true;
    console.log = filteredLog;
  }

  if (console.error && !(console.error as unknown as Record<symbol, unknown>)[ONNX_NOISE_MARKER]) {
    const originalError = console.error;
    const filteredError = (...args: unknown[]) => {
      const first = args[0];
      if (
        typeof first === "string" &&
        (first.includes("CleanUnusedInitializersAndNodeArgs") ||
          first.includes("VerifyEachNodeIsAssignedToAnEp") ||
          first.includes("powerPreference option is currently ignored") ||
          first.includes("Unable to determine content-length") ||
          (first.includes("[W:onnxruntime:") && first.includes("Removing initializer")))
      ) {
        return;
      }
      originalError.apply(console, args);
    };
    (filteredError as unknown as Record<symbol, unknown>)[ONNX_NOISE_MARKER] = true;
    console.error = filteredError;
  }
}

/**
 * Applies the Transformers.js environment configuration used for in-app
 * transcription.
 *
 * Runs ONNX Runtime directly with WebAssembly. Proxy mode is disabled because
 * onnxruntime-web proxying uses Webpack worker-loader and causes concurrent
 * session allocation errors during Seq2Seq encoder/decoder construction.
 */
function configureTransformersEnv(env: TransformersEnv): void {
  suppressOnnxOptimizerNoise();
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  const wasm = env.backends.onnx?.wasm;
  if (wasm) {
    wasm.wasmPaths = "/wasm/";
    wasm.proxy = false;
  }
  if (env.backends.onnx) {
    env.backends.onnx.logLevel = "error";
  }
}

interface WebGPUNavigator {
  gpu?: {
    requestAdapter(options?: { powerPreference?: string }): Promise<{
      info?: Record<string, string>;
      requestAdapterInfo?: () => Promise<Record<string, string>>;
    } | null>;
  };
}

/**
 * Detects whether the device has a valid GPU with WebGPU compute support.
 */
export async function isWebGPUSupported(): Promise<boolean> {
  if (typeof navigator === "undefined") {
    return false;
  }
  const nav = navigator as unknown as WebGPUNavigator;
  if (!nav.gpu || typeof nav.gpu.requestAdapter !== "function") {
    return false;
  }
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

class LocalSpeechTranscriber {
  private pipelineInstance: ASRPipeline | null = null;
  private loadedModelId: VoiceModelId | null = null;
  private activeModelId: VoiceModelId = getActiveVoiceModelId();
  private isInitializing = false;
  private initPromise: Promise<ASRPipeline> | null = null;
  private currentStatus: TranscriberStatus = "idle";
  private onStatusChange?: (progress: TranscribeProgress) => void;
  /** Reports of the transcription in flight, so the caller can render them live. */
  private progressSink?: (progress: TranscribeProgress) => void;
  /** Device the loaded Transformers.js pipeline runs on, for the run record. */
  private pipelineDevice: "webgpu" | "wasm" | null = null;

  public get status(): TranscriberStatus {
    return this.currentStatus;
  }

  public get activeModel(): VoiceModelId {
    return this.activeModelId;
  }

  /** Device the loaded pipeline runs on, or null when none is loaded. */
  public get device(): "webgpu" | "wasm" | null {
    return this.pipelineDevice;
  }

  public setModel(modelId: VoiceModelId): void {
    if (this.activeModelId === modelId) {
      return;
    }
    this.activeModelId = modelId;
    setActiveVoiceModelId(modelId);
    if (this.loadedModelId !== modelId) {
      this.pipelineInstance = null;
      this.loadedModelId = null;
      this.pipelineDevice = null;
      this.currentStatus = "idle";
    }
  }

  public setStatusListener(listener?: (progress: TranscribeProgress) => void): void {
    this.onStatusChange = listener;
  }

  private updateStatus(
    status: TranscriberStatus,
    detail?: string,
    progress?: number,
    window?: TranscribeWindowState,
  ): void {
    this.currentStatus = status;
    const report: TranscribeProgress = { status, detail, progress, window };
    this.onStatusChange?.(report);
    this.progressSink?.(report);
  }

  /**
   * Downloads a model into the local browser cache with progress reporting.
   */
  public async downloadModel(
    modelId: VoiceModelId,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    const opt = getVoiceModelOption(modelId);
    assertRunnable(opt);

    if (opt.engine === "cactus") {
      await this.downloadCactusModel(opt, modelId, onProgress);
      return;
    }
    if (opt.engine === "bark") {
      await this.downloadBarkModel(opt, modelId, onProgress);
      return;
    }

    this.updateStatus("downloading", `Downloading ${opt.name}...`);

    try {
      const { pipeline, env } = await import("@huggingface/transformers");

      configureTransformersEnv(env);

      const hasGpu = await isWebGPUSupported();
      const pipe = (await pipeline("automatic-speech-recognition", opt.repoId, {
        device: hasGpu ? "webgpu" : "wasm",
        dtype: hasGpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
        progress_callback: (data: unknown) => {
          if (onProgress && data && typeof data === "object") {
            onProgress(data as DownloadProgress);
          }
        },
      })) as unknown as ASRPipeline;

      markVoiceModelDownloaded(modelId, true);

      // If downloading the currently active model, retain the initialized pipeline:
      if (this.activeModelId === modelId) {
        this.pipelineInstance = pipe;
        this.loadedModelId = modelId;
        this.pipelineDevice = hasGpu ? "webgpu" : "wasm";
        this.updateStatus("ready");
      } else {
        this.updateStatus("idle");
      }
    } catch (err) {
      const details = errorDetails(err);
      this.updateStatus("error", details);
      throw new Error(`Failed to download voice model ${opt.name} (${details}).`);
    }
  }

  /**
   * Downloads the Cactus `.cact` weights for a speech model and, when it is
   * the active model, loads them into the engine.
   */
  private async downloadCactusModel(
    opt: VoiceModelOption,
    modelId: VoiceModelId,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    this.updateStatus("downloading", `Downloading ${opt.name}...`);
    try {
      const bytes = await downloadWhistleWeights(opt, (p) => {
        onProgress?.({
          status: "progress",
          file: opt.weightsFile ?? undefined,
          progress: p.progress,
          loaded: p.loaded,
          total: p.total,
        });
      });
      markVoiceModelDownloaded(modelId, true);
      if (this.activeModelId === modelId) {
        await cactusSpeechEngine.loadModel(bytes);
        this.updateStatus("ready");
      } else {
        this.updateStatus("idle");
      }
    } catch (err) {
      const details = errorDetails(err);
      this.updateStatus("error", details);
      throw new Error(`Failed to download voice model ${opt.name} (${details}).`);
    }
  }

  /**
   * Installs the host runtime when it is missing, then fetches the weights.
   * Both live outside the app bundle and survive app updates untouched.
   */
  private async downloadBarkModel(
    opt: VoiceModelOption,
    modelId: VoiceModelId,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    this.updateStatus("downloading", `Preparing ${opt.name}...`);
    try {
      const runtime = await barkRuntimeStatus();
      if (!runtime.installed) {
        this.updateStatus("downloading", "Installing the Bark runtime...");
        await installBarkRuntime((phase) => onProgress?.({ status: "progress", stage: phase }));
      }

      this.updateStatus("downloading", `Downloading ${opt.name}...`);
      const installed = await fetchBarkModel(opt, (progress) => {
        onProgress?.({
          status: "progress",
          file: progress.file,
          loaded: progress.loaded,
          total: progress.total,
          progress:
            progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0,
        });
      });
      onProgress?.({
        status: "done",
        progress: 100,
        loaded: installed.bytes,
        total: installed.bytes,
      });
      markVoiceModelDownloaded(modelId, true);
      this.updateStatus(this.activeModelId === modelId ? "ready" : "idle");
    } catch (err) {
      const details = errorDetails(err);
      this.updateStatus("error", details);
      throw new Error(`Failed to download voice model ${opt.name} (${details}).`);
    }
  }

  /** Ensures the active Cactus speech model is loaded into the engine. */
  private async ensureCactusModel(opt: VoiceModelOption, trace?: VoiceTrace): Promise<void> {
    if (cactusSpeechEngine.isModelLoaded) {
      trace?.boot("warm");
      return;
    }
    trace?.boot("cold");

    const readingAt = Date.now();
    const bytes = await getCachedWhistleWeights(opt);
    trace?.mark(
      "weights read",
      Date.now() - readingAt,
      bytes ? "cached archive" : "not downloaded",
    );
    if (!bytes) {
      throw new Error(
        `${opt.name} is not downloaded. Download it in Settings before transcribing.`,
      );
    }

    this.updateStatus("loading-model", `Loading ${opt.name}...`);
    try {
      const loadingAt = Date.now();
      await cactusSpeechEngine.loadModel(bytes);
      trace?.mark("engine load", Date.now() - loadingAt, "module and archive");
      trace?.fact("device", "wasm");
    } catch (err) {
      const details = errorDetails(err);
      this.updateStatus("error", details);
      throw new Error(`Failed to load ${opt.name} (${details}).`);
    }
  }

  /** Transcribes through the host Bark runtime, one host call per window. */
  private async transcribeBark(
    opt: VoiceModelOption,
    audioData: Float32Array,
    options?: TranscribeOptions,
  ): Promise<TranscribeResult> {
    if (options?.signal?.aborted) throw abortError();
    const trace = options?.trace;
    try {
      const text = await this.transcribeInWindows(
        audioData,
        async (window) => {
          const run = await transcribeWithBarkHost(opt, window);
          // The host reports the cold boot, the cache verdict and both timings,
          // so the row proves what happened instead of inferring it.
          trace?.boot(run.cold ? "cold" : "warm");
          if (run.cache !== "warm") trace?.fact("cache", run.cache);
          if (run.spawnMs > 0) trace?.mark("worker spawn", run.spawnMs);
          if (run.loadMs > 0) {
            trace?.mark(
              "model load",
              run.loadMs,
              run.cache === "hit" ? "decoded cache hit" : "weights decoded",
            );
          }
          if (run.attempts > 1) trace?.retried(run.attempts - 1);
          if (run.error) {
            throw new Error(
              run.stderrTail ? `${run.error} (worker stderr: ${run.stderrTail})` : run.error,
            );
          }
          return run.text;
        },
        options,
      );
      if (!text) throw new Error(NO_SPEECH_ERROR);
      this.updateStatus("ready");
      return { text };
    } catch (err) {
      if (isAbortError(err)) {
        this.updateStatus("idle");
        throw err;
      }
      this.updateStatus("error", errorDetails(err));
      throw err;
    }
  }

  /** Transcribes via the Cactus engine (Whistle), one engine call per window. */
  private async transcribeWithCactus(
    opt: VoiceModelOption,
    audioData: Float32Array,
    options?: TranscribeOptions,
  ): Promise<TranscribeResult> {
    try {
      await raceAbort(this.ensureCactusModel(opt, options?.trace), options?.signal);
    } catch (err) {
      if (isAbortError(err)) this.updateStatus("idle");
      throw err;
    }

    try {
      const text = await this.transcribeInWindows(
        audioData,
        async (window) => (await cactusSpeechEngine.transcribe(window)).text,
        options,
      );
      if (!text) {
        throw new Error(NO_SPEECH_ERROR);
      }
      this.updateStatus("ready");
      return { text };
    } catch (err) {
      if (isAbortError(err)) {
        this.updateStatus("idle");
        throw err;
      }
      this.updateStatus("error", errorDetails(err));
      throw err;
    }
  }

  /**
   * Transcribes `audioData` one window at a time, in order, joining the window
   * transcripts into one result.
   *
   * Every engine clips a longer buffer, so the windows are the only thing that
   * keeps a minute of speech from being cut to its first 30 s. A window the
   * engine transcribes to nothing is silence, not a failure; the caller reports
   * a recording that produced no text at all.
   */
  private async transcribeInWindows(
    audioData: Float32Array,
    run: (window: Float32Array) => Promise<string>,
    options?: TranscribeOptions,
  ): Promise<string> {
    const windows = transcribeWindows(audioData.length);
    const totalSeconds = audioData.length / TRANSCRIBE_SAMPLE_RATE;
    const parts: string[] = [];
    const trace = options?.trace;
    const decodingAt = Date.now();
    trace?.windows(windows.length);
    trace?.audio(totalSeconds);

    for (let index = 0; index < windows.length; index += 1) {
      const { start, end } = windows[index]!;
      const offsetSeconds = start / TRANSCRIBE_SAMPLE_RATE;
      const windowLengthSeconds = (end - start) / TRANSCRIBE_SAMPLE_RATE;
      const startedAt = Date.now();
      // An engine decodes a window in one call, so the audio position inside the
      // window is 0 until that call returns and the whole window afterwards.
      // Only the decode time is measured between the two, never extrapolated.
      let windowSeconds = 0;
      const report = (): void => {
        const processedSeconds = offsetSeconds + windowSeconds;
        this.updateStatus(
          "transcribing",
          `Transcribing window ${index + 1} of ${windows.length}...`,
          totalSeconds > 0 ? Math.round((processedSeconds / totalSeconds) * 100) : 0,
          {
            window: index + 1,
            windows: windows.length,
            windowSeconds,
            windowLengthSeconds,
            processedSeconds,
            totalSeconds,
            decodeMs: Date.now() - startedAt,
          },
        );
      };

      report();
      const ticker = setInterval(report, TRANSCRIBE_PROGRESS_INTERVAL_MS);
      let text: string;
      try {
        text = await raceAbort(run(audioData.subarray(start, end)), options?.signal);
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw new Error(
          `Transcription failed in window ${index + 1} of ${windows.length} (${errorDetails(err)}).`,
        );
      } finally {
        clearInterval(ticker);
      }

      windowSeconds = windowLengthSeconds;
      report();
      trace?.mark(
        `window ${index + 1}/${windows.length}`,
        Date.now() - startedAt,
        `${windowLengthSeconds.toFixed(1)}s audio`,
      );
      const trimmed = text.trim();
      if (trimmed) parts.push(trimmed);
    }

    trace?.decoded(Date.now() - decodingAt);
    return parts.join(" ").trim();
  }

  /**
   * Initializes the ASR pipeline for the target model, downloading it on first use.
   */
  public async getPipeline(targetModelId?: VoiceModelId): Promise<ASRPipeline> {
    const modelId = targetModelId ?? this.activeModelId;
    const opt = getVoiceModelOption(modelId);
    assertRunnable(opt);
    if (opt.engine !== "transformers") {
      throw new Error(`${opt.name} does not run on the Transformers.js pipeline.`);
    }

    if (this.pipelineInstance && this.loadedModelId === modelId) {
      return this.pipelineInstance;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      this.isInitializing = true;
      const hasGpu = await isWebGPUSupported();
      this.updateStatus("loading-model", `Loading ${opt.name} (${hasGpu ? "GPU" : "CPU"})...`);

      try {
        const { pipeline, env } = await import("@huggingface/transformers");

        configureTransformersEnv(env);

        const pipe = (await pipeline("automatic-speech-recognition", opt.repoId, {
          device: hasGpu ? "webgpu" : "wasm",
          dtype: hasGpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
        })) as unknown as ASRPipeline;

        this.pipelineInstance = pipe;
        this.loadedModelId = modelId;
        this.pipelineDevice = hasGpu ? "webgpu" : "wasm";
        markVoiceModelDownloaded(modelId, true);
        this.updateStatus("ready");
        return pipe;
      } catch (err) {
        const details = errorDetails(err);
        this.updateStatus("error", details);
        throw new Error(`Failed to load transcription model ${opt.name} (${details}).`);
      } finally {
        this.isInitializing = false;
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Transcribes a 16 kHz Float32Array audio buffer into text, one window at a
   * time whichever engine runs it.
   */
  public async transcribe(
    audioData: Float32Array,
    options?: TranscribeOptions,
  ): Promise<TranscribeResult> {
    if (audioData.length === 0) {
      throw new Error("No microphone audio was captured.");
    }

    const minSamples = TRANSCRIBE_SAMPLE_RATE * 0.2; // 200 ms minimum audio
    if (audioData.length < minSamples) {
      const durationMs = Math.round((audioData.length / TRANSCRIBE_SAMPLE_RATE) * 1000);
      throw new Error(
        `Recording was too short to transcribe (${durationMs} ms captured; minimum is 200 ms).`,
      );
    }

    const opt = getVoiceModelOption(this.activeModelId);
    assertRunnable(opt);
    this.progressSink = options?.onProgress;
    try {
      if (opt.engine === "bark") {
        return await this.transcribeBark(opt, audioData, options);
      }
      if (opt.engine === "cactus") {
        return await this.transcribeWithCactus(opt, audioData, options);
      }
      return await this.transcribeWithPipeline(audioData, options);
    } finally {
      this.progressSink = undefined;
    }
  }

  /** Transcribes through the Transformers.js pipeline, one call per window. */
  private async transcribeWithPipeline(
    audioData: Float32Array,
    options?: TranscribeOptions,
  ): Promise<TranscribeResult> {
    const trace = options?.trace;
    const opt = getVoiceModelOption(this.activeModelId);
    trace?.fact("repo", opt.repoId);
    // A pipeline already in memory is a warm start; loading one is the cold path.
    const alreadyLoaded =
      this.pipelineInstance !== null && this.loadedModelId === this.activeModelId;
    trace?.boot(alreadyLoaded ? "warm" : "cold");
    const loadingAt = Date.now();
    let pipe: ASRPipeline;
    try {
      pipe = await raceAbort(this.getPipeline(), options?.signal);
    } catch (err) {
      if (isAbortError(err)) this.updateStatus("idle");
      throw err;
    }
    if (!alreadyLoaded) {
      trace?.mark("pipeline load", Date.now() - loadingAt, "ONNX session built");
    }
    if (this.pipelineDevice) trace?.fact("device", this.pipelineDevice);

    try {
      // Whisper truncates any buffer past its 30 s clip, so each window is a
      // separate pipeline call and none is longer than the model's input.
      const isEnglishOnly = this.activeModelId.endsWith(".en");
      const generateOptions: Record<string, unknown> = {
        return_timestamps: false,
        ...(isEnglishOnly ? {} : { language: "english", task: "transcribe" }),
      };

      const text = await this.transcribeInWindows(
        audioData,
        async (window) => outputText(await pipe(window, generateOptions)),
        options,
      );
      if (!text) {
        throw new Error(NO_SPEECH_ERROR);
      }
      this.updateStatus("ready");
      return { text };
    } catch (err) {
      if (isAbortError(err)) {
        this.updateStatus("idle");
        throw err;
      }
      this.updateStatus("error", errorDetails(err));
      throw err;
    }
  }

  /**
   * Drops the cached Transformers.js pipeline so the next transcription builds
   * a fresh ONNX session. Used to recover from a wedged session. The Cactus
   * engine is a process-global singleton that cannot unload weights, so it is
   * left untouched.
   */
  public reset(): void {
    this.pipelineInstance = null;
    this.loadedModelId = null;
    this.pipelineDevice = null;
    this.initPromise = null;
    this.isInitializing = false;
    this.updateStatus("idle");
  }

  /**
   * Pre-warms the transcription model into memory in the background.
   */
  public async preload(): Promise<void> {
    const opt = getVoiceModelOption(this.activeModelId);
    // Bark runs in its own process on demand, so there is nothing to warm up.
    if (opt.engine === "bark") return;
    if (opt.engine === "cactus") {
      if (!cactusSpeechEngine.isModelLoaded) {
        const bytes = await getCachedWhistleWeights(opt);
        if (bytes) await cactusSpeechEngine.loadModel(bytes);
      }
      return;
    }
    if (!this.pipelineInstance && !this.isInitializing) {
      await this.getPipeline();
    }
  }
}

export const speechTranscriber = new LocalSpeechTranscriber();
