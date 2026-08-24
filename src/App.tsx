import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import * as api from "./api";
import { hasExternalLinks, titleOf } from "./markdown";
import { useAutoSave } from "./hooks/useAutoSave";
import { useDialogs } from "./components/Dialogs";
import { Preview } from "./components/Preview";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import type { FileMeta, GroupView, NoteMeta, SearchHit, Startup } from "./types";

const SEARCH_DEBOUNCE_MS = 200;

function findMeta(tree: GroupView[], path: string): NoteMeta | null {
  for (const group of tree) {
    const found = group.notes.find((note) => note.path === path);
    if (found) return found;
  }
  return null;
}

function firstNote(tree: GroupView[]): NoteMeta | null {
  for (const group of tree) {
    if (group.notes.length > 0) return group.notes[0];
  }
  return null;
}

export default function App() {
  const [startup, setStartup] = useState<Startup | null>(null);
  const [tree, setTree] = useState<GroupView[]>([]);
  const [current, setCurrent] = useState<NoteMeta | null>(null);
  const [content, setContent] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [previewOn, setPreviewOn] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Destructured because both hooks return a fresh object each render; the individual
  // callbacks are stable, so effects can depend on them without re-registering.
  const { ask, confirm, choose, element: dialogElement } = useDialogs();

  const fail = useCallback((message: string) => setBanner(message), []);

  const loadTree = useCallback(async () => {
    try {
      setTree(await api.listTree());
    } catch (err) {
      fail(`Could not read the notes folder: ${api.errorText(err)}`);
    }
  }, [fail]);

  const { status, touch, flush, flushAndSettle, isDirty, reset } = useAutoSave({
    note: current,
    content,
    onMeta: setCurrent,
    onStructureChanged: loadTree,
    onError: fail,
  });

  // ---------------------------------------------------------------- notes

  const loadNote = useCallback(
    async (meta: NoteMeta) => {
      const text = await api.readNote(meta.path);
      // A note opened by path alone (not found in the tree) arrives without a title.
      setCurrent(meta.title ? meta : { ...meta, title: titleOf(text) });
      setContent(text);
      reset();
      editorRef.current?.focus();
    },
    [reset],
  );

  const openNote = useCallback(
    async (path: string) => {
      if (current?.path === path) return;
      await flushAndSettle();
      try {
        const meta = findMeta(tree, path);
        await loadNote(
          meta ?? {
            path,
            group: path.split("/")[0] ?? "",
            title: "",
            modified: 0,
            size: 0,
          },
        );
      } catch (err) {
        fail(`Could not open that note: ${api.errorText(err)}`);
        await loadTree();
      }
    },
    [current, tree, flushAndSettle, loadNote, fail, loadTree],
  );

  const newNote = useCallback(
    async (group?: string) => {
      const target = group ?? current?.group ?? tree[0]?.name;
      if (!target) {
        fail("Create a group first.");
        return;
      }

      const title = await ask(`New note in ${target}`, "Create");
      if (!title) return;

      await flushAndSettle();
      try {
        const meta = await api.createNote(target, title);
        await loadTree();
        await loadNote(meta);
      } catch (err) {
        fail(`Could not create the note: ${api.errorText(err)}`);
      }
    },
    [current, tree, ask, flushAndSettle, loadTree, loadNote, fail],
  );

  const newGroup = useCallback(async () => {
    const name = await ask("New group", "Create");
    if (!name) return;
    try {
      await api.createGroup(name);
      await loadTree();
    } catch (err) {
      fail(`Could not create the group: ${api.errorText(err)}`);
    }
  }, [ask, loadTree, fail]);

  const clearNote = useCallback(() => {
    setCurrent(null);
    setContent("");
    reset();
  }, [reset]);

  const deleteCurrentNote = useCallback(async () => {
    if (!current) return;
    const ok = await confirm(
      "Delete this note?",
      `“${current.title}” moves to the _trash folder on the drive. Nothing is erased.`,
      "Move to trash",
    );
    if (!ok) return;

    try {
      await api.deleteNote(current.path);
      clearNote();
      const groups = await api.listTree();
      setTree(groups);
      const next = firstNote(groups);
      if (next) await loadNote(next);
    } catch (err) {
      fail(`Could not delete the note: ${api.errorText(err)}`);
    }
  }, [current, confirm, clearNote, loadNote, fail]);

  const deleteGroup = useCallback(
    async (name: string) => {
      const ok = await confirm(
        `Delete the group “${name}”?`,
        "The folder and every note in it move to _trash on the drive. Nothing is erased.",
        "Move to trash",
      );
      if (!ok) return;

      try {
        await api.deleteGroup(name);
        const wasOpen = current?.group === name;
        if (wasOpen) clearNote();

        const groups = await api.listTree();
        setTree(groups);

        if (wasOpen) {
          const next = firstNote(groups);
          if (next) await loadNote(next);
        }
      } catch (err) {
        fail(`Could not delete the group: ${api.errorText(err)}`);
      }
    },
    [current, confirm, clearNote, loadNote, fail],
  );

  const moveCurrent = useCallback(
    async (group: string) => {
      if (!current || current.group === group) return;
      await flushAndSettle();
      try {
        setCurrent(await api.moveNote(current.path, group));
        await loadTree();
      } catch (err) {
        fail(`Could not move the note: ${api.errorText(err)}`);
        await loadTree();
      }
    },
    [current, flushAndSettle, loadTree, fail],
  );

  // ---------------------------------------------------------------- attachments

  const insertAtCursor = useCallback(
    (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;

      setContent((prev) => prev.slice(0, start) + text + prev.slice(end));
      touch();

      // Restore the caret once React has re-rendered with the new value.
      requestAnimationFrame(() => {
        editor.selectionStart = start + text.length;
        editor.selectionEnd = start + text.length;
        editor.focus();
      });
    },
    [touch],
  );

  const copyInto = useCallback(
    async (group: string, sources: string[]): Promise<FileMeta[]> => {
      const result = await api.attachFiles(group, sources);
      if (result.failed.length > 0) {
        fail(`Some files could not be attached: ${result.failed.join("; ")}`);
      } else {
        setBanner(null);
      }
      await loadTree();
      return result.attached;
    },
    [loadTree, fail],
  );

  const attachToGroup = useCallback(
    async (group: string) => {
      try {
        const sources = await api.pickFiles();
        if (sources.length === 0) return;
        await copyInto(group, sources);
      } catch (err) {
        fail(`Could not attach: ${api.errorText(err)}`);
      }
    },
    [copyInto, fail],
  );

  const attachToNote = useCallback(async () => {
    if (!current) return;
    const group = current.group;

    try {
      const sources = await api.pickFiles();
      if (sources.length === 0) return;

      const mode = await choose(
        "Attach files",
        sources.length === 1
          ? "Copying puts the file on the drive so it travels with your notes. Linking leaves it where it is, and the link will break on another computer."
          : `Copying puts these ${sources.length} files on the drive so they travel with your notes. Linking leaves them where they are, and the links will break on another computer.`,
      );
      if (mode === "cancel") return;

      if (mode === "copy") {
        const attached = await copyInto(group, sources);
        for (const file of attached) {
          insertAtCursor(`[${file.name}](_files/${file.name})\n`);
        }
        return;
      }

      // "Link where it is": no copy, just the absolute path in the note text. The
      // import bar appears so bringing it in later is one click away.
      for (const source of sources) {
        const name = source.split(/[\\/]/).pop() || source;
        insertAtCursor(`[${name}](${source})\n`);
      }
      await flushAndSettle();
    } catch (err) {
      fail(`Could not attach: ${api.errorText(err)}`);
    }
  }, [current, choose, copyInto, insertAtCursor, flushAndSettle, fail]);

  const deleteAttachment = useCallback(
    async (file: FileMeta) => {
      const ok = await confirm(
        "Remove this file?",
        `“${file.name}” moves to the _trash folder on the drive. Nothing is erased.`,
        "Move to trash",
      );
      if (!ok) return;

      try {
        await api.deleteFile(file.path);
        await loadTree();
      } catch (err) {
        fail(`Could not remove the file: ${api.errorText(err)}`);
      }
    },
    [confirm, loadTree, fail],
  );

  const bringFilesIn = useCallback(async () => {
    if (!current) return;
    await flushAndSettle();

    try {
      const report = await api.importLinks(current.path);
      if (report.copied > 0) {
        setContent(await api.readNote(current.path));
        reset();
        await loadTree();
      }

      if (report.missing.length > 0) {
        fail(
          `Copied ${report.copied}; could not reach: ${report.missing.join(", ")}. Those links stay as they are.`,
        );
      } else {
        setBanner(null);
      }
    } catch (err) {
      fail(`Could not bring files in: ${api.errorText(err)}`);
    }
  }, [current, flushAndSettle, reset, loadTree, fail]);

  /** Files dropped on the window are copied in, and linked if a note is open. */
  const handleDrop = useCallback(
    async (sources: string[]) => {
      if (sources.length === 0) return;
      const group = current?.group ?? tree[0]?.name;
      if (!group) {
        fail("Create a group before dropping files in.");
        return;
      }

      try {
        const attached = await copyInto(group, sources);
        if (current) {
          for (const file of attached) {
            insertAtCursor(`[${file.name}](_files/${file.name})\n`);
          }
        }
      } catch (err) {
        fail(`Could not attach the dropped files: ${api.errorText(err)}`);
      }
    },
    [current, tree, copyInto, insertAtCursor, fail],
  );

  // ---------------------------------------------------------------- opening things

  const openAttachment = useCallback(
    (path: string) => {
      api.openAttachment(path).catch((err) => fail(api.errorText(err)));
    },
    [fail],
  );

  const openExternal = useCallback(
    (path: string) => {
      api.openExternalFile(path).catch((err) => fail(api.errorText(err)));
    },
    [fail],
  );

  const openUrl = useCallback(
    (url: string) => {
      api.openUrl(url).catch((err) => fail(api.errorText(err)));
    },
    [fail],
  );

  // ---------------------------------------------------------------- effects

  // Startup: read where the notes live, then load the tree and the first note.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const info = await api.startupStatus();
        if (cancelled) return;
        setStartup(info);
        if (info.error) {
          setBanner(
            `The notes folder could not be prepared: ${info.error} — the drive may be write-protected.`,
          );
        }
      } catch (err) {
        setBanner(`Could not start: ${api.errorText(err)}`);
      }

      try {
        const groups = await api.listTree();
        if (cancelled) return;
        setTree(groups);

        const first = firstNote(groups);
        if (first) {
          const text = await api.readNote(first.path);
          if (cancelled) return;
          setCurrent(first);
          setContent(text);
        }
      } catch (err) {
        setBanner(`Could not read the notes folder: ${api.errorText(err)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Search, debounced.
  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .search(query)
        .then(setHits)
        .catch((err) => fail(`Search failed: ${api.errorText(err)}`));
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, fail]);

  // Hold the window open until the last keystroke is on disk.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await flushAndSettle();

      if (isDirty()) {
        const ok = await confirm(
          "Unsaved changes",
          "The last changes could not be written to the drive. Close anyway and lose them?",
          "Close anyway",
        );
        if (!ok) return;
      }
      await appWindow.destroy();
    });

    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [flushAndSettle, isDirty, confirm]);

  // Dropping files anywhere on the window copies them onto the drive.
  const dropRef = useRef(handleDrop);
  useEffect(() => {
    dropRef.current = handleDrop;
  });

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setDropActive(true);
        return;
      }
      setDropActive(false);
      if (payload.type === "drop") void dropRef.current(payload.paths);
    });

    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  // Alt-tabbing away does not reliably blur the textarea, so commit on window blur too.
  useEffect(() => {
    function onBlur() {
      void flush();
    }
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [flush]);

  // Window title follows the open note.
  useEffect(() => {
    void getCurrentWindow()
      .setTitle(current ? `${current.title} — QuickNote` : "QuickNote")
      .catch(() => {
        /* the title is decoration; never let it break the app */
      });
  }, [current]);

  // Keyboard shortcuts.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;

      switch (event.key.toLowerCase()) {
        case "s":
          // People press this out of habit. Honour it rather than letting the webview
          // try to save the page.
          event.preventDefault();
          void flushAndSettle();
          break;
        case "n":
          event.preventDefault();
          void newNote();
          break;
        case "f":
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          break;
        case "p":
          event.preventDefault();
          if (current) setPreviewOn((on) => !on);
          break;
        default:
          break;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [flushAndSettle, newNote, current]);

  // ---------------------------------------------------------------- render

  const groups = tree.map((group) => group.name);
  const showImportBar = current !== null && hasExternalLinks(content);

  return (
    <>
      {banner ? (
        <div className="banner" role="alert">
          {banner}
        </div>
      ) : null}

      <div className="app">
        <Sidebar
          tree={tree}
          hits={hits}
          currentPath={current?.path ?? null}
          query={query}
          rootPath={startup?.root ?? ""}
          searchRef={searchRef}
          onQueryChange={setQuery}
          onClearSearch={() => {
            setQuery("");
            editorRef.current?.focus();
          }}
          onOpenNote={(path) => void openNote(path)}
          onNewGroup={() => void newGroup()}
          onNewNote={(group) => void newNote(group)}
          onAttachToGroup={(group) => void attachToGroup(group)}
          onDeleteGroup={(group) => void deleteGroup(group)}
          onOpenFile={(file) => openAttachment(file.path)}
          onDeleteFile={(file) => void deleteAttachment(file)}
          onOpenRoot={() => {
            api.openNotesFolder().catch((err) =>
              fail(`Could not open the notes folder: ${api.errorText(err)}`),
            );
          }}
        />

        <main className="main">
          <Toolbar
            note={current}
            groups={groups}
            status={status}
            previewOn={previewOn}
            onNewNote={() => void newNote()}
            onMove={(group) => void moveCurrent(group)}
            onAttach={() => void attachToNote()}
            onTogglePreview={() => setPreviewOn((on) => !on)}
            onDelete={() => void deleteCurrentNote()}
          />

          {showImportBar ? (
            <div className="import-bar">
              <span>
                This note links to files outside the drive. They will not travel with it.
              </span>
              <button className="primary" type="button" onClick={() => void bringFilesIn()}>
                Bring files in
              </button>
            </div>
          ) : null}

          {current ? (
            <section className="workspace">
              <textarea
                ref={editorRef}
                className="editor"
                spellCheck
                placeholder="Start typing. It saves itself."
                aria-label="Note contents"
                value={content}
                onChange={(event) => {
                  setContent(event.target.value);
                  touch();
                }}
                // Leaving the editor is a natural commit point: save, and settle the
                // filename against the title.
                onBlur={() => void flushAndSettle()}
              />
              {previewOn ? (
                <Preview
                  content={content}
                  group={current.group}
                  onOpenAttachment={openAttachment}
                  onOpenFile={openExternal}
                  onOpenUrl={openUrl}
                />
              ) : null}
            </section>
          ) : (
            <div className="empty">
              <h2>No note open</h2>
              <p>Choose a note on the left, or create a new one.</p>
            </div>
          )}
        </main>
      </div>

      {dropActive ? (
        <div className="drop-overlay">
          <div className="drop-card">Drop files to copy them into this group</div>
        </div>
      ) : null}

      {dialogElement}
    </>
  );
}
