use super::{policy, PageLink, PageResponse};
use chrono::{SecondsFormat, Utc};
use dom_query::Document;
use encoding_rs::{Encoding, UTF_8};
use reqwest::Url;
use std::collections::HashSet;

pub(super) const TEXT_LIMIT: usize = 6000;
pub(super) const LINK_LIMIT: usize = 20;
fn clean(value: &str, limit: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(limit)
        .collect()
}

pub(super) fn extract(
    bytes: &[u8],
    content_type: &str,
    requested: &Url,
    url: &Url,
) -> Result<PageResponse, String> {
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
    let charset = content_type.split(';').skip(1).find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        key.eq_ignore_ascii_case("charset")
            .then(|| value.trim().trim_matches(['"', '\'']).to_owned())
    });
    let charset = charset.or_else(|| {
        if media == "text/plain" {
            return None;
        }
        let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]);
        let document = Document::from(prefix.as_ref());
        document
            .select_single("meta[charset]")
            .attr("charset")
            .map(|v| v.to_string())
    });
    let encoding = charset
        .as_deref()
        .and_then(|v| Encoding::for_label(v.as_bytes()))
        .unwrap_or(UTF_8);
    let (decoded, _, _) = encoding.decode(bytes);
    let mut links = Vec::new();
    let mut links_truncated = false;
    let (title, text) = if media == "text/plain" {
        (
            url.host_str().unwrap_or("网页").to_owned(),
            decoded.to_string(),
        )
    } else {
        let doc = Document::from(decoded.as_ref());
        let title = clean(&doc.select_single("title").text(), 300);
        doc.select("script, style, noscript, template, iframe, object, svg, form, [hidden], [aria-hidden='true']").remove();
        let base = doc
            .select_single("base[href]")
            .attr("href")
            .and_then(|value| url.join(&value).ok())
            .unwrap_or_else(|| url.clone());
        let main = doc.select_single("main, article, [role='main']");
        let content_links = main.select("a[href]");
        let all_links = doc.select("a[href]");
        let mut seen = HashSet::new();
        // 正文中的链接先返回，避免导航栏耗尽候选预算。
        for anchor in content_links.iter().chain(all_links.iter()) {
            let Some(href) = anchor.attr("href") else {
                continue;
            };
            let Ok(link) = base.join(&href) else {
                continue;
            };
            let Ok(link) = policy::public_url(link.as_str()) else {
                continue;
            };
            if !policy::same_site(url, &link) || link == *url || !seen.insert(link.to_string()) {
                continue;
            }
            if links.len() == LINK_LIMIT {
                links_truncated = true;
                break;
            }
            links.push(PageLink {
                title: clean(&anchor.text(), 160),
                url: link.to_string(),
            });
        }
        // 目录页可能只有导航链接；清理框架后若为空，保留其实际可见文字。
        let fallback = if main.is_empty() {
            Some(doc.select_single("body").formatted_text().to_string())
        } else {
            None
        };
        doc.select("nav, header, footer, aside").remove();
        let text = if main.is_empty() {
            doc.select_single("body").formatted_text()
        } else {
            main.formatted_text()
        };
        let text = text.to_string();
        (
            title,
            if text.trim().is_empty() {
                fallback.unwrap_or(text)
            } else {
                text
            },
        )
    };
    let text = text
        .lines()
        .map(|line| clean(line, usize::MAX))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return Err("网页没有可读取的正文，可能需要登录或运行 JavaScript。".into());
    }
    let truncated = text.chars().count() > TEXT_LIMIT;
    Ok(PageResponse {
        requested_url: requested.to_string(),
        url: url.to_string(),
        title: if title.is_empty() {
            url.host_str().unwrap_or("网页").to_owned()
        } else {
            title
        },
        text: text
            .chars()
            .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
            .take(TEXT_LIMIT)
            .collect(),
        links,
        truncated,
        links_truncated,
        fetched_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    })
}
