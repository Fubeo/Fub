// Real unpacked-extension proof. No mocks: exits nonzero with an explicit
// prerequisite if a requested browser/driver is absent. Nothing is packaged
// or signed for a store. Run: node browser-proof.mjs --browser chromium|firefox
// Firefox needs geckodriver and an ESR/developer/unbranded binary that permits
// temporary unsigned extensions. All page traffic is loopback; external URLs
// are blocked by the fixture and every image checkbox stays unchecked.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, cp, copyFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const browserArg = process.argv.indexOf("--browser");
const choice = browserArg < 0 ? "all" : process.argv[browserArg + 1];
if (!["all", "chromium", "firefox"].includes(choice)) throw new Error("Usage: --browser chromium|firefox|all");
const executable = (...names) => names.map((name) => {
  const found = spawnSync("which", [name], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : null;
}).find(Boolean);
const prerequisite = (name) => { throw new Error(`PREREQUISITE: ${name}. No browser proof was fabricated.`); };
const chrome = process.env.FUB_CHROMIUM || executable("google-chrome", "chromium", "chromium-browser");
const firefox = process.env.FUB_FIREFOX || executable("firefox", "firefox-esr");
const geckoDriver = process.env.FUB_GECKODRIVER || executable("geckodriver");
if ((choice === "all" || choice === "chromium") && !chrome) prerequisite("Chromium executable");
if ((choice === "all" || choice === "firefox") && !firefox) prerequisite("Firefox executable");
if ((choice === "all" || choice === "firefox") && !geckoDriver) prerequisite("geckodriver executable for temporary Firefox add-on installation");

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline'; img-src 'none'; connect-src 'none'");
  if (path === "/dynamic") return res.end('<title>Dynamic</title><main id="target"><p>Starting.</p></main><script>setTimeout(() => { document.querySelector("#target").innerHTML = "<article><h1>Dynamic proof</h1><p>Injected after navigation, before capture.</p></article>"; history.pushState({}, "", "/dynamic?spa=1") }, 20)</script>');
  if (path === "/long") return res.end(`<title>Long</title><article><h1>Long proof</h1><p>${"Long article text. ".repeat(64000)}</p></article>`);
  if (path === "/hostile") return res.end('<title>Hostile</title><article><h1>Hostile proof</h1><p id="select">SAFE CAPTURE TEXT</p><img src="https://third-party.invalid/never-fetch.png"><a href="javascript:alert(1)">bad link</a><script>window.hostileRan=true</script></article>');
  res.statusCode = 404; res.end("not found");
});
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const base = `http://127.0.0.1:${server.address().port}`;
const temp = await mkdtemp(join(tmpdir(), "fub-browser-proof-"));

// Shared assertions inspect the *actual popup*, not a pure-module imitation.
async function matrix(driver) {
  await driver.navigate(`${base}/dynamic`);
  await driver.waitForDynamic();
  let p = await driver.openPopup();
  assert.match(await driver.text(p, "#preview"), /Dynamic proof/);
  assert.match(await driver.text(p, "#preview"), /Injected after navigation/);
  assert.equal(await driver.storage(p, "fub-ai-key"), undefined, "normal capture requires no key");

  // Imported template traverses storage -> popup select -> live render. Its
  // property is a lexical YAML fragment, not a frontmatter rewrite.
  const template = { name: "Imported proof", version: 1, target: { mode: "create" },
    trigger: { url: ["hostile"] }, body: "IMPORTED: {{title}} :: {{selectionText}}",
    properties: { source: "{{source_url}}", verified: true } };
  await driver.setStorage(p, "fub-templates", [template]);
  await driver.navigate(`${base}/hostile`);
  p = await driver.openPopup();
  await driver.select(p, "#template", "Imported proof");
  const preview = await driver.text(p, "#preview");
  assert.match(preview, /IMPORTED: Hostile/);
  assert.doesNotMatch(preview, /javascript:alert|third-party\.invalid\/never-fetch|<script/i);
  await driver.select(p, "#template", "default");
  const safe = await driver.text(p, "#preview");
  assert.doesNotMatch(safe, /javascript:alert|<script/i);
  const externalBeforeOffline = await driver.networkExternal();
  if (externalBeforeOffline !== null) assert.equal(externalBeforeOffline, 0, "no third-party request without image grant and click");

  await driver.selectText("#select");
  p = await driver.openPopup();
  await driver.click(p, "#highlight");
  await driver.waitHighlight();
  await driver.click(p, "#persistHighlights");
  assert.equal((await driver.waitStorage(p, "fub-highlights-v1", (stored) => stored?.[`${base}/hostile`]?.enabled === true))?.[`${base}/hostile`]?.enabled, true);
  await driver.navigate(`${base}/hostile`);
  p = await driver.openPopup();
  await driver.waitHighlight(); // a fresh page received the saved mark
  assert.match(await driver.text(p, "#preview"), /SAFE CAPTURE TEXT/);
  await driver.click(p, "#clearHighlights");
  assert.equal((await driver.waitStorage(p, "fub-highlights-v1", (stored) => stored?.[`${base}/hostile`] === undefined))?.[`${base}/hostile`], undefined);

  await driver.navigate(`${base}/long`);
  p = await driver.openPopup();
  assert.match(await driver.text(p, "#preview"), /Long proof/);
  assert.ok((await driver.text(p, "#preview")).length <= 22000, "bounded long-article preview");
  await driver.navigate(`${base}/hostile`);
  await driver.offline(true);
  p = await driver.openPopup();
  assert.match(await driver.text(p, "#preview"), /Hostile proof/);
  const externalOffline = await driver.networkExternal();
  if (externalOffline !== null) assert.equal(externalOffline, 0);
  await driver.offline(false);
}

async function chromiumProof() {
  // Playwright is already a workspace dev dependency; never install it here.
  let chromium;
  try { ({ chromium } = await import("../client/node_modules/playwright/index.mjs")); }
  catch { prerequisite("workspace Playwright dependency (apps/client/node_modules/playwright)"); }
  const profile = join(temp, "chrome-profile");
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chrome, headless: true, serviceWorkers: "allow",
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--no-first-run", "--no-default-browser-check"]
  });
  let external = 0, fixture, popup;
  try {
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (/^(?:https?:)/.test(url) && !url.startsWith(base)) { external++; return route.abort(); }
      return route.continue();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 12000 });
    const id = new URL(worker.url()).host;
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/src/popup.html`);
    // The requested optional localhost permission is a real browser user
    // gesture; no fake tabs API, no automation-injected content response.
    await popup.evaluate(() => { const b = document.createElement("button"); b.id = "grant-fixture"; b.onclick = () => chrome.permissions.request({ origins: ["http://127.0.0.1/*"] }); document.body.append(b); });
    await popup.locator("#grant-fixture").click();
    assert.equal(await popup.evaluate(() => chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] })), true);
    fixture = await context.newPage();
    const driver = {
      navigate: async (url) => { await fixture.goto(url); await fixture.bringToFront(); },
      waitForDynamic: () => fixture.locator("#target article").waitFor(),
      openPopup: async () => { await fixture.bringToFront(); await popup.reload(); await popup.waitForFunction(() => document.querySelector("#preview").textContent !== "(loading…)"); return popup; },
      text: (p, sel) => p.locator(sel).innerText(),
      storage: (p, key) => p.evaluate((k) => new Promise((resolveStore) => chrome.storage.local.get(k, (v) => resolveStore(v[k]))), key),
      waitStorage: async (p, key, test) => { for (let i = 0; i < 80; i++) { const got = await p.evaluate((k) => new Promise((done) => chrome.storage.local.get(k, (v) => done(v[k]))), key); if (test(got)) return got; await new Promise((r) => setTimeout(r, 50)); } throw new Error("extension storage operation not completed"); },
      setStorage: (p, key, value) => p.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [key, value]),
      select: (p, sel, value) => p.locator(sel).selectOption(value),
      click: (p, sel) => p.evaluate((selector) => document.querySelector(selector).click(), sel),
      selectText: async (sel) => { await fixture.bringToFront(); await fixture.locator(sel).evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); }); },
      waitHighlight: () => fixture.locator("mark[data-fub-highlight]").waitFor(),
      networkExternal: async () => external,
      offline: (value) => context.setOffline(value)
    };
    await matrix(driver);
    console.log("Chromium unpacked extension: dynamic/long/hostile/imported-template/highlight/offline PASS");
  } finally { await context.close(); }
}

// geckodriver's temporary-install endpoint accepts the unsigned XPI only in
// a temp profile. Nothing is emitted into the project or a store directory.
async function firefoxProof() {
  const xpiDir = join(temp, "firefox-addon");
  await mkdir(xpiDir);
  for (const item of ["src", "icons", "native-host"]) await cp(join(root, item), join(xpiDir, item), { recursive: true });
  await copyFile(join(root, "manifest.firefox.json"), join(xpiDir, "manifest.json"));
  const xpi = join(temp, "temporary-unsigned.xpi");
  const zipped = spawnSync("zip", ["-qr", xpi, "manifest.json", "src", "icons", "native-host"], { cwd: xpiDir });
  if (zipped.error || zipped.status !== 0) prerequisite("zip executable for temporary Firefox add-on (not a store artifact)");
  let port = 41000 + Math.floor(Math.random() * 10000);
  if (port === server.address().port) port = port === 50999 ? 41000 : port + 1;
  const processDriver = spawn(geckoDriver, ["--port", String(port)], { stdio: "ignore" });
  let session;
  const call = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method,
      headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json();
    if (!response.ok || json.value?.error) throw new Error(`Firefox webdriver ${path}: ${json.value?.message || response.status}`);
    return json.value;
  };
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { await call("GET", "/status"); ready = true; break; }
      catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    if (!ready) prerequisite("geckodriver listening on loopback");
    session = (await call("POST", "/session", { capabilities: { alwaysMatch: {
      browserName: "firefox", "moz:firefoxOptions": { binary: firefox, args: ["-headless"],
        prefs: { "xpinstall.signatures.required": false, "extensions.enabledScopes": 15 } }
    } } })).sessionId;
    const route = (method, path, body) => call(method, `/session/${session}${path}`, body);
    const bytes = await readFile(xpi);
    await route("POST", "/moz/addon/install", { addon: bytes.toString("base64"), temporary: true });
    await route("POST", "/moz/context", { context: "chrome" });
    const uuid = await route("POST", "/execute/sync", { script:
      'return JSON.parse(ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services.prefs.getStringPref("extensions.webextensions.uuids", "{}"))["clipper@fub.local"]', args: [] });
    if (!uuid) prerequisite("Firefox temporary extension UUID via privileged geckodriver context");
    await route("POST", "/moz/context", { context: "content" });
    const extensionUrl = `moz-extension://${uuid}/src/popup.html`;
    const fixtureHandle = await route("GET", "/window");
    await route("POST", "/window/new", { type: "tab" });
    const popupHandle = await route("GET", "/window");
    const script = (source, args = []) => route("POST", "/execute/sync", { script: source, args });
    await route("POST", "/url", { url: extensionUrl });
    await script('const b=document.createElement("button"); b.id="grant-fixture"; b.onclick=()=>browser.permissions.request({origins:["<all_urls>"]}); document.body.append(b)');
    const button = await route("POST", "/element", { using: "css selector", value: "#grant-fixture" });
    await route("POST", `/element/${button["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
    if (!await script('return browser.permissions.contains({origins:["<all_urls>"]})')) prerequisite("Firefox localhost extension permission");
    const swap = (handle) => route("POST", "/window", { handle });
    const waitStorage = async (key, test) => { for (let i = 0; i < 80; i++) { const got = await script('return browser.storage.local.get(arguments[0]).then(v => v[arguments[0]])', [key]); if (test(got)) return got; await new Promise((r) => setTimeout(r, 50)); } throw new Error("Firefox extension storage operation not completed"); };
    const driver = {
      navigate: async (url) => { await swap(fixtureHandle); await route("POST", "/url", { url }); },
      waitForDynamic: async () => { for (let i = 0; i < 80; i++) { if (await script('return !!document.querySelector("#target article")')) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error("dynamic page did not update"); },
      openPopup: async () => { await swap(popupHandle); await script(`return browser.tabs.query({url:"${base}/*"}).then(t => browser.tabs.update(t[0].id,{active:true}))`); await route("POST", "/refresh", {}); for (let i = 0; i < 100; i++) { const ready = await script('return document.querySelector("#preview")?.textContent !== "(loading…)"'); if (ready) return popupHandle; await new Promise((r) => setTimeout(r, 50)); } throw new Error("Firefox popup did not capture the real active page"); },
      text: async (_p, sel) => { await swap(popupHandle); return script("return document.querySelector(arguments[0]).textContent", [sel]); },
      storage: async (_p, key) => { await swap(popupHandle); return script('return browser.storage.local.get(arguments[0]).then(v => v[arguments[0]])', [key]); },
      waitStorage: async (_p, key, test) => { await swap(popupHandle); return waitStorage(key, test); },
      setStorage: async (_p, key, value) => { await swap(popupHandle); return script('return browser.storage.local.set({[arguments[0]]: arguments[1]})', [key, value]); },
      select: async (_p, sel, val) => { await swap(popupHandle); return script('const e=document.querySelector(arguments[0]); e.value=arguments[1]; e.dispatchEvent(new Event("change",{bubbles:true}))', [sel, val]); },
      click: async (_p, sel) => { await swap(popupHandle); return script('document.querySelector(arguments[0]).click()', [sel]); },
      selectText: async (sel) => { await swap(fixtureHandle); await script('const r=document.createRange(); r.selectNodeContents(document.querySelector(arguments[0])); getSelection().removeAllRanges(); getSelection().addRange(r)', [sel]); },
      waitHighlight: async () => { await swap(fixtureHandle); for (let i = 0; i < 80; i++) { if (await script('return !!document.querySelector("mark[data-fub-highlight]")')) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error("highlight did not reach page"); },
      networkExternal: async () => null,
      offline: async (value) => { await route("POST", "/moz/context", { context: "chrome" }); await script('ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services.io.offline=arguments[0]', [value]); await route("POST", "/moz/context", { context: "content" }); }
    };
    await matrix(driver);
    console.log("Firefox temporary unpacked extension: dynamic/long/hostile/imported-template/highlight/offline PASS");
  } finally {
    if (session) { try { await call("DELETE", `/session/${session}`); } catch {} }
    processDriver.kill();
  }
}

try {
  if (choice === "all" || choice === "chromium") await chromiumProof();
  if (choice === "all" || choice === "firefox") await firefoxProof();
} finally {
  server.close();
  await rm(temp, { recursive: true, force: true });
}
