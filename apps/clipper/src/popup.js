/* Fub Clipper — popup.js (classic script). Works fully without any
 * assistant: extraction -> convert -> template -> capture-v1 -> app channel.
 */
(function () {
  "use strict";
  var bn = (typeof browser !== "undefined" ? browser : null) || (typeof chrome !== "undefined" ? chrome : null);

  function $(id) { return document.getElementById(id); }
  function setError(s) { $("error").textContent = s || ""; }
  function setStatus(s) { $("status").textContent = s || ""; }
  function store() {
    if (bn && bn.storage && bn.storage.local) return bn.storage.local;
    return null;
  }
  function storeGet(keys) {
    var st = store();
    if (!st) return Promise.resolve({});
    try {
      var p = st.get(keys);
      if (p && p.then) return p;
      return new Promise(function (res) { st.get(keys, res); });
    } catch (e) { return Promise.resolve({}); }
  }
  function storeSet(value) {
    var st = store();
    if (!st) return Promise.reject(new Error("extension storage unavailable"));
    try {
      var p = st.set(value);
      if (p && p.then) return p;
      return new Promise(function (res, rej) {
        st.set(value, function () {
          var e = bn.runtime && bn.runtime.lastError;
          if (e) rej(new Error(e.message)); else res();
        });
      });
    } catch (e) { return Promise.reject(e); }
  }
  var HIGHLIGHTS_KEY = "fub-highlights-v1";
  var highlightsStore = {};
  var currentUrl = "";
  function pageKey(tab) {
    var url = tab && tab.url;
    return typeof url === "string" && /^https?:\/\//i.test(url) && url.length <= 2048 ? url : "";
  }
  function savedFor(url) {
    var rec = url && highlightsStore[url];
    return rec && rec.enabled === true && Array.isArray(rec.marks) ? rec.marks : [];
  }
  function persistMarks(marks) {
    if (!currentUrl || !$("persistHighlights").checked) return Promise.resolve();
    var records = (marks || []).slice(0, 100).filter(function (m) {
      return m && /^h-[a-z0-9-]{1,80}$/i.test(m.id) && typeof m.text === "string" && m.text.length > 0;
    }).map(function (m) { return { id: m.id, text: m.text.slice(0, 2000) }; });
    // A bounded local cache. Drop the oldest page if the user exceeds 50;
    // disabling or clearing the current page never touches another page.
    var previous = Object.assign({}, highlightsStore);
    delete highlightsStore[currentUrl];
    highlightsStore[currentUrl] = { enabled: true, marks: records };
    var urls = Object.keys(highlightsStore);
    if (urls.length > 50) delete highlightsStore[urls[0]];
    return storeSet({ [HIGHLIGHTS_KEY]: highlightsStore }).catch(function (e) {
      highlightsStore = previous;
      throw e;
    });
  }
  function saveHighlightOptIn() {
    if (!currentUrl) { $("persistHighlights").checked = false; return; }
    if ($("persistHighlights").checked) {
      activeTab().then(function (tab) {
        if (!tab || pageKey(tab) !== currentUrl) throw new Error("page changed");
        return injectExtract(tab.id).then(function () {
          return askContent(tab.id, { type: "fub:extract", opts: { selectors: [] } });
        });
      }).then(function (reply) {
        if (!reply || !reply.ok || !reply.data) throw new Error("page unavailable");
        current = reply.data;
        return persistMarks(reply.data.highlights);
      }).then(function () {
        setStatus(t("popup.highlights.saved", "Highlights saved locally for this page."));
        refresh();
      }, function () { $("persistHighlights").checked = false; setError(t("popup.highlights.failed", "Could not save or clear highlights in extension storage.")); });
    } else {
      var previous = highlightsStore[currentUrl];
      delete highlightsStore[currentUrl];
      storeSet({ [HIGHLIGHTS_KEY]: highlightsStore }).then(function () {
        setStatus(t("popup.highlights.removed", "Saved highlights removed for this page."));
      }, function () {
        if (previous) highlightsStore[currentUrl] = previous;
        $("persistHighlights").checked = true;
        setError(t("popup.highlights.failed", "Could not save or clear highlights in extension storage."));
      });
    }
  }
  function clearHighlights() {
    if (!currentUrl) return;
    var remove = function () {
      var previous = highlightsStore[currentUrl];
      delete highlightsStore[currentUrl];
      storeSet({ [HIGHLIGHTS_KEY]: highlightsStore }).then(function () {
        setStatus(t("popup.highlights.cleared", "Highlights cleared for this page."));
        load();
      }, function () {
        if (previous) highlightsStore[currentUrl] = previous;
        setError(t("popup.highlights.failed", "Could not save or clear highlights in extension storage."));
      });
    };
    activeTab().then(function (tab) {
      if (tab && pageKey(tab) === currentUrl) {
        injectExtract(tab.id).then(function () { return askContent(tab.id, { type: "fub:clear-highlights" }); }).then(remove);
      } else remove();
    });
  }
  var exportHighlightUrl = null;
  function exportHighlights() {
    // Export only user-opted-in records; never export the current live DOM
    // or infer text from tabs that were not explicitly persisted.
    var pages = Object.keys(highlightsStore).filter(function (url) {
      return /^https?:\/\//i.test(url) && highlightsStore[url] && highlightsStore[url].enabled === true;
    }).map(function (url) { return { url: url, highlights: savedFor(url) }; });
    if (exportHighlightUrl) URL.revokeObjectURL(exportHighlightUrl);
    exportHighlightUrl = URL.createObjectURL(new Blob([JSON.stringify({ v: 1, pages: pages }, null, 2)], { type: "application/json" }));
    var link = document.createElement("a");
    link.href = exportHighlightUrl;
    link.download = "fub-highlights.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  var current = null; // { metadata, reader, articleHtml, selection, highlights }
  var shouldSaveHighlights = false;
  var converted = null; // { markdown, assets, notes }
  var lastArtifact = null;
  var aiSettings = FubInterpreter.DEFAULTS;
  var aiKey = null;
  var aiGrants = { provider: [], images: [] };
  var downloadDisposers = new Set();
  var manualUrls = [];
  var pageGone = false;
  var downloadGeneration = 0;
  function disposeDownloads() {
    downloadDisposers.forEach(function (fn) { try { fn(); } catch (e) { /* popup closing */ } });
    downloadDisposers.clear();
  }
  function clearManualUrls() {
    manualUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    manualUrls = [];
  }
  // Extension i18n (apps/clipper/src/i18n.js, IT/EN): static markup via
  // data-i18n + applyStatic, runtime strings via t(key, enFallback).
  function t(key, en) {
    try {
      if (typeof FubI18n !== "undefined" && FubI18n.t) return FubI18n.t(key, en);
    } catch (e) { /* fall through */ }
    return en;
  }
  function errLabel(code) {
    return t("errors." + code, code);
  }

  function activeTab() {
    if (bn && bn.tabs && bn.tabs.query) {
      try {
        var p = bn.tabs.query({ active: true, currentWindow: true });
        if (p && p.then) return p.then(function (t) { return t[0]; });
        return new Promise(function (res) { bn.tabs.query({ active: true, currentWindow: true }, function (t) { res(t[0]); }); });
      } catch (e) { return Promise.resolve(null); }
    }
    return Promise.resolve(null);
  }

  // No content_scripts in the manifest (minimal permissions): inject
  // src/extract.js (+ selectors.js for struct inventory) on demand after the
  // user opened the popup (activeTab), then ask the isolated world for the
  // capture. MV3 scripting first, MV2 tabs.executeScript (Firefox/ESR) as
  // fallback.
  function injectExtract(tabId) {
    var files = ["src/selectors.js", "src/extract.js"];
    try {
      if (bn && bn.scripting && bn.scripting.executeScript) {
        return bn.scripting.executeScript({ target: { tabId: tabId }, files: files }).then(function () { return true; }, function () { return false; });
      }
    } catch (e) { /* fall through to MV2 API */ }
    return new Promise(function (resolve) {
      var step = function (i) {
        if (i >= files.length) { resolve(true); return; }
        try {
          if (bn && bn.tabs && bn.tabs.executeScript) bn.tabs.executeScript(tabId, { file: files[i] }, function () { step(i + 1); });
          else resolve(false);
        } catch (e2) { resolve(false); }
      };
      step(0);
    });
  }

  function askContent(tabId, msg) {
    return new Promise(function (resolve) {
      try {
        var p = bn.tabs.sendMessage(tabId, msg);
        if (p && p.then) { p.then(resolve, function () { resolve(null); }); return; }
        bn.tabs.sendMessage(tabId, msg, function (r) { resolve(r || null); });
      } catch (e) { resolve(null); }
    });
  }

  function savedSelectors() {
    return storeGet(["fub-selectors"]).then(function (got) { return got["fub-selectors"] || []; });
  }

  function extractFromTab(tab) {
    currentUrl = pageKey(tab);
    $("persistHighlights").disabled = !currentUrl;
    $("persistHighlights").checked = savedFor(currentUrl).length > 0 || !!(highlightsStore[currentUrl] && highlightsStore[currentUrl].enabled === true);
    return savedSelectors().then(function (selectors) {
      return injectExtract(tab.id).then(function () {
        var marks = savedFor(currentUrl);
        var restore = marks.length ? askContent(tab.id, { type: "fub:restore-highlights", records: marks }) : Promise.resolve();
        return restore.then(function () { return askContent(tab.id, { type: "fub:extract", opts: { selectors: selectors } }); });
      });
    }).then(function (resp) { return resp && resp.ok ? resp.data : null; });
  }

  function highlightInTab(tab) {
    return injectExtract(tab.id).then(function () { return askContent(tab.id, { type: "fub:highlight-selection" }); });
  }

  function load() {
    setError("");
    // A context-menu action may have stored a pending kind + source tab
    // (background keeps the tab id because openPopup is not guaranteed).
    var pending = null;
    var pendingTab = null;
    try {
      var raw = localStorage.getItem("fub-pending-kind");
      if (raw) { pending = raw; localStorage.removeItem("fub-pending-kind"); }
      var rawt = localStorage.getItem("fub-pending-tab");
      if (rawt !== null && rawt !== "") { pendingTab = Number(rawt); localStorage.removeItem("fub-pending-tab"); }
    } catch (e) { /* storage may be unavailable; default kind */ }
    var st = (bn && bn.storage && bn.storage.local) || null;
    var takePending = function () {
      if (!st) return Promise.resolve({ kind: pending, tabId: pendingTab });
      try {
        var p = st.get(["fub-pending-kind", "fub-pending-tab"]);
        if (p && p.then) return p.then(function (got) {
          try { st.remove(["fub-pending-kind", "fub-pending-tab"]); } catch (e0) { /* ignore */ }
          return { kind: got["fub-pending-kind"] || pending, tabId: got["fub-pending-tab"] !== undefined ? got["fub-pending-tab"] : pendingTab };
        });
        return new Promise(function (res) {
          st.get(["fub-pending-kind", "fub-pending-tab"], function (got) {
            try { st.remove(["fub-pending-kind", "fub-pending-tab"]); } catch (e2) { /* ignore */ }
            res({ kind: (got && got["fub-pending-kind"]) || pending, tabId: (got && got["fub-pending-tab"] !== undefined) ? got["fub-pending-tab"] : pendingTab });
          });
        });
      } catch (e3) { return Promise.resolve({ kind: pending, tabId: pendingTab }); }
    };
    takePending().then(function (saved) {
      var kind = saved.kind;
      if (kind === "highlight") {
        // Highlight ran in-page from the context menu; jump straight to the
        // highlights capture so the user can Send/Copy immediately.
        try { $("kind").value = "highlights"; } catch (e4) { /* ignore */ }
      } else if (kind === "selection" || kind === "article") {
        try { $("kind").value = kind; } catch (e5) { /* ignore */ }
      }
      var useTab = function (tab) {
        if (!tab || tab.id === undefined || tab.id === null) { setError(errLabel("unavailable") + ": " + t("popup.tab.none", "no active tab")); return; }
        extractFromTab(tab).then(function (data) {
          if (data) onData(data, tab);
          else setError(errLabel("unavailable") + ": " + t("popup.read.blocked", "could not read this page (the content script is blocked here)"));
        });
      };
      if (saved.tabId !== null && saved.tabId !== undefined) {
        // Prefer the menu source tab over whatever is active now.
        try {
          var g = bn.tabs.get(saved.tabId);
          if (g && g.then) { g.then(useTab, function () { activeTab().then(useTab); }); return; }
          bn.tabs.get(saved.tabId, function (tab) {
            if (tab && tab.id !== undefined) useTab(tab);
            else activeTab().then(useTab);
          });
          return;
        } catch (e6) { /* fall through to active tab */ }
      }
      activeTab().then(useTab);
    });
  }

  function onData(data, tab) {
    current = data;
    var meta = data.metadata || {};
    var reader = data.reader || {};
    var head = (meta.title || (tab && tab.title) || t("popup.untitled", "Untitled")) +
      (meta.author ? " — " + meta.author : "") +
      (meta.url ? "\n" + meta.url : "") +
      (reader.kind ? "\n" + t("popup.reader", "reader") + ": " + reader.kind + (reader.chars ? " (" + reader.chars + " " + t("popup.chars", "chars") + ")" : "") : "");
    $("pageMeta").textContent = head + (reader.summary ? "\n" + reader.summary : "");
    if (!$("title").value) $("title").value = (meta.title || (tab && tab.title) || t("popup.untitled", "Untitled")).slice(0, 512);
    if (shouldSaveHighlights && $("persistHighlights").checked) {
      persistMarks(data.highlights).catch(function () { setError(t("popup.highlights.failed", "Could not save or clear highlights in extension storage.")); });
    }
    shouldSaveHighlights = false;
    refresh();
  }

  function chosenHtml() {
    if (!current) return "";
    var kind = $("kind").value;
    if (kind === "selection" && current.selection && current.selection.html) return current.selection.html;
    if (kind === "highlights" && current.highlights && current.highlights.length) {
      return "<ul>" + current.highlights.map(function (h) {
        return "<li><mark>" + h.text.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</mark></li>";
      }).join("") + "</ul>";
    }
    return current.articleHtml || "";
  }

  function baseContext() {
    var meta = (current && current.metadata) || {};
    var bodyText = FubConvert.htmlToMarkdown(chosenHtml(), {}, [], []).replace(/\s+/g, " ");
    var ctx = {
      source_url: meta.url || "",
      title: $("title").value || meta.title || "Untitled clip",
      clipped_at: new Date().toISOString(),
      excerpt: bodyText.slice(0, 280),
      body: bodyText,
      metadata: meta,
      highlights: (current && current.highlights) || [],
      selectionText: (current && current.selection && current.selection.text) || "",
      articleText: bodyText
    };
    // Custom selector captures (bounded upstream) join the template scope.
    try {
      ((current && current.custom) || []).forEach(function (c) {
        if (c && c.name) ctx["sel_" + String(c.name).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64)] = (c.nodes || []).join("\n");
      });
    } catch (e) { /* context stays core-only */ }
    return ctx;
  }

  function currentTemplate() {
    var id = $("template").value;
    if (id === "default" || !id) return FubTemplates.DEFAULT_TEMPLATE;
    try {
      var raw = localStorage.getItem("fub-template-" + id);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through */ }
    return FubTemplates.DEFAULT_TEMPLATE;
  }

  function refresh() {
    downloadGeneration++;
    disposeDownloads();
    clearManualUrls();
    setError("");
    if (!current) return;
    var meta = current.metadata || {};
    var html = chosenHtml();
    var selOnly = $("kind").value !== "article";
    var clip;
    try {
      clip = FubConvert.clipHtml(html || "<p></p>", {
        url: meta.url || "",
        title: $("title").value || meta.title || "Untitled clip",
        selectionOnly: selOnly
      });
    } catch (e) {
      setError(errLabel("bad_args") + ": " + (e && e.message ? e.message : t("popup.convert.invalid", "invalid conversion")));
      return;
    }
    // Template render over structured context (bounded; filtered-out keeps
    // raw). Non-matching triggers keep the raw capture with a hint.
    var body = clip.markdown, properties;
    try {
      var tmpl = currentTemplate();
      var kinds = (current && current.struct && current.struct.kinds) || [];
      if (typeof FubTemplates.matchTrigger === "function" && !FubTemplates.matchTrigger(tmpl, meta.url || "", kinds)) {
        setStatus(t("popup.trigger.nomatch", "Template trigger does not match this page — showing raw capture."));
      } else {
        var rendered = FubTemplates.renderAll(tmpl, baseContext());
        body = rendered.body;
        properties = rendered.properties;
      }
    } catch (e) {
      if (!(e && e.code === "filtered-out")) setError(t("popup.template.invalid", "invalid template") + ": " + (e && e.message ? e.message : ""));
    }
    converted = { markdown: body, assets: clip.assets, notes: clip.notes, properties: properties };
    var extra = (clip.notes || []).map(function (n) { return "[" + n.level + "] " + n.message; }).join("\n");
    var customLines = ((current && current.custom) || []).map(function (c) {
      return "@" + (c.name || c.selector) + ": " + (c.error || ((c.nodes || []).length + " " + t("popup.nodes", "node(s)")));
    }).join("\n");
    var structLine = (current && current.struct && current.struct.kinds && current.struct.kinds.length)
      ? t("popup.structured", "structured") + ": " + current.struct.kinds.join(", ") : "";
    var tail = [extra, customLines, structLine].filter(function (s) { return s; }).join("\n");
    $("preview").textContent = body.slice(0, 20000) + (tail ? "\n\n--- " + t("popup.notes", "capture notes") + " ---\n" + tail : "");
    // Assets checklist: explicit opt-in per image, nothing auto-downloaded.
    var list = $("assetList");
    list.innerHTML = "";
    if (!clip.assets.length) {
      list.textContent = t("popup.images.none", "No images found.");
    } else {
      clip.assets.forEach(function (a, i) {
        var label = document.createElement("label");
        var cb = document.createElement("input");
        cb.type = "checkbox"; cb.value = a.orig_url; cb.id = "asset-" + i;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(" " + a.suggested_name + " (" + a.orig_url.slice(0, 60) + ")"));
        list.appendChild(label);
        list.appendChild(document.createElement("br"));
      });
    }
  }

  function target() {
    var t = { mode: $("mode").value };
    if ($("vault").value.trim()) t.vault = $("vault").value.trim();
    if ($("folder").value.trim()) t.folder = $("folder").value.trim();
    if ($("note").value.trim()) t.note = $("note").value.trim();
    return t;
  }
  function runtimeExtensionId() {
    try {
      if (bn && bn.runtime && bn.runtime.id) return String(bn.runtime.id);
    } catch (e) { /* ignore */ }
    return undefined;
  }
  function buildArtifact() {
    if (!converted) { var e = new Error(t("popup.capture.empty", "nothing captured yet")); e.code = "bad_args"; throw e; }
    return FubCapture.buildArtifact({
      v: 1,
      title: $("title").value || t("popup.untitled", "Untitled"),
      markdown: converted.markdown,
      source_url: (current && current.metadata && current.metadata.url) || undefined,
      target: target(),
      properties: converted.properties
    }, { extensionId: runtimeExtensionId() });
  }

  function send() {
    setError(""); setStatus("");
    var artifact;
    try {
      artifact = buildArtifact();
    } catch (e) {
      setError(errLabel(e.code || "bad_args") + ": " + (e && e.message ? e.message : ""));
      return;
    }
    lastArtifact = artifact;
    var generation = ++downloadGeneration;
    disposeDownloads();
    clearManualUrls();
    Array.prototype.slice.call($("assetList").querySelectorAll("a.manual-image-download")).forEach(function (a) { a.remove(); });
    var checked = Array.prototype.slice.call(document.querySelectorAll("#assetList input:checked")).map(function (c) { return c.value; });
    var assets = converted.assets;
    var attachRequested = $("attachImages").checked;
    var aborter = new AbortController();
    var abortDownload = function () { aborter.abort(); };
    if (checked.length) downloadDisposers.add(abortDownload);
    // NM-first (authenticated, paired); URI/file imports are the fallback and
    // always UNAUTHENTICATED with explicit per-capture app approval.
    FubChannel.sendArtifact(artifact, { browserNs: bn, persistent: attachRequested && checked.length > 0, signal: aborter.signal }).then(function (r) {
      if (pageGone || generation !== downloadGeneration) {
        if (r.session) r.session.close();
        downloadDisposers.delete(abortDownload);
        return;
      }
      if (r.session) downloadDisposers.add(r.session.close);
      if (r.transport && r.transport.kind === "native") {
        var res = r.result || { ok: false, kind: "unavailable" };
        if (res.ok) setStatus(t("popup.transport.native.ok", "Sent via paired native host. Same nonce, safe to retry."));
        else if (res.needs_pairing === true) {
          setError(t("errors.needs_pairing", "Needs pairing") + ": " + t("popup.pairing.required", "Needs pairing: run `fub-cli pair --extension-id <id>` first, then retry with the same nonce."));
        } else {
          setError(errLabel(res.kind || "unavailable") + (res.message ? ": " + res.message : ""));
        }
      } else if (r.delivered) setStatus(r.transport.kind === "uri"
        ? t("popup.transport.uri", "UNAUTHENTICATED import: Fub app opened — confirm vault + destination there. Same nonce, safe to retry.")
        : t("popup.transport.file", "Saved — run `fub-cli capture --file <it>`. Same nonce, safe to retry."));
      else if (r.reason === "manual-save") setStatus(t("popup.transport.manual", "Safari has no downloads permission: use Copy file JSON, then `fub-cli capture --file <it>`."));
      // Explicit image downloads for checked assets only (granted origins).
      // fetch is passed explicitly: the cap needs real bytes on every path,
      // including the browser downloads path (staged blob, never raw URL).
      // The popup owns running fetches and staged URLs until download
      // completion (or cancellation on pagehide). No time-based revocation.
      if (attachRequested && !(r.transport && r.transport.kind === "native" && r.result && r.result.ok === true)) {
        setError(t("popup.images.attach.needs_native", "Images were not fetched or attached: a paired native capture must succeed first."));
        downloadDisposers.delete(abortDownload);
        return;
      }
      if (checked.length) {
        var plan = FubImages.planDownloads(assets, checked);
        if (plan.errors.length) setError(plan.errors.join("\n"));
        // The capture and all attachments share a single persistent native
        // port. A one-shot message per image would lose host transfer state.
        var ctx = {
          browserNs: bn, grants: aiGrants, fetchFn: typeof fetch !== "undefined" ? fetch : undefined,
          signal: aborter.signal,
          onDispose: function (fn) {
            if (pageGone) { fn(); return function () {}; }
            downloadDisposers.add(fn);
            return function () { downloadDisposers.delete(fn); };
          }
        };
        if (attachRequested) {
          ctx.nativeHandoff = function (record) {
            if (pageGone || generation !== downloadGeneration) {
              var closed = new Error("popup closed"); closed.code = "unavailable"; throw closed;
            }
            return FubChannel.sendAttachment(record, artifact, { browserNs: bn, captureLib: FubCapture, signal: aborter.signal, session: r.session });
          };
        }
        FubImages.downloadChosen(plan.chosen, ctx).then(function (done) {
          if (pageGone || generation !== downloadGeneration) return;
          var completed = done.filter(function (d) { return d.status === "completed"; }).length;
          var manual = done.filter(function (d) { return d.status === "manual"; }).length;
          var failed = done.filter(function (d) { return d.status === "failed"; }).length;
          var attached = done.filter(function (d) { return d.status === "attached"; }).length;
          setStatus($("status").textContent + "\n" + attached + " " + t("popup.images.attached", "attached") +
            ", " + completed + " " + t("popup.images.files", "file(s)") +
            " " + t("popup.images.completed", "downloaded") + ", " + manual + " " +
            t("popup.images.manual", "ready to save") + (failed ? ", " + failed + " refused" : "") + ".");
          done.filter(function (d) { return d.status === "manual" && d.bytesView; }).forEach(function (d, mi) {
            try {
              var a = document.createElement("a");
              var url = URL.createObjectURL(new Blob([d.bytesView], { type: "application/octet-stream" }));
              manualUrls.push(url);
              a.href = url;
              a.download = "fub-clip/" + (d.suggested_name || ("image-" + mi));
              a.className = "manual-image-download";
              a.textContent = t("popup.images.save", "Save") + " " + (d.suggested_name || ("image-" + mi));
              $("assetList").appendChild(a);
              $("assetList").appendChild(document.createElement("br"));
            } catch (e3) { setError(errLabel("unavailable")); }
          });
        }, function (e) { if (!pageGone && generation === downloadGeneration) setError(errLabel((e && e.code) || "unavailable")); })
          .finally(function () {
            downloadDisposers.delete(abortDownload);
            if (r.session) { downloadDisposers.delete(r.session.close); r.session.close(); }
          });
      }
      else {
        downloadDisposers.delete(abortDownload);
        if (r.session) { downloadDisposers.delete(r.session.close); r.session.close(); }
      }
    }, function (e) {
      if (!pageGone && generation === downloadGeneration) setError(errLabel(e && e.code ? e.code : "bad_args") + ": " + (e && e.message));
      downloadDisposers.delete(abortDownload);
    });
  }

  function copyJson() {
    setError(""); setStatus("");
    try {
      var artifact = lastArtifact || buildArtifact();
      var json = FubCapture.artifactJson(artifact);
      var done = function () { setStatus(t("popup.copied", "Copied .fubcapture.json") + " (" + json.length + " " + t("popup.chars", "chars") + ")."); };
      var refused = function () { setError(errLabel("unavailable") + ": " + t("popup.clipboard.refused", "clipboard refused")); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(done, refused);
      else {
        var ta = document.createElement("textarea");
        ta.value = json;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { refused(); }
        document.body.removeChild(ta);
      }
    } catch (e) {
      setError((e.code ? e.code + ": " : "") + e.message);
    }
  }

  function highlight() {
    setError("");
    activeTab().then(function (tab) {
      if (!tab || tab.id === undefined || tab.id === null) { setError(errLabel("unavailable") + ": " + t("popup.tab.none", "no active tab")); return; }
      highlightInTab(tab).then(function (r) {
        if (r && r.ok && r.data && r.data.created) {
          shouldSaveHighlights = $("persistHighlights").checked;
          setStatus(shouldSaveHighlights ? t("popup.highlight.persisted", "Highlight saved locally when this page reloads.") :
            t("popup.highlight.marked", "Highlight marked in this page (lost on reload — capture it with Send or Copy now)."));
          load();
        }
        else if (r && r.ok) setStatus(t("popup.highlight.none", "No selection to highlight."));
        else setError(errLabel("unavailable") + ": " + t("popup.highlight.blocked", "cannot highlight on this page"));
      });
    });
  }

  // --- assistant (opt-in only) -------------------------------------------
  function refreshAi() {
    var on = aiSettings.enabled === true;
    $("aiState").textContent = on
      ? ((aiSettings.provider === "remote" ? t("popup.ai.remote", "Remote") : t("popup.ai.local", "Local")) + " provider, context=" + aiSettings.context +
         ". " + (aiSettings.provider === "remote" ? t("popup.ai.leaves", "Context WILL leave the device on Ask — preview shows exactly what.") : t("popup.ai.stays", "Stays on localhost. Preview first, then Ask.")))
      : t("popup.ai.disabled", "Assistant disabled. Enable it in Options; nothing is sent anywhere until you preview and press Ask.");
    $("aiAsk").disabled = !on;
  }

  function aiPreview() {
    setError("");
    try {
      var req = FubInterpreter.buildRequest(aiSettings, baseContext(), $("aiPrompt").value || "Summarise", "");
      $("aiRequest").value = JSON.stringify(req, null, 2);
      return req;
    } catch (e) {
      setError(errLabel(e.code || "bad_args") + ": " + e.message);
      return null;
    }
  }

  function aiAsk() {
    setError("");
    var req = aiPreview();
    if (!req) return;
    var ctx = { apiKey: aiKey || undefined, grants: aiGrants };
    // fetch is only reached after explicit Ask click; key lives in memory.
    FubInterpreter.sendRequest(aiSettings, req, ctx).then(function (r) {
      $("aiResult").value = r.text;
      aiKey = null; // drop key from memory after the call
    }, function (e) {
      aiKey = null;
      var extra = e && e.code === "denied" ? " — " + t("options.origins", "Allowed origins") + ": " + t("options.origins.hint.short", "Options > Origins") : "";
      setError(errLabel(e.code || "bad_args") + ": " + (e && e.message ? e.message : "") + extra);
    });
  }

  window.addEventListener("pagehide", function () {
    pageGone = true;
    disposeDownloads();
    clearManualUrls();
    if (exportHighlightUrl) URL.revokeObjectURL(exportHighlightUrl);
  });
  document.addEventListener("DOMContentLoaded", function () {
    ["kind", "title", "mode", "vault", "folder", "note"].forEach(function (id) {
      $(id).addEventListener("input", refresh);
      $(id).addEventListener("change", refresh);
    });
    $("template").addEventListener("change", refresh);
    $("send").addEventListener("click", send);
    $("copy").addEventListener("click", copyJson);
    $("highlight").addEventListener("click", highlight);
    $("persistHighlights").addEventListener("change", saveHighlightOptIn);
    $("clearHighlights").addEventListener("click", clearHighlights);
    $("exportHighlights").addEventListener("click", exportHighlights);
    $("aiPreview").addEventListener("click", aiPreview);
    $("aiAsk").addEventListener("click", aiAsk);
    // Templates + assistant settings + origin grants from extension storage.
    storeGet(["fub-templates", "fub-ai", "fub-ai-key", "fub-origins", HIGHLIGHTS_KEY]).then(function (got) {
      var sel = $("template");
      (got["fub-templates"] || []).forEach(function (t) {
        if (!t || !t.name) return;
        var o = document.createElement("option");
        o.value = t.name; o.textContent = t.name;
        sel.appendChild(o);
        try { localStorage.setItem("fub-template-" + t.name, JSON.stringify(t)); } catch (e) { /* ignore */ }
      });
      if (got["fub-ai"]) aiSettings = FubInterpreter.sanitizeSettings(got["fub-ai"]);
      aiKey = got["fub-ai-key"] || null; // memory only, never written anywhere else
      aiGrants = FubInterpreter.sanitizeGrants(got["fub-origins"] || {});
      var saved = got[HIGHLIGHTS_KEY];
      highlightsStore = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
      try { if (typeof FubI18n !== "undefined" && FubI18n.applyStatic) FubI18n.applyStatic(); } catch (e2) { /* ignore */ }
      refreshAi();
      load();
    });
  });
})();
