/* Fub Clipper — extract.js
 * Content-script extraction: article / selection / highlights, reader mode,
 * metadata, Markdown preview. Runs in the ISOLATED world: never exposes
 * anything to page JS (no window.* API), captured content is data only.
 * Pure helpers are UMD (node-requireable for the prepared limit tests);
 * the `mountContentScript` bootstrap wires chrome.runtime messaging.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubExtract = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function metaContent(doc, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = null;
      try { el = doc.querySelector(selectors[i]); } catch (e) { continue; }
      if (el) {
        var c = el.getAttribute("content") || el.textContent;
        if (c && String(c).trim()) return String(c).trim();
      }
    }
    return "";
  }

  function getMetadata(doc, loc) {
    loc = loc || (typeof location !== "undefined" ? location : { href: "" });
    var title =
      metaContent(doc, ['meta[property="og:title"]']) ||
      (doc.title || "") ||
      "";
    var author =
      metaContent(doc, ['meta[name="author"]', 'meta[property="article:author"]', '[rel="author"]']) || "";
    var published =
      metaContent(doc, ['meta[property="article:published_time"]', 'meta[name="date"]', "time[datetime]"]) ||
      (function () {
        try {
          var t = doc.querySelector("time[datetime]");
          return t ? t.getAttribute("datetime") : "";
        } catch (e) { return ""; }
      })();
    var description =
      metaContent(doc, ['meta[name="description"]', 'meta[property="og:description"]']) || "";
    var siteName = metaContent(doc, ['meta[property="og:site_name"]']) || "";
    var canonical = "";
    try {
      var link = doc.querySelector('link[rel="canonical"]');
      canonical = (link && link.getAttribute("href")) || "";
    } catch (e) { /* keep empty */ }
    return {
      title: String(title).slice(0, 512),
      author: String(author).slice(0, 256),
      published: String(published).slice(0, 64),
      description: String(description).slice(0, 1024),
      site_name: String(siteName).slice(0, 256),
      url: canonical || String((loc && loc.href) || "")
    };
  }

  function textOf(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }

  // Reader-mode heuristic: prefer <article>, then [role=main], then the
  // container with the most paragraph text. Returns { root, score }.
  function findArticleRoot(doc) {
    var candidates = [];
    try {
      var arts = doc.querySelectorAll("article");
      for (var i = 0; i < arts.length; i++) candidates.push(arts[i]);
      var mains = doc.querySelectorAll('[role="main"], main');
      for (var j = 0; j < mains.length; j++) candidates.push(mains[j]);
    } catch (e) { /* query failed: fall through */ }
    var best = null, bestScore = 0;
    for (var k = 0; k < candidates.length; k++) {
      var s = textOf(candidates[k]).length;
      if (s > bestScore) { bestScore = s; best = candidates[k]; }
    }
    if (best && bestScore >= 280) return { root: best, score: bestScore, kind: "semantic" };
    // Fallback: largest <p> container among parents of long paragraphs.
    var seen = [];
    try {
      var ps = doc.querySelectorAll("p");
      for (var p = 0; p < ps.length; p++) {
        var t = textOf(ps[p]);
        if (t.length < 140) continue;
        var parent = ps[p].parentElement;
        if (parent && seen.indexOf(parent) === -1) seen.push(parent);
      }
    } catch (e2) { /* ignore */ }
    for (var q = 0; q < seen.length; q++) {
      var s2 = textOf(seen[q]).length;
      if (s2 > bestScore) { bestScore = s2; best = seen[q]; }
    }
    return { root: best || doc.body || doc.documentElement, score: bestScore, kind: best ? "heuristic" : "body" };
  }

  function summarize(text, maxSentences) {
    maxSentences = maxSentences || 3;
    var parts = String(text || "").replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]+["»”)]?|\S[^.!?…]*$/g) || [];
    return parts.slice(0, maxSentences).join(" ").trim().slice(0, 1200);
  }

  function selectionInfo(win) {
    try {
      var sel = win.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { text: "", html: "" };
      var text = String(sel.toString() || "");
      var html = "";
      try {
        var div = win.document.createElement("div");
        for (var i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents());
        html = div.innerHTML;
      } catch (e) { /* text-only fallback */ }
      return { text: text, html: html };
    } catch (e) {
      return { text: "", html: "" };
    }
  }

  // Marks are ephemeral unless the popup explicitly stores their text for
  // this page. Reapplication is only on the user's next popup gesture.
  function collectHighlights(doc) {
    var out = [];
    try {
      var marks = doc.querySelectorAll("mark[data-fub-highlight]");
      for (var i = 0; i < marks.length; i++) {
        out.push({ id: marks[i].getAttribute("data-fub-highlight") || String(i), text: textOf(marks[i]).slice(0, 2000) });
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  // Reapply quoted marks conservatively: only unique text in eligible nodes
  // can be anchored. Ambiguous matches are skipped rather than marking an
  // unrelated passage after a dynamic page changed. No page-world script or
  // network request is involved.
  function restoreHighlights(doc, records) {
    if (!Array.isArray(records) || records.length > 100 || !doc.body || !doc.createTreeWalker) return { restored: 0, skipped: 0 };
    var nodes = [], parts = [], length = 0, walker = doc.createTreeWalker(doc.body, 4 /* text nodes */);
    var node;
    while ((node = walker.nextNode()) && nodes.length < 4000 && length < 2 * 1024 * 1024) {
      var parent = node.parentElement;
      if (!parent || parent.closest("script,style,noscript,template,textarea,svg,mark[data-fub-highlight],[contenteditable]")) continue;
      if (!node.nodeValue) continue;
      var slice = node.nodeValue.slice(0, 2 * 1024 * 1024 - length);
      nodes.push({ node: node, start: length, end: length + slice.length });
      parts.push(slice);
      length += slice.length;
    }
    var full = parts.join(""), restored = 0, skipped = 0, candidates = [];
    records.forEach(function (record) {
      var text = record && record.text, id = record && record.id;
      if (typeof text !== "string" || !text || text.length > 2000 ||
          typeof id !== "string" || !/^h-[a-z0-9-]{1,80}$/i.test(id) ||
          doc.querySelector('mark[data-fub-highlight="' + id + '"]')) { skipped++; return; }
      var at = full.indexOf(text);
      if (at < 0 || full.indexOf(text, at + 1) !== -1) { skipped++; return; }
      var last = at + text.length - 1;
      var start = nodes.find(function (n) { return n.start <= at && n.end > at; });
      var end = nodes.find(function (n) { return n.start <= last && n.end > last; });
      if (!start || !end || start.node.parentElement.closest("mark") || end.node.parentElement.closest("mark")) { skipped++; return; }
      candidates.push({ id: id, at: at, last: last, start: start, end: end });
    });
    // Later ranges first: splitting a node cannot invalidate earlier
    // offsets. Overlapping quotes are skipped instead of nested ambiguously.
    candidates.sort(function (a, b) { return b.at - a.at; });
    var previousStart = Infinity;
    candidates.forEach(function (candidate) {
      if (candidate.last >= previousStart) { skipped++; return; }
      previousStart = candidate.at;
      try {
        var range = doc.createRange();
        range.setStart(candidate.start.node, candidate.at - candidate.start.start);
        range.setEnd(candidate.end.node, candidate.last + 1 - candidate.end.start);
        if (candidate.start.node !== candidate.end.node) {
          var ancestor = range.commonAncestorContainer;
          if (ancestor.nodeType !== 1) ancestor = ancestor.parentElement;
          if (!ancestor || ancestor.querySelector("script,style,noscript,template,iframe,object,embed,[contenteditable]")) {
            skipped++; return;
          }
        }
        var mark = doc.createElement("mark");
        mark.setAttribute("data-fub-highlight", candidate.id);
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
        restored++;
      } catch (e) { skipped++; }
    });
    return { restored: restored, skipped: skipped };
  }

  function clearHighlights(doc) {
    var marks = doc.querySelectorAll("mark[data-fub-highlight]");
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i], parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
    return { cleared: marks.length };
  }

  function extractAll(win, opts) {
    opts = opts || {};
    var doc = win.document;
    var metadata = getMetadata(doc, win.location);
    var found = findArticleRoot(doc);
    var articleHtml = "";
    try {
      var root = found.root || null;
      // Bound the serializer input: walk at most 4000 nodes / 4 MiB of text
      // so a hostile page cannot stall the capture before slicing.
      if (root) {
        var walker = doc.createTreeWalker ? doc.createTreeWalker(root, 1 /* elements */) : null;
        var seen = 0, over = false;
        if (walker) {
          var node = walker.currentNode;
          while (node) { if (++seen > 4000) { over = true; break; } node = walker.nextNode(); }
        }
        articleHtml = (over ? root.textContent || "" : root.innerHTML) || "";
      }
    } catch (e) { articleHtml = ""; }
    var sel = selectionInfo(win);
    var highlights = collectHighlights(doc);
    var articleText = found.root ? textOf(found.root) : "";
    // Custom selectors (options page, max 16) + structured-data inventory.
    // Both read data already in the page; no new requests, bounded output.
    var custom = [];
    var struct = { kinds: [], records: [] };
    try {
      var FubSel = (typeof FubSelectors !== "undefined") ? FubSelectors : null;
      var wanted = (opts && opts.selectors) || [];
      if (FubSel && wanted.length) custom = FubSel.collectBySelectors(doc, wanted);
      if (FubSel) struct = FubSel.structuredData(doc);
    } catch (e2) { /* selectors optional; core capture unaffected */ }
    return {
      metadata: metadata,
      reader: { kind: found.kind, chars: articleText.length, summary: summarize(articleText, 3) },
      articleHtml: String(articleHtml).slice(0, 2 * 1024 * 1024),
      selection: { text: String(sel.text).slice(0, 200000), html: String(sel.html).slice(0, 2 * 1024 * 1024) },
      highlights: highlights.slice(0, 200),
      custom: custom,
      struct: struct
    };
  }

  // --- content-script bootstrap (browser only) ------------------------------
  // Auto-mounts when loaded as an injected content script (classic script in
  // the ISOLATED world): answers only our own extension (sender.id must equal
  // runtime.id). Page-world posts cannot reach runtime messaging without an
  // externally_connectable entry, which this extension does not declare.
  var __mounted = false;
  function mountContentScript(ctx) {
    if (__mounted) return function () {};
    var bn = (ctx && ctx.browserNs) || (typeof browser !== "undefined" ? browser : null) || (typeof chrome !== "undefined" ? chrome : null);
    if (!bn || !bn.runtime || !bn.runtime.onMessage || !bn.runtime.onMessage.addListener) return function () {};
    var selfId = null;
    try { selfId = bn.runtime.id || null; } catch (e) { selfId = null; }
    var listener = function (msg, sender, sendResponse) {
      if (!msg || typeof msg !== "object") return false;
      // Answer our own extension pages and content scripts (matching
      // sender.id). When runtime.id is unavailable (test harness), fall back
      // to shape-gating: extension senders have .tab undefined (pages) or an
      // object .tab (content scripts); anything else is refused.
      if (selfId) { if (!sender || sender.id !== selfId) return false; }
      else if (!sender || (sender.tab !== undefined && (typeof sender.tab !== "object" || sender.tab === null))) return false;
      try {
        if (msg.type === "fub:extract") {
          var data = extractAll(typeof window !== "undefined" ? window : this, msg.opts);
          sendResponse({ ok: true, data: data });
          return true;
        }
        if (msg.type === "fub:highlight-selection") {
          var r = highlightSelection();
          sendResponse({ ok: true, data: r });
          return true;
        }
        if (msg.type === "fub:restore-highlights") {
          sendResponse({ ok: true, data: restoreHighlights(document, msg.records) });
          return true;
        }
        if (msg.type === "fub:clear-highlights") {
          sendResponse({ ok: true, data: clearHighlights(document) });
          return true;
        }
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
        return true;
      }
      return false;
    };
    bn.runtime.onMessage.addListener(listener);
    __mounted = true;
    return function unmount() {
      try { bn.runtime.onMessage.removeListener(listener); } catch (e) { /* ignore */ }
      __mounted = false;
    };
  }
  try {
    if (typeof window !== "undefined" && window.document && (typeof browser !== "undefined" || typeof chrome !== "undefined")) {
      mountContentScript({});
    }
  } catch (e) { /* node/test context: stay unmounted */ }

  function highlightSelection() {
    try {
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { created: 0 };
      var id = "h-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 0xffff).toString(16);
      var range = sel.getRangeAt(0);
      var mark = document.createElement("mark");
      mark.setAttribute("data-fub-highlight", id);
      try {
        range.surroundContents(mark);
      } catch (e) {
        // Overlapping ranges: wrap the text fallback instead of failing.
        mark.textContent = sel.toString();
        range.deleteContents();
        range.insertNode(mark);
      }
      sel.removeAllRanges();
      return { created: 1, id: id, text: textOf(mark).slice(0, 2000) };
    } catch (e) {
      return { created: 0, error: String((e && e.message) || e) };
    }
  }

  return {
    getMetadata: getMetadata,
    findArticleRoot: findArticleRoot,
    summarize: summarize,
    selectionInfo: selectionInfo,
    collectHighlights: collectHighlights,
    restoreHighlights: restoreHighlights,
    clearHighlights: clearHighlights,
    extractAll: extractAll,
    highlightSelection: highlightSelection,
    mountContentScript: mountContentScript
  };
});
