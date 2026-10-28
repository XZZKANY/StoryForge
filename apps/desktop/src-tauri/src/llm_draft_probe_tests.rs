use super::*;
use crate::engine_llm::{build_client, CREDENTIAL_PLACEHOLDER};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const KEY: &str = "sk-draft-0123456789abcdef";

fn draft(base_url: &str, key: Option<&str>, profile_id: Option<&str>) -> DraftProbeRequest {
    serde_json::from_value(json!({"provider": "kimi", "baseUrl": base_url,
        "apiKey": key, "profileId": profile_id}))
    .unwrap()
}

fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .map(|value| value.to_str().unwrap().to_string())
}

#[test]
fn headers_follow_the_provider_family() {
    let (url, headers) = prepare(
        Family::OpenAi,
        " https://relay.test/v1/ ",
        Some(KEY),
        None,
        "9.9.9",
    )
    .unwrap();
    assert_eq!(url.as_str(), "https://relay.test/v1/models");
    assert_eq!(
        header_value(&headers, "authorization").unwrap(),
        format!("Bearer {KEY}")
    );
    assert_eq!(
        header_value(&headers, "user-agent").unwrap(),
        "StoryForge/9.9.9"
    );
    assert!(headers.get("authorization").unwrap().is_sensitive());

    let (_, headers) = prepare(
        Family::OpenAi,
        "https://relay.test/v1",
        Some(KEY),
        Some("API-KEY"),
        "1",
    )
    .unwrap();
    assert_eq!(header_value(&headers, "api-key").unwrap(), KEY);
    assert!(headers.get("authorization").is_none());

    let (url, headers) = prepare(
        Family::Anthropic,
        "https://api.anthropic.com/v1",
        Some(KEY),
        None,
        "1",
    )
    .unwrap();
    assert_eq!(url.as_str(), "https://api.anthropic.com/v1/models");
    assert_eq!(header_value(&headers, "x-api-key").unwrap(), KEY);
    assert_eq!(
        header_value(&headers, "anthropic-version").unwrap(),
        "2023-06-01"
    );

    let (_, headers) = prepare(
        Family::Gemini,
        "https://g.test/v1beta",
        Some(KEY),
        None,
        "1",
    )
    .unwrap();
    assert_eq!(header_value(&headers, "x-goog-api-key").unwrap(), KEY);

    let (_, headers) =
        prepare(Family::OpenAi, "http://localhost:11434/v1", None, None, "1").unwrap();
    assert_eq!(headers.len(), 1, "没有 Key 就只带 UA（本地 Ollama）");
    assert_eq!(family(" Claude "), Family::Anthropic);
    assert_eq!(family("google"), Family::Gemini);
    assert_eq!(family("deepseek"), Family::OpenAi);
}

#[test]
fn bad_addresses_are_refused_without_echoing_the_key() {
    for base in [
        "relay.test/v1",
        "ftp://relay.test/v1",
        "https://user:pass@relay.test/v1",
        &format!("https://relay.test/v1?key={KEY}"),
    ] {
        let error = prepare(Family::OpenAi, base, Some(KEY), None, "1")
            .err()
            .unwrap();
        assert_eq!(error.kind, "misconfigured", "{base}");
        assert!(!error.message.contains(KEY));
    }
    let error = prepare(
        Family::OpenAi,
        "https://relay.test/v1",
        Some("bad\nkey"),
        None,
        "1",
    )
    .err()
    .unwrap();
    assert!(!error.message.contains("bad"));
}

#[test]
fn model_lists_decode_per_family() {
    let openai = json!({"data": [{"id": "kimi-k2"}, {"id": " moonshot-v1 "}, {"id": "kimi-k2"}, {"x": 1}],
        "has_more": true});
    let decoded = decode(openai.to_string().as_bytes(), Family::OpenAi, None).unwrap();
    assert_eq!(decoded.models, ["kimi-k2", "moonshot-v1"]);
    assert!(decoded.partial);

    let gemini = json!({"models": [{"name": "models/gemini-2.5-pro"}], "nextPageToken": ""});
    let decoded = decode(gemini.to_string().as_bytes(), Family::Gemini, None).unwrap();
    assert_eq!(
        decoded,
        DraftProbeResponse {
            models: vec!["gemini-2.5-pro".into()],
            partial: false
        }
    );

    let echoed = json!({"data": [{"id": format!("leak-{KEY}")}]});
    let decoded = decode(echoed.to_string().as_bytes(), Family::OpenAi, Some(KEY)).unwrap();
    assert_eq!(decoded.models, [format!("leak-{CREDENTIAL_PLACEHOLDER}")]);

    assert!(decode(b"<html>", Family::OpenAi, None).is_err());
    assert!(decode(br#"{"data":[{"name":"x"}]}"#, Family::OpenAi, None).is_err());
    assert_eq!(
        decode(br#"{"data":[]}"#, Family::OpenAi, None)
            .unwrap()
            .models
            .len(),
        0
    );
}

/// 一个连接回一份脚本响应；返回收到的原始请求。
async fn server(responses: Vec<String>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        for response in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut data = Vec::new();
            let mut buffer = [0u8; 4096];
            while !data.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).await.unwrap();
                if read == 0 {
                    break;
                }
                data.extend_from_slice(&buffer[..read]);
            }
            requests.push(String::from_utf8(data).unwrap());
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.flush().await.unwrap();
        }
        requests
    });
    (base, task)
}

fn ok(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

#[tokio::test]
async fn draft_key_goes_out_once_and_nothing_is_persisted() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let (base, server) = server(vec![ok(r#"{"data":[{"id":"kimi-k2"}]}"#)]).await;
    let client = build_client(false).unwrap();
    let models = run(
        &path,
        &client,
        draft(&format!("{base}/v1"), Some(KEY), None),
        "1",
        None,
    )
    .await
    .unwrap();
    assert_eq!(models.models, ["kimi-k2"]);
    let requests = server.await.unwrap();
    assert!(requests[0].starts_with("GET /v1/models HTTP/1.1\r\n"));
    assert!(requests[0].to_ascii_lowercase().contains(&format!(
        "authorization: bearer {}",
        KEY.to_ascii_lowercase()
    )));
    assert!(!path.exists(), "草稿探测不落盘");
}

#[tokio::test]
async fn rejections_map_to_readable_kinds_without_the_key() {
    let echo = format!("{{\"error\":\"bad key {KEY}\"}}");
    let (base, server) = server(vec![
        format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{echo}",
            echo.len()
        ),
        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        ok("<html>relay login</html>"),
    ])
    .await;
    let client = build_client(false).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let mut kinds = Vec::new();
    for _ in 0..3 {
        let error = run(&path, &client, draft(&base, Some(KEY), None), "1", None)
            .await
            .err()
            .unwrap();
        assert!(!error.message.contains(KEY), "{}", error.message);
        kinds.push(error.kind);
    }
    assert_eq!(kinds, ["unauthorized", "unreachable", "unreachable"]);
    server.await.unwrap();

    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let dead = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    let error = run(&path, &client, draft(&dead, Some(KEY), None), "1", None)
        .await
        .err()
        .unwrap();
    assert_eq!(error.kind, "unreachable");
    assert!(!error.message.contains(KEY));
}

#[cfg(windows)]
#[tokio::test]
async fn stored_key_is_only_lent_to_the_same_origin_and_file_is_untouched() {
    use crate::llm_config_store;
    let (base, server) = server(vec![ok(r#"{"data":[{"id":"stored-model"}]}"#)]).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("llm-provider.json");
    let payload = serde_json::from_value(json!({"name": "", "provider": "kimi",
        "baseUrl": format!("{base}/v1"), "model": "m", "apiKey": KEY}))
    .unwrap();
    llm_config_store::save_profile(&path, payload).unwrap();
    let before = std::fs::read(&path).unwrap();
    let client = build_client(false).unwrap();

    let foreign = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let foreign_base = format!("http://{}", foreign.local_addr().unwrap());
    let error = run(
        &path,
        &client,
        draft(&foreign_base, None, Some("p1")),
        "1",
        None,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.kind, "misconfigured");
    assert!(
        tokio::time::timeout(Duration::from_millis(300), foreign.accept())
            .await
            .is_err(),
        "已存的 Key 不能借给别的地址"
    );

    let models = run(
        &path,
        &client,
        draft(&format!("{base}/other"), Some(" "), Some("p1")),
        "1",
        None,
    )
    .await
    .unwrap();
    assert_eq!(models.models, ["stored-model"]);
    let requests = server.await.unwrap();
    assert!(requests[0].to_ascii_lowercase().contains(&format!(
        "authorization: bearer {}",
        KEY.to_ascii_lowercase()
    )));
    assert_eq!(std::fs::read(&path).unwrap(), before, "探测不改配置文件");
    assert!(run(
        &path,
        &client,
        draft(&base, None, Some("missing")),
        "1",
        None
    )
    .await
    .is_err());
}
