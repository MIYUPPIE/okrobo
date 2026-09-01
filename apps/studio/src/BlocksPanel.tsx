import { useEffect, useRef } from "react";
import * as Blockly from "blockly";
import {
  generateJavaScript,
  generatePython,
  STARTER_WORKSPACE,
  TOOLBOX,
} from "./blocks/okroboBlocks";

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
  /** Called with regenerated (javascript, python) after every real edit. */
  onCode: (js: string, python: string) => void;
}

export function BlocksPanel({ onCode }: BlocksPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const workspace = Blockly.inject(container, {
      toolbox: TOOLBOX,
      theme: darkTheme,
      media: "/blockly-media/",
      sounds: false,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: false, startScale: 0.9 },
    });
    Blockly.serialization.workspaces.load(STARTER_WORKSPACE, workspace);

    const regenerate = () => {
      onCodeRef.current(generateJavaScript(workspace), generatePython(workspace));
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
      workspace.dispose();
    };
  }, []);

  return <div ref={containerRef} className="blocks-editor" />;
}
