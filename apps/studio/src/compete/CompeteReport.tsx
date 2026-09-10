import type { CompetitionDef, Objective } from "./competitionDef";
import type { CompetitionRunState, FinishReason } from "./score";

// Compete mode's own end-of-run report (Competition Arena C2) -- shown
// once `run.finished`, as an overlay on top of CompeteHud inside the same
// <main className="viewport"> area.

function objectiveLabel(objective: Objective): string {
  switch (objective.type) {
    case "reach_zone":
      return objective.label ?? "Reach the zone";
    case "avoid_obstacle_collision":
      return "Avoid obstacles";
    case "time_limit":
      return "Time limit";
  }
}

function reasonLabel(reason: FinishReason | null): string {
  switch (reason) {
    case "time_up":
      return "Time ran out";
    case "stopped":
      return "Stopped";
    case "program_ended":
      return "Program finished";
    default:
      return "Finished";
  }
}

/** Computed by App.tsx (the only place that knows the exact moment a run
 * finished and reads runHistory.ts) -- this component stays read-only
 * against its own props, same posture as every other field here. */
export interface BestScoreInfo {
  previousBest: number | null;
  isNewBest: boolean;
}

export interface CompeteReportProps {
  competition: CompetitionDef;
  run: CompetitionRunState;
  bestScore?: BestScoreInfo;
  onRunAgain: () => void;
  onChooseAnother: () => void;
}

export function CompeteReport({ competition, run, bestScore, onRunAgain, onChooseAnother }: CompeteReportProps) {
  return (
    <div className="compete-report">
      <h3>{competition.name} -- {reasonLabel(run.finishReason)}</h3>
      <table className="compete-report-table">
        <thead>
          <tr>
            <th>Objective</th>
            <th>Result</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          {run.outcomes.map((outcome) => (
            <tr key={outcome.index}>
              <td>{objectiveLabel(outcome.objective)}</td>
              <td>
                {outcome.objective.type === "avoid_obstacle_collision"
                  ? `${outcome.hits} hit${outcome.hits === 1 ? "" : "s"}`
                  : outcome.achieved
                    ? "achieved"
                    : "not achieved"}
              </td>
              <td>{outcome.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="compete-report-total">
        Total score: <strong>{run.totalScore}</strong> · Time: {run.elapsedSeconds.toFixed(1)}s
      </p>
      {bestScore?.isNewBest && <p className="compete-report-best new-best">🎉 New best!</p>}
      {bestScore && !bestScore.isNewBest && bestScore.previousBest !== null && (
        <p className="compete-report-best">Best: {bestScore.previousBest}</p>
      )}
      <div className="dialog-actions">
        <button onClick={onRunAgain}>Run again</button>
        <button onClick={onChooseAnother}>Choose another competition</button>
      </div>
    </div>
  );
}
