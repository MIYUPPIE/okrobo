import { useState } from "react";
import type { ProjectMeta } from "./projects/api";

// Project dialogs, kept out of App so they can be exercised on their own:
// naming a new project, and picking or deleting an existing one.

export function NameDialog({
  title,
  onSubmit,
  onCancel,
}: {
  title: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <h3>{title}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
        />
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

export function OpenDialog({
  projects,
  onOpen,
  onDelete,
  onCancel,
}: {
  projects: ProjectMeta[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Open project</h3>
        {projects.length === 0 && <p className="dialog-empty">No saved projects yet.</p>}
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button className="project-row" onClick={() => onOpen(p.id)}>
                <span className="project-name">{p.name}</span>
                <span className="project-date">
                  {new Date(p.updated_at * 1000).toLocaleString()}
                </span>
              </button>
              {confirmingDelete === p.id ? (
                <button className="delete-btn confirm" onClick={() => onDelete(p.id)}>
                  delete?
                </button>
              ) : (
                <button
                  className="delete-btn"
                  title="Delete project"
                  onClick={() => setConfirmingDelete(p.id)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button onClick={onCancel}>Close</button>
        </div>
      </div>
    </div>
  );
}
