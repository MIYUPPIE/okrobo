import { useEffect, useImperativeHandle, useRef, useState } from "react";
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

export interface PythonPanelHandle {
  /** Current buffer and whether the user has hand-edited it. */
  get(): { code: string; edited: boolean };
  /** Replace the buffer (project load / new project). */
  load(code: string, edited: boolean): void;
  /** Undo the last editor edit (no-op if there is nothing to undo). */
  undo(): void;
  /** Redo the last undone editor edit (no-op if there is nothing to redo). */
  redo(): void;
}

export interface PythonPanelProps {
  /** Python generated from the blocks; applied while the user hasn't edited. */
  generatedCode: string;
  output: OutputLine[];
  connected: boolean;
  /** Reports the current editor content after every change. */
  onSource: (code: string) => void;
  /**
   * Seeds a freshly-mounted instance (a robot switch from a lesson's "Try
   * this" or an opened project) with specific content, marked edited so the
   * generatedCode-effect below leaves it alone. Read only at mount: a parent
   * effect calling `ref.load(...)` after this panel has already mounted
   * races against React StrictMode's dev-mode double-invoke of effects
   * (mount -> cleanup -> mount again), which disposes and recreates the
   * Monaco editor right after such a call and silently drops it. Seeding
   * through a prop at construction time is immune to that, because both
   * StrictMode passes replay the same render's closure.
   */
  initialOverride?: { code: string; edited: boolean };
  /** Called once `initialOverride` has been applied, so the parent can clear
   * it — otherwise a later, unrelated remount would reapply stale content. */
  onOverrideConsumed?: () => void;
  ref?: React.Ref<PythonPanelHandle>;
}

export function PythonPanel({
  generatedCode,
  output,
  connected,
  onSource,
  initialOverride,
  onOverrideConsumed,
  ref,
}: PythonPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const applyingRef = useRef(false);
  const [userEdited, setUserEdited] = useState(false);
  const userEditedRef = useRef(false);
  const onSourceRef = useRef(onSource);
  onSourceRef.current = onSource;
  userEditedRef.current = userEdited;

  useImperativeHandle(
    ref,
    () => ({
      get: () => ({
        code: editorRef.current?.getValue() ?? "",
        edited: userEditedRef.current,
      }),
      load: (code, edited) => {
        const editor = editorRef.current;
        if (!editor) return;
        applyingRef.current = true;
        editor.setValue(code);
        applyingRef.current = false;
        // Set the ref synchronously, not just the state: on a robot switch
        // this fires from a *parent* effect right after this panel remounts
        // (a fresh instance, key={robot}), and that new instance's own
        // generatedCode-effect below can still run afterward with a stale
        // `generatedCode` prop (the parent hasn't re-rendered with the new
        // robot's generated code yet) and a closure over the pre-load()
        // `userEdited=false`. Reading the ref there instead of the closured
        // state makes the guard correct regardless of effect ordering.
        userEditedRef.current = edited;
        setUserEdited(edited);
      },
      undo: () => editorRef.current?.trigger("app", "undo", null),
      redo: () => editorRef.current?.trigger("app", "redo", null),
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = monaco.editor.create(container, {
      value: initialOverride?.code ?? "",
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
    if (initialOverride) {
      userEditedRef.current = initialOverride.edited;
      setUserEdited(initialOverride.edited);
      onOverrideConsumed?.();
    }
    editor.onDidChangeModelContent(() => {
      if (!applyingRef.current) setUserEdited(true);
      onSourceRef.current(editor.getValue());
    });
    return () => {
      editorRef.current = null;
      editor.dispose();
    };
    // initialOverride/onOverrideConsumed are deliberately excluded: they are
    // a one-time seed for this mount, like useState's initial value, not
    // something later changes should re-apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    // Guard on the ref, not the `userEdited` closure: see the comment on
    // load() above for why the closure can be stale here.
    if (!editor || userEditedRef.current) return;
    if (editor.getValue() !== generatedCode) {
      applyingRef.current = true;
      editor.setValue(generatedCode);
      applyingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
