#!/usr/bin/env node
// Ogni listener su un target globale e ogni primitiva asincrona con una
// cancellazione devono dichiarare un proprietario. La guardia legge i sorgenti
// del client unificato e lascia liberi i test, che costruiscono casi negativi.

import fs from "node:fs";
import path from "node:path";

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
]);

function quoted(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function violations(text, relative) {
  const names = GLOBAL_TARGETS.map((target) => target.replace(".", "\\s*\\.\\s*")).join("|");
  const globalListener = new RegExp(
    String.raw`(?<![.\w])(${names})\s*\.\s*addEventListener\b`,
  );
  const mediaListener = /matchMedia[\s\S]*?\.\s*addEventListener\b/;
  const subscription = /\.\s*subscribe\s*\(/;
  const timer = /\b(?:window\s*\.\s*)?(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/;
  const observer = /\bnew\s+(?:MutationObserver|ResizeObserver|IntersectionObserver)\s*\(/;
  const found = [];
  const lines = text.split("\n");
  const source = lines.join("\n");
  for (const [index, line] of lines.entries()) {
    // I commenti descrivono spesso il primitivo sorvegliato: non sono codice
    // eseguibile e non devono diventare violazioni della guardia.
    const code = line.replace(/\/\/.*$/, "").trim();
    if (!code) continue;

    if (globalListener.test(code) || mediaListener.test(code)) {
      found.push({ line: index + 1, kind: "global listener", text: line.trim() });
      continue;
    }

    if (subscription.test(code)) {
      // Un disposer nominato e assegnato è la forma strutturale minima di
      // ownership: una sottoscrizione anonima non ha una porta di uscita.
      const owned = /(?:const|let|var)\s+\w*(?:stop|dispose|unsubscribe)\w*\s*=\s*[\s\S]*\.subscribe\s*\(/i.test(code) ||
        /\b\w*(?:stop|dispose|unsubscribe)\w*\s*=\s*[\s\S]*\.subscribe\s*\(/i.test(code);
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
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      found.push(candidate);
    }
  }
  return found;
}

const root = process.argv[2] ?? ".";
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
