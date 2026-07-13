use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl};

#[derive(Debug, Serialize, Deserialize)]
pub struct PublishApiResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct PublishApiRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    #[serde(default = "default_timeout_secs")]
    timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishCookieCapturePayload {
    pub cookies: String,
    pub url: String,
    pub account_id: Option<String>,
}

fn default_timeout_secs() -> u64 {
    15
}

/// 代理 HTTP 请求到发布平台 API（Rust reqwest -> 绕过 CORS）
/// Cookie 由前端填入 headers（用户手动粘贴，不存服务端）
#[tauri::command]
pub fn publish_api_request(
    request: PublishApiRequest,
) -> Result<PublishApiResponse, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(request.timeout_secs))
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let mut req = match request.method.to_uppercase().as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "PATCH" => client.patch(&request.url),
        "DELETE" => client.delete(&request.url),
        other => return Err(format!("不支持的 HTTP 方法: {}", other)),
    };

    for (key, value) in &request.headers {
        req = req.header(key.as_str(), value.as_str());
    }

    if let Some(body) = &request.body {
        // 如果 header 没有 Content-Type，尝试自动检测 JSON
        if !request.headers.contains_key("content-type") {
            if body.trim_start().starts_with('{') || body.trim_start().starts_with('[') {
                req = req.header("Content-Type", "application/json");
            }
        }
        req = req.body(body.clone());
    }

    let response = req.send().map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = response.status().as_u16();
    let resp_headers: HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = response.text().map_err(|e| format!("读取响应体失败: {}", e))?;

    Ok(PublishApiResponse {
        status,
        headers: resp_headers,
        body,
    })
}

/// 打开内置 WebView 窗口跳转平台登录页，用户登录后自动提取 Cookie。
/// 通过 Tauri event `publish:cookie-captured` 回传前端。
#[tauri::command]
pub fn publish_open_login_webview(
    app: AppHandle,
    login_url: String,
    account_id: Option<String>,
) -> Result<(), String> {
    // 如果已有登录窗口，先关闭
    if let Some(existing) = app.get_webview_window("publish-login") {
        let _ = existing.close();
    }

    let parsed_url = login_url
        .parse::<tauri::Url>()
        .map_err(|e| format!("URL 解析失败: {}", e))?;

    let webview = tauri::WebviewWindowBuilder::new(
        &app,
        "publish-login",
        WebviewUrl::External(parsed_url),
    )
    .title("平台登录 — 登录后 Cookie 自动提取")
    .inner_size(1024.0, 720.0)
    .build()
    .map_err(|e| format!("创建登录窗口失败: {}", e))?;

    let handle = app.clone();
    let aid = account_id.clone();

    webview.listen("publish:cookie-captured", move |event: tauri::Event| {
        let payload: PublishCookieCapturePayload = match serde_json::from_str(event.payload()) {
            Ok(p) => p,
            Err(_) => return,
        };
        let mut p = payload;
        p.account_id = aid.clone();
        let _ = handle.emit("publish:cookie-captured", p);
        // 关闭登录窗口
        if let Some(w) = handle.get_webview_window("publish-login") {
            let _ = w.close();
        }
    });

    // 注入 JS：每 2 秒轮询，检测 Cookie 出现后回传
    let js = r#"
    (function() {
      var tries = 0;
      var maxTries = 180;
      var check = setInterval(function() {
        tries++;
        var c = document.cookie;
        var hasCookie = c.length > 50;
        if (hasCookie && window.__TAURI__) {
          clearInterval(check);
          try {
            window.__TAURI__.event.emit('publish:cookie-captured', {
              cookies: c,
              url: window.location.href
            });
          } catch(e) {
            console.error('Cookie capture failed:', e);
          }
        }
        if (tries >= maxTries) {
          clearInterval(check);
          console.warn('Login cookie capture timed out');
        }
      }, 2000);
    })();
    "#;

    webview.eval(js).map_err(|e| format!("注入 Cookie 采集脚本失败: {}", e))?;

    Ok(())
}


/// 番茄 API 发布：起隐藏 webview 加载 muye 页，用页面自身 fetch（secsdk 自动补 x-secsdk-csrf-token）
/// 依次 new_article -> cover_article -> publish_article，结果经 `publish:chapter-result` 事件回传前端。
/// 详见 fanqie-api/写侧架构.md。
#[tauri::command]
pub fn publish_fanqie_chapter(
    app: AppHandle,
    book_id: String,
    volume_id: String,
    volume_name: String,
    title: String,
    content_html: String,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("publish-worker") {
        let _ = existing.close();
    }

    let url = "https://fanqienovel.com/main/writer/book-manage"
        .parse::<tauri::Url>()
        .map_err(|e| format!("URL 解析失败: {}", e))?;

    let webview = tauri::WebviewWindowBuilder::new(&app, "publish-worker", WebviewUrl::External(url))
        .title("番茄发布中…")
        .inner_size(960.0, 720.0)
        .visible(false)
        .build()
        .map_err(|e| format!("创建发布 webview 失败: {}", e))?;

    let handle = app.clone();
    webview.listen("publish:chapter-result", move |event: tauri::Event| {
        let value: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or(serde_json::Value::Null);
        let _ = handle.emit("publish:chapter-result", value);
        if let Some(w) = handle.get_webview_window("publish-worker") {
            let _ = w.close();
        }
    });

    let params = serde_json::json!({
        "book_id": book_id,
        "volume_id": volume_id,
        "volume_name": volume_name,
        "title": title,
        "content": content_html,
    })
    .to_string();

    let js = build_publish_js(&params);
    webview
        .eval(&js)
        .map_err(|e| format!("注入发布脚本失败: {}", e))?;

    Ok(())
}

fn build_publish_js(params_json: &str) -> String {
    format!(
        r#"
    (function() {{
      var P = {params};
      var Q = 'aid=2503&app_name=muye_novel';
      function emit(obj) {{ try {{ window.__TAURI__.event.emit('publish:chapter-result', obj); }} catch (e) {{}} }}
      function form(obj) {{ return Object.keys(obj).map(function(k) {{ return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]); }}).join('&'); }}
      function postForm(p, obj) {{
        return fetch('https://fanqienovel.com' + p + '?' + Q, {{ method: 'POST', headers: {{ 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }}, credentials: 'include', body: form(obj) }})
          .then(function(r) {{ return r.text().then(function(t) {{ return {{ status: r.status, body: t }}; }}); }});
      }}
      function getJson(p) {{
        return fetch('https://fanqienovel.com' + p + '&' + Q, {{ credentials: 'include' }})
          .then(function(r) {{ return r.text().then(function(t) {{ return {{ status: r.status, body: t }}; }}); }});
      }}
      function sleep(ms) {{ return new Promise(function(r) {{ setTimeout(r, ms); }}); }}
      async function ready() {{
        for (var i = 0; i < 24; i++) {{
          try {{ var c = await getJson('/api/author/account/info/v0/?_=' + i); var j = JSON.parse(c.body); if (j && j.code === 0) return true; }} catch (e) {{}}
          await sleep(500);
        }}
        return false;
      }}
      async function run() {{
        try {{
          if (!(await ready())) {{ emit({{ ok: false, step: 'ready', msg: '会话未就绪（cookie 失效或未登录）' }}); return; }}
          var na = await postForm('/api/author/article/new_article/v0/', {{ aid: '2503', app_name: 'muye_novel', book_id: P.book_id, need_reuse: '1' }});
          var itemId = '';
          try {{ var nj = JSON.parse(na.body); itemId = (nj.data && (nj.data.item_id || (nj.data.column_data && nj.data.column_data.item_id))) || ''; }} catch (e) {{}}
          if (!itemId) {{
            var dl = await getJson('/api/author/chapter/draft_list/v1?book_id=' + P.book_id);
            try {{ var dj = JSON.parse(dl.body); var l = (dj.data && (dj.data.draft_list || dj.data.list || dj.data.item_list)) || []; itemId = (l[0] && (l[0].item_id || l[0].chapter_id)) || ''; }} catch (e) {{}}
          }}
          if (!itemId) {{ emit({{ ok: false, step: 'new_article', msg: '拿不到 item_id' }}); return; }}
          await postForm('/api/author/article/cover_article/v0/', {{ aid: '2503', app_name: 'muye_novel', book_id: P.book_id, item_id: itemId, title: P.title, content: P.content, volume_name: P.volume_name, volume_id: P.volume_id }});
          var pa = await postForm('/api/author/publish_article/v0/', {{ aid: '2503', app_name: 'muye_novel', item_id: itemId, book_id: P.book_id, content: P.content, title: P.title, volume_id: P.volume_id, volume_name: P.volume_name, publish_status: '1', timer_status: '0', timer_time: '', need_pay: '0', device_platform: 'pc', speak_type: '0', use_ai: '2', timer_chapter_preview: '[]', has_chapter_ad: 'false', chapter_ad_types: '' }});
          var pj = {{}};
          try {{ pj = JSON.parse(pa.body); }} catch (e) {{}}
          emit({{ ok: pj.code === 0, code: pj.code, msg: pj.message || '', item_id: itemId, status: pa.status }});
        }} catch (e) {{ emit({{ ok: false, step: 'exception', msg: String(e) }}); }}
      }}
      run();
    }})();
    "#,
        params = params_json
    )
}