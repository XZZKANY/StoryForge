//! 联网搜索的固定出网口：密钥只在宿主解密，不接受模型提供的地址或请求头。
mod openai;
mod store;

use chrono::{SecondsFormat, Utc};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::IpAddr;
use std::path::PathBuf;
use std::time::Duration;
use tauri::AppHandle;

pub use store::{ConfigView, SaveConfig};
use store::{SearchAccess, SearchProvider};
const ENDPOINT: &str = "https://api.tavily.com/search";
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    query: String,
    max_results: Option<u8>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    query: String,
    results: Vec<SearchResult>,
    searched_at: String,
    provider: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    crate::runtime_paths::app_config_dir(app)
        .map(|directory| directory.join("web-search.json"))
        .map_err(|_| "无法获取联网搜索配置目录。".into())
}

#[tauri::command]
pub fn web_search_get_config(app: AppHandle) -> Result<ConfigView, String> {
    let view = store::get(&config_path(&app)?)?;
    Ok(openai::config_view(view, active_openai(&app).as_ref().ok()))
}

#[tauri::command]
pub fn web_search_save_config(app: AppHandle, request: SaveConfig) -> Result<ConfigView, String> {
    let path = config_path(&app)?;
    let provider = request.provider.unwrap_or(store::get(&path)?.provider);
    let slot = active_openai(&app);
    if provider == SearchProvider::Openai && request.enabled {
        slot.as_ref().map_err(Clone::clone)?;
    }
    Ok(openai::config_view(
        store::save(&path, request)?,
        slot.as_ref().ok(),
    ))
}

fn active_openai(app: &AppHandle) -> Result<crate::llm_config_store::RevealedSlot, String> {
    let path = crate::llm_config::config_path(app).map_err(|_| "无法读取当前模型服务配置。")?;
    let slot = crate::llm_config_store::read_revealed_slot(&path, false)
        .map_err(|_| "当前模型密钥无法解密，请在模型服务中重新配置。")?;
    openai::validate_slot(&slot)?;
    Ok(slot)
}

fn normalize(request: SearchRequest) -> Result<(String, usize), String> {
    let query = request.query.trim();
    if query.is_empty() || query.chars().count() > 400 || query.chars().any(char::is_control) {
        return Err("搜索词需为 1–400 个字符，不能包含控制字符。".into());
    }
    let count = request.max_results.unwrap_or(5);
    if !(1..=8).contains(&count) {
        return Err("搜索结果数量须为 1–8 条。".into());
    }
    Ok((query.to_owned(), usize::from(count)))
}

fn public_url(text: &str) -> Option<String> {
    if text.len() > 2048 {
        return None;
    }
    let mut url = Url::parse(text).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let host = url.host_str()?.trim_matches(['[', ']']);
    let host = host.trim_end_matches('.').to_lowercase();
    if let Ok(ip) = host.parse::<IpAddr>() {
        let blocked = match ip {
            IpAddr::V4(ip) => {
                let [a, b, c, _] = ip.octets();
                ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || a == 0
                    || a >= 224
                    || (a == 100 && (64..=127).contains(&b))
                    || (a == 192 && b == 0)
                    || (a == 198 && (b == 18 || b == 19))
                    || (a == 198 && b == 51 && c == 100)
                    || (a == 203 && b == 0 && c == 113)
            }
            // 只展示全球单播IPv6，排除本机、ULA、链路本地及IPv4映射地址。
            IpAddr::V6(ip) => {
                ip.octets()[0] & 0xe0 != 0x20 || ip.segments()[0..2] == [0x2001, 0x0db8]
            }
        };
        if blocked {
            return None;
        }
    } else if !host.contains('.')
        || [
            ".localhost",
            ".local",
            ".internal",
            ".lan",
            ".home",
            ".test",
            ".invalid",
        ]
        .iter()
        .any(|suffix| host.ends_with(suffix))
    {
        return None;
    }
    url.set_fragment(None);
    Some(url.to_string())
}

fn safe_text(text: &str, key: &str, maximum: usize) -> String {
    text.replace(key, "[已隐藏的密钥]")
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(maximum)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn parse_results(bytes: &[u8], maximum: usize, key: &str) -> Result<Vec<SearchResult>, String> {
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("搜索服务返回内容过大，请缩小搜索范围。".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "搜索服务返回了无效数据，请稍后重试。")?;
    let entries = value
        .get("results")
        .and_then(|value| value.as_array())
        .ok_or("搜索服务未返回有效结果列表。")?;
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for entry in entries {
        let Some(raw_url) = entry.get("url").and_then(|value| value.as_str()) else {
            continue;
        };
        if raw_url.contains(key) {
            continue;
        }
        let Some(url) = public_url(raw_url) else {
            continue;
        };
        let Some(title) = entry.get("title").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(snippet) = entry.get("content").and_then(|value| value.as_str()) else {
            continue;
        };
        let title = safe_text(title, key, 300);
        if title.is_empty() || !seen.insert(url.clone()) {
            continue;
        }
        results.push(SearchResult {
            title,
            url,
            snippet: safe_text(snippet, key, 2000),
        });
        if results.len() >= maximum {
            break;
        }
    }
    Ok(results)
}

fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "联网搜索超时，请稍后重试。".into()
    } else {
        "无法连接搜索服务，请检查网络后重试。".into()
    }
}

fn status_error(status: StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => "搜索服务拒绝了密钥，请检查所选搜索服务的密钥。".into(),
        400 | 404 | 422 => {
            "当前模型或服务不支持此搜索接口或参数，请检查 Responses 联网搜索支持。".into()
        }
        429 => "搜索服务调用次数超限，请稍后重试或检查搜索额度。".into(),
        500..=599 => "搜索服务暂不可用，请稍后重试。".into(),
        code => format!("搜索请求未成功（HTTP {code}），请稍后重试。"),
    }
}

fn client_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
}

fn search_request(
    client: &Client,
    query: &str,
    maximum: usize,
    key: &str,
) -> Result<reqwest::Request, String> {
    let body = serde_json::json!({ "query": query, "max_results": maximum, "search_depth": "basic", "include_answer": false, "include_raw_content": false });
    client
        .post(ENDPOINT)
        .bearer_auth(key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .build()
        .map_err(|_| "无法创建搜索请求，请检查搜索配置。".into())
}

async fn request_results(
    client: &Client,
    request: reqwest::Request,
    maximum: usize,
    key: &str,
) -> Result<Vec<SearchResult>, String> {
    let bytes = response_bytes(client, request).await?;
    parse_results(&bytes, maximum, key)
}

async fn response_bytes(client: &Client, request: reqwest::Request) -> Result<Vec<u8>, String> {
    let mut response = client.execute(request).await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(status_error(response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("搜索服务返回内容过大，请缩小搜索范围。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if chunk.len() > MAX_RESPONSE_BYTES - bytes.len() {
            return Err("搜索服务返回内容过大，请缩小搜索范围。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn web_search_execute(
    app: AppHandle,
    request: SearchRequest,
) -> Result<SearchResponse, String> {
    let (query, maximum) = normalize(request)?;
    // 每次执行重新取配置，不缓存开关或解密后的Key；关闭后新的调用不能出网。
    let key = match store::access(&config_path(&app)?)? {
        SearchAccess::Openai => {
            let slot = active_openai(&app)?;
            let (results, summary) = openai::search(&slot, &query, maximum).await?;
            return Ok(SearchResponse {
                query,
                results,
                summary: Some(summary),
                searched_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
                provider: "openai",
            });
        }
        SearchAccess::Tavily(key) => key,
    };
    if query.contains(&key) {
        return Err("搜索词包含配置密钥，未发送请求。".into());
    }
    let client = client_builder()
        .build()
        .map_err(|_| "无法初始化联网搜索，请重新打开应用。")?;
    let request = search_request(&client, &query, maximum, &key)?;
    let results = request_results(&client, request, maximum, &key).await?;
    Ok(SearchResponse {
        query,
        results,
        searched_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        provider: "tavily",
        summary: None,
    })
}

#[cfg(test)]
mod tests;
