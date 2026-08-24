//! Path resolution and sanitising.
//!
//! Everything here is deliberately free of Tauri types so the storage layer can be
//! reused on another platform (e.g. an Android build) by handing it a different root.

use std::path::{Component, Path, PathBuf};

/// Windows device names that cannot be used as filenames, whatever the extension.
const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// The directory the app's notes folder sits beside.
///
/// Every path in the app is resolved from here, never from the current directory:
/// double-clicking an exe can hand the process a working directory anywhere on the
/// system, which is the classic way a "portable" app ends up writing to the host PC.
/// Resolving from the executable is also what makes the drive letter irrelevant — `E:`
/// and `F:` produce the same layout with no reconfiguration.
///
/// "Beside the executable" needs adjusting once the app is bundled, though, and getting
/// this wrong would put a user's notes somewhere they would never find them:
///
/// - **macOS**: a bundled app lives at `QuickNote.app/Contents/MacOS/quick-note`, so the
///   directory beside the binary is *inside* the bundle. Notes written there would be
///   destroyed by the next update and invisible in Finder. Step out to where the `.app`
///   itself sits.
/// - **Linux AppImage**: the binary runs from a temporary mount that disappears on exit.
///   `$APPIMAGE` holds the real path of the AppImage file, which is what the user
///   actually copied onto their drive.
pub fn base_dir() -> PathBuf {
    // An AppImage's own path, when we are running as one.
    #[cfg(target_os = "linux")]
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if let Some(parent) = Path::new(&appimage).parent() {
            return parent.to_path_buf();
        }
    }

    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    if dir.ends_with("Contents/MacOS") {
        // .../QuickNote.app/Contents/MacOS -> .../  (three levels out)
        if let Some(beside_bundle) = dir.parent().and_then(Path::parent).and_then(Path::parent) {
            return beside_bundle.to_path_buf();
        }
    }

    dir
}

/// Turn a relative path from the UI into an absolute path guaranteed to sit inside
/// `root`.
///
/// The IPC boundary is local, but that is not a reason to trust it: a bug in the UI
/// should not be able to reach outside the notes folder. Only plain path segments are
/// accepted — anything absolute, any `..`, and any Windows drive prefix is rejected
/// rather than normalised away.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.trim().is_empty() {
        return Err("empty path".into());
    }
    let candidate = Path::new(rel);
    let mut out = root.to_path_buf();

    for component in candidate.components() {
        match component {
            Component::Normal(segment) => {
                let segment = segment.to_str().ok_or("path is not valid UTF-8")?;
                if segment == "." || segment == ".." {
                    return Err(format!("illegal path segment: {segment}"));
                }
                out.push(segment);
            }
            other => return Err(format!("illegal path component: {other:?}")),
        }
    }

    // Belt and braces: even with the loop above, confirm we did not escape.
    if !out.starts_with(root) {
        return Err("path escapes the notes folder".into());
    }
    Ok(out)
}

/// Present a path back to the UI relative to `root`, always with forward slashes so
/// the frontend never has to care about Windows separators.
pub fn to_relative(root: &Path, full: &Path) -> String {
    full.strip_prefix(root)
        .unwrap_or(full)
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Derive a filesystem-safe stem from a note title.
///
/// Unicode letters are kept rather than stripped, so a title written in any script
/// still produces a filename you can recognise in Explorer.
pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut pending_dash = false;

    for ch in title.chars() {
        if ch.is_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.extend(ch.to_lowercase());
        } else {
            pending_dash = true;
        }
    }

    let trimmed: String = out.trim_matches('-').chars().take(60).collect();
    let trimmed = trimmed.trim_matches('-').to_string();

    if trimmed.is_empty() {
        return "untitled".into();
    }
    if RESERVED.contains(&trimmed.as_str()) {
        return format!("{trimmed}-note");
    }
    trimmed
}

/// Sanitise the name of an attached file, keeping its extension intact.
///
/// Unlike `slugify` this preserves the name the user recognises — an attachment called
/// `Q3 Report.pdf` should still look like that in Explorer — and only removes what a
/// Windows filesystem will not accept.
pub fn sanitize_filename(name: &str) -> Result<String, String> {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .filter(|c| !c.is_control())
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();

    if cleaned.is_empty() {
        return Err("file name is empty".into());
    }

    let as_path = Path::new(&cleaned);
    let raw_stem = as_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = as_path
        .extension()
        .map(|s| s.to_string_lossy().into_owned());

    let mut stem: String = raw_stem.chars().take(80).collect();
    let stem_trimmed = stem.trim().to_string();
    stem = if stem_trimmed.is_empty() {
        "file".to_string()
    } else {
        stem_trimmed
    };
    if RESERVED.contains(&stem.to_lowercase().as_str()) {
        stem.push_str("-file");
    }

    Ok(match extension {
        Some(ext) => {
            let ext: String = ext.chars().take(16).collect();
            format!("{stem}.{ext}")
        }
        None => stem,
    })
}

/// Sanitise a group (folder) name typed by the user.
pub fn sanitize_group(name: &str) -> Result<String, String> {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();

    if cleaned.is_empty() {
        return Err("group name is empty".into());
    }
    if cleaned == crate::store::TRASH_DIR {
        return Err(format!("\"{}\" is reserved", crate::store::TRASH_DIR));
    }
    if RESERVED.contains(&cleaned.to_lowercase().as_str()) {
        return Err(format!("\"{cleaned}\" is a reserved Windows name"));
    }
    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        PathBuf::from(if cfg!(windows) { r"C:\drive\notes" } else { "/drive/notes" })
    }

    #[test]
    fn accepts_plain_relative_paths() {
        let got = resolve(&root(), "Work/note.md").unwrap();
        assert_eq!(got, root().join("Work").join("note.md"));
    }

    #[test]
    fn rejects_parent_traversal() {
        assert!(resolve(&root(), "../secrets.md").is_err());
        assert!(resolve(&root(), "Work/../../secrets.md").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        assert!(resolve(&root(), "/etc/passwd").is_err());
        if cfg!(windows) {
            assert!(resolve(&root(), r"C:\Windows\System32\drivers\etc\hosts").is_err());
        }
    }

    #[test]
    fn rejects_empty() {
        assert!(resolve(&root(), "").is_err());
        assert!(resolve(&root(), "   ").is_err());
    }

    #[test]
    fn slug_is_filesystem_safe() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("  spaced   out  "), "spaced-out");
        assert_eq!(slugify("***"), "untitled");
        assert_eq!(slugify("CON"), "con-note");
        assert_eq!(slugify("a/b\\c:d"), "a-b-c-d");
    }

    #[test]
    fn slug_keeps_non_latin_scripts() {
        assert_eq!(slugify("یادداشت"), "یادداشت");
    }

    #[test]
    fn slug_is_length_capped() {
        assert!(slugify(&"x".repeat(500)).len() <= 60);
    }

    #[test]
    fn group_names_are_sanitised() {
        assert_eq!(sanitize_group(" Work ").unwrap(), "Work");
        assert_eq!(sanitize_group("a/b").unwrap(), "ab");
        assert!(sanitize_group("").is_err());
        assert!(sanitize_group("...").is_err());
        assert!(sanitize_group("_trash").is_err());
    }

    #[test]
    fn attachment_names_keep_their_extension() {
        assert_eq!(sanitize_filename("Q3 Report.pdf").unwrap(), "Q3 Report.pdf");
        assert_eq!(sanitize_filename("a:b*c?.png").unwrap(), "abc.png");
        assert_eq!(sanitize_filename("report.final.docx").unwrap(), "report.final.docx");
        // Case is preserved: this function keeps the name the user recognises, unlike
        // slugify. "CON-file.txt" is no longer a reserved device name, which is the
        // only thing the suffix is there to fix.
        assert_eq!(sanitize_filename("CON.txt").unwrap(), "CON-file.txt");
        assert!(sanitize_filename("").is_err());
        assert!(sanitize_filename("///").is_err());
    }

    #[test]
    fn attachment_names_are_length_capped() {
        let long = "x".repeat(400) + ".pdf";
        let got = sanitize_filename(&long).unwrap();
        assert!(got.len() <= 100, "unexpectedly long: {}", got.len());
        assert!(got.ends_with(".pdf"));
    }

    #[test]
    fn relative_uses_forward_slashes() {
        let full = root().join("Work").join("note.md");
        assert_eq!(to_relative(&root(), &full), "Work/note.md");
    }
}
