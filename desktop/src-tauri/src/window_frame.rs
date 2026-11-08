//! Repairs the window frame Windows leaves behind: a windowed rect that starts off the
//! monitor has its rounded corners and shadow clipped away by DWM.

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::diagnostics;

/// What one repair did, so the caller can log it and a test can assert on it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameReport {
    pub maximized: bool,
    pub fullscreen: bool,
    pub rounded: bool,
    pub frame_repaired: bool,
    pub geometry_repaired: bool,
    /// tao still held a fullscreen flag while the window covered no monitor.
    pub fullscreen_exit: bool,
    /// Windows still had the window maximized while tao reported it windowed.
    pub maximize_cleared: bool,
}
/// What a full reset settled on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetReport {
    pub frame: FrameReport,
    /// The window was moved or resized to the configured default.
    pub placed: bool,
}

/// Frame bits tao keeps on a resizable undecorated window. DWM draws the corners
/// and shadow from them, and tao's own hit test offers a resize border from them.
#[cfg(windows)]
const FRAME_STYLE_BITS: u32 =
    WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;

#[cfg(windows)]
const GWL_STYLE: i32 = -16;
#[cfg(windows)]
const WS_CAPTION: u32 = 0x00C0_0000;
#[cfg(windows)]
const WS_THICKFRAME: u32 = 0x0004_0000;
#[cfg(windows)]
const WS_SYSMENU: u32 = 0x0008_0000;
#[cfg(windows)]
const WS_MINIMIZEBOX: u32 = 0x0002_0000;
#[cfg(windows)]
const WS_MAXIMIZEBOX: u32 = 0x0001_0000;
#[cfg(windows)]
const WS_MAXIMIZE: u32 = 0x0100_0000;
#[cfg(windows)]
const SWP_NOSIZE: u32 = 0x0001;
#[cfg(windows)]
const SWP_NOMOVE: u32 = 0x0002;
#[cfg(windows)]
const SWP_NOZORDER: u32 = 0x0004;
#[cfg(windows)]
const SWP_NOACTIVATE: u32 = 0x0010;
#[cfg(windows)]
const SWP_FRAMECHANGED: u32 = 0x0020;
#[cfg(windows)]
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
#[cfg(windows)]
const DWMWCP_DONOTROUND: i32 = 1;
#[cfg(windows)]
const DWMWCP_ROUND: i32 = 2;

/// Tolerance when comparing a window rect against a monitor rect, in physical pixels.
const COVER_TOLERANCE: u32 = 2;

/// `WINDOWPLACEMENT`, whose `rcNormalPosition` is the rect Windows restores a
/// maximized window to.
#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct WindowPlacement {
    length: u32,
    flags: u32,
    show_cmd: u32,
    min_position: Point,
    max_position: Point,
    normal_position: Rect,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Point {
    x: i32,
    y: i32,
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetWindowLongW(hwnd: *mut std::ffi::c_void, index: i32) -> i32;
    fn SetWindowLongW(hwnd: *mut std::ffi::c_void, index: i32, value: i32) -> i32;
    fn SetWindowPos(
        hwnd: *mut std::ffi::c_void,
        insert_after: *mut std::ffi::c_void,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
    fn GetWindowPlacement(hwnd: *mut std::ffi::c_void, placement: *mut WindowPlacement) -> i32;
    fn SetWindowPlacement(hwnd: *mut std::ffi::c_void, placement: *const WindowPlacement) -> i32;
}

#[cfg(windows)]
#[link(name = "dwmapi")]
unsafe extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: *mut std::ffi::c_void,
        attribute: u32,
        value: *const std::ffi::c_void,
        size: u32,
    ) -> i32;
}

/// Corrects a windowed rect Windows left clipped at the top or left edge, or
/// dropped outside the work area entirely. A rect hanging off the right or
/// bottom edge is reachable and stays untouched; `None` means nothing to do.
pub fn clamp_windowed_rect(
    rect: PhysicalRect<i32, u32>,
    work: PhysicalRect<i32, u32>,
) -> Option<PhysicalRect<i32, u32>> {
    let (left, top) = (rect.position.x, rect.position.y);
    let (right, bottom) = (
        left.saturating_add(rect.size.width as i32),
        top.saturating_add(rect.size.height as i32),
    );
    let (work_left, work_top) = (work.position.x, work.position.y);
    let (work_right, work_bottom) = (
        work_left.saturating_add(work.size.width as i32),
        work_top.saturating_add(work.size.height as i32),
    );
    let clipped = left < work_left || top < work_top;
    let outside = right <= work_left || left >= work_right || bottom <= work_top || top >= work_bottom;
    if !clipped && !outside {
        return None;
    }
    let width = rect.size.width.min(work.size.width);
    let height = rect.size.height.min(work.size.height);
    let x = left.clamp(work_left, work_right - width as i32);
    let y = top.clamp(work_top, work_bottom - height as i32);
    Some(PhysicalRect {
        position: PhysicalPosition::new(x, y),
        size: PhysicalSize::new(width, height),
    })
}

/// Centers a window of `size` inside `work`, shrinking it to 90% of the work
/// area when that size does not fit.
pub fn centered_rect(
    size: PhysicalSize<u32>,
    work: PhysicalRect<i32, u32>,
) -> PhysicalRect<i32, u32> {
    let width = if size.width > work.size.width {
        (work.size.width as f64 * 0.9).round() as u32
    } else {
        size.width
    };
    let height = if size.height > work.size.height {
        (work.size.height as f64 * 0.9).round() as u32
    } else {
        size.height
    };
    PhysicalRect {
        position: PhysicalPosition::new(
            work.position.x + ((work.size.width.saturating_sub(width)) / 2) as i32,
            work.position.y + ((work.size.height.saturating_sub(height)) / 2) as i32,
        ),
        size: PhysicalSize::new(width, height),
    }
}

/// Brings the window's frame and geometry back in line with what it actually is:
/// frame bits present while windowed, corners rounded only in windowed mode, and
/// the restore rect inside the monitor.
pub fn sync(window: &WebviewWindow) -> FrameReport {
    let reported_fullscreen = window.is_fullscreen().unwrap_or(false);
    let fullscreen = reported_fullscreen && covers_monitor(window);
    // tao can hold a fullscreen flag over a window that covers no monitor: its
    // styles stay stripped, its hit test skips the resize border, and the shell
    // keeps the taskbar hidden. Exiting through tao clears all three.
    let fullscreen_exit = fullscreen_is_stale(reported_fullscreen, fullscreen);
    if fullscreen_exit {
        let _ = window.set_fullscreen(false);
    }
    let maximized = window.is_maximized().unwrap_or(false);
    // The mirror of a stuck fullscreen flag: Windows keeps the window maximized
    // while tao reports it windowed, so DWM squares it and the hit test offers no
    // resize border. Clearing the style bit is what makes it a normal window again.
    let maximize_cleared = clear_stale_maximize(window, maximized);
    let rounded = !fullscreen && !maximized && !maximize_cleared;
    let frame_repaired = apply_frame(window, !fullscreen);
    set_corner_rounding(window, rounded);
    let geometry_repaired = if fullscreen {
        false
    } else if maximized {
        repair_restore_rect(window)
    } else {
        repair_windowed_rect(window)
    };
    FrameReport {
        maximized,
        fullscreen,
        rounded,
        frame_repaired,
        geometry_repaired,
        fullscreen_exit,
        maximize_cleared,
    }
}

/// Queues the two state changes only tao can make, in order on its event loop.
pub fn begin_reset(window: &WebviewWindow) {
    let _ = window.set_fullscreen(false);
    let _ = window.unmaximize();
}

/// Runs once the queued changes have landed: places the window at the configured
/// size, repairs the frame, then rewrites the persisted state from it.
pub fn finish_reset(app: &AppHandle, window: &WebviewWindow) -> ResetReport {
    let frame = sync(window);
    let placed = match configured_size(app, window.label()) {
        Some(size) if !frame.fullscreen => place_window(window, size),
        _ => false,
    };
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::remove_file(dir.join(app.filename()));
    }
    let _ = app.save_window_state(StateFlags::all());
    let report = ResetReport { frame, placed };
    let _ = diagnostics::record(
        "info",
        "host.window_state_reset",
        serde_json::json!({ "report": report }),
    );
    report
}

fn configured_size(app: &AppHandle, label: &str) -> Option<tauri::LogicalSize<f64>> {
    app.config()
        .app
        .windows
        .iter()
        .find(|window| window.label == label)
        .map(|window| tauri::LogicalSize::new(window.width, window.height))
}

/// True when the window covers its monitor exactly, which is what a fullscreen
/// window does and a windowed one does not.
fn covers_monitor(window: &WebviewWindow) -> bool {
    let (Ok(position), Ok(size), Ok(Some(monitor))) =
        (window.outer_position(), window.outer_size(), window.current_monitor())
    else {
        return false;
    };
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    position.x.abs_diff(monitor_position.x) <= 2
        && position.y.abs_diff(monitor_position.y) <= 2
        && size.width.abs_diff(monitor_size.width) <= COVER_TOLERANCE
        && size.height.abs_diff(monitor_size.height) <= COVER_TOLERANCE
}

/// Places a windowed window at `size` centered on its monitor. The logical size
/// is converted here, so a scale factor cannot turn it into an oversized rect.
#[cfg(windows)]
pub fn place_window(window: &WebviewWindow, size: tauri::LogicalSize<f64>) -> bool {
    let (Ok(scale), Ok(Some(monitor))) = (window.scale_factor(), window.current_monitor()) else {
        return false;
    };
    let work = *monitor.work_area();
    let target = centered_rect(
        PhysicalSize::new(
            (size.width * scale).round().max(1.0) as u32,
            (size.height * scale).round().max(1.0) as u32,
        ),
        work,
    );
    // A window Windows holds maximized ignores the placement below.
    clear_stale_maximize(window, false);
    let (Ok(current_position), Ok(current_size)) = (window.outer_position(), window.outer_size())
    else {
        return false;
    };
    if current_position == target.position && current_size == target.size {
        return false;
    }
    set_outer_rect(window, target)
}

/// Moves and resizes the window in one positioning call, and reports whether
/// Windows accepted it.
#[cfg(windows)]
fn set_outer_rect(window: &WebviewWindow, rect: PhysicalRect<i32, u32>) -> bool {
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            rect.position.x,
            rect.position.y,
            rect.size.width as i32,
            rect.size.height as i32,
            SWP_NOZORDER | SWP_NOACTIVATE,
        ) != 0
    }
}

#[cfg(not(windows))]
fn set_outer_rect(window: &WebviewWindow, rect: PhysicalRect<i32, u32>) -> bool {
    window.set_size(rect.size).is_ok() && window.set_position(rect.position).is_ok()
}
#[cfg(not(windows))]
pub fn place_window(window: &WebviewWindow, size: tauri::LogicalSize<f64>) -> bool {
    let _ = window.set_size(tauri::Size::Logical(size));
    let _ = window.center();
    true
}

fn repair_windowed_rect(window: &WebviewWindow) -> bool {
    // A hidden or minimized window sits at a placeholder rect, so its geometry
    // says nothing about where the user will see it.
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return false;
    }
    let (Ok(position), Ok(size), Ok(Some(monitor))) =
        (window.outer_position(), window.outer_size(), window.current_monitor())
    else {
        return false;
    };
    let rect = PhysicalRect {
        position,
        size,
    };
    let Some(fixed) = clamp_windowed_rect(rect, *monitor.work_area()) else {
        return false;
    };
    let mut changed = false;
    if fixed.size != rect.size {
        changed |= window.set_size(fixed.size).is_ok();
    }
    if fixed.position != rect.position {
        changed |= window.set_position(fixed.position).is_ok();
    }
    changed
}

#[cfg(windows)]
fn apply_frame(window: &WebviewWindow, framed: bool) -> bool {
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    unsafe {
        let style = GetWindowLongW(hwnd.0, GWL_STYLE) as u32;
        let next = if framed {
            style | FRAME_STYLE_BITS
        } else {
            style & !FRAME_STYLE_BITS
        };
        if next == style {
            return false;
        }
        SetWindowLongW(hwnd.0, GWL_STYLE, next as i32);
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
    true
}

#[cfg(not(windows))]
fn apply_frame(_window: &WebviewWindow, _framed: bool) -> bool {
    false
}

/// Drops a `WS_MAXIMIZE` bit tao no longer accounts for, so the window behaves and
/// looks windowed again. `tao_maximized` short-circuits the legitimate case.
#[cfg(windows)]
fn clear_stale_maximize(window: &WebviewWindow, tao_maximized: bool) -> bool {
    if tao_maximized {
        return false;
    }
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    unsafe {
        let style = GetWindowLongW(hwnd.0, GWL_STYLE) as u32;
        if style & WS_MAXIMIZE == 0 {
            return false;
        }
        SetWindowLongW(hwnd.0, GWL_STYLE, (style & !WS_MAXIMIZE) as i32);
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
    true
}

#[cfg(not(windows))]
fn clear_stale_maximize(_window: &WebviewWindow, _tao_maximized: bool) -> bool {
    false
}

#[cfg(windows)]
fn set_corner_rounding(window: &WebviewWindow, rounded: bool) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let preference: i32 = if rounded {
        DWMWCP_ROUND
    } else {
        DWMWCP_DONOTROUND
    };
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            std::ptr::addr_of!(preference).cast(),
            std::mem::size_of::<i32>() as u32,
        );
    }
}

#[cfg(not(windows))]
fn set_corner_rounding(_window: &WebviewWindow, _rounded: bool) {}

/// A maximized window keeps the rect it will return to in its placement, so a
/// clipped restore rect has to be corrected in place rather than by moving the
/// maximized window.
#[cfg(windows)]
fn repair_restore_rect(window: &WebviewWindow) -> bool {
    let (Ok(hwnd), Ok(Some(monitor))) = (window.hwnd(), window.current_monitor()) else {
        return false;
    };
    let mut placement = WindowPlacement {
        length: std::mem::size_of::<WindowPlacement>() as u32,
        ..WindowPlacement::default()
    };
    unsafe {
        if GetWindowPlacement(hwnd.0, &mut placement) == 0 {
            return false;
        }
    }
    let normal = placement.normal_position;
    let rect = PhysicalRect {
        position: PhysicalPosition::new(normal.left, normal.top),
        size: PhysicalSize::new(
            (normal.right - normal.left).max(0) as u32,
            (normal.bottom - normal.top).max(0) as u32,
        ),
    };
    let Some(fixed) = clamp_windowed_rect(rect, *monitor.work_area()) else {
        return false;
    };
    placement.normal_position = Rect {
        left: fixed.position.x,
        top: fixed.position.y,
        right: fixed.position.x + fixed.size.width as i32,
        bottom: fixed.position.y + fixed.size.height as i32,
    };
    unsafe { SetWindowPlacement(hwnd.0, &placement) != 0 }
}

#[cfg(not(windows))]
fn repair_restore_rect(_window: &WebviewWindow) -> bool {
    false
}

/// A fullscreen flag is stale when the window does not cover its monitor: tao
/// then keeps the frame stripped and the shell keeps the taskbar hidden.
pub fn fullscreen_is_stale(reported: bool, covers_monitor: bool) -> bool {
    reported && !covers_monitor
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, width: u32, height: u32) -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(left, top),
            size: PhysicalSize::new(width, height),
        }
    }

    const WORK: PhysicalRect<i32, u32> = PhysicalRect {
        position: PhysicalPosition { x: 0, y: 0 },
        size: PhysicalSize {
            width: 1920,
            height: 1040,
        },
    };

    #[test]
    fn the_maximized_offset_is_pulled_onto_the_work_area() {
        let fixed = clamp_windowed_rect(rect(-8, -8, 958, 835), WORK).expect("clipped rect is repaired");
        assert_eq!(fixed.position, PhysicalPosition::new(0, 0));
        assert_eq!(fixed.size, PhysicalSize::new(958, 835));
    }

    #[test]
    fn a_visible_window_is_left_alone() {
        assert!(clamp_windowed_rect(rect(120, 80, 958, 835), WORK).is_none());
    }

    #[test]
    fn a_right_edge_overhang_is_left_alone() {
        assert!(clamp_windowed_rect(rect(1500, 100, 958, 835), WORK).is_none());
    }

    #[test]
    fn a_window_beyond_every_monitor_is_pulled_back() {
        let fixed = clamp_windowed_rect(rect(4000, 3000, 800, 600), WORK).expect("off-screen rect is repaired");
        assert_eq!(fixed.position, PhysicalPosition::new(1120, 440));
    }

    #[test]
    fn an_oversized_window_is_shrunk_to_the_work_area() {
        let fixed = clamp_windowed_rect(rect(-40, -40, 2400, 1400), WORK).expect("oversized rect is repaired");
        assert_eq!(fixed.position, PhysicalPosition::new(0, 0));
        assert_eq!(fixed.size, PhysicalSize::new(1920, 1040));
    }

    #[test]
    fn a_monitor_above_the_primary_keeps_its_negative_origin() {
        let above = rect(0, -1080, 1920, 1040);
        let work = rect(0, -1080, 1920, 1040);
        assert!(clamp_windowed_rect(above, work).is_none());
    }

    #[test]
    fn the_configured_size_is_centered_on_the_work_area() {
        let target = centered_rect(PhysicalSize::new(1024, 720), WORK);
        assert_eq!(target.position, PhysicalPosition::new(448, 160));
        assert_eq!(target.size, PhysicalSize::new(1024, 720));
    }

    #[test]
    fn centering_follows_a_monitor_that_starts_off_the_primary() {
        let second = rect(1920, 0, 2560, 1400);
        let target = centered_rect(PhysicalSize::new(1024, 720), second);
        assert_eq!(target.position, PhysicalPosition::new(1920 + 768, 340));
    }

    #[test]
    fn a_size_larger_than_the_panel_shrinks_to_ninety_percent() {
        let target = centered_rect(PhysicalSize::new(3840, 2160), WORK);
        assert_eq!(target.size, PhysicalSize::new(1728, 936));
        assert_eq!(target.position, PhysicalPosition::new(96, 52));
    }

    #[test]
    fn a_fullscreen_flag_over_a_windowed_rect_is_stale() {
        assert!(fullscreen_is_stale(true, false));
        assert!(!fullscreen_is_stale(true, true));
        assert!(!fullscreen_is_stale(false, false));
    }
}
