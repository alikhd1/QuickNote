import type { RefObject } from "react";

import type { FileMeta, GroupView, NoteMeta, SearchHit } from "../types";

/**
 * Dates the way a notes app shows them: a time for today, a word for yesterday, a day
 * and month within this year, and a full date beyond that. Locale-aware, so it reads
 * correctly wherever the drive is plugged in.
 */
function formatWhen(ms: number): string {
  if (!ms) return "";
  const at = new Date(ms);
  const now = new Date();

  if (at.toDateString() === now.toDateString()) {
    return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";

  if (at.getFullYear() === now.getFullYear()) {
    return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return at.toLocaleDateString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface NoteListProps {
  group: GroupView | null;
  /** Search results across every folder, or null when not searching. */
  hits: SearchHit[] | null;
  currentPath: string | null;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onClearSearch: () => void;
  onOpenNote: (path: string) => void;
  onNewNote: () => void;
  onAttach: () => void;
  onOpenFile: (file: FileMeta) => void;
  onRevealFile: (file: FileMeta) => void;
  onDeleteFile: (file: FileMeta) => void;
}

/** The middle column: the notes inside the selected folder. */
export function NoteList(props: NoteListProps) {
  const { group, hits, currentPath, query, searchRef } = props;
  const files = group?.files ?? [];

  return (
    <section className="notes-col">
      <div className="column-head notes-head">
        <input
          ref={searchRef}
          className="search"
          type="search"
          placeholder="Search"
          autoComplete="off"
          aria-label="Search all notes"
          value={query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onClearSearch();
          }}
        />
        <button
          className="icon-button"
          type="button"
          title="New note"
          aria-label="New note"
          onClick={props.onNewNote}
        >
          <span aria-hidden="true">✎</span>
        </button>
      </div>

      <div className="notes-scroll">
        {hits ? (
          <SearchResults hits={hits} currentPath={currentPath} onOpenNote={props.onOpenNote} />
        ) : !group ? (
          <div className="column-empty">Choose a folder.</div>
        ) : group.notes.length === 0 ? (
          <div className="column-empty">No notes in this folder.</div>
        ) : (
          group.notes.map((note) => (
            <NoteRow
              key={note.path}
              note={note}
              selected={note.path === currentPath}
              onOpen={props.onOpenNote}
            />
          ))
        )}

        {!hits && files.length > 0 ? (
          <>
            <div className="files-head">
              <span>Attachments</span>
              <button
                className="icon-button"
                type="button"
                title="Attach files to this folder"
                aria-label="Attach files to this folder"
                onClick={props.onAttach}
              >
                <span aria-hidden="true">{"\u{1F4CE}"}</span>
              </button>
            </div>
            {files.map((file) => (
              <div
                key={file.path}
                className="file"
                onClick={() => props.onOpenFile(file)}
              >
                <span className="clip" aria-hidden="true">
                  {"\u{1F4CE}"}
                </span>
                <span className="file-name">{file.name}</span>
                <span className="file-size">{formatSize(file.size)}</span>
                <button
                  className="file-action"
                  type="button"
                  title={`Show ${file.name} in the folder`}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onRevealFile(file);
                  }}
                >
                  {"\u{1F4C2}"}
                </button>
                <button
                  className="file-action file-remove"
                  type="button"
                  title={`Remove ${file.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onDeleteFile(file);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

function NoteRow({
  note,
  selected,
  onOpen,
}: {
  note: NoteMeta;
  selected: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <button
      className={selected ? "note-row selected" : "note-row"}
      type="button"
      title={note.path}
      onClick={() => onOpen(note.path)}
    >
      <span className="note-row-title">{note.title}</span>
      <span className="note-row-meta">
        <span className="note-row-when">{formatWhen(note.modified)}</span>
        <span className="note-row-preview">
          {note.preview || "No additional text"}
        </span>
      </span>
    </button>
  );
}

function SearchResults({
  hits,
  currentPath,
  onOpenNote,
}: {
  hits: SearchHit[];
  currentPath: string | null;
  onOpenNote: (path: string) => void;
}) {
  if (hits.length === 0) return <div className="column-empty">No matches.</div>;

  return (
    <>
      <div className="files-head">
        <span>
          {hits.length} {hits.length === 1 ? "match" : "matches"}
        </span>
      </div>
      {hits.map((hit) => (
        <button
          key={hit.path}
          className={hit.path === currentPath ? "note-row selected" : "note-row"}
          type="button"
          title={hit.path}
          onClick={() => onOpenNote(hit.path)}
        >
          <span className="note-row-title">{hit.title}</span>
          <span className="note-row-meta">
            <span className="note-row-when">{hit.group}</span>
            <span className="note-row-preview">{hit.snippet}</span>
          </span>
        </button>
      ))}
    </>
  );
}
