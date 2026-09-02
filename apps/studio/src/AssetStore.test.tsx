// @vitest-environment jsdom
// The Asset Store decides whether a downloaded pack gets installed, so its
// trust flow is the security-relevant path in the UI. These tests drive the
// real component with a mocked shell and a mocked pack source.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => true,
}));

import { AssetStore } from "./AssetStore";

const SIGNED = {
  id: "robotics",
  name: "Robotics Pack",
  version: "1.0.0",
  size_bytes: 2_000_000,
  sha256: "a".repeat(64),
  signature: "b".repeat(128),
  key_id: "c".repeat(16),
  contents: { worlds: [], robots: [], lessons: [] },
  url: "robotics-1.0.0.tar.gz",
};

const UNSIGNED = { ...SIGNED, id: "homemade", name: "Homemade Pack" };
delete (UNSIGNED as Record<string, unknown>).signature;
delete (UNSIGNED as Record<string, unknown>).key_id;

/** Serve an index from the first source the store tries. */
function mockSource(packs: unknown[], archive = new Uint8Array([1, 2, 3])) {
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = String(input);
    if (url.endsWith("index.json")) {
      return { ok: true, status: 200, json: async () => ({ packs }) } as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => archive.buffer,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Answers for the shell commands the store calls. Deliberately never rejects
 * for a command it doesn't recognize (returns null instead): rejecting inside
 * a React effect can surface as a delayed, hard-to-attribute test failure
 * from React's async error handling rather than a clean assertion, so
 * correctness here is checked with explicit `toHaveBeenCalledWith` assertions
 * instead of "throw on anything unexpected".
 */
function mockShell({ trust = "verified", installed = [] as unknown[] } = {}) {
  invoke.mockImplementation(async (command: string) => {
    if (command === "list_packs") return installed;
    if (command === "check_pack_signature") return trust;
    if (command === "install_pack") return { id: "robotics", name: "Robotics Pack", version: "1.0.0" };
    if (command === "uninstall_pack") return null;
    return null;
  });
}

beforeEach(() => invoke.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AssetStore trust flow", () => {
  it("installs a verified pack without asking", async () => {
    mockSource([SIGNED]);
    mockShell({ trust: "verified" });
    const user = userEvent.setup();
    render(<AssetStore onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /download/i }));

    await waitFor(() =>
      expect(invoke.mock.calls.some(([c]) => c === "install_pack")).toBe(true),
    );
    // No confirmation was needed for a trusted publisher.
    expect(screen.queryByRole("button", { name: /install anyway/i })).toBeNull();
    expect(await screen.findByText(/works offline now/i)).toBeTruthy();
  });

  it("asks before installing an unsigned pack, and does not install on cancel", async () => {
    mockSource([UNSIGNED]);
    mockShell({ trust: "unsigned" });
    const user = userEvent.setup();
    render(<AssetStore onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /download/i }));

    const prompt = await screen.findByText(/is not signed/i);
    expect(prompt).toBeTruthy();
    // Nothing installed yet: the user has not agreed.
    expect(invoke.mock.calls.some(([c]) => c === "install_pack")).toBe(false);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(invoke.mock.calls.some(([c]) => c === "install_pack")).toBe(false);
    expect(screen.queryByText(/is not signed/i)).toBeNull();
  });

  it("installs an unsigned pack only after an explicit confirmation", async () => {
    mockSource([UNSIGNED]);
    mockShell({ trust: "unsigned" });
    const user = userEvent.setup();
    render(<AssetStore onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /download/i }));
    await user.click(await screen.findByRole("button", { name: /install anyway/i }));

    await waitFor(() =>
      expect(invoke.mock.calls.some(([c]) => c === "install_pack")).toBe(true),
    );
  });

  it("names the pack in the confirmation so the user knows what they are trusting", async () => {
    mockSource([UNSIGNED]);
    mockShell({ trust: "unsigned" });
    const user = userEvent.setup();
    render(<AssetStore onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /download/i }));
    const prompt = await screen.findByText(/is not signed/i);
    expect(prompt.textContent).toContain("Homemade Pack");
  });

  it("warns differently for an unknown publisher than for no signature", async () => {
    mockSource([SIGNED]);
    mockShell({ trust: "unknown_key" });
    const user = userEvent.setup();
    render(<AssetStore onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /download/i }));
    expect(await screen.findByText(/publisher this studio does not know/i)).toBeTruthy();
  });

  it("refuses a tampered pack outright, with no way to override", async () => {
    mockSource([SIGNED]);
    mockShell({ trust: "invalid" });
    const user = userEvent.setup();
    render(<AssetStore onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /download/i }));

    expect(await screen.findByText(/signature does not match/i)).toBeTruthy();
    // No confirmation offered: this is not a judgement call for the user.
    expect(screen.queryByRole("button", { name: /install anyway/i })).toBeNull();
    expect(invoke.mock.calls.some(([c]) => c === "install_pack")).toBe(false);
  });
});

describe("AssetStore listing", () => {
  it("labels packs as signed or unsigned before you choose", async () => {
    mockSource([SIGNED, UNSIGNED]);
    mockShell();
    render(<AssetStore onClose={() => {}} />);

    expect(await screen.findByText(/Robotics Pack/)).toBeTruthy();
    const rows = screen.getAllByText(/v1\.0\.0/);
    expect(rows.some((r) => r.textContent?.includes("· signed"))).toBe(true);
    expect(rows.some((r) => r.textContent?.includes("· unsigned"))).toBe(true);
  });

  it("shows an installed pack as installed and protects the core pack", async () => {
    const core = { ...SIGNED, id: "core", name: "Core Pack" };
    mockSource([core]);
    mockShell({ installed: [{ id: "core", name: "Core Pack", version: "1.0.0" }] });
    render(<AssetStore onClose={() => {}} />);

    expect(await screen.findByText("installed")).toBeTruthy();
    // The core pack ships with the app, so removing it is not offered.
    const remove = screen.getByTitle(/cannot be removed/i);
    expect(remove).toBeDisabled();
  });

  it("offers an upgrade when a newer version is published", async () => {
    mockSource([{ ...SIGNED, version: "2.0.0" }]);
    mockShell({ installed: [{ id: "robotics", name: "Robotics Pack", version: "1.0.0" }] });
    render(<AssetStore onClose={() => {}} />);

    expect(await screen.findByRole("button", { name: /upgrade/i })).toBeTruthy();
  });

  it("reports a source it cannot read instead of failing silently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    mockShell();
    render(<AssetStore onClose={() => {}} />);

    expect(await screen.findByText(/no pack source found/i)).toBeTruthy();
  });
});
