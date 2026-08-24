// A small, dependency-free Markdown renderer.
//
// Security model: the source is HTML-escaped *first*, then Markdown structure is added
// to the already-escaped text. Raw HTML in a note therefore renders as visible text
// instead of executing, so a pasted <script> is inert and the strict CSP stays intact.
// That is why the output is safe to hand to dangerouslySetInnerHTML, and why there is
// no Markdown library plus sanitiser here.

/** Placeholder used to park inline-code spans. Plain ASCII: a control character here
 *  would be invisible in an editor and easy to mangle. */
const SENTINEL = "@@QNCODE";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export interface RenderOptions {
  /** The group the note lives in, used to resolve `_files/x.pdf` to a full path. */
  group: string;
}

export function escapeHtml(text: string): string {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/**
 * Markup for one link, or null to leave the author's text exactly as typed.
 *
 * Web links become ordinary anchors. Attachments and absolute paths become inert
 * anchors carrying a data attribute: the app intercepts the click and hands the path to
 * Rust, so the webview never navigates and no local path ever lands in an href.
 *
 * Everything else — javascript:, data:, vbs: — returns null.
 */
function linkMarkup(label: string, rawUrl: string, options: RenderOptions): string | null {
  const url = rawUrl.trim().replace(/^&lt;/, "").replace(/&gt;$/, "");

  if (/^(https?:\/\/|mailto:)/i.test(url)) {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }

  // An attachment in this group's _files folder. It travels with the drive.
  if (/^_files\//.test(url)) {
    return `<a href="#" class="md-attach" data-attach="${options.group}/${url}">${label}</a>`;
  }

  // An absolute path on some machine, which may not be this one.
  if (/^[a-zA-Z]:[\\/]/.test(url) || /^\\\\/.test(url)) {
    return `<a href="#" class="md-file" data-file="${url}">${label}</a>`;
  }

  return null;
}

/** Inline formatting. `text` is already HTML-escaped when this is called. */
function inline(text: string, options: RenderOptions): string {
  const codes: string[] = [];

  // Pull inline code out first so its contents are not treated as markup.
  let out = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(code);
    return `${SENTINEL}${codes.length - 1}@@`;
  });

  // The URL may contain spaces, because Windows paths routinely do; it may not span
  // lines. A leading "!" (an image) is accepted and dropped — attachments render as
  // links that open in the system viewer, not as embedded images.
  out = out.replace(
    /(!?)\[([^\]]*)\]\(([^)\n]+)\)/g,
    (match, _bang: string, label: string, url: string) => {
      const markup = linkMarkup(label, url, options);
      // Unrecognised or unsafe: leave the text as typed rather than swallowing it. It
      // is already escaped, so it is inert.
      return markup === null ? match : markup;
    },
  );

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Asterisks only, never underscores: underscore italics would mangle snake_case
  // words, which is exactly the sort of surprise a notes app should not spring on you.
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return out.replace(/@@QNCODE(\d+)@@/g, (_match, index: string) => {
    return `<code>${codes[Number(index)] ?? ""}</code>`;
  });
}

function isBlockStart(line: string): boolean {
  return (
    /^\s*```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*&gt;\s?/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*([-*_])\s*(\1\s*){2,}$/.test(line)
  );
}

export function renderMarkdown(source: string, options: RenderOptions): string {
  // Strip the sentinel from the source so a note cannot forge one.
  const cleaned = String(source).split(SENTINEL).join("");
  const lines = escapeHtml(cleaned).split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(`<pre><code>${body.join("\n")}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Horizontal rule, checked before lists so "---" is not read as a bullet.
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim(), options)}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote. ">" is already "&gt;" here, since escaping ran first.
    if (/^\s*&gt;\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        quoted.push(inline(lines[i].replace(/^\s*&gt;\s?/, ""), options));
        i++;
      }
      out.push(`<blockquote><p>${quoted.join("<br>")}</p></blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        bullets.push(`<li>${inline(lines[i].replace(/^\s*[-*+]\s+/, ""), options)}</li>`);
        i++;
      }
      out.push(`<ul>${bullets.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const numbered: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        numbered.push(`<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ""), options)}</li>`);
        i++;
      }
      out.push(`<ol>${numbered.join("")}</ol>`);
      continue;
    }

    // Paragraph: run until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
      para.push(inline(lines[i], options));
      i++;
    }
    out.push(`<p>${para.join("<br>")}</p>`);
  }

  return out.join("\n");
}

/** Mirrors the Rust title rule: the first `# heading`, else the first non-empty line. */
export function titleOf(text: string): string {
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const stripped = trimmed.replace(/^#+/, "").trim();
    return (stripped || trimmed).slice(0, 80);
  }
  return "";
}

/** True when the note links to an absolute path — a file that will not travel with the
 *  drive. Mirrors `files::is_absolute_path` on the Rust side. */
export function hasExternalLinks(text: string): boolean {
  return /\]\(\s*(?:[a-zA-Z]:[\\/]|\\\\)[^)\n]*\)/.test(String(text));
}
