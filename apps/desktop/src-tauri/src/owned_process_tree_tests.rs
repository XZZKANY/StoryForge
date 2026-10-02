//! Separate processes are essential: enrolling the test runner would kill other tests.
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

const ROOT_ENV: &str = "STORYFORGE_JOB_TEST_ROOT";
const ROLE_ENV: &str = "STORYFORGE_JOB_TEST_ROLE";

struct Owner(Child);

impl Drop for Owner {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct Member(OwnedHandle);

impl Member {
    fn open(pid: u32) -> Self {
        // SAFETY: PID came from our isolated helper marker; handle only permits
        // waiting and emergency test cleanup. Non-inheritable, kept before kill.
        let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_TERMINATE, 0, pid) };
        assert!(!raw.is_null(), "owned helper PID {pid} unavailable");
        // SAFETY: newly opened valid owned process handle.
        Self(unsafe { OwnedHandle::from_raw_handle(raw) })
    }

    fn wait(&self, ms: u32) -> u32 {
        // SAFETY: owned process handle stays live throughout wait.
        unsafe { WaitForSingleObject(self.0.as_raw_handle(), ms) }
    }
}

impl Drop for Member {
    fn drop(&mut self) {
        if self.wait(0) == WAIT_TIMEOUT {
            // SAFETY: only our originally opened helper handle, not a recycled PID.
            unsafe { TerminateProcess(self.0.as_raw_handle(), 99) };
            let _ = self.wait(5000);
        }
    }
}

fn helper(role: &str, root: &Path) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "owned_process_tree::tests::job_process_helper",
            "--ignored",
            "--nocapture",
        ])
        .env(ROOT_ENV, root)
        .env(ROLE_ENV, role)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

fn helper_root() -> Option<PathBuf> {
    let root = PathBuf::from(std::env::var_os(ROOT_ENV)?);
    assert!(root.is_absolute() && root.is_dir());
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("storyforge-job-test-"));
    Some(root)
}

#[test]
#[ignore = "spawned only by isolated owner lifetime tests"]
fn job_process_helper() {
    let Some(root) = helper_root() else {
        return;
    };
    let role = std::env::var(ROLE_ENV).unwrap();
    match role.as_str() {
        "owner-kill" | "owner-normal" | "owner-unmanaged" => {
            if role != "owner-unmanaged" {
                super::initialize().unwrap();
                super::initialize().unwrap(); // Same live handle, never close/re-enroll.
            }
            let _child = Owner(helper("child", &root));
            loop {
                if role == "owner-normal" && root.join("exit").exists() {
                    // Skip all Rust destructors. OS closure of static job handle
                    // must still terminate the descendants, as in real main exit.
                    std::process::exit(0);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        "child" => {
            let grandchild = Owner(helper("grandchild", &root));
            std::fs::write(root.join("child.pid"), std::process::id().to_string()).unwrap();
            std::fs::write(root.join("grandchild.pid"), grandchild.0.id().to_string()).unwrap();
            loop {
                std::thread::sleep(Duration::from_secs(1));
            }
        }
        "grandchild" => {
            std::fs::write(root.join("grandchild-ready"), b"ready").unwrap();
            loop {
                std::thread::sleep(Duration::from_secs(1));
            }
        }
        _ => panic!("unknown test role"),
    }
}

fn verify_lifetime(normal: bool, managed: bool) {
    let dir = tempfile::Builder::new()
        .prefix("storyforge-job-test-")
        .tempdir()
        .unwrap();
    let root = dir.path();
    let mut owner = Owner(helper(
        if !managed {
            "owner-unmanaged"
        } else if normal {
            "owner-normal"
        } else {
            "owner-kill"
        },
        root,
    ));
    let deadline = Instant::now() + Duration::from_secs(10);
    while !root.join("grandchild-ready").exists() || !root.join("grandchild.pid").exists() {
        assert!(
            owner.0.try_wait().unwrap().is_none(),
            "owner exited before ready"
        );
        assert!(
            Instant::now() < deadline,
            "owned descendant startup timed out"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let child = Member::open(
        std::fs::read_to_string(root.join("child.pid"))
            .unwrap()
            .parse()
            .unwrap(),
    );
    let grandchild = Member::open(
        std::fs::read_to_string(root.join("grandchild.pid"))
            .unwrap()
            .parse()
            .unwrap(),
    );
    assert_eq!(child.wait(0), WAIT_TIMEOUT);
    assert_eq!(grandchild.wait(0), WAIT_TIMEOUT);
    if normal {
        std::fs::write(root.join("exit"), b"exit").unwrap();
    } else {
        owner.0.kill().unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = owner.0.try_wait().unwrap() {
            break status;
        }
        assert!(Instant::now() < deadline, "owner failed to exit");
        std::thread::sleep(Duration::from_millis(10));
    };
    assert_eq!(status.success(), normal);
    if !managed {
        // Control proves killing only a parent is insufficient. Exact live
        // handles are cleaned by Member::drop, not misreported as OS success.
        assert_eq!(child.wait(100), WAIT_TIMEOUT);
        assert_eq!(grandchild.wait(100), WAIT_TIMEOUT);
        return;
    }
    assert_eq!(child.wait(5000), WAIT_OBJECT_0, "child outlived owner");
    assert_eq!(
        grandchild.wait(5000),
        WAIT_OBJECT_0,
        "grandchild outlived owner"
    );
}

#[test]
fn native_force_kill_terminates_children_and_grandchildren() {
    verify_lifetime(false, true);
}

#[test]
fn native_normal_exit_terminates_remaining_descendants_without_drop() {
    verify_lifetime(true, true);
}

#[test]
fn unmanaged_parent_kill_is_not_a_process_tree_fence() {
    verify_lifetime(false, false);
}
