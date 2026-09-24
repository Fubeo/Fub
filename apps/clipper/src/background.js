/* Fub Clipper — background.js (classic script, no modules: Safari-safe).
 * Context menus + keyboard command. Minimal permissions: NO persistent
 * content scripts (no <all_urls> warning at install). Extraction runs only
 * after a user gesture: a menu click injects src/selectors.js + src/extract.js
 * on demand via scripting.executeScript (MV3) or tabs.executeScript
 * (MV2/Firefox fallback) — activeTab grants access — then stores the capture
 * kind + source tab id. openPopup() is not guaranteed (Chrome 109 service
 * workers, gesture lost after storage await): failure falls back to a
 * clickable notification that refocuses the source tab. The popup reads the
 * stored kind + tab and does the real work (NM-first send). Never touches
 * page content otherwise.
 */
(function () {
  "use strict";
  var bn = (typeof browser !== "undefined" ? browser : null) || (typeof chrome !== "undefined" ? chrome : null);
  if (!bn) return;

  function menus() {
    var m = bn.contextMenus || bn.menus;
    if (!m || !m.create) return;
    // Menu titles follow navigator.language (IT/EN), mirroring i18n.js keys
    // popup.menu.page/selection/highlight (duplicated here: service workers
    // cannot require() the popup i18n synchronously).
    var it = false;
    try { it = /^it\b/i.test((bn.i18n && bn.i18n.getUILanguage ? bn.i18n.getUILanguage() : navigator.language) || ""); } catch (e0) { /* ignore */ }
    try {
      m.create({ id: "fub-clip-page", title: it ? "Ritaglia la pagina in Fub" : "Clip page to Fub", contexts: ["page"] });
      m.create({ id: "fub-clip-selection", title: it ? "Ritaglia la selezione in Fub" : "Clip selection to Fub", contexts: ["selection"] });
      m.create({ id: "fub-highlight", title: it ? "Evidenzia la selezione (Fub)" : "Highlight selection (Fub)", contexts: ["selection"] });
    } catch (e) { /* menus may already exist after reload */ }
  }

  if (bn.runtime && bn.runtime.onInstalled) bn.runtime.onInstalled.addListener(menus);
  try { menus(); } catch (e) { /* ignore */ }

  function storeSet(obj, done) {
    try {
      var st = bn.storage && bn.storage.local;
      if (!st) { done(); return; }
      var p = st.set(obj);
      if (p && p.then) p.then(done, done);
      else st.set(obj, done);
    } catch (e) { done(); }
  }

  // Popup entry fallback: openPopup() is not guaranteed (Chrome 109 service
  // workers, gesture lost after storage await). Keep the source tab id so a
  // notification click can reopen the exact page; the popup itself reads the
  // stored kind + tab id.
  function openPopup(tabId) {
    try {
      if (bn.action && bn.action.openPopup) {
        var p = bn.action.openPopup();
        if (p && p.then) {
          p.then(function () {}, function () { notifyOpen(tabId); });
          return;
        }
        return;
      }
      if (bn.browserAction && bn.browserAction.openPopup) {
        try { bn.browserAction.openPopup(); return; }
        catch (e2) { /* fall through to notification */ }
      }
    } catch (e) { /* fall through to notification */ }
    notifyOpen(tabId);
  }

  function notifyOpen(tabId) {
    // Real fallback (not a dropped gesture): a clickable notification that
    // focuses the source tab and reopens the popup path. Language best
    // effort: service workers cannot load the popup i18n synchronously, so
    // navigator.language decides, matching i18n.js detect().
    try {
      var nn = bn.notifications;
      if (!nn || !nn.create) return;
      var it = false;
      try { it = /^it\b/i.test(navigator.language || ""); } catch (e0) { /* ignore */ }
      var opt = {
        type: "basic",
        iconUrl: "icons/icon.svg",
        title: "Fub Clipper",
        message: it ? "Fai clic per aprire il ritaglio per questa pagina." : "Click to open the clipper for this page."
      };
      var created = nn.create("fub-open-" + String(tabId == null ? "x" : tabId), opt);
      if (created && created.then) created.then(function () {}, function () {});
    } catch (e3) { /* last resort: nothing else can reach the user */ }
  }

  function onMenuClick(info, tab) {
    if (!info) return;
    var tabId = tab && tab.id !== undefined && tab.id !== null ? tab.id : null;
    if (info.menuItemId === "fub-highlight" && tabId !== null) {
      // Highlight directly in the page (user gesture = menu click); the popup
      // cannot reliably open itself from the background.
      var files = ["src/selectors.js", "src/extract.js"];
      var ask = function () {
        try {
          var p = bn.tabs.sendMessage(tabId, { type: "fub:highlight-selection" });
          if (p && p.catch) p.catch(function () { /* page may block injection */ });
        } catch (e) { /* ignore */ }
      };
      try {
        if (bn.scripting && bn.scripting.executeScript) {
          bn.scripting.executeScript({ target: { tabId: tabId }, files: files }).then(ask, ask);
          return;
        }
      } catch (e) { /* fall through */ }
      try {
        if (bn.tabs && bn.tabs.executeScript) {
          bn.tabs.executeScript(tabId, { file: files[0] }, function () {
            bn.tabs.executeScript(tabId, { file: files[1] }, ask);
          });
          return;
        }
      } catch (e2) { /* ignore */ }
      ask();
      return;
    }
    var kind = info.menuItemId === "fub-clip-selection" ? "selection" : "article";
    storeSet({ "fub-pending-kind": kind, "fub-pending-tab": tabId }, function () { openPopup(tabId); });
  }
  var menusApi = bn.contextMenus || bn.menus;
  if (menusApi && menusApi.onClicked) menusApi.onClicked.addListener(onMenuClick);

  if (bn.commands && bn.commands.onCommand) {
    bn.commands.onCommand.addListener(function (cmd) {
      if (cmd !== "fub-clip") return;
      try {
        var q = bn.tabs.query({ active: true, currentWindow: true });
        var withTab = function (tabs) {
          var id = tabs && tabs[0] && tabs[0].id !== undefined ? tabs[0].id : null;
          openPopup(id);
        };
        if (q && q.then) q.then(withTab, function () { openPopup(null); });
        else bn.tabs.query({ active: true, currentWindow: true }, withTab);
      } catch (e) { openPopup(null); }
    });
  }

  // Notification fallback click: focus the source tab (kept at menu time).
  try {
    var nn = bn.notifications;
    if (nn && nn.onClicked) nn.onClicked.addListener(function (nid) {
      var m = /^fub-open-(\d+)$/.exec(String(nid || ""));
      if (!m) return;
      var id = Number(m[1]);
      try {
        var upd = bn.tabs.update(id, { active: true });
        if (upd && upd.then) upd.then(function () { openPopup(id); }, function () {});
        else openPopup(id);
      } catch (e2) { /* ignore */ }
      try { nn.clear(nid); } catch (e3) { /* ignore */ }
    });
  } catch (e4) { /* notifications unavailable: openPopup already tried */ }
})();
