import type { ReactNode } from "react";

// A deliberately small markdown renderer for lesson prose.
//
// Lessons are pack content and packs are downloadable, so lesson text is
// untrusted input. This renders into React text nodes only — never
// dangerouslySetInnerHTML — so there is no HTML injection surface at all,
// which a full markdown library plus a sanitiser would have to defend.
// Supported: paragraphs, `code`, **bold**, and - bullet lists.

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  return (
    <>
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inline(line.replace(/^\s*[-*]\s+/, ""), `${blockIndex}-${lineIndex}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={blockIndex}>{inline(block.replace(/\n/g, " "), String(blockIndex))}</p>;
      })}
    </>
  );
}
