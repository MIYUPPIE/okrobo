import { useEffect, useRef } from "react";
// Core editor + the Python grammar only: the full "monaco-editor" entry drags
// in every language service worker (7MB+ of TS tooling) for a read-only pane.
// monaco's exports map rebases subpaths onto esm/vs/.
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/python/register.js";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";

// Read-only Monaco view of the Python generated from the blocks. Becomes an
// editable, executable editor in Phase 3 when the CPython sidecar lands.

self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

export function PythonPanel({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = monaco.editor.create(container, {
      value: "",
      language: "python",
      theme: "vs-dark",
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderLineHighlight: "none",
      occurrencesHighlight: "off",
    });
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
      editor.dispose();
    };
  }, []);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && model.getValue() !== code) model.setValue(code);
  }, [code]);

  return (
    <div className="python-panel">
      <div ref={containerRef} className="python-editor" />
      <div className="python-note">
        Generated from your blocks · read-only until Phase 3 · runs today via python3 -m okrobo.demo
      </div>
    </div>
  );
}
