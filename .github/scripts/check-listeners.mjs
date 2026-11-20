#!/usr/bin/env node
// Ogni listener su un target globale e ogni primitiva asincrona con una
// cancellazione devono dichiarare un proprietario. La guardia legge i sorgenti
// del client unificato e lascia liberi i test, che costruiscono casi negativi.

import fs from "node:fs";
import path from "node:path";
import { codeOnly, selfTestCode } from "./ts-code.mjs";

const GATE = "apps/client/src/ui/lifetime.ts";
const SOURCES = "apps/client/src";
const GLOBAL_TARGETS = [
  "document",
  "window",
  "globalThis",
  "self",
  "document.body",
  "document.documentElement",
];

const ALLOWED_TIMER_FILES = new Set([
  // Il toast è un oggetto one-shot: il callback verifica ancora l'identità
  // prima di rimuoversi, quindi non esiste un timer da cancellare altrove.
  "apps/client/src/ui/notify.ts",
  // Il supporto dei test della griglia, che soltanto i test importano:
  // `settle` aspetta un giro di macrotask perché le promesse in volo finiscano,
  // e il timer muore con la promessa che risolve.
  "apps/client/src/editors/grid/test-support.ts",
  // Le attese dei banchi, che soltanto i test importano: ogni giro di
  // `waiter` aspetta un timer che muore con la promessa che risolve.
  "apps/client/src/test-wait.ts",
]);

function quoted(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// Le righe logiche del codice: una catena spezzata da Prettier
/// (`window` a capo `.addEventListener(…)`) torna una riga sola, col numero
/// della riga dove comincia. Una riga che comincia con `...` (uno spread) non
/// è una catena: resta una riga sua, come ogni altro argomento a capo.
function logicalLines(code) {
  const lines = [];
  for (const [index, line] of code.split("\n").entries()) {
    const trimmed = line.trim();
    if (lines.length && /^(?:\?\.|\.(?!\.\.))/.test(trimmed)) {
      lines[lines.length - 1].code += trimmed;
    } else {
      lines.push({ line: index + 1, code: trimmed });
    }
  }
  return lines;
}

export function violations(text, relative) {
  const names = GLOBAL_TARGETS.map((target) => target.replace(".", "\\s*\\??\\.\\s*")).join("|");
  const globalListener = new RegExp(
    String.raw`(?<![.\w])(${names})\s*\??\.\s*addEventListener\b`,
  );
  const mediaListener = /matchMedia[\s\S]*?\??\.\s*addEventListener\b/;
  const subscription = /\??\.\s*subscribe\s*\(/;
  const timer = /\b(?:window\s*\.\s*)?(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/;
  const observer = /\bnew\s+(?:MutationObserver|ResizeObserver|IntersectionObserver)\s*\(/;
  const found = [];
  // Commenti e letterali svuotati (`ts-code.mjs`): un commento descrive il
  // primitivo sorvegliato e non è una violazione, ma non deve nemmeno
  // nascondere il codice accanto (`/* … */ window.addEventListener(…)`), e un
  // `clearTimeout(id)` scritto in un commento non rende proprietario nessuno.
  const source = codeOnly(text);
  const original = text.split("\n");
  for (const { line: number, code } of logicalLines(source)) {
    if (!code) continue;
    const index = number - 1;
    const line = original[index];

    if (globalListener.test(code) || mediaListener.test(code)) {
      found.push({ line: index + 1, kind: "global listener", text: line.trim() });
      continue;
    }

    if (subscription.test(code)) {
      // Un disposer nominato e assegnato è la forma strutturale minima di
      // ownership: una sottoscrizione anonima non ha una porta di uscita.
      const owned = /(?:const|let|var)\s+\w*(?:stop|dispose|unsubscribe)\w*\s*=\s*[\s\S]*\.subscribe\s*\(/i.test(code) ||
        /\b\w*(?:stop|dispose|unsubscribe)\w*\s*=\s*[\s\S]*\.subscribe\s*\(/i.test(code) ||
        // Il disposer consegnato a un `Lifetime` che lo chiude allo smontaggio.
        /\b(?:this\s*\.\s*#?)?\w*life\w*\s*\.\s*add\s*\(\s*[\w$.#]+\.subscribe\s*\(/i.test(code) ||
        // Un metodo che inoltra la sottoscrizione ne restituisce il disposer a
        // chi chiama, che ne diventa il proprietario.
        /\bsubscribe\s*:\s*\(?\s*\w*\s*\)?\s*=>\s*[\w$.#]+\.subscribe\s*\(/.test(code);
      if (!owned) {
        found.push({ line: index + 1, kind: "subscription", text: line.trim() });
        continue;
      }
    }

    if (timer.test(code)) {
      const assignment = /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*(?:\.#[\w$]+|\.[\w$]+)?)\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/.exec(code);
      const ownedByLifetime = /\blifetime\s*\.\s*listen\b/.test(code);
      const ownedBySchedule = /\boptions\s*\.\s*schedule\b/.test(code);
      let owned = ownedByLifetime || ownedBySchedule || ALLOWED_TIMER_FILES.has(relative);
      if (assignment) {
        const id = quoted(assignment[1]);
        owned ||= new RegExp(
          String.raw`\b(?:clearTimeout|clearInterval|cancelAnimationFrame)\s*\(\s*${id}\s*\)`,
        ).test(source);
        // Il timeout di un'attesa conservato nel suo record (`{ …, timer }`) e
        // cancellato da chi consuma quel record (`clearTimeout(x.timer)`).
        owned ||= assignment[1] === "timer" &&
          /\{[^}]*\btimer\s*\}/.test(source) &&
          /\b(?:clearTimeout|clearInterval)\s*\(\s*[\w$.]+\.timer\s*\)/.test(source);
      }
      if (!owned) {
        found.push({ line: index + 1, kind: "timer", text: line.trim() });
        continue;
      }
    }

    if (observer.test(code)) {
      const assignment = /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*(?:\.#[\w$]+|\.[\w$]+)?)\s*=\s*new\s+(?:MutationObserver|ResizeObserver|IntersectionObserver)\s*\(/.exec(code);
      const owned = assignment &&
        new RegExp(String.raw`\b${quoted(assignment[1])}\s*(?:\?\s*)?\.\s*disconnect\s*\(`).test(source);
      if (!owned) {
        found.push({ line: index + 1, kind: "observer", text: line.trim() });
      }
    }
  }
  return found;
}

function sourceFiles(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) sourceFiles(candidate, found);
    else if (/\.(?:ts|tsx|mts)$/.test(entry.name) && !/\.test\.(?:ts|tsx|mts)$/.test(entry.name)) {
      found.push(candidate);
    }
  }
  return found;
}

/// I casi che la guardia deve vedere e quelli che deve lasciare. Le righe
/// segnate «sfuggiva» passavano verdi con la lettura riga per riga di prima
/// (audit del 20/11, P-25).
function selfTest() {
  const cases = [
    ["un listener globale", 'window.addEventListener("x", f);', 1],
    ["la catena spezzata da Prettier (sfuggiva)", 'window\n  .addEventListener("x", f);', 1],
    ["un commento a blocco prima del codice (sfuggiva)", '/* nota */ window.addEventListener("x", f);', 1],
    ["la catena opzionale (sfuggiva)", 'window?.addEventListener("x", f);', 1],
    ["una URL prima del timer (sfuggiva)", 'const u = "http://x"; setTimeout(f, 1);', 1],
    ["il clear scritto solo in un commento (sfuggiva)", "const t = setTimeout(f, 1);\n// clearTimeout(t)", 1],
    ["il listener in un commento", "// window.addEventListener(…)", 0],
    ["il listener in una stringa", 'const s = "window.addEventListener(";', 0],
    ["il listener di una Vita", 'lifetime.listen(window, "x", f);', 0],
    ["il timer col suo clear", "const t = setTimeout(f, 1);\nclearTimeout(t);", 0],
    ["una sottoscrizione anonima", "bus.subscribe(f);", 1],
    ["una sottoscrizione col disposer", "const stop = bus.subscribe(f);", 0],
    ["un osservatore senza disconnect", "new ResizeObserver(f);", 1],
    ["un osservatore col disconnect", "const o = new ResizeObserver(f);\no.disconnect();", 0],
    // Uno spread a capo è un argomento come gli altri, non una catena da
    // incollare alla riga prima (revisione #528): incollato, prendeva il
    // disposer nominato là e la sua sottoscrizione anonima spariva.
    ["un argomento a capo", "const stop = merge(\n  parts.map((p) => p.subscribe(f)),\n);", 1],
    ["uno spread a capo (sfuggiva)", "const stop = merge(\n  ...parts.map((p) => p.subscribe(f)),\n);", 1],
    ["la catena opzionale a capo", "const stop = bus\n  ?.subscribe(f);", 0],
    ["la catena a capo", "const stop = bus\n  .subscribe(f);", 0],
  ];
  const failures = [];
  try {
    selfTestCode();
  } catch (error) {
    failures.push(error.message);
  }
  for (const [label, source, count] of cases) {
    const found = violations(source, "apps/client/src/caso.ts").length;
    if (found !== count) failures.push(`${label}: attese ${count} violazioni, trovate ${found}`);
  }
  if (failures.length) {
    console.error("Autoprova di check-listeners fallita:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Autoprova di check-listeners riuscita (${cases.length} casi).`);
}

// L'autoprova gira anche prima di ogni controllo vero: costa pochi
// millisecondi, e così la CI e `scripts/check.sh` la eseguono senza un passo
// in più.
selfTest();
if (process.argv.includes("--self-test")) process.exit(0);

const root = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? ".";
const sourceRoot = path.join(root, SOURCES);
if (!fs.existsSync(sourceRoot)) {
  console.error(`cannot find ${sourceRoot}: pass the repo root as an argument.`);
  process.exit(2);
}

let problems = 0;
let inspected = 0;
for (const file of sourceFiles(sourceRoot).sort()) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative === GATE) continue;
  inspected++;
  for (const violation of violations(fs.readFileSync(file, "utf8"), relative)) {
    problems++;
    console.error(`${relative}:${violation.line}: ${violation.kind} without explicit ownership`);
    console.error(`  ${violation.text}`);
  }
}
if (problems > 0) {
  console.error("");
  console.error(`${problems} unowned listeners, subscriptions, timers, or observers.`);
  console.error("Use an owning Lifetime/disposer, or add a narrowly justified allowlist entry.");
  process.exit(1);
}

console.log(`${inspected} sources: every listener, subscription, timer, and observer has explicit ownership.`);
