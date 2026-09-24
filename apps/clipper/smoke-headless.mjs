// apps/clipper smoke-headless: REAL executable checks, no browser needed.
// Runs the pure modules (capture/convert/templates/matcher/images/
// interpreter/channel) against hostile + oversized inputs and asserts the
// frozen contract. browser-proof.mjs covers unpacked Chromium/Firefox with
// actual browser binaries; crates/fub-cli/tests/clipper_native.rs covers the
// paired native host and digest-verified byte path.
// Exit non-zero on any failure.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Capture = require("./src/capture.js");
const Convert = require("./src/convert.js");
const Templates = require("./src/templates.js");
const Matcher = require("./src/matcher.js");
const Images = require("./src/images.js");
const Interpreter = require("./src/interpreter.js");
const Channel = require("./src/channel.js");

let pass = 0;
const ok = (name, fn) => {
  fn();
  pass++;
  console.log("ok - " + name);
};
const okAsync = async (name, fn) => {
  await fn();
  pass++;
  console.log("ok - " + name);
};

// 1. capture-v1 frozen limits + fub:// round-trip + file shape.
ok("capture limits + uri guard", () => {
  const a = Capture.buildArtifact({ v: 1, title: "T", markdown: "# hi", source_url: "https://example.com/", target: { mode: "daily", folder: "Clips" } }, { nonce: "smoke-capture-1" });
  const uri = Capture.encodeCaptureUri(a);
  assert.ok(uri.startsWith("fub://capture?"));
  assert.deepEqual(Object.keys(JSON.parse(Capture.artifactJson(a))).sort(), ["envelope", "kind", "payload", "v"]);
  assert.throws(() => Capture.buildArtifact({ v: 1, title: "T", markdown: "x", target: { mode: "x" } }, { nonce: "smoke-bad-mode" }), (e) => e.code === "bad_args" && e.details.some((d) => d.startsWith("target.mode:")));
  assert.throws(() => Capture.buildArtifact({ v: 1, title: "T", markdown: "x", target: { mode: "create", folder: "../etc" } }, { nonce: "smoke-bad-path" }), (e) => e.code === "bad_args" && e.details.some((d) => d.startsWith("target.folder:")));
});

// 2. hostile HTML conversion: no scripts, no javascript:, assets listed.
ok("hostile html conversion", () => {
  const r = Convert.clipHtml(`<article><h1>H</h1><script>alert(1)<\/script><p><a href="javascript:x()">l</a> <mark>k</mark></p><img src="https://cdn.example.com/a.png"><img src="data:x"><iframe src="https://e.example/"></iframe></article>`, { title: "H", url: "https://example.com/" });
  assert.ok(!r.markdown.includes("<script") && !r.markdown.includes("javascript:") && r.markdown.includes("==k=="));
  assert.equal(r.assets.length, 1);
  assert.equal(Object.hasOwn(r.assets[0], "sha256"), false);
});

// 3. linear matcher terminates on catastrophic input.
ok("matcher terminates", () => {
  assert.equal(Matcher.test("(a+)+$", "a".repeat(60) + "!"), false);
  assert.equal(Matcher.test("(?i)[a-z]+", "ABC"), true);
  assert.equal(Matcher.test("(?i)[^a]", "a"), false);
  assert.throws(() => Matcher.test("(?<=a)b", "ab"), (e) => e.code === "bad_args");
});

// 4. templates validate + render bounded.
ok("templates bounded render", () => {
  const t = { name: "s", version: 1, target: { mode: "create" }, trigger: { url: ["example\\.com"] }, body: "# {{title}} {{missing|strip_html}}" };
  assert.deepEqual(Templates.validateTemplate(t), []);
  assert.ok(Templates.matchTrigger(t, "https://example.com/", []));
  assert.ok(Templates.render(t, { title: "Hi", missing: "<b>x</b>" }).includes("Hi"));
});

// 5. channel: structured errors only; native shape; imports unlabeled.
await okAsync("channel tiers", async () => {
  assert.deepEqual(Channel.asResult("some free text"), { ok: false, kind: "unavailable" });
  const a = Capture.buildArtifact({ v: 1, title: "T", markdown: "x", target: { mode: "create" } }, { nonce: "smoke-nm" });
  const bn = { runtime: { sendNativeMessage: async (host) => { assert.equal(host, "local.fub.clipper"); return { ok: true, nonce: "smoke-nm" }; } } };
  const r = await Channel.sendArtifact(a, { browserNs: bn });
  assert.equal(r.transport.kind, "native");
  assert.equal(r.result.ok, true);
});

// 6. interpreter guards: grants + endpoint coherence + no secret echo.
await okAsync("interpreter guards", async () => {
  const s = Interpreter.sanitizeSettings({ enabled: true, provider: "remote", remoteBaseUrl: "https://api.example.com", remoteModel: "m" });
  const req = Interpreter.buildRequest(s, { selectionText: "hi" }, "Sum", "");
  let called = false;
  await assert.rejects(() => Interpreter.sendRequest(s, req, { fetchFn: async () => (called = true, {}), apiKey: "k", grants: { provider: [], images: [] } }), (e) => e.code === "denied");
  assert.equal(called, false);
  const grants = Interpreter.sanitizeGrants({ provider: ["https://api.example.com/"] });
  const badBody = async () => ({ ok: false, status: 500, text: async () => "LEAK-ME" });
  await assert.rejects(() => Interpreter.sendRequest(s, req, { fetchFn: badBody, apiKey: "k", grants }), (e) => !/LEAK/.test(e.message));
});

// 7. images: streaming cap beats lying Content-Length; grants enforced.
await okAsync("images streaming cap", async () => {
  const grants = Interpreter.sanitizeGrants({ images: ["https://cdn.example.com/"] });
  const big = new Uint8Array(Images.MAX_BYTES + 1);
  const lying = async () => ({ ok: true, headers: { get: () => "5" }, body: { getReader: () => { let s = false; return { read: async () => (s ? { done: true } : (s = true, { done: false, value: big })), cancel: async () => {}, releaseLock: () => {} }; } } });
  const asset = { orig_url: "https://cdn.example.com/a.png", suggested_name: "a.png" };
  const r = await Images.downloadChosen([asset], { fetchFn: lying, grants });
  assert.equal(r[0].code, "bad_args");
  const ungranted = await Images.downloadChosen([asset], { fetchFn: lying, grants: { provider: [], images: [] } });
  assert.equal(ungranted[0].code, "denied");
});
console.log(`\nheadless smoke: ${pass} checks passed.`);
