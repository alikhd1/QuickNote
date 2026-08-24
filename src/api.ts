// Typed wrappers over the Rust commands.
//
// Every filesystem operation in the app goes through this file. Nothing else calls
// `invoke` directly, so the set of things the UI can ask the backend to do is exactly
// the list below.

import { invoke } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

import type {
  AttachResult,
  GroupView,
  ImportReport,
  NoteContents,
  NoteMeta,
  SaveOutcome,
  SearchHit,
  Startup,
} from "./types";

/** Rust returns plain strings as errors; surface them as readable text. */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------- notes

export const startupStatus = () => invoke<Startup>("startup_status");

export const listTree = () => invoke<GroupView[]>("list_tree");

export const readNote = (path: string) => invoke<NoteContents>("read_note", { path });

/**
 * Save a note. `expected` is the modified time and size the UI last saw; if the file on
 * disk no longer matches, nothing is written and a conflict comes back instead.
 * Omitting it forces the write, which is how "keep my version" is resolved.
 */
export const saveNote = (
  path: string,
  content: string,
  expected?: { modified: number; size: number },
) =>
  invoke<SaveOutcome>("save_note", {
    path,
    content,
    expectedModified: expected?.modified,
    expectedSize: expected?.size,
  });

export const createNote = (group: string, title: string) =>
  invoke<NoteMeta>("create_note", { group, title });

export const renameNote = (path: string, title: string) =>
  invoke<NoteMeta>("rename_note", { path, title });

export const moveNote = (path: string, group: string) =>
  invoke<NoteMeta>("move_note", { path, group });

export const deleteNote = (path: string) => invoke<void>("delete_note", { path });

export const createGroup = (name: string) => invoke<string>("create_group", { name });

export const deleteGroup = (name: string) => invoke<void>("delete_group", { name });

export const search = (query: string) => invoke<SearchHit[]>("search", { query });

// ---------------------------------------------------------------- attachments

export const attachFiles = (group: string, sources: string[]) =>
  invoke<AttachResult>("attach_files", { group, sources });

export const deleteFile = (path: string) => invoke<void>("delete_file", { path });

export const importLinks = (path: string) => invoke<ImportReport>("import_links", { path });

export const openAttachment = (path: string) => invoke<void>("open_attachment", { path });

export const openExternalFile = (path: string) =>
  invoke<void>("open_external_file", { path });

export const openUrl = (url: string) => invoke<void>("open_url", { url });

export const openNotesFolder = () => invoke<void>("open_notes_folder");

// ---------------------------------------------------------------- os dialog

/** Ask the OS for files to attach. Returns absolute paths, empty if cancelled. */
export async function pickFiles(): Promise<string[]> {
  const picked = await openFileDialog({ multiple: true, title: "Attach files" });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}
