/* Fub Clipper — convert.js
 * 1:1 mirror of `crates/fub-importers/src/clipper.rs` (TransferOwner, single
 * source of truth). Pure: HTML string in, stable JSON out. No network, no
 * HostApi, no fs. UMD (extension classic script + node require).
 *
 * Input:  clipHtml(html, { url?, selectionOnly?, title?, clippedAt? })
 * Output: { markdown, assets, notes }
 *   markdown: YAML frontmatter (title, source_url?, clipped_at) + body
 *   assets:   [{ orig_url, suggested_name }] — remote URLs are references,
 *             not downloaded bytes. Only an explicit capped download yields
 *             a content SHA-256 (images.js, via platform WebCrypto).
 *   notes:    [{ level: 'info'|'warn', message, entry }] — entry is a CSS-ish
 *             selector or URL pointing at the source construct.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubConvert = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_INPUT = 2 * 1024 * 1024; // 2 MiB HTML in; markdown capped by capture.js (1 MiB)
  var MAX_ASSETS = 50;

  function templateVars() {
    return ["source_url", "title", "clipped_at", "excerpt"];
  }

  // An asset's orig_url is its correlation key before download. A remote
  // reference has no content hash; never label a URL-derived id as sha256.

  function yamlScalar(s) {
    s = String(s == null ? "" : s);
    if (s === "" || /[:#\[\]{},&*!|>'"%@`\n\r]/.test(s.charAt(0)) || /[\n\r:]/.test(s) || /^\s|\s$/.test(s)) {
      return JSON.stringify(s);
    }
    if (/^(true|false|null|~|[0-9][0-9.\-+eE]*)$/.test(s)) return JSON.stringify(s);
    return s;
  }

  function suggestedName(url) {
    try {
      var u = new URL(url);
      var base = u.pathname.split("/").filter(Boolean).pop() || "image";
      base = base.split("?")[0].split("#")[0].slice(0, 80) || "image";
      if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += ".img";
      return base.replace(/[^a-zA-Z0-9._-]+/g, "-");
    } catch (e) {
      return "image.img";
    }
  }

  function escText(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/`/g, "\\`").replace(/\[/g, "\\[").replace(/</g, "&lt;");
  }

  // Very small tag tokenizer: splits into tags/text, drops hostile constructs.
  function tokenize(html, notes) {
    var tokens = [];
    var re = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var t = m[0];
      if (t.indexOf("<!--") === 0) continue; // strip comments silently
      tokens.push(t);
    }
    return tokens;
  }

  function parseAttrs(tag) {
    var attrs = {};
    var re = /([a-zA-Z_:][a-zA-Z0-9:._-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    var m;
    while ((m = re.exec(tag)) !== null) {
      var name = m[1].toLowerCase();
      var val = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]);
      attrs[name] = val;
    }
    return attrs;
  }

  function tagName(tag) {
    var m = /^<\/?([a-zA-Z0-9]+)/.exec(tag);
    return m ? m[1].toLowerCase() : "";
  }

  function isHttpImg(src) {
    return typeof src === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(src);
  }

  function mdUrl(u) {
    var s = String(u);
    // URLs reaching here passed isHttpImg (no spaces/parens) or are relative
    // fragments; wrap in <> when a paren slipped through from page markup.
    if (/[()]/.test(s)) return "<" + s.replace(/[<>]/g, "") + ">";
    return s;
  }

  // HTML -> Markdown. Handles the everyday subset; unknown tags degrade to
  // their text content. Hostile constructs are dropped with a note.
  function htmlToMarkdown(html, opts, assets, notes) {
    opts = opts || {};
    assets = assets || [];
    notes = notes || [];
    var out = [];
    var listStack = []; // {type:'ul'|'ol', n:number}
    var linkStack = [];
    var preDepth = 0;
    var skipDepth = 0; // inside script/style/noscript/template
    var blockquoteDepth = 0;
    var tableCell = 0;
    var pushAsset = function (url, entry) {
      if (assets.length >= MAX_ASSETS) {
        notes.push({ level: "warn", message: "asset limit reached, extra images kept as URLs", entry: entry || "img" });
        return -1;
      }
      var a = { orig_url: url, suggested_name: suggestedName(url) };
      assets.push(a);
      return assets.length - 1;
    };

    var tokens = tokenize(String(html));
    var needBlank = function () {
      if (out.length && out[out.length - 1] !== "\n\n") out.push("\n\n");
    };
    var text = function (s) {
      if (preDepth > 0) { out.push(s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")); return; }
      var decoded = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (/^\s*$/.test(decoded)) { out.push(" "); return; }
      out.push(escText(decoded.replace(/\s+/g, " ")));
    };

    for (var ti = 0; ti < tokens.length; ti++) {
      var tok = tokens[ti];
      if (tok.charAt(0) !== "<") { if (!skipDepth) text(tok); continue; }
      var name = tagName(tok);
      var closing = tok.charAt(1) === "/";
      var attrs = (!closing && name) ? parseAttrs(tok) : {};

      if (name === "script" || name === "style" || name === "noscript" || name === "template" || name === "iframe" || name === "object" || name === "embed") {
        if (!closing) { skipDepth++; notes.push({ level: "info", message: "dropped <" + name + "> content", entry: name }); }
        else if (skipDepth > 0) skipDepth--;
        continue;
      }
      if (skipDepth) continue;
      if (attrs && (attrs.onclick !== undefined || attrs.onload !== undefined || attrs.onerror !== undefined)) {
        notes.push({ level: "info", message: "dropped event handler attribute", entry: name });
      }
      var href = attrs.href || attrs.src || "";
      if (/^\s*javascript:/i.test(href)) {
        notes.push({ level: "warn", message: "dropped javascript: URL", entry: name });
        if (name === "a") { if (!closing) linkStack.push(null); else linkStack.pop(); }
        continue;
      }

      switch (name) {
        case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
          if (!closing) { needBlank(); out.push("#".repeat(Number(name.charAt(1))) + " "); }
          else out.push("\n\n");
          break;
        }
        case "p": case "div": case "section": case "article": case "header": case "footer": case "main":
          if (!closing) needBlank(); else out.push("\n\n");
          break;
        case "br": out.push("  \n"); break;
        case "hr": needBlank(); out.push("---\n\n"); break;
        case "strong": case "b": out.push("**"); break;
        case "em": case "i": out.push("_"); break;
        case "s": case "strike": case "del": out.push("~~"); break;
        case "code":
          if (!preDepth) out.push("`");
          else out.push(tok);
          break;
        case "pre":
          if (!closing) { needBlank(); out.push("```\n"); preDepth++; }
          else { if (preDepth > 0) preDepth--; out.push("\n```\n\n"); }
          break;
        case "blockquote":
          if (!closing) { needBlank(); blockquoteDepth++; }
          else { if (blockquoteDepth > 0) blockquoteDepth--; out.push("\n\n"); }
          break;
        case "a":
          if (!closing) {
            var h = attrs.href || "";
            linkStack.push(h);
            out.push("[");
          } else {
            var dest = linkStack.pop();
            if (dest && isHttpImg(dest)) out.push("](" + mdUrl(dest) + ")");
            else if (dest) { out.push("](" + mdUrl(dest) + ")"); notes.push({ level: "info", message: "kept non-http link as text", entry: "a" }); }
            else out.push("]");
          }
          break;
        case "img": {
          var src = attrs.src || "";
          var alt = attrs.alt || "image";
          if (isHttpImg(src)) {
            pushAsset(src, "img");
            out.push("![" + escText(alt).slice(0, 120) + "](" + mdUrl(src) + ")");
          } else if (src) {
            notes.push({ level: "info", message: "non-http image kept as alt text (data:/blob: never fetched)", entry: "img" });
            out.push(escText(alt));
          }
          break;
        }
        case "ul":
          if (!closing) { needBlank(); listStack.push({ type: "ul", n: 0 }); }
          else { listStack.pop(); out.push("\n"); }
          break;
        case "ol":
          if (!closing) { needBlank(); listStack.push({ type: "ol", n: Number(attrs.start) || 1 }); }
          else { listStack.pop(); out.push("\n"); }
          break;
        case "li":
          if (!closing) {
            var indent = new Array(listStack.length).join("  ");
            var top = listStack[listStack.length - 1];
            out.push("\n" + indent + (top && top.type === "ol" ? (top.n++) + ". " : "- "));
          }
          break;
        case "mark": out.push("=="); break; // highlights survive as ==text==
        case "table": if (!closing) needBlank(); else out.push("\n\n"); break;
        case "tr": if (!closing) out.push("\n| "); tableCell = 0; break;
        case "th": case "td":
          if (!closing) { if (tableCell++ > 0) out.push(" | "); }
          break;
        default:
          // unknown/presentational tags degrade to nothing; text flows through
          break;
      }
      void tableCell;
    }
    var md = out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (blockquoteDepth > 0) {
      md = md.split("\n").map(function (l) { return "> " + l; }).join("\n");
    }
    return md;
  }

  function clipHtml(html, opts) {
    opts = opts || {};
    if (typeof html !== "string") { var e = new Error("bad_args: html must be a string"); e.code = "bad_args"; throw e; }
    // No character-count fallback: modern supported browsers provide
    // TextEncoder, and a missing encoder must not weaken a byte limit.
    if (typeof TextEncoder === "undefined" || !TextEncoder.prototype.encodeInto) {
      var unavailable = new Error("unavailable: UTF-8 encoder required"); unavailable.code = "unavailable"; throw unavailable;
    }
    var encoder = new TextEncoder();
    var inBytes = html.length > MAX_INPUT ? html.length : encoder.encode(html).length;
    if (inBytes > MAX_INPUT) { var e2 = new Error("bad_args: html exceeds 2 MiB"); e2.code = "bad_args"; throw e2; }
    var assets = [];
    var notes = [];
    var body = htmlToMarkdown(html, opts, assets, notes);
    if (opts.selectionOnly) notes.push({ level: "info", message: "converted from selection only", entry: "selection" });
    var title = String(opts.title || "Untitled clip").slice(0, 512) || "Untitled clip";
    var clippedAt = opts.clippedAt || new Date().toISOString();
    var fm = ["---", "title: " + yamlScalar(title)];
    if (opts.url) fm.push("source_url: " + yamlScalar(opts.url));
    fm.push("clipped_at: " + yamlScalar(clippedAt));
    fm.push("---", "");
    var head = fm.join("\n") + "\n";
    // The capture ceiling (1 MiB, enforced by capture.js and the app) applies
    // to top.markdown: truncate the BODY to fit, never the frontmatter, and
    // say so in notes so the truncation is visible, not silent.
    var room = 1048576 - encoder.encode(head).length;
    var tail = body || "(empty capture)";
    var marker = "\n\n…[truncated to fit the 1 MiB capture limit]";
    var markerBytes = encoder.encode(marker).length;
    if (room < markerBytes) {
      var e3 = new Error("bad_args: frontmatter exceeds capture limit"); e3.code = "bad_args"; throw e3;
    }
    if (encoder.encode(tail).length > room) {
      var prefix = new Uint8Array(room - markerBytes);
      tail = tail.slice(0, encoder.encodeInto(tail, prefix).read) + marker;
      notes.push({ level: "warn", message: "body truncated to fit the 1 MiB capture limit", entry: "clip" });
    }
    return { markdown: head + tail, assets: assets, notes: notes };
  }

  function markdownForSelection(html, opts) {
    var o = Object.assign({}, opts, { selectionOnly: true });
    return clipHtml(html, o).markdown;
  }

  return {
    MAX_INPUT: MAX_INPUT,
    MAX_ASSETS: MAX_ASSETS,
    templateVars: templateVars,
    htmlToMarkdown: htmlToMarkdown,
    clipHtml: clipHtml,
    markdownForSelection: markdownForSelection
  };
});
