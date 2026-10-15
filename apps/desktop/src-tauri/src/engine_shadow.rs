//! Shadow mode records (TS migration P5-1): Python still produces the result, the engine composes
//! the same request on the side and the frontend compares the two. Results are appended to two
//! fixed files in the local data directory, one JSON object per line. The frontend only sends
//! structure (fields, positions, lengths, digests), never manuscript text. Removed with the
//! engine switches in P6.
use crate::runtime_paths;
use serde::Deserialize;
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use tauri::AppHandle;

pub const SHADOW_DIFFS_FILE: &str = "shadow-diffs.jsonl";
pub const SHADOW_CHECKS_FILE: &str = "shadow-checks.jsonl";
const MAX_RECORD_BYTES: usize = 64 * 1024;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

static APPEND: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ShadowLog {
    Diffs,
    Checks,
}

impl ShadowLog {
    fn file_name(self) -> &'static str {
        match self {
            ShadowLog::Diffs => SHADOW_DIFFS_FILE,
            ShadowLog::Checks => SHADOW_CHECKS_FILE,
        }
    }
}

/// Appends one record as a compact single line (newlines inside strings stay escaped).
/// `Ok(false)` once the file reached its cap: the record is dropped, earlier lines are kept.
pub(crate) fn append(dir: &Path, log: ShadowLog, record: &Value) -> Result<bool, String> {
    if !record.is_object() {
        return Err("影子记录必须是 JSON 对象".into());
    }
    let line = serde_json::to_string(record).map_err(|error| error.to_string())?;
    if line.len() > MAX_RECORD_BYTES {
        return Err(format!("影子记录超过 {MAX_RECORD_BYTES} 字节"));
    }
    let _guard = APPEND
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::fs::create_dir_all(dir).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    let path = dir.join(log.file_name());
    let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    if size + line.len() as u64 + 1 > MAX_FILE_BYTES {
        return Ok(false);
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("无法打开影子记录：{error}"))?;
    file.write_all(format!("{line}\n").as_bytes())
        .map_err(|error| format!("无法写入影子记录：{error}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn engine_shadow_append(
    app: AppHandle,
    log: ShadowLog,
    record: Value,
) -> Result<bool, String> {
    let dir = runtime_paths::app_local_data_dir(&app).map_err(|error| error.to_string())?;
    append(&dir, log, &record)
}

#[cfg(test)]
#[path = "engine_shadow_tests.rs"]
mod tests;
