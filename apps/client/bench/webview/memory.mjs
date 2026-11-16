// La memoria di Fub vista dal sistema: i processi discendenti del driver
// (l'app, i processi della WebView), letti da `/proc`. Soltanto Linux; altrove
// il referto dice che la misura manca invece di inventarla.
//
// Si somma la PSS (`smaps_rollup`): una pagina condivisa fra l'app e i
// processi della WebView conta una volta sola, divisa fra chi la usa. La RSS
// accanto, per confronto con ciò che mostrano i monitor di sistema.
import { readdirSync, readFileSync } from "node:fs";

/// Il nome di chi misura sta fuori dal conto: il driver e il suo driver nativo.
const DRIVERS = new Set(["tauri-driver", "WebKitWebDriver", "msedgedriver"]);

function stat(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Il nome sta fra parentesi e può contenerne: si taglia sull'ultima.
    const close = raw.lastIndexOf(")");
    const comm = raw.slice(raw.indexOf("(") + 1, close);
    const fields = raw.slice(close + 2).split(" ");
    // utime e stime, i campi 14 e 15 di proc(5), in tick di `CLK_TCK`.
    return { pid, comm, ppid: Number(fields[1]), ticks: Number(fields[11]) + Number(fields[12]) };
  } catch {
    return null;
  }
}

function rollup(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    const kib = (name) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? 0);
    return { pss: kib("Pss"), rss: kib("Rss") };
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

/// I discendenti di `root`, tolti i driver: `{ pid, comm, ppid, ticks }`.
/// Soltanto Linux; altrove `null`.
export function descendants(root) {
  if (process.platform !== "linux") return null;
  const all = readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number).map(stat).filter(Boolean);
  const children = new Map();
  for (const proc of all) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc);
  }
  const found = [];
  const queue = [...(children.get(root) ?? [])];
  while (queue.length) {
    const proc = queue.shift();
    queue.push(...(children.get(proc.pid) ?? []));
    if (!DRIVERS.has(proc.comm)) found.push({ ...proc, group: group(proc.comm) });
  }
  return found;
}

/// I tick di CPU (utente più sistema) dei discendenti di `root`, per processo:
/// due letture danno la CPU con `cpuPercent`. `null` fuori da Linux.
export function cpuTicks(root) {
  const found = descendants(root);
  return found && found.map(({ pid, comm, group, ticks }) => ({ pid, comm, group, ticks }));
}

/// `CLK_TCK` di Linux: 100 su ogni architettura che Fub costruisce.
const CLK_TCK = 100;

/// La CPU fra due letture di `cpuTicks` lontane `ms`, per gruppo, in % di un
/// core (200 vuol dire due core pieni). Un processo nato in mezzo conta da
/// zero. `null` se manca una lettura.
export function cpuPercent(before, after, ms) {
  if (!before || !after || !(ms > 0)) return null;
  const start = new Map(before.map((proc) => [proc.pid, proc.ticks]));
  const groups = {};
  for (const proc of after) {
    const used = proc.ticks - (start.get(proc.pid) ?? 0);
    groups[proc.group] = (groups[proc.group] ?? 0) + used;
  }
  for (const key of Object.keys(groups)) groups[key] = Math.round(((groups[key] * (1000 / CLK_TCK)) / ms) * 1000) / 10;
  return groups;
}

/// Una lettura: i discendenti di `root`, uno per uno e raggruppati, in MiB.
export function sample(root) {
  const found = descendants(root);
  if (!found) return null;
  const seen = [];
  for (const proc of found) {
    const mem = rollup(proc.pid);
    if (mem) seen.push({ pid: proc.pid, comm: proc.comm, ppid: proc.ppid, ...mem });
  }
  const mib = (kib) => Math.round((kib / 1024) * 10) / 10;
  const groups = {};
  for (const proc of seen) {
    const key = group(proc.comm);
    groups[key] ??= { processes: 0, pss: 0, rss: 0 };
    groups[key].processes++;
    groups[key].pss += proc.pss;
    groups[key].rss += proc.rss;
  }
  for (const value of Object.values(groups)) {
    value.pss = mib(value.pss);
    value.rss = mib(value.rss);
  }
  return {
    pss: mib(seen.reduce((sum, proc) => sum + proc.pss, 0)),
    rss: mib(seen.reduce((sum, proc) => sum + proc.rss, 0)),
    groups,
    processes: seen.map((proc) => ({ pid: proc.pid, comm: proc.comm, group: group(proc.comm), pss: mib(proc.pss), rss: mib(proc.rss) })),
  };
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

/// La pendenza di una serie di residui, in MiB per giro: la mediana delle
/// pendenze fra ogni coppia di giri (lo stimatore di Theil e Sen). La memoria
/// della WebView sale e scende a dente di sega col ritmo del suo GC, di
/// ±150 MiB: una lettura alta in cima o in fondo sposta la retta dei minimi
/// quadrati di decine di MiB per giro (#284), la mediana no, finché le letture
/// fuori ritmo restano meno di tre su dieci. Un giro senza lettura (`null`)
/// resta fuori e non sposta gli altri.
export function pendenza(ys) {
  const points = ys.map((y, i) => [i + 1, y]).filter(([, y]) => typeof y === "number" && Number.isFinite(y));
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) slopes.push((points[j][1] - points[i][1]) / (points[j][0] - points[i][0]));
  }
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  const mid = slopes.length >> 1;
  const median = slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
  return Math.round(median * 100) / 100;
}
