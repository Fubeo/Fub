#!/usr/bin/env node
// Le misure di K0 per ogni motore: compila la sua prova, la pesa, la fa girare
// sui file di esempio e conta le librerie che porta con sé rispetto a Fub.
//
//   node tools/motori-prova/misura.mjs --out DIR [--solo vettori,pdf] [--giri 3]
//
// Scrive in DIR un referto JSON per prova (`<prova>.json`) e il riassunto
// (`misure.json`). Non tocca il vault di nessuno: i file di esempio sono quelli
// del banco WebView, scritti in DIR/campioni, più una foto e un PDF lungo
// generati qui. Confronta ogni prova con `budgets.json`: esce con 1 se una
// supera un tetto di peso o di librerie.
//
// Il peso per crate viene da `cargo bloat` (va installato a parte, `cargo
// install cargo-bloat`, e trovato nel PATH); senza, il referto lo dice. La memoria la legge la prova stessa, soltanto su Linux.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

import { writeFixtures } from "../../apps/client/bench/webview/fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");

/// Le prove: la cartella, il motore e i file di esempio, per nome in
/// `campioni` (vedi `samples`).
const PROVE = [
  { dir: "vettori", motore: "VectorCraft", file: ["Foglio.svg"] },
  { dir: "pdf", motore: "PdfCraft", file: ["Stampa.pdf", "Lungo.pdf"] },
  { dir: "pdf-dominio", motore: "PdfCraft, crate di dominio", file: ["Stampa.pdf", "Lungo.pdf"] },
  { dir: "foto", motore: "PhotoCraft", file: ["Immagine.png", "Foto.png"] },
  { dir: "luce", motore: "LightCraft", file: ["Immagine.png", "Foto.png"] },
  { dir: "documenti", motore: "WordCraft", file: ["Documento.docx"] },
  { dir: "fogli", motore: "GridCraft", file: ["Tabella.xlsx"] },
];

/// Le librerie che dicono «qui c'è un'interfaccia»: non devono entrare.
const GUI = ["egui", "eframe", "egui-winit", "egui-wgpu", "egui_glow", "winit", "tao", "gtk", "gtk4", "rfd"];

function args() {
  const out = { giri: 3, solo: null, out: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--giri") out.giri = Number(argv[++i]);
    else if (argv[i] === "--solo") out.solo = argv[++i].split(",");
    else throw new Error(`argomento sconosciuto: ${argv[i]}`);
  }
  if (!out.out) throw new Error("uso: misura.mjs --out DIR [--solo vettori,pdf] [--giri 3]");
  return out;
}

function run(cmd, argv, opts = {}) {
  const result = spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${argv.join(" ")}: uscita ${result.status}\n${result.stderr?.slice(-4000)}`);
  }
  return result;
}

// --- I file di esempio ---------------------------------------------------

/// Una foto finta di 3200 × 2000, come una fotografia vera per peso e misura:
/// sfumature e rumore, così la compressione non la riduce a niente.
function photo() {
  const [w, h] = [3200, 2000];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 7;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed >> 16) & 15;
      const at = row + 1 + x * 3;
      raw[at] = (x * 255) / w + noise;
      raw[at + 1] = (y * 255) / h + noise;
      raw[at + 2] = ((x + y) * 127) / (w + h) + 64 + noise;
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/// Un PDF di quaranta pagine A4 di testo, con Helvetica: un documento da
/// leggere, non una pagina sola.
function longPdf(pages = 40) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const tree = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (let p = 1; p <= pages; p++) {
    const lines = [];
    for (let l = 0; l < 50; l++) {
      lines.push(`BT /F1 10 Tf 56 ${790 - l * 15} Td (Pagina ${p}, riga ${l + 1}: un paragrafo di prova per la misura del motore.) Tj ET`);
    }
    const stream = lines.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/// I file di esempio in `dir`: quelli del banco WebView (S5 e R1) e i due
/// generati qui.
function samples(dir) {
  const bench = join(dir, "banco");
  writeFixtures(bench);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(bench, "vault", "S5", "Foglio.svg"), join(dir, "Foglio.svg"));
  for (const name of ["Documento.docx", "Stampa.pdf", "Immagine.png", "Tabella.xlsx"]) {
    copyFileSync(join(bench, "vault", "R1", name), join(dir, name));
  }
  writeFileSync(join(dir, "Foto.png"), photo());
  writeFileSync(join(dir, "Lungo.pdf"), longPdf());
}

// --- Le librerie -----------------------------------------------------------

/// I pacchetti di un Cargo.lock, esclusi quelli senza sorgente (i nostri).
function lockPackages(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const block of text.split("[[package]]").slice(1)) {
    const name = /^name = "(.+)"$/m.exec(block)?.[1];
    const version = /^version = "(.+)"$/m.exec(block)?.[1];
    const source = /^source = "(.+)"$/m.exec(block)?.[1];
    if (name && version) out.push({ name, version, source: source ?? null });
  }
  return out;
}

/// La parte che deve combaciare perché due versioni siano compatibili per
/// Cargo: la maggiore, o la minore se la maggiore è 0, o la patch sotto 0.0.
function compat(version) {
  const [major, minor, patch] = version.split(/[.+-]/).map(Number);
  if (major > 0) return `${major}`;
  if (minor > 0) return `0.${minor}`;
  return `0.0.${patch}`;
}

function libraries(dir) {
  const prova = lockPackages(join(dir, "Cargo.lock")).filter((p) => p.source);
  const fub = lockPackages(join(repo, "Cargo.lock")).filter((p) => p.source);
  const fubByName = new Map();
  for (const p of fub) fubByName.set(p.name, [...(fubByName.get(p.name) ?? []), p]);
  const names = new Set(prova.map((p) => p.name));
  const versionsOf = (name) => prova.filter((p) => p.name === name);
  const nuove = prova.filter((p) => !fubByName.has(p.name));
  // Già in Fub: lo stesso nome in una versione che Cargo può unire (dentro
  // Fub prenderebbe una sola delle due).
  const comuni = prova.filter((p) => fubByName.get(p.name)?.some((f) => compat(f.version) === compat(p.version)));
  // Uno stesso nome in Fub, ma in una versione che Cargo non può unire.
  const doppie = prova
    .filter((p) => {
      const there = fubByName.get(p.name);
      return there && !there.some((f) => compat(f.version) === compat(p.version));
    })
    .map((p) => `${p.name} ${p.version} (Fub: ${fubByName.get(p.name).map((f) => f.version).join(", ")})`);
  const interne = [...names].filter((n) => versionsOf(n).length > 1).map((n) => `${n} ${versionsOf(n).map((p) => p.version).join(", ")}`);
  const git = prova.filter((p) => p.source.startsWith("git+")).map((p) => `${p.name} ${p.version}`);
  const gui = prova.filter((p) => GUI.includes(p.name)).map((p) => `${p.name} ${p.version}`);
  const gpu = prova.filter((p) => p.name === "wgpu").map((p) => `${p.name} ${p.version}`);
  return {
    pacchetti: prova.length,
    gia_in_fub: comuni.length,
    nuovi: nuove.length,
    doppie_con_fub: doppie,
    doppie_interne: interne,
    da_git: git.length,
    gui,
    gpu,
  };
}

// --- Peso e tempi ------------------------------------------------------------

function bloat(manifest, env) {
  const probe = run("cargo", ["bloat", "--version"], { env, allowFail: true });
  if (probe.status !== 0) return null;
  const argv = ["bloat", "--release", "--crates", "-n", "15", "--message-format", "json", "--manifest-path", manifest];
  const result = run("cargo", argv, { env, allowFail: true });
  if (result.status !== 0) return { errore: result.stderr.slice(-2000) };
  const data = JSON.parse(result.stdout.trim().split("\n").pop());
  const mib = (b) => Math.round((b / 1048576) * 10) / 10;
  return {
    file_mib: mib(data["file-size"]),
    text_mib: mib(data["text-section-size"]),
    crate: data.crates.map((c) => ({ nome: c.name, mib: mib(c.size) })),
  };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/// Le misure di `giri` esecuzioni, passo per passo: la mediana di tempo,
/// memoria residente e picco.
function timings(binary, file, giri, env) {
  const runs = [];
  for (let i = 0; i < giri; i++) {
    const result = run(binary, [file], { env });
    runs.push(JSON.parse(result.stdout.trim().split("\n").pop()));
  }
  const first = runs[0];
  const steps = first.passi.map((step, i) => ({
    passo: step.passo,
    ms: median(runs.map((r) => r.passi[i].ms)),
    rss_mib: step.memoria ? median(runs.map((r) => r.passi[i].memoria.rss_mib)) : null,
    picco_mib: step.memoria ? median(runs.map((r) => r.passi[i].memoria.picco_mib)) : null,
  }));
  const extra = Object.fromEntries(Object.entries(first).filter(([k]) => !["passi", "memoria_iniziale", "totale_ms"].includes(k)));
  return { ...extra, giri, memoria_iniziale: first.memoria_iniziale, passi: steps };
}

function machine() {
  const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  const cpu = /^model name\s*:\s*(.+)$/m.exec(read("/proc/cpuinfo"))?.[1] ?? null;
  const cores = (read("/proc/cpuinfo").match(/^processor\s*:/gm) ?? []).length || null;
  const mem = Number(/^MemTotal:\s+(\d+)/m.exec(read("/proc/meminfo"))?.[1] ?? 0);
  const os = /^PRETTY_NAME="(.+)"$/m.exec(read("/etc/os-release"))?.[1] ?? process.platform;
  const kernel = run("uname", ["-r"], { allowFail: true }).stdout?.trim() ?? null;
  const rustc = run("rustc", ["--version"]).stdout.trim();
  const commit = run("git", ["rev-parse", "--short=8", "HEAD"], { cwd: repo }).stdout.trim();
  return { cpu, nuclei: cores, memoria_gib: mem ? Math.round(mem / 1048576) : null, sistema: os, kernel, rustc, commit };
}

// --- I tetti ---------------------------------------------------------------

const budgets = JSON.parse(readFileSync(join(here, "budgets.json"), "utf8"));

/// Il referto di una prova contro `budgets.json`: `oltre` sono i tetti
/// superati, che fanno fallire; `obiettivi` i tempi e la memoria oltre la
/// misura della macchina di riferimento, che valgono soltanto lì.
function against(budgets, referto) {
  const oltre = [];
  const tetto = budgets.tetti[referto.prova];
  if (!tetto) {
    oltre.push("nessun tetto in budgets.json");
  } else {
    const mib = Math.round((referto.peso.spoglio_byte / 2 ** 20) * 10) / 10;
    if (mib > tetto.spoglio_mib) oltre.push(`peso ${mib} MiB, tetto ${tetto.spoglio_mib}`);
    if (referto.librerie.nuovi > tetto.nuove_librerie) oltre.push(`librerie nuove ${referto.librerie.nuovi}, tetto ${tetto.nuove_librerie}`);
    const doppie = referto.librerie.doppie_con_fub.length;
    if (doppie > tetto.doppie_con_fub) oltre.push(`doppie con Fub ${doppie}, tetto ${tetto.doppie_con_fub}`);
  }
  const obiettivi = [];
  for (const f of referto.file) {
    const goal = budgets.obiettivi[referto.prova]?.[f.file];
    if (!goal) continue;
    const step = (name) => f.passi.find((p) => p.passo === name);
    const first = step("prima apertura")?.ms ?? null;
    const left = step("dopo malloc_trim") ? Math.round((step("dopo malloc_trim").rss_mib - f.memoria_iniziale.rss_mib) * 10) / 10 : null;
    if (first !== null && first > goal.prima_apertura_ms) obiettivi.push(`${f.file} prima apertura ${first} ms, obiettivo ${goal.prima_apertura_ms}`);
    if (left !== null && left > goal.residuo_mib) obiettivi.push(`${f.file} residuo ${left} MiB, obiettivo ${goal.residuo_mib}`);
  }
  return { oltre, obiettivi };
}

// --- Il giro ---------------------------------------------------------------

function main() {
  const opts = args();
  mkdirSync(opts.out, { recursive: true });
  const campioni = join(opts.out, "campioni");
  samples(campioni);
  const env = { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? join(opts.out, "target") };
  const summary = { macchina: machine(), prove: [] };
  for (const prova of PROVE) {
    if (opts.solo && !opts.solo.includes(prova.dir)) continue;
    const dir = join(here, prova.dir);
    const manifest = join(dir, "Cargo.toml");
    process.stderr.write(`· ${prova.motore}: compilo\n`);
    const started = Date.now();
    run("cargo", ["build", "--release", "--manifest-path", manifest], { env, stdio: ["ignore", "ignore", "pipe"] });
    const build_s = Math.round((Date.now() - started) / 1000);
    run("cargo", ["build", "--profile", "spoglio", "--manifest-path", manifest], { env, stdio: ["ignore", "ignore", "pipe"] });
    const name = `prova-${prova.dir}${process.platform === "win32" ? ".exe" : ""}`;
    const binary = join(env.CARGO_TARGET_DIR, "release", name);
    const stripped = join(env.CARGO_TARGET_DIR, "spoglio", name);
    process.stderr.write(`· ${prova.motore}: peso e tempi\n`);
    const referto = {
      motore: prova.motore,
      prova: prova.dir,
      compilazione_s: build_s,
      peso: {
        con_simboli_byte: statSync(binary).size,
        spoglio_byte: statSync(stripped).size,
        bloat: bloat(manifest, env),
      },
      librerie: libraries(dir),
      file: prova.file.map((f) => timings(binary, join(campioni, f), opts.giri, env)),
    };
    referto.tetti = against(budgets, referto);
    writeFileSync(join(opts.out, `${prova.dir}.json`), JSON.stringify(referto, null, 2) + "\n");
    summary.prove.push(referto);
  }
  writeFileSync(join(opts.out, "misure.json"), JSON.stringify(summary, null, 2) + "\n");
  process.stderr.write(`· fatto: ${join(opts.out, "misure.json")}\n`);
  const over = summary.prove.flatMap((p) => p.tetti.oltre.map((o) => `${p.prova}: ${o}`));
  const slow = summary.prove.flatMap((p) => p.tetti.obiettivi.map((o) => `${p.prova}: ${o}`));
  for (const line of slow) process.stderr.write(`· oltre l'obiettivo (soltanto sulla sua macchina): ${line}\n`);
  for (const line of over) process.stderr.write(`✗ oltre il tetto: ${line}\n`);
  if (over.length > 0) process.exitCode = 1;
}

main();
