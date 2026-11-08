/** Environment flag parsing shared by the OpenCode free-tier switches. */

const TRUTHY = new Set(["1", "on", "true", "yes"]);
const FALSY = new Set(["0", "off", "false", "no"]);

/** Reads a boolean env flag. An unset or unrecognized value returns `fallback`,
 *  so one spelling table serves every switch. */
export function envFlag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (TRUTHY.has(value)) return true;
  if (FALSY.has(value)) return false;
  return fallback;
}
