import { Dropdown } from "./Dropdown";
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
      {/* Composing lives in the note list header, where the list it adds to is.
          A second button here only crowded the toolbar. */}
      <span className="crumb">{note ? note.title : ""}</span>
      <span className="grow" />

      <div className="move-wrap">
        <span>Group</span>
        <Dropdown
          value={note?.group ?? ""}
          options={groups}
          disabled={disabled}
          label="Move this note to another group"
          title="Move this note to another group"
          onChange={props.onMove}
        />
      </div>

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
