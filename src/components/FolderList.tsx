import type { GroupView } from "../types";

interface FolderListProps {
  groups: GroupView[];
  selected: string | null;
  rootPath: string;
  onSelect: (name: string) => void;
  onNewGroup: () => void;
  onDeleteGroup: (name: string) => void;
  onOpenRoot: () => void;
}

/** The leftmost column: the folders that notes live in. */
export function FolderList(props: FolderListProps) {
  const { groups, selected, rootPath } = props;

  return (
    <aside className="folders">
      <div className="column-head">Folders</div>

      <nav className="folders-scroll" aria-label="Folders">
        {groups.length === 0 ? (
          <div className="column-empty">No folders yet.</div>
        ) : (
          groups.map((group) => (
            <div
              key={group.name}
              className={group.name === selected ? "folder selected" : "folder"}
              onClick={() => props.onSelect(group.name)}
            >
              <span className="folder-icon" aria-hidden="true">
                {"\u{1F4C1}"}
              </span>
              <span className="folder-name">{group.name}</span>
              <span className="folder-count">{group.notes.length}</span>
              <button
                className="folder-action"
                type="button"
                title={`Delete folder ${group.name}`}
                onClick={(event) => {
                  // The row itself selects; only the button deletes.
                  event.stopPropagation();
                  props.onDeleteGroup(group.name);
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </nav>

      <div className="column-foot">
        <button className="flat block" type="button" onClick={props.onNewGroup}>
          <span aria-hidden="true">+</span> New Folder
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
