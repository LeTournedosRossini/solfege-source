/*
 * UNDO / REDO of what is NOT in the Document: the state of a session (the placements, the banner, the display and reader options of mode B). The Document has its own history;
 * this one is plugged beside it (`Application.setExtraHistory`) so that the same buttons and Ctrl+Z serve both: the one whose last change is the more recent answers.
 * The state is read as JSON; `capture()` (called after anything may have changed) pushes the state it had before onto the undo stack when it differs from the last one seen.
 * Changes that follow each other within `coalesceMs` (a drag, a stepper held down) make ONE step. No DOM.
 */
export function createSessionHistory({ read, write, coalesceMs = 350, now = () => Date.now() }) {
  let cur = JSON.stringify(read()); let undoStack = []; let redoStack = []; let lastChange = 0; let applying = false; let stamp = 0;
  const listeners = new Set(); const notify = () => { for (const f of listeners) f(); };
  const apply = (json) => { applying = true; try { write(JSON.parse(json)); } finally { applying = false; } cur = JSON.stringify(read()); };
  return {
    /** Looks at the state now: when it differs from the last one it becomes a step (or joins the one in progress). */
    capture() {
      if (applying) return;
      const s = JSON.stringify(read()); if (s === cur) return;
      const t = now();
      if (!undoStack.length || t - lastChange > coalesceMs) undoStack.push(cur);
      lastChange = t; stamp = t; redoStack = []; cur = s; notify();
    },
    undo() { if (!undoStack.length) return false; redoStack.push(cur); apply(undoStack.pop()); stamp = now(); lastChange = 0; notify(); return true; },
    redo() { if (!redoStack.length) return false; undoStack.push(cur); apply(redoStack.pop()); stamp = now(); lastChange = 0; notify(); return true; },
    canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0,
    /** When the last change was made (to decide which history answers first). */
    at: () => stamp,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
