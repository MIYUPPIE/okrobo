# Decision: top nav bar (titlebar) responsiveness on narrow windows

**Date:** 2026-09-10

## Scope

Direct follow-up question after the kid-usable-Blocks pass ([blocks-editor-usability.md](blocks-editor-usability.md)): "how about the interface color and the nav bar responsiveness." Color was already done in that pass. The top titlebar — app name, File/Edit/Robot/Simulation/Help menus, the Simulate/Build/Compete mode toggle, and the project-name chip — had not been touched.

## The bug, confirmed with a real narrow window before assuming anything

`.titlebar` was a plain flex row (`display: flex; gap: 20px`) with no `flex-wrap` handling, no `overflow` handling, and children left at their default `flex-shrink: 1` with no `white-space: nowrap`. A real headless-Chrome screenshot at a 550px-wide window (a small laptop or a split-screen scenario, not an edge case) showed "OKHUB Robotics Studio" wrapping to 3 lines. That blew out the row's fixed 40px height and pushed the mode toggle (Simulate/Build/Compete — Build and Compete became fully inaccessible) and the project-name chip off the visible window edge, with no way to reach them at all.

## The fix: hold the row, then buy back space, then scroll only as a last resort

Two layers, applied in the order a user actually hits them:

1. **Never wrap, never break the row.** `white-space: nowrap` and `flex-shrink: 0` on every child (`.app-name`, `.menus`, `.menu-item`, `.menu-wrap`, `.project-chip`, `.mode-toggle`, `.mode-toggle button`) — the row height can no longer blow out no matter how narrow the window gets. `overflow-x: auto` on `.titlebar` itself is the safety net underneath that: if the window is genuinely too narrow for everything to fit even after step 2, the row scrolls sideways instead of silently losing access to Build/Compete or the project name the way it did before.

2. **Buy the space back directly, don't just permit scrolling.** A scrollable-but-invisible control is a real discoverability trap for a kid — nothing on screen hints that Build/Compete exist off to the right. A `max-width: 720px` media query swaps the "OKHUB Robotics Studio" wordmark for a short "OKHUB" form (two sibling spans, `.app-name-full`/`.app-name-short`, toggled by `display`; no JS, so it tracks live window resizes for free) and tightens the row's own gap and button padding. Measured directly rather than guessed: at 550px wide this closed the shortfall from 225px down to 11px — at that point every control (all 5 menus, the full 3-way mode toggle, and the project chip) is fully visible with no scroll needed at all; only a hairline 11px of scroll headroom remains as the safety net from step 1.

## A real bug caught while verifying: media query lost the cascade

First version of the media query block landed in the file *right after* `.app-name`, i.e. **before** the base `.menu-item`/`.mode-toggle button` rules that appear later in `App.css`. At equal specificity, CSS resolves ties by source order — a media-query rule earlier in the file loses to a later plain rule with the same specificity, regardless of whether the media condition matches. Confirmed empirically, not assumed: re-ran the narrow-window screenshot after adding padding overrides and got byte-identical layout numbers to the pre-change run, which was the tell. Fixed by moving the whole `@media (max-width: 720px)` block to after `.mode-toggle button.active` — the last of the rules it needs to win against — and re-verified the numbers actually moved (621px → 561px scroll width) before trusting the fix.

## Verification

Real headless-Chrome screenshots at both ends, not just CSS math:

- **550px wide** (before): "OKHUB Robotics Studio" wraps to 3 lines, row height breaks, mode toggle and project chip pushed off-screen.
- **550px wide** (after): "OKHUB" short form, all 5 menus, and the full Simulate/Build/Compete toggle all visible on one line; only `untitled` project chip has a hairline 11px scroll margin (`titlebar.scrollWidth: 561` vs `width: 550`).
- **1280px wide** (unchanged): full "OKHUB Robotics Studio" wordmark, normal spacing, `scrollWidth === width`, no overflow — confirms the narrow-window fix didn't regress the common desktop case.

`npm run test -- --run` (924/924 passing), `npm run typecheck`, `npm run build` all clean. `./scripts/check-studio-e2e.sh` run twice, both fully green (pure CSS/markup change, no new e2e check needed — the existing suite's own coordinate- and text-based clicks against the titlebar's menus and mode toggle already exercise this row on every run). Full `./scripts/test-all.sh` gate suite run before committing.
