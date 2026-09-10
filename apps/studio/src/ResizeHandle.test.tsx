// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResizeHandle } from "./ResizeHandle";

const CSS_VAR = "--test-panel-size";
const STORAGE_KEY = "okrobo:test:panel-size";

// localStorage here is the global test-wide polyfill installed by
// testSetup.ts (this repo's Node+vitest+jsdom combination doesn't provide
// a working one natively -- see that file's own comment), cleared fresh
// before every test automatically.
afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty(CSS_VAR);
});

function currentSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(CSS_VAR));
}

describe("ResizeHandle", () => {
  it("leaves the CSS var unset when nothing is saved -- the grid's own var(--x, <css-default>) fallback applies, staying responsive to window size until a student actually drags something", () => {
    render(<ResizeHandle cssVar={CSS_VAR} storageKey={STORAGE_KEY} grow="up" min={100} max={600} default={220} label="Resize the code panel" />);
    expect(Number.isNaN(currentSize())).toBe(true);
  });

  it("reads a previously-saved size from localStorage on mount, clamped to min/max", () => {
    localStorage.setItem(STORAGE_KEY, "350");
    render(<ResizeHandle cssVar={CSS_VAR} storageKey={STORAGE_KEY} grow="up" min={100} max={600} default={220} label="Resize the code panel" />);
    expect(currentSize()).toBe(350);
  });

  it("a saved size outside min/max is clamped, not applied verbatim", () => {
    localStorage.setItem(STORAGE_KEY, "9999");
    render(<ResizeHandle cssVar={CSS_VAR} storageKey={STORAGE_KEY} grow="up" min={100} max={600} default={220} label="Resize the code panel" />);
    expect(currentSize()).toBe(600);
  });

  it("dragging toward 'up' grows the panel, and the final size persists to localStorage", () => {
    render(<ResizeHandle cssVar={CSS_VAR} storageKey={STORAGE_KEY} grow="up" min={100} max={600} default={220} label="Resize the code panel" />);
    const handle = screen.getByRole("separator", { name: "Resize the code panel" });

    fireEvent.pointerDown(handle, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 400 }); // moved up 100px -> panel grows by 100
    fireEvent.pointerUp(window, { clientY: 400 });

    expect(currentSize()).toBe(320);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("320");
  });

  it("dragging toward 'right' grows a right-growing panel (e.g. a sidebar)", () => {
    render(<ResizeHandle cssVar={CSS_VAR} storageKey={STORAGE_KEY} grow="right" min={120} max={400} default={180} label="Resize the sidebar" />);
    const handle = screen.getByRole("separator", { name: "Resize the sidebar" });

    fireEvent.pointerDown(handle, { clientX: 180 });
    fireEvent.pointerMove(window, { clientX: 230 }); // moved right 50px -> grows by 50
    fireEvent.pointerUp(window, { clientX: 230 });

    expect(currentSize()).toBe(230);
  });

  it("dragging past min/max clamps instead of exceeding it", () => {
    render(<ResizeHandle cssVar={CSS_VAR} storageKey={STORAGE_KEY} grow="up" min={100} max={600} default={220} label="Resize the code panel" />);
    const handle = screen.getByRole("separator", { name: "Resize the code panel" });

    fireEvent.pointerDown(handle, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: -10000 }); // a huge drag up
    fireEvent.pointerUp(window, { clientY: -10000 });

    expect(currentSize()).toBe(600);
  });

  it("arrow keys nudge the size and persist, for keyboard-only use", () => {
    render(<ResizeHandle cssVar={CSS_VAR} storageKey={STORAGE_KEY} grow="up" min={100} max={600} default={220} label="Resize the code panel" />);
    const handle = screen.getByRole("separator", { name: "Resize the code panel" });

    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(currentSize()).toBe(236); // up grows a "grow: up" handle
    expect(localStorage.getItem(STORAGE_KEY)).toBe("236");

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(currentSize()).toBe(220);
  });

  it("has a real accessible role and orientation for a separator", () => {
    render(<ResizeHandle cssVar={CSS_VAR} storageKey={STORAGE_KEY} grow="right" min={100} max={600} default={220} label="Resize the sidebar" />);
    const handle = screen.getByRole("separator", { name: "Resize the sidebar" });
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
  });
});
