// The popup's wiring, not only the helper: the real popup.js runs in a vm
// with a stub DOM and a stub browser namespace, reads a tab whose address
// carries user name and password, and must keep them out of the preview,
// the page header and the key of the saved highlights.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SCRIPTS = ["i18n.js", "capture.js", "convert.js", "matcher.js", "templates.js", "selectors.js", "images.js", "interpreter.js", "keystore.js", "channel.js", "popup.js"];
const DIRTY = "https://user:token@example.com/a?b=c";
const CLEAN = "https://example.com/a?b=c";

function element() {
  const listeners = {};
  return {
    value: "", textContent: "", innerHTML: "", checked: false, disabled: false, hidden: false,
    style: {}, dataset: {}, options: [], children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type) { for (const fn of listeners[type] || []) fn({ target: this }); },
    removeEventListener() {}, appendChild(child) { return child; }, append() {}, replaceChildren() {},
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, focus() {}, click() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
}

async function runPopup({ local = {}, session = null, fetch = undefined } = {}) {
  const elements = new Map();
  const byId = (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  byId("kind").value = "article";
  byId("template").value = "default";
  byId("mode").value = "create";
  const docListeners = {};
  const messages = [];
  const storage = {
    "fub-highlights-v1": { [CLEAN]: { enabled: true, marks: [{ id: "h-1", text: "kept" }] } },
    ...local,
  };
  const areaOf = (data) => ({
    get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (value) => { Object.assign(data, value); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; },
  });
  const tab = { id: 7, url: DIRTY, title: "Page" };
  const browser = {
    runtime: { id: "abcdefghijklmnopabcdefghijklmnop", lastError: null },
    storage: session ? { local: areaOf(storage), session: areaOf(session) } : { local: areaOf(storage) },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      sendMessage: async (_id, msg) => {
        messages.push(msg);
        if (msg.type === "fub:extract") {
          return { ok: true, data: { metadata: { url: DIRTY, title: "Page" }, articleHtml: "<p>body</p>", highlights: [] } };
        }
        return { ok: true };
      },
    },
    scripting: { executeScript: async () => [] },
  };
  const memory = new Map();
  const context = {
    browser,
    console,
    URL, TextEncoder, TextDecoder, Promise, setTimeout, clearTimeout,
    crypto: globalThis.crypto,
    fetch,
    navigator: { language: "en" },
    location: { search: "" },
    localStorage: {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: (k) => memory.delete(k),
    },
    document: {
      getElementById: byId,
      createElement: () => element(),
      createTextNode: (text) => ({ textContent: text }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
      documentElement: element(),
      body: element(),
    },
  };
  context.addEventListener = () => {};
  context.removeEventListener = () => {};
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const name of SCRIPTS) {
    vm.runInContext(readFileSync(new URL("../src/" + name, import.meta.url), "utf8"), context, { filename: name });
  }
  for (const fn of docListeners.DOMContentLoaded || []) fn();
  for (let i = 0; i < 50 && !byId("preview").textContent; i++) await new Promise((r) => setTimeout(r, 5));
  return { byId, messages };
}

describe("popup: credentials in the page address", () => {
  it("never reach the preview, the page header or the highlights key", async () => {
    const { byId, messages } = await runPopup();
    const preview = byId("preview").textContent;
    assert.ok(preview.includes("Clipped from " + CLEAN), preview);
    assert.ok(!preview.includes("token"), preview);
    assert.ok(byId("pageMeta").textContent.includes(CLEAN));
    assert.ok(!byId("pageMeta").textContent.includes("token"));
    // The highlights saved under the clean address are found again, so the
    // key the popup computed is the clean one.
    assert.ok(messages.some((m) => m.type === "fub:restore-highlights"), JSON.stringify(messages));
  });
});

describe("popup: the assistant key", () => {
  const remote = {
    "fub-ai": { enabled: true, provider: "remote", remoteBaseUrl: "https://api.example.com", remoteModel: "m", context: "article" },
    "fub-origins": { provider: ["https://api.example.com"], images: [] },
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1)); };

  it("is read from storage.session at every Ask, so a second Ask still works", async () => {
    const auth = [];
    const fetch = async (_url, init) => {
      auth.push(init.headers.authorization);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }) };
    };
    const session = { "fub-ai-key": "sk-session" };
    const { byId } = await runPopup({ local: remote, session, fetch });
    byId("aiAsk").fire("click");
    await settle();
    byId("aiAsk").fire("click");
    await settle();
    assert.deepEqual(auth, ["Bearer sk-session", "Bearer sk-session"]);
    assert.equal(byId("aiResult").value, "ok");
    assert.equal(byId("error").textContent, "");
  });

  it("without a key says where to enter it and sends nothing", async () => {
    let called = false;
    const fetch = async () => { called = true; return { ok: true }; };
    const { byId } = await runPopup({ local: remote, session: {}, fetch });
    byId("aiAsk").fire("click");
    await settle();
    assert.equal(called, false);
    assert.match(byId("error").textContent, /key is missing/);
  });
});
