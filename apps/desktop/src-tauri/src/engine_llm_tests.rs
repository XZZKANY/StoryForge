use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const KEY: &str = "sk-test-0123456789abcdef";

fn slot(base_url: &str, key: Option<&str>) -> RevealedSlot {
    RevealedSlot {
        provider: "openai-compatible".into(),
        base_url: base_url.into(),
        model: "test-model".into(),
        api_key: key.map(Into::into),
    }
}

fn request(url: &str, headers: &[(&str, &str)]) -> EngineHttpRequest {
    EngineHttpRequest {
        url: url.into(),
        method: "POST".into(),
        headers: headers
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect(),
        body: Some(STANDARD.encode(br#"{"model":"test-model"}"#)),
        timeout_seconds: 5.0,
    }
}

fn bearer() -> String {
    format!("Bearer {CREDENTIAL_PLACEHOLDER}")
}

fn refusal(result: Result<Outbound, EngineLlmError>) -> EngineLlmError {
    let error = result.err().expect("request must be refused");
    assert_eq!(error.kind, "refused");
    assert!(!error.message.contains(KEY));
    error
}

#[test]
fn source_matches_the_managed_sidecar_and_never_carries_the_key() {
    let configured = slot("https://api.example.test/v1", Some(KEY));
    let env = |key: &str| match key {
        "STORYFORGE_LLM_TEMPERATURE" => Some("0.7".to_string()),
        "STORYFORGE_LLM_AUTH_HEADER" => Some("api-key".to_string()),
        // Identity values never come from the environment in managed mode.
        _ if key.ends_with("API_KEY") || key.ends_with("BASE_URL") => Some("env-value".into()),
        _ => None,
    };
    let source = engine_source(Some(&configured), false, env);
    assert_eq!(source["STORYFORGE_LLM_API_KEY"], CREDENTIAL_PLACEHOLDER);
    assert_eq!(
        source["STORYFORGE_LLM_BASE_URL"],
        "https://api.example.test/v1"
    );
    assert_eq!(
        source["STORYFORGE_LLM_API_BASE_URL"],
        "https://api.example.test/v1"
    );
    assert_eq!(source["STORYFORGE_LLM_PROVIDER"], "openai-compatible");
    assert_eq!(source["STORYFORGE_LLM_MODEL"], "test-model");
    assert_eq!(source["STORYFORGE_LLM_TEMPERATURE"], "0.7");
    assert_eq!(source["STORYFORGE_LLM_AUTH_HEADER"], "api-key");
    assert_eq!(source[TIMEOUT_KEY], "60.0");
    assert_eq!(source.len(), 8);
    assert!(!format!("{source:?}").contains(KEY));

    for (raw, expected) in [(" ", "60.0"), (" 120 ", " 120 ")] {
        let source = engine_source(Some(&configured), false, |key| {
            (key == TIMEOUT_KEY).then(|| raw.to_string())
        });
        assert_eq!(source[TIMEOUT_KEY], expected);
    }

    let keyless = engine_source(Some(&slot("https://a.test", None)), false, |_| None);
    assert_eq!(keyless["STORYFORGE_LLM_API_KEY"], "");

    let polish = engine_source(Some(&configured), true, env);
    assert_eq!(polish.len(), 5);
    assert_eq!(polish["STORYFORGE_LLM_API_KEY"], CREDENTIAL_PLACEHOLDER);
    let unconfigured = engine_source(None, true, env);
    assert_eq!(unconfigured.len(), 5);
    assert!(unconfigured.values().all(String::is_empty));
}

#[test]
fn only_the_configured_origin_is_reachable() {
    let configured = slot("https://api.example.test/v1", Some(KEY));
    for url in [
        "https://api.example.test/v1/chat/completions",
        "https://API.example.test:443/v1/models?api-version=1",
        "https://api.example.test/other",
    ] {
        assert!(prepare(&configured, request(url, &[])).is_ok(), "{url}");
    }
    for url in [
        "http://api.example.test/v1/chat/completions",
        "https://api.example.test:8443/v1/chat/completions",
        "https://evil.example.test/v1/chat/completions",
        "https://api.example.test.evil.test/v1",
        "https://user@api.example.test/v1/chat/completions",
        "ftp://api.example.test/v1",
        "api.example.test/v1/chat/completions",
    ] {
        refusal(prepare(&configured, request(url, &[])));
    }
    for base in ["", "api.example.test/v1", "file:///C:/v1"] {
        refusal(prepare(
            &slot(base, Some(KEY)),
            request("https://api.example.test/v1/models", &[]),
        ));
    }
}

#[test]
fn placeholder_becomes_the_key_only_inside_credential_headers() {
    let configured = slot("https://api.example.test", Some(KEY));
    let url = "https://api.example.test/chat/completions";
    let bearer = bearer();
    let outbound = prepare(
        &configured,
        request(
            url,
            &[
                ("Authorization", bearer.as_str()),
                ("api-key", CREDENTIAL_PLACEHOLDER),
                ("X-Api-Key", CREDENTIAL_PLACEHOLDER),
                ("x-goog-api-key", CREDENTIAL_PLACEHOLDER),
                ("User-Agent", "StoryForge/0.0.0"),
            ],
        ),
    )
    .unwrap();
    assert_eq!(
        outbound.headers["authorization"],
        format!("Bearer {KEY}").as_str()
    );
    for name in ["api-key", "x-api-key", "x-goog-api-key"] {
        assert_eq!(outbound.headers[name], KEY);
        assert!(outbound.headers[name].is_sensitive());
    }
    assert!(!outbound.headers["user-agent"].is_sensitive());
    assert_eq!(
        outbound.body.as_deref(),
        Some(&br#"{"model":"test-model"}"#[..])
    );

    refusal(prepare(
        &configured,
        request(url, &[("X-Trace", CREDENTIAL_PLACEHOLDER)]),
    ));
    refusal(prepare(
        &configured,
        request(&format!("{url}?k={CREDENTIAL_PLACEHOLDER}"), &[]),
    ));
    let mut leaking_body = request(url, &[]);
    leaking_body.body = Some(STANDARD.encode(format!("{{\"k\":\"{CREDENTIAL_PLACEHOLDER}\"}}")));
    refusal(prepare(&configured, leaking_body));
    refusal(prepare(
        &slot("https://api.example.test", None),
        request(url, &[("Authorization", bearer.as_str())]),
    ));
    assert!(prepare(
        &slot("https://api.example.test", None),
        request(url, &[("User-Agent", "StoryForge/0.0.0")]),
    )
    .is_ok());
    let mut broken_key = slot("https://api.example.test", Some("line\nbreak-key"));
    refusal(prepare(
        &broken_key,
        request(url, &[("Authorization", bearer.as_str())]),
    ));
    broken_key.api_key = Some(KEY.into());
    refusal(prepare(&broken_key, request(url, &[("Bad Name", "x")])));
}

#[test]
fn method_timeout_and_body_are_validated() {
    let configured = slot("https://api.example.test", Some(KEY));
    let url = "https://api.example.test/models";
    let mut get = request(url, &[]);
    get.method = "GET".into();
    get.body = None;
    let outbound = prepare(&configured, get).unwrap();
    assert_eq!(outbound.method, Method::GET);
    assert!(outbound.body.is_none());
    assert_eq!(outbound.timeout, Duration::from_millis(5000));

    let mut put = request(url, &[]);
    put.method = "PUT".into();
    refusal(prepare(&configured, put));
    for seconds in [0.0, -1.0, f64::NAN, f64::INFINITY, 1e300] {
        let mut bad = request(url, &[]);
        bad.timeout_seconds = seconds;
        refusal(prepare(&configured, bad));
    }
    let mut fractional = request(url, &[]);
    fractional.timeout_seconds = 0.25;
    assert_eq!(
        prepare(&configured, fractional).unwrap().timeout,
        Duration::from_millis(250)
    );
    let mut bad_body = request(url, &[]);
    bad_body.body = Some("***".into());
    refusal(prepare(&configured, bad_body));
}

fn scrub_all(key: Option<&str>, chunks: &[&[u8]]) -> Vec<u8> {
    let mut scrubber = EchoScrubber::new(key);
    let mut output = Vec::new();
    for chunk in chunks {
        output.extend(scrubber.feed(chunk));
    }
    output.extend(scrubber.finish());
    output
}

#[test]
fn echoes_are_masked_at_every_chunk_boundary() {
    let body = format!("data: {{\"e\":\"{KEY}\"}}\n\nx{KEY}{KEY}y").into_bytes();
    let expected = format!(
        "data: {{\"e\":\"{CREDENTIAL_PLACEHOLDER}\"}}\n\nx{CREDENTIAL_PLACEHOLDER}{CREDENTIAL_PLACEHOLDER}y"
    )
    .into_bytes();
    for first in 0..=body.len() {
        assert_eq!(
            scrub_all(Some(KEY), &[&body[..first], &body[first..]]),
            expected
        );
        for second in first..=body.len() {
            assert_eq!(
                scrub_all(
                    Some(KEY),
                    &[&body[..first], &body[first..second], &body[second..]]
                ),
                expected
            );
        }
    }
}

#[test]
fn only_possible_key_prefixes_are_held_back() {
    let mut scrubber = EchoScrubber::new(Some(KEY));
    assert_eq!(scrubber.feed(b"data: {}\n\n"), b"data: {}\n\n");
    assert_eq!(scrubber.feed(b"tail sk-te"), b"tail ");
    assert_eq!(scrubber.feed(b"rm"), b"sk-term");
    // The final "s" could still start the key ("sk-..."), so only it is held.
    assert_eq!(scrubber.feed(b"ss"), b"s");
    assert_eq!(scrubber.finish(), b"s");

    let mut ended_inside = EchoScrubber::new(Some(KEY));
    assert_eq!(ended_inside.feed(b"echo sk-test-01"), b"echo ");
    assert_eq!(ended_inside.finish(), CREDENTIAL_PLACEHOLDER.as_bytes());
    let mut short_tail = EchoScrubber::new(Some(KEY));
    assert_eq!(short_tail.feed(b"echo sk-te"), b"echo ");
    assert_eq!(short_tail.finish(), b"sk-te");
}

#[test]
fn keys_shorter_than_python_secret_threshold_are_not_scrubbed() {
    assert_eq!(scrub_all(Some("abc12"), &[b"xabc12y"]), b"xabc12y");
    assert_eq!(scrub_text("xabc12y", Some("abc12")), "xabc12y");
    assert_eq!(scrub_all(None, &[b"xabc12y"]), b"xabc12y");
    let masked = format!("x{CREDENTIAL_PLACEHOLDER}y");
    assert_eq!(
        scrub_all(Some("abc123"), &[b"xabc", b"123y"]),
        masked.as_bytes()
    );
    assert_eq!(scrub_text("xabc123y", Some("abc123")), masked);
    // Python counts characters, not bytes.
    assert_eq!(
        scrub_text("x密钥密钥密y", Some("密钥密钥密")),
        "x密钥密钥密y"
    );
    assert_eq!(scrub_text("x密钥密钥密钥y", Some("密钥密钥密钥")), masked);
}

enum Act {
    Send(Vec<u8>),
    Pause(u64),
    Hang,
}

fn send(text: &str) -> Act {
    Act::Send(text.as_bytes().to_vec())
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut data = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let read = stream.read(&mut buffer).await.unwrap();
        if read == 0 {
            break;
        }
        data.extend_from_slice(&buffer[..read]);
        if let Some(end) = find(&data, b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&data[..end]).to_ascii_lowercase();
            let length = head
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .map_or(0, |value| value.trim().parse::<usize>().unwrap());
            if data.len() >= end + 4 + length {
                break;
            }
        }
    }
    String::from_utf8(data).unwrap()
}

/// One scripted response per connection; every response closes its connection.
async fn fake_server(exchanges: Vec<Vec<Act>>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        for acts in exchanges {
            let (mut stream, _) = listener.accept().await.unwrap();
            requests.push(read_request(&mut stream).await);
            for act in acts {
                match act {
                    Act::Send(bytes) => {
                        stream.write_all(&bytes).await.unwrap();
                        stream.flush().await.unwrap();
                    }
                    Act::Pause(ms) => tokio::time::sleep(Duration::from_millis(ms)).await,
                    Act::Hang => tokio::time::sleep(Duration::from_secs(30)).await,
                }
            }
        }
        requests
    });
    (base, task)
}

async fn call(
    base: &str,
    path: &str,
    timeout_seconds: f64,
) -> Result<(Head, Vec<BodyEvent>), EngineLlmError> {
    let configured = slot(base, Some(KEY));
    let bearer = bearer();
    let mut outbound = request(
        &format!("{base}{path}"),
        &[("Authorization", bearer.as_str())],
    );
    outbound.timeout_seconds = timeout_seconds;
    let outbound = prepare(&configured, outbound)?;
    let timeout = outbound.timeout;
    let client = build_client(false).unwrap();
    let (head, response) = open(&client, outbound, Some(KEY)).await?;
    let mut events = Vec::new();
    pump(response, timeout, Some(KEY), |event| {
        events.push(event);
        true
    })
    .await;
    Ok((head, events))
}

fn body_of(events: &[BodyEvent]) -> String {
    let mut bytes = Vec::new();
    for event in events {
        if let BodyEvent::Chunk { data } = event {
            bytes.extend(STANDARD.decode(data).unwrap());
        }
    }
    String::from_utf8(bytes).unwrap()
}

fn chunk_count(events: &[BodyEvent]) -> usize {
    events
        .iter()
        .filter(|event| matches!(event, BodyEvent::Chunk { .. }))
        .count()
}

#[tokio::test]
async fn real_key_goes_out_and_echoes_come_back_masked() {
    let (prefix, suffix) = KEY.split_at(9);
    let first = format!("data: {{\"echo\":\"{prefix}");
    let second = format!("{suffix}\"}}\n\ndata: [DONE]\n\n");
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nX-Echo: {KEY}\r\nX-Echo: second\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        first.len() + second.len()
    );
    let (base, server) = fake_server(vec![vec![
        send(&response),
        send(&first),
        Act::Pause(150),
        send(&second),
    ]])
    .await;
    let (head, events) = call(&base, "/chat/completions", 5.0).await.unwrap();
    let requests = server.await.unwrap();
    let lower = requests[0].to_ascii_lowercase();
    assert!(lower.starts_with("post /chat/completions http/1.1\r\n"));
    assert!(lower.contains(&format!("authorization: bearer {KEY}")));
    assert!(!requests[0].contains(CREDENTIAL_PLACEHOLDER));
    assert!(requests[0].ends_with("\r\n\r\n{\"model\":\"test-model\"}"));

    assert_eq!(head.status, 200);
    assert_eq!(head.headers["content-type"], "text/event-stream");
    assert_eq!(head.headers["x-echo"], CREDENTIAL_PLACEHOLDER);
    assert_eq!(
        body_of(&events),
        format!("data: {{\"echo\":\"{CREDENTIAL_PLACEHOLDER}\"}}\n\ndata: [DONE]\n\n")
    );
    assert!(chunk_count(&events) >= 2, "{events:?}");
    assert_eq!(events.last(), Some(&BodyEvent::End));
    assert!(!format!("{events:?}{:?}", head.headers).contains(KEY));
}

#[tokio::test]
async fn error_statuses_are_returned_with_masked_bodies() {
    let body = format!("{{\"error\":\"invalid key {KEY}\"}}");
    let response = format!(
        "HTTP/1.1 429 Too Many Requests\r\nRetry-After: 2\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let (base, server) = fake_server(vec![vec![send(&response)]]).await;
    let (head, events) = call(&base, "/chat/completions", 5.0).await.unwrap();
    server.await.unwrap();
    assert_eq!(head.status, 429);
    assert_eq!(head.headers["retry-after"], "2");
    assert_eq!(
        body_of(&events),
        format!("{{\"error\":\"invalid key {CREDENTIAL_PLACEHOLDER}\"}}")
    );
    assert_eq!(events.last(), Some(&BodyEvent::End));
}

#[tokio::test]
async fn refused_connection_and_silent_server_map_to_python_kinds() {
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    let error = call(&base, "/chat/completions", 10.0).await.err().unwrap();
    assert_eq!(error.kind, "connect");
    assert!(!error.message.is_empty() && !error.message.contains(KEY));

    let (base, _server) = fake_server(vec![vec![Act::Hang]]).await;
    let error = call(&base, "/chat/completions", 0.3).await.err().unwrap();
    assert_eq!(error, EngineLlmError::new("timeout", "timed out"));
}

#[tokio::test]
async fn idle_and_truncated_bodies_end_with_errors() {
    let head = "HTTP/1.1 200 OK\r\nContent-Length: 64\r\nConnection: close\r\n\r\n";
    let (base, _server) = fake_server(vec![vec![send(head), send("partial"), Act::Hang]]).await;
    let (_, events) = call(&base, "/chat/completions", 0.3).await.unwrap();
    assert_eq!(body_of(&events), "partial");
    assert_eq!(
        events.last(),
        Some(&BodyEvent::Error {
            kind: "timeout",
            detail: "timed out".into()
        })
    );

    let (base, server) = fake_server(vec![vec![send(head), send("partial")]]).await;
    let (_, events) = call(&base, "/chat/completions", 5.0).await.unwrap();
    server.await.unwrap();
    assert_eq!(body_of(&events), "partial");
    assert!(
        matches!(events.last(), Some(BodyEvent::Error { kind: "read", .. })),
        "{events:?}"
    );
}

#[tokio::test]
async fn redirects_never_leave_the_configured_origin() {
    let foreign = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let foreign_url = format!("http://{}/steal", foreign.local_addr().unwrap());
    let ok = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";
    let (base, server) = fake_server(vec![
        vec![send(
            "HTTP/1.1 307 Temporary Redirect\r\nLocation: /moved\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )],
        vec![send(ok)],
        vec![send(&format!(
            "HTTP/1.1 307 Temporary Redirect\r\nLocation: {foreign_url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ))],
    ])
    .await;
    let (head, events) = call(&base, "/chat/completions", 5.0).await.unwrap();
    assert_eq!(head.status, 200);
    assert_eq!(body_of(&events), "ok");
    let (head, _) = call(&base, "/chat/completions", 5.0).await.unwrap();
    assert_eq!(head.status, 307);
    assert_eq!(head.headers["location"], foreign_url);
    let requests = server.await.unwrap();
    assert!(requests[1].starts_with("POST /moved HTTP/1.1\r\n"));
    assert!(requests[1]
        .to_ascii_lowercase()
        .contains(&format!("authorization: bearer {KEY}")));
    assert!(
        tokio::time::timeout(Duration::from_millis(300), foreign.accept())
            .await
            .is_err(),
        "the foreign origin must never be contacted"
    );
}

#[test]
fn ipc_shapes_match_the_desktop_adapter() {
    use serde_json::json;
    let request: EngineHttpRequest = serde_json::from_value(json!({
        "url": "https://api.example.test/models", "method": "GET",
        "headers": {"User-Agent": "StoryForge/0.0.0"}, "body": null, "timeoutSeconds": 0.25
    }))
    .unwrap();
    assert!(request.body.is_none());
    assert_eq!(request.timeout_seconds, 0.25);
    assert!(serde_json::from_value::<EngineHttpRequest>(json!({
        "url": "u", "method": "GET", "headers": {}, "body": null, "timeoutSeconds": 1, "slot": "main"
    }))
    .is_err());
    assert_eq!(
        serde_json::from_value::<LlmSlot>(json!("polish")).unwrap(),
        LlmSlot::Polish
    );
    assert!(serde_json::from_value::<LlmSlot>(json!("Main")).is_err());
    for (event, expected) in [
        (
            BodyEvent::Chunk {
                data: "AA==".into(),
            },
            json!({"event": "chunk", "data": "AA=="}),
        ),
        (BodyEvent::End, json!({"event": "end"})),
        (
            BodyEvent::Error {
                kind: "read",
                detail: "IncompleteRead".into(),
            },
            json!({"event": "error", "kind": "read", "detail": "IncompleteRead"}),
        ),
    ] {
        assert_eq!(serde_json::to_value(event).unwrap(), expected);
    }
    let head = EngineHttpHead {
        id: 1,
        status: 200,
        headers: BTreeMap::from([("retry-after".to_string(), "2".to_string())]),
    };
    assert_eq!(
        serde_json::to_value(head).unwrap(),
        json!({"id": 1, "status": 200, "headers": {"retry-after": "2"}})
    );
    assert_eq!(
        serde_json::to_value(EngineLlmError::new("refused", "x")).unwrap(),
        json!({"kind": "refused", "message": "x"})
    );
}
