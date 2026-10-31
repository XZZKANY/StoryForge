//! 设置页「获取模型」：用界面里还没保存的服务商 / 地址 / Key 发一次 GET {地址}/models。
//! 草稿不落盘；Key 不写日志、不回显，网络错误文本里出现的 Key 一律换成占位串。
//! Key 留空时可以借用某套已存的 Key，但只许发往那套已存地址的同一来源，免得界面把密钥带去别处。
use crate::engine_llm::{innermost, scrub_text, EngineLlmState};
use crate::host_error::HostError;
use crate::{llm_config, llm_config_store};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, State};

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_MODELS: usize = 500;
const NOT_A_MODEL_LIST: &str =
    "返回的不是模型列表：检查服务地址是否填对（兼容服务的地址通常以 /v1 结尾）。";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftProbeRequest {
    pub(crate) provider: String,
    pub(crate) base_url: String,
    pub(crate) api_key: Option<String>,
    pub(crate) profile_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftProbeResponse {
    pub(crate) models: Vec<String>,
    pub(crate) partial: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Family {
    OpenAi,
    Anthropic,
    Gemini,
}

// 与引擎 providerFamily 同一套归类：其余服务商都按 OpenAI 兼容协议探测。
pub(crate) fn family(provider: &str) -> Family {
    match provider.trim().to_ascii_lowercase().as_str() {
        "anthropic" | "claude" => Family::Anthropic,
        "gemini" | "google" => Family::Gemini,
        _ => Family::OpenAi,
    }
}

fn http_url(text: &str) -> Option<Url> {
    let url = Url::parse(text.trim()).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then_some(url)
}

fn draft_key(config_path: &Path, request: &DraftProbeRequest) -> Result<Option<String>, HostError> {
    let typed = request.api_key.as_deref().map(str::trim);
    if let Some(key) = typed.filter(|key| !key.is_empty()) {
        return Ok(Some(key.to_string()));
    }
    let Some(id) = request.profile_id.as_deref() else {
        return Ok(None);
    };
    let stored = llm_config_store::read_revealed_profile(config_path, id)
        .map_err(|error| HostError::new("misconfigured", error.to_string()))?;
    let same_origin = match (http_url(&stored.base_url), http_url(&request.base_url)) {
        (Some(saved), Some(draft)) => saved.origin() == draft.origin(),
        _ => false,
    };
    if stored.api_key.is_some() && !same_origin {
        return Err(HostError::new(
            "misconfigured",
            "改了服务地址就要重新贴一次 Key：已存的 Key 只会发往原来的地址。",
        ));
    }
    Ok(stored.api_key)
}

fn header(
    name: &str,
    value: &str,
    sensitive: bool,
) -> Result<(HeaderName, HeaderValue), HostError> {
    let name = HeaderName::from_bytes(name.as_bytes())
        .map_err(|_| HostError::new("misconfigured", "请求头名称无效。"))?;
    // The value may hold the key: never echo it in the error.
    let mut value = HeaderValue::from_str(value)
        .map_err(|_| HostError::new("misconfigured", "Key 里有不能用的字符，请重新复制。"))?;
    value.set_sensitive(sensitive);
    Ok((name, value))
}

pub(crate) fn prepare(
    family: Family,
    base_url: &str,
    key: Option<&str>,
    auth_header: Option<&str>,
    app_version: &str,
) -> Result<(Url, HeaderMap), HostError> {
    let mut url = http_url(base_url).ok_or_else(|| {
        HostError::new("misconfigured", "服务地址要以 http:// 或 https:// 开头。")
    })?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(HostError::new(
            "misconfigured",
            "服务地址里不能带用户名或密码。",
        ));
    }
    if key.is_some_and(|key| base_url.contains(key)) {
        return Err(HostError::new(
            "misconfigured",
            "服务地址里不能带 Key，Key 请填在 Key 那一栏。",
        ));
    }
    let path = format!("{}/models", url.path().trim_end_matches('/'));
    url.set_path(&path);
    url.set_fragment(None);
    let mut headers = HeaderMap::new();
    let mut add = |name: &str, value: &str, sensitive: bool| {
        header(name, value, sensitive).map(|(name, value)| headers.append(name, value))
    };
    add("user-agent", &format!("StoryForge/{app_version}"), false)?;
    if let Some(key) = key {
        match family {
            Family::Anthropic => {
                add("x-api-key", key, true)?;
                add("anthropic-version", "2023-06-01", false)?;
            }
            Family::Gemini => {
                add("x-goog-api-key", key, true)?;
            }
            Family::OpenAi => {
                let api_key_header =
                    auth_header.is_some_and(|value| value.trim().eq_ignore_ascii_case("api-key"));
                if api_key_header {
                    add("api-key", key, true)?;
                } else {
                    add("authorization", &format!("Bearer {key}"), true)?;
                }
            }
        }
    }
    Ok((url, headers))
}

pub(crate) fn decode(
    body: &[u8],
    family: Family,
    key: Option<&str>,
) -> Result<DraftProbeResponse, HostError> {
    let invalid = || HostError::new("unreachable", NOT_A_MODEL_LIST);
    let data: Value = serde_json::from_slice(body).map_err(|_| invalid())?;
    let (list_key, id_key) = match family {
        Family::Gemini => ("models", "name"),
        _ => ("data", "id"),
    };
    let entries = data
        .get(list_key)
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    let mut models: Vec<String> = Vec::new();
    for entry in entries {
        let Some(name) = entry.get(id_key).and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        let name = match family {
            Family::Gemini => name.strip_prefix("models/").unwrap_or(name),
            _ => name,
        };
        let name = scrub_text(name, key);
        if !name.is_empty() && models.len() < MAX_MODELS && !models.contains(&name) {
            models.push(name);
        }
    }
    if models.is_empty() && !entries.is_empty() {
        return Err(invalid());
    }
    let more = data.get("has_more") == Some(&Value::Bool(true))
        || data
            .get("nextPageToken")
            .is_some_and(|token| token.as_str().is_some_and(|text| !text.is_empty()));
    Ok(DraftProbeResponse {
        partial: more || entries.len() > MAX_MODELS,
        models,
    })
}

async fn fetch(
    client: &reqwest::Client,
    url: Url,
    headers: HeaderMap,
    key: Option<&str>,
) -> Result<Vec<u8>, HostError> {
    let mut response = match client.get(url).headers(headers).send().await {
        Ok(response) => response,
        Err(error) if error.is_connect() => {
            return Err(HostError::new(
                "unreachable",
                format!("连不上服务地址：{}", scrub_text(&innermost(&error), key)),
            ))
        }
        Err(_) => {
            return Err(HostError::new(
                "unreachable",
                "请求没发出去或中途断开了，检查网络或服务地址。",
            ))
        }
    };
    // 不读出错响应的正文：有的服务会把收到的 Key 原样写进错误信息。
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return Err(HostError::new(
            "unauthorized",
            format!("Key 不对或没有权限（HTTP {status}）。"),
        ));
    }
    if status == 404 {
        return Err(HostError::new(
            "unreachable",
            "这个地址下找不到模型列表（HTTP 404）：检查服务地址，兼容服务的地址通常以 /v1 结尾。",
        ));
    }
    if !(200..300).contains(&status) {
        return Err(HostError::new(
            "unreachable",
            format!("服务返回 HTTP {status}。"),
        ));
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(bytes)) => {
                body.extend_from_slice(&bytes);
                if body.len() > MAX_BODY_BYTES {
                    return Err(HostError::new("unreachable", "模型列表太大，读不完。"));
                }
            }
            Ok(None) => return Ok(body),
            Err(_) => return Err(HostError::new("unreachable", "读取模型列表时连接断开了。")),
        }
    }
}

pub(crate) async fn run(
    config_path: &Path,
    client: &reqwest::Client,
    request: DraftProbeRequest,
    app_version: &str,
    auth_header: Option<&str>,
) -> Result<DraftProbeResponse, HostError> {
    let key = draft_key(config_path, &request)?;
    let family = family(&request.provider);
    let (url, headers) = prepare(
        family,
        &request.base_url,
        key.as_deref(),
        auth_header,
        app_version,
    )?;
    let body = tokio::time::timeout(PROBE_TIMEOUT, fetch(client, url, headers, key.as_deref()))
        .await
        .map_err(|_| HostError::new("unreachable", "15 秒内没有响应，检查网络或服务地址。"))??;
    decode(&body, family, key.as_deref())
}

#[tauri::command]
pub async fn probe_llm_draft(
    app: AppHandle,
    state: State<'_, EngineLlmState>,
    payload: DraftProbeRequest,
) -> Result<DraftProbeResponse, HostError> {
    let path = llm_config::config_path(&app)
        .map_err(|error| HostError::new("misconfigured", error.to_string()))?;
    let client = state
        .client()
        .map_err(|_| HostError::new("unreachable", "无法创建网络连接。"))?;
    let version = app.package_info().version.to_string();
    let auth_header = std::env::var("STORYFORGE_LLM_AUTH_HEADER").ok();
    run(&path, &client, payload, &version, auth_header.as_deref()).await
}

#[cfg(test)]
#[path = "llm_draft_probe_tests.rs"]
mod tests;
