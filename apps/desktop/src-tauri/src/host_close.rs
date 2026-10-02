//! Finite off-event-loop handshake. Unknown settlement stays unknown.
use crate::host_close_state::{CloseDiagnostic, HostCloseState};
use crate::SharedServiceManager;
use serde::Deserialize;
use std::time::{Duration, Instant};
use tauri::Emitter;

#[derive(Deserialize)]
struct ApiClose {
    closing: bool,
    settled: bool,
    in_flight_owners: usize,
}

fn diagnostic_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    crate::runtime_paths::app_data_dir(app)
        .map(|dir| dir.join("host-close-diagnostic.json"))
        .map_err(|_| "close_diagnostic_path_unavailable".into())
}

#[tauri::command]
pub fn read_host_close_diagnostic(
    app: tauri::AppHandle,
) -> Result<Option<CloseDiagnostic>, String> {
    let path = diagnostic_path(&app)?;
    match std::fs::read(path) {
        Ok(raw) if raw.len() <= 8192 => serde_json::from_slice(&raw)
            .map(Some)
            .map_err(|_| "close_diagnostic_invalid".into()),
        Ok(_) => Err("close_diagnostic_invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("close_diagnostic_unreadable".into()),
    }
}

pub fn wait_until_quiet(
    state: &HostCloseState,
    deadline: Instant,
    mut observe: impl FnMut(Duration) -> Option<(bool, usize)>,
) -> CloseDiagnostic {
    let mut diagnostic = state.diagnostic(false, None);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return diagnostic;
        }
        let observation = observe(remaining);
        diagnostic = state.diagnostic(
            observation.is_some_and(|(settled, _)| settled),
            observation.map(|(_, owners)| owners),
        );
        if diagnostic.reason == "close_confirmed" {
            return diagnostic;
        }
        std::thread::sleep(
            Duration::from_millis(40).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

pub fn start(
    app: tauri::AppHandle,
    manager: SharedServiceManager,
    state: HostCloseState,
    exit_code: i32,
) {
    let started = Instant::now();
    let _ = app.emit("storyforge:host-closing", ());
    std::thread::spawn(move || {
        let lease = manager
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .api_lease
            .clone();
        let mut closed = false;
        let key = crate::desktop_api_key();
        let diagnostic = wait_until_quiet(&state, started + Duration::from_secs(10), |remaining| {
            let lease = lease.as_ref()?;
            let client = reqwest::blocking::Client::builder()
                .timeout(remaining.min(Duration::from_millis(600)))
                .build()
                .ok()?;
            let url = format!(
                "{}/api/agent-runs/host/closing",
                lease.base_url.trim_end_matches('/')
            );
            let request = if closed {
                client.get(&url)
            } else {
                client.post(&url)
            };
            let response = request
                .header("X-StoryForge-API-Key", &key)
                .header("X-StoryForge-Host-Generation", &lease.generation)
                .send()
                .ok()?;
            if !response.status().is_success() {
                return None;
            }
            use std::io::Read;
            let mut bytes = Vec::new();
            response.take(8193).read_to_end(&mut bytes).ok()?;
            if bytes.len() > 8192 {
                return None;
            }
            let status: ApiClose = serde_json::from_slice(&bytes).ok()?;
            closed = status.closing;
            Some((status.closing && status.settled, status.in_flight_owners))
        });
        if let Ok(path) = diagnostic_path(&app) {
            if let Some(parent) = path.parent() {
                if std::fs::create_dir_all(parent).is_ok() {
                    if let Ok(bytes) = serde_json::to_vec(&diagnostic) {
                        let temporary = path.with_extension("pending");
                        if std::fs::write(&temporary, bytes).is_ok() {
                            // Rename atomically replaces the app-owned diagnostic, never manuscript content.
                            let _ = std::fs::rename(&temporary, &path);
                        }
                    }
                }
            }
        }
        crate::shutdown_managed_services(&manager);
        state.finish();
        app.exit(exit_code);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exit_cleanup_reuses_idempotent_poison_tolerant_service_shutdown() {
        let manager = std::sync::Arc::new(std::sync::Mutex::new(crate::ServiceManager::new()));
        let owned = manager.clone();
        assert!(std::thread::spawn(move || {
            let _guard = owned.lock().unwrap();
            panic!("isolated service-manager poison fixture");
        })
        .join()
        .is_err());
        crate::shutdown_managed_services(&manager);
        crate::shutdown_managed_services(&manager);
        assert!(manager
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .api_lease
            .is_none());
    }
    #[test]
    fn finite_deadline_does_not_lie_about_unfinished_pipeline() {
        let state = HostCloseState::default();
        let root = std::env::temp_dir();
        let ticket = state.begin_delivery(root.to_str().unwrap()).unwrap();
        state.begin_close();
        state.renderer_fenced();
        let started = Instant::now();
        let diagnostic = wait_until_quiet(&state, started + Duration::from_millis(60), |_| {
            Some((true, 0))
        });
        assert!(started.elapsed() < Duration::from_millis(500));
        assert_eq!(diagnostic.reason, "close_timeout_unsettled");
        assert_eq!(diagnostic.delivery_tickets, 1);
        state.end_delivery(&ticket).unwrap();
    }
    #[test]
    fn confirmed_requires_all_three_independent_fences() {
        let state = HostCloseState::default();
        state.begin_close();
        state.renderer_fenced();
        let diagnostic =
            wait_until_quiet(&state, Instant::now() + Duration::from_millis(100), |_| {
                Some((true, 0))
            });
        assert_eq!(diagnostic.reason, "close_confirmed");
        let timeout =
            wait_until_quiet(&state, Instant::now() + Duration::from_millis(10), |_| None);
        assert_eq!(timeout.reason, "close_timeout_unsettled");
        assert_eq!(timeout.api_in_flight_owners, None);
    }
}
