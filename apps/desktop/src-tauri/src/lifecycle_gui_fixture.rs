//! 仅显式debug测试目标可用，生产常量不变，复用原宿主和writer。
#[cfg(not(debug_assertions))]
compile_error!("gui-fixture is a debug-only test target, not a release capability");

use crate::managed_agent_host::{HostCapability, ManagedApiLease};
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const PROTOCOL: &str = "storyforge-gui-lifecycle-fixture-v1";
const SCENARIOS: &[&str] = &[
    "audit_close",
    "manual_wait",
    "snapshot_kill",
    "branch_kill",
    "intent_kill",
    "body_kill",
    "audit_done_kill",
];
static FIXTURE: OnceLock<Fixture> = OnceLock::new();

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    protocol: String,
    scenario: String,
}

struct Fixture {
    data: PathBuf,
    project: PathBuf,
    scenario: String,
}

fn validate(executable: &Path, smoke: bool, lifecycle: bool, data: &Path) -> Result<Fixture> {
    if executable.file_stem().and_then(|value| value.to_str()) != Some("storyforge-gui-fixture")
        || !smoke
        || !lifecycle
        || !data.is_absolute()
    {
        bail!("gui_fixture_requires_isolated_debug_test_target");
    }
    let data = data
        .canonicalize()
        .context("gui_fixture_data_unavailable")?;
    let raw = std::fs::read(data.join("gui-fixture.json"))?;
    if raw.len() > 4096 {
        bail!("gui_fixture_manifest_invalid");
    }
    let manifest: Manifest = serde_json::from_slice(&raw)?;
    if manifest.protocol != PROTOCOL || !SCENARIOS.contains(&manifest.scenario.as_str()) {
        bail!("gui_fixture_manifest_invalid");
    }
    let expected = data.join("project");
    let project = expected
        .canonicalize()
        .context("gui_fixture_project_unavailable")?;
    if project != expected || !project.is_dir() {
        bail!("gui_fixture_project_outside_isolation");
    }
    Ok(Fixture {
        data,
        project,
        scenario: manifest.scenario,
    })
}

pub fn api_entry(app: &tauri::AppHandle, repository: &str) -> Result<String> {
    let fixture = validate(
        &std::env::current_exe()?,
        crate::runtime_paths::is_smoke_mode(),
        crate::runtime_paths::is_lifecycle_smoke_mode(),
        &crate::runtime_paths::app_local_data_dir(app)?,
    )?;
    let entry = Path::new(repository)
        .join("apps/api/tests/gui_lifecycle_backend.py")
        .canonicalize()?;
    if FIXTURE.get().is_none() {
        FIXTURE
            .set(fixture)
            .map_err(|_| anyhow::anyhow!("gui_fixture_already_initialized"))?;
    }
    Ok(entry.to_string_lossy().into())
}

#[derive(Deserialize)]
struct BackendReady {
    protocol: String,
    generation: String,
    project: String,
}

pub fn project_capability(
    lease: Option<&ManagedApiLease>,
    live: bool,
    base: HostCapability,
) -> HostCapability {
    fixture_capability(FIXTURE.get(), lease, live, base)
}

fn fixture_capability(
    fixture: Option<&Fixture>,
    lease: Option<&ManagedApiLease>,
    live: bool,
    mut base: HostCapability,
) -> HostCapability {
    if !live {
        return base;
    }
    let Some(fixture) = fixture else {
        return base;
    };
    let Some(lease) = lease else {
        return base;
    };
    if base.managed_host_generation.as_deref() != Some(lease.generation.as_str()) {
        return base;
    }
    let ready = std::fs::read(fixture.data.join("gui-backend-ready.json"))
        .ok()
        .filter(|raw| raw.len() <= 4096)
        .and_then(|raw| serde_json::from_slice::<BackendReady>(&raw).ok());
    if ready.is_some_and(|ready| {
        ready.protocol == PROTOCOL
            && ready.generation == lease.generation
            && Path::new(&ready.project).canonicalize().ok().as_ref() == Some(&fixture.project)
    }) {
        base.execution_protocols = vec!["external_writeback_v1"];
    }
    base
}

pub fn before_audit(project: &str, operation: &str) -> Result<(), String> {
    let Some(fixture) = FIXTURE.get() else {
        return Ok(());
    };
    if Path::new(project)
        .canonicalize()
        .map_err(|_| "gui_fixture_project_unavailable")?
        != fixture.project
    {
        return Err("gui_fixture_project_scope_mismatch".into());
    }
    if fixture.scenario != "audit_close" || fixture.data.join("audit-release").is_file() {
        return Ok(());
    }
    std::fs::write(
        fixture.data.join("audit-entered.json"),
        serde_json::to_vec(&serde_json::json!({
            "protocol": PROTOCOL, "operationId": operation,
        }))
        .map_err(|_| "gui_fixture_boundary_invalid")?,
    )
    .map_err(|_| "gui_fixture_boundary_unavailable")?;
    let deadline = Instant::now() + Duration::from_secs(120);
    while !fixture.data.join("audit-release").is_file() {
        if Instant::now() >= deadline {
            return Err("gui_fixture_boundary_timeout".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}

/// Debug-target-only observation gate; the original operation is never replaced.
pub fn at_boundary(project: &str, boundary: &str, operation: Option<&str>) -> Result<(), String> {
    let Some(fixture) = FIXTURE.get() else {
        return Ok(());
    };
    require_project_scope(project)?;
    if fixture.scenario != format!("{boundary}_kill")
        || fixture.data.join("boundary-release").is_file()
    {
        return Ok(());
    }
    wait_at_boundary(fixture, boundary, operation, Duration::from_secs(120))
}

fn wait_at_boundary(
    fixture: &Fixture,
    boundary: &str,
    operation: Option<&str>,
    timeout: Duration,
) -> Result<(), String> {
    std::fs::write(
        fixture.data.join("boundary-entered.json"),
        serde_json::to_vec(&serde_json::json!({
            "protocol": PROTOCOL, "boundary": boundary, "operationId": operation,
        }))
        .map_err(|_| "gui_fixture_boundary_invalid")?,
    )
    .map_err(|_| "gui_fixture_boundary_unavailable")?;
    let deadline = Instant::now() + timeout;
    while !fixture.data.join("boundary-release").is_file() {
        if Instant::now() >= deadline {
            return Err("gui_fixture_boundary_timeout".into());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}

pub fn require_project_scope(project: &str) -> Result<(), String> {
    let Some(fixture) = FIXTURE.get() else {
        return Ok(());
    };
    if Path::new(project)
        .canonicalize()
        .map_err(|_| "gui_fixture_project_unavailable")?
        != fixture.project
    {
        return Err("gui_fixture_project_scope_mismatch".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crash_scenarios_are_explicit_and_boundary_timeout_never_creates_delivery_facts() {
        let data = tempfile::tempdir().unwrap();
        let project = data.path().join("project");
        std::fs::create_dir(&project).unwrap();
        for scenario in SCENARIOS {
            std::fs::write(
                data.path().join("gui-fixture.json"),
                serde_json::to_vec(&serde_json::json!({
                    "protocol": PROTOCOL, "scenario": scenario,
                }))
                .unwrap(),
            )
            .unwrap();
            assert!(validate(
                Path::new("storyforge-gui-fixture.exe"),
                true,
                true,
                data.path()
            )
            .is_ok());
        }
        let fixture = Fixture {
            data: data.path().to_path_buf(),
            project,
            scenario: "intent_kill".into(),
        };
        assert_eq!(
            wait_at_boundary(&fixture, "intent", Some(&"a".repeat(64)), Duration::ZERO)
                .unwrap_err(),
            "gui_fixture_boundary_timeout"
        );
        let marker: serde_json::Value = serde_json::from_slice(
            &std::fs::read(data.path().join("boundary-entered.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(marker["boundary"], "intent");
        assert_eq!(std::fs::read_dir(&fixture.project).unwrap().count(), 0);
        std::fs::write(
            data.path().join("boundary-release"),
            b"release original command",
        )
        .unwrap();
        wait_at_boundary(&fixture, "intent", None, Duration::ZERO).unwrap();
        assert_eq!(std::fs::read_dir(&fixture.project).unwrap().count(), 0);
    }
    #[test]
    fn ordinary_executable_or_missing_isolation_cannot_borrow_fixture_capability() {
        let data = tempfile::tempdir().unwrap();
        std::fs::create_dir(data.path().join("project")).unwrap();
        std::fs::write(
            data.path().join("gui-fixture.json"),
            format!(r#"{{"protocol":"{PROTOCOL}","scenario":"manual_wait"}}"#),
        )
        .unwrap();
        assert!(validate(Path::new("storyforge-desktop.exe"), true, true, data.path()).is_err());
        assert!(validate(
            Path::new("storyforge-gui-fixture.exe"),
            false,
            true,
            data.path()
        )
        .is_err());
        assert!(validate(
            Path::new("storyforge-gui-fixture.exe"),
            true,
            false,
            data.path()
        )
        .is_err());
        assert!(validate(
            Path::new("storyforge-gui-fixture.exe"),
            true,
            true,
            Path::new("relative")
        )
        .is_err());
        assert!(validate(
            Path::new("storyforge-gui-fixture.exe"),
            true,
            true,
            data.path()
        )
        .is_ok());
        std::fs::write(
            data.path().join("gui-fixture.json"),
            r#"{"protocol":"wrong","scenario":"manual_wait"}"#,
        )
        .unwrap();
        assert!(validate(
            Path::new("storyforge-gui-fixture.exe"),
            true,
            true,
            data.path()
        )
        .is_err());
    }

    #[test]
    fn live_fixture_capability_requires_matching_ready_owner_and_canonical_project() {
        use std::sync::{atomic::AtomicBool, Arc};
        let data = tempfile::tempdir().unwrap();
        let project = data.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let fixture = Fixture {
            data: data.path().to_path_buf(),
            project: project.canonicalize().unwrap(),
            scenario: "manual_wait".into(),
        };
        let lease = ManagedApiLease {
            generation: "a".repeat(64),
            base_url: "http://127.0.0.1:12345".into(),
            pid: 1,
            terminated: Arc::new(AtomicBool::new(false)),
        };
        let base = || crate::managed_agent_host::project_capability(Some(&lease), true);
        let ready = fixture.data.join("gui-backend-ready.json");
        let write_ready = |protocol: &str, generation: &str, path: &Path| {
            std::fs::write(
                &ready,
                serde_json::to_vec(&serde_json::json!({
                    "protocol": protocol, "generation": generation, "project": path,
                }))
                .unwrap(),
            )
            .unwrap();
        };
        assert!(
            fixture_capability(Some(&fixture), Some(&lease), true, base())
                .execution_protocols
                .is_empty()
        );
        write_ready(PROTOCOL, &lease.generation, &project);
        assert_eq!(
            fixture_capability(Some(&fixture), Some(&lease), true, base()).execution_protocols,
            vec!["external_writeback_v1"]
        );
        for (protocol, generation, path) in [
            ("wrong", lease.generation.as_str(), project.as_path()),
            (PROTOCOL, "stale", project.as_path()),
            (PROTOCOL, lease.generation.as_str(), data.path()),
        ] {
            write_ready(protocol, generation, path);
            assert!(
                fixture_capability(Some(&fixture), Some(&lease), true, base())
                    .execution_protocols
                    .is_empty()
            );
        }
        write_ready(PROTOCOL, &lease.generation, &project);
        assert!(fixture_capability(None, Some(&lease), true, base())
            .execution_protocols
            .is_empty());
        assert!(fixture_capability(Some(&fixture), None, true, base())
            .execution_protocols
            .is_empty());
        assert!(
            fixture_capability(Some(&fixture), Some(&lease), false, base())
                .execution_protocols
                .is_empty()
        );
        lease
            .terminated
            .store(true, std::sync::atomic::Ordering::Release);
        assert!(
            fixture_capability(Some(&fixture), Some(&lease), true, base())
                .execution_protocols
                .is_empty()
        );
        assert_eq!(
            crate::managed_agent_host::backend_env(&lease.generation)[1].1,
            "0"
        );
    }

    #[test]
    fn manifest_cannot_supply_extra_scope_or_oversized_payload() {
        let data = tempfile::tempdir().unwrap();
        std::fs::create_dir(data.path().join("project")).unwrap();
        for raw in [
            format!(
                r#"{{"protocol":"{PROTOCOL}","scenario":"manual_wait","project":"elsewhere"}}"#
            ),
            format!(r#"{{"protocol":"{PROTOCOL}","scenario":"production"}}"#),
            " ".repeat(4097),
        ] {
            std::fs::write(data.path().join("gui-fixture.json"), raw).unwrap();
            assert!(validate(
                Path::new("storyforge-gui-fixture.exe"),
                true,
                true,
                data.path()
            )
            .is_err());
        }
    }
}
