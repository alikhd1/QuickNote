import { useDeferredValue, useMemo, type MouseEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { renderMarkdown } from "../markdown";

interface PreviewProps {
  content: string;
  group: string;
  /** Absolute path of the notes root, so attached images can be turned into URLs. */
  notesRoot: string;
  onOpenAttachment: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenUrl: (url: string) => void;
}

export function Preview(props: PreviewProps) {
  const { content, group, notesRoot } = props;

  // Keeps typing responsive on a long note: React renders the preview from a slightly
  // stale value rather than blocking each keystroke on a full re-parse.
  const deferred = useDeferredValue(content);
  const html = useMemo(
    () => renderMarkdown(deferred, { group, notesRoot, toAssetUrl: convertFileSrc }),
    [deferred, group, notesRoot],
  );

  // Every link is handled here. Letting the webview follow one would navigate the app
  // window itself and the UI would simply disappear.
  function handleClick(event: MouseEvent<HTMLElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    event.preventDefault();

    const attachment = anchor.dataset.attach;
    const file = anchor.dataset.file;

    if (attachment) props.onOpenAttachment(attachment);
    else if (file) props.onOpenFile(file);
    else if (anchor.href) props.onOpenUrl(anchor.href);
  }

  return (
    <article
      className="preview"
      aria-label="Preview"
      onClick={handleClick}
      // Safe: renderMarkdown escapes the source before adding any markup, so note text
      // can never become executable.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
