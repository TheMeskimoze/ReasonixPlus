/** Credential-derived cache keys: one short hash, never the raw secret. */

import { createHash } from "node:crypto";

/** Stable short hash of named credential parts. `chars` bounds the key or filename size. */
export function credentialFingerprint(
  parts: Record<string, string | undefined>,
  chars = 16,
): string {
  const material = Object.entries(parts)
    .map(([name, value]) => `${name}\u0000${value ?? ""}`)
    .join("\u0001");
  return createHash("sha256").update(material).digest("hex").slice(0, chars);
}
