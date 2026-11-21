use super::*;
use std::net::IpAddr;

#[test]
fn rejects_private_urls_credentials_nonstandard_ports_and_sensitive_queries() {
    for url in [
        "http://localhost",
        "http://127.1/",
        "http://0x7f000001/",
        "https://[::1]/",
        "https://private.local/",
        "file:///C:/private",
        "https://u:p@example.com",
        "https://example.com:444/",
        "https://example.com/?api_key=secret",
        "https://example.com/?t%6Fken=secret",
        "https://example.com/?X-Amz-Signature=secret",
    ] {
        assert!(policy::public_url(url).is_err(), "{url}");
    }
    assert_eq!(
        policy::public_url("https://EXAMPLE.com./a#x")
            .unwrap()
            .as_str(),
        "https://example.com/a"
    );
    assert!(
        serde_json::from_str::<PageRequest>(r#"{"url":"https://example.com","headers":{}}"#)
            .is_err()
    );
}
#[test]
fn rejects_nonpublic_dns_answers_including_mapped_ipv6_and_reserved_ranges() {
    for ip in [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.1.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.1.1",
        "192.0.2.1",
        "192.88.99.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "240.0.0.1",
        "::1",
        "::ffff:1.1.1.1",
        "2001::1",
        "2001:db8::1",
        "2002:7f00:1::",
        "3fff::1",
        "fd00::1",
    ] {
        assert!(!policy::public_ip(ip.parse::<IpAddr>().unwrap()), "{ip}");
    }
    for ip in [
        "1.1.1.1",
        "8.8.8.8",
        "2606:4700:4700::1111",
        "2001:4860:4860::8888",
    ] {
        assert!(policy::public_ip(ip.parse().unwrap()), "{ip}");
    }
}
#[test]
fn redirects_are_validated_before_following() {
    let current = Url::parse("https://example.com/intro").unwrap();
    assert_eq!(
        policy::redirect(&current, "/docs").unwrap().as_str(),
        "https://example.com/docs"
    );
    assert!(policy::redirect(&current, "https://www.example.com/docs").is_ok());
    for target in [
        "http://example.com/",
        "https://evil.example.org/",
        "http://127.0.0.1/",
        "https://user:pass@example.com",
    ] {
        assert!(policy::redirect(&current, target).is_err());
    }
}
fn extract_html(html: &str) -> PageResponse {
    let url = Url::parse("https://example.com/docs/index").unwrap();
    extract::extract(html.as_bytes(), "text/html; charset=utf-8", &url, &url).unwrap()
}
#[test]
fn extracts_actual_text_and_relative_links_without_executing_hidden_instructions() {
    let page = extract_html(
        r#"<title>资料 &amp; 链接</title><nav>导航</nav><main><h1>公开资料</h1><p>正文 &lt;例子&gt;</p><script>secret-script</script><div hidden>hidden-secret</div><a href="../chapter#one">章节一</a><a href="../chapter#two">重复</a><a href="//other.example.org/x">站外</a><a href="http://127.0.0.1">内网</a><a href="javascript:alert(1)">脚本</a><a href="?token=private">凭据</a></main>"#,
    );
    assert_eq!(page.title, "资料 & 链接");
    assert!(page.text.contains("正文 <例子>"));
    assert!(
        !page.text.contains("secret-script")
            && !page.text.contains("hidden-secret")
            && !page.text.contains("导航")
    );
    assert_eq!(page.links.len(), 1);
    assert_eq!(page.links[0].url, "https://example.com/chapter");
    assert_eq!(page.links[0].title, "章节一");
    assert!(!page.truncated);
}
#[test]
fn base_url_and_text_limits_are_honest_and_link_list_is_not_read_evidence() {
    let html = format!(
        "<base href='/refs/'><main>{}<a href='a'>一</a>{}</main>",
        "文".repeat(6100),
        (0..30)
            .map(|n| format!("<a href='p{n}'>链接</a>"))
            .collect::<String>()
    );
    let page = extract_html(&html);
    assert_eq!(page.text.chars().count(), 6000);
    assert!(page.truncated && page.links_truncated);
    assert_eq!(page.links.len(), 20);
    assert_eq!(page.links[0].url, "https://example.com/refs/a");
    assert_eq!(page.url, "https://example.com/docs/index");
    assert!(!serde_json::to_string(&page).unwrap().contains("apiKey"));
}
#[test]
fn handles_legacy_encoding_plain_text_empty_pages_and_non_text() {
    let url = Url::parse("https://example.com/").unwrap();
    let (bytes, _, _) = encoding_rs::GBK.encode("<meta charset=gbk><main>中文史料</main>");
    assert!(extract::extract(&bytes, "text/html", &url, &url)
        .unwrap()
        .text
        .contains("中文史料"));
    let plain = extract::extract(b"first\nsecond", "text/plain", &url, &url).unwrap();
    assert_eq!(plain.text, "first\nsecond");
    assert!(plain.links.is_empty());
    assert!(extract::extract(
        b"<script>document.write('x')</script>",
        "text/html",
        &url,
        &url
    )
    .unwrap_err()
    .contains("没有可读取"));
    assert!(extract::extract(b"PDF", "application/pdf", &url, &url).is_err());
}

/// 只在测试内部替换传输地址；公开入口始终先检查DNS/IP并固定解析结果。
async fn local_bytes(wire: Vec<u8>) -> Result<(Vec<u8>, String), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 8192];
        let n = socket.read(&mut request).await.unwrap();
        let request = String::from_utf8_lossy(&request[..n]).to_lowercase();
        assert!(
            !request.contains("authorization:")
                && !request.contains("cookie:")
                && !request.contains("referer:")
        );
        let _ = socket.write_all(&wire).await;
    });
    let response = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .get(format!("http://{address}/"))
        .send()
        .await
        .unwrap();
    let result = page_bytes(response).await;
    server.await.unwrap();
    result
}
#[tokio::test]
async fn transport_caps_known_and_unknown_lengths_and_rejects_errors_without_body_leak() {
    let wire = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", MAX_BYTES+1);
    assert!(local_bytes(wire.into_bytes())
        .await
        .unwrap_err()
        .contains("上限"));
    let mut wire =
        b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n".to_vec();
    wire.extend(vec![b'a'; MAX_BYTES + 1]);
    assert!(local_bytes(wire).await.unwrap_err().contains("上限"));
    let err = local_bytes(
        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecret".to_vec(),
    )
    .await
    .unwrap_err();
    assert!(err.contains("403") && !err.contains("secret"));
}
#[tokio::test]
async fn transport_rejects_download_and_accepts_text_only() {
    assert!(local_bytes(b"HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 3\r\nConnection: close\r\n\r\npdf".to_vec()).await.unwrap_err().contains("文件类型"));
    let (bytes, _) = local_bytes(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 9\r\nConnection: close\r\n\r\n<p>ok</p>".to_vec()).await.unwrap();
    assert_eq!(bytes, b"<p>ok</p>");
}

#[tokio::test]
async fn real_dns_resolution_rejects_loopback_before_connecting() {
    let url = Url::parse("http://localhost/").unwrap();
    let result = client_for(&url).await;
    assert!(result.unwrap_err().contains("内网"));
}

/// 手动执行的公开站点只读探针，不使用模型、搜索Key或作者配置。
#[tokio::test]
#[ignore = "requires external network; run explicitly for release validation"]
async fn public_page_and_discovered_link_are_read_with_production_transport() {
    let root = policy::public_url("https://doc.rust-lang.org/book/title-page.html").unwrap();
    let first = tokio::time::timeout(Duration::from_secs(20), fetch(root, || Ok(())))
        .await
        .unwrap()
        .unwrap();
    assert!(!first.text.is_empty());
    let link = first
        .links
        .iter()
        .find(|link| link.url.ends_with("foreword.html"))
        .or(first.links.first())
        .expect("public documentation links");
    let next = policy::public_url(&link.url).unwrap();
    let second = tokio::time::timeout(Duration::from_secs(20), fetch(next, || Ok(())))
        .await
        .unwrap()
        .unwrap();
    assert!(!second.text.is_empty());
    assert_eq!(second.requested_url, link.url);
    assert_ne!(first.url, second.url);
}

#[test]
fn article_references_take_priority_over_large_navigation_lists() {
    let html = format!(
        "<nav>{}</nav><main>文章<a href='/reference'>正文引用</a></main>",
        (0..30)
            .map(|n| format!("<a href='/nav{n}'>导航</a>"))
            .collect::<String>()
    );
    let page = extract_html(&html);
    assert_eq!(page.links[0].url, "https://example.com/reference");
    assert_eq!(page.links.len(), 20);
    assert!(page.links_truncated);
}

#[test]
fn navigation_only_index_remains_readable_so_children_can_be_followed() {
    let page = extract_html("<title>资料目录</title><nav><a href='/chapter'>章节正文</a></nav>");
    assert!(page.text.contains("章节正文"));
    assert_eq!(page.links[0].url, "https://example.com/chapter");
}
