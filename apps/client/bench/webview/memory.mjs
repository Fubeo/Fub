// La memoria di Fub vista dal sistema: i processi discendenti del driver
// (l'app, i processi della WebView), letti da `/proc`. Soltanto Linux; altrove
// il referto dice che la misura manca invece di inventarla.
//
// Si somma la PSS (`smaps_rollup`): una pagina condivisa fra l'app e i
// processi della WebView conta una volta sola, divisa fra chi la usa. La RSS
// accanto, per confronto con ciò che mostrano i monitor di sistema, e la PSS
// finita nello swap (`SwapPss`): una macchina sotto carico può spostarci le
// pagine dell'app, e la PSS scende senza che la memoria sia tornata.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/// Il nome di chi misura sta fuori dal conto: il driver e il suo driver nativo.
const DRIVERS = new Set(["tauri-driver", "WebKitWebDriver", "msedgedriver"]);

function stat(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Il nome sta fra parentesi e può contenerne: si taglia sull'ultima.
    const close = raw.lastIndexOf(")");
    const comm = raw.slice(raw.indexOf("(") + 1, close);
    const ppid = Number(raw.slice(close + 2).split(" ")[1]);
    return { pid, comm, ppid };
  } catch {
    return null;
  }
}

function rollup(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    const kib = (name) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? 0);
    return { pss: kib("Pss"), rss: kib("Rss"), swap: kib("SwapPss") };
  } catch {
    return null;
  }
}

/// Il gruppo di un processo nel referto: l'app, i processi di WebKitGTK, o
/// «altro» (un aiutante che la WebView ha lanciato).
function group(comm) {
  if (/^WebKitWebProces|^WebKitWebProcess/.test(comm)) return "webview";
  if (/^WebKitNetworkPr/.test(comm)) return "rete";
  if (/^WebKitGPUProces/.test(comm)) return "gpu";
  if (/^fub/.test(comm)) return "app";
  return "altro";
}

/// Una lettura: i discendenti di `root`, uno per uno e raggruppati, in MiB.
export function sample(root) {
  if (process.platform !== "linux") return null;
  const all = readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number).map(stat).filter(Boolean);
  const children = new Map();
  for (const proc of all) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc);
  }
  const seen = [];
  const queue = [...(children.get(root) ?? [])];
  while (queue.length) {
    const proc = queue.shift();
    queue.push(...(children.get(proc.pid) ?? []));
    if (DRIVERS.has(proc.comm)) continue;
    const mem = rollup(proc.pid);
    if (mem) seen.push({ ...proc, ...mem });
  }
  const mib = (kib) => Math.round((kib / 1024) * 10) / 10;
  const groups = {};
  for (const proc of seen) {
    const key = group(proc.comm);
    groups[key] ??= { processes: 0, pss: 0, rss: 0, swap: 0 };
    groups[key].processes++;
    groups[key].pss += proc.pss;
    groups[key].rss += proc.rss;
    groups[key].swap += proc.swap;
  }
  for (const value of Object.values(groups)) {
    value.pss = mib(value.pss);
    value.rss = mib(value.rss);
    value.swap = mib(value.swap);
  }
  return {
    pss: mib(seen.reduce((sum, proc) => sum + proc.pss, 0)),
    rss: mib(seen.reduce((sum, proc) => sum + proc.rss, 0)),
    swap: mib(seen.reduce((sum, proc) => sum + proc.swap, 0)),
    groups,
    processes: seen.map((proc) => ({ pid: proc.pid, comm: proc.comm, group: group(proc.comm), pss: mib(proc.pss), rss: mib(proc.rss), swap: mib(proc.swap) })),
  };
}

/// Aspetta che sotto `root` non resti nessun processo dell'app (al più
/// `timeoutMs`): l'app di uno scenario chiuso non deve ancora girare quando
/// parte quella dopo. Torna quanti ne restano; 0 anche fuori da Linux, dove
/// non si può guardare.
export async function appGone(root, pause, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = sample(root)?.processes.length ?? 0;
    if (left === 0 || Date.now() > deadline) return left;
    await pause(100);
  }
}

/// Tre letture a mezzo secondo l'una dall'altra; vale quella di mezzo per
/// PSS, perché un'allocazione di passaggio non sposti il numero.
export async function settled(root, pause) {
  const reads = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) await pause(500);
    const read = sample(root);
    if (!read) return null;
    reads.push(read);
  }
  reads.sort((a, b) => a.pss - b.pss);
  return reads[1];
}

// La raccolta forzata della WebView (#284). WebKitGTK restituisce la memoria
// quando vuole, e senza una raccolta prima di ogni lettura la retta dei giri
// di R1 misurava quando lo faceva più che quanto restava. Dal processo
// dell'app WebKitGTK 4.1 non lo permette: la raccolta la fa un'estensione web
// (`raccolta.rs`) che il banco costruisce qui e che l'app carica soltanto con
// `FUB_BENCH_GC` (`crates/fub-app/src/bench_gc.rs`).

/// La variabile che accende il gancio nell'app: la cartella dell'estensione.
export const GC_ENV = "FUB_BENCH_GC";

const here = dirname(fileURLToPath(import.meta.url));

/// Costruisce l'estensione nella cartella `dir`, che esiste già, con `rustc`, senza Cargo né dipendenze.
/// Torna `{ dir }`, o `{ skipped }` col motivo: fuori da Linux, o se non si
/// costruisce.
export function buildCollector(dir, { platform = process.platform, run = execFileSync, rustc = process.env.RUSTC ?? "rustc" } = {}) {
  if (platform !== "linux") return { skipped: "la raccolta forzata esiste soltanto con WebKitGTK, su Linux" };
  try {
    run(rustc, [
      "--edition", "2024", "--crate-type", "cdylib", "--crate-name", "fub_banco_raccolta",
      "-C", "opt-level=2", "-C", "panic=abort", "-C", "strip=debuginfo",
      "-o", join(dir, "libfub-banco-raccolta.so"), join(here, "raccolta.rs"),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    return { dir };
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim().split("\n").slice(-3).join(" ");
    return { skipped: `l'estensione della raccolta non si costruisce: ${detail}` };
  }
}

/// Lo script che chiede la raccolta alla pagina: `null` se l'estensione non
/// c'è, cioè se l'app non ha acceso il gancio.
export const COLLECT_SCRIPT = "return typeof window.__fubBenchGc === 'function' ? window.__fubBenchGc() : null;";

/// Una raccolta forzata, finita quando torna: la funzione dell'estensione
/// raccoglie e restituisce la memoria prima di rispondere. `on` dice se il
/// gancio c'era, `did` che cosa ha fatto (`raccolta.rs`), `ms` quanto ci ha
/// messo.
export async function collect(session) {
  const started = performance.now();
  const did = await session.execute(COLLECT_SCRIPT);
  const ms = Math.round(performance.now() - started);
  return typeof did === "number" ? { on: true, did, ms } : { on: false, ms };
}
