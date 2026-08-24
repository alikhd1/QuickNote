import { ColumnsIcon, PaperclipIcon, TrashIcon } from "./Icon";
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
    <header className="toolbar" data-tauri-drag-region>
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
        className="icon-button"
        type="button"
        title="Attach a file to this note"
        aria-label="Attach a file to this note"
        disabled={disabled}
        onClick={props.onAttach}
      >
        <PaperclipIcon />
      </button>

      <button
        className={previewOn ? "icon-button active" : "icon-button"}
        type="button"
        title="Toggle the Markdown preview"
        aria-label="Toggle the Markdown preview"
        aria-pressed={previewOn}
        disabled={disabled}
        onClick={props.onTogglePreview}
      >
        <ColumnsIcon />
      </button>

      <button
        className="icon-button danger"
        type="button"
        title="Delete this note"
        aria-label="Delete this note"
        disabled={disabled}
        onClick={props.onDelete}
      >
        <TrashIcon />
      </button>

      <span className={STATUS_CLASS[status]} aria-live="polite">
        {STATUS_TEXT[status]}
      </span>
    </header>
  );
}
