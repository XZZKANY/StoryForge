//! 关窗先问未保存：作者点关闭时先交给前端问一声，放行了才进退出握手。
//! 前端没挂守卫（还没加载完）就照旧直接退出；挂了却回不了声（WebView 卡死）时限时后也退出，不会关不掉。
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};

const ACK_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Default)]
pub struct CloseGuard(Arc<Mutex<Inner>>);

#[derive(Default)]
struct Inner {
    armed: bool,
    approved: bool,
    next_request: u64,
    pending: Option<u64>,
    pings: u64,
    acked: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CloseStep {
    Exit,
    /// 广播这个请求号，并在限时后用 `ping` 核对前端回没回声。
    Ask {
        request: u64,
        ping: u64,
    },
}

impl CloseGuard {
    pub fn arm(&self, armed: bool) {
        self.0.lock().unwrap().armed = armed;
    }
    pub fn request_close(&self) -> CloseStep {
        let mut state = self.0.lock().unwrap();
        if state.approved || !state.armed {
            return CloseStep::Exit;
        }
        // 前端正在问时再点关闭：沿用同一个请求，再核一次前端还活着。
        let request = match state.pending {
            Some(request) => request,
            None => {
                state.next_request += 1;
                state.pending = Some(state.next_request);
                state.next_request
            }
        };
        state.pings += 1;
        CloseStep::Ask {
            request,
            ping: state.pings,
        }
    }
    pub fn acknowledge(&self, request: u64) {
        let mut state = self.0.lock().unwrap();
        if state.pending == Some(request) {
            state.acked = state.pings;
        }
    }
    /// 限时到了前端还没回这一声：当作没法问，直接退出。
    pub fn ack_missed(&self, request: u64, ping: u64) -> bool {
        let mut state = self.0.lock().unwrap();
        if state.pending != Some(request) || state.acked >= ping {
            return false;
        }
        state.pending = None;
        state.approved = true;
        true
    }
    /// 作者在前端做了决定；返回 true 表示该退出了。过期的请求号不算数。
    pub fn resolve(&self, request: u64, proceed: bool) -> bool {
        let mut state = self.0.lock().unwrap();
        if state.pending != Some(request) {
            return false;
        }
        state.pending = None;
        state.approved = proceed;
        proceed
    }
}

pub fn handle_close_requested(window: &tauri::Window) {
    let app = window.app_handle().clone();
    let guard = app.state::<CloseGuard>().inner().clone();
    match guard.request_close() {
        CloseStep::Exit => app.exit(0),
        CloseStep::Ask { request, ping } => {
            let _ = app.emit("storyforge:close-requested", request);
            std::thread::spawn(move || {
                std::thread::sleep(ACK_TIMEOUT);
                if guard.ack_missed(request, ping) {
                    app.exit(0);
                }
            });
        }
    }
}

#[tauri::command]
pub fn arm_close_guard(guard: tauri::State<'_, CloseGuard>, armed: bool) {
    guard.arm(armed);
}
#[tauri::command]
pub fn acknowledge_close_request(guard: tauri::State<'_, CloseGuard>, request: u64) {
    guard.acknowledge(request);
}
#[tauri::command]
pub fn resolve_close_request(
    app: tauri::AppHandle,
    guard: tauri::State<'_, CloseGuard>,
    request: u64,
    proceed: bool,
) {
    if guard.resolve(request, proceed) {
        app.exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked(guard: &CloseGuard) -> (u64, u64) {
        match guard.request_close() {
            CloseStep::Ask { request, ping } => (request, ping),
            CloseStep::Exit => panic!("armed guard must ask first"),
        }
    }

    #[test]
    fn unarmed_guard_exits_directly() {
        let guard = CloseGuard::default();
        assert_eq!(guard.request_close(), CloseStep::Exit);
        guard.arm(true);
        guard.arm(false);
        assert_eq!(guard.request_close(), CloseStep::Exit);
    }

    #[test]
    fn author_keeps_editing_then_closes() {
        let guard = CloseGuard::default();
        guard.arm(true);
        let (request, ping) = asked(&guard);
        guard.acknowledge(request);
        assert!(!guard.resolve(request, false));
        assert!(!guard.ack_missed(request, ping));
        let (again, _) = asked(&guard);
        assert_ne!(again, request);
        assert!(guard.resolve(again, true));
        assert_eq!(guard.request_close(), CloseStep::Exit);
    }

    #[test]
    fn stale_or_unknown_request_cannot_close() {
        let guard = CloseGuard::default();
        guard.arm(true);
        let (request, _) = asked(&guard);
        assert!(!guard.resolve(request + 1, true));
        assert!(!guard.resolve(request, false));
        assert!(!guard.resolve(request, true));
        assert!(matches!(guard.request_close(), CloseStep::Ask { .. }));
    }

    #[test]
    fn silent_renderer_lets_the_window_close() {
        let guard = CloseGuard::default();
        guard.arm(true);
        let (request, ping) = asked(&guard);
        assert!(guard.ack_missed(request, ping));
        assert_eq!(guard.request_close(), CloseStep::Exit);
    }

    #[test]
    fn repeated_close_while_asking_rechecks_liveness_on_the_same_request() {
        let guard = CloseGuard::default();
        guard.arm(true);
        let (request, first) = asked(&guard);
        guard.acknowledge(request);
        let (same, second) = asked(&guard);
        assert_eq!(same, request);
        assert!(!guard.ack_missed(request, first));
        // 第二次点关闭后前端不再回声：说明卡住了，限时后退出。
        assert!(guard.ack_missed(request, second));
    }
}
