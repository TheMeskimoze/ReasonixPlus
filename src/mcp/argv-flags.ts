/** Argv rewriting shared by managed MCP servers: read a flag, drop it, append it. */

/** Value of `--name value` or `--name=value`; the first occurrence wins. */
export function flagValue(args: readonly string[], name: string): string | undefined {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === flag) return args[index + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

export interface DropFlagsOptions {
  /** Value-taking flags: the flag and its following value both go. */
  values?: readonly string[];
  /** Flags with no value: only the flag itself goes. */
  bare?: readonly string[];
}

/** Remove the named flags, in both `--name value` and `--name=value` form. */
export function dropFlags(args: readonly string[], opts: DropFlagsOptions): string[] {
  const valueFlags = new Set((opts.values ?? []).map((name) => `--${name}`));
  const prefixes = [...valueFlags].map((flag) => `${flag}=`);
  const bareFlags = new Set(opts.bare ?? []);
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (bareFlags.has(arg)) continue;
    if (valueFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (prefixes.some((prefix) => arg.startsWith(prefix))) continue;
    result.push(arg);
  }
  return result;
}
