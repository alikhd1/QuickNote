//! The IPC surface.
//!
//! Thin wrappers over `store`. All file access the UI can perform goes through exactly
//! these functions — the `fs` plugin is deliberately not installed, so there is no other
//! route from the webview to the filesystem.

use serde::Serialize;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::files::{self, FileMeta, ImportReport};
use crate::store::{self, Group, NoteMeta, SearchHit};
use crate::AppState;

#[derive(Serialize)]
pub struct Startup {
    /// Absolute path of the notes folder, shown in the UI so it is never a mystery
    /// where the files actually are.
    pub root: String,
    /// Set when the notes folder could not be prepared, e.g. a write-protected drive.
    pub error: Option<String>,
}

#[tauri::command]
pub fn startup_status(state: State<AppState>) -> Startup {
    Startup {
        root: state.root.display().to_string(),
        error: state.startup_error.clone(),
    }
}

/// A group as the sidebar shows it: its notes and its attached files together.
///
/// Assembled here rather than in `store` so that module stays unaware of attachments,
/// and so the UI gets the whole sidebar in one round trip instead of one call per group.
#[derive(Serialize)]
pub struct GroupView {
    pub name: String,
    pub notes: Vec<NoteMeta>,
    pub files: Vec<FileMeta>,
}

#[tauri::command]
pub fn list_tree(state: State<AppState>) -> Result<Vec<GroupView>, String> {
    let groups: Vec<Group> = store::list_tree(&state.root)?;
    let mut view = Vec::with_capacity(groups.len());

    for group in groups {
        let files = files::list_files(&state.root, &group.name)?;
        view.push(GroupView {
            name: group.name,
            notes: group.notes,
            files,
        });
    }
    Ok(view)
}

#[tauri::command]
pub fn read_note(state: State<AppState>, path: String) -> Result<String, String> {
    store::read_note(&state.root, &path)
}

#[tauri::command]
pub fn save_note(
    state: State<AppState>,
    path: String,
    content: String,
) -> Result<NoteMeta, String> {
    store::save_note(&state.root, &path, &content)
}

#[tauri::command]
pub fn create_note(
    state: State<AppState>,
    group: String,
    title: String,
) -> Result<NoteMeta, String> {
    store::create_note(&state.root, &group, &title)
}

#[tauri::command]
pub fn rename_note(
    state: State<AppState>,
    path: String,
    title: String,
) -> Result<NoteMeta, String> {
    store::rename_note(&state.root, &path, &title)
}

#[tauri::command]
pub fn move_note(state: State<AppState>, path: String, group: String) -> Result<NoteMeta, String> {
    store::move_note(&state.root, &path, &group)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, path: String) -> Result<(), String> {
    store::delete_note(&state.root, &path)
}

#[tauri::command]
pub fn create_group(state: State<AppState>, name: String) -> Result<String, String> {
    store::create_group(&state.root, &name)
}

#[tauri::command]
pub fn delete_group(state: State<AppState>, name: String) -> Result<(), String> {
    store::delete_group(&state.root, &name)
}

#[tauri::command]
pub fn search(state: State<AppState>, query: String) -> Result<Vec<SearchHit>, String> {
    store::search(&state.root, &query)
}

// ---------------------------------------------------------------- attachments

/// Attaching a batch reports per-file outcomes rather than failing the lot: dragging in
/// six files should not be undone because the seventh was locked by another program.
#[derive(Serialize)]
pub struct AttachResult {
    pub attached: Vec<FileMeta>,
    pub failed: Vec<String>,
}

#[tauri::command]
pub fn attach_files(
    state: State<AppState>,
    group: String,
    sources: Vec<String>,
) -> Result<AttachResult, String> {
    let mut attached = Vec::new();
    let mut failed = Vec::new();

    for source in sources {
        match files::attach(&state.root, &group, std::path::Path::new(&source)) {
            Ok(meta) => attached.push(meta),
            Err(err) => failed.push(format!("{source}: {err}")),
        }
    }
    Ok(AttachResult { attached, failed })
}

#[tauri::command]
pub fn delete_file(state: State<AppState>, path: String) -> Result<(), String> {
    files::delete_file(&state.root, &path)
}

#[tauri::command]
pub fn import_links(state: State<AppState>, path: String) -> Result<ImportReport, String> {
    files::import_links(&state.root, &path)
}

/// Open an attachment in whatever application the host PC uses for it.
#[tauri::command]
pub fn open_attachment(
    app: tauri::AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), String> {
    let full = files::resolve_attachment(&state.root, &path)?;
    app.opener()
        .open_path(full.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("cannot open that file: {e}"))
}

/// Open a file the user linked by absolute path, which may well not exist on this
/// machine — that is the whole hazard of linking instead of copying.
#[tauri::command]
pub fn open_external_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_file() {
        return Err(format!(
            "{path} is not reachable from this computer. Use \"Bring files in\" while it is."
        ));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("cannot open that file: {e}"))
}

/// Open a web link from the rendered preview.
///
/// The UI intercepts every anchor click and routes it here. Without that, a plain
/// `target="_blank"` would navigate the webview itself and the whole app would vanish
/// behind whatever page the note linked to.
#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let allowed = url.starts_with("http://")
        || url.starts_with("https://")
        || url.starts_with("mailto:");
    if !allowed {
        return Err("only web and mail links can be opened".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("cannot open that link: {e}"))
}

/// Reveal the notes folder itself, so the promise that these are ordinary files you can
/// open anywhere is one click away rather than a paragraph in a README.
#[tauri::command]
pub fn open_notes_folder(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    app.opener()
        .open_path(state.root.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("cannot open the notes folder: {e}"))
}
