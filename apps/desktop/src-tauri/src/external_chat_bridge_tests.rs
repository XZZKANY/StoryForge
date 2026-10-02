//! Explicit interoperability fixture: existing Native commands, not a production writer.
use crate::fs::DiskBaseline;
use crate::fs_writeback_receipts::{
    describe_writeback_operation, write_file_with_receipt, WritebackRequest,
};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    root: String,
    mode: String,
    request: WritebackRequest,
    raw_before: String,
}

#[test]
#[ignore = "explicit opt-in Native/API interoperability fixture"]
fn native_receipt_bridge() {
    let input = PathBuf::from(
        std::env::var("STORYFORGE_EXTERNAL_CHAT_NATIVE_FIXTURE")
            .expect("an explicit fixture input is required"),
    );
    let raw = fs::read(&input).unwrap();
    assert!(raw.len() <= 8 * 1024 * 1024);
    let fixture: Fixture = serde_json::from_slice(&raw).unwrap();
    let output = match fixture.mode.as_str() {
        "describe" => serde_json::to_value(
            describe_writeback_operation(fixture.root, fixture.request).unwrap(),
        )
        .unwrap(),
        "apply" => serde_json::to_value(
            write_file_with_receipt(
                fixture.root,
                fixture.request,
                DiskBaseline::Content {
                    content: fixture.raw_before,
                },
                Some(7), // Fixture checkpoint reference, not a Desktop version UI acceptance.
            )
            .unwrap(),
        )
        .unwrap(),
        _ => panic!("unsupported fixture operation"),
    };
    fs::write(
        input.with_extension("output.json"),
        serde_json::to_vec(&output).unwrap(),
    )
    .unwrap();
}
