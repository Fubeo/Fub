// **Il banco dei gesti della griglia**: rifà con input veri i gesti delle
// diagnosi d34–d42 sulla cartella di Excel e guarda che cosa resta.
//
//     npm run bench:grid                      # tutti i controlli
//     node bench/grid-gestures.mjs --only=d38 # solo quelli il cui id comincia così
//
// # Perché un banco e non un test
//
// I difetti di questi gesti non si vedono con un `dispatchEvent`: nascono dal
// browser vero. Un doppio clic è un `pointerdown`, un `pointerup`, un `click`,
// e solo dopo un `dblclick` sullo **stesso** elemento — e se il primo
// `pointerdown` ridisegna la cella, il `dblclick` non arriva mai (d35). Una
// rotella sposta il fuoco solo se la pagina lo lascia cadere (d37). Lo
// scorrimento che perde le intestazioni è una questione di fotogrammi (d42).
// L'autosalvataggio che chiude la cella mentre si scrive è una questione di
// orologio (d34): qui l'ora è vera (`clock: false`), perché il salvataggio
// parte da un timer della pagina, e con l'orologio fermo non partirebbe mai.
//
// Ogni controllo parte da una pagina nuova sulla scena `grid-workbook`
// (`Dati/Conti.xlsx`), o su quella che dice il suo campo `scene` (i controlli
// G1 sulla cartella grande, `grid-large`), fa il gesto con il mouse e la tastiera di Playwright, e
// legge quattro cose: la bozza nel campo della cella, dove sta il fuoco, la
// cella attiva (`.grid-cell.active` e il nome `.grid-cell-name`) e se l'editor
// della cella è aperto. **Non** legge i valori riletti: l'host del banco non
// riapplica il giornale (`openGridBytes` ridà la sessione di partenza), quindi
// ciò che si è scritto spesso non torna. Dove serve, guarda le chiamate
// all'host in `window.bench.calls`.
//
// # Ogni cantiere accende il suo controllo
//
// Ogni controllo porta la sigla del cantiere del piano che lo fa passare (Q1,
// Q2, …). `ACCESI` dice quali cantieri sono accesi: un controllo acceso che
// fallisce fa uscire il banco con un codice diverso da zero; uno spento gira
// lo stesso e riferisce «atteso dopo Qn», senza far fallire niente. Così chi
// chiude un cantiere aggiunge la sua sigla qui, e da quel momento il gesto è
// presidiato.
//
// # Che cosa produce
//
// Una riga per controllo sullo stdout, il referto in
// `bench/.output/grid-gestures.json` e una foto dello stato finale di ogni
// controllo in `bench/.output/grid-gestures/` (per d42, il fotogramma
// peggiore dello scorrimento).
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { GESTURE_SCENE, SCENE, sceneUrl } from "./scene.mjs";
import { openStage, openPage, prepareScene, OUTPUT } from "./stage.mjs";

/// I cantieri chiusi: i loro controlli decidono l'esito del banco.
const ACCESI = new Set(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14", "Q15", "G1"]);

const REPORT = join(OUTPUT, "grid-gestures.json");
const SHOTS = join(OUTPUT, "grid-gestures");
/// La scena di serie dei controlli; un controllo con `scene` usa la sua.
const SCENE_ID = "grid-workbook";
/// La cartella grande, con la riga 1 e la colonna A bloccate (griglia T1).
const LARGE_SCENE_ID = "grid-large";

/// La pausa fra le battute «lente» di d34: abbastanza da lasciar partire
/// l'autosalvataggio a metà parola (~400 ms dopo l'ultima modifica).
const SLOW_KEY_MS = 70;
/// Quanto si aspetta dopo un gesto perché la griglia abbia finito di
/// rispondere: due fotogrammi non bastano quando c'è di mezzo l'host.
const SETTLE_MS = 250;
/// Quanto si aspetta dopo la scrittura lenta, perché ogni autosalvataggio
/// rimasto in coda parta e torni.
const AUTOSAVE_WAIT_MS = 1_200;
/// La parte del nastro delle intestazioni che può differire dalla prima foto
/// in un fotogramma dello scorrimento: le intestazioni sono ferme, e quando
/// spariscono al loro posto passano le celle, cioè quasi tutto il nastro.
const HEADER_DIFF_LIMIT = 0.1;

const only = process.argv
  .find((arg) => arg.startsWith("--only="))
  ?.slice("--only=".length)
  .split(",")
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Ciò che si legge nella pagina.
// ---------------------------------------------------------------------------

/// Riga e colonna (da zero) di un indirizzo A1 semplice: «B7» → {row: 6, column: 1}.
function at(a1) {
  const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(a1);
  let column = 0;
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(digits) - 1, column: column - 1 };
}

const cellSelector = (a1) => {
  const { row, column } = at(a1);
  return `.pane.focus .grid-cell[data-row="${row}"][data-column="${column}"]`;
};

/// Lo stato della griglia che i controlli confrontano.
function readState(page) {
  return page.evaluate(() => {
    const grid = document.querySelector(".pane.focus .grid-surface");
    const host = grid?.querySelector(".grid-cell-editor");
    const lines = host ? [...host.querySelectorAll(".cm-line")].map((line) => line.textContent) : [];
    const active = document.activeElement;
    const activeCell = grid?.querySelector(".grid-cell.active");
    const describe = (el) => {
      if (!el) return "niente";
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
      return `${el.tagName}${cls}`;
    };
    const editorCell = host?.parentElement?.classList.contains("grid-cell") ? host.parentElement : null;
    return {
      name: grid?.querySelector(".grid-cell-name")?.textContent ?? null,
      activeCell: activeCell ? { row: Number(activeCell.dataset.row), column: Number(activeCell.dataset.column) } : null,
      editorOpen: host ? !host.hidden : false,
      editorCell: editorCell ? { row: Number(editorCell.dataset.row), column: Number(editorCell.dataset.column) } : null,
      editorLines: lines,
      editorText: lines.join("\n"),
      focus: describe(active),
      focusInEditor: host ? host.contains(active) : false,
      focusInGrid: grid ? grid.contains(active) : false,
      calls: window.bench.calls.length,
    };
  });
}

/// Le chiamate all'host dopo l'indice `from`, per nome.
async function callsSince(page, from) {
  return page.evaluate((start) => window.bench.calls.slice(start).map((call) => ({
    gate: call.gate,
    args: JSON.stringify(call.args).slice(0, 300),
  })), from);
}

function countGates(calls) {
  const counts = {};
  for (const call of calls) counts[call.gate] = (counts[call.gate] ?? 0) + 1;
  return counts;
}

/// Le celle scritte all'host dopo l'indice `from`, come «riga,colonna=after».
async function patchesSince(page, from) {
  return page.evaluate((start) => window.bench.calls.slice(start)
    .filter((call) => call.gate === "applyGridBytes")
    .flatMap((call) => call.args[1]?.patches ?? [])
    .map((patch) => `${patch.cell.row.slice(1)},${patch.cell.column.slice(1)}=${patch.after}`), from);
}

/// Un incolla con gli appunti dati, come lo manda il browser dopo Ctrl+V.
async function pasteInto(page, data) {
  await page.evaluate((entries) => {
    const transfer = new DataTransfer();
    for (const [type, text] of Object.entries(entries)) transfer.setData(type, text);
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, data);
}

const settle = (page, ms = SETTLE_MS) =>
  page.evaluate((wait) => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), wait)), ms);

/// Il centro di un elemento quando sta fermo: la barra multifunzione e
/// l'avviso sopra la griglia arrivano dopo le celle e le spingono in giù, e
/// un punto preso prima cade sull'avviso.
async function centerOf(page, selector) {
  const center = await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const now = `${box.x},${box.y},${box.width},${box.height}`;
      const before = window.__gestureBox;
      window.__gestureBox = now;
      return before === now && box.width > 0 ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    },
    selector,
    { polling: 100, timeout: 5_000 },
  ).catch(() => {
    throw new Error(`non si vede, o non sta fermo: ${selector}`);
  });
  return center.jsonValue();
}

/// Aspetta che la griglia stia ferma: la barra multifunzione e l'avviso sopra
/// la griglia arrivano dopo le celle e la spingono in giù, e sotto carico
/// possono arrivare dopo che un controllo ha già preso le sue misure (il
/// bordo di d43, la prima foto di d42). Ferma vuol dire uguale per mezzo
/// secondo di fila.
async function gridSteady(page) {
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector(".pane.focus .grid-viewport");
      if (!viewport) return false;
      const box = viewport.getBoundingClientRect();
      const now = `${box.x},${box.y},${box.width},${box.height}`;
      const seen = window.__gridSteady;
      if (seen?.box === now) seen.count += 1;
      else window.__gridSteady = { box: now, count: 0 };
      return window.__gridSteady.count >= 5;
    },
    null,
    { polling: 100, timeout: 10_000 },
  ).catch(() => {
    throw new Error("la griglia non sta ferma");
  });
}

/// Sceglie una cella con un clic vero, e aspetta che sia la cella attiva.
async function pick(page, a1) {
  const { x, y } = await centerOf(page, cellSelector(a1));
  await page.mouse.click(x, y);
  await page.waitForFunction((name) => document.querySelector(".pane.focus .grid-cell-name")?.textContent === name, a1, { timeout: 5_000 })
    .catch(() => {
      throw new Error(`il clic su ${a1} non l'ha scelta`);
    });
  await settle(page);
}

const editorLabel = (s) => (s.editorOpen ? `editor aperto con «${s.editorText.replace(/\n/g, "⏎")}»` : "editor chiuso");
const seen = (s) => `cella ${s.name ?? "?"}, ${editorLabel(s)}, fuoco su ${s.focusInEditor ? "campo della cella" : s.focus}`;

// ---------------------------------------------------------------------------
// I controlli.
// ---------------------------------------------------------------------------
//
// `run` riceve la pagina pronta e restituisce `{ ok, seen, … }`, o
// `{ skip }` quando il gesto non si può fare (e allora non fallisce niente).

const CONTROLS = [
  {
    id: "d34-bozza-oltre-autosalvataggio",
    cantiere: "Q1",
    title: "B7: 7, Invio, poi «abcdefghij» a 70 ms la battuta mentre parte l'autosalvataggio",
    expected: "bozza «abcdefghij» intera nel campo della cella, fuoco nel campo",
    run: async (page) => {
      await pick(page, "B7");
      const before = (await readState(page)).calls;
      await page.keyboard.type("7");
      await page.keyboard.press("Enter");
      await page.keyboard.type("abcdefghij", { delay: SLOW_KEY_MS });
      await settle(page, AUTOSAVE_WAIT_MS);
      const s = await readState(page);
      const gates = countGates(await callsSince(page, before));
      const saves = ["writeDocument", "saveDraft", "applyGridBytes", "openGridBytes"]
        .filter((gate) => gates[gate])
        .map((gate) => `${gate}×${gates[gate]}`)
        .join(", ");
      return {
        ok: s.editorOpen && s.editorText === "abcdefghij" && s.focusInEditor,
        seen: `${seen(s)}; all'host durante la scrittura: ${saves || "nessun salvataggio"}`,
        state: s,
        gates,
      };
    },
  },
  {
    id: "d35-doppio-clic-cella",
    cantiere: "Q2",
    title: "doppio clic vero (page.dblclick) su C3, non scelta",
    expected: "editor aperto su C3, fuoco nel campo",
    run: async (page) => {
      await centerOf(page, cellSelector("C3"));
      await page.dblclick(cellSelector("C3"));
      await settle(page);
      const s = await readState(page);
      const c3 = at("C3");
      const onC3 = s.editorCell?.row === c3.row && s.editorCell?.column === c3.column;
      return { ok: s.editorOpen && onC3 && s.focusInEditor, seen: seen(s), state: s };
    },
  },
  {
    id: "d35-doppio-clic-quadratino",
    cantiere: "Q2",
    title: "B2 scelta, doppio clic vero sul quadratino di riempimento",
    expected: "edit.autoFill chiesto all'host (B2 → B4, fin dove arriva la colonna A)",
    run: async (page) => {
      await pick(page, "B2");
      if ((await page.locator(".pane.focus .grid-fill-handle").count()) === 0) {
        return { skip: "la sessione non serve edit.autoFill: il quadratino non c'è" };
      }
      const before = (await readState(page)).calls;
      await page.dblclick(".pane.focus .grid-fill-handle");
      await settle(page);
      const calls = await callsSince(page, before);
      const fill = calls.find((call) => call.gate === "gridBytesCommand" && call.args.includes("edit.autoFill"));
      const s = await readState(page);
      return {
        ok: fill !== undefined,
        seen: fill ? `edit.autoFill chiesto: ${fill.args}` : `nessun edit.autoFill all'host (${seen(s)})`,
        state: s,
      };
    },
  },
  {
    id: "d36-clic-altrove-conferma",
    cantiere: "Q3",
    title: "B7: «abc», poi clic su E9",
    expected: "editor chiuso, cella attiva E9",
    run: async (page) => {
      await pick(page, "B7");
      await page.keyboard.type("abc");
      await settle(page);
      const typing = await readState(page);
      const { x, y } = await centerOf(page, cellSelector("E9"));
      await page.mouse.click(x, y);
      await settle(page);
      const s = await readState(page);
      return {
        ok: typing.editorOpen && !s.editorOpen && s.name === "E9",
        seen: `scrivendo: ${editorLabel(typing)}; dopo il clic: ${seen(s)}`,
        state: s,
      };
    },
  },
  {
    id: "d37-rotella-mentre-si-scrive",
    cantiere: ["Q2", "Q3"],
    title: "B7: «x», rotella sulla griglia, «y»",
    expected: "fuoco ancora nel campo della cella, bozza «xy»",
    run: async (page) => {
      await pick(page, "B7");
      await page.keyboard.type("x");
      await settle(page);
      const { x, y } = await centerOf(page, ".pane.focus .grid-viewport");
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, 200);
      await settle(page);
      await page.keyboard.type("y");
      await settle(page);
      const s = await readState(page);
      return { ok: s.focusInEditor && s.editorText === "xy", seen: seen(s), state: s };
    },
  },
  {
    id: "d38-invio-scende",
    cantiere: "Q4",
    title: "da B7: 7 Invio 5 Invio",
    expected: "dopo il primo Invio B8, dopo il secondo B9, editor chiuso",
    run: async (page) => {
      await pick(page, "B7");
      await page.keyboard.type("7");
      await page.keyboard.press("Enter");
      await settle(page);
      const first = await readState(page);
      await page.keyboard.type("5");
      await page.keyboard.press("Enter");
      await settle(page);
      const s = await readState(page);
      return {
        ok: first.name === "B8" && s.name === "B9" && !s.editorOpen,
        seen: `dopo 7 Invio: ${seen(first)}; dopo 5 Invio: ${seen(s)}`,
        state: s,
      };
    },
  },
  {
    id: "d38-invio-senza-bozza",
    cantiere: "Q4",
    title: "B7 scelta, Invio senza aver scritto",
    expected: "cella attiva B8, editor chiuso",
    run: async (page) => {
      await pick(page, "B7");
      await page.keyboard.press("Enter");
      await settle(page);
      const s = await readState(page);
      return { ok: s.name === "B8" && !s.editorOpen, seen: seen(s), state: s };
    },
  },
  {
    id: "d39-tab-conferma",
    cantiere: "Q4",
    title: "B7: «7», Tab",
    expected: "editor chiuso, cella attiva C7",
    run: async (page) => {
      await pick(page, "B7");
      await page.keyboard.type("7");
      await page.keyboard.press("Tab");
      await settle(page);
      const s = await readState(page);
      return { ok: !s.editorOpen && s.name === "C7", seen: seen(s), state: s };
    },
  },
  {
    id: "d39-giu-conferma",
    cantiere: "Q4",
    title: "B7: «7», ↓",
    expected: "editor chiuso, cella attiva B8",
    run: async (page) => {
      await pick(page, "B7");
      await page.keyboard.type("7");
      await page.keyboard.press("ArrowDown");
      await settle(page);
      const s = await readState(page);
      return { ok: !s.editorOpen && s.name === "B8", seen: seen(s), state: s };
    },
  },
  {
    id: "d39-alt-invio-a-capo",
    cantiere: "Q4",
    title: "B7: «a», Alt+Invio, «b»",
    expected: "editor aperto con due righe «a» e «b», fuoco nel campo",
    run: async (page) => {
      await pick(page, "B7");
      await page.keyboard.type("a");
      await page.keyboard.press("Alt+Enter");
      await page.keyboard.type("b");
      await settle(page);
      const s = await readState(page);
      return {
        ok: s.editorOpen && s.focusInEditor && s.editorLines.length === 2 && s.editorText === "a\nb",
        seen: `${seen(s)} (${s.editorLines.length} righe)`,
        state: s,
      };
    },
  },
  {
    id: "d40-cella-attiva-all-ancora",
    cantiere: "Q5",
    title: "clic su B2, Maiusc+clic su C5, «z»",
    expected: "cella attiva B2 dopo l'estensione, editor aperto su B2",
    run: async (page) => {
      await pick(page, "B2");
      const { x, y } = await centerOf(page, cellSelector("C5"));
      await page.keyboard.down("Shift");
      await page.mouse.click(x, y);
      await page.keyboard.up("Shift");
      await settle(page);
      const extended = await readState(page);
      await page.keyboard.type("z");
      await settle(page);
      const s = await readState(page);
      const b2 = at("B2");
      const onB2 = s.editorCell?.row === b2.row && s.editorCell?.column === b2.column;
      return {
        ok: extended.name === "B2" && s.editorOpen && onB2,
        seen: `dopo Maiusc+clic: cella ${extended.name}; dopo «z»: ${seen(s)}`,
        state: s,
      };
    },
  },
  {
    id: "d45-un-rettangolo",
    cantiere: "Q9",
    title: "clic su B2, Maiusc+clic su C5, col fuoco da tastiera",
    expected: "un rettangolo solo da B2 a C5, nessun anello sul riquadro, il bordo sulla cella attiva, la tacca dopo la colonna D nascosta",
    run: async (page) => {
      await pick(page, "B2");
      const { x, y } = await centerOf(page, cellSelector("C5"));
      await page.keyboard.down("Shift");
      await page.mouse.click(x, y);
      await page.keyboard.up("Shift");
      await page.keyboard.press("Shift+ArrowDown");
      await page.keyboard.press("Shift+ArrowUp");
      await settle(page);
      const b2 = cellSelector("B2");
      const c5 = cellSelector("C5");
      const look = await page.evaluate(({ b2, c5 }) => {
        const box = (element) => element?.getBoundingClientRect();
        const marks = [...document.querySelectorAll(".grid-selection")];
        const mark = box(marks[0]);
        const first = box(document.querySelector(b2));
        const last = box(document.querySelector(c5));
        const near = (a, b) => Math.abs(a - b) <= 2;
        const viewport = document.querySelector(".grid-viewport");
        const ring = getComputedStyle(viewport);
        const active = document.querySelector(".grid-cell.active");
        return {
          marks: marks.length,
          covers: Boolean(mark && first && last && near(mark.left, first.left) && near(mark.top, first.top)
            && near(mark.right, last.right) && near(mark.bottom, last.bottom)),
          ring: ring.boxShadow !== "none" || ring.outlineStyle !== "none",
          activeBorder: active ? getComputedStyle(active).boxShadow !== "none" : false,
          hiddenTick: [...document.querySelectorAll(".grid-column-header.after-hidden")].map((header) => header.textContent),
        };
      }, { b2, c5 });
      return {
        ok: look.marks === 1 && look.covers && !look.ring && look.activeBorder && look.hiddenTick.includes("E"),
        seen: `rettangoli ${look.marks}, copre B2:C5 ${look.covers}, anello ${look.ring}, bordo della cella attiva ${look.activeBorder}, tacche ${look.hiddenTick.join(" ") || "nessuna"}`,
      };
    },
  },
  {
    id: "d43-misura-delle-colonne",
    cantiere: "Q12",
    title: "puntatore sul bordo fra le intestazioni B e C, trascina di 40 px, poi doppio clic",
    expected: "cursore di misura, guida e misura dal vivo, un solo home.columnWidth al rilascio, home.autofitColumnWidth al doppio clic",
    run: async (page) => {
      const edgeOf = () => page.evaluate(() => {
        const header = [...document.querySelectorAll(".pane.focus .grid-column-header")].find((element) => element.textContent === "B");
        const box = header.getBoundingClientRect();
        return { x: box.right - 1, y: box.top + box.height / 2 };
      });
      const edge = await edgeOf();
      const before = await page.evaluate(() => window.bench.calls.length);
      await page.mouse.move(edge.x, edge.y);
      await settle(page);
      const cursor = await page.evaluate(() => getComputedStyle(document.querySelector(".pane.focus .grid-viewport")).cursor);
      await page.mouse.down();
      await page.mouse.move(edge.x + 20, edge.y);
      await page.mouse.move(edge.x + 40, edge.y);
      const live = await page.evaluate(() => ({
        guide: Boolean(document.querySelector(".pane.focus .grid-resize-guide")),
        label: document.querySelector(".pane.focus .grid-resize-label")?.textContent ?? "",
      }));
      await page.mouse.up();
      await settle(page);
      // Il finto non serve la misura: la colonna resta com'era, e l'avviso del
      // rifiuto sposta la griglia. Il bordo si rilegge.
      const again = await edgeOf();
      await page.mouse.dblclick(again.x, again.y);
      await settle(page);
      const given = await page.evaluate((start) => window.bench.calls.slice(start)
        .filter((call) => call.gate === "gridBytesCommand")
        .map((call) => call.args[1]?.command?.id), before);
      const ok = cursor === "col-resize" && live.guide && /px\)$/.test(live.label)
        && given[0] === "home.columnWidth" && given.filter((id) => id === "home.columnWidth").length === 1
        && given.includes("home.autofitColumnWidth");
      return { ok, seen: `cursore ${cursor}, guida ${live.guide}, «${live.label}», comandi: ${given.join(" ") || "nessuno"}` };
    },
  },
  {
    id: "d45-piu-intervalli",
    cantiere: "Q13",
    title: "clic su B2, Ctrl+clic su C5, poi un clic semplice su E2",
    expected: "due rettangoli, B2 e C5 scelte insieme; il clic semplice torna a un intervallo solo",
    run: async (page) => {
      await pick(page, "B2");
      const { x, y } = await centerOf(page, cellSelector("C5"));
      await page.keyboard.down("Control");
      await page.mouse.click(x, y);
      await page.keyboard.up("Control");
      await settle(page);
      const count = () => page.evaluate(() => document.querySelectorAll(".pane.focus .grid-selection").length);
      const chosen = (a1s) => page.evaluate((selectors) => selectors.map((selector) => document.querySelector(selector)?.classList.contains("selected")), a1s);
      const two = await count();
      const both = await chosen([cellSelector("B2"), cellSelector("C5")]);
      await pick(page, "E2");
      const after = await count();
      return {
        ok: two === 2 && both.every(Boolean) && after === 0,
        seen: `rettangoli ${two}, B2 e C5 scelte ${both.join(" ")}, dopo il clic ${after}`,
      };
    },
  },
  {
    id: "d41-un-valore-riempie",
    cantiere: "Q6",
    title: "B2:C3 scelta da C3 con Maiusc+frecce, incolla «x»",
    expected: "«x» scritta in B2, B3, C2 e C3 in una scrittura",
    run: async (page) => {
      await pick(page, "C3");
      await page.keyboard.press("Shift+ArrowUp");
      await page.keyboard.press("Shift+ArrowLeft");
      await settle(page);
      const before = (await readState(page)).calls;
      await pasteInto(page, { "text/plain": "x\n" });
      await settle(page);
      const patches = (await patchesSince(page, before)).sort();
      const want = ["1,1=x", "1,2=x", "2,1=x", "2,2=x"];
      return {
        ok: JSON.stringify(patches) === JSON.stringify(want),
        seen: `scritte: ${patches.join(" ") || "niente"}`,
      };
    },
  },
  {
    id: "d41-html-di-un-foglio",
    cantiere: "Q6",
    title: "A10 scelta, incolla una tabella HTML (come da Excel) col suo testo accanto",
    expected: "le celle della tabella HTML, anche quelle a capo",
    run: async (page) => {
      await pick(page, "A10");
      const before = (await readState(page)).calls;
      await pasteInto(page, {
        "text/plain": "uno due\t3\n",
        "text/html": "<table><tr><td>uno<br>due</td><td>3</td></tr></table>",
      });
      await settle(page);
      const patches = (await patchesSince(page, before)).sort();
      const want = ["9,0=uno\ndue", "9,1=3"];
      return {
        ok: JSON.stringify(patches) === JSON.stringify(want),
        seen: `scritte: ${patches.map((p) => p.replace(/\n/g, "⏎")).join(" ") || "niente"}`,
      };
    },
  },
  {
    id: "d41-taglia-formiche",
    cantiere: "Q6",
    title: "B2 scelta, Ctrl+X vero, poi Esc",
    expected: "dopo Ctrl+X le formiche e niente svuotato; dopo Esc niente formiche",
    run: async (page) => {
      await pick(page, "B2");
      const before = (await readState(page)).calls;
      await page.keyboard.press("Control+x");
      await settle(page);
      const marked = await page.locator(".pane.focus .grid-cut-mark").count();
      const cleared = await patchesSince(page, before);
      await page.keyboard.press("Escape");
      await settle(page);
      const after = await page.locator(".pane.focus .grid-cut-mark").count();
      return {
        ok: marked === 1 && cleared.length === 0 && after === 0,
        seen: `formiche dopo Ctrl+X: ${marked}, scritte: ${cleared.length}, formiche dopo Esc: ${after}`,
      };
    },
  },
  {
    id: "d41-appunti-interni",
    cantiere: "Q7",
    title: "B2 scelta, copia; C8 scelta, incolla lo stesso testo",
    expected: "un solo fub.pasteFrom con sorgente B2 sulla selezione C8, nessuna scrittura di input",
    run: async (page) => {
      await pick(page, "B2");
      const text = await page.evaluate(() => {
        const transfer = new DataTransfer();
        document.activeElement?.dispatchEvent(new ClipboardEvent("copy", { clipboardData: transfer, bubbles: true, cancelable: true }));
        return transfer.getData("text/plain");
      });
      await pick(page, "C8");
      const before = (await readState(page)).calls;
      await pasteInto(page, { "text/plain": text });
      await settle(page);
      const given = await page.evaluate((start) => window.bench.calls.slice(start)
        .filter((call) => call.gate === "gridBytesCommand")
        .map((call) => call.args[1]?.command), before);
      const patches = await patchesSince(page, before);
      const paste = given.find((command) => command?.id === "fub.pasteFrom");
      const params = paste ? JSON.parse(paste.params) : null;
      return {
        ok: given.length === 1 && params?.source === "B2" && params?.move === false && paste.selection === "C8" && patches.length === 0,
        seen: `comandi: ${given.map((command) => `${command?.id} ${command?.params} su ${command?.selection}`).join("; ") || "nessuno"}, scritte: ${patches.length}`,
      };
    },
  },
  {
    id: "q14-sposta-col-bordo",
    cantiere: "Q14",
    title: "B2 scelta, puntatore sul bordo sinistro di B2, trascina fino a B9",
    expected: "cursore di spostamento, il contorno durante il gesto, un fub.pasteFrom con move al rilascio, la selezione su B9",
    run: async (page) => {
      await pick(page, "B2");
      const edge = await page.evaluate((selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { x: box.left + 1, y: box.top + box.height / 2 };
      }, cellSelector("B2"));
      await page.mouse.move(edge.x, edge.y);
      await settle(page);
      const cursor = await page.evaluate(() => getComputedStyle(document.querySelector(".pane.focus .grid-viewport")).cursor);
      const before = (await readState(page)).calls;
      const drop = await centerOf(page, cellSelector("B9"));
      await page.mouse.down();
      await page.mouse.move(edge.x, (edge.y + drop.y) / 2);
      await page.mouse.move(drop.x, drop.y);
      const preview = await page.locator(".pane.focus .grid-move-preview").count();
      await page.mouse.up();
      await settle(page);
      const s = await readState(page);
      const given = await page.evaluate((start) => window.bench.calls.slice(start)
        .filter((call) => call.gate === "gridBytesCommand")
        .map((call) => call.args[1]?.command), before);
      const move = given.find((command) => command?.id === "fub.pasteFrom");
      const params = move ? JSON.parse(move.params) : null;
      return {
        ok: cursor === "move" && preview === 1 && params?.source === "B2" && params?.move === true && move.selection === "B9",
        seen: `cursore ${cursor}, contorno ${preview}, comandi: ${given.map((command) => `${command?.id} ${command?.params} su ${command?.selection}`).join("; ") || "nessuno"}, cella ${s.name}`,
      };
    },
  },
  {
    id: "d44-formula-col-puntatore",
    cantiere: "Q10",
    title: "B7 scelta: «=1+», clic su B2 e trascina fino a B3, poi ↓ con Maiuscolo",
    expected: "«=1+B2:B4» nella cella ancora aperta su B7, col fuoco, un contorno colorato sul foglio",
    run: async (page) => {
      await pick(page, "B7");
      await page.keyboard.type("=1+");
      await settle(page);
      const from = await centerOf(page, cellSelector("B2"));
      const to = await centerOf(page, cellSelector("B3"));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y);
      await page.mouse.up();
      await page.keyboard.press("Shift+ArrowDown");
      await settle(page);
      const s = await readState(page);
      const marks = await page.locator(".pane.focus .grid-formula-ref-1").count();
      return {
        ok: s.editorText === "=1+B2:B4" && s.editorOpen && s.focusInEditor && s.name === "B7" && marks === 1,
        seen: `testo «${s.editorText}», aperto ${s.editorOpen}, fuoco ${s.focus}, cella ${s.name}, contorni ${marks}`,
      };
    },
  },
  {
    id: "d46-composizione",
    cantiere: "Q11",
    title: "B7 scelta: tasto «Process» vero, composizione dell'IME «か», conferma «漢»",
    expected: "editor aperto su B7 con «漢», fuoco nel campo",
    run: async (page) => {
      await pick(page, "B7");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Process", code: "KeyK", windowsVirtualKeyCode: 229 });
      await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 });
      await cdp.send("Input.insertText", { text: "漢" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Process", code: "KeyK", windowsVirtualKeyCode: 229 });
      await cdp.detach();
      await settle(page);
      const s = await readState(page);
      return { ok: s.editorOpen && s.editorText === "漢" && s.focusInEditor, seen: seen(s), state: s };
    },
  },
  {
    id: "d46-tasto-morto",
    cantiere: "Q11",
    title: "B7 scelta: tasto morto «´» vero, poi «e»",
    expected: "editor aperto su B7 con «é»",
    run: async (page) => {
      await pick(page, "B7");
      const cdp = await page.context().newCDPSession(page);
      // Il tasto morto apre una composizione col segno, la lettera la chiude.
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Dead", code: "Quote", windowsVirtualKeyCode: 222 });
      await cdp.send("Input.imeSetComposition", { text: "´", selectionStart: 1, selectionEnd: 1 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Dead", code: "Quote", windowsVirtualKeyCode: 222 });
      await cdp.send("Input.insertText", { text: "é" });
      await cdp.detach();
      await settle(page);
      const s = await readState(page);
      return { ok: s.editorOpen && s.editorText === "é" && s.focusInEditor, seen: seen(s), state: s };
    },
  },
  {
    id: "d47-pagina-vera",
    cantiere: "Q15",
    title: "B3 scelta, PagGiù, poi PagSu",
    expected: "la cella attiva scende di una schermata e resta allo stesso punto dello schermo; PagSu torna a B3",
    run: async (page) => {
      await pick(page, "B3");
      const top = () => page.evaluate(() => document.querySelector(".pane.focus .grid-cell.active")?.getBoundingClientRect().top ?? null);
      const y0 = await top();
      await page.keyboard.press("PageDown");
      await settle(page);
      const down = await readState(page);
      const y1 = await top();
      await page.keyboard.press("PageUp");
      await settle(page);
      const up = await readState(page);
      const rows = (down.activeCell?.row ?? 0) - at("B3").row;
      return {
        ok: rows > 5 && y0 !== null && y1 !== null && Math.abs(y1 - y0) < 2 && up.name === "B3",
        seen: `PagGiù: ${down.name} (${rows} righe), y ${y0} → ${y1}; PagSu: ${up.name}`,
      };
    },
  },
  {
    id: "d42-intestazioni-durante-scorrimento",
    cantiere: "Q8",
    title: "scorrimento filmato (Input.synthesizeScrollGesture) di 1200 px in giù e di nuovo su",
    expected: "la riga delle intestazioni A B C in ogni fotogramma",
    run: (page, { shotPath }) => scrollFilm(page, shotPath),
  },
  // **Il piano a strati** (griglia T1), sulla cartella grande con la riga 1
  // e la colonna A bloccate: le fasce ferme stanno ferme da sé, e i segni si
  // tagliano per zona.
  {
    id: "g1-colonna-ferma",
    cantiere: "G1",
    scene: LARGE_SCENE_ID,
    title: "scorrimento filmato (Input.synthesizeScrollGesture) di 1200 px a destra e di nuovo indietro",
    expected: "la colonna A e le intestazioni delle righe, ritagliate, uguali al primo fotogramma in ogni fotogramma",
    run: (page, { shotPath }) => frozenColumnFilm(page, shotPath),
  },
  {
    id: "g1-intervallo-oltre-il-blocco",
    cantiere: "G1",
    scene: LARGE_SCENE_ID,
    title: "C1:E9 scelto col mouse, poi 100 px a destra e 300 px in giù con la rotella",
    expected: "il rettangolo, sommato sulle zone, alto quanto le righe 1–9 meno ciò che sta sotto la riga bloccata; nessun pezzo sopra una cella della colonna A o un'intestazione di riga",
    run: async (page) => {
      await pick(page, "C1");
      const { x, y } = await centerOf(page, cellSelector("E9"));
      await page.keyboard.down("Shift");
      await page.mouse.click(x, y);
      await page.keyboard.up("Shift");
      await settle(page);
      const viewport = await centerOf(page, ".pane.focus .grid-viewport");
      await page.mouse.move(viewport.x, viewport.y);
      await page.mouse.wheel(100, 0);
      await settle(page);
      await page.mouse.wheel(0, 300);
      await settle(page, 500);
      const look = await page.evaluate(({ c1, c9 }) => {
        const viewport = document.querySelector(".pane.focus .grid-viewport");
        const plane = viewport.querySelector(".grid-plane");
        const v = viewport.getBoundingClientRect();
        const bands = {
          top: parseFloat(plane.style.getPropertyValue("--grid-top-h")),
          left: parseFloat(plane.style.getPropertyValue("--grid-left-w")),
        };
        // I segni non si toccano col puntatore: per leggerli con
        // `elementsFromPoint` lo si accende un momento.
        const probe = document.createElement("style");
        probe.textContent = ".grid-selection { pointer-events: auto !important; }";
        document.head.append(probe);
        const covers = (element) => element.matches(".grid-cell, .grid-row-header, .grid-column-header, .grid-corner, .grid-freeze");
        // In (x, y) si vede un pezzo del rettangolo se sta sopra a ogni cella
        // e intestazione che ci passa.
        const markOnTop = (x, y) => {
          for (const element of document.elementsFromPoint(x, y)) {
            if (element.classList.contains("grid-selection")) return true;
            if (covers(element)) return false;
          }
          return false;
        };
        // L'altezza vista, su una verticale dentro la colonna D.
        const d = document.querySelector('.pane.focus .grid-cell[data-row="1"][data-column="3"]')?.getBoundingClientRect();
        const column = d ? d.left + d.width / 2 : v.left + bands.left + 40;
        let seenHeight = 0;
        for (let y = Math.floor(v.top); y < v.top + viewport.clientHeight; y += 1) if (markOnTop(column, y + 0.5)) seenHeight += 1;
        // L'altezza attesa: la riga 1 fino al filo del blocco, più le righe
        // 2–9 per la parte sotto la testa.
        const first = document.querySelector(c1).getBoundingClientRect();
        const last = document.querySelector(c9)?.getBoundingClientRect();
        const headEnd = v.top + bands.top;
        const top = Math.max(0, Math.min(first.bottom, headEnd - 1) - first.top);
        // La riga 2 comincia nel piano dove finisce la testa; C9 può non
        // essere più disegnata.
        const bodyStart = v.top + bands.top - viewport.scrollTop;
        const bodyEnd = last ? last.bottom : bodyStart + 8 * first.height;
        const body = Math.max(0, Math.min(bodyEnd, v.top + viewport.clientHeight) - Math.max(bodyStart, headEnd));
        // Sopra la colonna A e le intestazioni delle righe, lungo tutta la
        // finestra, nessun pezzo.
        const over = [];
        const xs = [v.left + 4, v.left + bands.left / 2, v.left + bands.left - 4];
        for (const x of xs) {
          for (let y = Math.floor(v.top); y < v.top + viewport.clientHeight; y += 2) {
            if (markOnTop(x, y + 0.5)) over.push(`${Math.round(x - v.left)},${Math.round(y - v.top)}`);
          }
        }
        probe.remove();
        return {
          marks: document.querySelectorAll(".pane.focus .grid-selection").length,
          seenHeight,
          expected: Math.round(top + body),
          over: over.slice(0, 6),
          overCount: over.length,
          scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
        };
      }, { c1: cellSelector("C1"), c9: cellSelector("C9") });
      return {
        ok: look.scroll.left > 0 && look.scroll.top > 0 && look.expected > 0
          && Math.abs(look.seenHeight - look.expected) <= 2 && look.overCount === 0,
        seen: `scorso ${look.scroll.left}, ${look.scroll.top}: ${look.marks} pezzi, alto ${look.seenHeight} px su ${look.expected} attesi; sopra la colonna ferma in ${look.overCount} punti${look.over.length ? ` (${look.over.join(" ")})` : ""}`,
        look,
      };
    },
  },
  {
    id: "g1-quadratino-intero",
    cantiere: "G1",
    scene: LARGE_SCENE_ID,
    title: "il quadratino su A5 (sul filo della colonna bloccata) e su B1 (sul filo della riga bloccata), prima e dopo 40 px di scorrimento",
    expected: "un elemento solo, 8 × 8, intero e col centro sul filo; così anche dopo 40 px a destra (A5) e in giù (B1)",
    run: async (page) => {
      const handle = () => page.evaluate(() => {
        const viewport = document.querySelector(".pane.focus .grid-viewport");
        const plane = viewport.querySelector(".grid-plane");
        const v = viewport.getBoundingClientRect();
        const bands = {
          top: parseFloat(plane.style.getPropertyValue("--grid-top-h")),
          left: parseFloat(plane.style.getPropertyValue("--grid-left-w")),
        };
        const handles = [...document.querySelectorAll(".pane.focus .grid-fill-handle")];
        const box = handles[0]?.getBoundingClientRect();
        // Intero: ai quattro angoli, appena dentro, il quadratino sta sopra
        // a tutto.
        const whole = Boolean(box) && [[1, 1], [box.width - 1, 1], [1, box.height - 1], [box.width - 1, box.height - 1]]
          .every(([dx, dy]) => document.elementsFromPoint(box.left + dx, box.top + dy)[0] === handles[0]);
        return {
          count: handles.length,
          size: box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "niente",
          whole,
          // Il centro, rispetto all'inizio dei fili del blocco.
          x: box ? Math.round((box.left + box.width / 2 - v.left - bands.left) * 2) / 2 : null,
          y: box ? Math.round((box.top + box.height / 2 - v.top - bands.top) * 2) / 2 : null,
        };
      });
      const viewport = await centerOf(page, ".pane.focus .grid-viewport");
      const report = [];
      let ok = true;
      for (const [a1, line, dx, dy] of [["A5", "x", 40, 0], ["B1", "y", 0, 40]]) {
        await page.evaluate(() => {
          const v = document.querySelector(".pane.focus .grid-viewport");
          v.scrollLeft = 0;
          v.scrollTop = 0;
        });
        await settle(page);
        await pick(page, a1);
        const still = await handle();
        await page.mouse.move(viewport.x, viewport.y);
        await page.mouse.wheel(dx, dy);
        await settle(page, 500);
        const moved = await handle();
        const good = (h) => h.count === 1 && h.size === "8×8" && h.whole && Math.abs(h[line]) <= 1;
        ok = ok && good(still) && good(moved);
        report.push(`${a1}: ${still.count} elementi ${still.size}${still.whole ? " intero" : " tagliato"}, centro dal filo ${still[line]} px; dopo ${dx || dy} px ${moved.count} elementi ${moved.size}${moved.whole ? " intero" : " tagliato"}, centro dal filo ${moved[line]} px`);
      }
      return { ok, seen: report.join("; ") };
    },
  },
];

/// d42: filma uno scorrimento vero e confronta, fotogramma per fotogramma, il
/// nastro delle intestazioni di colonna con quello di prima.
async function scrollFilm(page, shotPath) {
  const strip = await page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const row = viewport.querySelector(".grid-column-header-row");
    const v = viewport.getBoundingClientRect();
    const h = row.getBoundingClientRect();
    // Il nastro dentro la finestra della griglia, senza la barra di
    // scorrimento a destra.
    return {
      x: Math.round(v.left),
      y: Math.round(v.top),
      width: Math.round(viewport.clientWidth),
      height: Math.round(h.height),
      centerX: Math.round(v.left + v.width / 2),
      centerY: Math.round(v.top + v.height / 2),
    };
  });
  const crop = (png, dy = 0) => {
    const out = new PNG({ width: strip.width, height: strip.height });
    PNG.bitblt(png, out, strip.x, strip.y + dy, strip.width, strip.height, 0, 0);
    return out;
  };
  // Un secondo nastro, sotto le intestazioni: deve cambiare, o il filmato non
  // ha visto lo scorrimento e non prova niente.
  const BODY_DY = strip.height * 3;
  const first = PNG.sync.read(await page.screenshot());
  const reference = crop(first);
  const bodyReference = crop(first, BODY_DY);

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push(frame.data);
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  // Il DOM, a ogni fotogramma: la riga delle intestazioni c'è, e dov'è
  // rispetto alla finestra. Dice se il buco è del DOM o della pittura.
  await page.evaluate(() => {
    window.__gridFilm = [];
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const top = viewport.getBoundingClientRect().top;
    const tick = () => {
      if (!window.__gridFilm) return;
      const row = viewport.querySelector(".grid-column-header-row");
      window.__gridFilm.push(row ? Math.round(row.getBoundingClientRect().top - top) : null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  // In giù e di nuovo su: il buco non si apre a ogni corsa (dipende da chi
  // dipinge lo scorrimento in quel momento), e due tratti lo colgono più
  // spesso di uno. Si torna in cima, così l'ultimo fotogramma si confronta
  // con la prima foto.
  let scrolled = 0;
  for (const yDistance of [-1200, 1200]) {
    await cdp.send("Input.synthesizeScrollGesture", {
      x: strip.centerX,
      y: strip.centerY,
      yDistance,
      speed: 1600,
      gestureSourceType: "mouse",
    });
    await settle(page, 300);
    scrolled = Math.max(scrolled, await page.evaluate(() => document.querySelector(".pane.focus .grid-viewport").scrollTop));
  }
  await cdp.send("Page.stopScreencast");
  const domTops = await page.evaluate(() => {
    const film = window.__gridFilm;
    window.__gridFilm = null;
    return film;
  });
  await cdp.detach();

  let worst = { index: -1, ratio: 0, png: null };
  let missing = 0;
  let bodyMoved = 0;
  const ratios = [];
  for (const [index, data] of frames.entries()) {
    const png = PNG.sync.read(Buffer.from(data, "base64"));
    if (png.width < strip.x + strip.width || png.height < strip.y + strip.height) continue;
    const now = crop(png);
    const different = pixelmatch(reference.data, now.data, null, strip.width, strip.height, { threshold: 0.1 });
    const ratio = different / (strip.width * strip.height);
    ratios.push(Math.round(ratio * 1000) / 1000);
    const body = crop(png, BODY_DY);
    if (pixelmatch(bodyReference.data, body.data, null, strip.width, strip.height, { threshold: 0.1 }) > 0) bodyMoved += 1;
    if (ratio > HEADER_DIFF_LIMIT) missing += 1;
    if (ratio > worst.ratio) worst = { index, ratio, png };
  }
  if (worst.png) await writeFile(shotPath, PNG.sync.write(worst.png));
  const domMissing = domTops.filter((top) => top === null || top !== 0).length;
  if (frames.length < 3) {
    return { skip: `lo screencast ha dato ${frames.length} fotogrammi: troppo pochi per dire qualcosa`, frames: frames.length };
  }
  // A scorrimento finito le intestazioni sono dov'erano: se l'ultimo
  // fotogramma non somiglia alla prima foto, a sbagliare è la misura (il
  // ritaglio, la scala dei fotogrammi), non la griglia.
  if (bodyMoved === 0) {
    return { skip: `nessuno dei ${frames.length} fotogrammi mostra le celle in movimento: il filmato non ha visto lo scorrimento`, frames: frames.length };
  }
  const rest = ratios.at(-1);
  if (rest > HEADER_DIFF_LIMIT) {
    return {
      ok: false,
      seen: `la misura non torna: anche a scorrimento finito il nastro differisce del ${(rest * 100).toFixed(1)}% dalla prima foto`,
      ratios,
    };
  }
  return {
    ok: missing === 0 && scrolled > 0,
    seen: `${frames.length} fotogrammi, scorso fino a ${scrolled} px e ritorno: celle in movimento in ${bodyMoved}, intestazioni assenti o fuori posto in ${missing} (peggiore n. ${worst.index}, ${(worst.ratio * 100).toFixed(1)}% del nastro diverso; a riposo ${(rest * 100).toFixed(1)}%); nel DOM fuori posto in ${domMissing} di ${domTops.length} fotogrammi`,
    frames: frames.length,
    missing,
    worstRatio: worst.ratio,
    ratios,
    domTops,
    shotTaken: Boolean(worst.png),
  };
}

/// G1: filma uno scorrimento vero a destra e indietro, e confronta,
/// fotogramma per fotogramma, la colonna ferma (le intestazioni delle righe e
/// la colonna A bloccata, fino al filo) con quella del primo fotogramma, a
/// riposo. Deve restare uguale al pixel: è ferma da sé, senza script che la
/// rincorra. Il riferimento è un fotogramma e non una foto della pagina: la
/// foto smussa gli angoli tondi del riquadro in un altro modo. Il ritaglio
/// lascia fuori l'angolo tondo in basso del riquadro: Chromium lo smussa in
/// un modo da fermo e in un altro quando scorre, e non è la colonna ferma.
async function frozenColumnFilm(page, shotPath) {
  const band = await page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const plane = viewport.querySelector(".grid-plane");
    const v = viewport.getBoundingClientRect();
    let corner = 0;
    for (let el = viewport; el && el !== document.body; el = el.parentElement) {
      if (Math.abs(el.getBoundingClientRect().bottom - v.bottom) > 2) continue;
      corner = Math.max(corner, parseFloat(getComputedStyle(el).borderBottomLeftRadius) || 0);
    }
    return {
      x: Math.round(v.left),
      y: Math.round(v.top),
      width: Math.round(parseFloat(plane.style.getPropertyValue("--grid-left-w"))),
      height: Math.round(viewport.clientHeight - Math.max(0, corner - (v.height - viewport.clientHeight))),
      centerX: Math.round(v.left + v.width / 2),
      centerY: Math.round(v.top + v.height / 2),
    };
  });
  const crop = (png, dx = 0) => {
    const out = new PNG({ width: band.width, height: band.height });
    PNG.bitblt(png, out, band.x + dx, band.y, band.width, band.height, 0, 0);
    return out;
  };
  // Un secondo ritaglio, accanto alla colonna ferma: deve cambiare, o il
  // filmato non ha visto lo scorrimento e non prova niente.
  const BODY_DX = band.width + 8;
  // Il puntatore sta già dove parte il gesto: col passaggio sul riquadro
  // compaiono le sue barre di scorrimento, e non devono comparire a metà.
  await page.mouse.move(band.centerX, band.centerY);
  await settle(page, 400);

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push(frame.data);
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  // Il primo fotogramma arriva prima del gesto.
  for (let wait = 0; frames.length === 0 && wait < 20; wait += 1) await settle(page, 50);
  let scrolled = 0;
  for (const xDistance of [-1200, 1200]) {
    await cdp.send("Input.synthesizeScrollGesture", {
      x: band.centerX,
      y: band.centerY,
      xDistance,
      yDistance: 0,
      speed: 1600,
      gestureSourceType: "mouse",
    });
    await settle(page, 300);
    scrolled = Math.max(scrolled, await page.evaluate(() => document.querySelector(".pane.focus .grid-viewport").scrollLeft));
  }
  await cdp.send("Page.stopScreencast");
  await cdp.detach();

  const pngs = frames
    .map((data) => PNG.sync.read(Buffer.from(data, "base64")))
    .filter((png) => png.width >= band.x + BODY_DX + band.width && png.height >= band.y + band.height);
  if (pngs.length < 3) {
    return { skip: `lo screencast ha dato ${pngs.length} fotogrammi utili: troppo pochi per dire qualcosa`, frames: frames.length };
  }
  const reference = crop(pngs[0]);
  const bodyReference = crop(pngs[0], BODY_DX);
  let different = 0;
  let bodyMoved = 0;
  let worst = { index: -1, pixels: 0, png: null };
  for (const [index, png] of pngs.entries()) {
    const pixels = pixelmatch(reference.data, crop(png).data, null, band.width, band.height, { threshold: 0.1 });
    if (pixels > 0) different += 1;
    if (pixels > worst.pixels) worst = { index, pixels, png };
    if (pixelmatch(bodyReference.data, crop(png, BODY_DX).data, null, band.width, band.height, { threshold: 0.1 }) > 0) bodyMoved += 1;
  }
  await writeFile(shotPath, PNG.sync.write(worst.png ?? pngs.at(-1)));
  if (bodyMoved === 0) {
    return { skip: `nessuno dei ${pngs.length} fotogrammi mostra le celle in movimento: il filmato non ha visto lo scorrimento`, frames: pngs.length };
  }
  return {
    ok: different === 0 && scrolled > 0,
    seen: `${pngs.length} fotogrammi, scorso fino a ${scrolled} px e ritorno: celle in movimento in ${bodyMoved}, colonna ferma diversa dal primo fotogramma in ${different}${worst.png ? ` (peggiore n. ${worst.index}, ${worst.pixels} pixel)` : ""}`,
    frames: pngs.length,
    different,
    worstPixels: worst.pixels,
  };
}

// ---------------------------------------------------------------------------
// La corsa.
// ---------------------------------------------------------------------------

const cantieri = (control) => (Array.isArray(control.cantiere) ? control.cantiere : [control.cantiere]);
const isOn = (control) => cantieri(control).every((sigla) => ACCESI.has(sigla));

async function runControl(stage, scene, control) {
  const page = await openPage(stage.browser, "dark", { clock: false });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
  const shotPath = join(SHOTS, `${control.id}.png`);
  const row = { id: control.id, cantiere: cantieri(control).join("+"), acceso: isOn(control), title: control.title, expected: control.expected };
  try {
    await prepareScene(page, scene, "dark", stage.base, sceneUrl);
    await gridSteady(page);
    const result = await control.run(page, { shotPath });
    Object.assign(row, result);
    if (!result.skip && control.id !== "d42-intestazioni-durante-scorrimento" && control.id !== "g1-colonna-ferma") {
      await page.screenshot({ path: shotPath });
    }
  } catch (error) {
    row.ok = false;
    row.seen = `il gesto non si è fatto: ${String(error?.message ?? error).split("\n")[0]}`;
    await page.screenshot({ path: shotPath }).catch(() => {});
  } finally {
    if (pageErrors.length) row.pageErrors = pageErrors;
    await page.context().close();
  }
  row.outcome = row.skip ? "saltato" : row.ok ? "passa" : row.acceso ? "FALLISCE" : `atteso dopo ${row.cantiere}`;
  return row;
}

async function main() {
  const sceneOf = (control) => {
    const id = control.scene ?? SCENE_ID;
    const scene = [...SCENE, ...GESTURE_SCENE].find((s) => s.id === id);
    if (!scene) throw new Error(`la scena ${id} non c'è in scene.mjs`);
    return scene;
  };
  const controls = CONTROLS.filter((c) => !only || only.some((prefix) => c.id.startsWith(prefix)));
  if (controls.length === 0) throw new Error(`nessun controllo per --only=${only?.join(",")}`);
  for (const control of controls) sceneOf(control);
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const started = Date.now();
  const report = { scenes: [...new Set(controls.map((control) => control.scene ?? SCENE_ID))], accesi: [...ACCESI], controls: [] };
  const stage = await openStage();
  try {
    for (const control of controls) {
      const row = await runControl(stage, sceneOf(control), control);
      report.controls.push(row);
      const mark = row.outcome === "passa" ? "✓" : row.outcome === "FALLISCE" ? "✗" : "·";
      console.log(`${mark} [${row.cantiere}] ${row.id}: ${row.outcome}`);
      if (row.skip) console.log(`    ${row.skip}`);
      else {
        console.log(`    visto:  ${row.seen}`);
        if (!row.ok) console.log(`    atteso: ${row.expected}`);
      }
    }
  } finally {
    await stage.close();
  }
  const failed = report.controls.filter((row) => row.outcome === "FALLISCE");
  const waiting = report.controls.filter((row) => row.outcome.startsWith("atteso"));
  report.pass = failed.length === 0;
  report.totalMs = Date.now() - started;
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\n${report.controls.length - failed.length - waiting.length}/${report.controls.length} a posto, ${failed.length} accesi che falliscono, ${waiting.length} spenti in attesa (accesi: ${[...ACCESI].join(", ")})`,
  );
  console.log(`referto in ${REPORT}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`grid-gestures: ${error.message}`);
  process.exitCode = 1;
});
