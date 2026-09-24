/* Fub Clipper — capture.js
 * Pure capture-v1 builder + validator (no DOM, no chrome.*).
 * Mirrors the limits frozen with AutomationOwner:
 *   title 1..512 chars, markdown 1..1048576 bytes UTF-8,
 *   source_url http/https max 2048, folder/note relative (no .., absolute,
 *   drive, backslash, NUL), mode one of create|append|prepend|daily.
 * UMD: works as a classic extension script (globalThis.FubCapture) and
 * under node for the prepared limit tests (module.exports).
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubCapture = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TITLE_MAX = 512;
  var MARKDOWN_MAX_BYTES = 1048576; // 1 MiB
  var URL_MAX = 2048;
  var PATH_MAX = 512;
  var PROPS_MAX = 64;
  var PROP_KEY_MAX = 128;
  var PROP_STR_MAX = 4096;
  var PROP_ARR_MAX = 32;
  var URI_LEN_GUARD = 8000; // fub:// inline URIs longer than this fall back to file transport
  var ORIGIN = "clipper-extension";
  var MODES = ["create", "append", "prepend", "daily"];

  function utf8bytes(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
    if (typeof Buffer !== "undefined") return Buffer.byteLength(s, "utf8");
    var e = new Error("unavailable: UTF-8 encoder required"); e.code = "unavailable"; throw e;
  }

  function isHttpUrl(s) {
    if (typeof s !== "string" || s.length === 0 || s.length > URL_MAX) return false;
    if (/\s/.test(s)) return false;
    return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s);
  }

  function isRelativePath(s) {
    if (typeof s !== "string" || s.length === 0 || s.length > PATH_MAX) return false;
    if (s.indexOf("\x00") !== -1) return false;
    if (s.indexOf("\\") !== -1) return false;
    if (/^[A-Za-z]:[/\\]/.test(s)) return false;
    if (/^\//.test(s)) return false;
    var parts = s.split("/");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "..") return false;
    }
    return true;
  }

  function isValidTarget(t) {
    return validateTarget(t).length === 0;
  }

  function validateTarget(t) {
    var errs = [];
    if (!t || typeof t !== "object") return ["target: required object"];
    if (MODES.indexOf(t.mode) === -1) errs.push("target.mode: one of " + MODES.join("|"));
    if (t.vault !== undefined && (typeof t.vault !== "string" || t.vault.length === 0 || t.vault.length > 256)) {
      errs.push("target.vault: 1..256 chars");
    }
    if (t.folder !== undefined && !isRelativePath(t.folder)) errs.push("target.folder: relative path, no .., absolute, drive or backslash");
    if (t.note !== undefined && !isRelativePath(t.note)) errs.push("target.note: relative path, no .., absolute, drive or backslash");
    return errs;
  }

  function validateProperties(props) {
    var errs = [];
    if (props === undefined) return errs;
    if (!props || typeof props !== "object" || Array.isArray(props)) return ["properties: object"];
    var keys = Object.keys(props);
    if (keys.length > PROPS_MAX) errs.push("properties: max 64 entries");
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.length === 0 || k.length > PROP_KEY_MAX) { errs.push("properties key: 1..128 chars"); continue; }
      var v = props[k];
      if (typeof v === "string") { if (v.length > PROP_STR_MAX) errs.push("properties." + k + ": max 4096 chars"); }
      else if (typeof v === "number" || typeof v === "boolean") { /* ok */ }
      else if (Array.isArray(v)) {
        if (v.length > PROP_ARR_MAX) errs.push("properties." + k + ": max 32 items");
        for (var j = 0; j < v.length; j++) {
          if (typeof v[j] !== "string" || v[j].length > PROP_STR_MAX) { errs.push("properties." + k + ": string items max 4096 chars"); break; }
        }
      } else errs.push("properties." + k + ": string|number|boolean|string[]");
    }
    return errs;
  }

  function validatePayload(p) {
    var errs = [];
    if (!p || typeof p !== "object") return ["payload: required object"];
    if (p.v !== 1) errs.push("v: must be 1");
    if (typeof p.title !== "string" || p.title.length === 0 || p.title.length > TITLE_MAX) {
      errs.push("title: 1..512 chars");
    }
    if (typeof p.markdown !== "string" || p.markdown.length === 0 || p.markdown.length > MARKDOWN_MAX_BYTES || utf8bytes(p.markdown) > MARKDOWN_MAX_BYTES) {
      errs.push("markdown: non-empty, max 1 MiB UTF-8");
    }
    if (p.source_url !== undefined && !isHttpUrl(p.source_url)) errs.push("source_url: http(s) URL max 2048");
    var terrs = validateTarget(p.target);
    for (var i = 0; i < terrs.length; i++) errs.push(terrs[i]);
    var perrs = validateProperties(p.properties);
    for (var j = 0; j < perrs.length; j++) errs.push(perrs[j]);
    return errs;
  }

  function newEnvelope(origin, nonce, extensionId) {
    var n = nonce;
    if (!n) {
      if (typeof crypto !== "undefined" && crypto.randomUUID) n = crypto.randomUUID();
      else n = "n-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 0xffffff).toString(36);
    }
    var env = { nonce: String(n), origin: origin || ORIGIN };
    if (extensionId !== undefined && extensionId !== null && String(extensionId) !== "") {
      env.extension_id = String(extensionId).slice(0, 256);
    }
    try { env.timestamp_ms = Date.now(); } catch (e) { /* clock optional */ }
    return env;
  }

  function buildArtifact(payload, opts) {
    opts = opts || {};
    var errs = validatePayload(payload);
    if (errs.length) {
      var err = new Error("bad_args: " + errs.join("; "));
      err.code = "bad_args";
      err.details = errs;
      throw err;
    }
    return {
      kind: "fub-capture-v1",
      v: 1,
      envelope: newEnvelope(opts.origin, opts.nonce, opts.extensionId),
      payload: {
        v: 1,
        title: payload.title,
        markdown: payload.markdown,
        target: {
          mode: payload.target.mode,
          vault: payload.target.vault,
          folder: payload.target.folder,
          note: payload.target.note
        },
        source_url: payload.source_url,
        properties: payload.properties
      }
    };
  }

  function artifactFileName(title, stamp) {
    var base = String(title || "clip").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u4e00-\u9fff]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "clip";
    return base + "-" + (stamp || new Date().toISOString().slice(0, 10)) + ".fubcapture.json";
  }

  function artifactJson(artifact) {
    // Strip undefined so `fub-cli capture --file` sees exactly the frozen shape.
    return JSON.stringify(artifact, function (k, v) { return v === undefined ? undefined : v; }, 2) + "\n";
  }

  // fub://capture inline URI. Query keys (frozen, shared with AutomationOwner):
  //   v, title, markdown, source_url?, vault?, folder?, note?, mode,
  //   properties? (JSON string), nonce?, origin?, timestamp_ms?
  // Never carries secrets; never a `file=` pointer. URIs longer than
  // URI_LEN_GUARD throw {code:'too-large-for-uri'}: caller falls back to file.
  function encodeCaptureUri(artifact) {
    var p = artifact.payload, e = artifact.envelope || {};
    var params = new URLSearchParams();
    params.set("v", "1");
    params.set("title", p.title);
    params.set("markdown", p.markdown);
    if (p.source_url) params.set("source_url", p.source_url);
    if (p.target) {
      if (p.target.vault) params.set("vault", p.target.vault);
      if (p.target.folder) params.set("folder", p.target.folder);
      if (p.target.note) params.set("note", p.target.note);
      params.set("mode", p.target.mode);
    }
    if (p.properties) params.set("properties", JSON.stringify(p.properties));
    if (e.nonce) params.set("nonce", e.nonce);
    params.set("origin", e.origin || ORIGIN);
    if (e.timestamp_ms !== undefined) params.set("timestamp_ms", String(e.timestamp_ms));
    var uri = "fub://capture?" + params.toString();
    if (uri.length > URI_LEN_GUARD) {
      var err = new Error("too-large-for-uri: capture is " + uri.length + " chars, use file transport");
      err.code = "too-large-for-uri";
      err.uriLength = uri.length;
      throw err;
    }
    return uri;
  }

  function decodeCaptureUri(uri) {
    var m = /^fub:\/\/capture\?(.*)$/.exec(String(uri || ""));
    if (!m) { var e0 = new Error("bad_args: not a fub://capture URI"); e0.code = "bad_args"; throw e0; }
    var params = new URLSearchParams(m[1]);
    var payload = {
      v: 1,
      title: params.get("title") || "",
      markdown: params.get("markdown") || "",
      target: {
        mode: params.get("mode") || "",
        vault: params.get("vault") || undefined,
        folder: params.get("folder") || undefined,
        note: params.get("note") || undefined
      }
    };
    if (params.get("source_url")) payload.source_url = params.get("source_url");
    if (params.get("properties")) {
      try { payload.properties = JSON.parse(params.get("properties")); }
      catch (e) { var e1 = new Error("bad_args: properties is not JSON"); e1.code = "bad_args"; throw e1; }
    }
    var errs = validatePayload(payload);
    if (errs.length) { var e2 = new Error("bad_args: " + errs.join("; ")); e2.code = "bad_args"; e2.details = errs; throw e2; }
    return {
      kind: "fub-capture-v1", v: 1,
      envelope: {
        nonce: params.get("nonce") || "",
        origin: params.get("origin") || ORIGIN,
        timestamp_ms: params.get("timestamp_ms") ? Number(params.get("timestamp_ms")) : undefined
      },
      payload: payload
    };
  }

  return {
    TITLE_MAX: TITLE_MAX,
    MARKDOWN_MAX_BYTES: MARKDOWN_MAX_BYTES,
    URL_MAX: URL_MAX,
    PATH_MAX: PATH_MAX,
    URI_LEN_GUARD: URI_LEN_GUARD,
    ORIGIN: ORIGIN,
    MODES: MODES,
    utf8bytes: utf8bytes,
    isHttpUrl: isHttpUrl,
    isRelativePath: isRelativePath,
    validateTarget: validateTarget,
    validateProperties: validateProperties,
    validatePayload: validatePayload,
    newEnvelope: newEnvelope,
    buildArtifact: buildArtifact,
    artifactFileName: artifactFileName,
    artifactJson: artifactJson,
    encodeCaptureUri: encodeCaptureUri,
    decodeCaptureUri: decodeCaptureUri
  };
});
