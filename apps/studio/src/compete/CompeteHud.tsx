import type { CompetitionDef, Objective } from "./competitionDef";
import type { CompetitionRunState } from "./score";

// Compete mode's own live scoreboard (Competition Arena C2) -- a
// CSS-positioned overlay rendered as a sibling inside <main
// className="viewport">, alongside the unchanged Viewport3D. Read-only:
// this only ever reflects `run`, it never mutates anything.

function objectiveLabel(objective: Objective): string {
  switch (objective.type) {
    case "reach_zone":
      return `Reach the zone (+${objective.points})`;
    case "avoid_obstacle_collision":
      return `Avoid obstacles (-${objective.penaltyPerHit}/hit)`;
    case "time_limit":
      return `Time limit (${objective.seconds}s)`;
  }
}

function timeLimitObjective(def: CompetitionDef): Extract<Objective, { type: "time_limit" }> | undefined {
  return def.objectives.find((o): o is Extract<Objective, { type: "time_limit" }> => o.type === "time_limit");
}

export function CompeteHud({ competition, run }: { competition: CompetitionDef; run: CompetitionRunState }) {
  const timeLimit = timeLimitObjective(competition);
  const remaining = timeLimit ? Math.max(0, timeLimit.seconds - run.elapsedSeconds) : null;

  return (
    <div className="compete-hud">
      <h4>{competition.name}</h4>
      <div className="compete-hud-row">
        <span>Score</span>
        <span className="compete-hud-score">{run.totalScore}</span>
      </div>
      <div className="compete-hud-row">
        <span>Time</span>
        <span>{remaining !== null ? `${remaining.toFixed(1)}s left` : `${run.elapsedSeconds.toFixed(1)}s`}</span>
      </div>
      <ul className="compete-hud-objectives">
        {run.outcomes.map((outcome) => (
          <li key={outcome.index} className={outcome.achieved || outcome.hits > 0 ? "compete-objective active" : "compete-objective"}>
            <span>{objectiveLabel(outcome.objective)}</span>
            <span>
              {outcome.objective.type === "avoid_obstacle_collision"
                ? `${outcome.hits} hit${outcome.hits === 1 ? "" : "s"}`
                : outcome.achieved
                  ? "✓"
                  : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
