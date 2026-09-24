/* Fub Clipper — interpreter.js
 * Opt-in assisted interpretation. Default: OFF, nothing leaves the device.
 * Enabling requires ALL of: user toggles opt-in in options, picks a provider
 * (local endpoint or remote with explicit base URL), and — for remote —
 * stores an API key in extension storage (never in page content, never in
 * fub:// queries, never logged). Each request shows its exact payload for
 * preview and needs a click; results return as text and NEVER write to the
 * vault automatically — the user pastes/applies them deliberately. UMD.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubInterpreter = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULTS = {
    enabled: false,
    provider: "local", // 'local' | 'remote'
    localBaseUrl: "http://127.0.0.1:11434",
    localModel: "llama3.1",
    remoteBaseUrl: "",
    remoteModel: "",
    context: "selection", // 'selection' | 'article' | 'highlights' | 'custom'
    maxChars: 12000
  };

  var REQUEST_TIMEOUT_MS = 30000;
  var MAX_RESPONSE_CHARS = 200000;
  var MAX_REPLY_TEXT = 20000;

  // Origin grants (explicit user choice, stored in extension storage as
  // 'fub-origins': { provider: ["https://host/", ...], images: [...] }).
  // The extension never grants itself origins: every non-loopback network
  // target must come from this list. Targets not listed are refused before
  // any request, regardless of CORS permissiveness.
  function normalizeOrigin(s) {
    var t = String(s || "").trim();
    if (!t) return "";
    var withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : "https://" + t;
    var u;
    try { u = new URL(withScheme); }
    catch (e) { return ""; }
    if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopbackHost(u.hostname))) return "";
    if (u.username || u.password) return "";
    var port = u.port ? ":" + u.port : "";
    return u.protocol + "//" + u.hostname.toLowerCase() + port + "/";
  }

  function isLoopbackHost(h) {
    h = String(h || "").toLowerCase();
    return h === "127.0.0.1" || h === "::1" || h === "localhost";
  }

  function sanitizeGrants(raw) {
    var out = { provider: [], images: [] };
    var src = raw || {};
    ["provider", "images"].forEach(function (k) {
      var list = Array.isArray(src[k]) ? src[k] : [];
      var seen = {};
      list.forEach(function (o) {
        var n = normalizeOrigin(o);
        if (n && !seen[n] && out[k].length < 32) { seen[n] = true; out[k].push(n); }
      });
    });
    return out;
  }

  function originOf(url) {
    try {
      var u = new URL(String(url));
      if (u.username || u.password) return "";
      var port = u.port ? ":" + u.port : "";
      return u.protocol + "//" + u.hostname.toLowerCase() + port + "/";
    } catch (e) { return ""; }
  }

  function isGranted(grants, kind, url) {
    if (kind === "provider-local") return true;
    var list = (grants && grants[kind === "provider" ? "provider" : "images"]) || [];
    var o = originOf(url);
    return o !== "" && list.indexOf(o) !== -1;
  }

  var PROVIDERS = [
    { id: "local", label: "Local model (Ollama-compatible, localhost)", kind: "local" },
    { id: "remote", label: "Remote OpenAI-compatible endpoint (key required)", kind: "remote" }
  ];

  function sanitizeSettings(raw) {
    var s = Object.assign({}, DEFAULTS, raw || {});
    s.enabled = s.enabled === true;
    if (PROVIDERS.map(function (p) { return p.id; }).indexOf(s.provider) === -1) s.provider = "local";
    s.localBaseUrl = String(s.localBaseUrl || DEFAULTS.localBaseUrl).slice(0, 512);
    s.localModel = String(s.localModel || "").slice(0, 128);
    s.remoteBaseUrl = String(s.remoteBaseUrl || "").slice(0, 512);
    s.remoteModel = String(s.remoteModel || "").slice(0, 128);
    var c = ["selection", "article", "highlights", "custom"].indexOf(s.context) !== -1 ? s.context : "selection";
    s.context = c;
    s.maxChars = Math.max(500, Math.min(100000, Number(s.maxChars) || DEFAULTS.maxChars));
    return s;
  }

  function requiresKey(settings) {
    return settings.provider === "remote";
  }

  function endpointFor(settings) {
    if (settings.provider === "local") {
      var base = (settings.localBaseUrl || "").replace(/\/+$/, "");
      // Local means loopback only: parse as URL, refuse credentials, LAN,
      // non-http schemes and anything but 127.0.0.1/localhost/::1, so a
      // "local" label can never exfiltrate to a network box.
      var u;
      try { u = new URL(base); }
      catch (e0) { var e00 = new Error("bad_args: local provider must be http://127.0.0.1:port or http://localhost:port"); e00.code = "bad_args"; throw e00; }
      if (u.protocol !== "http:") { var e = new Error("bad_args: local provider must be http://127.0.0.1:port or http://localhost:port"); e.code = "bad_args"; throw e; }
      if (u.username || u.password) { var e2 = new Error("bad_args: credentials in provider URL are forbidden"); e2.code = "bad_args"; throw e2; }
      if (!isLoopbackHost(u.hostname)) { var e3 = new Error("bad_args: local provider must be http://127.0.0.1:port or http://localhost:port"); e3.code = "bad_args"; throw e3; }
      var norm = "http://" + u.hostname.toLowerCase() + (u.port ? ":" + u.port : "");
      return { url: norm + "/api/generate", model: settings.localModel, auth: "none" };
    }
    var rbase = (settings.remoteBaseUrl || "").replace(/\/+$/, "");
    var ru;
    try { ru = new URL(rbase); }
    catch (e4) { var e5 = new Error("bad_args: remote provider must be https://"); e5.code = "bad_args"; throw e5; }
    if (ru.protocol !== "https:") { var e6 = new Error("bad_args: remote provider must be https://"); e6.code = "bad_args"; throw e6; }
    if (ru.username || ru.password) { var e7 = new Error("bad_args: credentials in provider URL are forbidden"); e7.code = "bad_args"; throw e7; }
    var rnorm = "https://" + ru.hostname.toLowerCase() + (ru.port ? ":" + ru.port : "");
    return { url: rnorm + "/v1/chat/completions", model: settings.remoteModel, auth: "bearer-key" };
  }

  // Builds the exact request object the user will preview. Pure.
  // Never called unless settings.enabled === true (callers enforce).
  function buildRequest(settings, captures, prompt, customText) {
    if (!settings.enabled) { var e = new Error("denied: interpreter is not enabled"); e.code = "denied"; throw e; }
    var ctx = "";
    if (settings.context === "selection") ctx = captures.selectionText || "";
    else if (settings.context === "article") ctx = captures.articleText || "";
    else if (settings.context === "highlights") ctx = (captures.highlights || []).map(function (h) { return "- " + h.text; }).join("\n");
    else ctx = String(customText || "");
    ctx = ctx.slice(0, settings.maxChars);
    var ep = endpointFor(settings);
    return {
      endpoint: ep.url,
      model: ep.model,
      auth: ep.auth, // 'none' | 'bearer-key' (key injected at send time, never stored here)
      leavesDevice: settings.provider === "remote",
      disclosure: settings.provider === "remote"
        ? "Remote provider: the context below leaves this device to " + ep.url + "."
        : "Local provider: the context below stays on localhost (" + ep.url + ").",
      messages: [
        { role: "system", content: "You help summarise/interpret a web capture. Answer in Markdown. Never invent URLs." },
        { role: "user", content: "Instruction: " + String(prompt || "Summarise").slice(0, 2000) + "\n\n--- context ---\n" + ctx }
      ]
    };
  }

  // ctx: { fetchFn?, apiKey?, grants?, signal? }. apiKey lives in memory for
  // this call only. grants = sanitizeGrants(...) output; remote fetches and
  // non-loopback targets require a grant. signal = caller-owned
  // AbortController signal (timeout/cancel); when absent and AbortController
  // exists, a 30 s timeout controller is created and owned here.
  async function sendRequest(settings, request, ctx) {
    if (!settings.enabled) { var e = new Error("denied: interpreter is not enabled"); e.code = "denied"; throw e; }
    var grants = sanitizeGrants((ctx && ctx.grants) || {});
    // Recompute the authoritative endpoint from settings: a tampered request
    // (endpoint swapped after preview) never decides where bytes go, and the
    // preview must equal what is sent (compareEndpoint below refuses drift).
    var ep = endpointFor(settings);
    if (!request || request.endpoint !== ep.url || request.model !== ep.model || request.auth !== ep.auth) {
      var em = new Error("bad_args: request does not match the configured provider (re-preview after changing settings)");
      em.code = "bad_args";
      throw em;
    }
    if (ep.auth === "bearer-key" && !(ctx && ctx.apiKey)) {
      var e3 = new Error("bad_args: remote provider needs an API key"); e3.code = "bad_args"; throw e3;
    }
    var grantKind = settings.provider === "local" ? "provider-local" : "provider";
    if (!isGranted(grants, grantKind, ep.url)) {
      var eg = new Error("denied: origin not granted — add it in Options > Origins first");
      eg.code = "denied";
      throw eg;
    }
    var fetchFn = (ctx && ctx.fetchFn) || (typeof fetch !== "undefined" ? fetch : null);
    if (!fetchFn) { var e2 = new Error("unavailable: no fetch in this context"); e2.code = "unavailable"; throw e2; }
    var headers = { "content-type": "application/json" };
    var body;
    if (settings.provider === "local") {
      body = { model: request.model, prompt: request.messages.map(function (m) { return m.content; }).join("\n\n"), stream: false };
    } else {
      headers.authorization = "Bearer " + ctx.apiKey;
      body = { model: request.model, messages: request.messages };
    }
    var signal = ctx && ctx.signal;
    var owned = null;
    var timer = null;
    if (!signal && typeof AbortController !== "undefined") {
      owned = new AbortController();
      signal = owned.signal;
      timer = setTimeout(function () { try { owned.abort(); } catch (e4) { /* ignore */ } }, REQUEST_TIMEOUT_MS);
    }
    var res;
    try {
      // redirect:'error': a "local" endpoint answering 307 to a remote host
      // must fail closed, never follow the context off-device.
      res = await fetchFn(ep.url, { method: "POST", headers: headers, body: JSON.stringify(body), redirect: "error", signal: signal });
    } catch (e5) {
      var en = new Error("unavailable: provider request failed");
      en.code = "unavailable";
      throw en;
    } finally {
      if (timer !== null) { try { clearTimeout(timer); } catch (e6) { /* ignore */ } }
    }
    if (!res.ok) {
      // Provider bodies may echo keys/context: report the status only, keep
      // the raw body out of error text.
      var err = new Error("provider error: http " + res.status);
      err.code = res.status === 401 || res.status === 403 ? "denied" : "unavailable";
      err.httpStatus = res.status;
      throw err;
    }
    var rawText = "";
    try {
      if (res.text) rawText = await res.text();
      else rawText = JSON.stringify(await res.json());
    } catch (e7) { rawText = ""; }
    // Cap BEFORE parse: a hostile provider cannot force unbounded JSON work.
    if (rawText.length > MAX_RESPONSE_CHARS) rawText = rawText.slice(0, MAX_RESPONSE_CHARS);
    var data = null;
    try { data = JSON.parse(rawText); } catch (e8) { data = null; }
    // Normalise both shapes to plain text; NEVER write anywhere. Cap again
    // after extraction so oversized fields cannot reach the UI unbounded.
    if (data && typeof data.response === "string") return { text: data.response.slice(0, MAX_REPLY_TEXT), raw: "local" };
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
      return { text: String(data.choices[0].message.content || "").slice(0, MAX_REPLY_TEXT), raw: "remote" };
    }
    return { text: rawText.slice(0, MAX_REPLY_TEXT), raw: "unknown" };
  }
  return {
    DEFAULTS: DEFAULTS,
    PROVIDERS: PROVIDERS,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    MAX_RESPONSE_CHARS: MAX_RESPONSE_CHARS,
    MAX_REPLY_TEXT: MAX_REPLY_TEXT,
    sanitizeSettings: sanitizeSettings,
    requiresKey: requiresKey,
    endpointFor: endpointFor,
    normalizeOrigin: normalizeOrigin,
    sanitizeGrants: sanitizeGrants,
    originOf: originOf,
    isGranted: isGranted,
    buildRequest: buildRequest,
    sendRequest: sendRequest
  };
});
