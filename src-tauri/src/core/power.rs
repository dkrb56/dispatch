//! Keeps the computer awake while the Nightmode switch is on (ticket night-keep-awake). The
//! program that owns `shared.json` holds the request: the app in the mode "This PC does the work",
//! the host in the mode "Use a host". Only the sleep of the system is blocked; the display may
//! turn off.
//!
//! On Windows the request is a power request object of this process. Windows closes it when the
//! process ends, also at a crash or a forced end, so no end path of the app or the host needs a
//! call. On other systems a child `caffeinate -i -w <pid of this process>` holds the request; the
//! tool ends by itself when this process ends.

use std::sync::Mutex;

/// The reason text that `powercfg /requests` shows on Windows.
pub const REASON: &str = "Dispatch: Nightmode is on";

/// The request handle as an integer: the raw handle type is not `Send`, so it cannot sit in a static.
#[cfg(windows)]
type Held = isize;
#[cfg(not(windows))]
type Held = std::process::Child;

static HELD: Mutex<Option<Held>> = Mutex::new(None);

/// Holds the request when `on` is true and ends it when `on` is false. A second call with the
/// same value changes nothing.
pub fn keep_awake(on: bool) -> Result<(), String> {
    let mut held = HELD.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if on && held.is_none() {
        *held = Some(start()?);
    } else if !on {
        if let Some(request) = held.take() {
            stop(request);
        }
    }
    Ok(())
}

/// The request is held now.
pub fn held() -> bool {
    HELD.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).is_some()
}

#[cfg(windows)]
fn start() -> Result<Held, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Power::{PowerCreateRequest, PowerRequestSystemRequired, PowerSetRequest};
    use windows_sys::Win32::System::Threading::{POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0};
    let mut text: Vec<u16> = REASON.encode_utf16().chain(Some(0)).collect();
    let context = REASON_CONTEXT {
        // POWER_REQUEST_CONTEXT_VERSION, a feature of windows-sys that the crate does not use otherwise.
        Version: 0,
        Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
        Reason: REASON_CONTEXT_0 { SimpleReasonString: text.as_mut_ptr() },
    };
    // SAFETY: the context and its text live for the call; the handle is checked and closed on a failure.
    unsafe {
        let request = PowerCreateRequest(&context);
        if request.is_null() || request == INVALID_HANDLE_VALUE {
            return Err(format!("no power request: {}", std::io::Error::last_os_error()));
        }
        if PowerSetRequest(request, PowerRequestSystemRequired) == 0 {
            let error = std::io::Error::last_os_error();
            CloseHandle(request);
            return Err(format!("the power request was not set: {error}"));
        }
        Ok(request as isize)
    }
}

#[cfg(windows)]
fn stop(request: Held) {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Power::{PowerClearRequest, PowerRequestSystemRequired};
    // SAFETY: the handle came from `start` and is closed once.
    unsafe {
        PowerClearRequest(request as HANDLE, PowerRequestSystemRequired);
        CloseHandle(request as HANDLE);
    }
}

#[cfg(not(windows))]
fn start() -> Result<Held, String> {
    use std::process::{Command, Stdio};
    Command::new("caffeinate")
        .args(["-i", "-w", &std::process::id().to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("caffeinate did not start: {e}"))
}

#[cfg(not(windows))]
fn stop(mut child: Held) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn on_holds_one_request_and_off_ends_it() {
        keep_awake(true).unwrap();
        assert!(held(), "on holds the request");
        keep_awake(true).unwrap();
        assert!(held(), "a second on keeps the one request");
        keep_awake(false).unwrap();
        assert!(!held(), "off ends the request");
        keep_awake(false).unwrap();
        assert!(!held(), "a second off changes nothing");
    }
}
