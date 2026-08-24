// A small, dependency-free Markdown renderer.
//
// Security model: the source is HTML-escaped *first*, then Markdown structure is added
// to the already-escaped text. Raw HTML in a note therefore renders as visible text
// instead of executing, so a pasted <script> is inert and the strict CSP stays intact.
// This is why we do not pull in a Markdown library plus a separate sanitiser.

(function () {
  "use strict";

  // Placeholder used to park inline-code spans while other rules run. Plain ASCII on
  // purpose: a control character here is invisible in editors and easy to mangle.
  var SENTINEL = "@@QNCODE";

  var ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return ESCAPES[c];
    });
  }

  // Build the markup for one link, or return null to leave the author's text as typed.
  //
  // Three kinds are recognised. Web links become ordinary anchors. Attachments and
  // absolute paths become inert anchors carrying a data attribute: the app intercepts
  // the click and hands the path to Rust, so the webview never navigates anywhere and
  // no local path is ever put in an href.
  //
  // Everything else -- javascript:, data:, vbs: -- falls through to null and renders as
  // the literal text the author typed.
  function linkMarkup(label, rawUrl, options) {
    var url = rawUrl.trim().replace(/^&lt;/, "").replace(/&gt;$/, "");

    if (/^(https?:\/\/|mailto:)/i.test(url)) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    }

    // An attachment in this group's _files folder. It travels with the drive.
    if (/^_files\//.test(url)) {
      var group = (options && options.group) || "";
      return (
        '<a href="#" class="md-attach" data-attach="' +
        group +
        "/" +
        url +
        '">' +
        label +
        "</a>"
      );
    }

    // An absolute path on some machine, which may not be this one.
    if (/^[a-zA-Z]:[\\/]/.test(url) || /^\\\\/.test(url)) {
      return '<a href="#" class="md-file" data-file="' + url + '">' + label + "</a>";
    }

    return null;
  }

  // Inline formatting. `text` is already HTML-escaped when this is called.
  function inline(text, options) {
    var codes = [];

    // Pull inline code out first so its contents are not treated as markup.
    var out = text.replace(/`([^`]+)`/g, function (_, code) {
      codes.push(code);
      return SENTINEL + (codes.length - 1) + "@@";
    });

    // The URL may contain spaces, because Windows paths routinely do; it may not span
    // lines. A leading "!" (an image) is accepted and dropped -- attachments render as
    // links that open in the system viewer, not as embedded images.
    out = out.replace(/(!?)\[([^\]]*)\]\(([^)\n]+)\)/g, function (match, bang, label, url) {
      var markup = linkMarkup(label, url, options);
      // Unrecognised or unsafe: leave the author's text exactly as typed rather than
      // silently swallowing it. It is already escaped, so it is inert.
      return markup === null ? match : markup;
    });

    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // Asterisks only, never underscores: underscore italics would mangle snake_case
    // words, which is exactly the sort of surprise a notes app should not spring on you.
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    return out.replace(/@@QNCODE(\d+)@@/g, function (_, i) {
      return "<code>" + codes[i] + "</code>";
    });
  }

  function isBlockStart(line) {
    return (
      /^\s*```/.test(line) ||
      /^#{1,6}\s+/.test(line) ||
      /^\s*&gt;\s?/.test(line) ||
      /^\s*[-*+]\s+/.test(line) ||
      /^\s*\d+[.)]\s+/.test(line) ||
      /^\s*([-*_])\s*(\1\s*){2,}$/.test(line)
    );
  }

  function render(source, options) {
    // Strip the sentinel from the source so a note cannot forge one.
    var cleaned = String(source).split(SENTINEL).join("");
    var lines = escapeHtml(cleaned).split(/\r?\n/);
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // Fenced code block
      if (/^\s*```/.test(line)) {
        var body = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          body.push(lines[i]);
          i++;
        }
        i++; // closing fence
        out.push("<pre><code>" + body.join("\n") + "</code></pre>");
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

      var heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        var level = heading[1].length;
        out.push("<h" + level + ">" + inline(heading[2].trim(), options) + "</h" + level + ">");
        i++;
        continue;
      }

      // Blockquote. ">" is already "&gt;" at this point, since escaping ran first.
      if (/^\s*&gt;\s?/.test(line)) {
        var quoted = [];
        while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
          quoted.push(inline(lines[i].replace(/^\s*&gt;\s?/, ""), options));
          i++;
        }
        out.push("<blockquote><p>" + quoted.join("<br>") + "</p></blockquote>");
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        var bullets = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          bullets.push("<li>" + inline(lines[i].replace(/^\s*[-*+]\s+/, ""), options) + "</li>");
          i++;
        }
        out.push("<ul>" + bullets.join("") + "</ul>");
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        var numbered = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          numbered.push("<li>" + inline(lines[i].replace(/^\s*\d+[.)]\s+/, ""), options) + "</li>");
          i++;
        }
        out.push("<ol>" + numbered.join("") + "</ol>");
        continue;
      }

      // Paragraph: run until a blank line or the start of another block.
      var para = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
        para.push(inline(lines[i], options));
        i++;
      }
      out.push("<p>" + para.join("<br>") + "</p>");
    }

    return out.join("\n");
  }

  window.renderMarkdown = render;
  window.escapeHtml = escapeHtml;
})();
