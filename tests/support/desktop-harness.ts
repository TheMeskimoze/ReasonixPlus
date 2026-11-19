// The mocked Tauri host a full-app desktop test drives: the event handlers it feeds,
// the commands App.tsx sent, and the window/observer stubs a jsdom render expects.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { act, cleanup } from "@testing-library/react";
import { vi } from "vitest";

export const WS = "C:\\ws";

type RpcHandler = (e: { payload: unknown }) => void;

/** The app's live `rpc:event` listeners, keyed by event name. */
export const handlers = new Map<string, RpcHandler>();

/** Every command the app pushed to the daemon, in order. */
export const sent: Record<string, unknown>[] = [];

/** Deliver one daemon event (optionally addressed to a tab) inside act(). */
export async function feed(ev: Record<string, unknown>, tabId?: string): Promise<void> {
  await feedBatch([tabId ? { ...ev, tabId } : ev]);
}

/** Deliver several events in one act() pass, the way a batched daemon write arrives. */
export async function feedBatch(events: Record<string, unknown>[]): Promise<void> {
  const handler = handlers.get("rpc:event");
  if (!handler) throw new Error("rpc:event handler not registered yet");
  await act(async () => {
    for (const event of events) handler({ payload: { data: JSON.stringify(event) } });
  });
}

/** Let pending promises, effects and timer work settle. */
export const settle = (ms = 40) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** The `$settings` event a channel needs before it renders its composer. */
export function appSettings(workspaceDir: string = WS, model = "deepseek-v4-flash") {
  return {
    type: "$settings",
    reasoningEffort: "medium",
    editMode: "follow",
    quickSendId: "proceed",
    quickSends: [],
    workspaceDir,
    recentWorkspaces: [WS],
    model,
    version: "0.50.1",
  };
}

/** Install the mocked host, clearing what the previous test left behind. `answer` handles
 *  the commands beyond `rpc_send`; the default host resolves them all to undefined. */
export function mockDesktopHost(answer?: (cmd: string, args?: { line?: string }) => unknown): void {
  handlers.clear();
  sent.length = 0;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
  if (!window.matchMedia) {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
  (listen as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (name: string, cb: RpcHandler) => {
      handlers.set(name, cb);
      return () => handlers.delete(name);
    },
  );
  (getCurrentWindow as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    isMaximized: vi.fn(async () => false),
    isFocused: vi.fn(async () => true),
    isVisible: vi.fn(async () => true),
    isMinimized: vi.fn(async () => false),
    listen: vi.fn(async () => () => {}),
    close: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    setTitle: vi.fn(),
    onCloseRequested: vi.fn(async () => () => {}),
    onResized: vi.fn(async () => () => {}),
  });
  (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (cmd: string, args?: { line?: string }) => {
      if (cmd === "rpc_send" && args?.line) {
        sent.push(JSON.parse(args.line) as Record<string, unknown>);
        return undefined;
      }
      return answer?.(cmd, args);
    },
  );
}

/** Unmount what the test rendered and drop its mock calls. */
export function resetDesktopHost(): void {
  cleanup();
  vi.clearAllMocks();
}
