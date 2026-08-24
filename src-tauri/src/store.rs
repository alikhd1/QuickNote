//! Note storage: groups are folders, notes are `.md` files.
//!
//! This module deliberately knows nothing about Tauri and takes the notes root as a
//! parameter. That is what lets a future mobile build point it at a sandbox directory
//! without touching any of the logic below.

use serde::Serialize;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::atomic;
use crate::paths;

/// Deleted notes and groups are moved here. Nothing in this app calls `remove_file` on
/// user content: a flash drive has no Recycle Bin to undo a mistake with.
pub const TRASH_DIR: &str = "_trash";

const NOTE_EXT: &str = "md";
const DEFAULT_GROUP: &str = "Notes";
const TITLE_HEAD_BYTES: u64 = 1024;
const MAX_TITLE_CHARS: usize = 80;

#[derive(Serialize, Clone)]
pub struct NoteMeta {
    /// Relative to the notes root, forward slashes, e.g. `Work/project-alpha.md`.
    pub path: String,
    pub group: String,
    pub title: String,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
    pub size: u64,
}

#[derive(Serialize)]
pub struct Group {
    pub name: String,
    pub notes: Vec<NoteMeta>,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub group: String,
    pub title: String,
    pub snippet: String,
}

// ---------------------------------------------------------------- layout

/// Create the folder layout on first run, including a welcome note explaining where
/// the files actually live.
pub fn ensure_layout(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("cannot create {}: {e}", root.display()))?;
    fs::create_dir_all(root.join(TRASH_DIR)).map_err(|e| format!("cannot create trash: {e}"))?;

    if list_groups(root)?.is_empty() {
        let group = root.join(DEFAULT_GROUP);
        fs::create_dir_all(&group).map_err(|e| format!("cannot create default group: {e}"))?;
        atomic::write(&group.join("welcome.md"), WELCOME.as_bytes())
            .map_err(|e| format!("cannot write welcome note: {e}"))?;
    }
    Ok(())
}

const WELCOME: &str = r#"# Welcome to QuickNote

Everything you type here saves itself. There is no save button.

## Where your notes live

Each note is a plain `.md` file inside the `notes` folder next to `QuickNote.exe`, and
each **group** is simply a folder. Nothing is locked inside this app:

- Open a note in Notepad, or any editor, any time.
- Back everything up by copying the `notes` folder.
- Search them with whatever tool you like.

## Markdown

Type `**bold**`, `*italic*`, `# headings`, `- lists`, `> quotes` and `` `code` ``.
Press **Preview** to see it rendered beside what you are writing.

## Deleting

Deleted notes move into the `_trash` folder rather than vanishing, because a flash
drive has no Recycle Bin. Empty it yourself once you are sure.
"#;

// ---------------------------------------------------------------- reading

pub fn list_groups(root: &Path) -> Result<Vec<String>, String> {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };

    let mut groups: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(str::to_owned))
        .filter(|name| name != TRASH_DIR && !name.starts_with('.'))
        .collect();

    groups.sort_by_key(|a| a.to_lowercase());
    Ok(groups)
}

pub fn list_tree(root: &Path) -> Result<Vec<Group>, String> {
    let mut tree = Vec::new();
    for name in list_groups(root)? {
        let notes = list_notes(root, &name)?;
        tree.push(Group { name, notes });
    }
    Ok(tree)
}

fn list_notes(root: &Path, group: &str) -> Result<Vec<NoteMeta>, String> {
    let dir = root.join(group);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };

    let mut notes: Vec<NoteMeta> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && has_note_ext(p))
        .filter(|p| !file_name_of(p).starts_with('.'))
        .filter_map(|p| meta_for(root, &p).ok())
        .collect();

    // Most recently touched first, so the note you were just in stays at the top.
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

pub fn meta_for(root: &Path, full: &Path) -> Result<NoteMeta, String> {
    let fs_meta = fs::metadata(full).map_err(|e| format!("cannot stat note: {e}"))?;
    let rel = paths::to_relative(root, full);
    let group = rel.split('/').next().unwrap_or("").to_string();

    Ok(NoteMeta {
        path: rel,
        group,
        title: title_of_file(full),
        modified: modified_ms(&fs_meta),
        size: fs_meta.len(),
    })
}

pub fn read_note(root: &Path, rel: &str) -> Result<String, String> {
    let full = paths::resolve(root, rel)?;
    fs::read_to_string(&full).map_err(|e| format!("cannot read note: {e}"))
}

// ---------------------------------------------------------------- writing

pub fn save_note(root: &Path, rel: &str, content: &str) -> Result<NoteMeta, String> {
    let full = paths::resolve(root, rel)?;
    if !full.exists() {
        return Err("note no longer exists".into());
    }
    atomic::write(&full, content.as_bytes()).map_err(|e| format!("cannot save note: {e}"))?;
    meta_for(root, &full)
}

pub fn create_note(root: &Path, group: &str, title: &str) -> Result<NoteMeta, String> {
    let group = paths::sanitize_group(group)?;
    let dir = root.join(&group);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create group folder: {e}"))?;

    let title = if title.trim().is_empty() {
        "Untitled note"
    } else {
        title.trim()
    };
    let full = unique_path(&dir, &paths::slugify(title));
    atomic::write(&full, format!("# {title}\n\n").as_bytes())
        .map_err(|e| format!("cannot create note: {e}"))?;
    meta_for(root, &full)
}

/// Rename the file to match a new title, keeping it in the same group.
///
/// Callers debounce this to blur / note-switch rather than firing per keystroke, so
/// typing a title does not rename the file once per character.
pub fn rename_note(root: &Path, rel: &str, new_title: &str) -> Result<NoteMeta, String> {
    let full = paths::resolve(root, rel)?;
    let dir = full.parent().ok_or("note has no parent folder")?.to_path_buf();

    let desired = paths::slugify(new_title);
    let current_stem = full
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();

    // Already correct, or differs only by the collision suffix we added earlier.
    if current_stem == desired || strip_suffix_number(&current_stem) == desired {
        return meta_for(root, &full);
    }

    let target = unique_path(&dir, &desired);
    fs::rename(&full, &target).map_err(|e| format!("cannot rename note: {e}"))?;
    meta_for(root, &target)
}

pub fn move_note(root: &Path, rel: &str, new_group: &str) -> Result<NoteMeta, String> {
    let full = paths::resolve(root, rel)?;
    let group = paths::sanitize_group(new_group)?;
    let dir = root.join(&group);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create group folder: {e}"))?;

    let stem = full
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let target = unique_path(&dir, &stem);
    if target == full {
        return meta_for(root, &full);
    }
    fs::rename(&full, &target).map_err(|e| format!("cannot move note: {e}"))?;
    meta_for(root, &target)
}

/// Move a note to the trash folder, preserving which group it came from.
pub fn delete_note(root: &Path, rel: &str) -> Result<(), String> {
    let full = paths::resolve(root, rel)?;
    let group = rel.split('/').next().unwrap_or("loose");
    let trash = root.join(TRASH_DIR).join(group);
    fs::create_dir_all(&trash).map_err(|e| format!("cannot create trash folder: {e}"))?;

    let stem = full
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let target = unique_path(&trash, &stem);
    fs::rename(&full, &target).map_err(|e| format!("cannot move note to trash: {e}"))?;
    Ok(())
}

pub fn create_group(root: &Path, name: &str) -> Result<String, String> {
    let name = paths::sanitize_group(name)?;
    let dir = root.join(&name);
    if dir.exists() {
        return Err(format!("group \"{name}\" already exists"));
    }
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create group: {e}"))?;
    Ok(name)
}

/// Move a whole group, notes and all, into the trash.
pub fn delete_group(root: &Path, name: &str) -> Result<(), String> {
    let name = paths::sanitize_group(name)?;
    let dir = root.join(&name);
    if !dir.is_dir() {
        return Err(format!("group \"{name}\" does not exist"));
    }
    let trash = root.join(TRASH_DIR);
    fs::create_dir_all(&trash).map_err(|e| format!("cannot create trash folder: {e}"))?;

    let mut target = trash.join(&name);
    let mut n = 2;
    while target.exists() {
        target = trash.join(format!("{name}-{n}"));
        n += 1;
    }
    fs::rename(&dir, &target).map_err(|e| format!("cannot move group to trash: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------- search

/// Case-insensitive substring search across titles and note bodies.
///
/// A plain scan, with no index to build or keep in sync: a corrupt index on a drive
/// that gets yanked would cost more than the milliseconds an index saves.
pub fn search(root: &Path, query: &str) -> Result<Vec<SearchHit>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let needle: Vec<char> = query.chars().map(lower_char).collect();
    let mut hits = Vec::new();

    for group in list_groups(root)? {
        for note in list_notes(root, &group)? {
            let full = paths::resolve(root, &note.path)?;
            let body = fs::read_to_string(&full).unwrap_or_default();

            let snippet = match find_snippet(&body, &needle) {
                Some(s) => s,
                None => {
                    // Still a hit when the title matches but the body does not.
                    let title: Vec<char> = note.title.chars().map(lower_char).collect();
                    if contains(&title, &needle) {
                        first_line_of(&body)
                    } else {
                        continue;
                    }
                }
            };

            hits.push(SearchHit {
                path: note.path.clone(),
                group: note.group.clone(),
                title: note.title.clone(),
                snippet,
            });
        }
    }
    Ok(hits)
}

// ---------------------------------------------------------------- helpers

fn has_note_ext(p: &Path) -> bool {
    p.extension()
        .map(|e| e.eq_ignore_ascii_case(NOTE_EXT))
        .unwrap_or(false)
}

fn file_name_of(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pick `<stem>.md`, or `<stem>-2.md`, `<stem>-3.md`... when taken.
fn unique_path(dir: &Path, stem: &str) -> PathBuf {
    let stem = if stem.is_empty() { "untitled" } else { stem };
    let mut candidate = dir.join(format!("{stem}.{NOTE_EXT}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{n}.{NOTE_EXT}"));
        n += 1;
    }
    candidate
}

/// `note-3` becomes `note`, so re-titling a file we previously suffixed does not thrash.
fn strip_suffix_number(stem: &str) -> String {
    match stem.rsplit_once('-') {
        Some((head, tail)) if !head.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) => {
            head.to_string()
        }
        _ => stem.to_string(),
    }
}

/// Read only the head of the file: the title sits on the first line, and reading every
/// note in full just to draw the sidebar would be wasteful over USB.
fn title_of_file(path: &Path) -> String {
    let mut buf = Vec::new();
    if let Ok(file) = File::open(path) {
        let _ = file.take(TITLE_HEAD_BYTES).read_to_end(&mut buf);
    }
    let head = String::from_utf8_lossy(&buf);
    title_of(&head).unwrap_or_else(|| {
        path.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Untitled".into())
    })
}

/// The first `# heading`, else the first non-empty line.
pub fn title_of(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let text = trimmed.trim_start_matches('#').trim();
        let text = if text.is_empty() { trimmed } else { text };
        return Some(text.chars().take(MAX_TITLE_CHARS).collect());
    }
    None
}

fn first_line_of(content: &str) -> String {
    content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(140)
        .collect()
}

/// Lowercase a char while keeping a 1:1 mapping, so character offsets stay aligned
/// between the original text and the lowercased text used for matching.
fn lower_char(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

fn contains(hay: &[char], needle: &[char]) -> bool {
    !needle.is_empty() && hay.len() >= needle.len() && hay.windows(needle.len()).any(|w| w == needle)
}

/// Build a short excerpt around the first match. Works in `char` units throughout, so
/// multi-byte text can never be sliced down the middle.
fn find_snippet(body: &str, needle: &[char]) -> Option<String> {
    let original: Vec<char> = body.chars().collect();
    let lowered: Vec<char> = original.iter().copied().map(lower_char).collect();

    if needle.is_empty() || lowered.len() < needle.len() {
        return None;
    }
    let at = lowered.windows(needle.len()).position(|w| w == needle)?;

    let start = at.saturating_sub(40);
    let end = (at + needle.len() + 80).min(original.len());
    let mut snippet: String = original[start..end]
        .iter()
        .map(|&c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c })
        .collect();

    snippet = snippet.trim().to_string();
    if start > 0 {
        snippet.insert(0, '\u{2026}');
    }
    if end < original.len() {
        snippet.push('\u{2026}');
    }
    Some(snippet)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quicknote-store-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn first_run_creates_layout_and_welcome() {
        let root = scratch("layout");
        ensure_layout(&root).unwrap();
        assert!(root.join(TRASH_DIR).is_dir());
        assert_eq!(list_groups(&root).unwrap(), vec![DEFAULT_GROUP.to_string()]);
        assert!(root.join(DEFAULT_GROUP).join("welcome.md").is_file());
    }

    #[test]
    fn trash_is_not_listed_as_a_group() {
        let root = scratch("trash-hidden");
        ensure_layout(&root).unwrap();
        assert!(!list_groups(&root).unwrap().contains(&TRASH_DIR.to_string()));
    }

    #[test]
    fn create_and_read_roundtrip() {
        let root = scratch("roundtrip");
        ensure_layout(&root).unwrap();
        let note = create_note(&root, "Work", "Project Alpha").unwrap();
        assert_eq!(note.path, "Work/project-alpha.md");
        assert_eq!(note.title, "Project Alpha");

        save_note(&root, &note.path, "# Project Alpha\n\nbody text").unwrap();
        assert_eq!(
            read_note(&root, &note.path).unwrap(),
            "# Project Alpha\n\nbody text"
        );
    }

    #[test]
    fn colliding_titles_get_a_suffix() {
        let root = scratch("collide");
        ensure_layout(&root).unwrap();
        let a = create_note(&root, "Work", "Same Name").unwrap();
        let b = create_note(&root, "Work", "Same Name").unwrap();
        assert_eq!(a.path, "Work/same-name.md");
        assert_eq!(b.path, "Work/same-name-2.md");
    }

    #[test]
    fn rename_follows_the_title() {
        let root = scratch("rename");
        ensure_layout(&root).unwrap();
        let note = create_note(&root, "Work", "Old Title").unwrap();
        let renamed = rename_note(&root, &note.path, "New Title").unwrap();
        assert_eq!(renamed.path, "Work/new-title.md");
        assert!(!root.join("Work").join("old-title.md").exists());
    }

    #[test]
    fn rename_to_same_title_is_a_no_op() {
        let root = scratch("rename-noop");
        ensure_layout(&root).unwrap();
        let note = create_note(&root, "Work", "Stable").unwrap();
        let again = rename_note(&root, &note.path, "Stable").unwrap();
        assert_eq!(again.path, note.path);
    }

    #[test]
    fn move_relocates_the_file() {
        let root = scratch("move");
        ensure_layout(&root).unwrap();
        let note = create_note(&root, "Work", "Portable").unwrap();
        let moved = move_note(&root, &note.path, "Personal").unwrap();
        assert_eq!(moved.path, "Personal/portable.md");
        assert!(!root.join("Work").join("portable.md").exists());
        assert!(root.join("Personal").join("portable.md").is_file());
    }

    #[test]
    fn delete_moves_to_trash_and_never_destroys() {
        let root = scratch("delete");
        ensure_layout(&root).unwrap();
        let note = create_note(&root, "Work", "Doomed").unwrap();
        delete_note(&root, &note.path).unwrap();
        assert!(!root.join("Work").join("doomed.md").exists());
        assert!(root.join(TRASH_DIR).join("Work").join("doomed.md").is_file());
    }

    #[test]
    fn deleting_a_group_keeps_its_notes_in_trash() {
        let root = scratch("delete-group");
        ensure_layout(&root).unwrap();
        create_note(&root, "Doomed", "Inside").unwrap();
        delete_group(&root, "Doomed").unwrap();
        assert!(!root.join("Doomed").exists());
        assert!(root.join(TRASH_DIR).join("Doomed").join("inside.md").is_file());
    }

    #[test]
    fn saving_a_missing_note_errors_rather_than_resurrecting_it() {
        let root = scratch("missing");
        ensure_layout(&root).unwrap();
        assert!(save_note(&root, "Work/ghost.md", "body").is_err());
    }

    #[test]
    fn search_finds_body_matches_with_a_snippet() {
        let root = scratch("search");
        ensure_layout(&root).unwrap();
        let note = create_note(&root, "Work", "Meeting").unwrap();
        save_note(
            &root,
            &note.path,
            "# Meeting\n\nDiscussed the quarterly budget today.",
        )
        .unwrap();

        let hits = search(&root, "QUARTERLY").unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.to_lowercase().contains("quarterly"));
    }

    #[test]
    fn search_handles_multibyte_text_without_panicking() {
        let root = scratch("search-utf8");
        ensure_layout(&root).unwrap();
        let note = create_note(&root, "Work", "Unicode").unwrap();
        save_note(
            &root,
            &note.path,
            "# Unicode\n\nsalaam \u{062F}\u{0646}\u{06CC}\u{0627} then more text follows.",
        )
        .unwrap();
        let hits = search(&root, "\u{062F}\u{0646}\u{06CC}\u{0627}").unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn search_ignores_notes_that_do_not_match() {
        let root = scratch("search-miss");
        ensure_layout(&root).unwrap();
        let note = create_note(&root, "Work", "Nothing").unwrap();
        save_note(&root, &note.path, "# Nothing\n\nplain body").unwrap();
        assert!(search(&root, "zzzznotpresent").unwrap().is_empty());
    }

    #[test]
    fn title_prefers_the_heading() {
        assert_eq!(title_of("# Real Title\n\nbody").unwrap(), "Real Title");
        assert_eq!(title_of("\n\nplain first line").unwrap(), "plain first line");
        assert!(title_of("   \n  \n").is_none());
    }

    #[test]
    fn traversal_is_refused_at_the_store_boundary() {
        let root = scratch("traversal");
        ensure_layout(&root).unwrap();
        assert!(read_note(&root, "../../secrets.md").is_err());
        assert!(save_note(&root, "..\\escape.md", "x").is_err());
    }
}
