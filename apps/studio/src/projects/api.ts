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
}

export const listProjects = () => invoke<ProjectMeta[]>("list_projects");

export const createProject = (name: string, payload: ProjectPayload) =>
  invoke<ProjectMeta>("create_project", { name, payload });

export const saveProject = (id: string, payload: ProjectPayload) =>
  invoke<ProjectMeta>("save_project", { id, payload });

export const loadProject = (id: string) =>
  invoke<[ProjectMeta, ProjectPayload]>("load_project", { id });

export const deleteProject = (id: string) => invoke<void>("delete_project", { id });
