use crate::{llm_config_store, runtime_paths};
use anyhow::Result;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub use crate::llm_config_store::{
    LlmProfilesResponse, SaveLlmProfileRequest, SavedLlmProfileResponse,
};

pub(crate) fn config_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(runtime_paths::app_config_dir(app)?.join("llm-provider.json"))
}

fn with_config<T>(app: &AppHandle, run: impl FnOnce(&Path) -> Result<T>) -> Result<T, String> {
    config_path(app)
        .and_then(|path| run(&path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_llm_profiles(app: AppHandle) -> Result<LlmProfilesResponse, String> {
    with_config(&app, llm_config_store::list)
}

#[tauri::command]
pub fn save_llm_profile(
    app: AppHandle,
    payload: SaveLlmProfileRequest,
) -> Result<SavedLlmProfileResponse, String> {
    with_config(&app, |path| llm_config_store::save_profile(path, payload))
}

#[tauri::command]
pub fn delete_llm_profile(app: AppHandle, id: String) -> Result<LlmProfilesResponse, String> {
    with_config(&app, |path| llm_config_store::delete_profile(path, &id))
}

#[tauri::command]
pub fn activate_llm_profile(
    app: AppHandle,
    id: String,
    model: Option<String>,
) -> Result<LlmProfilesResponse, String> {
    with_config(&app, |path| {
        llm_config_store::activate_profile(path, &id, model.as_deref())
    })
}

#[tauri::command]
pub fn set_llm_polish_profile(
    app: AppHandle,
    id: Option<String>,
) -> Result<LlmProfilesResponse, String> {
    with_config(&app, |path| {
        llm_config_store::set_polish_profile(path, id.as_deref())
    })
}
