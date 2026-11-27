#!/usr/bin/env node
// Ogni listener su un target globale e ogni primitiva asincrona con una
// cancellazione devono dichiarare un proprietario. La guardia legge i sorgenti
// del client unificato e lascia liberi i test, che costruiscono casi negativi.
//
// Limiti noti, senza un parser vero (#509):
// - un globale che arriva da una funzione (`const mq = ensureMedia()`) o da
//   un parametro non è riconosciuto;
// - gli alias si raccolgono per nome in tutto il file, senza ambito: un
//   parametro o un nome locale che si chiama come un alias
//   (`const doc = document` qui, `(doc) => doc.addEventListener(…)` là) dà
//   un falso rosso;
// - un disposer nominato conta come usato se il nome torna nel file, anche
//   dove non lo chiama nessuno: un altro `stop` locale omonimo lo fa
//   sembrare usato;
// - un timer conta come cancellato se il suo nome compare in un `clear…`,
//   senza guardare se quel ramo gira.

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
  // Il supporto delle prove dell'editor del disegno, che soltanto i test
  // importano: aspetta un giro di macrotask con un timer che muore con la
  // promessa che risolve (prima stava nel file di prova, escluso dal controllo).
  "apps/client/src/editors/spatial/tools/editor-test-support.ts",
  // Il supporto delle prove della shell intera, che soltanto i test
  // importano: `settle` aspetta un giro di macrotask con un timer che muore
  // con la promessa che risolve; il risponditore delle conferme ha il suo
  // `clearInterval` (prima stava in `shell.e2e.test.ts`, escluso dal controllo).
  "apps/client/src/shell-e2e-support.ts",
]);

/// `const nome = <un globale>`: la finestra, il documento e i loro figli
/// fissi, il documento o la finestra di un nodo, una `matchMedia(…)`. Anche
/// con gli idiomi di TypeScript dopo il valore: l'asserzione non nulla
/// (`window.visualViewport!`) e `as Tipo` (`el.ownerDocument as Document`),
/// che prima facevano sfuggire l'alias (revisione di GUARDIE-1).
const GLOBAL_ALIAS = new RegExp(
  String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*` +
    String.raw`(?:(?:window|document|globalThis)(?:\s*\.\s*(?:body|documentElement|defaultView|visualViewport))?` +
    String.raw`|[\w$.#]*\.\s*(?:ownerDocument|defaultView)(?:\s*\??\.\s*defaultView)?` +
    String.raw`|(?:window\s*\.\s*)?matchMedia\s*\([^()]*\))` +
    String.raw`(?:\s*!(?!=))?(?:\s+as\s+[\w$.<>[\]|&\s]+?)?\s*[;,\n)]`,
  "g",
);

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

/// `ownerText` è il testo in cui si cerca chi chiude ciò che il file apre: il
/// file stesso, o tutti i pezzi della classe a cui appartiene (i motori divisi
/// in `engine*.ts`, dove un timer si apre in un pezzo e si chiude in un altro).
export function violations(text, relative, ownerText = text) {
  const names = GLOBAL_TARGETS.map((target) => target.replace(".", "\\s*\\??\\.\\s*")).join("|");
  const globalListener = new RegExp(
    String.raw`(?<![.\w])(${names})\s*\??\.\s*addEventListener\b`,
  );
  const mediaListener = /matchMedia[\s\S]*?\??\.\s*(?:addEventListener|addListener)\b/;
  // Un globale raggiunto per una catena di proprietà (`window.visualViewport`,
  // `document.fonts`), o il documento e la finestra di un nodo
  // (`el.ownerDocument`, `doc.defaultView`): sfuggivano (#509).
  const deepGlobal = /(?<![.\w$])(?:window|document|globalThis)(?:\s*\??\.\s*[A-Za-z_$][\w$]*)+?\s*\??\.\s*addEventListener\b/;
  const nodeGlobal = /\.\s*(?:ownerDocument|defaultView)(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*?\s*\??\.\s*addEventListener\b/;
  const subscription = /\??\.\s*subscribe\s*\(/;
  // `requestIdleCallback` sfuggiva (#509): si cancella con `cancelIdleCallback`.
  const timer = /\b(?:window\s*\.\s*)?(?:setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/;
  const observer = /\bnew\s+(?:MutationObserver|ResizeObserver|IntersectionObserver|PerformanceObserver)\s*\(/;
  const found = [];
  // Commenti e letterali svuotati (`ts-code.mjs`): un commento descrive il
  // primitivo sorvegliato e non è una violazione, ma non deve nemmeno
  // nascondere il codice accanto (`/* … */ window.addEventListener(…)`), e un
  // `clearTimeout(id)` scritto in un commento non rende proprietario nessuno.
  const source = codeOnly(text);
  const owners = ownerText === text ? source : codeOnly(ownerText);
  const original = text.split("\n");
  // I nomi locali dati a un globale o a una `MediaQueryList`
  // (`const doc = document`, `const mq = matchMedia(q)`): un ascoltatore
  // attaccato al nome è un ascoltatore globale (#509). Un globale che arriva
  // da una funzione (`const mq = ensureMedia()`) resta fuori: senza un
  // parser la guardia non sa che cosa torna.
  const aliases = [...source.matchAll(GLOBAL_ALIAS)].map((match) => match[1]);
  const aliasListener = aliases.length
    ? new RegExp(String.raw`(?<![.\w$])(?:${aliases.map(quoted).join("|")})\s*\??\.\s*(?:addEventListener|addListener)\b`)
    : null;
  for (const { line: number, code } of logicalLines(source)) {
    if (!code) continue;
    const index = number - 1;
    const line = original[index];

    if (
      globalListener.test(code) || mediaListener.test(code) || deepGlobal.test(code) || nodeGlobal.test(code) ||
      aliasListener?.test(code)
    ) {
      found.push({ line: index + 1, kind: "global listener", text: line.trim() });
      continue;
    }

    if (subscription.test(code)) {
      // Un disposer nominato e assegnato è la forma strutturale minima di
      // ownership: una sottoscrizione anonima non ha una porta di uscita.
      // Il nome deve servire a qualcosa: un `const stop = bus.subscribe(f)`
      // che nessuno chiama, passa o restituisce era verde (#509). Basta che
      // il nome torni altrove nel file; che la chiamata arrivi davvero lo
      // dicono i test del modulo.
      const named = /(?<![\w$])(#?\w*(?:stop|dispose|unsubscribe)\w*)\s*=\s*[\s\S]*\.subscribe\s*\(/i.exec(code);
      const used = named !== null &&
        (owners.match(new RegExp(String.raw`(?<![\w$])${quoted(named[1])}(?![\w$])`, "g"))?.length ?? 0) > 1;
      const owned = used ||
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
      const assignment = /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*(?:\.#[\w$]+|\.[\w$]+)?)\s*=\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/.exec(code);
      // Un timer che non fa altro che registrare su una `Lifetime`
      // (`setTimeout(() => lifetime.listen(…))`): su una vita chiusa quella
      // riga non fa niente. Prima bastava che `lifetime.listen` stesse sulla
      // stessa riga, anche col timer dentro l'ascoltatore, che scatta a vita
      // chiusa (#509). La Vita può stare su un oggetto (`this.lifetime`,
      // `this.#lifetime`) o avere un altro nome (`drag.listen`); un secondo
      // timer sulla stessa riga non ha più quella scusa.
      const ownedByLifetime =
        /\b(?:setTimeout|requestAnimationFrame|requestIdleCallback)\s*\(\s*\(\s*\)\s*=>\s*\{?\s*(?:this\s*\.\s*)?#?[A-Za-z_$][\w$]*\s*\.\s*listen\s*\(/.test(code) &&
        (code.match(/\b(?:setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\s*\(/g)?.length ?? 0) === 1;
      const ownedBySchedule = /\boptions\s*\.\s*schedule\b/.test(code);
      let owned = ownedByLifetime || ownedBySchedule || ALLOWED_TIMER_FILES.has(relative);
      if (assignment) {
        const id = quoted(assignment[1]);
        owned ||= new RegExp(
          String.raw`\b(?:clearTimeout|clearInterval|cancelAnimationFrame|cancelIdleCallback)\s*(?:\?\.\s*)?\(\s*${id}\s*\)`,
        ).test(owners);
        // Il timeout di un'attesa conservato nel suo record (`{ …, timer }`) e
        // cancellato da chi consuma quel record (`clearTimeout(x.timer)`).
        owned ||= assignment[1] === "timer" &&
          /\{[^}]*\btimer\s*\}/.test(owners) &&
          /\b(?:clearTimeout|clearInterval)\s*\(\s*[\w$.]+\.timer\s*\)/.test(owners);
      }
      if (!owned) {
        found.push({ line: index + 1, kind: "timer", text: line.trim() });
        continue;
      }
    }

    if (observer.test(code)) {
      const assignment = /(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*(?:\.#[\w$]+|\.[\w$]+)?)\s*=\s*new\s+(?:MutationObserver|ResizeObserver|IntersectionObserver)\s*\(/.exec(code);
      const owned = assignment &&
        new RegExp(String.raw`\b${quoted(assignment[1])}\s*(?:\?\s*)?\.\s*disconnect\s*\(`).test(owners);
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
    ["una sottoscrizione col disposer", "const stop = bus.subscribe(f);\nlife.add(stop);", 0],
    ["un osservatore senza disconnect", "new ResizeObserver(f);", 1],
    ["un osservatore col disconnect", "const o = new ResizeObserver(f);\no.disconnect();", 0],
    // Uno spread a capo è un argomento come gli altri, non una catena da
    // incollare alla riga prima (revisione #528): incollato, prendeva il
    // disposer nominato là e la sua sottoscrizione anonima spariva.
    ["un argomento a capo", "const stop = merge(\n  parts.map((p) => p.subscribe(f)),\n);", 1],
    ["uno spread a capo (sfuggiva)", "const stop = merge(\n  ...parts.map((p) => p.subscribe(f)),\n);", 1],
    ["la catena opzionale a capo", "const stop = bus\n  ?.subscribe(f);\nstop();", 0],
    ["la catena a capo", "const stop = bus\n  .subscribe(f);\nstop();", 0],
    // Il giro di #509: forme che passavano ancora.
    ["il documento di un nodo (sfuggiva)", 'el.ownerDocument.addEventListener("x", f);', 1],
    ["la finestra di un documento (sfuggiva)", 'doc.defaultView?.addEventListener("x", f);', 1],
    ["un figlio fisso della finestra (sfuggiva)", 'window.visualViewport?.addEventListener("resize", f);', 1],
    ["i caratteri del documento (sfuggiva)", 'document.fonts.addEventListener("loadingdone", f);', 1],
    ["un elemento trovato nel documento", 'document.getElementById("a").addEventListener("x", f);', 0],
    ["la finestra in un nome locale (sfuggiva)", 'const w = window;\nw.addEventListener("x", f);', 1],
    ["il documento di un nodo in un nome locale (sfuggiva)", 'const doc = el.ownerDocument;\ndoc.addEventListener("x", f);', 1],
    ["una matchMedia in un nome locale (sfuggiva)", 'const mq = window.matchMedia(q);\nmq.addEventListener("change", f);', 1],
    ["il vecchio addListener (sfuggiva)", "matchMedia(q).addListener(f);", 1],
    ["il nome locale passato a una Vita", 'const mq = matchMedia(q);\nlifetime.listen(mq, "change", f);', 0],
    ["un nome locale per altro", 'const doc = document;\nconst p = doc.createElement("p");', 0],
    ["un disposer che nessuno usa (sfuggiva)", "const stop = bus.subscribe(f);", 1],
    ["un disposer privato usato", "this.#stopBus = bus.subscribe(f);\nthis.#stopBus();", 0],
    ["requestIdleCallback senza cancel (sfuggiva)", "const h = requestIdleCallback(f);", 1],
    ["requestIdleCallback col cancel opzionale", "const h = scope.requestIdleCallback(f);\nscope.cancelIdleCallback?.(h);", 0],
    ["un timer dentro un ascoltatore di una Vita (sfuggiva)", 'lifetime.listen(el, "x", () => setTimeout(f, 100));', 1],
    ["un timer che registra su una Vita", 'setTimeout(() => lifetime.listen(document, "click", f), 0);', 0],
    ["un PerformanceObserver senza disconnect (sfuggiva)", "new PerformanceObserver(f).observe(o);", 1],
    // La revisione di GUARDIE-1: gli idiomi TypeScript dell'alias e i
    // proprietari della Vita che il timer di prima accettava.
    ["un alias con l'asserzione non nulla (sfuggiva)", 'const vv = window.visualViewport!;\nvv.addEventListener("resize", f);', 1],
    ["un alias con `as` (sfuggiva)", 'const doc = el.ownerDocument as Document;\ndoc.addEventListener("x", f);', 1],
    ["un alias con `as` a un tipo generico (sfuggiva)", 'const w = el.ownerDocument.defaultView as Window | null;\nw?.addEventListener("x", f);', 1],
    ["un timer che registra sulla Vita dell'oggetto", 'setTimeout(() => this.lifetime.listen(document, "x", f), 0);', 0],
    ["un timer che registra sulla Vita privata", 'setTimeout(() => this.#lifetime.listen(document, "x", f), 0);', 0],
    ["un timer che registra su una Vita con un altro nome", 'setTimeout(() => drag.listen(document, "x", f), 0);', 0],
    ["un'attesa del thread libero che registra su una Vita", 'requestIdleCallback(() => lifetime.listen(document, "x", f));', 0],
    ["un timer che registra e poi fa altro", 'setTimeout(() => { lifetime.listen(document, "x", f); setTimeout(g, 9); }, 0);', 1],
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
/// I pezzi di una classe divisa a pacchetti (`editors/canvas/engine*.ts`,
/// `editors/grid/engine*.ts`): per la proprietà sono un file solo.
const CLASS_PARTS = /^apps\/client\/src\/editors\/(?:canvas|grid)\/engine[^/]*\.ts$/;
function ownerTextOf(file, relative, text) {
  if (!CLASS_PARTS.test(relative)) return text;
  const dir = path.dirname(file);
  return fs.readdirSync(dir)
    .filter((name) => /^engine[^/]*\.ts$/.test(name) && !/\.test\.ts$/.test(name))
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

for (const file of sourceFiles(sourceRoot).sort()) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative === GATE) continue;
  inspected++;
  const text = fs.readFileSync(file, "utf8");
  for (const violation of violations(text, relative, ownerTextOf(file, relative, text))) {
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
