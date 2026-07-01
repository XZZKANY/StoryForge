use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLlmConfig {
    provider: String,
    base_url: String,
    model: String,
    api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmConfigRequest {
    provider: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    clear_api_key: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfigResponse {
    provider: String,
    base_url: String,
    model: String,
    has_api_key: bool,
}

fn clean(value: &str) -> String {
    value.trim().to_string()
}

fn config_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_config_dir().context("无法获取应用配置目录")?;
    fs::create_dir_all(&dir).context("无法创建应用配置目录")?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(config_dir(app)?.join("llm-provider.json"))
}

pub fn sqlite_database_url(app: &AppHandle) -> Result<String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .context("无法获取应用数据目录")?;
    fs::create_dir_all(&data_dir).context("无法创建应用数据目录")?;
    let db_path = data_dir.join("storyforge.sqlite3");
    let path = db_path.to_string_lossy().replace('\\', "/");
    Ok(format!("sqlite+pysqlite:///{}", path))
}

fn read_stored_config(app: &AppHandle) -> Result<StoredLlmConfig> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(StoredLlmConfig::default());
    }

    let raw = fs::read_to_string(&path).context("无法读取 LLM 配置文件")?;
    let config = serde_json::from_str::<StoredLlmConfig>(&raw).context("无法解析 LLM 配置文件")?;
    Ok(config)
}

fn write_stored_config(app: &AppHandle, config: &StoredLlmConfig) -> Result<()> {
    let path = config_path(app)?;
    let payload = serde_json::to_string_pretty(config).context("无法序列化 LLM 配置")?;
    fs::write(&path, payload).context("无法写入 LLM 配置文件")?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&path)
            .context("无法读取 LLM 配置文件权限")?
            .permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&path, permissions).context("无法设置 LLM 配置文件权限")?;
    }

    Ok(())
}

impl From<StoredLlmConfig> for LlmConfigResponse {
    fn from(config: StoredLlmConfig) -> Self {
        Self {
            provider: config.provider,
            base_url: config.base_url,
            model: config.model,
            has_api_key: !config.api_key.trim().is_empty(),
        }
    }
}

pub fn llm_env_for_backend(app: &AppHandle) -> Result<Vec<(String, String)>> {
    let config = read_stored_config(app)?;
    let mut env = Vec::new();

    // 把本机 LLM 配置文件路径交给后端，后端实时读取即可换模型/服务商，无需重启。
    env.push((
        "STORYFORGE_LLM_CONFIG_FILE".to_string(),
        config_path(app)?.to_string_lossy().to_string(),
    ));

    if !config.provider.trim().is_empty() {
        env.push(("STORYFORGE_LLM_PROVIDER".to_string(), clean(&config.provider)));
    }
    if !config.base_url.trim().is_empty() {
        let base_url = clean(&config.base_url);
        env.push(("STORYFORGE_LLM_BASE_URL".to_string(), base_url.clone()));
        env.push(("STORYFORGE_LLM_API_BASE_URL".to_string(), base_url));
    }
    if !config.model.trim().is_empty() {
        env.push(("STORYFORGE_LLM_MODEL".to_string(), clean(&config.model)));
    }
    if !config.api_key.trim().is_empty() {
        env.push(("STORYFORGE_LLM_API_KEY".to_string(), clean(&config.api_key)));
    }

    Ok(env)
}

#[tauri::command]
pub fn get_llm_config(app: AppHandle) -> Result<LlmConfigResponse, String> {
    read_stored_config(&app)
        .map(Into::into)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_llm_config(app: AppHandle, payload: SaveLlmConfigRequest) -> Result<LlmConfigResponse, String> {
    let mut next = read_stored_config(&app).map_err(|error| error.to_string())?;
    next.provider = clean(&payload.provider);
    next.base_url = clean(&payload.base_url);
    next.model = clean(&payload.model);

    if payload.clear_api_key.unwrap_or(false) {
        next.api_key.clear();
    } else if let Some(api_key) = payload.api_key {
        let cleaned = clean(&api_key);
        if !cleaned.is_empty() {
            next.api_key = cleaned;
        }
    }

    write_stored_config(&app, &next).map_err(|error| error.to_string())?;
    Ok(next.into())
}
