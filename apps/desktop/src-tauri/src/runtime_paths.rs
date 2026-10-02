use anyhow::{bail, Context, Result};
use std::ffi::OsStr;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const SMOKE_MODE_ENV: &str = "STORYFORGE_DESKTOP_SMOKE";
const SMOKE_LOCAL_DATA_ENV: &str = "STORYFORGE_DESKTOP_SMOKE_LOCAL_DATA_DIR";
const SMOKE_CONFIG_ENV: &str = "STORYFORGE_DESKTOP_SMOKE_CONFIG_DIR";
const LIFECYCLE_SMOKE_ENV: &str = "STORYFORGE_DESKTOP_SMOKE_LIFECYCLE_ONLY";
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

fn directory_for_runtime(
    smoke_value: Option<&OsStr>,
    directory_value: Option<&OsStr>,
    variable: &str,
    fallback: impl FnOnce() -> Result<PathBuf>,
) -> Result<PathBuf> {
    match configured_smoke_directory(smoke_value, directory_value, variable)? {
        Some(path) => Ok(path),
        None => fallback(),
    }
}

fn lifecycle_smoke_selected(debug: bool, smoke: bool, lifecycle: bool) -> bool {
    debug && smoke && lifecycle
}

pub(crate) fn is_lifecycle_smoke_mode() -> bool {
    lifecycle_smoke_selected(
        cfg!(debug_assertions),
        is_smoke_mode(),
        environment_flag(LIFECYCLE_SMOKE_ENV),
    )
}

pub(crate) fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    directory_for_runtime(
        std::env::var_os(SMOKE_MODE_ENV).as_deref(),
        std::env::var_os(SMOKE_LOCAL_DATA_ENV).as_deref(),
        SMOKE_LOCAL_DATA_ENV,
        || app.path().app_data_dir().context("无法获取应用数据目录"),
    )
}

pub(crate) fn app_local_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    directory_for_runtime(
        std::env::var_os(SMOKE_MODE_ENV).as_deref(),
        std::env::var_os(SMOKE_LOCAL_DATA_ENV).as_deref(),
        SMOKE_LOCAL_DATA_ENV,
        || {
            app.path()
                .app_local_data_dir()
                .context("无法获取应用数据目录")
        },
    )
}

pub(crate) fn app_config_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    directory_for_runtime(
        std::env::var_os(SMOKE_MODE_ENV).as_deref(),
        std::env::var_os(SMOKE_CONFIG_ENV).as_deref(),
        SMOKE_CONFIG_ENV,
        || app.path().app_config_dir().context("无法获取应用配置目录"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_override_never_falls_through_to_daily_data_on_invalid_smoke_input() {
        let root = std::env::temp_dir().join("storyforge-lifecycle-isolation");
        assert_eq!(
            directory_for_runtime(
                Some(OsStr::new("1")),
                Some(root.as_os_str()),
                SMOKE_LOCAL_DATA_ENV,
                || panic!("smoke must never read daily data"),
            )
            .unwrap(),
            root
        );
        assert!(directory_for_runtime(
            Some(OsStr::new("1")),
            None,
            SMOKE_LOCAL_DATA_ENV,
            || panic!("missing smoke root must not fall through"),
        )
        .is_err());
        assert!(directory_for_runtime(
            Some(OsStr::new("true")),
            Some(OsStr::new("relative/path")),
            SMOKE_LOCAL_DATA_ENV,
            || panic!("relative smoke root must not fall through"),
        )
        .is_err());
        let daily = std::env::temp_dir().join("daily-data-fixture");
        assert_eq!(
            directory_for_runtime(
                None,
                Some(OsStr::new("ignored")),
                SMOKE_LOCAL_DATA_ENV,
                || Ok(daily.clone()),
            )
            .unwrap(),
            daily
        );
    }

    #[test]
    fn lifecycle_only_requires_debug_and_both_explicit_smoke_flags() {
        for (debug, smoke, lifecycle, expected) in [
            (false, false, false, false),
            (false, false, true, false),
            (false, true, false, false),
            (false, true, true, false),
            (true, false, false, false),
            (true, false, true, false),
            (true, true, false, false),
            (true, true, true, true),
        ] {
            assert_eq!(lifecycle_smoke_selected(debug, smoke, lifecycle), expected);
        }
    }

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
