//! Process-owner provenance, not a health/version/localhost capability guess.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::{SystemTime, UNIX_EPOCH};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
// P1/P2 release acceptance is not complete. Inherited environment cannot enable it.
pub const EXTERNAL_WRITEBACK_RELEASED: bool = false;

#[derive(Clone)]
pub struct ManagedApiLease {
    pub generation: String,
    pub base_url: String,
    pub pid: u32,
    pub terminated: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCapability {
    pub managed_host_generation: Option<String>,
    pub execution_protocols: Vec<&'static str>,
}

pub fn new_generation() -> String {
    // Non-secret unique spawn identity, deliberately not an auth token.
    let input = format!(
        "{}:{}:{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

pub fn backend_env(generation: &str) -> [(String, String); 2] {
    [
        (
            "STORYFORGE_MANAGED_HOST_GENERATION".into(),
            generation.into(),
        ),
        (
            "STORYFORGE_EXTERNAL_WRITEBACK_ENABLED".into(),
            if EXTERNAL_WRITEBACK_RELEASED {
                "1"
            } else {
                "0"
            }
            .into(),
        ),
    ]
}

pub fn project_capability(lease: Option<&ManagedApiLease>, process_live: bool) -> HostCapability {
    let owned = lease.filter(|lease| process_live && !lease.terminated.load(Ordering::Acquire));
    HostCapability {
        managed_host_generation: owned.map(|lease| lease.generation.clone()),
        execution_protocols: if owned.is_some() && EXTERNAL_WRITEBACK_RELEASED {
            vec!["external_writeback_v1"]
        } else {
            Vec::new()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lease() -> ManagedApiLease {
        ManagedApiLease {
            generation: new_generation(),
            base_url: "http://127.0.0.1:8000".into(),
            pid: 7,
            terminated: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn spawn_generations_are_distinct_and_nonsecret_hashes() {
        let a = new_generation();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|ch| ch.is_ascii_hexdigit()));
        assert_ne!(a, new_generation());
    }

    #[test]
    fn reused_api_or_dead_child_does_not_gain_owner_provenance() {
        let lease = lease();
        assert!(project_capability(None, true)
            .managed_host_generation
            .is_none());
        assert!(project_capability(Some(&lease), false)
            .managed_host_generation
            .is_none());
        lease.terminated.store(true, Ordering::Release);
        assert!(project_capability(Some(&lease), true)
            .managed_host_generation
            .is_none());
    }

    #[test]
    fn owned_process_projects_identity_but_cannot_enable_unreleased_protocol() {
        let lease = lease();
        let capability = project_capability(Some(&lease), true);
        assert_eq!(capability.managed_host_generation, Some(lease.generation));
        assert!(capability.execution_protocols.is_empty());
        assert_eq!(backend_env("generation")[1].1, "0");
    }
}
