// Typed wrappers over the Tauri shell's project-store commands
// (src-tauri/src/projects.rs). Only callable when running inside the
// desktop app; `inDesktop` gates the File menu.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RobotDef } from "../contracts/robotDef";
import type { WorldDef } from "../lib/validateWorld";

export const inDesktop = isTauri();

export interface ProjectMeta {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface ProjectPayload {
  /** Blockly workspace serialization (opaque here). */
  blocks: unknown;
  python: string;
  python_edited: boolean;
  world: string;
  /** "car" | "arm"; older projects without it load as "car". */
  robot: string;
  /**
   * A full contracts/world/v1 definition, when the student edited the
   * environment (World tab). null means "use the named pack world
   * unmodified" — also what every project saved before the world editor
   * existed round-trips as, via the Rust side's `#[serde(default)]`.
   */
  world_custom: WorldDef | null;
  /**
   * A full contracts/robot-def/v0 definition, when the student built one in
   * Robot Builder mode. null means "no robot-def in this project yet" —
   * also what every project saved before the builder existed round-trips
   * as, via the Rust side's `#[serde(default)]`. Mirrors world_custom.
   */
  robot_def: RobotDef | null;
}

export const listProjects = () => invoke<ProjectMeta[]>("list_projects");

export const createProject = (name: string, payload: ProjectPayload) =>
  invoke<ProjectMeta>("create_project", { name, payload });

export const saveProject = (id: string, payload: ProjectPayload) =>
  invoke<ProjectMeta>("save_project", { id, payload });

export const loadProject = (id: string) =>
  invoke<[ProjectMeta, ProjectPayload]>("load_project", { id });

export const deleteProject = (id: string) => invoke<void>("delete_project", { id });

// --- packs (contracts/pack/v0) ---

export interface InstalledPack {
  id: string;
  name: string;
  version: string;
}

export const listPacks = () => invoke<InstalledPack[]>("list_packs");

/** How far a pack can be trusted (docs/decisions/pack-signing.md). */
export type Trust = "verified" | "unsigned" | "unknown_key" | "invalid";

export const checkPackSignature = (pack: {
  id: string;
  version: string;
  sha256: string;
  size_bytes: number;
  signature?: string;
  key_id?: string;
}) =>
  invoke<Trust>("check_pack_signature", {
    id: pack.id,
    version: pack.version,
    sha256: pack.sha256,
    sizeBytes: pack.size_bytes,
    signature: pack.signature ?? null,
    keyId: pack.key_id ?? null,
  });

/**
 * The shell verifies the digest against the bytes before unpacking, and
 * refuses outright when a signature is present but does not match.
 */
export const installPack = (
  pack: {
    id: string;
    version: string;
    sha256: string;
    size_bytes?: number;
    signature?: string;
    key_id?: string;
  },
  archive: Uint8Array,
) =>
  invoke<InstalledPack>("install_pack", {
    id: pack.id,
    version: pack.version,
    sha256: pack.sha256,
    sizeBytes: pack.size_bytes ?? archive.length,
    signature: pack.signature ?? null,
    keyId: pack.key_id ?? null,
    archive: Array.from(archive),
  });

export const uninstallPack = (id: string) => invoke<void>("uninstall_pack", { id });
