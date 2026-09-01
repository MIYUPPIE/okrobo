// Fixed-timestep accumulator for the render loop: real frame time in,
// a whole number of simulation steps out. Deterministic and frame-rate
// independent; capped so a stalled tab cannot cause a catch-up spiral.

export interface StepPlan {
  /** simulation steps to run this frame */
  steps: number;
  /** leftover real time to carry into the next frame */
  accumulator: number;
}

export function planSteps(
  accumulator: number,
  elapsed: number,
  dt: number,
  maxSteps: number,
): StepPlan {
  const total = accumulator + elapsed;
  const steps = Math.floor(total / dt);
  if (steps > maxSteps) {
    // Too far behind (tab was hidden, machine stalled): run the cap and drop
    // the backlog instead of freezing the UI trying to catch up.
    return { steps: maxSteps, accumulator: 0 };
  }
  return { steps, accumulator: total - steps * dt };
}
