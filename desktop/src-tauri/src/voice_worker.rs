//! A warm Bark worker: one interpreter per runtime, model loaded once.
//!
//! The worker speaks newline-delimited JSON on stdin/stdout, so a dictation
//! costs inference instead of a fresh interpreter, torch import and model load.
//! The weights it decodes are cached beside the checkpoint, so an app restart
//! decodes once and reads the result on every later load.

use crate::voice_host::{no_window, tail};
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

const SCRIPT: &str = "bark_worker.py";
const IDLE_TIMEOUT: Duration = Duration::from_secs(600);
const REAP_INTERVAL: Duration = Duration::from_secs(60);
const STDERR_CAP: usize = 8192;

/// Loading a 1.25 GB checkpoint is slow; answering a dictation is not.
const LOAD_DEADLINE: Duration = Duration::from_secs(300);
const TRANSCRIBE_DEADLINE: Duration = Duration::from_secs(120);

static REAPER: AtomicBool = AtomicBool::new(false);

/// Drives one transcription inside the long-lived worker process.
const WORKER: &str = r#"
import gc
import json
import os
import sys
import threading

_model = None
_format = None
_processor = None

# A decoded checkpoint is only valid for the exact files that produced it; bump this
# when the payload's shape changes, and an older file is ignored rather than read.
CACHE_VERSION = 1
CACHE_SUFFIX = ".decoded.pt"


def _describe(error):
    return f"{type(error).__name__}: {error}"


def _signature(*paths):
    """The files a cache is only valid against: the weights and the loader that decoded them."""
    parts = []
    for path in paths:
        stat = path.stat()
        parts.append(f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}")
    return "|".join(parts)


def _read_cache(path, signature):
    import torch

    try:
        payload = torch.load(path, map_location="cpu", mmap=True)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("version") != CACHE_VERSION or payload.get("signature") != signature:
        return None
    state = payload.get("state")
    config = payload.get("config")
    if not isinstance(state, dict) or not isinstance(config, dict):
        return None
    return state, config


def _prune_caches(keep):
    """One decoded checkpoint per engine: a second model replaces the first cache, so the
    footprint stays at one checkpoint instead of one per installed model. A half-written
    file left by a kill is swept with it."""
    for other in keep.parent.parent.glob("*/*" + CACHE_SUFFIX + "*"):
        if other == keep:
            continue
        try:
            other.unlink()
        except OSError:
            pass


def _write_cache(path, signature, state, config):
    import torch

    part = path.with_name(path.name + ".part")
    try:
        torch.save(
            {"version": CACHE_VERSION, "signature": signature, "state": state, "config": config},
            part,
        )
        os.replace(part, path)
    except Exception:
        try:
            part.unlink()
        except OSError:
            pass
        return
    try:
        _prune_caches(path)
    except Exception:
        pass


def _load(request):
    global _model, _format, _processor
    import importlib.util
    from pathlib import Path

    used_cache = False
    model_dir = Path(request["modelDir"])
    image_format = request["format"]
    weights = request["weights"]
    device = request["device"]

    if image_format == "bark":
        loader_name = request.get("loader") or ""
        spec = importlib.util.spec_from_file_location(
            "official_bark", str(model_dir / loader_name)
        )
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)

        # The loader splits decoding from building, so the decoded checkpoint can stand in
        # for its own decode and every part of the build stays the loader's business.
        weights_path = model_dir / weights
        cache_path = model_dir / (weights + CACHE_SUFFIX)
        try:
            signature = _signature(weights_path, model_dir / loader_name)
        except OSError:
            signature = ""
        cached = _read_cache(cache_path, signature) if signature else None
        used_cache = cached is not None

        original = loader.load_state_dict
        captured = {}
        try:
            if cached is None:

                def capture(*args, **kwargs):
                    state, config = original(*args, **kwargs)
                    captured["state"] = state
                    captured["config"] = config
                    return state, config

                loader.load_state_dict = capture
            else:

                def serve(*args, _cached=cached, **kwargs):
                    return _cached

                loader.load_state_dict = serve
            _model = loader.load_model(str(weights_path), device=device)
        finally:
            loader.load_state_dict = original

        if cached is None and signature and "state" in captured:
            threading.Thread(
                target=_write_cache,
                args=(cache_path, signature, captured["state"], captured["config"]),
                daemon=True,
            ).start()

        # The cache is a build input, not a second copy: release the mapping so the model
        # can still be deleted, and the checkpoint file replaced, while this worker is warm.
        cached = None
        captured = {}
        gc.collect()
        _processor = loader
    else:
        import torch
        from transformers import AutoProcessor, ParakeetForTDT

        _model = (
            ParakeetForTDT.from_pretrained(str(model_dir))
            .to(device=device, dtype=torch.float32)
            .eval()
        )
        _processor = AutoProcessor.from_pretrained(str(model_dir))

    _format = image_format
    return used_cache


def _transcribe(request):
    import numpy as np
    import soundfile as sf

    wave, rate = sf.read(request["wav"], dtype="float32", always_2d=True)
    wave = wave.mean(1)
    pad = float(request.get("pad") or 0)

    if _format == "bark":
        return _processor.transcribe(_model, wave, rate, pad_s=pad)

    import torch

    if rate != 16000:
        import soxr

        wave = soxr.resample(wave, rate, 16000)
    padded = np.concatenate([np.zeros(int(pad * 16000), np.float32), wave.astype(np.float32)])
    inputs = _processor([padded], sampling_rate=16000, return_tensors="pt", padding=True)
    device = next(_model.parameters()).device
    dtype = next(_model.parameters()).dtype
    inputs = {
        key: value
        if not value.is_floating_point()
        else value.to(device=device, dtype=dtype)
        for key, value in inputs.items()
    }
    with torch.inference_mode():
        out = _model.generate(**inputs)
    return _processor.batch_decode(out.sequences, skip_special_tokens=True)[0].strip()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except Exception as error:
            print(json.dumps({"ok": False, "error": _describe(error)}), flush=True)
            continue

        kind = request.get("type")
        if kind == "exit":
            return
        if kind == "load":
            try:
                used_cache = _load(request)
                print(
                    json.dumps({"ok": True, "cached": bool(used_cache)}), flush=True
                )
            except Exception as error:
                print(json.dumps({"ok": False, "error": _describe(error)}), flush=True)
            continue
        if kind == "transcribe":
            try:
                text = _transcribe(request)
                print(json.dumps({"id": request.get("id"), "text": text}), flush=True)
            except Exception as error:
                print(
                    json.dumps({"id": request.get("id"), "error": _describe(error)}),
                    flush=True,
                )
            continue
        print(json.dumps({"ok": False, "error": f"unknown request: {kind}"}), flush=True)


if __name__ == "__main__":
    main()
"#;

/// One live worker, tagged with the model and device it holds.
pub(crate) struct BarkWorker {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    stderr: Arc<Mutex<Vec<u8>>>,
    key: String,
    last_used: Instant,
    /// Last request id handed out, so a reply can be matched to its request.
    next_id: u64,
    /// True until this worker answers its first generation.
    first_generation: bool,
}

impl BarkWorker {
    fn send(&mut self, payload: &Value) -> Result<(), String> {
        let line =
            serde_json::to_string(payload).map_err(|e| format!("encode worker request: {e}"))?;
        self.stdin
            .write_all(line.as_bytes())
            .and_then(|()| self.stdin.write_all(b"\n"))
            .and_then(|()| self.stdin.flush())
            .map_err(|e| format!("write to the Bark worker: {e}"))
    }

    /// Waits for the reply that belongs to this request, skipping any other JSON
    /// object on stdout: on a cold start the loader is chatty, and a stray object
    /// must never be read as the answer to a generation.
    fn read_reply(
        &mut self,
        deadline: Duration,
        matches: impl Fn(&Value) -> bool,
    ) -> Result<Value, String> {
        let started = Instant::now();
        loop {
            let remaining = deadline.saturating_sub(started.elapsed());
            let timeout = || {
                format!(
                    "the Bark worker did not answer within {}s",
                    deadline.as_secs()
                )
            };
            if remaining.is_zero() {
                return Err(timeout());
            }
            match self.lines.recv_timeout(remaining) {
                Ok(line) => {
                    if let Some(reply) = accept_line(&line) {
                        if matches(&reply) {
                            return Ok(reply);
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => return Err(timeout()),
                Err(RecvTimeoutError::Disconnected) => return Err(self.crash()),
            }
        }
    }

    /// The id for the next request on this worker.
    fn reserve_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    /// Everything the worker wrote to stderr, trimmed for a report.
    fn stderr_tail(&self) -> String {
        let captured = self
            .stderr
            .lock()
            .map(|buffer| String::from_utf8_lossy(&buffer).into_owned())
            .unwrap_or_default();
        tail(captured.as_bytes(), 600).trim().to_string()
    }

    fn crash(&self) -> String {
        let detail = self.stderr_tail();
        if detail.is_empty() {
            "the Bark worker exited without a message".to_string()
        } else {
            format!("the Bark worker exited: {detail}")
        }
    }

    fn kill(&mut self) {
        let _ = self.stdin.write_all(b"{\"type\":\"exit\"}\n");
        let _ = self.stdin.flush();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for BarkWorker {
    fn drop(&mut self) {
        self.kill();
    }
}

fn spawn(python: &Path, runtime_dir: &Path, key: String) -> Result<BarkWorker, String> {
    let script: PathBuf = runtime_dir.join(SCRIPT);
    let differs = std::fs::read_to_string(&script)
        .map(|installed| installed != WORKER)
        .unwrap_or(true);
    if differs {
        std::fs::write(&script, WORKER).map_err(|e| format!("write {script:?}: {e}"))?;
    }

    let mut cmd = Command::new(python);
    cmd.arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("spawn python: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "the Bark worker has no stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "the Bark worker has no stdout".to_string())?;
    let stderr_stream = child.stderr.take();

    let (tx, lines) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if tx.send(line).is_err() {
                        return;
                    }
                }
                Err(_) => return,
            }
        }
    });

    let stderr = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&stderr);
    std::thread::spawn(move || {
        let Some(mut source) = stderr_stream else {
            return;
        };
        let mut chunk = [0u8; 1024];
        loop {
            match source.read(&mut chunk) {
                Ok(0) | Err(_) => return,
                Ok(read) => {
                    if let Ok(mut buffer) = sink.lock() {
                        let room = STDERR_CAP.saturating_sub(buffer.len());
                        buffer.extend_from_slice(&chunk[..read.min(room)]);
                    }
                }
            }
        }
    });

    Ok(BarkWorker {
        child,
        stdin,
        lines,
        stderr,
        key,
        last_used: Instant::now(),
        next_id: 0,
        first_generation: true,
    })
}

/// A reply is a JSON object on its own line; anything else is stray output.
fn accept_line(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    serde_json::from_str::<Value>(trimmed).ok().filter(Value::is_object)
}

/// A worker reported failure: the process is healthy, the request was not.
/// Silence is an empty transcript, not a failure: a window of a longer recording
/// may legitimately hold no speech, and only the caller can judge the whole run.
fn interpret(reply: &Value) -> Result<String, String> {
    if let Some(error) = reply.get("error").and_then(Value::as_str) {
        return Err(error.to_string());
    }
    Ok(reply
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string())
}

/// True when this line is the reply to request `id`.
fn replies_to(reply: &Value, id: u64) -> bool {
    reply.get("id").and_then(Value::as_u64) == Some(id)
}

/// True when this line answers a load request.
fn is_load_reply(reply: &Value) -> bool {
    reply.get("ok").is_some()
}

/// True when a cold worker's very first generation came back with no text and is
/// worth one more attempt. A warm empty result is a silent recording, which only
/// the caller can judge, so it is never retried here.
fn should_retry_cold(cold: bool, first_generation: bool, text: &str) -> bool {
    cold && first_generation && text.trim().is_empty()
}

fn millis(elapsed: Duration) -> u64 {
    elapsed.as_millis() as u64
}

/// What one worker call did, returned even when the generation failed so the UI
/// can prove where a cold start spent its time instead of guessing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarkRun {
    pub text: String,
    /// The worker was spawned for this call: nothing was warm.
    pub cold: bool,
    /// "hit" (a decoded checkpoint was read), "decode" (weights decoded), "warm".
    pub cache: String,
    pub spawn_ms: u64,
    pub load_ms: u64,
    pub transcribe_ms: u64,
    /// 2 when a cold first generation came back empty and was retried.
    pub attempts: u32,
    /// Worker stderr tail, present only when the run failed.
    pub stderr_tail: String,
    /// Why the generation failed, when it did.
    pub error: Option<String>,
}

/// Everything one transcription needs, with the model identity that keys the worker.
pub(crate) struct Transcription<'a> {
    pub python: &'a Path,
    pub runtime_dir: &'a Path,
    pub key: String,
    pub load: Value,
    pub request: Value,
}

/// The single warm worker the app keeps alive for Bark.
#[derive(Clone, Default)]
pub struct BarkWorkers(pub Arc<Mutex<Option<BarkWorker>>>);

/// One generation on one worker, matched to its own request id. A transcription
/// request is cloned per attempt so the retry cannot reuse an answered id.
fn generate(worker: &mut BarkWorker, request: &Value) -> Result<String, String> {
    let id = worker.reserve_id();
    let mut payload = request.clone();
    payload["id"] = json!(id);
    worker.send(&payload)?;
    let reply = worker.read_reply(TRANSCRIBE_DEADLINE, |reply| replies_to(reply, id))?;
    interpret(&reply)
}

impl BarkWorkers {
    /// Run one transcription, replacing the worker when the model or device changes.
    ///
    /// A freshly spawned worker's first generation is retried once if it comes back
    /// empty: a cold model has been seen to answer nothing on its first call, and an
    /// empty first window must never reach the user as silence. Every step is timed
    /// and returned, so the UI can prove a cold boot, a cache read and the cost of
    /// each generation.
    pub fn run(&self, job: Transcription<'_>) -> Result<BarkRun, String> {
        let mut guard = self.registry();
        let mut cold = false;
        let mut cache = "warm".to_string();
        let mut spawn_ms = 0;
        let mut load_ms = 0;

        let stale = match guard.as_ref() {
            Some(worker) => worker.key != job.key,
            None => true,
        };
        if stale {
            if let Some(mut previous) = guard.take() {
                previous.kill();
            }
            let spawned_at = Instant::now();
            let mut fresh = spawn(job.python, job.runtime_dir, job.key.clone())?;
            spawn_ms = millis(spawned_at.elapsed());

            let loaded_at = Instant::now();
            fresh.send(&job.load)?;
            let reply = fresh.read_reply(LOAD_DEADLINE, is_load_reply)?;
            load_ms = millis(loaded_at.elapsed());
            cold = true;
            cache = match reply.get("cached").and_then(Value::as_bool) {
                Some(true) => "hit".to_string(),
                Some(false) => "decode".to_string(),
                None => "unknown".to_string(),
            };
            if reply.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err(reply
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("the Bark worker refused the model")
                    .to_string());
            }
            *guard = Some(fresh);
            start_reaper(&self.0);
        }

        let Some(worker) = guard.as_mut() else {
            return Err("the Bark worker vanished".to_string());
        };
        worker.last_used = Instant::now();
        let first_generation = worker.first_generation;
        let generated_at = Instant::now();

        let first = generate(worker, &job.request);
        let retry = matches!(&first, Ok(text) if should_retry_cold(cold, first_generation, text));
        let (outcome, attempts) = if retry {
            (generate(worker, &job.request), 2)
        } else {
            (first, 1)
        };
        worker.first_generation = false;
        let transcribe_ms = millis(generated_at.elapsed());

        match outcome {
            Ok(text) => Ok(BarkRun {
                text,
                cold,
                cache,
                spawn_ms,
                load_ms,
                transcribe_ms,
                attempts,
                stderr_tail: String::new(),
                error: None,
            }),
            Err(error) => {
                let stderr_tail = worker.stderr_tail();
                guard.take();
                Ok(BarkRun {
                    text: String::new(),
                    cold,
                    cache,
                    spawn_ms,
                    load_ms,
                    transcribe_ms,
                    attempts,
                    stderr_tail,
                    error: Some(error),
                })
            }
        }
    }

    /// Stop the worker, e.g. when the app is closing. Never waits for a
    /// transcription in flight: the worker also exits when our pipes close.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.0.try_lock() {
            guard.take();
        }
    }

    fn registry(&self) -> MutexGuard<'_, Option<BarkWorker>> {
        // A panic elsewhere must not leave Bark unusable for the rest of the session.
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn start_reaper(registry: &Arc<Mutex<Option<BarkWorker>>>) {
    if REAPER.swap(true, Ordering::SeqCst) {
        return;
    }
    let shared = Arc::clone(registry);
    std::thread::spawn(move || loop {
        std::thread::sleep(REAP_INTERVAL);
        let Ok(mut guard) = shared.lock() else {
            return;
        };
        let idle = match guard.as_ref() {
            Some(worker) => worker.last_used.elapsed() >= IDLE_TIMEOUT,
            None => false,
        };
        if idle {
            guard.take();
        }
    });
}

/// Request that loads a model into the worker.
pub(crate) fn load_request(
    format: &str,
    model_dir: &Path,
    weights: &str,
    loader: &str,
    device: &str,
) -> Value {
    json!({
        "type": "load",
        "format": format,
        "modelDir": model_dir.to_string_lossy(),
        "weights": weights,
        "loader": loader,
        "device": device,
    })
}

/// Request that transcribes one WAV file. The request id is assigned per attempt
/// by `run`, so a reply can only answer the request that asked for it.
pub(crate) fn transcribe_request(audio: &Path, padding_seconds: f64) -> Value {
    json!({
        "type": "transcribe",
        "wav": audio.to_string_lossy(),
        "pad": padding_seconds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_healthy_worker_error_keeps_its_text_out_of_the_way() {
        assert_eq!(interpret(&json!({ "text": " hello " })).unwrap(), "hello");
        // Silence returns empty text: the whole-run decision belongs to the caller.
        assert_eq!(interpret(&json!({ "text": "   " })).unwrap(), "");
        assert_eq!(
            interpret(&json!({ "error": "RuntimeError: boom" })).unwrap_err(),
            "RuntimeError: boom"
        );
    }

    #[test]
    fn the_worker_script_covers_both_packagings() {
        assert!(WORKER.contains("loader.load_model"), "archive path");
        assert!(
            WORKER.contains("ParakeetForTDT.from_pretrained"),
            "checkpoint path"
        );
        assert!(!WORKER.contains("import librosa"));
    }

    #[test]
    fn the_worker_script_caches_the_decoded_checkpoint() {
        // The decode is the expensive half of a load, so its result is kept beside the
        // checkpoint and read back instead of decoded again on every later start.
        assert!(WORKER.contains(r#"CACHE_SUFFIX = ".decoded.pt""#), "cache file");
        assert!(WORKER.contains("mmap=True"), "cache read is mapped");
        assert!(WORKER.contains("os.replace(part, path)"), "cache write is atomic");
        assert!(WORKER.contains("def _prune_caches"), "one cache per engine");
        assert!(
            WORKER.contains("if cached is None and signature"),
            "a decode that was already cached is never written twice"
        );
        assert!(
            WORKER.contains("except Exception:\n        return None"),
            "a broken cache answers None so the decode still runs"
        );
        assert!(
            WORKER.contains("loader.load_state_dict = original"),
            "the loader's own decode is restored after the build"
        );
        assert!(
            WORKER.contains("return used_cache"),
            "the load reports whether it read the decoded checkpoint"
        );
        assert!(
            WORKER.contains(r#""cached": bool(used_cache)"#),
            "the load reply carries the cache verdict"
        );
    }

    #[test]
    fn stray_output_never_counts_as_a_reply() {
        assert!(accept_line("Loading weights...").is_none());
        assert!(accept_line("[1, 2]").is_none());
        assert!(accept_line("42").is_none());
        assert!(accept_line("{ not json }").is_none());
        assert_eq!(accept_line(r#"{"ok": true}"#).unwrap()["ok"], true);
    }

    #[test]
    fn only_the_reply_to_the_request_that_asked_counts() {
        // A cold loader can print JSON of its own; that object must never be read as
        // the answer to the generation that follows it.
        assert!(!replies_to(&json!({ "model": "bark", "layers": 12 }), 1));
        assert!(!replies_to(&json!({ "id": 2, "text": "another request" }), 1));
        assert!(replies_to(&json!({ "id": 1, "text": "" }), 1));
        assert!(!replies_to(&json!({ "id": "1", "text": "" }), 1));
    }

    #[test]
    fn a_load_reply_is_the_one_carrying_ok() {
        assert!(is_load_reply(&json!({ "ok": true, "cached": true })));
        assert!(is_load_reply(&json!({ "ok": false, "error": "boom" })));
        assert!(!is_load_reply(&json!({ "id": 1, "text": "hello" })));
        assert!(!is_load_reply(&json!({ "model": "bark" })));
    }

    #[test]
    fn only_a_cold_first_empty_generation_is_retried() {
        assert!(should_retry_cold(true, true, ""));
        assert!(should_retry_cold(true, true, "   \n"));
        assert!(!should_retry_cold(false, true, ""), "a warm empty result is silence");
        assert!(!should_retry_cold(true, false, ""), "only the first generation");
        assert!(!should_retry_cold(true, true, "hello"));
    }

    #[test]
    fn a_run_carries_its_boot_and_timings() {
        let run = BarkRun {
            text: "hello".to_string(),
            cold: true,
            cache: "hit".to_string(),
            spawn_ms: 412,
            load_ms: 41_200,
            transcribe_ms: 3_100,
            attempts: 2,
            stderr_tail: String::new(),
            error: None,
        };
        let value = serde_json::to_value(&run).expect("a run serializes");
        assert_eq!(value["cold"], true);
        assert_eq!(value["cache"], "hit");
        assert_eq!(value["spawnMs"], 412);
        assert_eq!(value["loadMs"], 41_200);
        assert_eq!(value["transcribeMs"], 3_100);
        assert_eq!(value["attempts"], 2);
        assert!(value.get("error").is_some(), "the error field is always present");
    }

    #[test]
    fn load_requests_carry_the_model_identity() {
        let request = load_request(
            "safetensors",
            Path::new("/voice/models/bark/acme@abc"),
            "model.safetensors",
            "",
            "cpu",
        );
        assert_eq!(request["type"], "load");
        assert_eq!(request["format"], "safetensors");
        assert_eq!(request["modelDir"], "/voice/models/bark/acme@abc");
        assert_eq!(request["device"], "cpu");
    }

    #[test]
    fn transcribe_requests_carry_the_audio_and_padding() {
        let request = transcribe_request(Path::new("/tmp/input.wav"), 0.25);
        assert_eq!(request["type"], "transcribe");
        assert_eq!(request["wav"], "/tmp/input.wav");
        assert_eq!(request["pad"], 0.25);
    }
}
