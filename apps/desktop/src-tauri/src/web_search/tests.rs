use super::*;

#[test]
fn query_and_result_limits_are_validated_before_search() {
    let (query, count) = normalize(SearchRequest {
        query: "  宋代城市布局  ".into(),
        max_results: None,
    })
    .unwrap();
    assert_eq!(query, "宋代城市布局");
    assert_eq!(count, 5);
    assert!(normalize(SearchRequest {
        query: "字".repeat(400),
        max_results: Some(8)
    })
    .is_ok());
    for query in [
        "".to_owned(),
        " ".into(),
        "字".repeat(401),
        "secret\0text".into(),
    ] {
        assert!(normalize(SearchRequest {
            query,
            max_results: Some(5)
        })
        .is_err());
    }
    for maximum in [0, 9, 255] {
        assert!(normalize(SearchRequest {
            query: "合法搜索词".into(),
            max_results: Some(maximum)
        })
        .is_err());
    }
    for raw in [
        r#"{"query":"x","maxResults":1.2}"#,
        r#"{"query":"x","maxResults":-1}"#,
        r#"{"query":"x","url":"https://attacker.example"}"#,
        r#"{"query":"x","headers":{"authorization":"secret"}}"#,
    ] {
        assert!(serde_json::from_str::<SearchRequest>(raw).is_err());
    }
}

#[test]
fn only_public_http_source_links_are_returned() {
    for value in [
        "javascript:alert(1)",
        "file:///C:/secret",
        "data:text/html,hello",
        "/relative",
        "https://user:pass@example.com/",
        "https://localhost/",
        "https://sub.localhost/",
        "http://private/",
        "http://service.local/",
        "https://service.internal/",
        "http://127.0.0.1/",
        "http://2130706433/",
        "http://0x7f000001/",
        "http://10.1.2.3/",
        "http://172.16.1.1/",
        "http://192.168.1.1/",
        "http://169.254.169.254/",
        "http://100.64.1.2/",
        "http://0.0.0.0/",
        "http://224.1.1.1/",
        "https://[::1]/",
        "https://[fd00::1]/",
        "https://[::ffff:127.0.0.1]/",
        "https://[fe80::1]/",
        "https://[2001:db8::1]/",
    ] {
        assert!(public_url(value).is_none(), "unexpected source URL {value}");
    }
    assert_eq!(
        public_url("https://example.com/page?q=history#part").unwrap(),
        "https://example.com/page?q=history"
    );
    assert!(public_url("https://1.1.1.1/help").is_some());
    assert!(public_url(&format!("https://example.com/{}", "a".repeat(2048))).is_none());
}

#[test]
fn response_is_bounded_deduplicated_and_never_exposes_the_key() {
    let key = "tvly-unit-test-secret";
    let body = serde_json::json!({"results":[
        {"title":"local", "url":"http://127.0.0.1/", "content":"do not include"},
        {"title":"missing url", "content":"not a source"},
        {"title":" ", "url":"https://empty.example.com/", "content":"not a title"},
        {"title":"one", "url":"https://example.com/one#first", "content":format!("正文{key}{}", "末".repeat(2200))},
        {"title":"duplicate", "url":"https://example.com/one#second", "content":"duplicate"},
        {"title":"界".repeat(350), "url":"https://example.com/two", "content":"第二条\u{0001}"},
        {"title":"key link", "url":format!("https://example.com/{key}"), "content":"hidden"},
        {"title":"three", "url":"https://example.com/three", "content":"third"}
    ],"answer":"ignored generated answer", "raw_content":"ignored raw"});
    let bytes = serde_json::to_vec(&body).unwrap();
    let results = parse_results(&bytes, 2, key).unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].url, "https://example.com/one");
    assert_eq!(results[0].snippet.chars().count(), 2000);
    assert_eq!(results[1].title.chars().count(), 300);
    assert_eq!(results[1].snippet, "第二条");
    let wire = serde_json::to_string(&results).unwrap();
    assert!(!wire.contains(key));
    assert!(!wire.contains("ignored"));
    assert!(!wire.contains("duplicate"));
    let all = parse_results(&bytes, 8, key).unwrap();
    assert_eq!(all.len(), 3);
}

#[test]
fn empty_results_remain_empty_but_invalid_data_fails_explicitly() {
    assert!(parse_results(br#"{"results":[]}"#, 5, "not-a-real-key")
        .unwrap()
        .is_empty());
    for input in [b"invalid".as_slice(), b"{}", br#"{"results":{}}"#] {
        assert!(parse_results(input, 5, "key-secret").is_err());
    }
    assert!(parse_results(&vec![b' '; MAX_RESPONSE_BYTES + 1], 5, "key-secret").is_err());
}

#[test]
fn status_and_transport_errors_do_not_include_provider_bodies_or_urls() {
    assert!(status_error(StatusCode::UNAUTHORIZED).contains("密钥"));
    assert!(status_error(StatusCode::TOO_MANY_REQUESTS).contains("超限"));
    assert!(status_error(StatusCode::INTERNAL_SERVER_ERROR).contains("暂不可用"));
    assert!(status_error(StatusCode::FOUND).contains("HTTP 302"));
    let error = Client::new()
        .get("invalid request secret-value")
        .build()
        .unwrap_err();
    let message = network_error(error);
    assert!(!message.contains("secret-value"));
    assert!(!message.contains("invalid request"));
}

#[test]
fn request_contract_uses_only_the_fixed_provider_and_expected_fields() {
    let client = client_builder().no_proxy().build().unwrap();
    let request = search_request(&client, "宋代城镇", 8, "fake-test-key").unwrap();
    assert_eq!(request.url().as_str(), ENDPOINT);
    assert_eq!(request.method(), reqwest::Method::POST);
    assert_eq!(request.headers()["authorization"], "Bearer fake-test-key");
    assert_eq!(request.headers()["content-type"], "application/json");
    let body: serde_json::Value =
        serde_json::from_slice(request.body().unwrap().as_bytes().unwrap()).unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "query":"宋代城镇", "max_results":8, "search_depth":"basic",
            "include_answer":false, "include_raw_content":false
        })
    );
    assert!(
        !String::from_utf8_lossy(request.body().unwrap().as_bytes().unwrap())
            .contains("fake-test-key")
    );
}

/// 仅本地合成HTTP；公开IPC不提供URL参数，真实请求仍固定到ENDPOINT。
async fn local_response(response: Vec<u8>) -> Result<Vec<SearchResult>, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let count = socket.read(&mut buffer).await.unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..count]);
            if let Some(boundary) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..boundary]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|value| value.parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if request.len() >= boundary + 4 + length {
                    break;
                }
            }
        }
        // 超限/重定向测试会主动关连接，服务端写失败是预期行为。
        let _ = socket.write_all(&response).await;
    });
    let client = client_builder().no_proxy().build().unwrap();
    let mut request = search_request(&client, "合成查询", 5, "fake-test-key").unwrap();
    *request.url_mut() = Url::parse(&format!("http://{address}/search")).unwrap();
    let result = request_results(&client, request, 5, "fake-test-key").await;
    server.await.unwrap();
    result
}

#[tokio::test]
async fn streamed_response_is_bounded_with_or_without_content_length() {
    let too_large = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        MAX_RESPONSE_BYTES + 1
    );
    assert!(local_response(too_large.into_bytes())
        .await
        .unwrap_err()
        .contains("过大"));
    let body = vec![b' '; MAX_RESPONSE_BYTES + 1];
    let mut chunked = format!(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:X}\r\n",
        body.len()
    )
    .into_bytes();
    chunked.extend_from_slice(&body);
    chunked.extend_from_slice(b"\r\n0\r\n\r\n");
    assert!(local_response(chunked).await.unwrap_err().contains("过大"));
}

#[tokio::test]
async fn transport_refuses_redirects_and_does_not_echo_error_bodies() {
    let redirect = b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/never-follow\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    assert!(local_response(redirect.to_vec())
        .await
        .unwrap_err()
        .contains("HTTP 302"));
    let error = "fake-test-key provider-sensitive-detail";
    let response = format!(
        "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{error}",
        error.len()
    );
    let message = local_response(response.into_bytes()).await.unwrap_err();
    assert!(message.contains("密钥"));
    assert!(!message.contains("fake-test-key") && !message.contains("provider-sensitive-detail"));
    let valid =
        r#"{"results":[{"title":"资料","url":"https://example.com/source","content":"合成摘要"}]}"#
            .as_bytes();
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        valid.len()
    )
    .into_bytes();
    response.extend_from_slice(valid);
    assert_eq!(local_response(response).await.unwrap()[0].title, "资料");
}
