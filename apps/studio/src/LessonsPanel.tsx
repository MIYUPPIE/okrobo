import { useMemo, useState } from "react";
import type { RobotKind } from "./blocks/okroboBlocks";
import { bundledLessons, type LoadedLesson } from "./packs/lessonSource";
import { Markdown } from "./packs/markdown";

// Lesson player: read a lesson, press "Try this" on any step, and the code
// lands in the Python editor ready to Run (switching robots if the lesson
// needs a different one).

export interface LessonsPanelProps {
  onTryStep: (code: string, robot: RobotKind) => void;
}

export function LessonsPanel({ onTryStep }: LessonsPanelProps) {
  const lessons = useMemo(() => bundledLessons(), []);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const open: LoadedLesson | undefined = lessons.find((l) => l.file === openFile);

  if (lessons.length === 0) {
    return (
      <div className="lessons-empty">
        No lessons installed. Packs with lessons appear here once installed.
      </div>
    );
  }

  if (!open) {
    return (
      <div className="lesson-list">
        {lessons.map((lesson) => (
          <button key={lesson.file} className="lesson-card" onClick={() => setOpenFile(lesson.file)}>
            <span className="lesson-title">{lesson.title}</span>
            <span className="lesson-meta">
              {lesson.robot === "arm" ? "🦾 Arm" : "🚗 Car"} · {lesson.steps.length} steps ·{" "}
              {lesson.pack}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="lesson-reader">
      <div className="lesson-header">
        <button className="link-button" onClick={() => setOpenFile(null)}>
          ← All lessons
        </button>
        <span className="lesson-title">{open.title}</span>
        <span className="lesson-meta">{open.robot === "arm" ? "🦾 Arm" : "🚗 Car"}</span>
      </div>
      <div className="lesson-body">
        {open.steps.map((step, index) => (
          <section key={index} className="lesson-step">
            <Markdown source={step.markdown} />
            {step.code && (
              <div className="lesson-code">
                <pre>{step.code}</pre>
                <button className="try-button" onClick={() => onTryStep(step.code!, open.robot)}>
                  Try this →
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
