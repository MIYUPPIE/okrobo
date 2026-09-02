// Typed wrappers over the Tauri shell's project-store commands
// (src-tauri/src/projects.rs). Only callable when running inside the
// desktop app; `inDesktop` gates the File menu.

import { invoke, isTauri } from "@tauri-apps/api/core";

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

/** The shell verifies `sha256` against the bytes before unpacking anything. */
export const installPack = (id: string, version: string, sha256: string, archive: Uint8Array) =>
  invoke<InstalledPack>("install_pack", { id, version, sha256, archive: Array.from(archive) });

export const uninstallPack = (id: string) => invoke<void>("uninstall_pack", { id });
