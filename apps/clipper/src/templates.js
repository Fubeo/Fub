/* Fub Clipper — templates.js
 * Importable/exportable capture templates with bounded logic. No arbitrary
 * JS: expressions are a fixed filter/condition/variable language with hard
 * execution caps. UMD (classic extension script + node require).
 *
 * Template JSON shape:
 *   { name, version:1, trigger?: {url?:string[], struct?:string[]},
 *     target: {folder?, note?, mode}, variables?: {k: expr},
 *     filters?: [{field, op, value}], logic?: [{if, then?, else?}...],
 *     body: string with {{var}} holes }
 * Variables available: source_url, title, clipped_at, excerpt (+ metadata.*).
 * Filters: text/date/number/link/image/array/object ops listed in FILTER_OPS.
 * Logic: `if` conditions with `equals/contains/matches/gt/lt/exists` + `and/
 * or/not` nesting, max LOGIC_DEPTH. Loops/fallbacks: `for` over arrays with
 * per-item cap; `default` fallback when a variable is missing.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.FubTemplates = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_BODY = 200000;
  var MAX_VARS = 32;
  var MAX_FILTERS = 16;
  var MAX_LOGIC = 16;
  var MAX_LOGIC_DEPTH = 4;
  var MAX_LOOP_ITEMS = 50;
  var MAX_STEPS = 10000;
  // Linear-time matcher (matcher.js): arbitrary patterns NEVER reach the
  // built-in backtracking engine, whose search no length cap can bound
  // (e.g. `(a+)+$`). Invalid patterns are `bad_args`, never a silent
  // substring fallback.
  var __matcher = null;
  function matcher() {
    if (__matcher) return __matcher;
    if (typeof require !== "undefined" && typeof module !== "undefined" && module.exports) {
      try { __matcher = require("./matcher.js"); } catch (e) { /* fall through */ }
    }
    if (!__matcher && typeof FubMatcher !== "undefined") __matcher = FubMatcher;
    if (!__matcher) { var e2 = new Error("unavailable: pattern engine missing"); e2.code = "unavailable"; throw e2; }
    return __matcher;
  }

  var FILTER_OPS = [
    "equals", "not_equals", "contains", "not_contains",
    "matches", "not_matches",
    "gt", "gte", "lt", "lte",
    "before", "after",
    "is_empty", "not_empty",
    "starts_with", "ends_with",
    "length_gt", "length_lt",
    "includes_any", "includes_all",
    "has_key", "missing_key",
    "to_markdown", "strip_html", "as_link", "as_image"
  ];

  var BUILTINS = ["source_url", "title", "clipped_at", "excerpt"];

  function steps() { return { n: 0 }; }
  function tick(s) {
    if (++s.n > MAX_STEPS) { var e = new Error("bad_args: template step limit exceeded"); e.code = "bad_args"; throw e; }
  }

  function getPath(obj, path) {
    var cur = obj;
    var parts = String(path).split(".");
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function toText(v) {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.map(toText).join(", ");
    if (typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return "[object]"; } }
    return String(v);
  }

  function stripHtml(s) {
    return String(s).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
  }

  function applyFilter(value, op, operand, s) {
    tick(s);
    var t = toText(value);
    switch (op) {
      case "equals": return t === String(operand);
      case "not_equals": return t !== String(operand);
      case "contains": return t.indexOf(String(operand)) !== -1;
      case "not_contains": return t.indexOf(String(operand)) === -1;
      case "starts_with": return t.indexOf(String(operand)) === 0;
      case "ends_with": return String(operand).length === 0 ? true : t.slice(String(operand).length * -1) === String(operand);
      case "matches": {
        if (String(operand).length > 512) throw bad("matches: pattern too large");
        return matcher().test(String(operand), t);
      }
      case "not_matches": {
        if (String(operand).length > 512) throw bad("not_matches: pattern too large");
        return !matcher().test(String(operand), t);
      }
      case "gt": return Number(value) > Number(operand);
      case "gte": return Number(value) >= Number(operand);
      case "lt": return Number(value) < Number(operand);
      case "lte": return Number(value) <= Number(operand);
      case "before": return new Date(value).getTime() < new Date(operand).getTime();
      case "after": return new Date(value).getTime() > new Date(operand).getTime();
      case "is_empty": return t.length === 0 || (Array.isArray(value) && value.length === 0);
      case "not_empty": return !(t.length === 0 || (Array.isArray(value) && value.length === 0));
      case "length_gt": return t.length > Number(operand);
      case "length_lt": return t.length < Number(operand);
      case "includes_any":
        return toArray(operand).some(function (x) { return toText(value).indexOf(toText(x)) !== -1; });
      case "includes_all":
        return toArray(operand).every(function (x) { return toText(value).indexOf(toText(x)) !== -1; });
      case "has_key": return value !== null && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, String(operand));
      case "missing_key": return !(value !== null && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, String(operand)));
      default: return t;
    }
  }

  function transform(value, op, s) {
    tick(s);
    if (op === "to_markdown" || op === "strip_html") return stripHtml(toText(value));
    if (op === "as_link") return "[" + toText(value).slice(0, 200) + "](" + toText(value).slice(0, 2048) + ")";
    if (op === "as_image") return "![" + "image" + "](" + toText(value).slice(0, 2048) + ")";
    return value;
  }

  function toArray(v) { return Array.isArray(v) ? v : [v]; }
  function bad(msg) { var e = new Error("bad_args: " + msg); e.code = "bad_args"; return e; }

  function evalCondition(cond, ctx, s, depth) {
    tick(s);
    depth = depth || 0;
    if (depth > MAX_LOGIC_DEPTH) throw bad("logic too deep");
    if (!cond || typeof cond !== "object") throw bad("condition must be an object");
    if (cond.and) {
      if (!Array.isArray(cond.and) || cond.and.length > 8) throw bad("and: max 8 branches");
      return cond.and.every(function (c) { return evalCondition(c, ctx, s, depth + 1); });
    }
    if (cond.or) {
      if (!Array.isArray(cond.or) || cond.or.length > 8) throw bad("or: max 8 branches");
      return cond.or.some(function (c) { return evalCondition(c, ctx, s, depth + 1); });
    }
    if (cond.not) return !evalCondition(cond.not, ctx, s, depth + 1);
    if (cond.exists !== undefined) return getPath(ctx, cond.exists) !== undefined;
    var v = getPath(ctx, cond.field || "");
    switch (cond.op) {
      case "equals": case "not_equals": case "contains": case "not_contains":
      case "starts_with": case "ends_with": case "matches": case "not_matches":
      case "gt": case "gte": case "lt": case "lte": case "before": case "after":
      case "is_empty": case "not_empty": case "length_gt": case "length_lt":
      case "includes_any": case "includes_all": case "has_key": case "missing_key":
        return !!applyFilter(v, cond.op, cond.value, s);
      default: throw bad("unknown condition op: " + cond.op);
    }
  }

  function evalExpr(expr, ctx, s) {
    tick(s);
    if (typeof expr === "string") return interpolate(expr, ctx, s);
    if (expr && typeof expr === "object") {
      if (expr.var !== undefined) {
        var v = getPath(ctx, expr.var);
        if (v === undefined) {
          if (expr.default !== undefined) return toText(expr.default).slice(0, 4096);
          return "";
        }
        return toText(v).slice(0, 20000);
      }
      if (expr.filter) {
        var base = evalExpr(expr.value, ctx, s);
        return toText(applyFilter(base, expr.filter, expr.operand, s));
      }
      if (expr.transform) return toText(transform(evalExpr(expr.value, ctx, s), expr.transform, s));
      if (expr.for) {
        var arr = getPath(ctx, expr.for);
        if (!Array.isArray(arr)) return "";
        var items = arr.slice(0, MAX_LOOP_ITEMS);
        var sep = expr.sep !== undefined ? String(expr.sep) : "\n";
        return items.map(function (item) {
          var sub = Object.assign({}, ctx, { item: item });
          return toText(evalExpr(expr.do, sub, s));
        }).join(sep).slice(0, 50000);
      }
    }
    return toText(expr);
  }

  function interpolate(body, ctx, s) {
    s = s || steps();
    return String(body).replace(/\{\{\s*([a-zA-Z0-9_.]+)(\|[^}]*)?\s*\}\}/g, function (m, path, pipe) {
      tick(s);
      var v = getPath(ctx, path);
      if (v === undefined) return "";
      var t = toText(v);
      if (pipe) {
        var parts = pipe.slice(1).split("|");
        for (var i = 0; i < parts.length; i++) {
          var f = parts[i].split(":")[0].trim();
          if (FILTER_OPS.indexOf(f) !== -1) t = toText(transform(t, f, s));
        }
      }
      return t;
    });
  }

  function validateTemplate(t) {
    var errs = [];
    if (!t || typeof t !== "object") return ["template: required object"];
    if (typeof t.name !== "string" || !t.name) errs.push("name: required");
    if (t.version !== 1) errs.push("version: must be 1");
    if (typeof t.body !== "string" || !t.body || t.body.length > MAX_BODY) errs.push("body: 1.." + MAX_BODY + " chars");
    if (t.trigger !== undefined) {
      if (typeof t.trigger !== "object") errs.push("trigger: object");
      else {
        if (t.trigger.url !== undefined && (!Array.isArray(t.trigger.url) || t.trigger.url.length > 16)) errs.push("trigger.url: max 16 patterns");
        if (t.trigger.struct !== undefined && (!Array.isArray(t.trigger.struct) || t.trigger.struct.length > 16)) errs.push("trigger.struct: max 16 patterns");
        if (Array.isArray(t.trigger.url)) {
          try {
            var m = matcher();
            t.trigger.url.forEach(function (pat, i) {
              if (String(pat).length > 512) errs.push("trigger.url[" + i + "]: max 512 chars");
              else if (!m.isValid(String(pat))) errs.push("trigger.url[" + i + "]: unsupported pattern");
            });
          } catch (e) { errs.push("trigger.url: pattern engine missing"); }
        }
      }
    }
    if (!t.target || typeof t.target !== "object") errs.push("target: required");
    else {
      if (["create", "append", "prepend", "daily"].indexOf(t.target.mode) === -1) errs.push("target.mode: one of create|append|prepend|daily");
    }
    if (t.variables !== undefined) {
      var vk = Object.keys(t.variables);
      if (vk.length > MAX_VARS) errs.push("variables: max 32");
    }
    if (t.filters !== undefined && (!Array.isArray(t.filters) || t.filters.length > MAX_FILTERS)) errs.push("filters: max 16");
    if (t.logic !== undefined && (!Array.isArray(t.logic) || t.logic.length > MAX_LOGIC)) errs.push("logic: max 16 steps");
    if (Array.isArray(t.filters)) {
      t.filters.forEach(function (f, i) {
        if (!f || FILTER_OPS.indexOf(f.op) === -1) errs.push("filters[" + i + "].op: unknown");
        else if ((f.op === "matches" || f.op === "not_matches")) {
          if (String(f.value).length > 512) errs.push("filters[" + i + "].value: max 512 chars");
          else { try { if (!matcher().isValid(String(f.value))) errs.push("filters[" + i + "].value: unsupported pattern"); } catch (e2) { errs.push("filters[" + i + "].value: pattern engine missing"); } }
        }
      });
    }
    if (t.properties !== undefined) {
      if (!t.properties || typeof t.properties !== "object" || Array.isArray(t.properties)) {
        errs.push("properties: object of lexical YAML values");
      } else {
        var pk = Object.keys(t.properties);
        if (pk.length > 64) errs.push("properties: max 64");
        pk.forEach(function (key) {
          var value = t.properties[key];
          if (!key || key.length > 128 || /[\r\n\x00-\x1f]/.test(key)) errs.push("properties: invalid key");
          if (typeof value === "string") {
            if (value.length > 4000) errs.push("properties." + key + ": too long");
          } else if (typeof value === "number") {
            if (!Number.isFinite(value)) errs.push("properties." + key + ": finite number required");
          } else if (Array.isArray(value)) {
            if (value.length > 32 || value.some(function (v) { return typeof v !== "string" || v.length > 4000; })) {
              errs.push("properties." + key + ": max 32 strings");
            }
          } else if (typeof value !== "boolean") errs.push("properties." + key + ": string|number|boolean|string[]");
        });
      }
    }
    return errs;
  }

  function matchTrigger(t, url, structKinds) {
    var trig = (t && t.trigger) || {};
    if (!trig.url && !trig.struct) return true; // no trigger = always
    var urlHit = false, structHit = false;
    if (trig.url && url) {
      urlHit = trig.url.some(function (pat) {
        pat = String(pat);
        if (pat.length > 512) throw bad("trigger pattern too large");
        return matcher().test(pat, url);
      });
    }
    if (trig.struct && structKinds) {
      structHit = trig.struct.some(function (k) { return structKinds.indexOf(k) !== -1; });
    }
    if (trig.url && trig.struct) return urlHit || structHit;
    if (trig.url) return urlHit;
    return structHit;
  }

  function renderAll(t, ctx) {
    var errs = validateTemplate(t);
    if (errs.length) throw bad(errs.join("; "));
    var s = steps();
    var scope = Object.assign({}, ctx);
    // variables (bounded)
    if (t.variables) {
      var keys = Object.keys(t.variables).slice(0, MAX_VARS);
      keys.forEach(function (k) { scope[k] = evalExpr(t.variables[k], scope, s); });
    }
    // filters gate rendering
    if (Array.isArray(t.filters)) {
      for (var i = 0; i < t.filters.length; i++) {
        var f = t.filters[i];
        if (f.op === "to_markdown" || f.op === "strip_html" || f.op === "as_link" || f.op === "as_image") {
          scope[f.field] = transform(getPath(scope, f.field), f.op, s);
        } else if (!applyFilter(getPath(scope, f.field), f.op, f.value, s)) {
          var e = new Error("filtered-out");
          e.code = "filtered-out";
          throw e;
        }
      }
    }
    // logic steps
    if (Array.isArray(t.logic)) {
      for (var j = 0; j < t.logic.length; j++) {
        var step = t.logic[j];
        var cond = step.if ? evalCondition(step.if, scope, s, 0) : true;
        var branch = cond ? step.then : step.else;
        if (branch && branch.set) {
          var names = Object.keys(branch.set).slice(0, 8);
          names.forEach(function (n) { scope[n] = evalExpr(branch.set[n], scope, s); });
        }
      }
    }
    var body = interpolate(t.body, scope, s).slice(0, MAX_BODY);
    var properties = {}, values = t.properties || {};
    Object.keys(values).forEach(function (key) {
      var value = values[key];
      if (typeof value === "string") properties[key] = JSON.stringify(interpolate(value, scope, s));
      else if (Array.isArray(value)) properties[key] = JSON.stringify(value.map(function (item) { return interpolate(item, scope, s); }));
      else properties[key] = JSON.stringify(value);
      if (properties[key].length > 4096) throw bad("property fragment too large");
    });
    return { body: body, properties: properties };
  }

  // note.property.set takes a YAML *fragment*, not a JSON value or a
  // frontmatter rewrite. JSON scalars/sequences are valid lexical YAML; by
  // quoting interpolated page text it remains data even when it contains
  // colon, newline, YAML tags, or frontmatter-looking delimiters.
  function render(t, ctx) { return renderAll(t, ctx).body; }
  function renderProperties(t, ctx) { return renderAll(t, ctx).properties; }

  var DEFAULT_TEMPLATE = {
    name: "Default clip",
    version: 1,
    target: { mode: "create" },
    body: "# {{title}}\n\n> {{excerpt}}\n\n{{body}}\n\n---\nClipped from {{source_url}} on {{clipped_at}}."
  };

  return {
    MAX_BODY: MAX_BODY, MAX_VARS: MAX_VARS, MAX_FILTERS: MAX_FILTERS,
    MAX_LOGIC: MAX_LOGIC, MAX_LOGIC_DEPTH: MAX_LOGIC_DEPTH,
    MAX_LOOP_ITEMS: MAX_LOOP_ITEMS, MAX_STEPS: MAX_STEPS,
    FILTER_OPS: FILTER_OPS, BUILTINS: BUILTINS, DEFAULT_TEMPLATE: DEFAULT_TEMPLATE,
    validateTemplate: validateTemplate,
    matchTrigger: matchTrigger,
    render: render,
    renderProperties: renderProperties,
    renderAll: renderAll,
    interpolate: interpolate,
    evalCondition: evalCondition
  };
});
