use crate::{llm_config_store, runtime_paths};
use anyhow::Result;
use std::path::PathBuf;
use tauri::AppHandle;

pub use crate::llm_config_store::{LlmConfigResponse, SaveLlmConfigRequest};

pub(crate) fn config_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(runtime_paths::app_config_dir(app)?.join("llm-provider.json"))
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
