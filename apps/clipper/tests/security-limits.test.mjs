import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const Capture = require("../src/capture.js");
const Convert = require("../src/convert.js");
const Templates = require("../src/templates.js");
const Images = require("../src/images.js");
const Interpreter = require("../src/interpreter.js");
const Channel = require("../src/channel.js");


describe("capture v1 limits (frozen with AutomationOwner)", () => {

  it("rejects the intended boundary on otherwise valid v=1 payloads", () => {
    const T = (patch) => Object.assign({ v: 1, title: "T", markdown: "x", target: { mode: "create" } }, patch);
    const cases = [
      [{ title: "" }, "title:"],
      [{ markdown: "x".repeat(1048576 + 1) }, "markdown:"],
      [{ markdown: "é".repeat(524289) }, "markdown:"],
      [{ source_url: "ftp://h/x" }, "source_url:"],
      [{ target: { mode: "create", folder: "../etc" } }, "target.folder:"],
      [{ target: { mode: "create", note: "/abs.md" } }, "target.note:"],
      [{ target: { mode: "create", note: "C:\\a.md" } }, "target.note:"],
      [{ target: { mode: "teleport" } }, "target.mode:"],
      [{ v: 2 }, "v:"]
    ];
    for (const [patch, invalidField] of cases) {
      assert.throws(() => Capture.buildArtifact(T(patch), { nonce: "valid-nonce-1" }),
        (e) => e.code === "bad_args" && e.details.length === 1 && e.details[0].startsWith(invalidField));
    }
    assert.equal(Capture.buildArtifact(T({ markdown: "é".repeat(524288) }), { nonce: "valid-nonce-1" }).payload.v, 1);
  });
  it("fub:// round-trips small captures and refuses oversized ones", () => {
    const a = Capture.buildArtifact(
      { v: 1, title: "T", markdown: "# hi\n\ntext", source_url: "https://example.com/a", target: { mode: "daily" } },
      { nonce: "nonce-uri-2" }
    );
    const uri = Capture.encodeCaptureUri(a);
    assert.ok(uri.startsWith("fub://capture?"));
    const back = Capture.decodeCaptureUri(uri);
    assert.equal(back.payload.title, "T");
    assert.equal(back.envelope.nonce, a.envelope.nonce);
    const big = Capture.buildArtifact({ v: 1, title: "T", markdown: "x".repeat(9000), target: { mode: "create" } }, { nonce: "nonce-big-1" });
    assert.throws(() => Capture.encodeCaptureUri(big), (e) => e.code === "too-large-for-uri");
  });

  it("file JSON carries exactly the frozen shape", () => {
    const a = Capture.buildArtifact({ v: 1, title: "T", markdown: "x", target: { mode: "create", vault: "main" } }, { nonce: "nonce-file-1" });
    const json = JSON.parse(Capture.artifactJson(a));
    assert.deepEqual(Object.keys(json).sort(), ["envelope", "kind", "payload", "v"]);
    assert.equal(json.payload.target.vault, "main");
  });

  it("envelope carries extension_id only when provided", () => {
    const bare = Capture.buildArtifact({ v: 1, title: "T", markdown: "x", target: { mode: "create" } }, { nonce: "nonce-bare-1" });
    assert.ok(!("extension_id" in bare.envelope));
    const paired = Capture.buildArtifact({ v: 1, title: "T", markdown: "x", target: { mode: "create" } }, { nonce: "nonce-paired-1", extensionId: "abcdefghijklmnopabcdefghijklmnop" });
    assert.equal(paired.envelope.extension_id, "abcdefghijklmnopabcdefghijklmnop");
  });

});
describe("native attachment and lexical template properties", () => {
  it("keeps hostile page text a quoted YAML scalar and carries typed values lexically", () => {
    const t = { name: "quoted", version: 1, target: { mode: "create" },
      body: "{{title}}", variables: { derived: { var: "title" } },
      properties: { title: "{{derived}}", enabled: true, tags: ["{{title}}", "web"], rating: 4 } };
    const result = Templates.renderAll(t, { title: "a: b\n---\n!inject" });
    assert.equal(result.properties.title, JSON.stringify("a: b\n---\n!inject"));
    assert.equal(result.properties.enabled, "true");
    assert.equal(result.properties.tags, JSON.stringify(["a: b\n---\n!inject", "web"]));
    assert.equal(result.properties.rating, "4");
    const payload = Capture.buildArtifact({ v: 1, title: "T", markdown: result.body, target: { mode: "create" }, properties: result.properties });
    assert.equal(payload.payload.properties.title, result.properties.title);
  });

  it("sends downloaded bytes by native chunks only after a successful begin, with no import fallback", async () => {
    const bytes = new TextEncoder().encode("real image bytes");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const calls = [];
    let connections = 0, disconnected = false;
    const bn = { runtime: { connectNative(host) {
      assert.equal(host, "local.fub.clipper");
      connections++;
      const messages = new Set(), disconnects = new Set();
      return {
        onMessage: { addListener: (cb) => messages.add(cb), removeListener: (cb) => messages.delete(cb) },
        onDisconnect: { addListener: (cb) => disconnects.add(cb), removeListener: (cb) => disconnects.delete(cb) },
        postMessage(req) {
          calls.push(req);
          const reply = req.kind === "fub-attachment-begin-v1"
            ? { ok: true, nonce: req.envelope.nonce, transfer_id: "transfer_1" }
            : { ok: true, nonce: req.envelope.nonce };
          queueMicrotask(() => messages.forEach((cb) => cb(reply)));
        },
        disconnect() { disconnected = true; disconnects.forEach((cb) => cb()); }
      };
    } } };
    const artifact = Capture.buildArtifact({ v: 1, title: "T", markdown: "x", target: { mode: "create", vault: "main", folder: "Clips" } },
      { extensionId: "clipper@fub.local" });
    const result = await Channel.sendAttachment({ suggested_name: "image.png", sha256: hash, bytes: bytes.length, bytesView: bytes }, artifact,
      { browserNs: bn, captureLib: Capture });
    assert.equal(result.sha256, hash);
    assert.deepEqual(calls.map((c) => c.kind), ["fub-attachment-begin-v1", "fub-attachment-chunk-v1", "fub-attachment-commit-v1"]);
    assert.deepEqual(Buffer.from(calls[1].data, "base64"), Buffer.from(bytes));
    assert.equal(calls[0].attachment.sha256, hash);
    assert.equal(calls[0].envelope.nonce, calls[2].envelope.nonce);
    assert.equal(connections, 1, "one native process for all chunks");
    assert.equal(disconnected, true, "native port disposed after commit");
    await assert.rejects(() => Channel.sendAttachment({ suggested_name: "../escape", sha256: hash, bytes: bytes.length, bytesView: bytes },
      artifact, { browserNs: bn, captureLib: Capture }), (e) => e.code === "bad_args");
    assert.equal(calls.length, 3);
    disconnected = false;
    const captured = await Channel.sendArtifact(artifact, { browserNs: bn, persistent: true });
    assert.equal(captured.result.ok, true);
    assert.equal(disconnected, false, "capture keeps its host writer process for attachments");
    await Channel.sendAttachment({ suggested_name: "image.png", sha256: hash, bytes: bytes.length, bytesView: bytes },
      artifact, { browserNs: bn, captureLib: Capture, session: captured.session });
    assert.equal(connections, 2, "capture and handoff use the same second port");
    assert.deepEqual(calls.slice(3).map((c) => c.kind),
      ["fub-capture-v1", "fub-attachment-begin-v1", "fub-attachment-chunk-v1", "fub-attachment-commit-v1"]);
    const twoChunks = new Uint8Array(512 * 1024 + 1);
    twoChunks[twoChunks.length - 1] = 7;
    await Channel.sendAttachment({
      suggested_name: "two-chunks.png", sha256: createHash("sha256").update(twoChunks).digest("hex"),
      bytes: twoChunks.length, bytesView: twoChunks
    }, artifact, { browserNs: bn, captureLib: Capture, session: captured.session });
    assert.deepEqual(calls.slice(7).map((c) => c.kind),
      ["fub-attachment-begin-v1", "fub-attachment-chunk-v1", "fub-attachment-chunk-v1", "fub-attachment-commit-v1"]);
    assert.deepEqual(calls.slice(8, 10).map((c) => c.index), [0, 1]);
    assert.deepEqual(Buffer.concat(calls.slice(8, 10).map((c) => Buffer.from(c.data, "base64"))), Buffer.from(twoChunks));
    assert.equal(connections, 2, "no new native process at the chunk boundary");
    captured.session.close();
    assert.equal(disconnected, true);
  });
});

describe("convert mirror (TransferOwner schema)", () => {
  it("clips hostile HTML without scripts or javascript: URLs", () => {
    const hostile = `<article><h1>Hi</h1><script>alert(1)<\/script><p onclick="x()">Text <a href="javascript:evil()">link</a> <mark>keep</mark></p><img src="data:image/png;base64,AAA" alt="inline"><img src="https://cdn.example.com/a.png" alt="remote"><iframe src="https://evil.example/"></iframe><!-- c --></article>`;
    const r = Convert.clipHtml(hostile, { url: "https://example.com/a", title: "Hi" });
    assert.ok(!r.markdown.includes("<script"));
    assert.ok(!r.markdown.includes("javascript:"));
    assert.ok(r.markdown.includes("==keep=="));
    assert.equal(r.assets.length, 1);
    assert.equal(r.assets[0].orig_url, "https://cdn.example.com/a.png");
    assert.equal(Object.hasOwn(r.assets[0], "sha256"), false, "remote reference is not downloaded bytes");
    assert.ok(r.notes.some((n) => n.entry === "script") && r.notes.some((n) => n.entry === "iframe"));
    assert.ok(r.markdown.startsWith("---\n"));
  });

  it("keeps markdown under the 1 MiB capture ceiling at the exact boundary", () => {
    // Exactly MAX_INPUT UTF-8 bytes of HTML: accepted, body truncated.
    const inner = "a".repeat(2 * 1024 * 1024 - 7);
    const atLimit = "<p>" + inner + "</p>";
    assert.equal(atLimit.length, 2 * 1024 * 1024);
    const r = Convert.clipHtml(atLimit, { title: "big" });
    assert.ok(Buffer.byteLength(r.markdown, "utf8") <= 1048576);
    assert.ok(r.notes.some((n) => n.level === "warn" && n.entry === "clip"));
  });

  it("unicode counts bytes, not chars, against the 1 MiB ceiling", () => {
    // 'é' is 2 bytes UTF-8: 600k chars exceed 1 MiB and must truncate.
    const r = Convert.clipHtml("<p>" + "é".repeat(600000) + "</p>", { title: "uni" });
    assert.ok(Buffer.byteLength(r.markdown, "utf8") <= 1048576);
    assert.ok(r.notes.some((n) => n.level === "warn" && n.entry === "clip"));
    const emoji = Convert.clipHtml("<p>" + "😀".repeat(300000) + "</p>", { title: "emoji" });
    assert.ok(Buffer.byteLength(emoji.markdown, "utf8") <= 1048576);
    assert.equal(emoji.markdown.includes("\uFFFD"), false, "never split a UTF-8 code point");
  });

  it("rejects non-string and over-limit HTML by UTF-8 bytes", () => {
    assert.throws(() => Convert.clipHtml(42, {}), (e) => e.code === "bad_args");
    assert.throws(() => Convert.clipHtml("x".repeat(Convert.MAX_INPUT + 1), {}), (e) => e.code === "bad_args");
    assert.throws(() => Convert.clipHtml("é".repeat(Convert.MAX_INPUT / 2 + 1), {}), (e) => e.code === "bad_args");
    assert.ok(Convert.clipHtml("é".repeat(Convert.MAX_INPUT / 2), {}).notes.some((n) => n.level === "warn"));
  });

  it("template vars drive a real render", () => {
    const t = { name: "v", version: 1, target: { mode: "create" }, body: "{{source_url}}|{{title}}|{{clipped_at}}|{{excerpt}}" };
    const out = Templates.render(t, { source_url: "https://example.com/", title: "T", clipped_at: "2026-01-01", excerpt: "E" });
    assert.equal(out, "https://example.com/|T|2026-01-01|E");
  });
});

describe("templates: import/export, triggers, filters, bounded logic", () => {
  const base = {
    name: "t", version: 1, target: { mode: "append" },
    trigger: { url: ["example\\.com"], struct: ["json-ld"] },
    variables: { heading: { var: "title" }, missing: { var: "nope", default: "fallback" } },
    filters: [{ field: "source_url", op: "contains", value: "example" }],
    logic: [{ if: { field: "title", op: "contains", value: "Hi" }, then: { set: { tag: "hit" } }, else: { set: { tag: "miss" } } }],
    body: "# {{heading}} ({{missing}}) {{tag}} {{excerpt|strip_html}}"
  };

  it("validates and renders with variables/filters/logic", () => {
    assert.deepEqual(Templates.validateTemplate(base), []);
    assert.ok(Templates.matchTrigger(base, "https://example.com/a", ["json-ld"]));
    assert.ok(!Templates.matchTrigger(base, "https://other.test/", ["meta"]));
    const out = Templates.render(base, { title: "Hi there", source_url: "https://example.com/a", excerpt: "<b>x</b>" });
    assert.ok(out.includes("Hi there") && out.includes("hit") && out.includes("fallback"));
  });

  it("filtered-out gates rendering; unknown ops rejected", () => {
    assert.throws(() => Templates.render({ ...base, filters: [{ field: "title", op: "contains", value: "zzz" }] }, { title: "Hi", source_url: "https://example.com" }), (e) => e.code === "filtered-out");
    assert.deepEqual(Templates.validateTemplate({ ...base, filters: [{ field: "a", op: "nope" }] }).length === 1, true);
  });

  it("loops and nesting are capped", () => {
    const loop = { name: "l", version: 1, target: { mode: "create" }, variables: { all: { for: "items", do: "{{item}}", sep: "," } }, body: "{{all}}" };
    const items = Array.from({ length: 200 }, (_, i) => "i" + i);
    assert.ok(Templates.render(loop, { items }).split(",").length <= 50);
    assert.throws(() => Templates.evalCondition({ and: [{ and: [{ and: [{ and: [{ and: [{ field: "a", op: "is_empty" }] }] }] }] }] }, {}, { n: 0 }, 0), (e) => e.code === "bad_args");
  });

  it("rejects oversized bodies, bad targets and unsupported patterns", () => {
    assert.ok(Templates.validateTemplate({ ...base, body: "x".repeat(200001) }).length > 0);
    assert.ok(Templates.validateTemplate({ ...base, target: { mode: "x" } }).length > 0);
    assert.ok(Templates.validateTemplate({ ...base, trigger: { url: ["(a+)+$"] } }).length === 0, "catastrophic shape is valid subset syntax");
    assert.ok(Templates.validateTemplate({ ...base, trigger: { url: ["(?<=a)b"] } }).length > 0, "lookbehind rejected at import");
    assert.ok(Templates.validateTemplate({ ...base, filters: [{ field: "a", op: "matches", value: "(?=x)" }] }).length > 0, "lookahead rejected at import");
  });

  it("linear engine terminates on catastrophic shapes and matches the differential corpus", () => {
    const Matcher = require("../src/matcher.js");
    assert.equal(Matcher.test("(a+)+$", "a".repeat(50) + "!"), false);
    // Compare only small, non-catastrophic SAFE patterns against native JS.
    // Both positives and negatives matter: [\B] is literal B in a class,
    // while \B outside one asserts a non-word-boundary.
    const patterns = [
      "example\\.com", "(?i)hello", "(?i)[a-z]+", "(?i)[^a]",
      "[\\B]", "\\B", "a\\Bb", "[a-c]+", "[^a-c]", "[\\b]",
      "a{2,3}", "^hi$", "colou?r", "a|b", "a.b"
    ];
    const texts = ["", "a", "b", "B", "ABC", "ab", "axb", "aaa", "hi", "xhi",
      "color", "colour", "example.com", "hello", "HELLO", "\b"];
    for (const pat of patterns) {
      const ci = pat.startsWith("(?i)");
      const native = new RegExp(ci ? pat.slice(4) : pat, ci ? "i" : "");
      for (const text of texts) assert.equal(Matcher.test(pat, text), native.test(text), `${pat} / ${JSON.stringify(text)}`);
    }
    // \w is ASCII-only here (native would match é with /u): assert OUR
    // semantics, not native parity.
    assert.equal(Matcher.test("\\w+", "abc_123"), true);
    assert.equal(Matcher.test("\\w", "é"), false, "ASCII \\w rejects é");
    assert.throws(() => Matcher.test("(?<=a)b", "ab"), (e) => e.code === "bad_args");
    assert.throws(() => Matcher.test("a{1000,}", "a"), (e) => e.code === "bad_args");
    assert.throws(() => Matcher.test("[\\d]", "5"), (e) => e.code === "bad_args", "extended class in [...] rejected, not narrowed");
    assert.throws(() => Matcher.test("\\uD800", "x"), (e) => e.code === "bad_args", "lone surrogate rejected");
    assert.throws(() => Matcher.test("\\Ahi", "hi"), (e) => e.code === "bad_args", "absolute anchor rejected");
  });

  it("origin grants normalise and gate non-loopback targets", () => {
    const g = Interpreter.sanitizeGrants({ provider: ["API.EXAMPLE.COM", "https://api.example.com/", "http://evil.example/x", "not a url"], images: ["https://cdn.example.com/a/b"] });
    assert.deepEqual(g.provider, ["https://api.example.com/"]);
    assert.deepEqual(g.images, ["https://cdn.example.com/"]);
    assert.equal(Interpreter.isGranted(g, "provider", "https://api.example.com/v1/chat/completions"), true);
    assert.equal(Interpreter.isGranted(g, "provider", "https://evil.example/y"), false);
    assert.equal(Interpreter.isGranted(g, "provider-local", "http://127.0.0.1:11434/api/generate"), true);
  });
});

describe("images: explicit bounded downloads", () => {
  const assets = [
    { orig_url: "https://cdn.example.com/a.png", suggested_name: "a.png" },
    { orig_url: "data:image/png;base64,AAA", suggested_name: "inline.img" }
  ];
  const imageBytes = new TextEncoder().encode("img");
  const streamBytes = (bytes = imageBytes) => async () => ({
    ok: true,
    body: { getReader: () => {
      let sent = false;
      return {
        read: async () => sent ? { done: true } : (sent = true, { done: false, value: bytes }),
        cancel: async () => {},
        releaseLock: () => {}
      };
    } }
  });

  it("requires listed http(s) assets; refuses data: and outsiders without echoing URLs", () => {
    const p = Images.planDownloads(assets, ["https://cdn.example.com/a.png", "data:image/png;base64,AAA", "https://evil.example/x.png"]);
    assert.deepEqual(p.chosen.map((a) => a.orig_url), ["https://cdn.example.com/a.png"]);
    assert.equal(p.errors.length, 2);
    assert.ok(p.errors.every((m) => !/data:|evil\.example/.test(m)), "plan errors carry no raw URLs");
  });

  it("caps at 20 downloads", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ orig_url: `https://cdn.example.com/${i}.png`, suggested_name: `${i}.png` }));
    const all = many.map((a) => a.orig_url);
    const p = Images.planDownloads(many, all);
    assert.equal(p.chosen.length, 20);
    assert.equal(p.errors.length, 1);
  });

  it("hashes actual streamed bytes with WebCrypto and refuses absent grants, 404, and unbounded fallback", async () => {
    const grants = Interpreter.sanitizeGrants({ images: ["https://cdn.example.com/"] });
    const empty = await Images.sha256HexBytes(new Uint8Array(0));
    assert.deepEqual(empty, { ok: true, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" });
    const ok = await Images.downloadChosen([assets[0]], { fetchFn: streamBytes(), grants });
    assert.equal(ok[0].status, "manual");
    assert.equal(ok[0].sha256, createHash("sha256").update(imageBytes).digest("hex"));
    assert.deepEqual(ok[0].bytesView, imageBytes);
    let fetched = false;
    const noGrants = await Images.downloadChosen([assets[0]], { fetchFn: async () => { fetched = true; }, grants: null });
    assert.equal(noGrants[0].code, "denied");
    assert.equal(fetched, false);
    const ungranted = await Images.downloadChosen([assets[0]], { fetchFn: streamBytes(), grants: { provider: [], images: [] } });
    assert.equal(ungranted[0].code, "denied");
    assert.equal(Object.hasOwn(ungranted[0], "sha256"), false);
    const legacy = await Images.downloadChosen([assets[0]], { fetchFn: async () => ({
      ok: true, arrayBuffer: async () => { throw new Error("must not buffer"); }
    }), grants });
    assert.equal(legacy[0].code, "unavailable");
    const bad = await Images.downloadChosen([assets[0]], { fetchFn: async () => ({
      ok: false, status: 404, body: { getReader: () => { throw new Error("must not read"); } }
    }), grants });
    assert.equal(bad[0].code, "unavailable");
  });
  it("hands off only explicitly granted streamed bytes; denial cannot start native transfer", async () => {
    const grants = Interpreter.sanitizeGrants({ images: ["https://cdn.example.com/"] });
    let sends = 0, fetches = 0;
    const fetchFn = async (...args) => { fetches++; return streamBytes()(...args); };
    const nativeHandoff = async (rec) => {
      sends++;
      assert.deepEqual(rec.bytesView, imageBytes);
      assert.equal(rec.sha256, createHash("sha256").update(imageBytes).digest("hex"));
      return { ok: true };
    };
    const denied = await Images.downloadChosen([assets[0]], { fetchFn, grants: { images: [] }, nativeHandoff });
    assert.equal(denied[0].code, "denied");
    assert.equal(fetches, 0);
    assert.equal(sends, 0);
    const attached = await Images.downloadChosen([assets[0]], { fetchFn, grants, nativeHandoff });
    assert.equal(attached[0].status, "attached");
    assert.equal(fetches, 1);
    assert.equal(sends, 1);
  });
  it("streaming reader aborts past MAX_BYTES without trusting Content-Length", async () => {
    const grants = Interpreter.sanitizeGrants({ images: ["https://cdn.example.com/"] });
    const big = new Uint8Array(Images.MAX_BYTES + 1);
    const streamFetch = async () => ({
      ok: true,
      headers: { get: () => "10" }, // lies: real bytes win
      body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: big })), cancel: async () => {}, releaseLock: () => {} }; } }
    });
    const r = await Images.downloadChosen([assets[0]], { fetchFn: streamFetch, grants });
    assert.equal(r[0].status, "failed");
    assert.equal(r[0].code, "bad_args");
  });

  it("reader cleanup runs even when read() rejects", async () => {
    const asset = { orig_url: "https://cdn.example.com/a.png", suggested_name: "a.png" };
    let cancelled = false, released = false;
    const failFetch = async () => ({
      ok: true,
      body: { getReader: () => ({ read: async () => { throw new Error("boom"); }, cancel: async () => { await Promise.resolve(); cancelled = true; }, releaseLock: () => { assert.equal(cancelled, true); released = true; } }) }
    });
    await assert.rejects(() => Images.fetchStreamed(asset, { fetchFn: failFetch }), /boom/);
    assert.equal(cancelled, true);
    assert.equal(released, true);
  });

  it("retains the staged blob through completion and revokes it on complete/interrupted/dispose", async () => {
    const grants = Interpreter.sanitizeGrants({ images: ["https://cdn.example.com/"] });
    for (const terminal of ["complete", "interrupted", "dispose"]) {
      const listeners = new Set();
      let savedUrl, dispose, cancelled = false, signalStarted;
      const started = new Promise((resolve) => { signalStarted = resolve; });
      const bn = { downloads: {
        onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
        download: async (o) => { savedUrl = o.url; signalStarted(); return 7; },
        cancel: async (id) => { assert.equal(id, 7); cancelled = true; }
      } };
      const pending = Images.downloadChosen([assets[0]], {
        fetchFn: streamBytes(), grants, browserNs: bn,
        onDispose: (fn) => { dispose = fn; return () => { dispose = null; }; }
      });
      await started;
      await new Promise(setImmediate); // allow the download-id promise to settle before disposal
      assert.ok(savedUrl.startsWith("blob:") && !savedUrl.includes("cdn.example.com"));
      assert.equal(await (await fetch(savedUrl)).text(), "img", "URL stays live after download() starts");
      if (terminal === "dispose") dispose();
      else for (const fn of listeners) fn({ id: 7, state: { current: terminal } });
      const result = await pending;
      assert.equal(result[0].status, terminal === "complete" ? "completed" : "failed");
      assert.equal(result[0].downloadId, 7);
      if (terminal === "complete") assert.equal(result[0].sha256, createHash("sha256").update(imageBytes).digest("hex"));
      else assert.equal(Object.hasOwn(result[0], "sha256"), false);
      assert.equal(cancelled, terminal === "dispose");
      assert.equal(listeners.size, 0);
      assert.equal(dispose, null);
      await assert.rejects(() => fetch(savedUrl), "URL revoked on terminal state");
    }
  });

  it("Safari path returns the exact capped bytes for a manual user-click save", async () => {
    const grants = Interpreter.sanitizeGrants({ images: ["https://cdn.example.com/"] });
    const r = await Images.downloadChosen([assets[0]], { fetchFn: streamBytes(), grants });
    assert.equal(r[0].status, "manual");
    assert.deepEqual(r[0].bytesView, imageBytes);
    assert.equal(r[0].bytes, imageBytes.byteLength);
    assert.equal(r[0].sha256, createHash("sha256").update(imageBytes).digest("hex"));
  });
});

describe("interpreter: opt-in, visible request, no auto-write", () => {
  it("local accepts only loopback http without credentials, remote only credentialless https", () => {
    const localBad = Interpreter.sanitizeSettings({ provider: "local", localBaseUrl: "http://192.168.1.5:11434" });
    assert.throws(() => Interpreter.endpointFor(localBad), (e) => e.code === "bad_args");
    const ep = Interpreter.endpointFor(Interpreter.sanitizeSettings({ provider: "local", localBaseUrl: "http://127.0.0.1:11434/" }));
    assert.equal(ep.url, "http://127.0.0.1:11434/api/generate");
    assert.equal(ep.auth, "none");
    assert.throws(() => Interpreter.endpointFor(Interpreter.sanitizeSettings({ provider: "remote", remoteBaseUrl: "http://api.example.com" })), (e) => e.code === "bad_args");
    const rep = Interpreter.endpointFor(Interpreter.sanitizeSettings({ provider: "remote", remoteBaseUrl: "https://api.example.com/" }));
    assert.equal(rep.url, "https://api.example.com/v1/chat/completions");
    assert.equal(rep.auth, "bearer-key");
    assert.throws(() => Interpreter.endpointFor(Interpreter.sanitizeSettings({ provider: "local", localBaseUrl: "http://user:pass@127.0.0.1:11434" })), (e) => e.code === "bad_args");
    assert.throws(() => Interpreter.endpointFor(Interpreter.sanitizeSettings({ provider: "remote", remoteBaseUrl: "https://user:pass@api.example.com" })), (e) => e.code === "bad_args");
  });

  it("is disabled by default and buildRequest refuses", () => {
    const s = Interpreter.sanitizeSettings({});
    assert.equal(s.enabled, false);
    assert.throws(() => Interpreter.buildRequest(s, {}, "x", ""), (e) => e.code === "denied");
  });

  it("remote requires grant, key, endpoint coherence; errors carry no provider text", async () => {
    const s = Interpreter.sanitizeSettings({ enabled: true, provider: "remote", remoteBaseUrl: "https://api.example.com", remoteModel: "m" });
    const req = Interpreter.buildRequest(s, { selectionText: "hello" }, "Summarise", "");
    assert.equal(req.leavesDevice, true);
    assert.equal(req.endpoint, "https://api.example.com/v1/chat/completions");
    assert.equal(req.auth, "bearer-key");
    // No grants -> denied before any network call.
    let called = false;
    await assert.rejects(() => Interpreter.sendRequest(s, req, { fetchFn: async () => (called = true, {}), apiKey: "k", grants: { provider: [], images: [] } }), (e) => e.code === "denied");
    assert.equal(called, false);
    // Tampered endpoint after preview -> bad_args, no fetch.
    const grants = Interpreter.sanitizeGrants({ provider: ["https://api.example.com/"] });
    const evil = { ...req, endpoint: "https://evil.example/v1/chat/completions" };
    await assert.rejects(() => Interpreter.sendRequest(s, evil, { fetchFn: async () => ({}), apiKey: "k", grants }), (e) => e.code === "bad_args");
    // Provider error text is status-only (may echo keys/context otherwise).
    const badBody = async () => ({ ok: false, status: 500, text: async () => "SECRET-KEY-CONTEXT" });
    await assert.rejects(() => Interpreter.sendRequest(s, req, { fetchFn: badBody, apiKey: "k", grants }), (e) => e.code === "unavailable" && !/SECRET/.test(e.message));
  });

  it("redirect:error + timeout owned + response capped before parse", async () => {
    const s = Interpreter.sanitizeSettings({ enabled: true, provider: "local", localBaseUrl: "http://127.0.0.1:11434", localModel: "llama3.1" });
    const req = Interpreter.buildRequest(s, { selectionText: "hello" }, "Summarise", "");
    let seen = null;
    const fetchFn = async (url, init) => {
      seen = { url, init };
      assert.equal(init.redirect, "error");
      assert.ok(init.signal, "timeout signal owned");
      return { ok: true, text: async () => JSON.stringify({ response: "## Summary\ntext" }) };
    };
    const r = await Interpreter.sendRequest(s, req, { fetchFn, grants: { provider: [], images: [] } });
    assert.equal(r.text, "## Summary\ntext");
    assert.ok(!JSON.stringify(seen.init.headers).toLowerCase().includes("authorization"));
    // Oversized reply is capped before reaching the UI.
    const huge = async () => ({ ok: true, text: async () => JSON.stringify({ response: "x".repeat(300000) }) });
    const r2 = await Interpreter.sendRequest(s, req, { fetchFn: huge, grants: { provider: [], images: [] } });
    assert.ok(r2.text.length <= Interpreter.MAX_REPLY_TEXT);
  });
});

describe("channel: native authenticated, imports unauthenticated, errors structured", () => {
  const goodPayload = () => ({ v: 1, title: "T", markdown: "x", target: { mode: "create" } });
  it("native first: structured ok passes, needs_pairing surfaces", async () => {
    const a = Capture.buildArtifact(goodPayload(), { nonce: "nonce-native-1" });
    const bn = { runtime: { sendNativeMessage: async (host, msg) => {
      assert.equal(host, "local.fub.clipper");
      assert.equal(msg.kind, "fub-capture-v1");
      return { ok: true, nonce: msg.envelope.nonce };
    } } };
    const r = await Channel.sendArtifact(a, { browserNs: bn });
    assert.equal(r.transport.kind, "native");
    assert.equal(r.result.ok, true);
    const denied = { runtime: { sendNativeMessage: async () => ({ ok: false, kind: "denied", message: "pair first", needs_pairing: true }) } };
    const r2 = await Channel.sendArtifact(a, { browserNs: denied });
    assert.equal(r2.result.needs_pairing, true);
    assert.equal(r2.result.kind, "denied");
  });

  it("no native runtime falls back to unauthenticated URI/file imports", async () => {
    const short = Capture.buildArtifact(goodPayload(), { nonce: "nonce-short-1" });
    const opened = [];
    const r1 = await Channel.sendArtifact(short, { captureLib: Capture, openUri: async (u) => { opened.push(u); } });
    assert.equal(r1.transport.kind, "uri");
    assert.equal(r1.delivered, true);
    assert.equal(Capture.decodeCaptureUri(opened[0]).envelope.nonce, short.envelope.nonce);

    const long = Capture.buildArtifact({ v: 1, title: "T", markdown: "x".repeat(9000), target: { mode: "create" } }, { nonce: "nonce-long-1" });
    const saved = [];
    const r2 = await Channel.sendArtifact(long, { captureLib: Capture, saveFile: async (n, j) => { saved.push([n, j]); } });
    assert.equal(r2.transport.kind, "file");
    assert.equal(r2.delivered, true);
    assert.equal(JSON.parse(saved[0][1]).envelope.nonce, long.envelope.nonce);
  });

  it("free text is opaque unavailable, never substring-classified", () => {
    const paired = Channel.asResult({ ok: false, kind: "denied", needs_pairing: true });
    assert.equal(paired.kind, "denied");
    assert.equal(paired.needs_pairing, true);
    assert.deepEqual(Channel.asResult("vault not found"), { ok: false, kind: "unavailable" });
    assert.deepEqual(Channel.asResult({ ok: false, message: "note exists?" }), { ok: false, kind: "unavailable" });
    assert.deepEqual(Channel.asResult(null), { ok: false, kind: "unavailable" });
  });

  it("retry reuses the same artifact object and nonce", async () => {
    const a = Capture.buildArtifact(goodPayload(), { nonce: "same-nonce-1" });
    const seen = [];
    const bn = { runtime: { sendNativeMessage: async (host, msg) => { seen.push(msg.envelope.nonce); return { ok: true, nonce: msg.envelope.nonce }; } } };
    await Channel.sendArtifact(a, { browserNs: bn });
    await Channel.sendArtifact(a, { browserNs: bn });
    assert.deepEqual(seen, [a.envelope.nonce, a.envelope.nonce]);
  });
});
