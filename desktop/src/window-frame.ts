/** Window frame repairs. Both the titlebar and Windows itself change the window
 *  state, and the host re-asserts the frame after each change. */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { recordFrontendFailure } from "./diagnostics";

const SYNC_COMMAND = "sync_window_frame";
const RESET_COMMAND = "reset_window_state";
/** Resizes arrive once per frame while dragging; one repair per burst is enough. */
const SETTLE_MS = 150;

/** Re-assert frame styles, corner rounding and the restore rect for the current state. */
export async function syncWindowFrame(): Promise<void> {
  await invoke(SYNC_COMMAND);
}

/** Leave fullscreen, unmaximize, restore the default geometry, and forget the
 *  persisted window state so a corrupt one cannot come back. */
export async function resetWindowState(): Promise<void> {
  await invoke(RESET_COMMAND);
}

/** Repairs once on mount and once per burst of resizes, which covers maximize,
 *  snap, double-click restore and the drag paths that bypass the titlebar. */
export function watchWindowFrame(): () => void {
  const win = getCurrentWindow();
  const repair = () => {
    void syncWindowFrame().catch((error) => {
      recordFrontendFailure("frontend.window_frame_sync", error);
    });
  };
  repair();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;
  let disposed = false;

  win
    .listen("tauri://resize", () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        repair();
      }, SETTLE_MS);
    })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    })
    .catch((error) => {
      recordFrontendFailure("frontend.window_frame_listen", error);
    });

  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    unlisten?.();
  };
}
