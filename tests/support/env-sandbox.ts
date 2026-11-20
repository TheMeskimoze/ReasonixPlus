/** Exact env restoration for tests: an unset variable is deleted, never assigned
 *  the string "undefined". */

export type EnvSnapshot = ReadonlyArray<readonly [string, string | undefined]>;

export function saveEnv(names: readonly string[]): EnvSnapshot {
  return names.map((name) => [name, process.env[name]] as const);
}

export function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** Remove variables outright; assigning undefined would store the string "undefined". */
export function unsetEnv(names: readonly string[]): void {
  for (const name of names) Reflect.deleteProperty(process.env, name);
}

/** Point HOME and USERPROFILE at `dir`; call the result to restore both. */
export function useTempHome(dir: string): () => void {
  const saved = saveEnv(["HOME", "USERPROFILE"]);
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return () => restoreEnv(saved);
}
