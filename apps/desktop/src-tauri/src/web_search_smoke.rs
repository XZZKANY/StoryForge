//! 隔离原生 IPC 探针：只验证加密配置与禁用时拒绝请求，绝不发起外部搜索。
use serde_json::Value;
use std::time::{Duration, Instant};

const START: &str = r#"
(() => {
  const state = window.__STORYFORGE_WEB_SEARCH_SMOKE__ = {
    done: false, failed: false, default_disabled: false, saved_disabled: false,
    enabled_with_saved_key: false, preserved_key: false, disabled_refused: false,
    cleared: false, openai_selected: false, no_key_leak: true, page_read_disabled: false, page_private_refused: false
  };
  void (async () => {
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== 'function') throw new Error('missing IPC');
    const key = 'tvly-smoke-synthetic-key-not-a-real-key';
    const checked = (value) => {
      state.no_key_leak = state.no_key_leak && !JSON.stringify(value).includes(key)
        && Object.keys(value).sort().join(',') === 'enabled,hasApiKey,openaiModel,openaiReady,provider'
        && value.provider === 'tavily';
      return value;
    };
    const initial = checked(await invoke('web_search_get_config'));
    state.default_disabled = initial.enabled === false && initial.hasApiKey === false;
    // 若目录不是全新隔离环境，立即退出，不能覆盖任何预先存在的搜索配置。
    if (!state.default_disabled) throw new Error('not an empty isolated configuration');
    const saved = checked(await invoke('web_search_save_config', {
      request: { enabled: false, apiKey: key }
    }));
    state.saved_disabled = saved.enabled === false && saved.hasApiKey === true;
    const enabled = checked(await invoke('web_search_save_config', {
      request: { enabled: true, apiKey: null }
    }));
    const retained = checked(await invoke('web_search_get_config'));
    state.enabled_with_saved_key = enabled.enabled === true && enabled.hasApiKey === true;
    state.preserved_key = retained.enabled === true && retained.hasApiKey === true;
    try { await invoke('web_read_execute', {request: {url: 'http://127.0.0.1/'}}); }
    catch (error) { state.page_private_refused = String(error).includes('公开网页'); }
    const disabled = checked(await invoke('web_search_save_config', {
      request: { enabled: false, apiKey: '' }
    }));
    if (disabled.enabled !== false) throw new Error('disable was not applied');
    try {
      await invoke('web_search_execute', { request: { query: '隔离冒烟查询', maxResults: 1 } });
    } catch (error) {
      state.disabled_refused = String(error).includes('未启用');
      state.no_key_leak = state.no_key_leak && !String(error).includes(key);
    }
    try { await invoke('web_read_execute', {request: {url: 'https://example.com/'}}); }
    catch (error) { state.page_read_disabled = String(error).includes('未启用'); }
    const cleared = checked(await invoke('web_search_save_config', {
      request: { enabled: false, clearApiKey: true }
    }));
    const empty = checked(await invoke('web_search_get_config'));
    state.cleared = cleared.enabled === false && cleared.hasApiKey === false
      && empty.enabled === false && empty.hasApiKey === false;
    const openai = await invoke('web_search_save_config', { request: { enabled: false, provider: 'openai' } });
    state.openai_selected = openai.provider === 'openai' && openai.enabled === false && !JSON.stringify(openai).includes(key);
    checked(await invoke('web_search_save_config', { request: { enabled: false, provider: 'tavily' } }));
    state.done = true;
  })().catch(() => { state.failed = true; state.done = true; });
  return { started: true };
})()
"#;

const STATUS: &str = "(() => window.__STORYFORGE_WEB_SEARCH_SMOKE__ ?? { done: false })()";
const REQUIRED: [&str; 11] = [
    "done",
    "default_disabled",
    "saved_disabled",
    "enabled_with_saved_key",
    "preserved_key",
    "disabled_refused",
    "cleared",
    "no_key_leak",
    "openai_selected",
    "page_read_disabled",
    "page_private_refused",
];

fn verified(value: &Value) -> bool {
    value.get("failed").and_then(Value::as_bool) == Some(false)
        && REQUIRED
            .iter()
            .all(|key| value.get(key).and_then(Value::as_bool) == Some(true))
        && value
            .as_object()
            .is_some_and(|object| object.values().all(Value::is_boolean))
}

pub(super) fn verify<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    if !crate::runtime_paths::is_smoke_mode() {
        return Err("联网搜索配置探针仅允许隔离冒烟模式。".into());
    }
    // 每次查询最多1.5秒，预留完整单次时间后才发下一次，整个探针不超过8秒。
    let deadline = Instant::now() + Duration::from_secs(8);
    super::eval_window_json(window, START, Duration::from_millis(500))
        .map_err(|_| "联网搜索配置 IPC 探针未能启动。".to_owned())?;
    while deadline.saturating_duration_since(Instant::now()) > Duration::from_millis(1600) {
        let state = super::wait_for_window_state(window, STATUS, 1, Duration::ZERO, |value| {
            value.get("done").and_then(Value::as_bool) == Some(true)
        });
        if let Ok(value) = state {
            if !verified(&value) {
                return Err("联网搜索配置 IPC 核验失败，未输出任何密钥。".into());
            }
            println!("Desktop native web search config evidence: {value}");
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("联网搜索配置 IPC 探针超时。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_evidence_requires_every_check_and_contains_only_booleans() {
        let mut value = serde_json::json!({"failed": false});
        for key in REQUIRED {
            value[key] = true.into();
        }
        assert!(verified(&value));
        for key in REQUIRED {
            let mut incomplete = value.clone();
            incomplete[key] = false.into();
            assert!(!verified(&incomplete), "missing check {key}");
        }
        value["extra"] = "not allowed in emitted evidence".into();
        assert!(!verified(&value));
    }
}
