use crate::{llm_config_store, runtime_paths};
use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub use crate::llm_config_store::{LlmConfigResponse, SaveLlmConfigRequest};

fn config_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(runtime_paths::app_config_dir(app)?.join("llm-provider.json"))
}

pub fn sqlite_database_url(app: &AppHandle) -> Result<String> {
    let data_dir = runtime_paths::app_local_data_dir(app)?;
    fs::create_dir_all(&data_dir).context("无法创建应用数据目录")?;
    let db_path = data_dir.join("storyforge.sqlite3");
    let path = db_path.to_string_lossy().replace('\\', "/");
    Ok(format!("sqlite+pysqlite:///{}", path))
}

pub fn llm_env_for_backend(app: &AppHandle) -> Result<Vec<(String, String)>> {
    backend_env_for_path(&config_path(app)?)
}

fn backend_env_for_path(path: &Path) -> Result<Vec<(String, String)>> {
    // Complete migration before spawning the managed backend. First launch writes
    // an empty v2 config, so inherited env/.env keys cannot act as fallback.
    llm_config_store::prepare(path)?;
    Ok(vec![
        (
            "STORYFORGE_LLM_CONFIG_FILE".into(),
            path.to_string_lossy().into(),
        ),
        (
            "STORYFORGE_LLM_CONFIG_MODE".into(),
            "desktop-managed-v2".into(),
        ),
        ("STORYFORGE_LLM_API_KEY".into(), String::new()),
        ("STORYFORGE_POLISH_LLM_API_KEY".into(), String::new()),
    ])
}

#[tauri::command]
pub fn get_llm_config(app: AppHandle) -> Result<LlmConfigResponse, String> {
    config_path(&app)
        .and_then(|path| llm_config_store::read(&path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_llm_config(
    app: AppHandle,
    payload: SaveLlmConfigRequest,
) -> Result<LlmConfigResponse, String> {
    config_path(&app)
        .and_then(|path| llm_config_store::save(&path, payload))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_backend_env_contains_no_secret_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("llm-provider.json");
        let env: std::collections::HashMap<_, _> =
            backend_env_for_path(&path).unwrap().into_iter().collect();
        assert!(path.is_file());
        assert_eq!(env["STORYFORGE_LLM_CONFIG_MODE"], "desktop-managed-v2");
        assert_eq!(env["STORYFORGE_LLM_CONFIG_FILE"], path.to_string_lossy());
        assert_eq!(env["STORYFORGE_LLM_API_KEY"], "");
        assert_eq!(env["STORYFORGE_POLISH_LLM_API_KEY"], "");
        assert_eq!(env.len(), 4);
    }

    #[test]
    fn migration_failure_does_not_produce_spawn_environment() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("llm-provider.json");
        fs::write(&path, "{broken-test-data").unwrap();
        assert!(backend_env_for_path(&path).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "{broken-test-data");
    }
}
