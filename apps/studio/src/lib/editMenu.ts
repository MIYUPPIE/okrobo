// Which Edit actions apply to the App's current code tab. Extracted as pure
// logic (rather than inlined in App.tsx) so it's testable without mounting
// Blockly or Monaco — see App.tsx's editActions/doUndo/doRedo/doCleanUpBlocks.

/** Mirrors App.tsx's CodeTab; kept as a local literal union to avoid a
 * circular import (App.tsx imports this module). */
export type EditableTab = "Blocks" | "Python" | "World" | "Lessons" | "C++";

export type EditAction = "undo" | "redo" | "cleanUp";

export function editActionsForTab(tab: EditableTab): EditAction[] {
  switch (tab) {
    case "Blocks":
      // Blockly's workspace has its own undo/redo stack plus a non-destructive
      // "arrange blocks in a column" (cleanUp).
      return ["undo", "redo", "cleanUp"];
    case "Python":
      // Monaco (the Python editor) has its own undo/redo stack; no clean-up
      // concept for a text editor.
      return ["undo", "redo"];
    case "World":
    case "Lessons":
    case "C++":
      // A form, a read-only lesson list, and a read-only code preview: none
      // of these is an editing surface with undo/redo semantics.
      return [];
  }
}
