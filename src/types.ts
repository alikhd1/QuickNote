// Mirrors of the structs the Rust commands serialise.
//
// These are the contract between the two halves of the app. If a field changes in
// src-tauri/src/{store,files,commands}.rs it has to change here too — TypeScript cannot
// see across that boundary, so this file is the one place the shape is written down.

/** `store::NoteMeta` */
export interface NoteMeta {
  /** Relative to the notes root, forward slashes: `Work/project-alpha.md`. */
  path: string;
  group: string;
  title: string;
  /** The start of the body, for the second line of a note-list row. */
  preview: string;
  /** Milliseconds since the Unix epoch. */
  modified: number;
  size: number;
}

/** `files::FileMeta` */
export interface FileMeta {
  name: string;
  /** Relative to the notes root: `Work/_files/spec.pdf`. */
  path: string;
  group: string;
  size: number;
  modified: number;
}

/** `commands::GroupView` — a group with its notes and its attachments. */
export interface GroupView {
  name: string;
  notes: NoteMeta[];
  files: FileMeta[];
}

/** `store::SearchHit` */
export interface SearchHit {
  path: string;
  group: string;
  title: string;
  snippet: string;
}

/** `commands::Startup` */
export interface Startup {
  root: string;
  error: string | null;
}

/** `commands::AttachResult` */
export interface AttachResult {
  attached: FileMeta[];
  failed: string[];
}

/** `files::ImportReport` */
export interface ImportReport {
  copied: number;
  missing: string[];
}

/** `store::NoteContents` — a note's text plus the baseline it was read at. */
export interface NoteContents {
  meta: NoteMeta;
  content: string;
}

/**
 * `store::SaveOutcome`. A conflict means the file changed outside QuickNote and
 * nothing was written, so the user has to choose which version survives.
 */
export type SaveOutcome =
  | { status: "saved"; meta: NoteMeta }
  | { status: "conflict"; modified: number; size: number };

export type SaveStatus =
  | "ready"
  | "unsaved"
  | "saving"
  | "saved"
  | "error"
  | "conflict";

/** What to do with files chosen in the attach dialog. */
export type AttachMode = "copy" | "link" | "cancel";
