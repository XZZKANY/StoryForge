//! 宿主报给引擎读作品口、界面读写作品文件、模型出网与「获取模型」的结构化错误，
//! 序列化成 `{ kind, message }`。前端只按 kind 分类（`lib/engine/reader.ts`、`lib/engine/llm.ts`、
//! `lib/host/desktop-llm-config.ts`、`lib/host/tauri-fs.ts`），不解析 message 的措辞；字段名、kind 取值与
//! message 文案都是对前端的约定。
//!
//! - 读作品（`fs_engine_reader`）：`outside-project` 越出作品，`io` 其余读错。
//! - 界面读写作品文件（`fs`）：读文件 `missing` 作品内还没有这个文件、`outside-project` 越出作品；
//!   按基线写入（含带回执写入）`drift` 磁盘内容与基线不符、已拒绝覆盖；其余 `io`。
//! - 模型出网（`engine_llm`）：`config` 配置文件读不出或密钥解不开，`refused` 出网策略拒绝，
//!   `connect` / `timeout` / `read` 网络层失败。
//! - 获取模型（`llm_draft_probe`）：`unauthorized` Key 不对，`misconfigured` 填写有问题，
//!   `unreachable` 连不上或返回不对。
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct HostError {
    pub(crate) kind: &'static str,
    pub(crate) message: String,
}

impl HostError {
    pub(crate) fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

// 读作品口靠 `?` 把没归类的字符串报错直接转过来，这些一律算 io。
impl From<String> for HostError {
    fn from(message: String) -> Self {
        Self::new("io", message)
    }
}

impl From<&str> for HostError {
    fn from(message: &str) -> Self {
        Self::new("io", message)
    }
}

#[cfg(test)]
mod tests {
    use super::HostError;
    use std::path::Path;

    #[test]
    fn every_kind_serializes_to_the_shape_the_frontend_reads() {
        let cases = [
            (
                HostError::new("outside-project", "作品读取路径越过文件系统根"),
                r#"{"kind":"outside-project","message":"作品读取路径越过文件系统根"}"#,
            ),
            (
                HostError::new("io", "作品目录读取预算无效"),
                r#"{"kind":"io","message":"作品目录读取预算无效"}"#,
            ),
            (
                HostError::new("missing", "作品文件不存在: D:/书/.storyforge/book.json"),
                r#"{"kind":"missing","message":"作品文件不存在: D:/书/.storyforge/book.json"}"#,
            ),
            (
                HostError::new(
                    "drift",
                    "磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突: D:/书/正文/第001章.md",
                ),
                r#"{"kind":"drift","message":"磁盘内容已变化，已拒绝覆盖；请重新读取并处理冲突: D:/书/正文/第001章.md"}"#,
            ),
            (
                HostError::new("config", "无法读取 LLM 配置"),
                r#"{"kind":"config","message":"无法读取 LLM 配置"}"#,
            ),
            (
                HostError::new(
                    "refused",
                    "模型请求只能发往已配置的 base URL；配置若刚改过，请重试。",
                ),
                r#"{"kind":"refused","message":"模型请求只能发往已配置的 base URL；配置若刚改过，请重试。"}"#,
            ),
            (
                HostError::new("connect", "连接被拒绝"),
                r#"{"kind":"connect","message":"连接被拒绝"}"#,
            ),
            (
                HostError::new("timeout", "timed out"),
                r#"{"kind":"timeout","message":"timed out"}"#,
            ),
            (
                HostError::new("read", "EngineLlmStateLock"),
                r#"{"kind":"read","message":"EngineLlmStateLock"}"#,
            ),
            (
                HostError::new("unauthorized", "Key 不对或没有权限（HTTP 401）。"),
                r#"{"kind":"unauthorized","message":"Key 不对或没有权限（HTTP 401）。"}"#,
            ),
            (
                HostError::new("misconfigured", "服务地址要以 http:// 或 https:// 开头。"),
                r#"{"kind":"misconfigured","message":"服务地址要以 http:// 或 https:// 开头。"}"#,
            ),
            (
                HostError::new(
                    "unreachable",
                    "返回的不是模型列表：检查服务地址是否填对（兼容服务的地址通常以 /v1 结尾）。",
                ),
                r#"{"kind":"unreachable","message":"返回的不是模型列表：检查服务地址是否填对（兼容服务的地址通常以 /v1 结尾）。"}"#,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(serde_json::to_string(&error).unwrap(), expected);
        }
    }

    #[test]
    fn unclassified_string_failures_are_io() {
        assert_eq!(
            HostError::from(String::from("无法打开作品目录: x")),
            HostError::new("io", "无法打开作品目录: x")
        );
        assert_eq!(
            HostError::from("作品读取根路径必须为绝对路径"),
            HostError::new("io", "作品读取根路径必须为绝对路径")
        );
    }

    /// 具名结构体的字段名；只认 `struct 名字 { … }`，元组结构体与单元结构体跳过。
    fn named_structs(text: &str) -> Vec<(String, Vec<String>)> {
        let mut found = Vec::new();
        let mut rest = text;
        while let Some(at) = rest.find("struct ") {
            rest = &rest[at + "struct ".len()..];
            let name: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            let Some(open) = rest.find(['{', ';', '(']) else {
                break;
            };
            if name.is_empty() || !rest[open..].starts_with('{') {
                continue;
            }
            let body = &rest[open + 1..];
            let mut depth = 1;
            let close = body
                .char_indices()
                .find(|(_, c)| {
                    match c {
                        '{' => depth += 1,
                        '}' => depth -= 1,
                        _ => {}
                    }
                    depth == 0
                })
                .map_or(body.len(), |(index, _)| index);
            let fields = body[..close]
                .split(['\n', ','])
                .filter_map(|line| {
                    let line = line.trim();
                    let line = match line.strip_prefix("pub") {
                        Some(after) if after.starts_with('(') => after.split_once(')')?.1,
                        Some(after) => after,
                        None => line,
                    }
                    .trim_start();
                    let (field, after) = line.split_once(':')?;
                    let field = field.trim();
                    (!after.starts_with(':')
                        && !field.is_empty()
                        && field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
                    .then(|| field.to_string())
                })
                .collect();
            found.push((name, fields));
        }
        found
    }

    #[test]
    fn host_error_is_the_only_kind_message_error_struct() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found = Vec::new();
        for entry in walkdir::WalkDir::new(&src) {
            let entry = entry.unwrap();
            if entry.path().extension().is_none_or(|ext| ext != "rs") {
                continue;
            }
            let text = std::fs::read_to_string(entry.path()).unwrap();
            for (name, fields) in named_structs(&text) {
                let has = |field: &str| fields.iter().any(|item| item == field);
                if has("kind") && (has("message") || name.ends_with("Error")) {
                    let file = entry.path().strip_prefix(&src).unwrap();
                    found.push(format!("{}::{name}", file.display()));
                }
            }
        }
        assert_eq!(
            found,
            ["host_error.rs::HostError"],
            "带 kind 的报错结构体只留 host_error.rs 里这一个，新的出错类别加 kind 取值即可"
        );
    }
}
