import { useEffect, useRef } from "react";

// A thin draggable bar between two CSS Grid tracks, letting a student
// resize a panel by hand instead of living with whatever fixed pixel size
// the layout happened to ship with. Writes directly to a CSS custom
// property on <html> (not React state) so dragging is smooth and doesn't
// re-render the whole app on every pointermove -- the grid tracks that
// read `var(--foo, <default>)` pick the new value up immediately, the
// same way a browser's own native panel splitters work. The chosen size
// is persisted to localStorage (a per-viewer UI preference, not app data
// -- no injectable-store ceremony needed here, unlike projects/webStore.ts/
// compete/runHistory.ts, which persist real data another viewer or a
// later session needs to read back exactly).
//
// Added after a real usability report traced a cramped, non-resizable
// code panel to making an already-fiddly Blockly interaction (the
// controls_if mutator popup) much worse -- see
// docs/decisions/blocks-editor-usability.md.

export interface ResizeHandleProps {
  /** Which CSS custom property (set on document.documentElement) this
   * handle drives -- the grid track's own size expression should read
   * `var(<cssVar>, <default>)`. */
  cssVar: string;
  storageKey: string;
  /** Dragging the handle toward this edge of the resized panel grows it
   * (e.g. a bottom-row code panel's handle sits on its own top edge, so
   * dragging "up" grows it; a right-hand sidebar's handle sits on its own
   * right edge, so dragging "right" grows it). Also determines whether
   * this renders as a horizontal (up/down) or vertical (left/right) bar. */
  grow: "up" | "down" | "left" | "right";
  min: number;
  max: number;
  default: number;
  /** Accessible label, e.g. "Resize the code panel". */
  label: string;
  /** Extra class(es) -- callers use this to assign the handle its own
   * CSS Grid area (a dedicated thin gutter track between the two panels
   * it resizes), since that varies per call site. */
  className?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function ResizeHandle({ cssVar, storageKey, grow, min, max, default: defaultSize, label, className }: ResizeHandleProps) {
  const axis: "row" | "column" = grow === "up" || grow === "down" ? "row" : "column";
  const sign = grow === "up" || grow === "left" ? -1 : 1;
  const draggingRef = useRef(false);

  // Only ever writes the CSS var when a real saved preference exists.
  // Before that, the grid's own `var(--x, <css-default>)` expression
  // supplies the size -- for the code panel that default is a real `vh`
  // unit, so it stays genuinely responsive to the window's own size
  // (recalculated by the browser on every resize, no JS involved) right
  // up until a student actually drags something, matching the "the code
  // environment should be responsive" half of the report this responds
  // to, not just "adjustable."
  useEffect(() => {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved > 0) {
      document.documentElement.style.setProperty(cssVar, `${clamp(saved, min, max)}px`);
    }
  }, [cssVar, storageKey, min, max]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    const startPos = axis === "row" ? e.clientY : e.clientX;
    const current = getComputedStyle(document.documentElement).getPropertyValue(cssVar);
    const startSize = Number.parseFloat(current) || defaultSize;

    const onMove = (moveEvent: PointerEvent) => {
      if (!draggingRef.current) return;
      const pos = axis === "row" ? moveEvent.clientY : moveEvent.clientX;
      const next = clamp(startSize + sign * (pos - startPos), min, max);
      document.documentElement.style.setProperty(cssVar, `${next}px`);
    };
    const onUp = () => {
      draggingRef.current = false;
      const finalValue = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar));
      if (Number.isFinite(finalValue)) localStorage.setItem(storageKey, String(finalValue));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 16;
    const keyDirection: Record<string, "up" | "down" | "left" | "right"> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const pressed = keyDirection[e.key];
    if (!pressed) return;
    const opposite: Record<typeof grow, typeof grow> = { up: "down", down: "up", left: "right", right: "left" };
    const delta = pressed === grow ? step : pressed === opposite[grow] ? -step : 0;
    if (delta === 0) return; // the perpendicular axis's own arrow keys don't apply to this handle
    e.preventDefault();
    const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || defaultSize;
    const next = clamp(current + delta, min, max);
    document.documentElement.style.setProperty(cssVar, `${next}px`);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <div
      className={`resize-handle resize-handle-${axis}${className ? ` ${className}` : ""}`}
      role="separator"
      aria-orientation={axis === "row" ? "horizontal" : "vertical"}
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
