import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bunReleaseAsset, installBun } from "../src/opencode-bun-install.js";

const BINARY = process.platform === "win32" ? "bun.exe" : "bun";
const roots: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "reasonix-bun-install-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bunReleaseAsset", () => {
  it("names the asset Bun publishes for a platform and cpu", () => {
    expect(bunReleaseAsset("win32", "x64")).toBe("bun-windows-x64.zip");
    expect(bunReleaseAsset("darwin", "arm64")).toBe("bun-darwin-aarch64.zip");
    expect(bunReleaseAsset("linux", "x64")).toBe("bun-linux-x64.zip");
  });
});

describe("installBun", () => {
  it("downloads, unpacks and installs the binary where the relay searches", async () => {
    const targetDir = join(scratch(), ".bun", "bin");
    const phases: string[] = [];
    const extract = vi.fn(async (_archive: string, destDir: string) => {
      const nested = join(destDir, "bun-windows-x64");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, BINARY), "binary");
    });

    const installed = await installBun({
      targetDir,
      workDir: scratch(),
      fetchImpl: (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch,
      extract,
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(["downloading", "extracting"]);
    expect(installed.command).toBe(join(targetDir, BINARY));
    expect(readFileSync(installed.command, "utf8")).toBe("binary");
  });

  it("reports a failed download and installs nothing", async () => {
    const targetDir = join(scratch(), "bin");
    const extract = vi.fn();

    await expect(
      installBun({
        targetDir,
        workDir: scratch(),
        fetchImpl: (async () => new Response("nope", { status: 502 })) as typeof fetch,
        extract,
      }),
    ).rejects.toThrow(/HTTP 502/);
    expect(extract).not.toHaveBeenCalled();
    expect(existsSync(targetDir)).toBe(false);
  });

  it("refuses an archive that carries no bun binary", async () => {
    await expect(
      installBun({
        targetDir: join(scratch(), "bin"),
        workDir: scratch(),
        fetchImpl: (async () => new Response(new Uint8Array([1]))) as typeof fetch,
        extract: async () => undefined,
      }),
    ).rejects.toThrow(/contained no bun binary/);
  });
});
