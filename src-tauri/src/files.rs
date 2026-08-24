//! Attachments: arbitrary files stored alongside the notes of a group.
//!
//! A group owns its files the same way it owns its notes, so copying one folder takes
//! everything with it. Like `store`, this module is free of Tauri types and takes the
//! notes root as a parameter.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::atomic;
use crate::paths;
use crate::store::TRASH_DIR;

/// Attachments live in this folder inside each group.
pub const FILES_DIR: &str = "_files";

/// A generous ceiling that mainly exists to fail clearly rather than silently: FAT32
/// cannot hold a file of 4 GiB or more, and a flash drive is a bad place to discover
/// that halfway through a copy.
const MAX_ATTACHMENT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Serialize, Clone)]
pub struct FileMeta {
    pub name: String,
    /// Relative to the notes root, forward slashes: `Work/_files/spec.pdf`.
    pub path: String,
    pub group: String,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
}

/// What happened when external links in a note were pulled in.
#[derive(Serialize)]
pub struct ImportReport {
    pub copied: usize,
    /// Links that pointed outside and could not be reached from this machine.
    pub missing: Vec<String>,
}

// ---------------------------------------------------------------- reading

pub fn list_files(root: &Path, group: &str) -> Result<Vec<FileMeta>, String> {
    let dir = root.join(group).join(FILES_DIR);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };

    let mut files: Vec<FileMeta> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file())
        // Skip the ".<name>.tmp" staging files an interrupted copy may have left.
        .filter(|p| !name_of(p).starts_with('.'))
        .filter_map(|p| meta_for(root, &p).ok())
        .collect();

    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(files)
}

pub fn meta_for(root: &Path, full: &Path) -> Result<FileMeta, String> {
    let fs_meta = fs::metadata(full).map_err(|e| format!("cannot stat file: {e}"))?;
    let rel = paths::to_relative(root, full);
    let group = rel.split('/').next().unwrap_or("").to_string();

    Ok(FileMeta {
        name: name_of(full),
        path: rel,
        group,
        size: fs_meta.len(),
        modified: fs_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    })
}

/// Resolve an attachment for opening, refusing anything that is not a real file inside
/// the notes folder.
pub fn resolve_attachment(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let full = paths::resolve(root, rel)?;
    if !full.is_file() {
        return Err("that file is no longer there".into());
    }
    Ok(full)
}

// ---------------------------------------------------------------- writing

/// Copy a file from anywhere on the machine into a group's `_files` folder.
///
/// Copying rather than linking is the whole point: once the file is in here it travels
/// with the drive, which a path pointing at the host PC's Documents folder would not.
pub fn attach(root: &Path, group: &str, source: &Path) -> Result<FileMeta, String> {
    let group = paths::sanitize_group(group)?;
    let dir = root.join(&group).join(FILES_DIR);

    if !source.is_file() {
        return Err(format!("not a file: {}", source.display()));
    }

    // Already sitting in this group's files folder: adding it again would just make a
    // duplicate with a "-2" suffix.
    if source.starts_with(&dir) {
        return meta_for(root, source);
    }

    let size = fs::metadata(source)
        .map_err(|e| format!("cannot read {}: {e}", source.display()))?
        .len();
    if size > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "{} is {} MB, which is too large to attach",
            name_of(source),
            size / (1024 * 1024)
        ));
    }

    let raw = source
        .file_name()
        .ok_or("that file has no name")?
        .to_string_lossy()
        .into_owned();
    let name = paths::sanitize_filename(&raw)?;
    let target = unique_file(&dir, &name);

    atomic::copy_file(source, &target).map_err(|e| format!("cannot copy {raw}: {e}"))?;
    meta_for(root, &target)
}

/// Move an attachment to the trash, mirroring the group it came from.
pub fn delete_file(root: &Path, rel: &str) -> Result<(), String> {
    let full = paths::resolve(root, rel)?;
    if !full.is_file() {
        return Err("that file is no longer there".into());
    }

    let mut segments = rel.split('/');
    let group = segments.next().unwrap_or("loose").to_string();
    if segments.next() != Some(FILES_DIR) {
        return Err("that path is not an attachment".into());
    }

    let trash = root.join(TRASH_DIR).join(&group).join(FILES_DIR);
    fs::create_dir_all(&trash).map_err(|e| format!("cannot create trash folder: {e}"))?;

    let target = unique_file(&trash, &name_of(&full));
    fs::rename(&full, &target).map_err(|e| format!("cannot move file to trash: {e}"))?;
    Ok(())
}

/// Copy the targets of any absolute-path links in a note into the group's `_files`
/// folder, and rewrite the links to point at the copies.
///
/// This is the repair for a note that links out to `C:\Users\...` on one machine: after
/// this runs, the note and everything it references travel together on the drive.
pub fn import_links(root: &Path, note_rel: &str) -> Result<ImportReport, String> {
    let full = paths::resolve(root, note_rel)?;
    let group = note_rel.split('/').next().unwrap_or("").to_string();
    let content = fs::read_to_string(&full).map_err(|e| format!("cannot read note: {e}"))?;

    let mut rebuilt = String::with_capacity(content.len());
    let mut copied = 0usize;
    let mut missing = Vec::new();
    let mut cursor = 0usize;

    // Walk "](" ... ")" pairs. Byte offsets from `find` always land on char boundaries,
    // and ")" is one byte, so slicing here is safe for any UTF-8 content.
    while let Some(found) = content[cursor..].find("](") {
        let open = cursor + found + 2;
        let close = match content[open..].find(')') {
            Some(offset) => open + offset,
            None => break,
        };

        let url = content[open..close].trim();
        let stripped = url.trim_start_matches('<').trim_end_matches('>');

        rebuilt.push_str(&content[cursor..open]);

        if is_absolute_path(stripped) {
            let source = PathBuf::from(stripped);
            match attach(root, &group, &source) {
                Ok(meta) => {
                    rebuilt.push_str(&format!("{FILES_DIR}/{}", meta.name));
                    copied += 1;
                }
                Err(_) => {
                    missing.push(stripped.to_string());
                    rebuilt.push_str(&content[open..close]);
                }
            }
        } else {
            rebuilt.push_str(&content[open..close]);
        }

        rebuilt.push(')');
        cursor = close + 1;
    }
    rebuilt.push_str(&content[cursor..]);

    if copied > 0 {
        atomic::write(&full, rebuilt.as_bytes())
            .map_err(|e| format!("cannot rewrite the note: {e}"))?;
    }
    Ok(ImportReport { copied, missing })
}

// ---------------------------------------------------------------- helpers

fn name_of(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// A path pointing outside the notes folder, on whichever platform wrote it.
///
/// Recognises Windows drive paths, UNC shares, and Unix absolute paths. The Unix case
/// matters as much as the others: a note written on a Mac links to `/Users/...`, and
/// without this that link is not recognised as a file at all — it renders as bare text
/// and "Bring files in" never offers to rescue it.
fn is_absolute_path(url: &str) -> bool {
    let bytes = url.as_bytes();

    // UNC share: two leading backslashes.
    if url.starts_with(r"\\") {
        return true;
    }

    // Unix absolute path. A doubled slash is excluded: "//host/x" is a
    // protocol-relative URL, not a filesystem path.
    if bytes.first() == Some(&b'/') {
        return bytes.get(1) != Some(&b'/');
    }

    // Windows drive path: C:\ or C:/
    bytes.len() > 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// Pick `<name>`, or `<stem>-2.<ext>`, `<stem>-3.<ext>`... when taken.
fn unique_file(dir: &Path, name: &str) -> PathBuf {
    let as_path = Path::new(name);
    let stem = as_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let extension = as_path
        .extension()
        .map(|s| s.to_string_lossy().into_owned());

    let build = |suffix: Option<u32>| {
        let base = match suffix {
            Some(n) => format!("{stem}-{n}"),
            None => stem.clone(),
        };
        match &extension {
            Some(ext) => dir.join(format!("{base}.{ext}")),
            None => dir.join(base),
        }
    };

    let mut candidate = build(None);
    let mut n = 2;
    while candidate.exists() {
        candidate = build(Some(n));
        n += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quicknote-files-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A notes root plus a separate "elsewhere on the machine" folder holding a file
    /// that does not travel with the drive.
    fn fixture(name: &str) -> (PathBuf, PathBuf) {
        let base = scratch(name);
        let root = base.join("notes");
        store::ensure_layout(&root).unwrap();
        let outside = base.join("outside");
        fs::create_dir_all(&outside).unwrap();
        (root, outside)
    }

    #[test]
    fn attaching_copies_the_file_into_the_group() {
        let (root, outside) = fixture("attach");
        let source = outside.join("spec.pdf");
        fs::write(&source, b"pdf bytes").unwrap();

        let meta = attach(&root, "Work", &source).unwrap();
        assert_eq!(meta.path, "Work/_files/spec.pdf");
        assert_eq!(meta.group, "Work");
        assert_eq!(fs::read(root.join("Work").join(FILES_DIR).join("spec.pdf")).unwrap(), b"pdf bytes");

        // The original is untouched: attaching copies, it does not move.
        assert!(source.is_file());
    }

    #[test]
    fn attaching_the_same_name_twice_does_not_overwrite() {
        let (root, outside) = fixture("attach-twice");
        let a = outside.join("a");
        let b = outside.join("b");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("notes.txt"), b"first").unwrap();
        fs::write(b.join("notes.txt"), b"second").unwrap();

        let one = attach(&root, "Work", &a.join("notes.txt")).unwrap();
        let two = attach(&root, "Work", &b.join("notes.txt")).unwrap();

        assert_eq!(one.path, "Work/_files/notes.txt");
        assert_eq!(two.path, "Work/_files/notes-2.txt");

        let files = root.join("Work").join(FILES_DIR);
        assert_eq!(fs::read_to_string(files.join("notes.txt")).unwrap(), "first");
        assert_eq!(fs::read_to_string(files.join("notes-2.txt")).unwrap(), "second");
    }

    #[test]
    fn re_attaching_a_file_already_in_the_group_is_a_no_op() {
        let (root, outside) = fixture("attach-idempotent");
        let source = outside.join("doc.txt");
        fs::write(&source, b"x").unwrap();

        let first = attach(&root, "Work", &source).unwrap();
        let inside = root.join("Work").join(FILES_DIR).join("doc.txt");
        let again = attach(&root, "Work", &inside).unwrap();

        assert_eq!(first.path, again.path);
        assert_eq!(list_files(&root, "Work").unwrap().len(), 1);
    }

    #[test]
    fn listing_files_skips_staging_files() {
        let (root, outside) = fixture("list");
        let source = outside.join("real.txt");
        fs::write(&source, b"x").unwrap();
        attach(&root, "Work", &source).unwrap();
        fs::write(root.join("Work").join(FILES_DIR).join(".half.txt.tmp"), b"x").unwrap();

        let files = list_files(&root, "Work").unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "real.txt");
    }

    #[test]
    fn listing_an_unknown_group_is_empty_not_an_error() {
        let (root, _) = fixture("list-missing");
        assert!(list_files(&root, "NoSuchGroup").unwrap().is_empty());
    }

    #[test]
    fn deleting_moves_the_file_to_trash() {
        let (root, outside) = fixture("delete");
        let source = outside.join("gone.txt");
        fs::write(&source, b"x").unwrap();
        let meta = attach(&root, "Work", &source).unwrap();

        delete_file(&root, &meta.path).unwrap();
        assert!(!root.join("Work").join(FILES_DIR).join("gone.txt").exists());
        assert!(root
            .join(TRASH_DIR)
            .join("Work")
            .join(FILES_DIR)
            .join("gone.txt")
            .is_file());
    }

    #[test]
    fn deleting_refuses_a_path_that_is_not_an_attachment() {
        let (root, _) = fixture("delete-guard");
        let note = store::create_note(&root, "Work", "Real Note").unwrap();
        assert!(delete_file(&root, &note.path).is_err());
        assert!(delete_file(&root, "../../outside.txt").is_err());
    }

    #[test]
    fn import_pulls_external_links_in_and_rewrites_them() {
        let (root, outside) = fixture("import");
        let source = outside.join("chart.png");
        fs::write(&source, b"png bytes").unwrap();

        let note = store::create_note(&root, "Work", "Linked").unwrap();
        let body = format!(
            "# Linked\n\nSee [the chart]({}) and [the site](https://example.com).\n",
            source.display()
        );
        store::save_note(&root, &note.path, &body).unwrap();

        let report = import_links(&root, &note.path).unwrap();
        assert_eq!(report.copied, 1);
        assert!(report.missing.is_empty());

        let rewritten = store::read_note(&root, &note.path).unwrap();
        assert!(rewritten.contains("[the chart](_files/chart.png)"));
        // An ordinary web link is left exactly as it was.
        assert!(rewritten.contains("[the site](https://example.com)"));
        assert!(root.join("Work").join(FILES_DIR).join("chart.png").is_file());
    }

    #[test]
    fn import_reports_links_it_cannot_reach() {
        let (root, _) = fixture("import-missing");
        let note = store::create_note(&root, "Work", "Broken").unwrap();
        store::save_note(
            &root,
            &note.path,
            "# Broken\n\n[missing](C:\\nowhere\\ghost.pdf)\n",
        )
        .unwrap();

        let report = import_links(&root, &note.path).unwrap();
        assert_eq!(report.copied, 0);
        assert_eq!(report.missing.len(), 1);
        // The note is left untouched so the original path stays visible.
        assert!(store::read_note(&root, &note.path)
            .unwrap()
            .contains("C:\\nowhere\\ghost.pdf"));
    }

    #[test]
    fn import_leaves_a_note_without_external_links_alone() {
        let (root, _) = fixture("import-noop");
        let note = store::create_note(&root, "Work", "Plain").unwrap();
        let body = "# Plain\n\nJust [a link](https://example.com) and text.\n";
        store::save_note(&root, &note.path, body).unwrap();

        let report = import_links(&root, &note.path).unwrap();
        assert_eq!(report.copied, 0);
        assert_eq!(store::read_note(&root, &note.path).unwrap(), body);
    }

    #[test]
    fn import_handles_multibyte_content_without_panicking() {
        let (root, outside) = fixture("import-utf8");
        let source = outside.join("file.txt");
        fs::write(&source, b"x").unwrap();

        let note = store::create_note(&root, "Work", "Unicode").unwrap();
        let body = format!(
            "# Unicode\n\n\u{0633}\u{0644}\u{0627}\u{0645} \u{062F}\u{0646}\u{06CC}\u{0627} [f]({})\n",
            source.display()
        );
        store::save_note(&root, &note.path, &body).unwrap();

        let report = import_links(&root, &note.path).unwrap();
        assert_eq!(report.copied, 1);
        assert!(store::read_note(&root, &note.path)
            .unwrap()
            .contains("\u{062F}\u{0646}\u{06CC}\u{0627}"));
    }

    #[test]
    fn absolute_paths_are_recognised() {
        assert!(is_absolute_path(r"C:\Users\me\file.pdf"));
        assert!(is_absolute_path("D:/data/file.pdf"));
        assert!(is_absolute_path(r"\\server\share\file.pdf"));
        assert!(!is_absolute_path("https://example.com"));
        assert!(!is_absolute_path("_files/spec.pdf"));
        assert!(!is_absolute_path(""));
    }

    #[test]
    fn unix_absolute_paths_are_recognised() {
        // A note written on a Mac or Linux box links out like this.
        assert!(is_absolute_path("/Users/ali/Documents/chart.png"));
        assert!(is_absolute_path("/home/ali/notes/spec.pdf"));
        assert!(is_absolute_path("/tmp/x"));

        // Not filesystem paths: protocol-relative URLs and ordinary relative links.
        assert!(!is_absolute_path("//example.com/logo.png"));
        assert!(!is_absolute_path("./local.png"));
        assert!(!is_absolute_path("_files/local.png"));
    }


    #[test]
    fn attachments_do_not_show_up_as_notes() {
        let (root, outside) = fixture("not-a-note");
        let source = outside.join("readme.md");
        fs::write(&source, b"# not a note").unwrap();
        attach(&root, "Work", &source).unwrap();

        let tree = store::list_tree(&root).unwrap();
        let work = tree.iter().find(|g| g.name == "Work").unwrap();
        assert!(
            work.notes.is_empty(),
            "an attached .md leaked into the note list"
        );
    }
}
