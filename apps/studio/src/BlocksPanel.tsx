import { useEffect, useImperativeHandle, useRef } from "react";
import * as Blockly from "blockly";
import {
  generateCpp,
  generateJavaScript,
  generatePython,
  type RobotKind,
  starterWorkspace,
  toolboxFor,
} from "./blocks/okroboBlocks";

export interface BlocksPanelHandle {
  /** Serialize the workspace (Blockly serialization JSON). */
  save(): object;
  /** Replace the workspace content; pass null for the starter program. */
  load(state: object | null): void;
  /** Undo the last workspace edit (no-op if there is nothing to undo). */
  undo(): void;
  /** Redo the last undone edit (no-op if there is nothing to redo). */
  redo(): void;
  /** Arrange top-level blocks into a tidy vertical column. */
  cleanUp(): void;
}

const darkTheme = Blockly.Theme.defineTheme("okrobo-dark", {
  name: "okrobo-dark",
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: "#1e2128",
    flyoutBackgroundColour: "#23262e",
    flyoutOpacity: 1,
    scrollbarColour: "#3a3f4c",
    insertionMarkerColour: "#d7dae2",
  },
});

export interface BlocksPanelProps {
  /** Which robot's blocks and starter program to use. Remount (key) to switch. */
  robot: RobotKind;
  /** Called with regenerated (javascript, python, cpp) after every real edit.
   * cpp is "" for the Arm and Drone, which have no C++ SDK yet
   * (engine/api/README.md). */
  onCode: (js: string, python: string, cpp: string) => void;
  /**
   * Seeds a freshly-mounted instance (a robot switch from a lesson's "Try
   * this" or an opened project), instead of the starter workspace. Read only
   * at mount: a parent effect calling `ref.load(...)` after this panel has
   * already mounted races against React StrictMode's dev-mode double-invoke
   * of effects (mount -> cleanup -> mount again), which disposes and
   * recreates the Blockly workspace right after such a call and silently
   * drops it. Seeding through a prop at construction time is immune to that,
   * because both StrictMode passes replay the same render's closure.
   */
  initialWorkspace?: object | null;
  /** Called once `initialWorkspace` has been applied, so the parent can clear
   * it — otherwise a later, unrelated remount would reapply stale content. */
  onWorkspaceConsumed?: () => void;
  ref?: React.Ref<BlocksPanelHandle>;
}

export function BlocksPanel({ robot, onCode, initialWorkspace, onWorkspaceConsumed, ref }: BlocksPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useImperativeHandle(
    ref,
    () => ({
      save: () => {
        const workspace = workspaceRef.current;
        return workspace ? Blockly.serialization.workspaces.save(workspace) : {};
      },
      load: (state) => {
        const workspace = workspaceRef.current;
        if (!workspace) return;
        Blockly.serialization.workspaces.load(state ?? starterWorkspace(robot), workspace);
      },
      undo: () => workspaceRef.current?.undo(false),
      redo: () => workspaceRef.current?.undo(true),
      cleanUp: () => workspaceRef.current?.cleanUp(),
    }),
    [robot],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const workspace = Blockly.inject(container, {
      toolbox: toolboxFor(robot),
      theme: darkTheme,
      media: "/blockly-media/",
      sounds: false,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: false, startScale: 0.9 },
    });
    workspaceRef.current = workspace;
    Blockly.serialization.workspaces.load(initialWorkspace ?? starterWorkspace(robot), workspace);
    if (initialWorkspace !== undefined) onWorkspaceConsumed?.();

    const regenerate = () => {
      onCodeRef.current(
        generateJavaScript(workspace),
        generatePython(workspace, robot),
        robot === "car" ? generateCpp(workspace) : "",
      );
    };
    regenerate();
    workspace.addChangeListener((event) => {
      if (event.isUiEvent || workspace.isDragging()) return;
      regenerate();
    });

    const observer = new ResizeObserver(() => Blockly.svgResize(workspace));
    observer.observe(container);

    return () => {
      observer.disconnect();
      workspaceRef.current = null;
      workspace.dispose();
    };
    // initialWorkspace/onWorkspaceConsumed are deliberately excluded: they
    // are a one-time seed for this mount, like useState's initial value, not
    // something later changes should re-apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot]);

  return <div ref={containerRef} className="blocks-editor" />;
}
