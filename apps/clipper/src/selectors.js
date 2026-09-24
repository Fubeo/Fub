/* Fub Clipper — selectors.js
 * CSS selectors + structured data (JSON-LD, microdata, OpenGraph).
 * Pure + UMD. Selector capture is bounded: max 16 selectors, max 50 nodes
 * each, text capped. Structured data reads script[type="application/ld+json"]
 * and [itemscope]/meta tags — data already in the page, no new requests.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubSelectors = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_SELECTORS = 16;
  var MAX_NODES_EACH = 50;
  var MAX_TEXT_EACH = 20000;

  var STRUCT_KINDS = ["json-ld", "microdata", "opengraph", "meta"];

  function collectBySelectors(doc, selectors) {
    var out = [];
    var list = (selectors || []).slice(0, MAX_SELECTORS);
    for (var i = 0; i < list.length; i++) {
      var sel = list[i];
      if (!sel || !sel.selector) continue;
      var nodes = [];
      try {
        var found = doc.querySelectorAll(String(sel.selector).slice(0, 512));
        for (var j = 0; j < found.length && j < MAX_NODES_EACH; j++) {
          var t = (found[j].textContent || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_EACH);
          nodes.push(t);
        }
      } catch (e) {
        out.push({ name: sel.name || sel.selector, selector: sel.selector, error: "invalid selector", nodes: [] });
        continue;
      }
      out.push({ name: sel.name || sel.selector, selector: sel.selector, nodes: nodes });
    }
    return out;
  }

  function structuredData(doc) {
    var kinds = [];
    var records = [];
    // JSON-LD
    try {
      var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length && records.length < 20; i++) {
        var raw = (scripts[i].textContent || "").trim().slice(0, 50000);
        if (!raw) continue;
        try {
          var parsed = JSON.parse(raw);
          records.push({ kind: "json-ld", type: (parsed && parsed["@type"]) || "unknown" });
          if (kinds.indexOf("json-ld") === -1) kinds.push("json-ld");
        } catch (e) {
          records.push({ kind: "json-ld", type: "unparseable" });
        }
      }
    } catch (e) { /* ignore */ }
    // Microdata
    try {
      var scopes = doc.querySelectorAll("[itemscope][itemtype]");
      for (var j = 0; j < scopes.length && j < 20; j++) {
        records.push({ kind: "microdata", type: scopes[j].getAttribute("itemtype") || "unknown" });
      }
      if (scopes.length && kinds.indexOf("microdata") === -1) kinds.push("microdata");
    } catch (e2) { /* ignore */ }
    // OpenGraph / meta presence
    try {
      if (doc.querySelector('meta[property^="og:"]')) kinds.push("opengraph");
      if (doc.querySelector('meta[name], meta[property]')) kinds.push("meta");
    } catch (e3) { /* ignore */ }
    return { kinds: kinds, records: records.slice(0, 20) };
  }

  return {
    MAX_SELECTORS: MAX_SELECTORS,
    MAX_NODES_EACH: MAX_NODES_EACH,
    MAX_TEXT_EACH: MAX_TEXT_EACH,
    STRUCT_KINDS: STRUCT_KINDS,
    collectBySelectors: collectBySelectors,
    structuredData: structuredData
  };
});
