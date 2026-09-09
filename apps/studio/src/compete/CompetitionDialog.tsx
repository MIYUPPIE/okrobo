import { useEffect, useState } from "react";
import type { CompetitionDef } from "./competitionDef";
import { bundledCompetitions } from "./bundledCompetitions";
import { listPackCompetitions, type PackCompetitions } from "./packCompetitions";

// Compete mode's own competition picker (Competition Arena C2), mirroring
// apps/studio/src/builder/TemplateDialog.tsx's own shape exactly -- same
// "bundled section + installed-pack section" split, same async-load
// posture (loading is two IPC round-trips per installed pack; most packs
// carry none, an expected quiet empty state, not an error).

export function CompetitionDialog({ onPick, onCancel }: { onPick: (competition: CompetitionDef) => void; onCancel: () => void }) {
  const [packCompetitions, setPackCompetitions] = useState<PackCompetitions[] | null>(null);
  const bundled = bundledCompetitions();

  useEffect(() => {
    let cancelled = false;
    listPackCompetitions()
      .then((result) => {
        if (!cancelled) setPackCompetitions(result);
      })
      .catch(() => {
        if (!cancelled) setPackCompetitions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Choose a competition</h3>
        {bundled.length === 0 ? (
          <p className="dialog-empty">No bundled competitions yet.</p>
        ) : (
          <ul className="project-list">
            {bundled.map((competition) => (
              <li key={competition.file}>
                <button className="project-row template-row" onClick={() => onPick(competition.make())}>
                  <span className="project-name">{competition.label}</span>
                  <span className="template-description">{competition.make().description ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <h4 className="template-section-header">From your packs</h4>
        {packCompetitions === null ? (
          <p className="dialog-empty">Loading…</p>
        ) : packCompetitions.length === 0 ? (
          <p className="dialog-empty">No installed packs carry a competition yet.</p>
        ) : (
          <ul className="project-list">
            {packCompetitions.map(({ pack, competitions }) =>
              competitions.map((competition, index) => (
                <li key={`${pack.id}:${index}`}>
                  <button className="project-row template-row" onClick={() => onPick(competition.make())}>
                    <span className="project-name">{competition.label}</span>
                    <span className="template-description">from {pack.name}</span>
                  </button>
                </li>
              )),
            )}
          </ul>
        )}

        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
