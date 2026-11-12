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

/// La CPU per filo dei processi di Fub discendenti di `root` (l'app e la
/// WebView), sommata per gruppo e nome del filo, in ms: `{ "webview:llvmpipe-#":
/// 1200 }`. Le cifre in coda al nome si tolgono (`llvmpipe-3` → `llvmpipe-#`),
/// così i fili di un pool fanno una voce sola. Soltanto Linux.
export function threadCpu(root) {
  if (process.platform !== "linux") return null;
  const all = readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number).map(stat).filter(Boolean);
  const byPid = new Map(all.map((proc) => [proc.pid, proc]));
  const descends = (proc) => {
    for (let at = proc, hops = 0; at && hops < 32; at = byPid.get(at.ppid), hops++) {
      if (at.ppid === root) return true;
    }
    return false;
  };
  // CLK_TCK è 100 sui Linux della CI e di casa.
  const tickMs = 10;
  const out = {};
  for (const proc of all) {
    const kind = group(proc.comm);
    if ((kind !== "webview" && kind !== "app") || !descends(proc)) continue;
    let tasks = [];
    try {
      tasks = readdirSync(`/proc/${proc.pid}/task`);
    } catch {
      continue;
    }
    for (const tid of tasks) {
      try {
        const raw = readFileSync(`/proc/${proc.pid}/task/${tid}/stat`, "utf8");
        const close = raw.lastIndexOf(")");
        const name = raw.slice(raw.indexOf("(") + 1, close).replace(/\d+$/, "#");
        const fields = raw.slice(close + 2).split(" ");
        const key = `${kind}:${name}`;
        out[key] = (out[key] ?? 0) + (Number(fields[11]) + Number(fields[12])) * tickMs;
      } catch {
        // Un filo uscito fra l'elenco e la lettura.
      }
    }
  }
  return out;
}

/// La CPU spesa fra due letture di `threadCpu`, per filo, dalla più alta.
export function threadCpuSpent(before, after) {
  if (!before || !after) return null;
  const spent = Object.entries(after)
    .map(([key, ms]) => [key, ms - (before[key] ?? 0)])
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(spent);
}
