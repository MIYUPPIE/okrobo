import { useEffect, useState } from "react";
import type { CompetitionDef } from "./competitionDef";
import { bundledCompetitions } from "./bundledCompetitions";
import { listPackCompetitions, type PackCompetitions } from "./packCompetitions";
import { getBestScore } from "./runHistory";

// Compete mode's own competition picker (Competition Arena C2), mirroring
// apps/studio/src/builder/TemplateDialog.tsx's own shape exactly -- same
// "bundled section + installed-pack section" split, same async-load
// posture (loading is two IPC round-trips per installed pack; most packs
// carry none, an expected quiet empty state, not an error).
//
// Competition run history: each row also shows its own best score, when
// one's been recorded -- a plain synchronous localStorage read
// (runHistory.ts), no loading state needed unlike the pack sections.

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
            {bundled.map((competition) => {
              const made = competition.make();
              const best = getBestScore(made.id);
              return (
                <li key={competition.file}>
                  <button className="project-row template-row" onClick={() => onPick(made)}>
                    <span className="project-name">{competition.label}</span>
                    <span className="template-description">{made.description ?? ""}</span>
                    {best !== null && <span className="template-description template-best-score">Best: {best}</span>}
                  </button>
                </li>
              );
            })}
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
              competitions.map((competition, index) => {
                const made = competition.make();
                const best = getBestScore(made.id);
                return (
                  <li key={`${pack.id}:${index}`}>
                    <button className="project-row template-row" onClick={() => onPick(made)}>
                      <span className="project-name">{competition.label}</span>
                      <span className="template-description">from {pack.name}</span>
                      {best !== null && <span className="template-description template-best-score">Best: {best}</span>}
                    </button>
                  </li>
                );
              }),
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
