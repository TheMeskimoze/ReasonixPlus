/** Forward-slash form of a path: the display and compare form shared by relative
 *  path rendering, search results, executable-name matching and workspace
 *  identity. Pure string work, so the node-side path-utils and the browser-safe
 *  root index both build on this one copy. */
export function toPosixPath(p: string): string {
  return p.replaceAll("\\", "/");
}
