// I1: il vault resta usabile mentre l'app lo indicizza. Ogni avvio sul vault
// del banco indicizza le diecimila note da capo; finché `vault_status` dice
// `running`, lo script apre una nota (`read_document`, un comando che passa
// dal workspace) e legge una tessera di 256 × 256 RGBA dalla IPC
// (`resource_read_chunk`, a pezzi di 64 KiB), una dopo l'altra.
//
// Prima che l'apertura tenesse il workspace a prese brevi, una fetta di 512
// documenti lo teneva in esclusiva fino a 1,3 s e i due comandi aspettavano
// in fila (T1: una tessera durante l'indicizzazione, p95 1477 ms sul runner).

import { NOTES, noteName } from "./fixtures.mjs";
import { TILE } from "./tiles.mjs";

/// Lo script della pagina: `arguments[0]` è l'id del file delle tessere,
/// `arguments[1]` il tempo massimo in millisecondi. Risponde con i tempi
/// grezzi e i percentili, in millisecondi.
export const INDEXING_SCRIPT = `
const done = arguments[arguments.length - 1];
const [tiles, budget] = arguments;
const TILE = ${TILE}, CHUNK = 64 * 1024, NOTES = ${NOTES};
const noteName = ${noteName.toString()};
const p = (xs, q) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 100) / 100;
};
const stats = (xs) => ({ count: xs.length, p50: p(xs, 0.5), p95: p(xs, 0.95), max: p(xs, 1) });
(async () => {
  const out = { errors: {} };
  const internals = window.__TAURI_INTERNALS__;
  const indexing = async () => {
    const r = await internals.invoke("query_index", { query: { kind: "vault_status" }, vault: null });
    return JSON.stringify(r).includes('"indexing":"running"');
  };
  let handle = null;
  try {
    const descriptor = await internals.invoke("resource_open", { id: tiles, vault: null });
    handle = descriptor.handle;
    const len = Number(descriptor.len);
    const tileBytes = TILE * TILE * 4;
    const at = (i) => (i * 7919 * CHUNK) % Math.max(1, len - tileBytes);
    out.indexingAtStart = await indexing();
    const open = [], tile = [], raw = [];
    const began = performance.now();
    // Una nota diversa a ogni giro, sparse nel vault.
    for (let i = 0; performance.now() - began < budget && (await indexing()); i++) {
      let t0 = performance.now();
      await internals.invoke("read_document", { id: "S2/" + noteName(((i * 37) % NOTES) + 1) + ".md", vault: null });
      const opened = performance.now() - t0;
      open.push(opened);
      t0 = performance.now();
      let got = 0;
      for (let off = at(i); got < tileBytes; ) {
        const bytes = await internals.invoke("resource_read_chunk", { handle, offset: off, len: CHUNK });
        const n = bytes.byteLength ?? bytes.length ?? 0;
        if (n === 0) throw new Error("resource_read_chunk: nessun byte");
        got += n;
        off += n;
      }
      const read = performance.now() - t0;
      tile.push(read);
      raw.push([Math.round(t0 - began), Math.round(opened), Math.round(read)]);
      await new Promise((r) => setTimeout(r, 20));
    }
    out.indexingMs = Math.round(performance.now() - began);
    out.open = stats(open);
    out.tile = stats(tile);
    out.raw = raw;
  } catch (error) {
    out.errors.run = String(error?.message ?? error);
  } finally {
    if (handle !== null) await internals.invoke("resource_close", { handle }).catch(() => {});
  }
  done(out);
})();
`;
