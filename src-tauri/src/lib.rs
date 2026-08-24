mod atomic;
mod commands;
mod files;
mod paths;
mod store;

use std::path::PathBuf;

/// Shared state. The notes root is resolved once at startup and never re-derived, so
/// every command agrees on where the drive is.
pub struct AppState {
    pub root: PathBuf,
    /// Reported to the UI rather than printed: in a windowed build there is no console
    /// for a startup failure to be seen in.
    pub startup_error: Option<String>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let base = paths::base_dir();

    // WebView2 keeps a user-data folder for cache and cookies. Left to itself it can be
    // created on the host PC; pinning it beside the app keeps whatever machine we plug
    // into clean and keeps the whole thing self-contained on the drive.
    //
    // This must happen before the webview is created, hence before the builder runs.
    // Harmless on macOS and Linux, which do not read it.
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", base.join(".cache"));

    let root = base.join("notes");
    let startup_error = store::ensure_layout(&root).err();

    tauri::Builder::default()
        // dialog: the native file picker, used from the UI to choose attachments.
        // opener: opening an attachment in its default application, used only from
        // Rust, so no permission for it is exposed to the webview.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { root, startup_error })
        .invoke_handler(tauri::generate_handler![
            commands::startup_status,
            commands::list_tree,
            commands::read_note,
            commands::save_note,
            commands::create_note,
            commands::rename_note,
            commands::move_note,
            commands::delete_note,
            commands::create_group,
            commands::delete_group,
            commands::search,
            commands::attach_files,
            commands::delete_file,
            commands::import_links,
            commands::open_attachment,
            commands::open_external_file,
            commands::open_url,
            commands::open_notes_folder,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start QuickNote");
}
