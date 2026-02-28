#[cfg(target_os = "windows")]
mod windows {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    use std::sync::OnceLock;

    type Handle = *mut c_void;
    type Hwnd = *mut c_void;
    type Bool = i32;

    const ERROR_ALREADY_EXISTS: u32 = 183;
    const SW_RESTORE: i32 = 9;
    static SINGLE_INSTANCE_MUTEX: OnceLock<usize> = OnceLock::new();

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateMutexW(
            lp_mutex_attributes: *mut c_void,
            b_initial_owner: Bool,
            lp_name: *const u16,
        ) -> Handle;
        fn GetLastError() -> u32;
        fn CloseHandle(h_object: Handle) -> Bool;
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn FindWindowW(lp_class_name: *const u16, lp_window_name: *const u16) -> Hwnd;
        fn ShowWindow(h_wnd: Hwnd, n_cmd_show: i32) -> Bool;
        fn SetForegroundWindow(h_wnd: Hwnd) -> Bool;
    }

    fn to_wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn focus_existing_main_window() {
        unsafe {
            let title = to_wide("LatoTex");
            let hwnd = FindWindowW(null(), title.as_ptr());
            if hwnd.is_null() {
                return;
            }
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
    }

    pub fn acquire_or_focus_existing() -> bool {
        unsafe {
            let mutex_name = to_wide("Local\\LatoTex.SingleInstance.com.latotex.desktop");
            let handle = CreateMutexW(null_mut(), 0, mutex_name.as_ptr());
            if handle.is_null() {
                return true;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                focus_existing_main_window();
                let _ = CloseHandle(handle);
                return false;
            }
            let _ = SINGLE_INSTANCE_MUTEX.set(handle as usize);
            true
        }
    }
}

#[cfg(target_os = "windows")]
pub fn acquire_or_focus_existing() -> bool {
    windows::acquire_or_focus_existing()
}

#[cfg(not(target_os = "windows"))]
pub fn acquire_or_focus_existing() -> bool {
    true
}
