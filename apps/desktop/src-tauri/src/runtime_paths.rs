use anyhow::{bail, Context, Result};
use std::ffi::OsStr;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const SMOKE_MODE_ENV: &str = "STORYFORGE_DESKTOP_SMOKE";
const SMOKE_LOCAL_DATA_ENV: &str = "STORYFORGE_DESKTOP_SMOKE_LOCAL_DATA_DIR";
const SMOKE_CONFIG_ENV: &str = "STORYFORGE_DESKTOP_SMOKE_CONFIG_DIR";
pub(crate) const SMOKE_ISOLATION_PROTOCOL: &str = "storyforge-smoke-isolation-v1";

fn enabled(value: Option<&OsStr>) -> bool {
    value
        .map(|entry| {
            let entry = entry.to_string_lossy();
            entry == "1" || entry.eq_ignore_ascii_case("true")
        })
        .unwrap_or(false)
}

pub(crate) fn environment_flag(variable: &str) -> bool {
    enabled(std::env::var_os(variable).as_deref())
}

fn configured_smoke_directory(
    smoke_value: Option<&OsStr>,
    directory_value: Option<&OsStr>,
    variable: &str,
) -> Result<Option<PathBuf>> {
    if !enabled(smoke_value) {
        return Ok(None);
    }
    let value = directory_value
        .filter(|entry| !entry.is_empty())
        .with_context(|| format!("Smoke 模式缺少隔离目录环境变量 {variable}"))?;
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        bail!(
            "Smoke 隔离目录必须是绝对路径 {variable}: {}",
            path.display()
        );
    }
    Ok(Some(path))
}

pub(crate) fn is_smoke_mode() -> bool {
    environment_flag(SMOKE_MODE_ENV)
}

pub(crate) fn app_local_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    if let Some(path) = configured_smoke_directory(
        std::env::var_os(SMOKE_MODE_ENV).as_deref(),
        std::env::var_os(SMOKE_LOCAL_DATA_ENV).as_deref(),
        SMOKE_LOCAL_DATA_ENV,
    )? {
        return Ok(path);
    }
    app.path()
        .app_local_data_dir()
        .context("无法获取应用数据目录")
}

pub(crate) fn app_config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    if let Some(path) = configured_smoke_directory(
        std::env::var_os(SMOKE_MODE_ENV).as_deref(),
        std::env::var_os(SMOKE_CONFIG_ENV).as_deref(),
        SMOKE_CONFIG_ENV,
    )? {
        return Ok(path);
    }
    app.path().app_config_dir().context("无法获取应用配置目录")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_directories_are_required_and_absolute() {
        let absolute = std::env::temp_dir().join("storyforge-smoke-data");
        assert_eq!(
            configured_smoke_directory(
                Some(OsStr::new("1")),
                Some(absolute.as_os_str()),
                SMOKE_LOCAL_DATA_ENV,
            )
            .unwrap(),
            Some(absolute)
        );
        assert!(
            configured_smoke_directory(Some(OsStr::new("true")), None, SMOKE_LOCAL_DATA_ENV,)
                .unwrap_err()
                .to_string()
                .contains(SMOKE_LOCAL_DATA_ENV)
        );
        assert!(configured_smoke_directory(
            Some(OsStr::new("1")),
            Some(OsStr::new("relative/path")),
            SMOKE_LOCAL_DATA_ENV,
        )
        .unwrap_err()
        .to_string()
        .contains("绝对路径"));
        assert_eq!(
            configured_smoke_directory(None, None, SMOKE_LOCAL_DATA_ENV).unwrap(),
            None
        );
    }
}
