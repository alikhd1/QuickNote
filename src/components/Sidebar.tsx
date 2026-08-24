import type { RefObject } from "react";

import type { FileMeta, GroupView, SearchHit } from "../types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SidebarProps {
  tree: GroupView[];
  /** Search results, or null when not searching. */
  hits: SearchHit[] | null;
  currentPath: string | null;
  query: string;
  rootPath: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onClearSearch: () => void;
  onOpenNote: (path: string) => void;
  onNewGroup: () => void;
  onNewNote: (group: string) => void;
  onAttachToGroup: (group: string) => void;
  onDeleteGroup: (group: string) => void;
  onOpenFile: (file: FileMeta) => void;
  onDeleteFile: (file: FileMeta) => void;
  onOpenRoot: () => void;
}

export function Sidebar(props: SidebarProps) {
  const { tree, hits, currentPath, query, rootPath, searchRef } = props;

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <input
          ref={searchRef}
          className="search"
          type="search"
          placeholder="Search notes"
          autoComplete="off"
          aria-label="Search notes"
          value={query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onClearSearch();
          }}
        />
      </div>

      <nav className="tree" aria-label="Notes and files">
        {hits ? (
          <SearchResults hits={hits} onOpenNote={props.onOpenNote} />
        ) : tree.length === 0 ? (
          <div className="tree-empty">No groups yet.</div>
        ) : (
          tree.map((group) => (
            <GroupSection
              key={group.name}
              group={group}
              currentPath={currentPath}
              onOpenNote={props.onOpenNote}
              onNewNote={props.onNewNote}
              onAttach={props.onAttachToGroup}
              onDeleteGroup={props.onDeleteGroup}
              onOpenFile={props.onOpenFile}
              onDeleteFile={props.onDeleteFile}
            />
          ))
        )}
      </nav>

      <div className="sidebar-bottom">
        <button className="ghost block" type="button" onClick={props.onNewGroup}>
          + New group
        </button>
        <button
          className="root-path"
          type="button"
          title={`Open ${rootPath}`}
          onClick={props.onOpenRoot}
        >
          {rootPath}
        </button>
      </div>
    </aside>
  );
}

function SearchResults({
  hits,
  onOpenNote,
}: {
  hits: SearchHit[];
  onOpenNote: (path: string) => void;
}) {
  if (hits.length === 0) return <div className="tree-empty">No matches.</div>;

  return (
    <>
      <div className="group-head">
        {hits.length} {hits.length === 1 ? "match" : "matches"}
      </div>
      {hits.map((hit) => (
        <button
          key={hit.path}
          className="note"
          type="button"
          title={hit.path}
          onClick={() => onOpenNote(hit.path)}
        >
          <span>
            {hit.group} / {hit.title}
          </span>
          <span className="hit-snippet">{hit.snippet}</span>
        </button>
      ))}
    </>
  );
}

interface GroupSectionProps {
  group: GroupView;
  currentPath: string | null;
  onOpenNote: (path: string) => void;
  onNewNote: (group: string) => void;
  onAttach: (group: string) => void;
  onDeleteGroup: (group: string) => void;
  onOpenFile: (file: FileMeta) => void;
  onDeleteFile: (file: FileMeta) => void;
}

function GroupSection(props: GroupSectionProps) {
  const { group, currentPath } = props;

  return (
    <div className="group">
      <div className="group-head">
        <span className="group-name">{group.name}</span>
        <button
          className="group-action"
          type="button"
          title={`New note in ${group.name}`}
          onClick={() => props.onNewNote(group.name)}
        >
          +
        </button>
        <button
          className="group-action"
          type="button"
          title={`Attach files to ${group.name}`}
          // Attaching straight to a group always copies: there is no note text here to
          // hold a link, and a stored file is the thing that travels with the drive.
          onClick={() => props.onAttach(group.name)}
        >
          {"\u{1F4CE}"}
        </button>
        <button
          className="group-action"
          type="button"
          title={`Delete group ${group.name}`}
          onClick={() => props.onDeleteGroup(group.name)}
        >
          ×
        </button>
      </div>

      {group.notes.length === 0 && group.files.length === 0 ? (
        <div className="note-empty">empty</div>
      ) : null}

      {group.notes.map((note) => (
        <button
          key={note.path}
          className={note.path === currentPath ? "note selected" : "note"}
          type="button"
          title={note.path}
          onClick={() => props.onOpenNote(note.path)}
        >
          {note.title}
        </button>
      ))}

      {group.files.map((file) => (
        <button
          key={file.path}
          className="file"
          type="button"
          title={`Open ${file.name}`}
          onClick={() => props.onOpenFile(file)}
        >
          <span className="clip">{"\u{1F4CE}"}</span>
          <span className="file-name">{file.name}</span>
          <span className="file-size">{formatSize(file.size)}</span>
          <span
            className="file-remove"
            title={`Remove ${file.name}`}
            onClick={(event) => {
              // Do not also trigger the row's "open" handler.
              event.stopPropagation();
              props.onDeleteFile(file);
            }}
          >
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
