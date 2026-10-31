// T1 (K0, la prima delle tre vie per la tela dei motori): quanto costa far
// arrivare le tessere di un'immagine nella WebView e disegnarle, senza motore.
//
// Lo script gira nella pagina, con `executeAsync`. Apre il file con
// `resource_open` e ne legge i byte per le due strade che Fub ha già:
//
// - la IPC di Tauri, `resource_read_chunk`, a pezzi di 64 KiB (una tessera di
//   256 × 256 RGBA sono quattro pezzi);
// - il protocollo `fub-asset:` con `fetch`: il file intero, poi con `Range`
//   una tessera per richiesta e un fotogramma a finestre di 1 MiB in
//   parallelo.
//
// Poi disegna su una tela di 2880 × 1800, un fotogramma alla volta: prima una
// tessera per fotogramma (il pennello), poi il fotogramma intero (uno
// spostamento della vista). Le chiamate passano da `__TAURI_INTERNALS__`, le
// stesse che usa `@tauri-apps/api`: il banco non tocca `src/`.

import { crc32, deflateSync } from "node:zlib";

export const TILE = 256;
export const FRAME = { width: 2880, height: 1800 };

/// Un PNG valido di `width` × `height` RGBA, senza compressione: i byte che il
/// banco legge pesano quanto un fotogramma vero.
export function storedPng(width, height) {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * row + 1 + x * 4;
      raw[at] = x & 255;
      raw[at + 1] = y & 255;
      raw[at + 2] = (x ^ y) & 255;
      raw[at + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/// Lo script della pagina: `arguments[0]` è l'id del file, `arguments[1]` i
/// giri. Risponde con i tempi grezzi e i percentili, in millisecondi.
export const TILES_SCRIPT = `
const done = arguments[arguments.length - 1];
const [id, rounds] = arguments;
const TILE = ${TILE}, W = ${FRAME.width}, H = ${FRAME.height};
const CHUNK = 64 * 1024, WINDOW = 1024 * 1024;
const p = (xs, q) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] * 100) / 100;
};
const stats = (xs) => ({ count: xs.length, p50: p(xs, 0.5), p95: p(xs, 0.95), max: p(xs, 1) });
const frame = () => new Promise((r) => requestAnimationFrame(r));
(async () => {
  const out = { errors: {} };
  const internals = window.__TAURI_INTERNALS__;
  let handle = null;
  try {
    const descriptor = await internals.invoke("resource_open", { id, vault: null });
    handle = descriptor.handle;
    const len = Number(descriptor.len);
    out.len = len;
    const tileBytes = TILE * TILE * 4;
    const at = (i) => (i * 7919 * CHUNK) % Math.max(1, len - tileBytes);
    // 1. La IPC: una tessera è quattro pezzi, uno dopo l'altro.
    const ipc = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      let got = 0;
      for (let off = at(i); got < tileBytes; ) {
        const bytes = await internals.invoke("resource_read_chunk", { handle, offset: off, len: CHUNK });
        const n = bytes.byteLength ?? bytes.length ?? 0;
        if (n === 0) throw new Error("resource_read_chunk: nessun byte");
        got += n;
        off += n;
      }
      ipc.push(performance.now() - t0);
    }
    out.ipcTile = stats(ipc);
  } catch (error) {
    out.errors.ipc = String(error?.message ?? error);
  }
  try {
    if (handle === null) throw new Error("nessun lease");
    const len = out.len;
    const tileBytes = TILE * TILE * 4;
    const at = (i) => (i * 7919 * CHUNK) % Math.max(1, len - tileBytes);
    // 2. fub-asset: una tessera per richiesta, poi il fotogramma intero.
    const url = internals.convertFileSrc(handle, "fub-asset");
    out.url = url.replace(/[0-9]+$/, "N");
    // Il file intero, senza Range: dice se la pagina legge fub-asset: con
    // fetch anche quando le richieste con intervallo non passano.
    try {
      const t0 = performance.now();
      const n = (await (await fetch(url)).arrayBuffer()).byteLength;
      out.assetWhole = { bytes: n, ms: Math.round((performance.now() - t0) * 100) / 100 };
    } catch (error) {
      out.errors.assetWhole = String(error?.message ?? error);
    }
    const range = async (from, to) => {
      const r = await fetch(url, { headers: { Range: "bytes=" + from + "-" + (to - 1) } });
      if (r.status !== 206) throw new Error("fub-asset: stato " + r.status);
      return (await r.arrayBuffer()).byteLength;
    };
    const asset = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      const n = await range(at(i), at(i) + tileBytes);
      if (n !== tileBytes) throw new Error("fub-asset: " + n + " byte invece di " + tileBytes);
      asset.push(performance.now() - t0);
    }
    out.assetTile = stats(asset);
    const frameBytes = Math.min(len, W * H * 4);
    const whole = [];
    for (let i = 0; i < Math.max(3, Math.round(rounds / 10)); i++) {
      const t0 = performance.now();
      const parts = [];
      for (let from = 0; from < frameBytes; from += WINDOW) parts.push(range(from, Math.min(frameBytes, from + WINDOW)));
      const n = (await Promise.all(parts)).reduce((a, b) => a + b, 0);
      if (n !== frameBytes) throw new Error("fub-asset: fotogramma di " + n + " byte");
      whole.push(performance.now() - t0);
    }
    out.assetFrame = stats(whole);
  } catch (error) {
    out.errors.asset = String(error?.message ?? error);
  } finally {
    if (handle !== null) await internals.invoke("resource_close", { handle }).catch(() => {});
  }
  // 3. Il disegno, sopra la shell: una tela vera, nel documento.
  try {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = "position:fixed;left:0;top:0;width:" + W / devicePixelRatio + "px;height:" + H / devicePixelRatio + "px;z-index:99999";
    document.body.append(canvas);
    const ctx = canvas.getContext("2d");
    const tile = new ImageData(TILE, TILE);
    tile.data.fill(200);
    const full = new ImageData(W, H);
    full.data.fill(120);
    const measure = async (count, draw) => {
      const puts = [], gaps = [];
      let last = await frame();
      for (let i = 0; i < count; i++) {
        const t0 = performance.now();
        draw(i);
        puts.push(performance.now() - t0);
        const now = await frame();
        gaps.push(now - last);
        last = now;
      }
      return { put: stats(puts), frameGap: stats(gaps) };
    };
    const cols = Math.floor(W / TILE), lines = Math.floor(H / TILE);
    out.drawTile = await measure(rounds * 2, (i) => ctx.putImageData(tile, (i % cols) * TILE, (Math.floor(i / cols) % lines) * TILE));
    out.drawFrame = await measure(Math.max(10, Math.round(rounds / 2)), (i) => {
      full.data[i * 4] = i & 255;
      ctx.putImageData(full, 0, 0);
    });
    canvas.remove();
  } catch (error) {
    out.errors.draw = String(error?.message ?? error);
  }
  out.devicePixelRatio = devicePixelRatio;
  done(out);
})();
`;
