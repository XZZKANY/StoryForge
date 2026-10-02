//! Native-owned pipeline admission, independent of Renderer activity claims.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct HostCloseState(Arc<Mutex<Inner>>);

#[derive(Default)]
struct Inner {
    closing: bool,
    finished: bool,
    renderer_fenced: bool,
    active: usize,
    tickets: HashMap<String, (PathBuf, usize)>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseDiagnostic {
    pub reason: String,
    pub active_commands: usize,
    pub delivery_tickets: usize,
    pub renderer_fenced: bool,
    pub api_settled: bool,
    pub api_in_flight_owners: Option<usize>,
}

pub struct Admission {
    state: HostCloseState,
    ticket: Option<String>,
}

impl Drop for Admission {
    fn drop(&mut self) {
        let mut state = self.state.0.lock().unwrap();
        state.active -= 1;
        if let Some(ticket) = &self.ticket {
            if let Some((_, active)) = state.tickets.get_mut(ticket) {
                *active -= 1;
            }
        }
    }
}

impl HostCloseState {
    pub fn is_closing(&self) -> bool {
        self.0.lock().unwrap().closing
    }
    pub fn is_finished(&self) -> bool {
        self.0.lock().unwrap().finished
    }
    pub fn begin_close(&self) -> bool {
        let mut state = self.0.lock().unwrap();
        if state.closing {
            return false;
        }
        state.closing = true;
        true
    }
    pub fn renderer_fenced(&self) {
        self.0.lock().unwrap().renderer_fenced = true;
    }
    pub fn finish(&self) {
        self.0.lock().unwrap().finished = true;
    }
    pub fn begin_delivery(&self, root: &str) -> Result<String, String> {
        let root = std::fs::canonicalize(root).map_err(|_| "delivery_project_unavailable")?;
        if !root.is_dir() {
            return Err("delivery_project_unavailable".into());
        }
        let mut state = self.0.lock().unwrap();
        if state.closing {
            return Err("managed_host_closing".into());
        }
        let ticket = crate::managed_agent_host::new_generation();
        state.tickets.insert(ticket.clone(), (root, 0));
        Ok(ticket)
    }
    pub fn end_delivery(&self, ticket: &str) -> Result<(), String> {
        let mut state = self.0.lock().unwrap();
        match state.tickets.get(ticket) {
            Some((_, 0)) => {
                state.tickets.remove(ticket);
                Ok(())
            }
            Some(_) => Err("delivery_commands_in_flight".into()),
            None => Err("delivery_ticket_unknown".into()),
        }
    }
    pub fn admit(&self, root: &str, ticket: Option<&str>) -> Result<Admission, String> {
        let root = std::fs::canonicalize(root).map_err(|_| "delivery_project_unavailable")?;
        let mut state = self.0.lock().unwrap();
        match ticket {
            Some(ticket) => match state.tickets.get_mut(ticket) {
                Some((project, active)) if *project == root => {
                    *active += 1;
                }
                _ => return Err("delivery_ticket_scope_mismatch".into()),
            },
            None if state.closing => return Err("managed_host_closing".into()),
            None => {}
        }
        state.active += 1;
        Ok(Admission {
            state: self.clone(),
            ticket: ticket.map(String::from),
        })
    }
    pub fn diagnostic(&self, api_settled: bool, owners: Option<usize>) -> CloseDiagnostic {
        let state = self.0.lock().unwrap();
        let settled =
            api_settled && state.renderer_fenced && state.active == 0 && state.tickets.is_empty();
        CloseDiagnostic {
            reason: if settled {
                "close_confirmed"
            } else {
                "close_timeout_unsettled"
            }
            .into(),
            active_commands: state.active,
            delivery_tickets: state.tickets.len(),
            renderer_fenced: state.renderer_fenced,
            api_settled,
            api_in_flight_owners: owners,
        }
    }
}

#[tauri::command]
pub fn begin_writeback_delivery(
    state: tauri::State<'_, HostCloseState>,
    project_root: String,
) -> Result<String, String> {
    state.begin_delivery(&project_root)
}
#[tauri::command]
pub fn end_writeback_delivery(
    state: tauri::State<'_, HostCloseState>,
    delivery_ticket: String,
) -> Result<(), String> {
    state.end_delivery(&delivery_ticket)
}
#[tauri::command]
pub fn acknowledge_host_closing(state: tauri::State<'_, HostCloseState>) {
    state.renderer_fenced();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closing_rejects_new_admission_but_old_pipeline_can_finish() {
        let state = HostCloseState::default();
        let root = std::env::temp_dir();
        let root = root.to_str().unwrap();
        let ticket = state.begin_delivery(root).unwrap();
        assert!(state.begin_close());
        assert!(!state.begin_close());
        state.renderer_fenced();
        assert!(state.admit(root, None).is_err());
        assert!(state.begin_delivery(root).is_err());
        for _ in 0..4 {
            let command = state.admit(root, Some(&ticket)).unwrap();
            assert!(state.end_delivery(&ticket).is_err());
            assert_ne!(state.diagnostic(true, Some(0)).reason, "close_confirmed");
            drop(command);
        }
        // Renderer zero is insufficient between individual Native commands.
        assert_eq!(state.diagnostic(true, Some(0)).delivery_tickets, 1);
        state.end_delivery(&ticket).unwrap();
        assert_eq!(state.diagnostic(true, Some(0)).reason, "close_confirmed");
    }
    #[test]
    fn unknown_api_or_missing_renderer_is_not_confirmed() {
        let state = HostCloseState::default();
        state.begin_close();
        assert_ne!(state.diagnostic(true, Some(0)).reason, "close_confirmed");
        state.renderer_fenced();
        assert_ne!(state.diagnostic(false, None).reason, "close_confirmed");
    }
    #[test]
    fn pipeline_ticket_cannot_be_borrowed_by_another_project_or_reused_after_end() {
        let state = HostCloseState::default();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let first_root = first.path().to_str().unwrap();
        let second_root = second.path().to_str().unwrap();
        let ticket = state.begin_delivery(first_root).unwrap();
        assert_eq!(
            state.admit(second_root, Some(&ticket)).err().unwrap(),
            "delivery_ticket_scope_mismatch"
        );
        assert_eq!(state.diagnostic(false, None).active_commands, 0);
        state.end_delivery(&ticket).unwrap();
        assert!(state.admit(first_root, Some(&ticket)).is_err());
        assert!(state.end_delivery(&ticket).is_err());
    }
}
