//! Test-only process adapter; uses the same core as the Tauri command facade.
use super::core::{ShadowGitCore, SharedState};
use super::{ShadowFileState, ShadowSnapshot};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;

pub(crate) fn dispatch_fixture_command(
    command: &str,
    args: &Value,
    data_root: PathBuf,
) -> Result<Value, String> {
    let core = ShadowGitCore::new(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/mingit/runtime/cmd/git.exe"),
        data_root,
        None,
        Arc::new(SharedState::default()),
    );
    let payload = args.get("payload").ok_or("missing payload")?;
    let field = |name| {
        payload
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("missing {name}"))
    };
    let root = field("projectRoot")?;
    match command {
        "create_shadow_snapshot" => {
            let snapshot = core.create_snapshot(root)?;
            serde_json::to_value(ShadowSnapshot {
                tree_hash: snapshot.tree_hash,
                git_version: snapshot.git_version,
            })
            .map_err(|error| error.to_string())
        }
        "retain_shadow_snapshot" => {
            core.retain_snapshot(root, field("treeHash")?, field("recordId")?)?;
            Ok(Value::Null)
        }
        "release_shadow_snapshot" => {
            core.release_snapshot(root, field("recordId")?)?;
            Ok(Value::Null)
        }
        "read_shadow_snapshot_file" => {
            let file = core.read_file(root, field("treeHash")?, field("filePath")?)?;
            serde_json::to_value(ShadowFileState {
                exists: file.exists,
                content: file.content,
            })
            .map_err(|error| error.to_string())
        }
        "filter_shadow_snapshot_hashes" => {
            let hashes: Vec<String> =
                serde_json::from_value(payload.get("hashes").ok_or("missing hashes")?.clone())
                    .map_err(|error| error.to_string())?;
            serde_json::to_value(core.filter_retained_hashes(root, &hashes)?)
                .map_err(|error| error.to_string())
        }
        _ => Err("unsupported shadow fixture command".into()),
    }
}
