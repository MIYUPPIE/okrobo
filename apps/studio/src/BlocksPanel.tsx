import { useEffect, useImperativeHandle, useRef } from "react";
import * as Blockly from "blockly";
import {
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
  /** Called with regenerated (javascript, python) after every real edit. */
  onCode: (js: string, python: string) => void;
  ref?: React.Ref<BlocksPanelHandle>;
}

export function BlocksPanel({ robot, onCode, ref }: BlocksPanelProps) {
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
    Blockly.serialization.workspaces.load(starterWorkspace(robot), workspace);

    const regenerate = () => {
      onCodeRef.current(generateJavaScript(workspace), generatePython(workspace, robot));
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
  }, [robot]);

  return <div ref={containerRef} className="blocks-editor" />;
}
