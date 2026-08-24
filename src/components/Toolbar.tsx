import type { NoteMeta, SaveStatus } from "../types";

const STATUS_TEXT: Record<SaveStatus, string> = {
  ready: "Ready",
  unsaved: "Unsaved",
  saving: "Saving",
  saved: "Saved",
  error: "Save failed",
  conflict: "Changed on disk",
};

const STATUS_CLASS: Record<SaveStatus, string> = {
  ready: "status",
  unsaved: "status",
  saving: "status",
  saved: "status ok",
  error: "status error",
  conflict: "status error",
};

interface ToolbarProps {
  note: NoteMeta | null;
  groups: string[];
  status: SaveStatus;
  previewOn: boolean;
  onNewNote: () => void;
  onMove: (group: string) => void;
  onAttach: () => void;
  onTogglePreview: () => void;
  onDelete: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const { note, groups, status, previewOn } = props;
  const disabled = note === null;

  return (
    <header className="toolbar">
      <button className="primary" type="button" onClick={props.onNewNote}>
        + New note
      </button>

      <span className="crumb">{note ? `${note.group}  /  ${note.title}` : ""}</span>
      <span className="grow" />

      <label className="move-wrap" htmlFor="move-group">
        <span>Group</span>
        <select
          id="move-group"
          title="Move this note to another group"
          disabled={disabled}
          value={note?.group ?? ""}
          onChange={(event) => props.onMove(event.target.value)}
        >
          {groups.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        title="Attach a file to this note"
        disabled={disabled}
        onClick={props.onAttach}
      >
        Attach
      </button>

      <button
        type="button"
        className={previewOn ? "active" : undefined}
        disabled={disabled}
        onClick={props.onTogglePreview}
      >
        Preview
      </button>

      <button className="danger" type="button" disabled={disabled} onClick={props.onDelete}>
        Delete
      </button>

      <span className={STATUS_CLASS[status]} aria-live="polite">
        {STATUS_TEXT[status]}
      </span>
    </header>
  );
}
