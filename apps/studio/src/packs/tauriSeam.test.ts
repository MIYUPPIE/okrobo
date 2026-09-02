// The seam between the store UI and the desktop shell: the frontend's invoke
// payloads must match the Rust command signatures in src-tauri/src/lib.rs.
// Both sides are unit-tested on their own, so a renamed or reordered
// parameter here is exactly the kind of break nothing else would catch.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type InvokeCall = [command: string, payload?: Record<string, unknown>];

const invoke = vi.fn<(...args: InvokeCall) => Promise<unknown>>(async () => []);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: InvokeCall) => invoke(...args),
  isTauri: () => true,
}));

const LIB_RS = readFileSync(
  join(process.cwd(), "src-tauri", "src", "lib.rs"),
  "utf8",
);

/** Parameter names of a #[tauri::command] fn, minus the injected state. */
function rustCommandParams(name: string): string[] {
  const match = new RegExp(`fn ${name}\\(([^)]*)\\)`, "s").exec(LIB_RS);
  if (!match) throw new Error(`no Rust command named ${name}`);
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(":")[0].trim())
    .filter((param) => !param.startsWith("state"));
}

describe("pack command seam", () => {
  beforeEach(() => invoke.mockClear());

  /** Tauri maps snake_case Rust params to camelCase on the JS side. */
  const camel = (name: string) => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

  it("registers every pack command in the handler", () => {
    for (const command of [
      "list_packs",
      "install_pack",
      "uninstall_pack",
      "check_pack_signature",
    ]) {
      expect(LIB_RS).toMatch(new RegExp(`\\b${command}\\b`));
      expect(rustCommandParams(command)).toBeDefined();
    }
  });

  it("installPack sends exactly the arguments the Rust command declares", async () => {
    const { installPack } = await import("../projects/api");
    await installPack(
      {
        id: "robotics",
        version: "1.0.0",
        sha256: "a".repeat(64),
        size_bytes: 467,
        signature: "b".repeat(128),
        key_id: "c".repeat(16),
      },
      new Uint8Array([1, 2, 3]),
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, payload = {}] = invoke.mock.calls[0];
    expect(command).toBe("install_pack");
    expect(Object.keys(payload).sort()).toEqual(
      rustCommandParams("install_pack").map(camel).sort(),
    );
    // Archives cross the boundary as a plain number array (serde Vec<u8>).
    expect(payload.archive).toEqual([1, 2, 3]);
    expect(payload.sha256).toHaveLength(64);
    expect(payload.signature).toHaveLength(128);
  });

  it("checkPackSignature matches its Rust signature", async () => {
    const { checkPackSignature } = await import("../projects/api");
    await checkPackSignature({
      id: "core",
      version: "1.0.0",
      sha256: "a".repeat(64),
      size_bytes: 2200,
    });

    const [command, payload = {}] = invoke.mock.calls[0];
    expect(command).toBe("check_pack_signature");
    expect(Object.keys(payload).sort()).toEqual(
      rustCommandParams("check_pack_signature").map(camel).sort(),
    );
    // Absent optionals cross as null, which serde reads as None.
    expect(payload.signature).toBeNull();
    expect(payload.keyId).toBeNull();
  });

  it("uninstallPack and listPacks match their Rust signatures", async () => {
    const { listPacks, uninstallPack } = await import("../projects/api");

    await listPacks();
    expect(invoke.mock.calls[0][0]).toBe("list_packs");
    expect(rustCommandParams("list_packs")).toEqual([]);

    invoke.mockClear();
    await uninstallPack("robotics");
    const [command, payload = {}] = invoke.mock.calls[0];
    expect(command).toBe("uninstall_pack");
    expect(Object.keys(payload)).toEqual(rustCommandParams("uninstall_pack"));
  });
});
