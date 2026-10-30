//! 自动更新：读 GitHub Release 上的 latest.json（tauri-plugin-updater，安装包签名用
//! tauri.conf.json 里的公钥校验）。下载好的安装包留在内存里；作者点「重启安装」后照点 × 关窗
//! （先问未保存、走完退出握手），握手的最后一步才交给安装器——Windows 上插件装更新会直接结束进程。
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// 插件不把检查时的超时带到下载上；连接卡死时别让「下载中」一直挂着。
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    current_version: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    received: u64,
    total: Option<u64>,
}

/// 下载好的新版，以及作者是否点过「重启安装」。
pub struct StagedSlot<T> {
    staged: Option<T>,
    install_on_exit: bool,
}

impl<T> Default for StagedSlot<T> {
    fn default() -> Self {
        Self {
            staged: None,
            install_on_exit: false,
        }
    }
}

impl<T> StagedSlot<T> {
    /// 新下载的一份顶掉旧的，也不继承旧的「重启安装」。
    fn stage(&mut self, value: T) {
        self.staged = Some(value);
        self.install_on_exit = false;
    }
    fn arm(&mut self) -> bool {
        self.install_on_exit = self.staged.is_some();
        self.install_on_exit
    }
    fn disarm(&mut self) {
        self.install_on_exit = false;
    }
    fn take_armed(&mut self) -> Option<T> {
        if !std::mem::take(&mut self.install_on_exit) {
            return None;
        }
        self.staged.take()
    }
}

#[derive(Default)]
pub struct StagedUpdate(Mutex<StagedSlot<(Update, Vec<u8>)>>);

/// 没有新版返回 `None`；连不上、清单坏了、签名字段缺失都报错，不当成「已是最新」。
#[tauri::command]
pub async fn app_update_check(app: tauri::AppHandle) -> Result<Option<AvailableUpdate>, String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    Ok(update.map(|update| AvailableUpdate {
        version: update.version,
        current_version: update.current_version,
        notes: update.body.filter(|notes| !notes.trim().is_empty()),
    }))
}

/// 下载新版并核对签名（插件下载完用公钥校验），返回版本号。
#[tauri::command]
pub async fn app_update_download(
    app: tauri::AppHandle,
    staged: State<'_, StagedUpdate>,
    on_progress: Channel<DownloadProgress>,
) -> Result<String, String> {
    let mut update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or("已是最新版本，没有要下载的新版")?;
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    let mut received = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let _ = on_progress.send(DownloadProgress { received, total });
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    let version = update.version.clone();
    staged.0.lock().unwrap().stage((update, bytes));
    Ok(version)
}

/// 作者点了「重启安装」：记下退出时安装，再照点 × 关窗。
#[tauri::command]
pub fn app_update_restart_install(
    window: tauri::Window,
    staged: State<'_, StagedUpdate>,
) -> Result<(), String> {
    if !staged.0.lock().unwrap().arm() {
        return Err("还没有下载好的新版本".into());
    }
    window.close().map_err(|error| error.to_string())
}

/// 作者在「有未保存的修改」那一步选了不关：这次不装，下次关窗也不顺手装。
pub fn disarm(app: &tauri::AppHandle) {
    if let Some(staged) = app.try_state::<StagedUpdate>() {
        staged.0.lock().unwrap().disarm();
    }
}

/// 退出握手的最后一步。装起来时插件直接结束进程、安装器装完再把应用打开；
/// 装不起来就照常退出，下次打开检查更新还会提示。
pub fn install_if_armed(app: &tauri::AppHandle) {
    let Some(staged) = app.try_state::<StagedUpdate>() else {
        return;
    };
    let Some((update, bytes)) = staged.0.lock().unwrap().take_armed() else {
        return;
    };
    if let Err(error) = update.install(&bytes) {
        eprintln!("安装更新失败：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::StagedSlot;
    use base64::Engine;

    /// 插件配置解析失败时应用起不来；单测与浏览器回归都不启动真应用，在这里先用插件自己的类型解析一遍。
    #[test]
    fn shipped_updater_config_parses_with_the_plugin_types() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater: tauri_plugin_updater::Config =
            serde_json::from_value(config["plugins"]["updater"].clone()).unwrap();
        assert_eq!(
            updater
                .endpoints
                .iter()
                .map(|url| url.as_str())
                .collect::<Vec<_>>(),
            ["https://github.com/XZZKANY/StoryForge/releases/latest/download/latest.json"]
        );
        let pubkey = base64::engine::general_purpose::STANDARD
            .decode(&updater.pubkey)
            .unwrap();
        assert!(String::from_utf8(pubkey)
            .unwrap()
            .starts_with("untrusted comment: minisign public key: "));
    }

    #[test]
    fn installs_only_what_the_author_asked_to_restart_for() {
        let mut slot = StagedSlot::default();
        assert!(!slot.arm(), "没下载就不能安装");
        assert_eq!(slot.take_armed(), None);
        slot.stage("0.2.4");
        assert_eq!(slot.take_armed(), None, "下载好但没点重启安装，退出时不装");
        assert!(slot.arm());
        slot.disarm();
        assert_eq!(
            slot.take_armed(),
            None,
            "未保存那一步选了不关，下次关窗不顺手装"
        );
        assert!(slot.arm());
        slot.stage("0.2.5");
        assert_eq!(slot.take_armed(), None, "新下载的一份不继承旧的重启安装");
        assert!(slot.arm());
        assert_eq!(slot.take_armed(), Some("0.2.5"));
        assert_eq!(slot.take_armed(), None, "只装一次");
        assert!(!slot.arm());
    }
}
