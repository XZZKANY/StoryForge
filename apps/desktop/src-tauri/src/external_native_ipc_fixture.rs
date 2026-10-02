//! Explicit IPC shim for combined tests. Not built into the production executable.
use crate::host_close_state::HostCloseState;
use crate::{fs as native_fs, fs_writeback_receipts as receipts, shadow_git};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    command: String,
    args: Value,
    project_root: String,
    data_root: PathBuf,
}

fn dispatch(input: Input, fixture_root: &Path, state: &HostCloseState) -> Result<Value, String> {
    let root = fs::canonicalize(&input.project_root).map_err(|error| error.to_string())?;
    let data = fs::canonicalize(&input.data_root).map_err(|error| error.to_string())?;
    if !root.starts_with(fixture_root) || !data.starts_with(fixture_root) {
        return Err("fixture paths escape isolated fixture".into());
    }
    let args = &input.args;
    let field = |name| {
        args.get(name)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| format!("missing {name}"))
    };
    let project = input.project_root.clone();
    match input.command.as_str() {
        "begin_writeback_delivery" => return Ok(json!(state.begin_delivery(&project)?)),
        "end_writeback_delivery" => {
            state.end_delivery(&field("deliveryTicket")?)?;
            return Ok(Value::Null);
        }
        "acknowledge_host_closing" => {
            state.renderer_fenced();
            return Ok(Value::Null);
        }
        "read_host_close_diagnostic" => return Ok(Value::Null),
        "fixture_begin_close" => {
            state.begin_close();
            return Ok(json!(state.diagnostic(false, None)));
        }
        "fixture_close_status" => {
            return Ok(json!(state.diagnostic(
                args.get("apiSettled") == Some(&Value::Bool(true)),
                Some(0)
            )))
        }
        _ => {}
    }
    let mutation = matches!(
        input.command.as_str(),
        "write_file"
            | "create_dir"
            | "delete_path"
            | "write_file_with_receipt"
            | "create_writeback_audit"
            | "create_shadow_snapshot"
            | "retain_shadow_snapshot"
            | "release_shadow_snapshot"
    );
    let _admission = if mutation {
        Some(state.admit(&project, args.get("deliveryTicket").and_then(Value::as_str))?)
    } else {
        None
    };
    if input.command.contains("shadow") {
        let supplied = args.pointer("/payload/projectRoot").and_then(Value::as_str);
        if supplied != Some(project.as_str()) {
            return Err("fixture project mismatch".into());
        }
        // Match app-local path input; canonical Windows verbatim paths are only for guards.
        return shadow_git::dispatch_fixture_command(&input.command, args, input.data_root);
    }
    if let Some(supplied) = args.get("projectRoot").and_then(Value::as_str) {
        if supplied != project {
            return Err("fixture project mismatch".into());
        }
    }
    let request = || {
        serde_json::from_value(args.get("request").ok_or("missing request")?.clone())
            .map_err(|error| error.to_string())
    };
    let serialize = |value| serde_json::to_value(value).map_err(|error| error.to_string());
    match input.command.as_str() {
        "read_file" | "read_project_file" => Ok(json!(native_fs::read_project_file(
            project,
            field("path")?
        )?)),
        "path_exists" => {
            let path = field("path")?;
            native_fs::validate_pending_mutation_path(&project, Path::new(&path))?;
            Ok(json!(native_fs::path_exists(path)))
        }
        "list_dir" => {
            let path = field("path")?;
            native_fs::validate_pending_mutation_path(&project, Path::new(&path))?;
            serialize(native_fs::list_dir(
                path,
                args.get("recursive") == Some(&Value::Bool(true)),
            )?)
        }
        "write_file" => {
            native_fs::write_file(project, field("path")?, field("content")?)?;
            Ok(Value::Null)
        }
        "create_dir" => {
            native_fs::create_dir(project, field("path")?, true)?;
            Ok(Value::Null)
        }
        "delete_path" => {
            native_fs::delete_path(project, field("path")?, false)?;
            Ok(Value::Null)
        }
        "describe_writeback_operation" => {
            serde_json::to_value(receipts::describe_writeback_operation(project, request()?)?)
                .map_err(|error| error.to_string())
        }
        "inspect_writeback_receipt" => {
            serde_json::to_value(receipts::inspect_writeback_receipt(project, request()?)?)
                .map_err(|error| error.to_string())
        }
        "write_file_with_receipt" => {
            let expected =
                serde_json::from_value(args.get("expected").ok_or("missing baseline")?.clone())
                    .map_err(|error| error.to_string())?;
            serde_json::to_value(receipts::write_file_with_receipt(
                project,
                request()?,
                expected,
                args.get("checkpointTimestamp").and_then(Value::as_u64),
            )?)
            .map_err(|error| error.to_string())
        }
        "create_writeback_audit" => {
            receipts::create_writeback_audit(project, field("operationId")?, field("content")?)?;
            Ok(Value::Null)
        }
        _ => Err("unsupported Native fixture command".into()),
    }
}

#[test]
#[ignore = "explicit API/Native/mounted coordinator test only"]
fn native_ipc_bridge() {
    let path = PathBuf::from(std::env::var("STORYFORGE_EXTERNAL_NATIVE_IPC_FIXTURE").unwrap());
    let parent = fs::canonicalize(path.parent().unwrap()).unwrap();
    let state = HostCloseState::default();
    if std::env::var("STORYFORGE_EXTERNAL_NATIVE_IPC_STREAM").as_deref() == Ok("1") {
        for line in std::io::stdin().lock().lines() {
            let line = line.unwrap();
            assert!(line.len() <= 8 * 1024 * 1024);
            let output = match serde_json::from_str::<Input>(&line)
                .map_err(|_| "fixture input invalid".to_owned())
                .and_then(|input| dispatch(input, &parent, &state))
            {
                Ok(value) => json!({"ok": true, "value": value}),
                Err(reason) => json!({"ok": false, "error": reason}),
            };
            println!("SF_IPC {}", output);
            std::io::stdout().flush().unwrap();
        }
        return;
    }
    let raw = fs::read(&path).unwrap();
    assert!(raw.len() <= 8 * 1024 * 1024);
    let input: Input = serde_json::from_slice(&raw).unwrap();
    let output = match dispatch(input, &parent, &state) {
        Ok(value) => json!({"ok": true, "value": value}),
        Err(reason) => json!({"ok": false, "error": reason}),
    };
    fs::write(
        path.with_extension("output.json"),
        serde_json::to_vec(&output).unwrap(),
    )
    .unwrap();
}
