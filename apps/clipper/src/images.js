/* Fub Clipper — images.js
 * Explicit image/attachment downloads. A visit never becomes an invisible
 * remote request: downloads happen only after the user presses Download, and
 * only for URLs already listed in the capture assets. UMD.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubImages = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_DOWNLOADS = 20;
  var MAX_BYTES = 25 * 1024 * 1024; // 25 MiB per file guard

  function isHttpUrl(s) {
    return typeof s === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 2048;
  }

  // Planning errors are opaque counts, never raw URLs: the popup already
  // lists the assets; echoing attacker-controlled URLs into error text adds
  // nothing and risks leaking secrets from crafted pages.
  function planDownloads(assets, wanted) {
    // wanted: array of orig_url explicitly checked by the user.
    var errs = [];
    var chosen = [];
    var byUrl = {};
    (assets || []).forEach(function (a) { byUrl[a.orig_url] = a; });
    var list = Array.isArray(wanted) ? wanted.slice(0, MAX_DOWNLOADS) : [];
    if (Array.isArray(wanted) && wanted.length > MAX_DOWNLOADS) {
      errs.push("max " + MAX_DOWNLOADS + " downloads per capture");
    }
    var badUrl = 0, unlisted = 0;
    list.forEach(function (url) {
      if (!isHttpUrl(url)) { badUrl++; return; }
      if (!byUrl[url]) { unlisted++; return; }
      chosen.push(byUrl[url]);
    });
    if (badUrl) errs.push(badUrl + " URL(s) refused (not http(s))");
    if (unlisted) errs.push(unlisted + " URL(s) refused (not a listed asset)");
    return { chosen: chosen, errors: errs };
  }

  // Content hash of downloaded bytes. WebCrypto only: when subtle crypto is
  // unavailable there is NO hash — callers get {ok:false, code:'unavailable'}
  // and the app computes the authoritative hash on import. A length tag is
  // not a hash and is never returned as one.
  async function sha256HexBytes(bytes) {
    try {
      if (typeof crypto !== "undefined" && crypto.subtle) {
        var digest = await crypto.subtle.digest("SHA-256", bytes);
        return { ok: true, sha256: Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("") };
      }
    } catch (e) { /* fall through to unavailable */ }
    return { ok: false, code: "unavailable" };
  }

  // ctx: { browserNs, fetchFn?, grants?, signal? }. grants = sanitizeGrants
  // output (interpreter.js): non-loopback image hosts require a grant, same
  // as provider origins. The byte cap is enforced on EVERY path with real
  // bytes: both the fetch path (tests) and the browser path stream through
  // fetchStreamed (reader loop aborts past MAX_BYTES, Content-Length never
  // trusted), and the browser then saves the already-capped blob via the
  // downloads API. Direct downloads.download(url) without a prior capped
  // fetch is never used — it could not enforce the limit.
  async function downloadChosen(chosen, ctx) {
    var FubI = null;
    try {
      FubI = (typeof FubInterpreter !== "undefined") ? FubInterpreter
        : (typeof require !== "undefined" && typeof module !== "undefined" && module.exports ? require("./interpreter.js") : null);
    } catch (e0) { FubI = null; }
    if (!FubI || !FubI.sanitizeGrants || !FubI.isGranted) {
      var eg = new Error("denied: grant engine unavailable"); eg.code = "denied"; throw eg;
    }
    var hasGrants = !!(ctx && ctx.grants);
    var grants = FubI.sanitizeGrants(hasGrants ? ctx.grants : {});
    var bn = (ctx && ctx.browserNs) || null;
    // Without completion events a downloads API cannot own a staged blob URL.
    // Return capped bytes for a manual user click instead of guessing when
    // download() has finished reading the URL.
    var canDownload = !!(bn && bn.downloads && bn.downloads.download &&
      bn.downloads.onChanged && bn.downloads.onChanged.addListener && bn.downloads.onChanged.removeListener);
    var results = [];
    var limited = (chosen || []).slice(0, MAX_DOWNLOADS);
    for (var i = 0; i < limited.length; i++) {
      var asset = limited[i];
      try {
        if (!isHttpUrl(asset.orig_url)) { var eu = new Error("not http(s)"); eu.code = "bad_args"; throw eu; }
        if (!hasGrants || !FubI.isGranted(grants, "images", asset.orig_url)) throw deniedGrant();
        if (ctx.signal && ctx.signal.aborted) { var ea = new Error("unavailable: download cancelled"); ea.code = "unavailable"; throw ea; }
        var rec = await fetchStreamed(asset, ctx);
        if (ctx.nativeHandoff) {
          var attached = await ctx.nativeHandoff(rec);
          if (!attached || attached.ok !== true) { var eh = new Error("native attachment refused"); eh.code = "unavailable"; throw eh; }
          results.push({ orig_url: asset.orig_url, suggested_name: asset.suggested_name,
            sha256: rec.sha256, bytes: rec.bytes, status: "attached" });
        } else if (canDownload) {
          var outcome = await saveCappedBlob(rec.bytesView, asset.suggested_name, bn, ctx);
          if (outcome.status === "completed") {
            results.push({ orig_url: asset.orig_url, suggested_name: asset.suggested_name,
              sha256: rec.sha256, bytes: rec.bytes, downloadId: outcome.downloadId, status: "completed" });
          } else {
            results.push({ orig_url: asset.orig_url, suggested_name: asset.suggested_name,
              downloadId: outcome.downloadId, status: "failed", code: "unavailable" });
          }
        } else {
          // A manual link is created in the popup and clicked by the user.
          // No base64 copy or metadata-only "download": return actual bytes.
          results.push({ orig_url: asset.orig_url, suggested_name: asset.suggested_name,
            sha256: rec.sha256, bytes: rec.bytes, bytesView: rec.bytesView, status: "manual" });
        }
      } catch (e) {
        results.push({ orig_url: asset.orig_url, suggested_name: asset.suggested_name,
          status: "failed", code: (e && e.code) || "unavailable" });
      }
    }
    return results;
  }

  // The URL is owned until the browser reports complete/interrupted, or the
  // caller disposes the popup context. Resolving downloads.download only
  // means STARTED; revoking at that point can corrupt a still-reading file.
  function saveCappedBlob(bytes, name, bn, ctx) {
    return new Promise(function (resolve, reject) {
      var url = null, id = null, settled = false, disposed = false;
      var early = Object.create(null);
      var unregister = null;
      var changes = bn.downloads.onChanged;
      var cancel = bn.downloads.cancel;
      function finish(status) {
        if (settled) return;
        settled = true;
        try { changes.removeListener(onChanged); } catch (e0) { /* closing */ }
        if (typeof unregister === "function") unregister();
        if (url) URL.revokeObjectURL(url);
        resolve({ downloadId: id, status: status });
      }
      function onChanged(delta) {
        if (!delta || !delta.state || (delta.state.current !== "complete" && delta.state.current !== "interrupted")) return;
        if (id === null) { early[delta.id] = delta.state.current; return; }
        if (delta.id === id) finish(delta.state.current === "complete" ? "completed" : "failed");
      }
      function dispose() {
        disposed = true;
        if (id !== null && typeof cancel === "function") {
          try { var p = cancel.call(bn.downloads, id); if (p && p.catch) p.catch(function () {}); } catch (e0) { /* closing */ }
        }
        finish("failed");
      }
      try {
        url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
        changes.addListener(onChanged);
        if (ctx && typeof ctx.onDispose === "function") unregister = ctx.onDispose(dispose);
        if (settled) return;
        // Firefox's browser.* API is Promise-only; Chrome's chrome.* API
        // historically used a callback. Settle exactly once for either form.
        var promiseApi = typeof browser !== "undefined" && bn === browser;
        var started = new Promise(function (res, rej) {
          var done = false;
          function ok(value) { if (!done) { done = true; res(value); } }
          function fail(err) { if (!done) { done = true; rej(err); } }
          try {
            var options = { url: url, filename: "fub-clip/" + name, saveAs: false };
            var p = promiseApi ? bn.downloads.download(options) : bn.downloads.download(options, function (downloadId) {
              var err = bn.runtime && bn.runtime.lastError;
              if (err) fail(err); else ok(downloadId);
            });
            if (p && typeof p.then === "function") p.then(ok, fail);
            else if (p !== undefined) ok(p);
          } catch (e1) { fail(e1); }
        });
        started.then(function (downloadId) {
          if (!Number.isInteger(downloadId)) { finish("failed"); return; }
          id = downloadId;
          if (disposed) { dispose(); return; }
          if (early[id]) finish(early[id] === "complete" ? "completed" : "failed");
        }, function () { finish("failed"); });
      } catch (e2) {
        if (!settled) {
          settled = true;
          try { changes.removeListener(onChanged); } catch (e3) { /* not registered */ }
          if (typeof unregister === "function") unregister();
          if (url) URL.revokeObjectURL(url);
          var unavailable = new Error("unavailable: cannot stage download");
          unavailable.code = "unavailable";
          reject(unavailable);
        }
      }
    });
  }

  function deniedGrant() {
    // Opaque on purpose: the failing URL/secret context never enters error
    // text; the popup already knows which origin it asked about.
    var e = new Error("denied: image origin not granted");
    e.code = "denied";
    return e;
  }


  async function fetchStreamed(asset, ctx) {
    // Explicit fetch with a real byte cap; no ambient network request.
    if (!ctx || !ctx.fetchFn) { var en = new Error("unavailable: no fetch for capped download"); en.code = "unavailable"; throw en; }
    var res = await ctx.fetchFn(asset.orig_url, { redirect: "error", signal: ctx.signal });
    // A 404/500 body must never become a saved attachment.
    if (!res.ok) { var e0 = new Error("unavailable: image fetch failed"); e0.code = "unavailable"; e0.httpStatus = res.status; throw e0; }
    // Stream with a real byte budget: never trust Content-Length alone, never
    // buffer past MAX_BYTES before refusing. Supported browsers expose
    // ReadableStream; without it there is no bounded path — report
    // unavailable instead of an unbounded arrayBuffer fallback.
    if (!res.body || typeof res.body.getReader !== "function") {
      var eu = new Error("unavailable: streaming download not supported here"); eu.code = "unavailable"; throw eu;
    }
    var reader = res.body.getReader();
    var chunks = [];
    var total = 0;
    var capped = false;
    try {
      for (;;) {
        var part = await reader.read();
        if (part.done) break;
        var v = part.value;
        var buf = v && v.buffer ? new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength) : new Uint8Array(0);
        total += buf.byteLength;
        if (total > MAX_BYTES) { capped = true; break; }
        chunks.push(buf);
      }
    } finally {
      // Cleanup runs even when read() rejects: cancel first, always release.
      try { await reader.cancel(); } catch (e1) { /* ignore */ }
      try { reader.releaseLock(); } catch (e2) { /* ignore */ }
    }
    if (capped) { var e3 = new Error("exceeds 25 MiB guard"); e3.code = "bad_args"; throw e3; }
    var full = new Uint8Array(total);
    var off = 0;
    for (var i = 0; i < chunks.length; i++) { full.set(chunks[i], off); off += chunks[i].byteLength; }
    var h = await sha256HexBytes(full.buffer);
    if (!h.ok) { var e4 = new Error("hash unavailable in this context — app hashes on import"); e4.code = "unavailable"; throw e4; }
    return { orig_url: asset.orig_url, suggested_name: asset.suggested_name, sha256: h.sha256, bytes: total, bytesView: full, status: "fetched" };
  }

  return {
    MAX_DOWNLOADS: MAX_DOWNLOADS,
    MAX_BYTES: MAX_BYTES,
    isHttpUrl: isHttpUrl,
    planDownloads: planDownloads,
    sha256HexBytes: sha256HexBytes,
    downloadChosen: downloadChosen,
    fetchStreamed: fetchStreamed
  };
});
