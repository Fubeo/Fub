/* Fub Clipper — options.js (classic script). Templates import/export,
 * selectors, and opt-in assistant settings. API keys live in extension
 * storage only (chrome.storage.local / browser.storage.local).
 */
(function () {
  "use strict";
  var bn = (typeof browser !== "undefined" ? browser : null) || (typeof chrome !== "undefined" ? chrome : null);

  function $(id) { return document.getElementById(id); }
  // Extension i18n (apps/clipper/src/i18n.js): t(key, en) honours ?lang= and
  // navigator.language, IT/EN dictionaries live in the extension, no client
  // files touched (FrontendIntegration owns apps/client/src/i18n/strings.ts).
  function t(key, en) {
    try {
      if (typeof FubI18n !== "undefined" && FubI18n.t) return FubI18n.t(key, en);
    } catch (e) { /* fall through */ }
    return en;
  }

  function store() {
    if (bn && bn.storage && bn.storage.local) return bn.storage.local;
    return null;
  }
  function get(keys) {
    var st = store();
    if (!st) return Promise.resolve({});
    try {
      var p = st.get(keys);
      if (p && p.then) return p;
      return new Promise(function (res) { st.get(keys, res); });
    } catch (e) { return Promise.resolve({}); }
  }
  function set(obj) {
    var st = store();
    if (!st) return Promise.reject(new Error("no extension storage in this context"));
    try {
      var p = st.set(obj);
      if (p && p.then) return p;
      return new Promise(function (res, rej) {
        st.set(obj, function () {
          var err = bn && bn.runtime && bn.runtime.lastError;
          if (err) rej(new Error(err.message || String(err)));
          else res();
        });
      });
    } catch (e) { return Promise.reject(e); }
  }

  function loadAll() {
    get(["fub-templates", "fub-selectors", "fub-ai", "fub-origins"]).then(function (got) {
      $("templateText").value = JSON.stringify(got["fub-templates"] || [], null, 2);
      $("selectorsText").value = JSON.stringify(got["fub-selectors"] || [], null, 2);
      var ai = FubInterpreter.sanitizeSettings(got["fub-ai"] || {});
      $("aiEnabled").checked = ai.enabled;
      $("aiProvider").value = ai.provider;
      $("aiLocalBase").value = ai.localBaseUrl;
      $("aiLocalModel").value = ai.localModel;
      $("aiRemoteBase").value = ai.remoteBaseUrl;
      $("aiRemoteModel").value = ai.remoteModel;
      $("aiContext").value = ai.context;
      var grants = FubInterpreter.sanitizeGrants(got["fub-origins"] || {});
      $("providerOrigins").value = grants.provider.join("\n");
      $("imageOrigins").value = grants.images.join("\n");
      renderPermState(ai, grants);
    });
  }

  function saveTemplates() {
    var arr;
    try { arr = JSON.parse($("templateText").value || "[]"); }
    catch (e) { error(t("options.templates.json", "templates: invalid JSON")); return; }
    if (!Array.isArray(arr)) { error(t("options.templates.array", "templates: must be a JSON array")); return; }
    for (var i = 0; i < arr.length; i++) {
      var errs = FubTemplates.validateTemplate(arr[i]);
      if (errs.length) { error("template[" + i + "]: " + errs.join("; ")); return; }
    }
    set({ "fub-templates": arr }).then(function () { status(t("options.templates.saved", "Templates saved.") + " (" + arr.length + ")"); }, function (e) { error(String(e.message || e)); });
  }

  function exportTemplates() {
    var blob = new Blob([$("templateText").value || "[]"], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "fub-clip-templates.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  function importFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var arr = JSON.parse(r.result);
        if (!Array.isArray(arr)) throw new Error(t("options.templates.array", "templates: must be a JSON array"));
        arr.forEach(function (tt, i) {
          var errs = FubTemplates.validateTemplate(tt);
          if (errs.length) throw new Error("template[" + i + "]: " + errs.join("; "));
        });
        $("templateText").value = JSON.stringify(arr, null, 2);
        status(t("options.templates.imported", "Imported — press Validate & save.") + " (" + arr.length + ")");
      } catch (e) { error("import: " + e.message); }
    };
    r.readAsText(f);
    ev.target.value = "";
  }

  function saveSelectors() {
    var arr;
    try { arr = JSON.parse($("selectorsText").value || "[]"); }
    catch (e) { error(t("options.selectors.json", "selectors: invalid JSON")); return; }
    if (!Array.isArray(arr) || arr.length > 16) { error(t("options.selectors.max", "selectors: max 16 entries")); return; }
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i] || typeof arr[i].selector !== "string" || !arr[i].selector) { error(t("options.selectors.required", "selector required") + " [" + i + "]"); return; }
      try { document.querySelector(arr[i].selector); }
      catch (e) { error(t("options.selectors.invalid", "invalid CSS selector") + " [" + i + "]"); return; }
    }
    set({ "fub-selectors": arr }).then(function () { status(t("options.selectors.saved", "Selectors saved.") + " (" + arr.length + ")"); }, function (e) { error(String(e.message || e)); });
  }

  function parseOriginLines(text) {
    return String(text || "").split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  }

  function renderPermState(ai, grants) {
    var lines = [];
    try {
      var ep = ai.enabled ? FubInterpreter.endpointFor(ai) : null;
      if (ep) {
        var kind = ai.provider === "local" ? "provider-local" : "provider";
        var ok = FubInterpreter.isGranted(grants, kind, ep.url);
        lines.push((ok ? t("options.perms.granted", "Browser permission granted.") + " " : t("options.perms.declined", "Browser permission declined — requests stay refused.") + " ") + ep.url + (ai.provider === "local" ? " (loopback)" : ""));
      } else {
        lines.push(t("options.perms.disabled", "assistant disabled: no provider origin needed."));
      }
    } catch (e) { lines.push("provider: invalid (" + t("options.ai.invalid", "check base URLs") + ")"); }
    $("permState").textContent = lines.join("\n");
  }
  function saveAi() {
    var provider = $("aiProvider").value;
    var remoteBase = $("aiRemoteBase").value.trim();
    if (provider === "remote" && !/^https:\/\//i.test(remoteBase)) {
      error(t("options.ai.https", "assistant: remote base URL must be https://")); return;
    }
    var ai = FubInterpreter.sanitizeSettings({
      enabled: $("aiEnabled").checked,
      provider: provider,
      localBaseUrl: $("aiLocalBase").value.trim(),
      localModel: $("aiLocalModel").value.trim(),
      remoteBaseUrl: remoteBase,
      remoteModel: $("aiRemoteModel").value.trim(),
      context: $("aiContext").value
    });
    var grants = FubInterpreter.sanitizeGrants({
      provider: parseOriginLines($("providerOrigins").value),
      images: parseOriginLines($("imageOrigins").value)
    });
    var obj = { "fub-ai": ai, "fub-origins": grants };
    var key = $("aiKey").value.trim();
    if (key) obj["fub-ai-key"] = key; // extension storage only
    set(obj).then(function () {
      $("aiKey").value = "";
      renderPermState(ai, grants);
      status(t("options.ai.saved", "Assistant settings saved."));
    }, function (e) { error(String(e.message || e)); });
  }

  function saveOrigins() {
    var grants = FubInterpreter.sanitizeGrants({
      provider: parseOriginLines($("providerOrigins").value),
      images: parseOriginLines($("imageOrigins").value)
    });
    $("providerOrigins").value = grants.provider.join("\n");
    $("imageOrigins").value = grants.images.join("\n");
    get(["fub-ai"]).then(function (got) {
      var ai = FubInterpreter.sanitizeSettings((got || {})["fub-ai"] || {});
      renderPermState(ai, grants);
    });
    set({ "fub-origins": grants }).then(function () {
      status(t("options.origins.saved", "Origins saved. Request browser permission to mirror them."));
    }, function (e) { error(String(e.message || e)); });
  }

  function clearKey() {
    var st = store();
    if (st && st.remove) {
      try {
        var forgotten = function () { status(t("options.key.forgotten", "API key forgotten.")); };
        var failed = function (e) { error(String(e.message || e)); };
        var p = st.remove("fub-ai-key");
        if (p && p.then) p.then(forgotten, failed);
        else st.remove("fub-ai-key", forgotten);
        return;
      } catch (e) { error(String(e.message || e)); return; }
    }
    error(t("options.storage.none", "no extension storage in this context"));
  }

  function requestPerms() {
    var wants = parseOriginLines($("providerOrigins").value).concat(parseOriginLines($("imageOrigins").value));
    var perms = bn && bn.permissions;
    try {
      var p = perms.request({ origins: wants });
      var done = function (granted) {
        get(["fub-ai"]).then(function (got) {
          var ai = FubInterpreter.sanitizeSettings((got || {})["fub-ai"] || {});
          get(["fub-origins"]).then(function (g2) {
            renderPermState(ai, FubInterpreter.sanitizeGrants((g2 || {})["fub-origins"] || {}));
          });
        });
        status(granted ? t("options.perms.granted", "Browser permission granted.") : t("options.perms.declined", "Browser permission declined — requests stay refused."));
      };
      if (p && p.then) p.then(done, function (e) { error(String(e.message || e)); });
      else perms.request({ origins: wants }, done);
    } catch (e) { error(String(e.message || e)); }
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("saveTemplates").addEventListener("click", saveTemplates);
    $("exportTemplates").addEventListener("click", exportTemplates);
    $("importFile").addEventListener("change", importFile);
    $("saveSelectors").addEventListener("click", saveSelectors);
    $("saveAi").addEventListener("click", saveAi);
    $("clearKey").addEventListener("click", clearKey);
    $("saveOrigins").addEventListener("click", saveOrigins);
    $("requestPerms").addEventListener("click", requestPerms);
    try { if (typeof FubI18n !== "undefined" && FubI18n.applyStatic) FubI18n.applyStatic(); } catch (e) { /* ignore */ }
    loadAll();
  });
})();
