// Il `fub://capture` che il clipper apre è quello che l'app accetta (audit
// A3). Questo test scrive l'URI di una cattura fissa e lo confronta con
// `fixtures/capture-uri.txt`; `crates/fub-host/tests/uri_inbox.rs` legge lo
// stesso file e lo fa passare dalla coda e dalla scrittura dell'app. Se il
// clipper cambia i parametri, i due test lo dicono insieme.
// Rigenera con: UPDATE_FIXTURE=1 node --test tests/capture-uri-contract.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const Capture = require("../src/capture.js");
const FIXTURE = new URL("./fixtures/capture-uri.txt", import.meta.url);

describe("fub://capture: the clipper's URI is the app's grammar", () => {
  it("matches the fixture the app test reads", () => {
    const artifact = Capture.buildArtifact({
      v: 1,
      title: "Ritaglio di prova",
      markdown: "# Titolo\n\nUna riga dal web, con & e ?.",
      source_url: "https://example.com/articolo?id=1",
      target: { mode: "create", folder: "Clips" },
      properties: { tags: ["web", "prova"], autore: "Ada" },
    }, { nonce: "contratto-uri-1" });
    artifact.envelope.timestamp_ms = 1700000000000;
    const uri = Capture.encodeCaptureUri(artifact);
    if (process.env.UPDATE_FIXTURE === "1") writeFileSync(FIXTURE, uri + "\n");
    assert.equal(uri + "\n", readFileSync(FIXTURE, "utf8"));
    const keys = [...new URLSearchParams(uri.slice("fub://capture?".length)).keys()].sort();
    assert.deepEqual(keys, ["folder", "markdown", "mode", "nonce", "origin", "properties", "source_url", "timestamp_ms", "title", "v"]);
  });
});
