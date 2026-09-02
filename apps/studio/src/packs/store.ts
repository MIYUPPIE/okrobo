// Asset store client (contracts/pack/v0). A source is any static directory
// serving index.json plus archives: a school server on the LAN, a USB stick
// served locally, or the internet. The studio prefers a school server when it
// finds one, because a class of 30 should download a pack once over the LAN.

import { type PackManifest, validateIndex } from "./manifest";

/** Candidate school-server addresses, tried in order before the internet. */
export const DEFAULT_SOURCES = [
  "http://localhost:8480/",
  "http://school-server:8480/",
  "http://school-server.local:8480/",
];

export interface StoreSource {
  url: string;
  packs: PackManifest[];
}

function absolute(base: string, url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

/** Fetch and validate a source's index; archive urls come back absolute. */
export async function fetchIndex(baseUrl: string, timeoutMs = 4000): Promise<StoreSource> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("index.json", base), { signal: controller.signal });
    if (!response.ok) throw new Error(`${base}: HTTP ${response.status}`);
    const packs = validateIndex(await response.json());
    return {
      url: base,
      packs: packs.map((pack) => ({ ...pack, url: absolute(base, pack.url) })),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find the first reachable source. Sources are tried in order, so a school
 * server on the LAN wins over anything later in the list; when none answers
 * the studio simply stays offline, which is not an error.
 */
export async function discoverSource(
  sources: string[] = DEFAULT_SOURCES,
  timeoutMs = 4000,
): Promise<StoreSource | null> {
  for (const source of sources) {
    try {
      return await fetchIndex(source, timeoutMs);
    } catch {
      // Unreachable or invalid: try the next one.
    }
  }
  return null;
}

export interface StoreEntry {
  manifest: PackManifest;
  installedVersion?: string;
  state: "installed" | "upgradable" | "available";
}

/** Merge a source's catalogue with what is already installed. */
export function catalogue(
  available: PackManifest[],
  installed: Array<{ id: string; version: string }>,
): StoreEntry[] {
  const byId = new Map(installed.map((pack) => [pack.id, pack.version]));
  return available.map((manifest) => {
    const installedVersion = byId.get(manifest.id);
    if (!installedVersion) return { manifest, state: "available" as const };
    const state = compare(manifest.version, installedVersion) > 0 ? "upgradable" : "installed";
    return { manifest, installedVersion, state };
  });
}

function compare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
