// Lesson parser (contracts/pack/v0): markdown with front matter and runnable
// ```okrobo-python blocks. Lessons are pack content, so this treats them as
// untrusted data: it extracts structure and never evaluates anything.

import type { RobotKind } from "../blocks/okroboBlocks";

export interface LessonStep {
  /** Prose leading up to the code, as markdown. */
  markdown: string;
  /** Runnable python for this step, if the step has any. */
  code?: string;
}

export interface Lesson {
  title: string;
  robot: RobotKind;
  steps: LessonStep[];
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?/;
const CODE_BLOCK = /```okrobo-python\n([\s\S]*?)```/g;

function parseFrontMatter(source: string): { fields: Record<string, string>; body: string } {
  const match = FRONT_MATTER.exec(source);
  if (!match) return { fields: {}, body: source };
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key) fields[key] = value;
  }
  return { fields, body: source.slice(match[0].length) };
}

export function parseLesson(source: string): Lesson {
  const { fields, body } = parseFrontMatter(source);
  const title = fields.title?.trim();
  if (!title) throw new Error("lesson: missing 'title' in front matter");
  const robot: RobotKind =
    fields.robot === "arm" ? "arm" : fields.robot === "drone" ? "drone" : "car";

  const steps: LessonStep[] = [];
  let cursor = 0;
  CODE_BLOCK.lastIndex = 0;
  for (let match = CODE_BLOCK.exec(body); match; match = CODE_BLOCK.exec(body)) {
    steps.push({
      markdown: body.slice(cursor, match.index).trim(),
      code: match[1].replace(/\s+$/, ""),
    });
    cursor = match.index + match[0].length;
  }
  const tail = body.slice(cursor).trim();
  if (tail) steps.push({ markdown: tail });
  if (steps.length === 0) throw new Error(`lesson '${title}': no content`);
  return { title, robot, steps };
}
