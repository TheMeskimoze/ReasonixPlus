/** Gateway session ids: 12 descending hex timestamp digits plus a 14-char tail. */

const MASK = (1n << 48n) - 1n;
const BASE = 0x4000n;
const TAIL = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const OPENCODE_ID = /^ses_[0-9a-f]{12}[0-9a-zA-Z]{14}$/;

/** True for an id the gateway will accept as a session it can account for. */
export function isOpencodeSessionId(id: string | undefined): boolean {
  return id !== undefined && OPENCODE_ID.test(id);
}

/** Mint a session id in the gateway's own shape; `now` exists for tests. */
export function mintOpencodeSessionId(now: number = Date.now()): string {
  const stamp = (BASE - ((BigInt(now) << 12n) & MASK)) & MASK;
  let tail = "";
  for (let i = 0; i < 14; i++) tail += TAIL[Math.floor(Math.random() * TAIL.length)];
  return `ses_${stamp.toString(16).padStart(12, "0")}${tail}`;
}

/** Reuse a chat's id when it is already valid, so prompt cache affinity survives. */
export function opencodeSessionId(preferred: string | undefined): string {
  return isOpencodeSessionId(preferred) ? (preferred as string) : mintOpencodeSessionId();
}
