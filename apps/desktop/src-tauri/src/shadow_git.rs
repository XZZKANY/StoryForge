mod core;

#[cfg(test)]
mod tests;

use core::{CoreSnapshot, ShadowGitCore, SharedState};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};

const BUNDLED_GIT_MANIFEST: &str = include_str!("../resources/mingit/manifest.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledGitManifest {
    version: String,
    executable: String,
}

#[derive(Clone, Default)]
pub struct ShadowGitState {
    shared: Arc<SharedState>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowSnapshotCreateRequest {
    project_root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowSnapshot {
    tree_hash: String,
    git_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowRetainRequest {
    project_root: String,
    tree_hash: String,
    record_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowReleaseRequest {
    project_root: String,
    record_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowFileRequest {
    project_root: String,
    tree_hash: String,
    file_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowFileState {
    exists: bool,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowHashFilterRequest {
    project_root: String,
    hashes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowStatusRequest {
    project_root: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowGitStatus {
    git_version: String,
    executable_path: String,
    shadow_repository_path: String,
}

fn bundled_manifest() -> Result<BundledGitManifest, String> {
    serde_json::from_str(BUNDLED_GIT_MANIFEST)
        .map_err(|error| format!("无法解析内置 Git manifest: {error}"))
}

fn core_for_app<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &ShadowGitState,
) -> Result<ShadowGitCore, String> {
    let manifest = bundled_manifest()?;
    let relative_executable = PathBuf::from("resources")
        .join("mingit")
        .join("runtime")
        .join(&manifest.executable);
    let git_executable = app
        .path()
        .resolve(relative_executable, BaseDirectory::Resource)
        .map_err(|error| format!("无法解析内置 Git 资源路径: {error}"))?;
    if !git_executable.is_file() {
        return Err(format!(
            "内置 Git 运行时缺失: {}。请重新安装 StoryForge。",
            git_executable.display()
        ));
    }
    let data_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法解析应用数据目录: {error}"))?;
    Ok(ShadowGitCore::new(
        git_executable,
        data_root,
        Some(manifest.version),
        Arc::clone(&state.shared),
    ))
}

pub(crate) struct ShadowGitSmokeEvidence {
    pub(crate) git_version: String,
    pub(crate) executable_path: String,
    pub(crate) content: String,
}

pub(crate) fn verify_smoke_snapshot<R: tauri::Runtime>(
    app: &AppHandle<R>,
    project_root: &str,
    tree_hash: &str,
    record_id: &str,
    file_path: &str,
) -> Result<ShadowGitSmokeEvidence, String> {
    let state = app.state::<ShadowGitState>();
    let core = core_for_app(app, &state)?;
    let git_version = core.git_version()?;
    let executable_path = core.git_executable().to_string_lossy().to_string();
    let retained = core.filter_retained_hashes(project_root, &[tree_hash.to_string()])?;
    if retained != [tree_hash] {
        return Err(format!(
            "版本 ref refs/storyforge/versions/{record_id} 未保活 tree {tree_hash}"
        ));
    }
    let state = core.read_file(project_root, tree_hash, file_path)?;
    if !state.exists {
        return Err(format!("tree {tree_hash} 中缺少 {file_path}"));
    }
    Ok(ShadowGitSmokeEvidence {
        git_version,
        executable_path,
        content: state.content,
    })
}

async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| format!("影子 Git 后台任务异常结束: {error}"))?
}

#[tauri::command]
pub async fn create_shadow_snapshot(
    app: AppHandle,
    state: State<'_, ShadowGitState>,
    payload: ShadowSnapshotCreateRequest,
) -> Result<ShadowSnapshot, String> {
    let core = core_for_app(&app, &state)?;
    let snapshot = run_blocking(move || core.create_snapshot(&payload.project_root)).await?;
    Ok(ShadowSnapshot {
        tree_hash: snapshot.tree_hash,
        git_version: snapshot.git_version,
    })
}

#[tauri::command]
pub async fn retain_shadow_snapshot(
    app: AppHandle,
    state: State<'_, ShadowGitState>,
    payload: ShadowRetainRequest,
) -> Result<(), String> {
    let core = core_for_app(&app, &state)?;
    run_blocking(move || {
        core.retain_snapshot(
            &payload.project_root,
            &payload.tree_hash,
            &payload.record_id,
        )
    })
    .await
}

#[tauri::command]
pub async fn release_shadow_snapshot(
    app: AppHandle,
    state: State<'_, ShadowGitState>,
    payload: ShadowReleaseRequest,
) -> Result<(), String> {
    let core = core_for_app(&app, &state)?;
    run_blocking(move || core.release_snapshot(&payload.project_root, &payload.record_id)).await
}

#[tauri::command]
pub async fn read_shadow_snapshot_file(
    app: AppHandle,
    state: State<'_, ShadowGitState>,
    payload: ShadowFileRequest,
) -> Result<ShadowFileState, String> {
    let core = core_for_app(&app, &state)?;
    let result = run_blocking(move || {
        core.read_file(
            &payload.project_root,
            &payload.tree_hash,
            &payload.file_path,
        )
    })
    .await?;
    Ok(ShadowFileState {
        exists: result.exists,
        content: result.content,
    })
}

#[tauri::command]
pub async fn filter_shadow_snapshot_hashes(
    app: AppHandle,
    state: State<'_, ShadowGitState>,
    payload: ShadowHashFilterRequest,
) -> Result<Vec<String>, String> {
    let core = core_for_app(&app, &state)?;
    run_blocking(move || core.filter_retained_hashes(&payload.project_root, &payload.hashes)).await
}

#[tauri::command]
pub async fn shadow_git_status(
    app: AppHandle,
    state: State<'_, ShadowGitState>,
    payload: ShadowStatusRequest,
) -> Result<ShadowGitStatus, String> {
    let core = core_for_app(&app, &state)?;
    let executable_path = core.git_executable().to_string_lossy().to_string();
    let status = run_blocking(move || {
        let git_version = core.git_version()?;
        let shadow_repository_path = core.repository_path(&payload.project_root)?;
        Ok((git_version, shadow_repository_path))
    })
    .await?;
    Ok(ShadowGitStatus {
        git_version: status.0,
        executable_path,
        shadow_repository_path: status.1.to_string_lossy().to_string(),
    })
}

impl From<CoreSnapshot> for ShadowSnapshot {
    fn from(value: CoreSnapshot) -> Self {
        Self {
            tree_hash: value.tree_hash,
            git_version: value.git_version,
        }
    }
}
