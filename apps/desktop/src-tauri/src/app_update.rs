//! 自动更新：读 GitHub Release 上的 latest.json（tauri-plugin-updater，安装包签名用
//! tauri.conf.json 里的公钥校验）。这里只检查有没有新版；下载与安装要排在退出握手之后，
//! 因为 Windows 上插件装更新会直接结束进程。
use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    current_version: String,
    notes: Option<String>,
}

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

#[cfg(test)]
mod tests {
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
}
