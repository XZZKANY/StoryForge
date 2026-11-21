//! 公开网页只读口：直接读取HTML/文本，不向目标网站发送模型或搜索服务凭据。
mod extract;
mod policy;
#[cfg(test)]
mod tests;

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageRequest {
    url: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLink {
    title: String,
    url: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageResponse {
    requested_url: String,
    url: String,
    title: String,
    text: String,
    links: Vec<PageLink>,
    truncated: bool,
    links_truncated: bool,
    fetched_at: String,
}

fn require_enabled(app: &AppHandle) -> Result<(), String> {
    if !crate::web_search::web_search_get_config(app.clone())?.enabled {
        return Err("联网搜索尚未启用，不能读取网页。".into());
    }
    Ok(())
}

async fn client_for(url: &Url) -> Result<Client, String> {
    let host = url.host_str().ok_or("网页域名无效。")?;
    let addresses: Vec<_> =
        tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(443)))
            .await
            .map_err(|_| "无法解析网页域名。")?
            .collect();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !policy::public_ip(address.ip()))
    {
        return Err("网页域名指向本机、内网或保留地址，已拒绝读取。".into());
    }
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(15))
        .resolve_to_addrs(host, &addresses)
        .user_agent("StoryForge/0.2.5 (public-page-reader)")
        .build()
        .map_err(|_| "无法初始化网页读取。".into())
}

async fn page_bytes(mut response: reqwest::Response) -> Result<(Vec<u8>, String), String> {
    if !response.status().is_success() {
        return Err(format!(
            "网页读取失败（HTTP {}），可能需要登录或不允许访问。",
            response.status().as_u16()
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let media = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if !matches!(
        media.as_str(),
        "text/html" | "application/xhtml+xml" | "text/plain"
    ) {
        return Err("暂时只支持 HTML 和纯文本网页，不支持此文件类型。".into());
    }
    if response
        .headers()
        .get(reqwest::header::CONTENT_ENCODING)
        .is_some_and(|v| v != "identity")
    {
        return Err("网页返回了无法读取的压缩格式。".into());
    }
    if response
        .content_length()
        .is_some_and(|v| v > MAX_BYTES as u64)
    {
        return Err("网页超过 2MiB 读取上限。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取网页连接中断。")? {
        if chunk.len() > MAX_BYTES - bytes.len() {
            return Err("网页超过 2MiB 读取上限。".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, content_type))
}

async fn fetch(url: Url, check: impl Fn() -> Result<(), String>) -> Result<PageResponse, String> {
    let requested = url.clone();
    let mut current = url;
    for hop in 0..=3 {
        check()?;
        let client = client_for(&current).await?;
        // DNS等待期间作者可能关闭联网；发送前再检查，禁止向网页透传任何Key或Cookie。
        check()?;
        let response = client
            .get(current.clone())
            .header(
                reqwest::header::ACCEPT,
                "text/html, application/xhtml+xml, text/plain",
            )
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send()
            .await
            .map_err(|_| "无法连接网页，请检查网络后重试。")?;
        if response.status().is_redirection() {
            if hop == 3 {
                return Err("网页重定向次数超过上限。".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("网页重定向地址无效。")?;
            current = policy::redirect(&current, location)?;
            continue;
        }
        let (bytes, content_type) = page_bytes(response).await?;
        check()?;
        return extract::extract(&bytes, &content_type, &requested, &current);
    }
    Err("网页重定向次数超过上限。".into())
}

#[tauri::command]
pub async fn web_read_execute(
    app: AppHandle,
    request: PageRequest,
) -> Result<PageResponse, String> {
    require_enabled(&app)?;
    let url = policy::public_url(&request.url)?;
    tokio::time::timeout(
        Duration::from_secs(20),
        fetch(url, || require_enabled(&app)),
    )
    .await
    .map_err(|_| "网页读取超时，请稍后重试。".to_owned())?
}
