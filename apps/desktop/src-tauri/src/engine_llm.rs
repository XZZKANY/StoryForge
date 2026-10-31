//! Engine LLM egress. The WebView engine only ever holds `CREDENTIAL_PLACEHOLDER`:
//! Rust swaps it for the decrypted key inside credential headers, sends only to the
//! configured base URL origin, and maps any echo of the key in responses back.
use crate::host_error::HostError;
use crate::llm_config;
use crate::llm_config_store::{self, RevealedSlot};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::error::Error as StdError;
use std::io::ErrorKind;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

pub const CREDENTIAL_PLACEHOLDER: &str = "[已隐藏的密钥]";
const CREDENTIAL_HEADERS: [&str; 4] = ["authorization", "api-key", "x-api-key", "x-goog-api-key"];
// Python's redact_secrets only treats values of at least 6 characters as secrets.
const MIN_SECRET_CHARS: usize = 6;
const MAX_REDIRECTS: usize = 10;
const TIMEOUT_KEY: &str = "STORYFORGE_LLM_TIMEOUT_SECONDS";
// pydantic-settings default the managed sidecar uses when the environment leaves it blank.
const DEFAULT_TIMEOUT: &str = "60.0";
// Non-secret tuning values the Python sidecar inherits from this process environment.
const TUNING_ENV_KEYS: [&str; 15] = [
    "STORYFORGE_LLM_TEMPERATURE",
    TIMEOUT_KEY,
    "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS",
    "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS",
    "STORYFORGE_LLM_RETRY_JITTER_SECONDS",
    "STORYFORGE_LLM_MAX_COMPLETION_TOKENS",
    "STORYFORGE_LLM_REASONING_EFFORT",
    "STORYFORGE_LLM_AUTH_HEADER",
    "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS",
    "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS",
    "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS",
    "STORYFORGE_LLM_SMOKE_TIME_BUDGET_SECONDS",
    "STORYFORGE_LLM_SMOKE_RECAP_FULL_CHAPTERS",
    "STORYFORGE_LLM_SMOKE_FAST_JUDGE",
    "STORYFORGE_LLM_SMOKE_MAX_CHAPTER_COUNT",
];
const PLACEHOLDER_MISPLACED: &str = "占位密钥只能出现在鉴权请求头里。";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LlmSlot {
    Main,
    Polish,
}

fn refused(message: &str) -> HostError {
    HostError::new("refused", message)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub body: Option<String>,
    pub timeout_seconds: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineHttpHead {
    id: u64,
    status: u16,
    headers: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum BodyEvent {
    Chunk { data: String },
    End,
    Error { kind: &'static str, detail: String },
}

pub(crate) struct Outbound {
    pub url: Url,
    pub method: Method,
    pub headers: HeaderMap,
    pub body: Option<Vec<u8>>,
    pub timeout: Duration,
}

/// Same shape as the managed sidecar's resolved source; the key is only a placeholder.
pub(crate) fn engine_source(
    slot: Option<&RevealedSlot>,
    polish: bool,
    env: impl Fn(&str) -> Option<String>,
) -> BTreeMap<String, String> {
    let mut source = BTreeMap::new();
    if !polish {
        for key in TUNING_ENV_KEYS {
            if let Some(value) = env(key) {
                source.insert(key.to_string(), value);
            }
        }
        if source
            .get(TIMEOUT_KEY)
            .is_none_or(|value| value.trim().is_empty())
        {
            source.insert(TIMEOUT_KEY.into(), DEFAULT_TIMEOUT.into());
        }
    }
    let (provider, base_url, model) = slot.map_or(("", "", ""), |slot| {
        (
            slot.provider.as_str(),
            slot.base_url.as_str(),
            slot.model.as_str(),
        )
    });
    let credential = if slot.is_some_and(|slot| slot.api_key.is_some()) {
        CREDENTIAL_PLACEHOLDER
    } else {
        ""
    };
    for (key, value) in [
        ("STORYFORGE_LLM_PROVIDER", provider),
        ("STORYFORGE_LLM_BASE_URL", base_url),
        ("STORYFORGE_LLM_API_BASE_URL", base_url),
        ("STORYFORGE_LLM_MODEL", model),
        ("STORYFORGE_LLM_API_KEY", credential),
    ] {
        source.insert(key.into(), value.into());
    }
    source
}

fn http_url(text: &str) -> Option<Url> {
    let url = Url::parse(text).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

pub(crate) fn prepare(
    slot: &RevealedSlot,
    request: EngineHttpRequest,
) -> Result<Outbound, HostError> {
    let base = http_url(&slot.base_url)
        .ok_or_else(|| refused("尚未配置有效的模型 base URL；请在设置中检查后重试。"))?;
    let url = http_url(&request.url).ok_or_else(|| refused("模型请求地址无效。"))?;
    if url.origin() != base.origin() || !url.username().is_empty() || url.password().is_some() {
        return Err(refused(
            "模型请求只能发往已配置的 base URL；配置若刚改过，请重试。",
        ));
    }
    let method = match request.method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => return Err(refused("模型请求方法只支持 GET / POST。")),
    };
    let timeout = Some(request.timeout_seconds)
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
        .and_then(|seconds| Duration::try_from_secs_f64(seconds).ok())
        .ok_or_else(|| refused("模型请求超时设置无效。"))?;
    let body = request
        .body
        .map(|text| STANDARD.decode(text))
        .transpose()
        .map_err(|_| refused("模型请求体编码无效。"))?;
    let placeholder = CREDENTIAL_PLACEHOLDER.as_bytes();
    if request.url.contains(CREDENTIAL_PLACEHOLDER)
        || body
            .as_deref()
            .is_some_and(|bytes| find(bytes, placeholder).is_some())
    {
        return Err(refused(PLACEHOLDER_MISPLACED));
    }
    let mut headers = HeaderMap::new();
    for (name, value) in request.headers {
        let carries = value.contains(CREDENTIAL_PLACEHOLDER);
        if carries && !CREDENTIAL_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
            return Err(refused(PLACEHOLDER_MISPLACED));
        }
        let value = if carries {
            let key = slot
                .api_key
                .as_deref()
                .ok_or_else(|| refused("LLM 配置里已没有密钥；请在设置中重新输入后重试。"))?;
            value.replace(CREDENTIAL_PLACEHOLDER, key)
        } else {
            value
        };
        let name =
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| refused("模型请求头名称无效。"))?;
        // The value may hold the real key: never echo it in the error.
        let mut value =
            HeaderValue::from_str(&value).map_err(|_| refused("模型请求头取值无效。"))?;
        value.set_sensitive(carries);
        headers.append(name, value);
    }
    Ok(Outbound {
        url,
        method,
        headers,
        body,
        timeout,
    })
}

fn qualified_key(key: Option<&str>) -> Option<&str> {
    key.filter(|key| key.chars().count() >= MIN_SECRET_CHARS)
}

pub(crate) fn scrub_text(text: &str, key: Option<&str>) -> String {
    match qualified_key(key) {
        Some(key) => text.replace(key, CREDENTIAL_PLACEHOLDER),
        None => text.to_string(),
    }
}

// Longest suffix of `data` that is a proper prefix of `needle`.
fn partial_suffix(data: &[u8], needle: &[u8]) -> usize {
    let longest = data.len().min(needle.len() - 1);
    (1..=longest)
        .rev()
        .find(|&size| data.ends_with(&needle[..size]))
        .unwrap_or(0)
}

/// Replaces key echoes across chunk boundaries. Only a tail that could still grow into
/// the key is held back, so ordinary SSE frames are forwarded without delay.
pub(crate) struct EchoScrubber {
    needle: Vec<u8>,
    pending: Vec<u8>,
}

impl EchoScrubber {
    pub(crate) fn new(key: Option<&str>) -> Self {
        Self {
            needle: qualified_key(key)
                .map(|key| key.as_bytes().to_vec())
                .unwrap_or_default(),
            pending: Vec::new(),
        }
    }

    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Vec<u8> {
        if self.needle.is_empty() {
            return chunk.to_vec();
        }
        let mut buffer = std::mem::take(&mut self.pending);
        buffer.extend_from_slice(chunk);
        let mut output = Vec::with_capacity(buffer.len());
        let mut start = 0;
        while let Some(index) = find(&buffer[start..], &self.needle) {
            output.extend_from_slice(&buffer[start..start + index]);
            output.extend_from_slice(CREDENTIAL_PLACEHOLDER.as_bytes());
            start += index + self.needle.len();
        }
        let rest = &buffer[start..];
        let held = partial_suffix(rest, &self.needle);
        output.extend_from_slice(&rest[..rest.len() - held]);
        self.pending = rest[rest.len() - held..].to_vec();
        output
    }

    /// A body that ends inside an echo must not leak a key prefix long enough to be a secret.
    pub(crate) fn finish(&mut self) -> Vec<u8> {
        let tail = std::mem::take(&mut self.pending);
        if String::from_utf8_lossy(&tail).chars().count() >= MIN_SECRET_CHARS {
            CREDENTIAL_PLACEHOLDER.as_bytes().to_vec()
        } else {
            tail
        }
    }
}

pub(crate) fn build_client(system_proxy: bool) -> reqwest::Result<reqwest::Client> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        let same_origin = attempt
            .previous()
            .first()
            .is_some_and(|first| first.origin() == attempt.url().origin());
        if same_origin && attempt.previous().len() <= MAX_REDIRECTS {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    let builder = reqwest::Client::builder().redirect(policy);
    if system_proxy {
        builder.build()
    } else {
        builder.no_proxy().build()
    }
}

pub(crate) fn innermost(error: &(dyn StdError + 'static)) -> String {
    let mut current = error;
    while let Some(source) = current.source() {
        current = source;
    }
    current.to_string()
}

// Python exception names, as the engine reports broken reads.
fn python_read_error(error: &reqwest::Error, fallback: &str) -> String {
    let mut current: Option<&(dyn StdError + 'static)> = Some(error);
    while let Some(error) = current {
        if let Some(io) = error.downcast_ref::<std::io::Error>() {
            match io.kind() {
                ErrorKind::ConnectionReset => return "ConnectionResetError".into(),
                ErrorKind::ConnectionAborted => return "ConnectionAbortedError".into(),
                ErrorKind::BrokenPipe => return "BrokenPipeError".into(),
                _ => break,
            }
        }
        current = error.source();
    }
    fallback.into()
}

pub(crate) struct Head {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
}

/// Status codes are returned, never raised; only network failures are errors.
pub(crate) async fn open(
    client: &reqwest::Client,
    outbound: Outbound,
    key: Option<&str>,
) -> Result<(Head, reqwest::Response), HostError> {
    let mut builder = client
        .request(outbound.method, outbound.url)
        .headers(outbound.headers);
    if let Some(body) = outbound.body {
        builder = builder.body(body);
    }
    let response = match tokio::time::timeout(outbound.timeout, builder.send()).await {
        Err(_) => return Err(HostError::new("timeout", "timed out")),
        Ok(Err(error)) if error.is_connect() => {
            return Err(HostError::new(
                "connect",
                scrub_text(&innermost(&error), key),
            ))
        }
        Ok(Err(error)) => {
            return Err(HostError::new(
                "read",
                python_read_error(&error, "RemoteDisconnected"),
            ))
        }
        Ok(Ok(response)) => response,
    };
    let mut headers = BTreeMap::new();
    for (name, value) in response.headers() {
        headers
            .entry(name.as_str().to_string())
            .or_insert_with(|| scrub_text(&String::from_utf8_lossy(value.as_bytes()), key));
    }
    let status = response.status().as_u16();
    Ok((Head { status, headers }, response))
}

/// Each chunk read is bounded by the request timeout, like Python's socket timeout.
pub(crate) async fn pump(
    mut response: reqwest::Response,
    timeout: Duration,
    key: Option<&str>,
    mut emit: impl FnMut(BodyEvent) -> bool,
) {
    let mut scrubber = EchoScrubber::new(key);
    loop {
        match tokio::time::timeout(timeout, response.chunk()).await {
            Ok(Ok(Some(bytes))) => {
                let visible = scrubber.feed(&bytes);
                if !visible.is_empty()
                    && !emit(BodyEvent::Chunk {
                        data: STANDARD.encode(visible),
                    })
                {
                    return;
                }
            }
            Ok(Ok(None)) => {
                let tail = scrubber.finish();
                if tail.is_empty()
                    || emit(BodyEvent::Chunk {
                        data: STANDARD.encode(tail),
                    })
                {
                    emit(BodyEvent::End);
                }
                return;
            }
            Ok(Err(error)) => {
                emit(BodyEvent::Error {
                    kind: "read",
                    detail: python_read_error(&error, "IncompleteRead"),
                });
                return;
            }
            Err(_) => {
                emit(BodyEvent::Error {
                    kind: "timeout",
                    detail: "timed out".into(),
                });
                return;
            }
        }
    }
}

#[derive(Default)]
pub struct EngineLlmState {
    next_id: AtomicU64,
    bodies: Mutex<HashMap<u64, tauri::async_runtime::JoinHandle<()>>>,
    client: OnceLock<reqwest::Client>,
}

impl EngineLlmState {
    pub(crate) fn client(&self) -> Result<reqwest::Client, HostError> {
        if let Some(client) = self.client.get() {
            return Ok(client.clone());
        }
        let client =
            build_client(true).map_err(|error| HostError::new("connect", innermost(&error)))?;
        Ok(self.client.get_or_init(|| client).clone())
    }
}

fn revealed_slot(app: &AppHandle, slot: LlmSlot) -> Result<RevealedSlot, HostError> {
    llm_config::config_path(app)
        .and_then(|path| llm_config_store::read_revealed_slot(&path, slot == LlmSlot::Polish))
        .map_err(|error| HostError::new("config", error.to_string()))
}

#[tauri::command]
pub fn get_engine_llm_source(
    app: AppHandle,
    slot: LlmSlot,
) -> Result<BTreeMap<String, String>, HostError> {
    let revealed = revealed_slot(&app, slot)?;
    Ok(engine_source(
        Some(&revealed),
        slot == LlmSlot::Polish,
        |key| std::env::var(key).ok(),
    ))
}

#[tauri::command]
pub async fn engine_llm_send(
    app: AppHandle,
    state: State<'_, EngineLlmState>,
    slot: LlmSlot,
    request: EngineHttpRequest,
    on_body: Channel<BodyEvent>,
) -> Result<EngineHttpHead, HostError> {
    let revealed = revealed_slot(&app, slot)?;
    let outbound = prepare(&revealed, request)?;
    let timeout = outbound.timeout;
    let key = revealed.api_key;
    let (head, response) = open(&state.client()?, outbound, key.as_deref()).await?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let handle = app.clone();
    // Hold the lock while spawning so the task's own cleanup cannot run before the insert.
    let mut bodies = state
        .bodies
        .lock()
        .map_err(|_| HostError::new("read", "EngineLlmStateLock"))?;
    bodies.insert(
        id,
        tauri::async_runtime::spawn(async move {
            pump(response, timeout, key.as_deref(), |event| {
                on_body.send(event).is_ok()
            })
            .await;
            if let Ok(mut bodies) = handle.state::<EngineLlmState>().bodies.lock() {
                bodies.remove(&id);
            }
        }),
    );
    Ok(EngineHttpHead {
        id,
        status: head.status,
        headers: head.headers,
    })
}

#[tauri::command]
pub fn engine_llm_close(state: State<'_, EngineLlmState>, id: u64) {
    let task = state
        .bodies
        .lock()
        .ok()
        .and_then(|mut bodies| bodies.remove(&id));
    if let Some(task) = task {
        task.abort();
    }
}

#[cfg(test)]
#[path = "engine_llm_tests.rs"]
mod tests;
