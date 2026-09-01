import { useEffect, useRef, useState } from "react";
// Core editor + the Python grammar only: the full "monaco-editor" entry drags
// in every language service worker (7MB+ of TS tooling) we don't need.
// monaco's exports map rebases subpaths onto esm/vs/.
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/python/register.js";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";

self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

export interface OutputLine {
  stream: "stdout" | "stderr";
  text: string;
}

export interface PythonPanelProps {
  /** Python generated from the blocks; applied while the user hasn't edited. */
  generatedCode: string;
  output: OutputLine[];
  connected: boolean;
  /** Reports the current editor content after every change. */
  onSource: (code: string) => void;
}

export function PythonPanel({ generatedCode, output, connected, onSource }: PythonPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const applyingRef = useRef(false);
  const [userEdited, setUserEdited] = useState(false);
  const onSourceRef = useRef(onSource);
  onSourceRef.current = onSource;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = monaco.editor.create(container, {
      value: "",
      language: "python",
      theme: "vs-dark",
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: "none",
      occurrencesHighlight: "off",
    });
    editorRef.current = editor;
    editor.onDidChangeModelContent(() => {
      if (!applyingRef.current) setUserEdited(true);
      onSourceRef.current(editor.getValue());
    });
    return () => {
      editorRef.current = null;
      editor.dispose();
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || userEdited) return;
    if (editor.getValue() !== generatedCode) {
      applyingRef.current = true;
      editor.setValue(generatedCode);
      applyingRef.current = false;
    }
  }, [generatedCode, userEdited]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [output]);

  const resync = () => {
    const editor = editorRef.current;
    if (!editor) return;
    applyingRef.current = true;
    editor.setValue(generatedCode);
    applyingRef.current = false;
    setUserEdited(false);
  };

  return (
    <div className="python-panel">
      <div ref={containerRef} className="python-editor" />
      {output.length > 0 && (
        <div ref={outputRef} className="python-output">
          {output.map((line, i) => (
            <span key={i} className={line.stream === "stderr" ? "out-err" : "out-std"}>
              {line.text}
            </span>
          ))}
        </div>
      )}
      <div className="python-note">
        {connected ? (
          <span className="py-status ok">python: connected</span>
        ) : (
          <span className="py-status">
            python: offline · start it with ./scripts/run-python-sidecar.sh
          </span>
        )}
        {userEdited ? (
          <button className="link-button" onClick={resync}>
            ↺ resync from blocks
          </button>
        ) : (
          <span>synced from blocks · edit freely, Run executes this file</span>
        )}
      </div>
    </div>
  );
}
