use super::*;
use serde_json::json;
fn slot() -> RevealedSlot {
    RevealedSlot {
        provider: "openai".into(),
        base_url: "https://provider.example/v1".into(),
        model: "gpt-search-model".into(),
        api_key: Some("unit-test-api-key".into()),
    }
}
fn completed(sources: Value, annotations: Value) -> Value {
    json!({"status":"completed","output":[
        {"type":"web_search_call","status":"completed","action":{"type":"search","sources":sources}},
        {"type":"message","content":[{"type":"output_text","text":"公开资料的检索摘要。","annotations":annotations}]}
    ]})
}
fn parse_value(value: &Value) -> Result<(Vec<SearchResult>, String), String> {
    parse(&serde_json::to_vec(value).unwrap(), 3, "unit-test-api-key")
}

#[test]
fn builds_responses_request_with_configured_model_origin_and_native_secret() {
    let client = Client::new();
    let slot = slot();
    let req = request(&client, &slot, "唐代驿站", 3).unwrap();
    assert_eq!(req.url().as_str(), "https://provider.example/v1/responses");
    assert_eq!(req.headers()["authorization"], "Bearer unit-test-api-key");
    let body: Value = serde_json::from_slice(req.body().unwrap().as_bytes().unwrap()).unwrap();
    assert_eq!(body["model"], slot.model);
    assert_eq!(body["store"], false);
    assert_eq!(body["stream"], false);
    assert_eq!(body["tools"][0]["type"], "web_search");
    assert_eq!(body["tool_choice"], "required");
    assert_eq!(body["max_tool_calls"], 1);
    assert_eq!(body["max_output_tokens"], 1024);
    assert!(body["input"].as_str().unwrap().contains("唐代驿站"));
    assert!(!body.to_string().contains("unit-test-api-key"));
    assert_eq!(
        endpoint("https://provider.example").unwrap().as_str(),
        "https://provider.example/responses"
    );
    assert!(request(&client, &slot, "unit-test-api-key", 3).is_err());
}
#[test]
fn refuses_missing_credentials_wrong_provider_and_credential_bearing_urls() {
    let mut s = slot();
    s.api_key = None;
    assert!(validate_slot(&s).is_err());
    let mut s = slot();
    s.provider = "anthropic".into();
    assert!(validate_slot(&s).is_err());
    for base in [
        "http://provider.example",
        "https://u:p@provider.example",
        "https://provider.example?key=secret",
        "https://provider.example/#fragment",
        "not-a-url",
    ] {
        let mut s = slot();
        s.base_url = base.into();
        assert!(validate_slot(&s).is_err());
    }
    let mut s = slot();
    s.model = "unit-test-api-key".into();
    assert!(validate_slot(&s).is_err());
}
#[test]
fn supports_sources_without_annotations_and_marks_summary_as_generated() {
    let value = completed(
        json!([{"type":"url","url":"https://museum.example/history"}]),
        json!([]),
    );
    let (results, summary) = parse_value(&value).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "museum.example");
    assert!(results[0].snippet.contains("未提供网页原文"));
    assert!(summary.contains("非网页原文"));
    assert!(summary.contains("公开资料"));
}
#[test]
fn prefers_citation_titles_and_deduplicates_returned_sources() {
    let value = completed(
        json!([{"url":"https://museum.example/history#one"},{"url":"https://archive.example/doc"}]),
        json!([{"type":"url_citation","url":"https://museum.example/history","title":"博物馆史料"},
               {"type":"url_citation","url_citation":{"url":"https://archive.example/doc","title":"档案"}}]),
    );
    let (results, _) = parse_value(&value).unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].title, "博物馆史料");
    assert_eq!(results[1].title, "档案");
}
#[test]
fn plain_answers_links_or_citations_without_a_completed_search_are_not_proof() {
    let base = completed(
        json!([]),
        json!([{"type":"url_citation","url":"https://museum.example/history"}]),
    );
    for change in ["remove", "failed", "open_page", "in_progress"] {
        let mut v = base.clone();
        match change {
            "remove" => {
                v["output"].as_array_mut().unwrap().remove(0);
            }
            "failed" => v["output"][0]["status"] = "failed".into(),
            "open_page" => v["output"][0]["action"]["type"] = "open_page".into(),
            _ => v["status"] = "in_progress".into(),
        }
        assert!(parse_value(&v).is_err());
    }
    let mut v = base;
    v["error"] = json!({"message":"secret"});
    assert!(parse_value(&v).unwrap_err().contains("未完成"));
}
#[test]
fn filters_unsafe_or_secret_sources_and_never_returns_key_echoes() {
    let value = completed(
        json!([
            {"url":"file:///private"},{"url":"https://user:pass@example.com"},{"url":"http://127.0.0.1"},
            {"url":"https://example.com/unit-test-api-key"},{"url":"https://example.com/?token=x"},
            {"url":"https://example.com/?q=unit-test-api%2Dkey"},{"url":"https://example.com/safe"}
        ]),
        json!([]),
    );
    let (results, _) = parse_value(&value).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].url, "https://example.com/safe");
    let mut value = value;
    value["output"][1]["content"][0]["text"] = "echo unit-test-api-key".into();
    let (_, summary) = parse_value(&value).unwrap();
    assert!(!summary.contains("unit-test-api-key"));
}
#[test]
fn empty_search_results_have_no_unsupported_summary_and_response_is_bounded() {
    let (results, summary) = parse_value(&completed(json!([]), json!([]))).unwrap();
    assert!(results.is_empty());
    assert!(summary.is_empty());
    assert!(parse(&vec![b'x'; MAX_RESPONSE_BYTES + 1], 3, "key").is_err());
    assert!(parse(b"not json", 3, "key").is_err());
    let value = completed(
        json!([{"url":"https://one.example"},{"url":"https://two.example"}]),
        json!([]),
    );
    assert_eq!(
        parse(&serde_json::to_vec(&value).unwrap(), 1, "key")
            .unwrap()
            .0
            .len(),
        1
    );
}
#[test]
fn config_metadata_never_serializes_the_active_key() {
    let view = ConfigView {
        enabled: true,
        has_api_key: false,
        provider: super::super::SearchProvider::Openai,
        openai_ready: false,
        openai_model: None,
    };
    let view = config_view(view, Some(&slot()));
    assert!(view.openai_ready);
    assert_eq!(view.openai_model.as_deref(), Some("gpt-search-model"));
    assert!(!serde_json::to_string(&view)
        .unwrap()
        .contains("unit-test-api-key"));
}
