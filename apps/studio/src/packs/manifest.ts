// Runtime validation for pack manifests and store indexes
// (contracts/pack/v0). Packs are downloaded content: everything here treats
// them as untrusted data, never as code.

export interface PackContents {
  worlds: string[];
  robots: string[];
  lessons: string[];
  /** contracts/robot-def/v0 documents (Robot Builder Phase 8) -- distinct
   * from `robots` (URDF, the older Car/Arm/Drone kinematic import path). */
  robot_defs: string[];
  /** contracts/world-def/v0 documents (Robot Builder Phase 8) -- distinct
   * from `worlds` (contracts/world/v0, the Car/Drone arena). */
  world_defs: string[];
}

export interface PackManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  requires?: { studio?: string; packs?: string[] };
  size_bytes?: number;
  sha256?: string;
  contents: PackContents;
  /** Where the archive lives; set by the store index, absent for local packs. */
  url?: string;
  /** Ed25519 signature over id|version|sha256|size_bytes (hex). */
  signature?: string;
  /** Id of the key that signed it. */
  key_id?: string;
}

const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SIGNATURE_PATTERN = /^[a-f0-9]{128}$/;
const KEY_ID_PATTERN = /^[a-f0-9]{16}$/;

function stringArray(value: unknown, field: string, packId: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`pack '${packId}': ${field} must be an array of strings`);
  }
  // Reject path escapes: pack files must stay inside the pack.
  for (const entry of value as string[]) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error(`pack '${packId}': unsafe path in ${field}: ${entry}`);
    }
  }
  return value as string[];
}

export function validateManifest(data: unknown): PackManifest {
  if (typeof data !== "object" || data === null) throw new Error("pack: manifest is not an object");
  const d = data as Record<string, unknown>;

  const id = d.id;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error(`pack: invalid id ${JSON.stringify(id)}`);
  }
  if (typeof d.name !== "string" || d.name.length === 0) {
    throw new Error(`pack '${id}': missing name`);
  }
  if (typeof d.version !== "string" || !VERSION_PATTERN.test(d.version)) {
    throw new Error(`pack '${id}': version must be major.minor.patch`);
  }
  if (d.sha256 !== undefined && (typeof d.sha256 !== "string" || !SHA256_PATTERN.test(d.sha256))) {
    throw new Error(`pack '${id}': sha256 must be 64 hex characters`);
  }
  if (
    d.size_bytes !== undefined &&
    (typeof d.size_bytes !== "number" || !Number.isFinite(d.size_bytes) || d.size_bytes < 0)
  ) {
    throw new Error(`pack '${id}': size_bytes must be a non-negative number`);
  }

  if (
    d.signature !== undefined &&
    (typeof d.signature !== "string" || !SIGNATURE_PATTERN.test(d.signature))
  ) {
    throw new Error(`pack '${id}': signature must be 128 hex characters`);
  }
  if (d.key_id !== undefined && (typeof d.key_id !== "string" || !KEY_ID_PATTERN.test(d.key_id))) {
    throw new Error(`pack '${id}': key_id must be 16 hex characters`);
  }

  const contents = (d.contents ?? {}) as Record<string, unknown>;
  if (typeof contents !== "object" || contents === null) {
    throw new Error(`pack '${id}': contents must be an object`);
  }

  return {
    id,
    name: d.name,
    description: typeof d.description === "string" ? d.description : undefined,
    version: d.version,
    requires: typeof d.requires === "object" && d.requires !== null
      ? (d.requires as PackManifest["requires"])
      : undefined,
    size_bytes: d.size_bytes as number | undefined,
    sha256: d.sha256 as string | undefined,
    contents: {
      worlds: stringArray(contents.worlds, "contents.worlds", id),
      robots: stringArray(contents.robots, "contents.robots", id),
      lessons: stringArray(contents.lessons, "contents.lessons", id),
      robot_defs: stringArray(contents.robot_defs, "contents.robot_defs", id),
      world_defs: stringArray(contents.world_defs, "contents.world_defs", id),
    },
    url: typeof d.url === "string" ? d.url : undefined,
    signature: d.signature as string | undefined,
    key_id: d.key_id as string | undefined,
  };
}

export function validateIndex(data: unknown): PackManifest[] {
  if (typeof data !== "object" || data === null) throw new Error("store index is not an object");
  const packs = (data as Record<string, unknown>).packs;
  if (!Array.isArray(packs)) throw new Error("store index: 'packs' must be an array");
  const manifests = packs.map(validateManifest);
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) throw new Error(`store index: duplicate pack id '${manifest.id}'`);
    seen.add(manifest.id);
  }
  return manifests;
}

/** Compare semantic versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** An install is allowed only as a first install or a version upgrade. */
export function canInstall(
  candidate: PackManifest,
  installed: PackManifest | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!installed) return { ok: true };
  const order = compareVersions(candidate.version, installed.version);
  if (order > 0) return { ok: true };
  if (order === 0) {
    return { ok: false, reason: `${candidate.id} ${candidate.version} is already installed` };
  }
  return {
    ok: false,
    reason: `${candidate.id} ${candidate.version} is older than the installed ${installed.version}`,
  };
}
