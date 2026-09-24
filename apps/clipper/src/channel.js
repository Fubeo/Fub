/* Fub Clipper — channel.js
 * App channel, three tiers:
 *   (1) native messaging to `fub-clipper-host` (host name
 *       `local.fub.clipper`): the ONLY authenticated route. Auth is
 *       browser-enforced (allowed_origins/allowed_extensions in the host
 *       manifest written by `fub-cli native-install --extension-id`) PLUS
 *       host-side pairing (`fub-cli pair --extension-id [--vault --folder]`,
 *       otherwise denied with needs_pairing). Writes require the pair match.
 *   (2) fub://capture URI (short captures) and (3) .fubcapture.json file for
 *       `fub-cli capture --file`: UNAUTHENTICATED imports — any page can open
 *       fub:// — always gated by explicit per-capture app approval, never
 *       called authenticated. The envelope origin is a label, not a proof.
 * Responses are structured {ok,kind?,message?,nonce?,needs_pairing?} with
 * kind in bad_args|unavailable|denied|not_found|conflict; unknown text is an
 * opaque unavailable, never substring-classified. No open HTTP/WS ports, no
 * tokens in page content or URI queries. UMD.
 */
/* global FubCapture */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubChannel = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KIND = "fub-capture-v1";
  var HOST_NAME = "local.fub.clipper";
  var KINDS = ["bad_args", "unavailable", "denied", "not_found", "conflict"];

  function isStructuredError(o) {
    return !!o && typeof o === "object" && o.ok === false && KINDS.indexOf(o.kind) !== -1;
  }

  // Normalise a host response to {ok,kind?,message?,nonce?,needs_pairing?}.
  // Structured kinds pass through; anything else is opaque unavailable —
  // no substring classification of free text, ever.
  function asResult(resp) {
    if (resp && typeof resp === "object") {
      if (resp.ok === true) return { ok: true, nonce: resp.nonce };
      if (isStructuredError(resp)) {
        var r = { ok: false, kind: resp.kind };
        if (resp.message !== undefined) r.message = String(resp.message).slice(0, 500);
        if (resp.nonce !== undefined) r.nonce = resp.nonce;
        if (resp.needs_pairing === true) r.needs_pairing = true;
        return r;
      }
    }
    return { ok: false, kind: "unavailable" };
  }

  function describeTransport(artifact, uri, via) {
    if (via === "native") return { kind: "native", label: "Paired native host (authenticated); host still approves vault + destination per pair scope" };
    if (uri) return { kind: "uri", label: "UNAUTHENTICATED import: opens Fub app, confirm vault + destination there" };
    return { kind: "file", label: "UNAUTHENTICATED import: save .fubcapture.json, then `fub-cli capture --file <it>` — same nonce, safe to retry" };
  }

  function checkArtifact(artifact) {
    if (!artifact || artifact.kind !== KIND || artifact.v !== 1) {
      var e = new Error("bad_args: not a fub-capture-v1 artifact");
      e.code = "bad_args";
      throw e;
    }
  }

  // Tier 1: authenticated native message. ctx: { browserNs, captureLib? }.
  // Resolves to { result, transport } where result = asResult(host reply).
  // Throws {code:'unavailable'} when no native runtime exists (caller falls
  // back to URI/file imports).
  async function sendNative(artifact, ctx) {
    checkArtifact(artifact);
    var bn = (ctx && ctx.browserNs) || (typeof browser !== "undefined" ? browser : null) || (typeof chrome !== "undefined" ? chrome : null);
    var reply = await nativeMessage(bn, artifact);
    var result = asResult(reply);
    if (result.ok && result.nonce !== artifact.envelope.nonce) result = { ok: false, kind: "unavailable" };
    return { result: result, transport: describeTransport(artifact, null, "native") };
  }

  // Downloaded bytes are a different, native-only operation. Never pass
  // attachment bytes through URI/file imports: those are unauthenticated.
  function nativeMessage(bn, message) {
    if (!bn || !bn.runtime || !bn.runtime.sendNativeMessage) {
      var missing = new Error("paired native channel unavailable");
      missing.code = "unavailable";
      throw missing;
    }
    if (typeof browser !== "undefined" && bn === browser) return bn.runtime.sendNativeMessage(HOST_NAME, message);
    return new Promise(function (resolve, reject) {
      try {
        var maybePromise = bn.runtime.sendNativeMessage(HOST_NAME, message, function (reply) {
          var err = bn.runtime.lastError;
          if (err) { var unavailable = new Error("native channel unavailable"); unavailable.code = "unavailable"; reject(unavailable); }
          else resolve(reply);
        });
        if (maybePromise && typeof maybePromise.then === "function") maybePromise.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }
  function nativeError(reply, nonce) {
    var result = asResult(reply);
    if (result.ok && result.nonce === nonce) return;
    var e = new Error(result.ok ? "native nonce mismatch" : (result.kind || "unavailable"));
    e.code = result.ok ? "unavailable" : (result.kind || "unavailable");
    throw e;
  }
  function base64Chunk(bytes) {
    var text = "";
    for (var i = 0; i < bytes.length; i += 32768) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return btoa(text);
  }
  // connectNative (not sendNativeMessage) keeps ONE host process alive for
  // begin/chunk/commit. sendNativeMessage starts a new process on every call
  // and would lose the host's bounded transfer state between chunks.
  function attachmentPort(bn, signal) {
    if (!bn || !bn.runtime || !bn.runtime.connectNative) {
      var unavailable = new Error("paired native port unavailable");
      unavailable.code = "unavailable";
      throw unavailable;
    }
    var port = bn.runtime.connectNative(HOST_NAME), pending = null, closed = false;
    function failure() { var e = new Error("native attachment port closed"); e.code = "unavailable"; return e; }
    function onMessage(reply) {
      if (!pending) return;
      var done = pending; pending = null;
      done.resolve(reply);
    }
    function onDisconnect() {
      closed = true;
      if (pending) { var done = pending; pending = null; done.reject(failure()); }
      cleanup();
    }
    function onAbort() { close(); }
    function cleanup() {
      try { port.onMessage.removeListener(onMessage); port.onDisconnect.removeListener(onDisconnect); } catch (e) { /* already closed */ }
      if (signal) signal.removeEventListener("abort", onAbort);
    }
    function close() {
      if (closed) return;
      closed = true;
      if (pending) { var done = pending; pending = null; done.reject(failure()); }
      try { port.disconnect(); } catch (e) { /* already closed */ }
      cleanup();
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    return {
      send: function (request) {
        if (closed || pending) return Promise.reject(failure());
        return new Promise(function (resolve, reject) {
          pending = { resolve: resolve, reject: reject };
          try { port.postMessage(request); } catch (e) { pending = null; reject(failure()); }
        });
      },
      close: close
    };
  }

  async function sendAttachment(rec, artifact, ctx) {
    checkArtifact(artifact);
    if (!rec || !(rec.bytesView instanceof Uint8Array) || !rec.bytesView.length ||
        rec.bytesView.length > 25 * 1024 * 1024 || rec.bytes !== rec.bytesView.length ||
        typeof rec.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(rec.sha256) ||
        typeof rec.suggested_name !== "string" || rec.suggested_name.length > 255 ||
        rec.suggested_name === "." || rec.suggested_name === ".." ||
        !/^[a-zA-Z0-9._-]+$/.test(rec.suggested_name)) {
      var bad = new Error("invalid attachment metadata");
      bad.code = "bad_args";
      throw bad;
    }
    var bn = ctx && ctx.browserNs;
    var target = artifact.payload.target || {};
    var capture = (ctx && ctx.captureLib) || (typeof FubCapture !== "undefined" ? FubCapture : null);
    if (!capture) { var absent = new Error("capture library unavailable"); absent.code = "unavailable"; throw absent; }
    var envelope = capture.newEnvelope(null, null, artifact.envelope.extension_id);
    var channel = (ctx && ctx.session) || attachmentPort(bn, ctx && ctx.signal);
    try {
      var begin = await channel.send({
        kind: "fub-attachment-begin-v1", v: 1, envelope: envelope,
        target: { mode: "create", vault: target.vault, folder: target.folder },
        attachment: { name: rec.suggested_name, sha256: rec.sha256, bytes: rec.bytes }
      });
      nativeError(begin, envelope.nonce);
      var transferId = begin && begin.transfer_id;
      if (typeof transferId !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(transferId)) {
        var invalid = new Error("invalid native transfer id"); invalid.code = "unavailable"; throw invalid;
      }
      for (var pos = 0, index = 0; pos < rec.bytes; pos += 512 * 1024, index++) {
        var data = base64Chunk(rec.bytesView.subarray(pos, Math.min(pos + 512 * 1024, rec.bytes)));
        nativeError(await channel.send({
          kind: "fub-attachment-chunk-v1", v: 1, envelope: envelope,
          transfer_id: transferId, index: index, data: data
        }), envelope.nonce);
      }
      nativeError(await channel.send({
        kind: "fub-attachment-commit-v1", v: 1, envelope: envelope, transfer_id: transferId
      }), envelope.nonce);
      return { ok: true, name: rec.suggested_name, sha256: rec.sha256 };
    } catch (e) { channel.close(); throw e; }
    finally { if (!(ctx && ctx.session)) channel.close(); }
  }

  // Tiers 2/3: UNAUTHENTICATED imports (explicit per-capture app approval).
  // ctx: { browserNs, captureLib, openUri?, saveFile? } — all injectable.
  async function sendImport(artifact, ctx) {
    checkArtifact(artifact);
    var capture = (ctx && ctx.captureLib) || (typeof FubCapture !== "undefined" ? FubCapture : null);
    if (!capture) { var e2 = new Error("unavailable: capture library missing"); e2.code = "unavailable"; throw e2; }
    try {
      var uri = capture.encodeCaptureUri(artifact);
      if (ctx && ctx.openUri) { await ctx.openUri(uri); }
      else if (ctx && ctx.browserNs && ctx.browserNs.tabs && ctx.browserNs.tabs.create) {
        try { await ctx.browserNs.tabs.create({ url: uri }); }
        catch (e) {
          // Custom-protocol tabs can be refused (no OS handler, chrome://
          // tab): hand back a ready URI + copy path instead of failing.
          return { transport: describeTransport(artifact, uri, "uri"), delivered: false, reason: "app-open-refused: copy the file JSON or register the Fub app as fub:// handler" };
        }
      } else {
        return { transport: describeTransport(artifact, uri, "uri"), delivered: false, reason: "no tab opener in this context; URI ready to open" };
      }
      return { transport: describeTransport(artifact, uri, "uri"), delivered: true };
    } catch (err) {
      if (err && err.code === "too-large-for-uri") {
        var json = capture.artifactJson(artifact);
        var name = capture.artifactFileName(artifact.payload.title);
        if (ctx && ctx.saveFile) {
          await ctx.saveFile(name, json);
          return { transport: describeTransport(artifact, null, "file"), delivered: true, file: name };
        }
        var bn = ctx && ctx.browserNs;
        if (bn && bn.downloads && bn.downloads.download) {
          var url = "data:application/json;charset=utf-8," + encodeURIComponent(json);
          await bn.downloads.download({ url: url, filename: name, saveAs: true });
          return { transport: describeTransport(artifact, null, "file"), delivered: true, file: name };
        }
        // Safari (no downloads perm): return the payload so the popup offers
        // an explicit user-gesture blob-anchor save.
        return { transport: describeTransport(artifact, null, "file"), delivered: false, reason: "manual-save", file: name, json: json };
      }
      throw err;
    }
  }

  // Default send: native first (authenticated), URI/file imports as fallback.
  async function sendArtifact(artifact, ctx) {
    checkArtifact(artifact);
    try {
      if (ctx && ctx.persistent) {
        // Capture + attachments share one browser-authenticated host process
        // and its writer lock. A one-shot host could still hold the lock when
        // a second process tries to begin the byte transfer.
        var session = attachmentPort(ctx.browserNs, ctx.signal);
        try {
          var reply = await session.send(artifact);
          var result = asResult(reply);
          if (result.ok && result.nonce !== artifact.envelope.nonce) result = { ok: false, kind: "unavailable" };
          if (!result.ok) session.close();
          return { transport: describeTransport(artifact, null, "native"), delivered: result.ok,
            result: result, session: result.ok ? session : undefined };
        } catch (error) { session.close(); throw error; }
      }
      var nm = await sendNative(artifact, ctx);
      return { transport: nm.transport, delivered: nm.result.ok === true, result: nm.result };
    } catch (e) {
      if (e && e.code === "bad_args") throw e;
      if (ctx && ctx.signal && ctx.signal.aborted) throw e;
      // unavailable native runtime -> fall through to unauthenticated import.
    }
    return sendImport(artifact, ctx);
  }

  return {
    KIND: KIND,
    HOST_NAME: HOST_NAME,
    KINDS: KINDS,
    asResult: asResult,
    describeTransport: describeTransport,
    sendNative: sendNative,
    sendImport: sendImport,
    sendArtifact: sendArtifact,
    sendAttachment: sendAttachment
  };
});
