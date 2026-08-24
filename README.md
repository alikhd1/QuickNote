# QuickNote

A small note app that lives on a flash drive. One `.exe`, a native window, notes that
save themselves as plain Markdown files right next to the program — and the files you
attach to them stored alongside.

Plug the drive into any Windows PC and your notes are there. Nothing is installed, and
nothing is left behind on the host machine.

---

## Using it

Copy `QuickNote.exe` onto the drive and double-click it. On first run it creates its
own folders beside itself:

```
E:\QuickNote\
  QuickNote.exe
  notes\
    Work\
      _files\            attachments belonging to the Work group
        spec.pdf
      project-alpha.md
    Notes\
      welcome.md
    _trash\
  .cache\                WebView2 scratch, kept on the drive
```

- **Groups are folders**, **notes are `.md` files**, **attachments live in the group's
  `_files` folder.** Open any of them in Notepad or Explorer any time.
- **Back up by copying `notes\`.** That is the whole database, attachments included.
- **The drive letter does not matter.** Everything resolves from the exe's own folder,
  so `E:` today and `F:` tomorrow both just work.

Click the path at the bottom of the sidebar to open the notes folder in Explorer.

### Auto-save

There is no save button. Typing stops for 600 ms and the note is written; it is also
flushed when you leave the editor, switch notes, or close the window. The indicator in
the top-right always shows the true state — `Saving`, `Saved`, or a loud red failure.

Writes are atomic (temp file, flushed to the device, then renamed over the original), so
pulling the drive mid-save leaves either the old file or the new one, never a
half-written one. Attachments are copied the same way.

### Attaching files

Three ways to get a file in:

| How | What happens |
| --- | --- |
| **Drag files onto the window** | Copied into the current group, and linked in the open note |
| **Paperclip on a group header** | Copied into that group. Always copies — a stored file is the thing that travels |
| **Attach button in the toolbar** | Asks whether to copy or link, then puts a Markdown link at your cursor |

**Copy into notes** puts the file on the drive, so it travels with your notes.
**Link where it is** leaves the file alone and writes an absolute path like
`C:\Users\you\Documents\spec.pdf` into the note — convenient on one machine, broken on
the next.

When a note contains such a link, a bar appears above the editor offering **Bring files
in**. That copies every reachable link target into the group's `_files` folder and
rewrites the links to point at the copies, so the note and everything it references
travel together from then on. Links it cannot reach are reported and left untouched, with
the original path still visible so you can go and find the file.

Attached files are listed under their group in the sidebar. Click one to open it in
whatever application the host PC uses for that file type; hover and click `×` to remove
it. As with notes, removing moves it to `_trash` rather than erasing it.

### The title is the filename

The first `# heading` in a note is its title, and the filename follows it —
`# Project Alpha` lives in `project-alpha.md`. Renaming happens when you leave the note,
not on every keystroke.

### Deleting

Deleted notes, groups, and attachments move to `notes\_trash\` rather than being erased.
A flash drive has no Recycle Bin, so nothing here calls "delete" for real. Empty `_trash`
yourself when you are sure.

### Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl` + `S` | Save now (it was going to anyway) |
| `Ctrl` + `N` | New note |
| `Ctrl` + `F` | Search |
| `Ctrl` + `P` | Toggle Markdown preview |
| `Esc` | Clear search |

### Markdown

`# headings`, `**bold**`, `*italic*`, `~~strikethrough~~`, `- lists`, `1. numbered`,
`> quotes`, `` `code` ``, fenced blocks, `---` rules, and `[links](https://example.com)`.

Note text is HTML-escaped before it is rendered, so pasted HTML shows up as text rather
than running. Links are handled by type: web links open in your browser, attachment and
file links open in the relevant application, and anything else — `javascript:` and
friends — is left as literal text rather than becoming a link.

Images are **not** embedded in the preview. `![chart](_files/chart.png)` renders as a
link that opens the image in your usual viewer. Embedding would mean enabling Tauri's
asset protocol and loosening the page's content-security policy, which did not seem a
fair trade for inline thumbnails.

---

## Building

Needs Rust (`x86_64-pc-windows-msvc`) and Visual Studio Build Tools with the VC++ x64
toolset and a Windows SDK. **Node is not required.**

```powershell
.\build.ps1
```

That produces `dist\QuickNote.exe`. Under the hood it is just:

```powershell
cd src-tauri; cargo build --release
```

The frontend is static, so `tauri-build` embeds `web\` straight into the binary — no
bundler, no `node_modules`, no installer.

Run the tests with:

```powershell
cd src-tauri; cargo test
```

They cover the parts worth being sure about: atomic writes and copies leaving no partial
files, the path guard refusing to escape the notes folder, attachments not leaking into
the note list, and link-import handling multi-byte text and unreachable paths.

Regenerate the icon after changing `tools/make-icon.py`:

```powershell
python tools\make-icon.py
```

---

## How it is put together

```
web/            vanilla HTML/CSS/JS, no framework
  md.js         escape-then-render Markdown (no library, no sanitiser needed)
  app.js        UI, auto-save, search, attachments
src-tauri/src/
  main.rs       entry point, WebView2 redirection, command registration
  paths.rs      exe-relative root, slugs, filename cleaning, traversal guard
  atomic.rs     temp + fsync + rename, for both writes and copies
  store.rs      groups and notes over the filesystem
  files.rs      attachments, and pulling external links onto the drive
  commands.rs   the IPC surface
```

Two decisions are worth knowing about, because they are the ones that make it portable:

**Tauri's own storage paths are not used.** `appDataDir()` and the `fs` plugin resolve to
`%APPDATA%` on the *host* PC, which would strand your notes on whatever machine you
plugged into. Instead the notes root comes from `std::env::current_exe()`, and the `fs`
plugin is not installed at all — every file operation goes through this app's own Rust
commands, so there is no route from the UI to an unintended directory.

**WebView2's user-data folder is redirected** to `.cache\` on the drive before the webview
starts, so the host PC gets no `%APPDATA%` folder, no registry keys, and no installer.

Two official plugins are used, narrowly. `dialog` supplies the native file picker and is
the only one the webview can call (`dialog:allow-open`). `opener` opens attachments and
web links in their default applications and is called **only from Rust**, after the path
has been checked, so no permission for it is exposed to the UI at all.

`store.rs` and `files.rs` are free of Tauri types and take their root as a parameter.
That is what would let an Android build (Tauri v2 supports it) reuse this code with a
sandbox directory instead.

---

## Known limitation

The exe needs the **WebView2 runtime** on the host PC. It ships with Windows 11 and
arrives with Edge on Windows 10, so in practice it is everywhere — but a locked-down or
very old machine could lack it, and QuickNote will not start there. That is inherent to
Tauri, or to any WebView2-based app; the fix on such a machine is installing the WebView2
evergreen runtime.
