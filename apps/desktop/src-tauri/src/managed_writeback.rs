//! Admission facades preserve the original guarded writer and receipt ledger.
use crate::{fs, fs_writeback_receipts as receipts, host_close_state::HostCloseState};
use tauri::State;

async fn run_mutation<T: Send + 'static>(
    state: HostCloseState,
    root: String,
    ticket: Option<String>,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    #[cfg(feature = "gui-fixture")]
    crate::lifecycle_gui_fixture::require_project_scope(&root)?;
    let admission = state.admit(&root, ticket.as_deref())?;
    tokio::task::spawn_blocking(move || {
        let _admission = admission;
        work()
    })
    .await
    .map_err(|_| "managed_writeback_worker_failed".to_string())?
}

#[tauri::command]
pub async fn write_file(
    state: State<'_, HostCloseState>,
    delivery_ticket: Option<String>,
    project_root: String,
    path: String,
    content: String,
) -> Result<(), String> {
    run_mutation(
        state.inner().clone(),
        project_root.clone(),
        delivery_ticket,
        move || {
            #[cfg(feature = "gui-fixture")]
            if std::path::Path::new(&path)
                .file_name()
                .and_then(|value| value.to_str())
                == Some("branches.json")
            {
                crate::lifecycle_gui_fixture::at_boundary(&project_root, "snapshot", None)?;
            }
            fs::write_file(project_root, path, content)
        },
    )
    .await
}

#[tauri::command]
pub async fn write_file_if_unchanged(
    state: State<'_, HostCloseState>,
    delivery_ticket: Option<String>,
    project_root: String,
    path: String,
    content: String,
    expected: fs::DiskBaseline,
) -> Result<(), String> {
    run_mutation(
        state.inner().clone(),
        project_root.clone(),
        delivery_ticket,
        move || fs::write_file_if_unchanged(project_root, path, content, expected),
    )
    .await
}

#[tauri::command]
pub async fn copy_into_project(
    state: State<'_, HostCloseState>,
    delivery_ticket: Option<String>,
    project_root: String,
    source: String,
    dest: String,
) -> Result<(), String> {
    run_mutation(
        state.inner().clone(),
        project_root.clone(),
        delivery_ticket,
        move || fs::copy_into_project(project_root, source, dest),
    )
    .await
}

#[tauri::command]
pub async fn delete_path(
    state: State<'_, HostCloseState>,
    delivery_ticket: Option<String>,
    project_root: String,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    run_mutation(
        state.inner().clone(),
        project_root.clone(),
        delivery_ticket,
        move || fs::delete_path(project_root, path, recursive),
    )
    .await
}

#[tauri::command]
pub async fn create_dir(
    state: State<'_, HostCloseState>,
    delivery_ticket: Option<String>,
    project_root: String,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    run_mutation(
        state.inner().clone(),
        project_root.clone(),
        delivery_ticket,
        move || fs::create_dir(project_root, path, recursive),
    )
    .await
}

#[tauri::command]
pub async fn rename_path(
    state: State<'_, HostCloseState>,
    delivery_ticket: Option<String>,
    project_root: String,
    from: String,
    to: String,
) -> Result<(), String> {
    run_mutation(
        state.inner().clone(),
        project_root.clone(),
        delivery_ticket,
        move || fs::rename_path(project_root, from, to),
    )
    .await
}

#[tauri::command]
pub async fn write_file_with_receipt(
    state: State<'_, HostCloseState>,
    delivery_ticket: Option<String>,
    project_root: String,
    request: receipts::WritebackRequest,
    expected: fs::DiskBaseline,
    checkpoint_timestamp: Option<u64>,
) -> Result<receipts::WritebackReceipt, String> {
    run_mutation(
        state.inner().clone(),
        project_root.clone(),
        delivery_ticket,
        move || {
            #[cfg(feature = "gui-fixture")]
            crate::lifecycle_gui_fixture::at_boundary(&project_root, "branch", None)?;
            receipts::write_file_with_receipt(project_root, request, expected, checkpoint_timestamp)
        },
    )
    .await
}

#[tauri::command]
pub async fn create_writeback_audit(
    state: State<'_, HostCloseState>,
    delivery_ticket: Option<String>,
    project_root: String,
    operation_id: String,
    content: String,
) -> Result<(), String> {
    run_mutation(
        state.inner().clone(),
        project_root.clone(),
        delivery_ticket,
        move || {
            #[cfg(feature = "gui-fixture")]
            crate::lifecycle_gui_fixture::before_audit(&project_root, &operation_id)?;
            receipts::create_writeback_audit(project_root.clone(), operation_id.clone(), content)?;
            #[cfg(feature = "gui-fixture")]
            crate::lifecycle_gui_fixture::at_boundary(
                &project_root,
                "audit_done",
                Some(&operation_id),
            )?;
            Ok(())
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "current_thread")]
    async fn pending_disk_worker_does_not_block_closing_and_keeps_admission_until_complete() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().to_str().unwrap().to_string();
        let path = directory.path().join("chapter.md");
        std::fs::write(&path, "before").unwrap();
        let state = HostCloseState::default();
        let ticket = state.begin_delivery(&root).unwrap();
        let (entered, started) = tokio::sync::oneshot::channel();
        let (release, gate) = std::sync::mpsc::channel();
        let original = root.clone();
        let work = tokio::spawn(run_mutation(
            state.clone(),
            root.clone(),
            Some(ticket.clone()),
            move || {
                entered.send(()).unwrap();
                gate.recv().unwrap();
                fs::write_file(
                    original.clone(),
                    format!("{original}/chapter.md"),
                    "after".into(),
                )
            },
        ));
        tokio::time::timeout(std::time::Duration::from_secs(2), started)
            .await
            .unwrap()
            .unwrap();
        assert!(state.begin_close());
        state.renderer_fenced();
        let diagnostic = state.diagnostic(true, Some(0));
        assert_eq!(diagnostic.active_commands, 1);
        assert_eq!(diagnostic.delivery_tickets, 1);
        assert_ne!(diagnostic.reason, "close_confirmed");
        assert_eq!(
            run_mutation(state.clone(), root.clone(), None, || Ok(()))
                .await
                .unwrap_err(),
            "managed_host_closing"
        );
        release.send(()).unwrap();
        work.await.unwrap().unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "after");
        assert_eq!(state.diagnostic(true, Some(0)).active_commands, 0);
        run_mutation(state.clone(), root, Some(ticket.clone()), || Ok(()))
            .await
            .unwrap();
        state.end_delivery(&ticket).unwrap();
        assert_eq!(state.diagnostic(true, Some(0)).reason, "close_confirmed");
    }

    #[tokio::test]
    async fn disk_failure_and_panic_never_report_success_or_leak_admission() {
        let root = std::env::temp_dir().to_str().unwrap().to_string();
        let state = HostCloseState::default();
        assert_eq!(
            run_mutation(state.clone(), root.clone(), None, || Err::<(), _>(
                "original_disk_error".into()
            ))
            .await
            .unwrap_err(),
            "original_disk_error"
        );
        assert_eq!(
            run_mutation(state.clone(), root, None, || -> Result<(), String> {
                panic!("isolated worker panic")
            })
            .await
            .unwrap_err(),
            "managed_writeback_worker_failed"
        );
        assert_eq!(state.diagnostic(false, None).active_commands, 0);
    }
}
