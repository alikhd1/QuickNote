//! Crash-safe file writing for removable media.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

/// Write `data` to `target` so that an interrupted write cannot corrupt it.
///
/// The sequence is: write a temp file *in the same directory*, flush it all the way to
/// the physical device with `sync_all`, then rename it over the target. Rename within a
/// single volume is atomic on NTFS and FAT32, and on Windows `fs::rename` replaces an
/// existing file. So a drive pulled at any instant leaves either the complete old file
/// or the complete new one — never a half-written one.
///
/// The temp file must live in the same directory as the target: a rename across volumes
/// is a copy plus delete, which is exactly the non-atomic behaviour we are avoiding.
pub fn write(target: &Path, data: &[u8]) -> io::Result<()> {
    let dir = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    fs::create_dir_all(dir)?;

    let file_name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?
        .to_string_lossy()
        .into_owned();
    let tmp = dir.join(format!(".{file_name}.tmp"));

    // Scoped so the handle is closed before the rename; Windows will not rename over a
    // file that still has an open handle.
    let write_result = (|| -> io::Result<()> {
        let mut file = File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()
    })();

    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }

    if let Err(e) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// Copy a file into place with the same guarantees as `write`.
///
/// `fs::copy` streams, so this stays cheap on a large attachment, but it does not flush
/// to the device and it writes straight to the destination name. Going through a temp
/// file means a drive pulled mid-copy never leaves a half-copied attachment sitting
/// there looking complete.
pub fn copy_file(source: &Path, target: &Path) -> io::Result<()> {
    let dir = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    fs::create_dir_all(dir)?;

    let file_name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?
        .to_string_lossy()
        .into_owned();
    let tmp = dir.join(format!(".{file_name}.tmp"));

    let staged = (|| -> io::Result<()> {
        fs::copy(source, &tmp)?;
        let handle = fs::OpenOptions::new().write(true).open(&tmp)?;
        handle.sync_all()
    })();

    if let Err(e) = staged {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }

    if let Err(e) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("quicknote-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_new_file() {
        let dir = scratch("new");
        let target = dir.join("note.md");
        write(&target, b"# Hello").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "# Hello");
    }

    #[test]
    fn replaces_existing_file() {
        let dir = scratch("replace");
        let target = dir.join("note.md");
        write(&target, b"first").unwrap();
        write(&target, b"second").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = scratch("clean");
        write(&dir.join("note.md"), b"body").unwrap();
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
    }

    #[test]
    fn creates_missing_directories() {
        let dir = scratch("mkdir");
        let target = dir.join("Group").join("note.md");
        write(&target, b"body").unwrap();
        assert!(target.exists());
    }

    #[test]
    fn copies_a_file_and_cleans_up() {
        let dir = scratch("copy");
        let source = dir.join("source.bin");
        fs::write(&source, b"attachment bytes").unwrap();

        let target = dir.join("files").join("copied.bin");
        copy_file(&source, &target).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"attachment bytes");
        let leftovers: Vec<_> = fs::read_dir(target.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
    }

    #[test]
    fn copy_replaces_an_existing_target() {
        let dir = scratch("copy-replace");
        let source = dir.join("source.bin");
        fs::write(&source, b"new").unwrap();
        let target = dir.join("target.bin");
        fs::write(&target, b"old").unwrap();

        copy_file(&source, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn copy_of_a_missing_source_fails_without_creating_the_target() {
        let dir = scratch("copy-missing");
        let target = dir.join("target.bin");
        assert!(copy_file(&dir.join("nope.bin"), &target).is_err());
        assert!(!target.exists());
    }

    #[test]
    fn survives_a_large_write() {
        let dir = scratch("large");
        let target = dir.join("big.md");
        let body = "x".repeat(2 * 1024 * 1024);
        write(&target, body.as_bytes()).unwrap();
        assert_eq!(fs::metadata(&target).unwrap().len(), body.len() as u64);
    }
}
