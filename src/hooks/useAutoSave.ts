import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../api";
import { titleOf } from "../markdown";
import type { NoteMeta, SaveStatus } from "../types";

const SAVE_DEBOUNCE_MS = 600;

interface Params {
  note: NoteMeta | null;
  content: string;
  /** Fresh metadata came back from the backend (the title or path may have changed). */
  onMeta: (meta: NoteMeta) => void;
  /** The sidebar needs rebuilding because a title or filename changed. */
  onStructureChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}

export interface AutoSave {
  status: SaveStatus;
  /** The note was edited: start the debounce. */
  touch: () => void;
  /** Write now. */
  flush: () => Promise<void>;
  /** Write now, then bring the filename into line with the title. */
  flushAndSettle: () => Promise<void>;
  /** True when there are changes not yet on disk. */
  isDirty: () => boolean;
  /** Adopt content that came from disk rather than from the user. */
  reset: () => void;
  /** The file changed outside the app; saving is paused until this is resolved. */
  hasConflict: boolean;
  /** Resolve a conflict by overwriting whatever is on disk. */
  keepMine: () => Promise<void>;
}

/**
 * Debounced auto-save with filename settling.
 *
 * All the moving parts live in refs rather than state. The debounce timer, the window
 * close handler and the in-flight save all run outside of React's render cycle, and a
 * closure captured at render time would see whichever note was open when that render
 * happened — which is exactly the note the user has just switched away from.
 */
export function useAutoSave(params: Params): AutoSave {
  const [status, setStatus] = useState<SaveStatus>("ready");

  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  });

  const [hasConflict, setHasConflict] = useState(false);
  const conflictRef = useRef(false);

  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  // Clicking a note in the sidebar blurs the editor *and* opens another note, so two
  // save-then-rename cycles can overlap. One chain keeps a rename from running against
  // a path the other cycle has already moved.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const touch = useCallback(() => {
    dirtyRef.current = true;

    // While a conflict is unresolved, keep the user's typing in memory but do not
    // write: every attempt would hit the same conflict and the banner would flicker.
    if (conflictRef.current) {
      setStatus("conflict");
      return;
    }

    setStatus("unsaved");
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      void flushRef.current();
    }, SAVE_DEBOUNCE_MS);
  }, [clearTimer]);

  /**
   * `force` skips the conflict check, overwriting whatever is on disk. It is only ever
   * true when the user has explicitly chosen to keep their version.
   */
  const runSave = useCallback(
    async (force: boolean) => {
      clearTimer();
      const { note, content, onMeta, onStructureChanged, onError } = paramsRef.current;
      if (!note || !dirtyRef.current || savingRef.current) return;
      if (conflictRef.current && !force) return;

      const path = note.path;
      const snapshot = content;
      savingRef.current = true;
      setStatus("saving");

      try {
        const outcome = await api.saveNote(
          path,
          snapshot,
          force ? undefined : { modified: note.modified, size: note.size },
        );
        savingRef.current = false;

        if (outcome.status === "conflict") {
          // Nothing was written. The edit stays pending so "keep mine" can still use it.
          conflictRef.current = true;
          setHasConflict(true);
          setStatus("conflict");
          return;
        }

        conflictRef.current = false;
        setHasConflict(false);

        if (paramsRef.current.content === snapshot) {
          dirtyRef.current = false;
          setStatus("saved");
        } else {
          // The user kept typing while the write was in flight.
          touch();
        }

        const openNow = paramsRef.current.note;
        if (openNow && openNow.path === path) {
          const titleChanged = outcome.meta.title !== openNow.title;
          // The fresh metadata becomes the baseline for the next save.
          onMeta(outcome.meta);
          if (titleChanged) await onStructureChanged();
        }
      } catch (err) {
        savingRef.current = false;
        // Keep the change pending so the next attempt retries it.
        dirtyRef.current = true;
        setStatus("error");
        onError(`Could not save this note: ${api.errorText(err)}`);
      }
    },
    [clearTimer, touch],
  );

  const flush = useCallback(() => runSave(false), [runSave]);
  const keepMine = useCallback(() => runSave(true), [runSave]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /**
   * Rename is deliberately not part of `flush`: doing it on every keystroke would
   * rename the file once per character while a title is being typed.
   */
  const settle = useCallback(async () => {
    await flushRef.current();
    const { note, content, onMeta, onStructureChanged, onError } = paramsRef.current;
    if (!note || dirtyRef.current || conflictRef.current) return;

    const wanted = titleOf(content);
    if (!wanted || wanted === note.title) return;

    try {
      onMeta(await api.renameNote(note.path, wanted));
      await onStructureChanged();
    } catch (err) {
      // The content is already safely on disk; a failed rename is cosmetic.
      onError(`Could not rename the file: ${api.errorText(err)}`);
    }
  }, []);

  const flushAndSettle = useCallback(() => {
    chainRef.current = chainRef.current.catch(() => {}).then(settle);
    return chainRef.current;
  }, [settle]);

  const reset = useCallback(() => {
    clearTimer();
    dirtyRef.current = false;
    savingRef.current = false;
    conflictRef.current = false;
    setHasConflict(false);
    setStatus("ready");
  }, [clearTimer]);

  const isDirty = useCallback(() => dirtyRef.current, []);

  useEffect(() => clearTimer, [clearTimer]);

  return { status, touch, flush, flushAndSettle, isDirty, reset, hasConflict, keepMine };
}
