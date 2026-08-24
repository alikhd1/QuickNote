// QuickNote UI.
//
// Every filesystem operation goes through a Rust command; this file never touches a
// path directly. All rendering of user text uses textContent or the escaping markdown
// renderer, so note contents can never become markup.

(function () {
  "use strict";

  if (!window.__TAURI__) {
    document.body.textContent =
      "QuickNote must be run from QuickNote.exe, not opened as a file in a browser.";
    return;
  }

  var invoke = window.__TAURI__.core.invoke;
  var appWindow = window.__TAURI__.window.getCurrentWindow();

  var SAVE_DEBOUNCE_MS = 600;
  var PREVIEW_DEBOUNCE_MS = 90;
  var SEARCH_DEBOUNCE_MS = 200;

  var el = function (id) {
    return document.getElementById(id);
  };

  var editor = el("editor");
  var preview = el("preview");
  var workspace = el("workspace");
  var emptyState = el("empty");
  var treeEl = el("tree");
  var statusEl = el("status");
  var crumbEl = el("crumb");
  var searchEl = el("search");
  var moveSelect = el("move-group");
  var previewBtn = el("toggle-preview");
  var deleteBtn = el("delete-note");
  var bannerEl = el("banner");
  var rootPathEl = el("root-path");
  var attachBtn = el("attach");
  var importBar = el("import-bar");
  var importBtn = el("import-links");
  var dropOverlay = el("drop-overlay");

  var state = {
    tree: [],
    current: null, // NoteMeta of the open note
    dirty: false,
    saving: false,
    saveTimer: null,
    previewTimer: null,
    searchTimer: null,
    previewOn: false,
    searching: false,
  };

  // ------------------------------------------------------------ helpers

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function showBanner(message) {
    bannerEl.textContent = message;
    bannerEl.classList.remove("hidden");
  }

  function hideBanner() {
    bannerEl.classList.add("hidden");
  }

  /// Mirrors the Rust title rule: the first `# heading`, else the first non-empty line.
  function titleOf(text) {
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].trim();
      if (!trimmed) continue;
      var stripped = trimmed.replace(/^#+/, "").trim();
      return (stripped || trimmed).slice(0, 80);
    }
    return "";
  }

  function findMeta(path) {
    for (var g = 0; g < state.tree.length; g++) {
      var notes = state.tree[g].notes;
      for (var n = 0; n < notes.length; n++) {
        if (notes[n].path === path) return notes[n];
      }
    }
    return null;
  }

  function firstNote() {
    for (var g = 0; g < state.tree.length; g++) {
      if (state.tree[g].notes.length) return state.tree[g].notes[0];
    }
    return null;
  }

  function groupNames() {
    return state.tree.map(function (g) {
      return g.name;
    });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /// True when the note links to an absolute path — a file that will not travel with
  /// the drive. Mirrors `files::is_absolute_path` on the Rust side.
  function hasExternalLinks(text) {
    return /\]\(\s*(?:[a-zA-Z]:[\\/]|\\\\)[^)\n]*\)/.test(String(text));
  }

  function insertAtCursor(text) {
    var start = editor.selectionStart;
    var end = editor.selectionEnd;
    editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
    editor.selectionStart = editor.selectionEnd = start + text.length;
    scheduleSave();
    schedulePreview();
    updateImportBar();
  }

  function updateImportBar() {
    var show = !!state.current && hasExternalLinks(editor.value);
    importBar.classList.toggle("hidden", !show);
  }

  // ------------------------------------------------------------ dialogs

  function ask(title, initial, okLabel) {
    var dialog = el("ask");
    var input = el("ask-input");
    el("ask-title").textContent = title;
    el("ask-ok").textContent = okLabel || "OK";
    input.value = initial || "";
    dialog.returnValue = "cancel";

    return new Promise(function (resolve) {
      function onClose() {
        dialog.removeEventListener("close", onClose);
        var value = input.value.trim();
        resolve(dialog.returnValue === "ok" && value ? value : null);
      }
      dialog.addEventListener("close", onClose);
      dialog.showModal();
      input.focus();
      input.select();
    });
  }

  function confirmAction(title, body, okLabel) {
    var dialog = el("confirm");
    el("confirm-title").textContent = title;
    el("confirm-body").textContent = body;
    el("confirm-ok").textContent = okLabel || "Delete";
    dialog.returnValue = "cancel";

    return new Promise(function (resolve) {
      function onClose() {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue === "ok");
      }
      dialog.addEventListener("close", onClose);
      dialog.showModal();
    });
  }

  /// Three-way dialog. Resolves to "copy", "link" or "cancel".
  function chooseAttachMode(count) {
    var dialog = el("choose");
    el("choose-body").textContent =
      count === 1
        ? "Copying puts the file on the drive so it travels with your notes. Linking leaves it where it is, and the link will break on another computer."
        : "Copying puts these " +
          count +
          " files on the drive so they travel with your notes. Linking leaves them where they are, and the links will break on another computer.";
    dialog.returnValue = "cancel";

    return new Promise(function (resolve) {
      function onClose() {
        dialog.removeEventListener("close", onClose);
        resolve(dialog.returnValue || "cancel");
      }
      dialog.addEventListener("close", onClose);
      dialog.showModal();
    });
  }

  // ------------------------------------------------------------ saving

  function scheduleSave() {
    state.dirty = true;
    setStatus("Unsaved");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  async function flush() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (!state.current || !state.dirty || state.saving) return;

    var path = state.current.path;
    var content = editor.value;
    state.saving = true;
    setStatus("Saving");

    try {
      var meta = await invoke("save_note", { path: path, content: content });
      state.saving = false;
      hideBanner();

      // The user may have typed more while the write was in flight.
      if (editor.value === content) {
        state.dirty = false;
        setStatus("Saved", "ok");
      } else {
        scheduleSave();
      }

      if (state.current && state.current.path === path) {
        var titleChanged = meta.title !== state.current.title;
        state.current = meta;
        updateChrome();
        if (titleChanged) await loadTree();
      }
    } catch (err) {
      state.saving = false;
      state.dirty = true; // keep the content pending so the next attempt retries
      setStatus("Save failed", "error");
      showBanner("Could not save this note: " + err);
    }
  }

  // Clicking a note in the sidebar fires the editor's blur *and* openNote, so two
  // save-then-rename cycles can overlap. Serialising them on one chain keeps a rename
  // from running against a path the other cycle has already moved.
  var settleChain = Promise.resolve();

  function flushAndSettle() {
    settleChain = settleChain
      .catch(function () {})
      .then(doFlushAndSettle);
    return settleChain;
  }

  /// Save, then bring the filename into line with the title.
  ///
  /// Renaming is deliberately not part of `flush`: doing it on every keystroke would
  /// rename the file once per character while a title is being typed.
  async function doFlushAndSettle() {
    await flush();
    if (!state.current || state.dirty) return;

    var wanted = titleOf(editor.value);
    if (!wanted || wanted === state.current.title) return;

    try {
      state.current = await invoke("rename_note", {
        path: state.current.path,
        title: wanted,
      });
      updateChrome();
      await loadTree();
    } catch (err) {
      // The content is already safely on disk; a failed rename is cosmetic.
      showBanner("Could not rename the file: " + err);
    }
  }

  // ------------------------------------------------------------ rendering

  function updateChrome() {
    var has = !!state.current;
    workspace.classList.toggle("hidden", !has);
    emptyState.classList.toggle("hidden", has);
    deleteBtn.disabled = !has;
    previewBtn.disabled = !has;
    moveSelect.disabled = !has;
    attachBtn.disabled = !has;
    editor.disabled = !has;
    updateImportBar();

    crumbEl.textContent = has ? state.current.group + "  /  " + state.current.title : "";
    if (has) moveSelect.value = state.current.group;

    try {
      appWindow.setTitle(has ? state.current.title + " — QuickNote" : "QuickNote");
    } catch (e) {
      /* the title is decoration; never let it break the app */
    }
  }

  function renderMoveOptions() {
    moveSelect.textContent = "";
    groupNames().forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      moveSelect.appendChild(option);
    });
    if (state.current) moveSelect.value = state.current.group;
  }

  function renderTree() {
    treeEl.textContent = "";

    if (!state.tree.length) {
      var none = document.createElement("div");
      none.className = "tree-empty";
      none.textContent = "No groups yet.";
      treeEl.appendChild(none);
      return;
    }

    state.tree.forEach(function (group) {
      var wrap = document.createElement("div");
      wrap.className = "group";

      var head = document.createElement("div");
      head.className = "group-head";

      var name = document.createElement("span");
      name.className = "group-name";
      name.textContent = group.name;
      head.appendChild(name);

      var add = document.createElement("button");
      add.className = "group-action";
      add.type = "button";
      add.title = "New note in " + group.name;
      add.textContent = "+";
      add.addEventListener("click", function () {
        newNote(group.name);
      });
      head.appendChild(add);

      var clip = document.createElement("button");
      clip.className = "group-action";
      clip.type = "button";
      clip.title = "Attach files to " + group.name;
      clip.textContent = "\u{1F4CE}";
      clip.addEventListener("click", function () {
        // Attaching straight to a group always copies: there is no note text here to
        // hold a link, and a stored file is the thing that travels with the drive.
        attachToGroup(group.name);
      });
      head.appendChild(clip);

      var remove = document.createElement("button");
      remove.className = "group-action";
      remove.type = "button";
      remove.title = "Delete group " + group.name;
      remove.textContent = "×";
      remove.addEventListener("click", function () {
        deleteGroup(group.name);
      });
      head.appendChild(remove);

      wrap.appendChild(head);

      if (!group.notes.length) {
        var blank = document.createElement("div");
        blank.className = "note-empty";
        blank.textContent = "empty";
        wrap.appendChild(blank);
      }

      group.notes.forEach(function (note) {
        var button = document.createElement("button");
        button.className = "note";
        button.type = "button";
        button.textContent = note.title;
        button.title = note.path;
        if (state.current && state.current.path === note.path) {
          button.classList.add("selected");
        }
        button.addEventListener("click", function () {
          openNote(note.path);
        });
        wrap.appendChild(button);
      });

      (group.files || []).forEach(function (file) {
        var row = document.createElement("button");
        row.className = "file";
        row.type = "button";
        row.title = "Open " + file.name;

        var clip = document.createElement("span");
        clip.className = "clip";
        clip.textContent = "\u{1F4CE}";
        row.appendChild(clip);

        var name = document.createElement("span");
        name.className = "file-name";
        name.textContent = file.name;
        row.appendChild(name);

        var size = document.createElement("span");
        size.className = "file-size";
        size.textContent = formatSize(file.size);
        row.appendChild(size);

        var remove = document.createElement("span");
        remove.className = "file-remove";
        remove.title = "Remove " + file.name;
        remove.textContent = "×";
        remove.addEventListener("click", function (event) {
          // Do not also trigger the row's "open" handler.
          event.stopPropagation();
          deleteAttachment(file);
        });
        row.appendChild(remove);

        row.addEventListener("click", function () {
          openAttachment(file.path);
        });
        wrap.appendChild(row);
      });

      treeEl.appendChild(wrap);
    });
  }

  function renderSearchResults(hits) {
    treeEl.textContent = "";

    if (!hits.length) {
      var none = document.createElement("div");
      none.className = "tree-empty";
      none.textContent = "No matches.";
      treeEl.appendChild(none);
      return;
    }

    var head = document.createElement("div");
    head.className = "group-head";
    head.textContent = hits.length + (hits.length === 1 ? " match" : " matches");
    treeEl.appendChild(head);

    hits.forEach(function (hit) {
      var button = document.createElement("button");
      button.className = "note";
      button.type = "button";
      button.title = hit.path;

      var title = document.createElement("span");
      title.textContent = hit.group + " / " + hit.title;
      button.appendChild(title);

      var snippet = document.createElement("span");
      snippet.className = "hit-snippet";
      snippet.textContent = hit.snippet;
      button.appendChild(snippet);

      button.addEventListener("click", function () {
        openNote(hit.path);
      });
      treeEl.appendChild(button);
    });
  }

  function renderPreviewNow() {
    // Safe: renderMarkdown escapes the source before adding any markup. The group is
    // passed so that "_files/x.pdf" can be resolved to a full path when clicked.
    preview.innerHTML = window.renderMarkdown(editor.value, {
      group: state.current ? state.current.group : "",
    });
  }

  function schedulePreview() {
    if (!state.previewOn) return;
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(renderPreviewNow, PREVIEW_DEBOUNCE_MS);
  }

  // ------------------------------------------------------------ actions

  async function loadTree() {
    try {
      state.tree = await invoke("list_tree");
      renderMoveOptions();
      if (!state.searching) renderTree();
    } catch (err) {
      showBanner("Could not read the notes folder: " + err);
    }
  }

  async function openNote(path) {
    if (state.current && state.current.path === path) return;
    await flushAndSettle();

    try {
      var content = await invoke("read_note", { path: path });
      state.current = findMeta(path) || {
        path: path,
        group: path.split("/")[0],
        title: titleOf(content),
        modified: 0,
        size: 0,
      };
      editor.value = content;
      state.dirty = false;
      setStatus("Ready");
      updateChrome();
      schedulePreview();
      updateImportBar();
      if (!state.searching) renderTree();
      editor.focus();
    } catch (err) {
      showBanner("Could not open that note: " + err);
      await loadTree();
    }
  }

  async function newNote(group) {
    var target = group || (state.current && state.current.group) || groupNames()[0];
    if (!target) {
      showBanner("Create a group first.");
      return;
    }

    var title = await ask("New note in " + target, "", "Create");
    if (!title) return;

    await flushAndSettle();
    try {
      var meta = await invoke("create_note", { group: target, title: title });
      await loadTree();
      state.current = null; // force openNote to load it
      await openNote(meta.path);
    } catch (err) {
      showBanner("Could not create the note: " + err);
    }
  }

  async function newGroup() {
    var name = await ask("New group", "", "Create");
    if (!name) return;
    try {
      await invoke("create_group", { name: name });
      await loadTree();
    } catch (err) {
      showBanner("Could not create the group: " + err);
    }
  }

  async function deleteCurrentNote() {
    if (!state.current) return;
    var ok = await confirmAction(
      "Delete this note?",
      "“" +
        state.current.title +
        "” moves to the _trash folder on the drive. Nothing is erased.",
      "Move to trash"
    );
    if (!ok) return;

    try {
      await invoke("delete_note", { path: state.current.path });
      state.current = null;
      state.dirty = false;
      editor.value = "";
      await loadTree();
      var next = firstNote();
      if (next) await openNote(next.path);
      else updateChrome();
      setStatus("Ready");
    } catch (err) {
      showBanner("Could not delete the note: " + err);
    }
  }

  async function deleteGroup(name) {
    var ok = await confirmAction(
      "Delete the group “" + name + "”?",
      "The folder and every note in it move to _trash on the drive. Nothing is erased.",
      "Move to trash"
    );
    if (!ok) return;

    try {
      await invoke("delete_group", { name: name });
      if (state.current && state.current.group === name) {
        state.current = null;
        state.dirty = false;
        editor.value = "";
      }
      await loadTree();
      if (!state.current) {
        var next = firstNote();
        if (next) await openNote(next.path);
        else updateChrome();
      }
    } catch (err) {
      showBanner("Could not delete the group: " + err);
    }
  }

  // ------------------------------------------------------------ attachments

  /// Ask the OS for files via the dialog plugin. Returns an array of absolute paths.
  async function pickFiles() {
    var picked = await invoke("plugin:dialog|open", {
      options: { multiple: true, title: "Attach files" },
    });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  }

  /// Copy files into a group's _files folder. Returns the metadata of what landed.
  async function copyInto(group, sources) {
    var result = await invoke("attach_files", { group: group, sources: sources });
    if (result.failed.length) {
      showBanner("Some files could not be attached: " + result.failed.join("; "));
    } else {
      hideBanner();
    }
    await loadTree();
    return result.attached;
  }

  async function attachToGroup(group) {
    try {
      var sources = await pickFiles();
      if (!sources.length) return;
      var attached = await copyInto(group, sources);
      if (attached.length) {
        setStatus(
          attached.length === 1 ? "File attached" : attached.length + " files attached",
          "ok"
        );
      }
    } catch (err) {
      showBanner("Could not attach: " + err);
    }
  }

  /// Attach to the open note: copy the files in and link them, or link them where they
  /// already sit. Either way a Markdown link lands at the cursor.
  async function attachToNote() {
    if (!state.current) return;
    var group = state.current.group;

    try {
      var sources = await pickFiles();
      if (!sources.length) return;

      var mode = await chooseAttachMode(sources.length);
      if (mode === "cancel") return;

      if (mode === "copy") {
        var attached = await copyInto(group, sources);
        attached.forEach(function (file) {
          insertAtCursor("[" + file.name + "](_files/" + file.name + ")\n");
        });
        return;
      }

      // "Link where it is": no copy, just the absolute path in the note text. The
      // import bar will appear so bringing it in later is one click away.
      sources.forEach(function (source) {
        var name = source.split(/[\\/]/).pop() || source;
        insertAtCursor("[" + name + "](" + source + ")\n");
      });
      await flushAndSettle();
    } catch (err) {
      showBanner("Could not attach: " + err);
    }
  }

  async function openAttachment(path) {
    try {
      await invoke("open_attachment", { path: path });
    } catch (err) {
      showBanner(String(err));
    }
  }

  async function deleteAttachment(file) {
    var ok = await confirmAction(
      "Remove this file?",
      "“" + file.name + "” moves to the _trash folder on the drive. Nothing is erased.",
      "Move to trash"
    );
    if (!ok) return;

    try {
      await invoke("delete_file", { path: file.path });
      await loadTree();
    } catch (err) {
      showBanner("Could not remove the file: " + err);
    }
  }

  /// Copy the targets of this note's external links onto the drive and repoint them.
  async function bringFilesIn() {
    if (!state.current) return;
    await flushAndSettle();

    try {
      var report = await invoke("import_links", { path: state.current.path });

      if (report.copied > 0) {
        editor.value = await invoke("read_note", { path: state.current.path });
        state.dirty = false;
        schedulePreview();
        await loadTree();
      }

      if (report.missing.length) {
        showBanner(
          "Copied " +
            report.copied +
            "; could not reach: " +
            report.missing.join(", ") +
            ". Those links stay as they are."
        );
      } else {
        hideBanner();
        setStatus(report.copied + " brought in", "ok");
      }
      updateImportBar();
    } catch (err) {
      showBanner("Could not bring files in: " + err);
    }
  }

  /// Files dropped on the window are copied into the current group, and linked if a
  /// note is open to hold the link.
  async function handleDrop(sources) {
    if (!sources || !sources.length) return;
    var group = (state.current && state.current.group) || groupNames()[0];
    if (!group) {
      showBanner("Create a group before dropping files in.");
      return;
    }

    try {
      var attached = await copyInto(group, sources);
      if (state.current) {
        attached.forEach(function (file) {
          insertAtCursor("[" + file.name + "](_files/" + file.name + ")\n");
        });
      } else if (attached.length) {
        setStatus(attached.length + " added to " + group, "ok");
      }
    } catch (err) {
      showBanner("Could not attach the dropped files: " + err);
    }
  }

  async function moveCurrent(group) {
    if (!state.current || state.current.group === group) return;
    await flushAndSettle();
    try {
      state.current = await invoke("move_note", {
        path: state.current.path,
        group: group,
      });
      updateChrome();
      await loadTree();
    } catch (err) {
      showBanner("Could not move the note: " + err);
      renderMoveOptions();
    }
  }

  async function runSearch(query) {
    if (!query.trim()) {
      state.searching = false;
      renderTree();
      return;
    }
    state.searching = true;
    try {
      renderSearchResults(await invoke("search", { query: query }));
    } catch (err) {
      showBanner("Search failed: " + err);
    }
  }

  function togglePreview() {
    state.previewOn = !state.previewOn;
    preview.classList.toggle("hidden", !state.previewOn);
    previewBtn.classList.toggle("active", state.previewOn);
    if (state.previewOn) {
      renderPreviewNow();
    }
  }

  // ------------------------------------------------------------ events

  editor.addEventListener("input", function () {
    scheduleSave();
    schedulePreview();
  });

  // Leaving the editor is a natural commit point: save, and settle the filename.
  editor.addEventListener("blur", function () {
    flushAndSettle();
  });

  window.addEventListener("blur", function () {
    flush();
  });

  el("new-note").addEventListener("click", function () {
    newNote(null);
  });
  el("new-group").addEventListener("click", newGroup);
  deleteBtn.addEventListener("click", deleteCurrentNote);
  previewBtn.addEventListener("click", togglePreview);
  attachBtn.addEventListener("click", attachToNote);
  importBtn.addEventListener("click", bringFilesIn);

  rootPathEl.addEventListener("click", function () {
    invoke("open_notes_folder").catch(function (err) {
      showBanner("Could not open the notes folder: " + err);
    });
  });

  // Every link in the preview is handled here. Letting the webview follow one would
  // navigate the app window itself and the UI would simply disappear.
  preview.addEventListener("click", function (event) {
    var anchor = event.target.closest ? event.target.closest("a") : null;
    if (!anchor) return;
    event.preventDefault();

    if (anchor.classList.contains("md-attach")) {
      openAttachment(anchor.dataset.attach);
    } else if (anchor.classList.contains("md-file")) {
      invoke("open_external_file", { path: anchor.dataset.file }).catch(function (err) {
        showBanner(String(err));
      });
    } else if (anchor.href) {
      invoke("open_url", { url: anchor.href }).catch(function (err) {
        showBanner(String(err));
      });
    }
  });

  // Dropping files on the window copies them onto the drive.
  appWindow.onDragDropEvent(function (event) {
    var payload = event.payload || {};
    if (payload.type === "enter" || payload.type === "over") {
      dropOverlay.classList.remove("hidden");
      return;
    }
    dropOverlay.classList.add("hidden");
    if (payload.type === "drop") handleDrop(payload.paths);
  });

  moveSelect.addEventListener("change", function () {
    moveCurrent(moveSelect.value);
  });

  searchEl.addEventListener("input", function () {
    clearTimeout(state.searchTimer);
    var query = searchEl.value;
    state.searchTimer = setTimeout(function () {
      runSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  });

  searchEl.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      searchEl.value = "";
      state.searching = false;
      renderTree();
      editor.focus();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    var key = event.key.toLowerCase();

    if (key === "s") {
      // People press this out of habit. Honour it rather than letting the webview
      // try to save the page.
      event.preventDefault();
      flushAndSettle();
    } else if (key === "n") {
      event.preventDefault();
      newNote(null);
    } else if (key === "f") {
      event.preventDefault();
      searchEl.focus();
      searchEl.select();
    } else if (key === "p") {
      event.preventDefault();
      if (state.current) togglePreview();
    }
  });

  // Hold the window open until the last keystroke is on disk.
  appWindow.onCloseRequested(async function (event) {
    event.preventDefault();
    await flushAndSettle();

    if (state.dirty) {
      var ok = await confirmAction(
        "Unsaved changes",
        "The last changes could not be written to the drive. Close anyway and lose them?",
        "Close anyway"
      );
      if (!ok) return;
    }
    await appWindow.destroy();
  });

  // ------------------------------------------------------------ startup

  async function boot() {
    try {
      var startup = await invoke("startup_status");
      rootPathEl.textContent = startup.root;
      rootPathEl.title = "Your notes are stored in " + startup.root;
      if (startup.error) {
        showBanner(
          "The notes folder could not be prepared: " +
            startup.error +
            " — the drive may be write-protected."
        );
      }
    } catch (err) {
      showBanner("Could not start: " + err);
    }

    await loadTree();
    var first = firstNote();
    if (first) await openNote(first.path);
    else updateChrome();
  }

  updateChrome();
  boot();
})();
