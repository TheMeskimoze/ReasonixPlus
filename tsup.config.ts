import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    noExternal: ["@reasonix/core-utils"],
  },
  {
    // `desktop-mcp` is the bundled stdio MCP server the daemon spawns beside
    // itself (`dist/cli/desktop-mcp.js`), so it ships with the same inlining rules.
    entry: { index: "src/cli/index.ts", "desktop-mcp": "src/mcp/servers/desktop-mcp.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist/cli",
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }",
    },
    platform: "node",
    noExternal: [/.*/],
    esbuildOptions(opts) {
      // sharp is a native addon — its platform binaries must resolve from
      // node_modules at runtime, not be inlined into the bundle.
      opts.external = [...(opts.external ?? []), "react-devtools-core", "sharp"];
    },
  },
]);
