// Controllo dell'inventario del piano «La lavagna in codice».
// Si lancia dalla radice del worktree: `node PLAN-parita.mjs`.
// Fa con espressioni regolari quello che T1 farà con un test vero
// (crates/fub-canvas-core/tests/parity.rs e parity.test.ts): serve a chi
// rilegge il piano, non entra nel prodotto. Esce con 1 al primo errore trovato.

import { readFileSync } from "node:fs";

const inv = JSON.parse(readFileSync("PLAN-parita.json", "utf8"));
const errors = [];
const fail = (msg) => errors.push(msg);

const STATES = ["code", "composed", "port", "by_hand", "missing", "view", "exception"];
const SOURCES = ["main", "N4", "N6"];
const WRITES = ["file", "nothing", "other-file"];
const GUI_KINDS = ["menu", "toolbar", "field", "key", "gesture", "clipboard", "plan"];

// Le operazioni di main, lette dall'enum `CanvasOp`.
const opsRs = readFileSync("crates/fub-canvas-core/src/ops.rs", "utf8");
const enumBody = opsRs.slice(opsRs.indexOf("pub enum CanvasOp"));
const enumText = enumBody.slice(0, enumBody.indexOf("\n}\n"));
const snake = (s) => s.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
const MAIN_OPS = [...enumText.matchAll(/^    ([A-Z][A-Za-z]+)\s*\{/gm)].map((m) => snake(m[1]));
const N4_OPS = ["add_strokes", "erase_strokes"];
const N6_OPS = ["move_strokes", "restyle_strokes"];
const PLANNED_OPS = [
  "color", "align", "distribute", "duplicate", "reverse", "group", "convert", "insert",
  "layout", "spread_pages", "excerpt", "draw", "erase_along", "from_mermaid", "from_outline",
];
const OPS_BY_SOURCE = { main: MAIN_OPS, N4: [...MAIN_OPS, ...N4_OPS], N6: [...MAIN_OPS, ...N4_OPS, ...N6_OPS] };
const ALL_OPS = [...MAIN_OPS, ...N4_OPS, ...N6_OPS, ...PLANNED_OPS];
if (MAIN_OPS.length < 7) fail(`enum CanvasOp letto male: ${MAIN_OPS.join(", ")}`);

// R1: id unici e vocabolario.
const ids = new Set();
for (const e of inv.entries) {
  if (ids.has(e.id)) fail(`id ripetuto: ${e.id}`);
  ids.add(e.id);
  if (!e.id.startsWith(`${e.source}.`)) fail(`${e.id}: l'id comincia con la fonte`);
  if (!STATES.includes(e.state)) fail(`${e.id}: stato ${e.state}`);
  if (!SOURCES.includes(e.source)) fail(`${e.id}: fonte ${e.source}`);
  if (!WRITES.includes(e.writes)) fail(`${e.id}: writes ${e.writes}`);
  if (!e.name || !Array.isArray(e.gui) || e.gui.length === 0) fail(`${e.id}: manca name o gui`);
  for (const g of e.gui ?? []) {
    const keys = Object.keys(g);
    if (keys.length !== 1 || !GUI_KINDS.includes(keys[0])) fail(`${e.id}: gui ${JSON.stringify(g)}`);
    if (keys[0] === "plan" && e.source === "main") fail(`${e.id}: una voce di main nomina la GUI vera`);
    if (keys[0] === "plan" && !g.plan.startsWith(`${e.source} T`)) fail(`${e.id}: plan ${g.plan}`);
  }
  // R3: chi scrive ha una forma; chi manca ha il task.
  const needsOps = ["code", "composed", "by_hand"].includes(e.state);
  if (needsOps && !(e.ops?.length > 0)) fail(`${e.id}: lo stato ${e.state} vuole ops`);
  if (e.state === "composed" && !e.port) fail(`${e.id}: composed vuole port`);
  if (e.state === "port" && (!e.port || e.ops)) fail(`${e.id}: port vuole port e niente ops`);
  if (["by_hand", "missing"].includes(e.state)) {
    if (!e.computes || !(e.target_ops?.length > 0) || !e.task) fail(`${e.id}: ${e.state} vuole computes, target_ops, task`);
  }
  if (e.state === "missing" && e.ops) fail(`${e.id}: missing non ha ops`);
  if (["view", "exception"].includes(e.state) && (e.ops || e.target_ops)) fail(`${e.id}: ${e.state} non ha operazioni`);
  if (e.state === "exception" && !e.note) fail(`${e.id}: un'eccezione dice perché`);
  if (e.state === "view" && e.writes !== "nothing") fail(`${e.id}: view non scrive`);
  if (e.target_ops && !e.task) fail(`${e.id}: target_ops senza task`);
  if (e.task && !/^T\d+$/.test(e.task)) fail(`${e.id}: task ${e.task}`);
}

// R5: il conto di ciò che manca.
const missing = inv.entries.filter((e) => e.state === "by_hand" || e.state === "missing").length;
if (missing !== inv.max_missing) fail(`max_missing è ${inv.max_missing}, le voci by_hand e missing sono ${missing}`);

// Le operazioni: nomi noti, quelle di ops già esistono per la fonte, id che ci sono.
const board = new Set([...inv.board.nodes, ...inv.board.edges].map((n) => n.id));
const refs = (op) => {
  const out = [];
  const push = (v) => { if (typeof v === "string") out.push(v); };
  push(op.id); push(op.near);
  if (op.op === "connect") { push(op.from); push(op.to); }
  for (const v of op.ids ?? []) push(v);
  if (op.edge) { push(op.edge.fromNode); push(op.edge.toNode); }
  if (op.layer && typeof op.layer === "object") push(op.layer.node);
  if (typeof op.on === "string" && !["auto", "board"].includes(op.on)) push(op.on);
  if (op.on && typeof op.on === "object") push(op.on.card);
  return out;
};
const created = (op) => [op.node?.id, op.edge?.id, op.op === "add_card" ? op.id : undefined].filter(Boolean);
const seenOps = new Set();
for (const e of inv.entries) {
  for (const [field, list] of [["ops", e.ops], ["target_ops", e.target_ops]]) {
    if (!list) continue;
    const local = new Set(board);
    for (const op of list) {
      seenOps.add(op.op);
      if (!ALL_OPS.includes(op.op)) fail(`${e.id}.${field}: operazione sconosciuta ${op.op}`);
      if (field === "ops" && !OPS_BY_SOURCE[e.source].includes(op.op)) fail(`${e.id}.ops: ${op.op} non c'è per ${e.source}`);
      for (const c of created(op)) local.add(c);
      for (const r of refs(op)) {
        if (!local.has(r) && !r.startsWith("s")) fail(`${e.id}.${field}: id ${r} non è sulla lavagna`);
      }
    }
  }
}
// R6: ogni operazione ha una voce o sta in ops_without_gui.
for (const name of inv.ops_without_gui) {
  if (!ALL_OPS.includes(name)) fail(`ops_without_gui: ${name} sconosciuta`);
  seenOps.add(name);
}
for (const name of ALL_OPS) if (!seenOps.has(name)) fail(`operazione senza voce: ${name}`);

// R7 (approssimato): menu, barra e campi di main contro engine.ts.
const engine = readFileSync("apps/client/src/editors/canvas/engine.ts", "utf8");
const menuLiteral = [...engine.matchAll(/id: "(canvas\.[a-z_.0-9]+)"/g)].map((m) => m[1]);
const menuTemplates = [...engine.matchAll(/id: `(canvas\.[^`]+)`/g)].map((m) => m[1]);
const EXPAND = {
  "canvas.color.${value || \"none\"}": ["none", "1", "2", "3", "4", "5", "6"].map((v) => `canvas.color.${v}`),
  "canvas.align.${axis}": ["left", "center", "right", "top", "middle", "bottom"].map((v) => `canvas.align.${v}`),
  "canvas.add.${type}": ["text", "link", "group"].map((v) => `canvas.add.${v}`),
};
const menu = new Set(menuLiteral);
for (const t of menuTemplates) {
  if (!EXPAND[t]) fail(`engine.ts: id di menu a modello non espanso: ${t}`);
  for (const v of EXPAND[t] ?? []) menu.add(v);
}
const toolbar = new Set([...engine.matchAll(/mk\("([a-z-]+)"/g)].map((m) => m[1]));
if (engine.includes('for (const axis of ["left", "center", "right", "top", "middle", "bottom", "distribute-x", "distribute-y"]')) {
  for (const v of ["left", "center", "right", "top", "middle", "bottom", "distribute-x", "distribute-y"]) toolbar.add(v);
} else fail("engine.ts: il ciclo dei bottoni di allineamento è cambiato");
const fields = new Set([...engine.matchAll(/canvasField = "([a-z-]+)"/g)].map((m) => m[1]));
if (engine.includes("canvasField = `${field}-hex`")) { fields.add("node-color-hex"); fields.add("edge-color-hex"); }
if (engine.includes('colorEditor("node-color"')) fields.add("node-color");
if (engine.includes('colorEditor("edge-color"')) fields.add("edge-color");
if ((engine.match(/canvasField = `edge-\$\{field\}`/g) ?? []).length === 2) {
  for (const v of ["fromNode", "toNode", "fromSide", "toSide", "fromEnd", "toEnd"]) fields.add(`edge-${v}`);
} else fail("engine.ts: i campi dell'arco sono cambiati");

const declared = { menu: new Set(), toolbar: new Set(), field: new Set() };
for (const e of inv.entries.filter((x) => x.source === "main")) {
  for (const g of e.gui) for (const k of Object.keys(declared)) if (g[k]) declared[k].add(g[k]);
}
for (const [kind, actual] of [["menu", menu], ["toolbar", toolbar], ["field", fields]]) {
  for (const v of actual) if (!declared[kind].has(v)) fail(`${kind} ${v} in engine.ts non ha una voce`);
  for (const v of declared[kind]) if (!actual.has(v)) fail(`${kind} ${v} nell'inventario non è in engine.ts`);
}
const keys = new Set(inv.entries.filter((x) => x.source === "main").flatMap((e) => e.gui.map((g) => g.key)).filter(Boolean));
for (const k of ["Mod+Z", "Mod+Shift+Z", "Mod+Y", "Mod+A", "Mod+D", "Mod+=", "Mod+-", "Mod+0", "Delete", "Backspace", "Enter", "ArrowLeft"]) {
  if (!keys.has(k)) fail(`tasto ${k} senza voce`);
}

// Riassunto.
const count = {};
for (const e of inv.entries) {
  count[e.source] ??= {};
  count[e.source][e.state] = (count[e.source][e.state] ?? 0) + 1;
}
console.log(`voci: ${inv.entries.length}; operazioni di main: ${MAIN_OPS.join(", ")}`);
console.log(`menu ${menu.size}, barra ${toolbar.size}, campi ${fields.size}: tutti con una voce`);
for (const [source, states] of Object.entries(count)) {
  console.log(`${source}: ${Object.entries(states).map(([s, n]) => `${s} ${n}`).join(", ")}`);
}
console.log(`da fare (by_hand + missing): ${missing}`);
const byTask = {};
for (const e of inv.entries) if (e.task) (byTask[e.task] ??= []).push(e.id);
for (const t of Object.keys(byTask).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
  console.log(`${t}: ${byTask[t].length} voci`);
}
if (errors.length) {
  console.error(`\n${errors.length} errori:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("ok");
