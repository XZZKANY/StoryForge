//! Windows OS-owned lifetime fence. Graceful shutdown remains a separate protocol.
//!
//! Enroll the host before spawning anything so redirectors and grandchildren inherit
//! the job without a spawn/assign race. The host is itself a member: the only job
//! handle must live until process termination, never be dropped during shutdown.

#[cfg(not(windows))]
pub(crate) fn initialize() -> anyhow::Result<()> {
    Ok(())
}

#[cfg(windows)]
mod windows {
    use anyhow::{Context, Result};
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::ptr::null;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    // Statics are not dropped on normal Rust return; OS closes this handle even
    // under TerminateProcess. Null security attributes make it non-inheritable.
    static HOST_JOB: OnceLock<Result<OwnedHandle, String>> = OnceLock::new();

    fn enroll_host() -> Result<OwnedHandle> {
        // SAFETY: unnamed job, null optional security attributes. On success the
        // returned handle is exclusively owned here and immediately wrapped.
        let raw = unsafe { CreateJobObjectW(null(), null()) };
        if raw.is_null() {
            return Err(std::io::Error::last_os_error()).context("CreateJobObjectW failed");
        }
        // SAFETY: raw is a valid, newly created, non-inheritable job handle.
        let job = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: correct initialized structure/type/size; job handle is live.
        let configured = unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if configured == 0 {
            return Err(std::io::Error::last_os_error()).context("SetInformationJobObject failed");
        }
        // SAFETY: live job and current-process pseudo handle. No UI/breakaway
        // limits; nested jobs supported by Windows versions supported by Tauri.
        if unsafe { AssignProcessToJobObject(job.as_raw_handle(), GetCurrentProcess()) } == 0 {
            return Err(std::io::Error::last_os_error()).context("AssignProcessToJobObject failed");
        }
        // No fallible work after enrollment: dropping the last handle kills host.
        Ok(job)
    }

    pub(super) fn initialize() -> Result<()> {
        match HOST_JOB.get_or_init(|| enroll_host().map_err(|error| format!("{error:#}"))) {
            Ok(_) => Ok(()),
            Err(error) => anyhow::bail!("{error}"),
        }
    }
}

#[cfg(windows)]
pub(crate) fn initialize() -> anyhow::Result<()> {
    windows::initialize()
}

#[cfg(all(test, windows))]
#[path = "owned_process_tree_tests.rs"]
mod tests;
