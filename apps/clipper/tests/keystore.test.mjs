// Dove vive la chiave dell'assistente (audit M7): storage.session di serie,
// storage.local solo con «Ricorda», migrazione delle chiavi vecchie, «Dimentica»
// su tutte e due le aree. Prima il modulo da solo, poi le opzioni e il popup
// veri in una vm con un DOM finto.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const KeyStore = require("../src/keystore.js");

// Un'area di storage finta: promesse (browser.*) o callback (chrome.* vecchi).
function area(initial = {}, { callbacks = false, failSet = false } = {}) {
  const data = { ...initial };
  const pick = (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]]));
  const ops = {
    get: (keys) => pick(keys),
    set: (value) => { if (failSet) throw new Error("quota"); Object.assign(data, value); },
    remove: (keys) => { for (const k of [].concat(keys)) delete data[k]; },
  };
  const api = {};
  for (const [name, fn] of Object.entries(ops)) {
    api[name] = callbacks
      ? (arg, cb) => { if (typeof cb !== "function") return undefined; const v = fn(arg); cb(v); return undefined; }
      : async (arg, extra) => { assert.equal(extra, undefined, "browser.* never gets a callback"); return fn(arg); };
  }
  return { api, data };
}

function bnWith({ local = {}, session = {}, noSession = false, callbacks = false, failSessionSet = false } = {}) {
  const l = area(local, { callbacks });
  const s = area(session, { callbacks, failSet: failSessionSet });
  const storage = { local: l.api };
  if (!noSession) storage.session = s.api;
  return { bn: { runtime: { lastError: null }, storage }, local: l.data, session: s.data };
}

describe("keystore: where the assistant key lives", () => {
  it("keeps a new key in storage.session by default, never on disk", async () => {
    const { bn, local, session } = bnWith();
    const st = await KeyStore.save(bn, { key: "  sk-test  ", remember: false });
    assert.equal(session["fub-ai-key"], "sk-test");
    assert.equal(local["fub-ai-key"], undefined);
    assert.equal(local["fub-ai-key-remember"], false);
    assert.deepEqual(st, { hasKey: true, where: "session", remember: false, sessionAvailable: true });
    assert.equal(await KeyStore.read(bn), "sk-test");
  });

  it("writes storage.local only when Remember is on, and moves the key back on untick", async () => {
    const { bn, local, session } = bnWith({ session: { "fub-ai-key": "sk-1" } });
    let st = await KeyStore.save(bn, { key: "", remember: true });
    assert.equal(local["fub-ai-key"], "sk-1", "the session key moves to disk, not lost");
    assert.equal(session["fub-ai-key"], undefined);
    assert.equal(st.where, "local");
    st = await KeyStore.save(bn, { key: "", remember: false });
    assert.equal(session["fub-ai-key"], "sk-1");
    assert.equal(local["fub-ai-key"], undefined);
    assert.equal(st.where, "session");
  });

  it("migrates a key saved in storage.local by an older version: still remembered", async () => {
    const { bn, local } = bnWith({ local: { "fub-ai-key": "sk-old" } });
    const st = await KeyStore.status(bn);
    assert.deepEqual(st, { hasKey: true, where: "local", remember: true, sessionAvailable: true });
    assert.equal(local["fub-ai-key-remember"], true, "the preference is written once");
    assert.equal(local["fub-ai-key"], "sk-old");
    assert.equal(await KeyStore.read(bn), "sk-old");
  });

  it("forget removes the key from both areas and keeps the preference", async () => {
    const { bn, local, session } = bnWith({ local: { "fub-ai-key": "a", "fub-ai-key-remember": true }, session: { "fub-ai-key": "b" } });
    const st = await KeyStore.forget(bn);
    assert.equal(local["fub-ai-key"], undefined);
    assert.equal(session["fub-ai-key"], undefined);
    assert.equal(st.hasKey, false);
    assert.equal(st.remember, true);
    assert.equal(await KeyStore.read(bn), null);
  });

  it("without storage.session refuses to fall back to storage.local silently", async () => {
    const { bn, local } = bnWith({ noSession: true, local: { "fub-ai-key-remember": false } });
    await assert.rejects(() => KeyStore.save(bn, { key: "sk", remember: false }), (e) => e.code === "no_session");
    assert.equal(local["fub-ai-key"], undefined);
    const st = await KeyStore.save(bn, { key: "sk", remember: true });
    assert.equal(local["fub-ai-key"], "sk");
    assert.equal(st.sessionAvailable, false);
  });

  it("a failed session write keeps the remembered key where it was", async () => {
    const { bn, local } = bnWith({ local: { "fub-ai-key": "sk-old", "fub-ai-key-remember": true }, failSessionSet: true });
    await assert.rejects(() => KeyStore.save(bn, { key: "", remember: false }));
    assert.equal(local["fub-ai-key"], "sk-old");
    assert.equal(local["fub-ai-key-remember"], true);
  });

  it("works with callback-style chrome.* areas", async () => {
    const { bn, session } = bnWith({ callbacks: true });
    await KeyStore.save(bn, { key: "sk-cb", remember: false });
    assert.equal(session["fub-ai-key"], "sk-cb");
    assert.equal(await KeyStore.read(bn), "sk-cb");
  });

  it("rejects keys that cannot be an HTTP header value", async () => {
    const { bn } = bnWith();
    await assert.rejects(() => KeyStore.save(bn, { key: "sk one", remember: false }), (e) => e.code === "bad_args");
    await assert.rejects(() => KeyStore.save(bn, { key: "x".repeat(513), remember: false }), (e) => e.code === "bad_args");
  });
});

// ---- the real pages in a vm -------------------------------------------------

function element(id) {
  const listeners = {};
  const attrs = {};
  return {
    id, value: "", textContent: "", checked: false, disabled: false, type: "text",
    style: {}, dataset: {}, options: [], children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {}, appendChild(c) { return c; }, append() {}, replaceChildren() {},
    setAttribute(k, v) { attrs[k] = String(v); }, removeAttribute(k) { delete attrs[k]; }, getAttribute: (k) => attrs[k] ?? null,
    focus() {}, click() {}, querySelector: () => null, querySelectorAll: () => [],
    fire(type) { for (const fn of listeners[type] || []) fn({ target: this }); },
  };
}

async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1)); }

async function runPage(scripts, browser, setup = () => {}) {
  const elements = new Map();
  const byId = (id) => { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); };
  byId("aiKey").type = "password";
  setup(byId);
  const docListeners = {};
  const context = {
    browser, console, URL, Promise, setTimeout, clearTimeout, Blob,
    navigator: { language: "en" }, location: { search: "" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      getElementById: byId, createElement: () => element(), querySelector: () => null, querySelectorAll: () => [],
      addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
      documentElement: element(), body: element(),
    },
  };
  context.addEventListener = () => {};
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const name of scripts) vm.runInContext(readFileSync(new URL("../src/" + name, import.meta.url), "utf8"), context, { filename: name });
  for (const fn of docListeners.DOMContentLoaded || []) fn();
  await settle();
  return { byId };
}

const OPTIONS = ["i18n.js", "capture.js", "matcher.js", "templates.js", "interpreter.js", "keystore.js", "options.js"];

describe("options page: the key field", () => {
  it("shows an old remembered key as remembered and forgets it from both areas", async () => {
    const { bn, local, session } = bnWith({ local: { "fub-ai-key": "sk-old" }, session: { "fub-ai-key": "stale" } });
    const { byId } = await runPage(OPTIONS, bn);
    assert.equal(byId("aiKeyRemember").checked, true);
    assert.match(byId("aiKeyState").textContent, /remembered on this device/);
    assert.equal(byId("aiKey").value, "", "the saved key is never put back in the field");
    byId("clearKey").fire("click");
    await settle();
    assert.equal(local["fub-ai-key"], undefined);
    assert.equal(session["fub-ai-key"], undefined);
    assert.match(byId("status").textContent, /forgotten/);
    assert.equal(byId("error").textContent, "");
  });

  it("saves a typed key to the session by default and clears the field", async () => {
    const { bn, local, session } = bnWith();
    const { byId } = await runPage(OPTIONS, bn, (byId) => { byId("aiProvider").value = "local"; });
    byId("aiKey").value = "sk-new";
    byId("saveAi").fire("click");
    await settle();
    assert.equal(session["fub-ai-key"], "sk-new");
    assert.equal(local["fub-ai-key"], undefined);
    assert.equal(byId("aiKey").value, "");
    assert.match(byId("aiKeyState").textContent, /until the browser closes/);
  });

  it("reports template errors through error() instead of throwing", async () => {
    const { bn } = bnWith();
    const { byId } = await runPage(OPTIONS, bn);
    byId("templateText").value = "{not json";
    byId("saveTemplates").fire("click");
    assert.match(byId("error").textContent, /invalid JSON/);
  });

  it("the show/hide button switches the field type and its label", async () => {
    const { bn } = bnWith();
    const { byId } = await runPage(OPTIONS, bn);
    byId("aiKeyToggle").fire("click");
    assert.equal(byId("aiKey").type, "text");
    assert.equal(byId("aiKeyToggle").textContent, "Hide key");
    byId("aiKeyToggle").fire("click");
    assert.equal(byId("aiKey").type, "password");
    assert.equal(byId("aiKeyToggle").textContent, "Show key");
  });
});

describe("options page markup", () => {
  const html = readFileSync(new URL("../src/options.html", import.meta.url), "utf8");
  it("the key field is a password field with an accessible toggle, off-by-default Remember and Forget", () => {
    assert.match(html, /<input type="password" id="aiKey"[^>]*autocomplete="off"/);
    assert.match(html, /<button type="button" id="aiKeyToggle" aria-controls="aiKey"/);
    assert.match(html, /<input type="checkbox" id="aiKeyRemember"(?![^>]*checked)[^>]*>/);
    assert.match(html, /<label for="aiKeyRemember"/);
    assert.match(html, /id="clearKey"/);
    assert.ok(html.indexOf('src="keystore.js"') < html.indexOf('src="options.js"'));
  });
  it("both manifests open the options page", () => {
    for (const m of ["manifest.json", "manifest.firefox.json"]) {
      const json = JSON.parse(readFileSync(new URL("../" + m, import.meta.url), "utf8"));
      assert.equal(json.options_ui.page, "src/options.html", m);
    }
  });
});
