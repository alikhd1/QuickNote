# QuickNote

A small note app that lives on a flash drive. One `.exe`, a native window, notes that
save themselves as plain Markdown files right next to the program — and the files you
attach to them stored alongside.

Plug the drive into any Windows PC and your notes are there. Nothing is installed, and
none of your notes, attachments or cache ever touch the host machine — with one measured
exception noted under [Known limitations](#known-limitations).

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

### On macOS and Linux

The same idea, with one adjustment each. A macOS app is a bundle, so the executable
sits inside `QuickNote.app/Contents/MacOS/`; notes go beside the `.app` itself rather
than inside it, where they would be invisible in Finder and wiped by the next update. A
Linux AppImage runs from a temporary mount that disappears on exit, so notes go beside
the `.AppImage` file. Either way, the folder you can see is the folder your notes are
in.

### Auto-save

There is no save button. Typing stops for 600 ms and the note is written; it is also
flushed when you leave the editor, switch notes, or close the window. The indicator in
the top-right always shows the true state — `Saving`, `Saved`, or a loud red failure.

Writes are atomic (temp file, flushed to the device, then renamed over the original), so
pulling the drive mid-save leaves either the old file or the new one, never a
half-written one. Attachments are copied the same way.

### Editing a note outside QuickNote

QuickNote does not watch the filesystem, so a note you change in another editor while
QuickNote has it open will not update on screen by itself.

What it will not do is overwrite you. Every save carries the modified time and size the
app last saw; if the file on disk no longer matches, **nothing is written**. A bar
appears offering **Keep mine** or **Reload from disk**, and auto-save pauses until you
choose — so both versions still exist while you decide.

The check compares size as well as timestamp, because FAT32 records modification times
to a two-second resolution and an edit made moments after a save can otherwise carry an
identical timestamp.

To pick up notes or attachments added externally, use any action that rebuilds the
sidebar — creating, deleting, moving, or attaching — or reopen the app.

### If the drive is unplugged while the app is open

Saves fail loudly rather than silently: the status turns red, a banner explains, and the
change stays pending in memory so the next attempt retries it. Plug the drive back in on
the same letter and the next keystroke saves normally.

One caveat: the notes folder is located once, at startup. If the drive returns as a
different letter, the app keeps writing to the old path for the rest of the session —
close QuickNote and reopen it from the drive to pick up the new location. Note also that
the executable is itself running from the drive, so unplugging mid-session is worth
avoiding regardless of what the app does.

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
whatever application the host PC uses for that file type. Hovering a file reveals two
actions: the folder icon shows it in Finder or Explorer, and `×` removes it. As with
notes, removing moves it to `_trash` rather than erasing it.

"Show in folder" is the escape hatch for a host PC whose file associations send
something somewhere unhelpful — a `.png` set to open in a text editor, say. QuickNote
asks the operating system for the default handler and deliberately does not second-guess
it, so from the folder you can open the file with whatever you like.

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

Attached images render inline. `![chart](_files/chart.png)` shows the picture;
`[chart](_files/chart.png)` — the same target without the `!` — stays a link, which is
ordinary Markdown and leaves the choice with you. Clicking an inline image still opens
the full-size file in your usual viewer.

This uses Tauri's asset protocol, granted at runtime to the notes folder alone rather
than configured with a blanket scope, and the content-security policy widens `img-src`
only. `script-src` stays `'self'`, so images may load but note content still cannot
execute.

---

## Building

Needs:

- Rust (stable) and a C toolchain for your platform. On Windows that means Visual
  Studio Build Tools with the VC++ x64 workload and a Windows SDK.
- Node 24 and npm.
- On Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev`

```bash
npm install
npm run build                                  # type-check and bundle the UI to dist/
cargo build --release --manifest-path src-tauri/Cargo.toml
```

The portable binary lands at `src-tauri/target/release/quick-note[.exe]`. That is the
one to put on a drive.

Run `npm run build` before `cargo build`, not after: the frontend is embedded into the
binary at compile time, so cargo fails outright if `dist/` is not there yet, and builds
a stale UI into the binary if it is out of date.

To produce the installers as well, use the Tauri CLI instead — it runs the frontend
build itself and then bundles:

```bash
npm run tauri build       # binary + installers under src-tauri/target/release/bundle/
```

Useful individual commands:

```bash
npm run dev          # Vite alone, on port 1420
npm run tauri dev    # the real window, with hot reload
npm run typecheck    # tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
```

The Rust tests cover the parts worth being sure about: atomic writes and copies leaving
no partial files, the path guard refusing to escape the notes folder, attachments not
leaking into the note list, and link-import handling multi-byte text and unreachable
paths.

Regenerate the icons after changing `tools/make-icon.py`:

```bash
python tools/make-icon.py
```

It writes the PNG set, the Windows `.ico` and the macOS `.icns` from one drawing, with
no dependency on Pillow or on `tauri icon`.

### Development

`npm run tauri dev` gives hot reload. One caveat: the production `csp` in
`tauri.conf.json` sets `script-src 'self'`, and React's dev-mode refresh injects an
inline script that this blocks. If dev mode comes up blank, relax the `csp` field
temporarily — and put it back before building a release, since that strict policy is
part of why note content can never execute.

---

## CI and releases

Three workflows under `.github/workflows/`:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | push to `main`, PRs | Type-check, build the frontend, `cargo check` and `cargo test` on Windows, macOS and Linux |
| `build.yml` | manual (Actions tab) | Cross-platform installers plus portable binaries as downloadable artifacts; optionally drafts a release |
| `release.yml` | pushing a `v*` tag | Builds every platform and publishes a GitHub release |

CI runs on all three platforms deliberately. The notes folder is located differently on
each — a macOS `.app` bundle and a Linux AppImage both need special handling — and that
code only ever gets compiled in CI.

To cut a release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The release gets the installers for every platform, plus `QuickNote-portable.exe` for
Windows. macOS and Linux already ship portable forms — the `.app` inside the `.dmg`, and
the `.AppImage` — so they need no separate upload.

Both `ci.yml` and `release.yml` use `npm ci`, which requires `package-lock.json` to be
committed. Run `npm install` once and commit the lockfile, or CI will fail on the first
run.

Nothing here is code-signed. Windows SmartScreen and macOS Gatekeeper will warn about
the downloads until certificates are added.

---

## How it is put together

```
src/                        React + TypeScript frontend
  types.ts                  mirrors of the structs Rust serialises
  api.ts                    typed wrappers; the only file that calls invoke
  markdown.ts               escape-then-render Markdown (no library, no sanitiser)
  hooks/useAutoSave.ts      debounced save and filename settling
  components/               Sidebar, Toolbar, Preview, Dialogs
src-tauri/src/
  main.rs       thin desktop entry point
  lib.rs        run(): WebView2 redirection, plugins, command registration
  paths.rs      where the notes root lives, slugs, filename cleaning, traversal guard
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

**WebView2's user-data folder is redirected** to `.cache/` on the drive before the
webview starts. That is the one that matters: it is where cache, cookies and local
storage would otherwise accumulate on the host PC, and it can grow to tens of
megabytes. No registry keys are written and no installer runs.

Two official plugins are used, narrowly. `dialog` supplies the native file picker and is
the only one the webview can call (`dialog:allow-open`). `opener` opens attachments and
web links in their default applications and is called **only from Rust**, after the path
has been checked, so no permission for it is exposed to the UI at all.

`store.rs` and `files.rs` are free of Tauri types and take their root as a parameter.
That is what would let an Android build (Tauri v2 supports it) reuse this code with a
sandbox directory instead.

---

## Known limitations

### One empty directory on the host

Running the app creates `%LOCALAPPDATA%/com.quicknote.portable/` on whatever PC you plug
into. The Tauri runtime creates it during startup from the app identifier, before any of
our code could intervene.

It stays **empty** — verified by running the release binary in a scratch folder with the
working directory set elsewhere, then inspecting it. Notes, attachments and the webview
cache all go to the drive as intended. So nothing of yours leaks, but the claim is "no
data left behind", not "no trace left behind".

### The host webview

QuickNote renders through the host's own webview rather than shipping one, which is why
the binary is small enough to live on a drive. The cost is a runtime dependency:

- **Windows** needs the **WebView2 runtime**. It ships with Windows 11 and arrives with
  Edge on Windows 10, so in practice it is everywhere — but a locked-down or very old
  machine could lack it, and QuickNote will not start there. The fix is installing the
  WebView2 evergreen runtime.
- **macOS** uses WKWebView, which is always present.
- **Linux** needs `webkit2gtk` 4.1. The AppImage does not bundle it, so a very minimal
  distribution may need it installed.

The Windows path is verified: the release binary was run from a scratch folder with
its working directory deliberately set elsewhere, and it created `notes/` and
`.cache/` beside itself as intended. The macOS and Linux equivalents are compiled by
CI but have not been run.
