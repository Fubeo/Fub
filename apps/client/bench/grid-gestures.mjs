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
const ACCESI = new Set(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14", "Q15", "G1", "G2", "G3", "G7"]);

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
/// G2: le rotelle dello scorrimento veloce (il metodo `scorri` delle sonde
/// del piano della griglia), e la fascia uniforme più alta che un fotogramma
/// può mostrare: una riga di carta fra due fili.
const G2_WHEELS = 14;
const G2_WHEEL_PX = 900;
const G2_WHEEL_MS = 16;
const G2_BLANK_LIMIT = 28;
/// La tolleranza per canale con cui due pixel della stessa riga sono uguali.
const G2_SAME_PIXEL = 6;
/// G2: lo scorrimento a passi, per contare le righe aggiunte e tolte.
const G2_STEPS = 30;
const G2_STEP_PX = 100;

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

/// I segni della selezione che si vedono nel riquadro col fuoco (i pezzi di
/// `grid-motion.ts`: quelli che non servono restano nascosti): quanti
/// rettangoli, il riquadro dei lati del rettangolo principale, gli anelli e
/// i quadratini, coi rettangoli dello schermo.
const marksLook = (page) =>
  page.evaluate(() => {
    const root = document.querySelector(".pane.focus .grid-viewport");
    const shown = (kind) => [...root.querySelectorAll(`.grid-mark-${kind}`)].filter((mark) => !mark.hidden && mark.getClientRects().length > 0);
    const box = (element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const edges = shown("edge");
    const rect = edges.filter((mark) => mark.dataset.mark.startsWith("rect-")).map(box);
    const union = rect.length
      ? { left: Math.min(...rect.map((r) => r.left)), top: Math.min(...rect.map((r) => r.top)), right: Math.max(...rect.map((r) => r.right)), bottom: Math.max(...rect.map((r) => r.bottom)) }
      : null;
    return {
      ranges: new Set(edges.map((mark) => mark.dataset.mark.replace(/-(top|bottom|left|right)$/, ""))).size,
      rect: union,
      rings: shown("ring").length,
      handles: shown("handle").map((mark) => ({ ...box(mark), layer: mark.parentElement.className })),
    };
  });

/// Il centro del quadratino che si vede, o `null`. Il quadratino non prende
/// il puntatore: la griglia lo prende per geometria, dove si vede l'angolo.
async function handleCenter(page) {
  const look = await marksLook(page);
  const handle = look.handles[0];
  return handle ? { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2 } : null;
}

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
      await settle(page);
      const grip = await handleCenter(page);
      if (!grip) {
        return { skip: "la sessione non serve edit.autoFill: il quadratino non c'è" };
      }
      const before = (await readState(page)).calls;
      await page.mouse.dblclick(grip.x, grip.y);
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
      const marks = await marksLook(page);
      const look = await page.evaluate(({ b2, c5, mark }) => {
        const box = (element) => element?.getBoundingClientRect();
        const first = box(document.querySelector(b2));
        const last = box(document.querySelector(c5));
        const near = (a, b) => Math.abs(a - b) <= 2;
        const viewport = document.querySelector(".grid-viewport");
        const ring = getComputedStyle(viewport);
        return {
          covers: Boolean(mark && first && last && near(mark.left, first.left) && near(mark.top, first.top)
            && near(mark.right, last.right) && near(mark.bottom, last.bottom)),
          ring: ring.boxShadow !== "none" || ring.outlineStyle !== "none",
          hiddenTick: [...document.querySelectorAll(".grid-column-header.after-hidden")].map((header) => header.textContent),
        };
      }, { b2, c5, mark: marks.rect });
      // Il bordo della cella attiva è il suo anello: quattro lati sottili.
      look.marks = marks.ranges;
      look.activeBorder = marks.rings === 4;
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
      const count = async () => (await marksLook(page)).ranges;
      const chosen = (a1s) => page.evaluate((selectors) => selectors.map((selector) => document.querySelector(selector)?.classList.contains("selected")), a1s);
      const two = await count();
      const both = await chosen([cellSelector("B2"), cellSelector("C5")]);
      await pick(page, "E2");
      const after = await count();
      return {
        // Una cella sola ha il suo rettangolo: dopo il clic ne resta uno.
        ok: two === 2 && both.every(Boolean) && after === 1,
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
        const probe = new CSSStyleSheet();
        probe.replaceSync(".grid-mark-edge, .grid-mark-ring, .grid-mark-veil { pointer-events: auto !important; }");
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, probe];
        const covers = (element) => element.matches(".grid-cell, .grid-row-header, .grid-column-header, .grid-corner, .grid-mark-freeze");
        // In (x, y) si vede un pezzo del rettangolo se sta sopra a ogni cella
        // e intestazione che ci passa.
        const markOnTop = (x, y) => {
          for (const element of document.elementsFromPoint(x, y)) {
            if (element.matches(".grid-mark-edge, .grid-mark-ring, .grid-mark-veil")) return true;
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
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== probe);
        return {
          marks: [...document.querySelectorAll(".pane.focus .grid-mark")].filter((mark) => !mark.hidden).length,
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
        const handles = [...document.querySelectorAll(".pane.focus .grid-mark-handle")].filter((mark) => !mark.hidden);
        const box = handles[0]?.getBoundingClientRect();
        // Intero: ai quattro angoli, appena dentro, il quadratino sta sopra
        // a tutto. Non prende il puntatore: per leggerlo lo si accende.
        const probe = new CSSStyleSheet();
        probe.replaceSync(".grid-mark-handle { pointer-events: auto !important; }");
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, probe];
        const whole = Boolean(box) && [[1, 1], [box.width - 1, 1], [1, box.height - 1], [box.width - 1, box.height - 1]]
          .every(([dx, dy]) => document.elementsFromPoint(box.left + dx, box.top + dy)[0] === handles[0]);
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== probe);
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
  // **La carta sotto le celle e le righe che restano** (griglia T2), sulla
  // cartella grande: scorrendo veloci non si vede mai il bianco, e le righe
  // si aggiungono e si tolgono solo ai bordi del margine.
  {
    id: "g2-scorrere-senza-bianco",
    cantiere: "G2",
    scene: LARGE_SCENE_ID,
    title: `quattordici rotelle di ${G2_WHEEL_PX} px a ${G2_WHEEL_MS} ms l'una, filmate`,
    expected: `in ogni fotogramma, nell'area delle celle (a destra della colonna bloccata, sotto la testa), nessuna fascia di righe di pixel tutte uguali più alta di ${G2_BLANK_LIMIT} px`,
    run: (page, { shotPath }) => blankFilm(page, shotPath),
  },
  {
    id: "g2-righe-ai-bordi",
    cantiere: "G2",
    scene: LARGE_SCENE_ID,
    title: `${G2_STEPS} passi di rotella da ${G2_STEP_PX} px in giù`,
    expected: "in ogni fotogramma il riquadro coperto da righe disegnate; ogni passo aggiunge le sole righe entrate nel margine e toglie le sole uscite, e nessuna riga o cella di una riga rimasta è rifatta",
    run: (page) => rowsAtEdges(page),
  },
  // **I segni che restano e scivolano** (griglia T3): una freccia sposta i
  // pezzi dei segni e non li rifà, il rettangolo è simmetrico sui fili, i
  // segni si leggono in ogni luce, il quadratino si prende dove si vede, e
  // il mouse fitto non rompe mai la selezione.
  {
    id: "g3-frecce-senza-nodi",
    cantiere: "G3",
    title: "cinque frecce e cinque Maiusc+freccia da B2, con un MutationObserver sui livelli dei segni e sulle intestazioni",
    expected: "zero nodi aggiunti o tolti",
    run: async (page) => {
      await pick(page, "B2");
      await settle(page, 500);
      await page.evaluate(() => {
        const plane = document.querySelector(".pane.focus .grid-plane");
        const watched = (node) => node instanceof Element
          && (node.matches(".grid-mark, .grid-header, .grid-corner") || Boolean(node.parentElement?.closest("[class^='grid-marks-'], [class^='grid-lift-']")));
        window.__g3Nodes = { added: 0, removed: 0, names: [] };
        window.__g3Observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) if (watched(node)) { window.__g3Nodes.added += 1; window.__g3Nodes.names.push(`+${node.className}`); }
            for (const node of record.removedNodes) if (watched(node) || record.target.closest?.("[class^='grid-marks-'], [class^='grid-lift-']")) { window.__g3Nodes.removed += 1; window.__g3Nodes.names.push(`-${node.className}`); }
          }
        });
        window.__g3Observer.observe(plane, { childList: true, subtree: true });
      });
      for (const key of ["ArrowRight", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft"]) {
        await page.keyboard.press(key);
        await settle(page, 60);
      }
      for (const key of ["Shift+ArrowDown", "Shift+ArrowRight", "Shift+ArrowDown", "Shift+ArrowRight", "Shift+ArrowUp"]) {
        await page.keyboard.press(key);
        await settle(page, 60);
      }
      await settle(page, 400);
      const nodes = await page.evaluate(() => {
        window.__g3Observer.disconnect();
        return window.__g3Nodes;
      });
      const s = await readState(page);
      return {
        ok: nodes.added === 0 && nodes.removed === 0 && s.name === "C4",
        seen: `${nodes.added} nodi aggiunti, ${nodes.removed} tolti${nodes.names.length ? ` (${nodes.names.slice(0, 6).join(" ")})` : ""}; ${seen(s)}`,
      };
    },
  },
  {
    id: "g3-lati-simmetrici",
    cantiere: "G3",
    title: "B2:C5 scelto con Maiusc+clic, i quattro lati del rettangolo",
    expected: "quattro lati larghi uguale, ognuno sul filo della sua cella e un pixel dentro (distanza dai fili uguale entro 0,5 px)",
    run: async (page) => {
      await pick(page, "B2");
      const { x, y } = await centerOf(page, cellSelector("C5"));
      await page.keyboard.down("Shift");
      await page.mouse.click(x, y);
      await page.keyboard.up("Shift");
      await settle(page, 500);
      const look = await page.evaluate(({ b2, c5 }) => {
        const first = document.querySelector(b2).getBoundingClientRect();
        const last = document.querySelector(c5).getBoundingClientRect();
        const side = (name) => {
          const pieces = [...document.querySelectorAll(`.pane.focus .grid-mark-edge[data-mark="rect-${name}"]`)].filter((mark) => !mark.hidden);
          return pieces.map((mark) => mark.getBoundingClientRect());
        };
        const [top] = side("top");
        const [bottom] = side("bottom");
        const [left] = side("left");
        const [right] = side("right");
        if (!top || !bottom || !left || !right) return null;
        // Il filo di una cella è il suo ultimo pixel: quello a sinistra di B2
        // è l'ultimo di A, quello a destra di C5 l'ultimo di C. Un lato copre
        // il filo e il pixel dentro: la sua distanza dal filo è zero.
        return {
          widths: [top.height, bottom.height, left.width, right.width],
          gaps: [
            top.top - (first.top - 1),
            last.bottom - bottom.bottom,
            left.left - (first.left - 1),
            last.right - right.right,
          ],
        };
      }, { b2: cellSelector("B2"), c5: cellSelector("C5") });
      if (!look) return { ok: false, seen: "il rettangolo non ha i suoi quattro lati" };
      const sameWidth = look.widths.every((w) => Math.abs(w - look.widths[0]) <= 0.5);
      const sameGap = look.gaps.every((gap) => Math.abs(gap - look.gaps[0]) <= 0.5);
      return {
        ok: sameWidth && sameGap && Math.abs(look.gaps[0]) <= 0.5,
        seen: `larghezze ${look.widths.join(" ")} px (sopra, sotto, sinistra, destra), distanze dai fili ${look.gaps.map((g) => Math.round(g * 10) / 10).join(" ")} px`,
      };
    },
  },
  {
    id: "g3-contrasto-dei-segni",
    cantiere: "G3",
    title: "B2:C3 scelto; nelle quattro luci (chiara, scura, ciascuna normale e ad alto contrasto) e coi due aspetti (carta del file, adattato), il colore di un lato contro la carta",
    expected: "contrasto ≥ 3:1 in ogni luce e aspetto",
    run: async (page) => {
      await pick(page, "B2");
      await page.keyboard.press("Shift+ArrowDown");
      await page.keyboard.press("Shift+ArrowRight");
      await settle(page, 500);
      const rows = [];
      for (const colorScheme of ["light", "dark"]) {
        for (const contrast of ["no-preference", "more"]) {
          await page.emulateMedia({ colorScheme, contrast });
          await settle(page, 400);
          for (const look of ["file", "adattato"]) {
            rows.push(await page.evaluate(({ look, label }) => {
              const root = document.querySelector(".pane.focus .grid-viewport").closest(".look-file, .look-adattato, .look-tema");
              const before = root ? [...root.classList].filter((name) => name.startsWith("look-")) : [];
              if (root) {
                for (const name of before) root.classList.remove(name);
                root.classList.add(`look-${look}`);
              }
              // Il colore calcolato in rgba, attraverso una tela: legge ogni
              // sintassi di colore che il motore restituisce.
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const context = canvas.getContext("2d", { willReadFrequently: true });
              const rgba = (color) => {
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = "#000";
                context.fillStyle = color;
                context.fillRect(0, 0, 1, 1);
                return [...context.getImageData(0, 0, 1, 1).data];
              };
              const luminance = ([r, g, b]) => {
                const lin = (c) => {
                  const v = c / 255;
                  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
                };
                return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
              };
              const edge = [...document.querySelectorAll(".pane.focus .grid-mark-edge")].find((mark) => !mark.hidden);
              const paper = document.querySelector(".pane.focus .grid-paper");
              const mark = rgba(getComputedStyle(edge).backgroundColor);
              const sheet = rgba(getComputedStyle(paper).backgroundColor);
              const [a, b] = [luminance(mark), luminance(sheet)].sort((x, y) => y - x);
              const ratio = (a + 0.05) / (b + 0.05);
              if (root) {
                root.classList.remove(`look-${look}`);
                for (const name of before) root.classList.add(name);
              }
              return { label: `${label} ${look}`, ratio: Math.round(ratio * 100) / 100, mark: mark.slice(0, 3).join(","), sheet: sheet.slice(0, 3).join(",") };
            }, { look, label: `${colorScheme}${contrast === "more" ? " alto" : ""}` }));
          }
        }
      }
      await page.emulateMedia({ colorScheme: "dark", contrast: "no-preference" });
      const low = rows.filter((row) => !(row.ratio >= 3));
      return {
        ok: low.length === 0,
        seen: rows.map((row) => `${row.label} ${row.ratio}:1`).join("; "),
        rows,
      };
    },
  },
  {
    id: "g3-quadratino-coperto",
    cantiere: "G3",
    scene: LARGE_SCENE_ID,
    title: "B5 scelta, scorsa di lato finché l'angolo del quadratino è 2 px oltre il filo della colonna ferma, si tira dall'angolo; poi finché l'angolo è 20 px sotto la fascia, stesso gesto",
    expected: "a 2 px il gesto riempie (edit.autoFill); a 20 px sotto la fascia parte dalla cella della colonna ferma e non riempie",
    run: async (page) => {
      const tryAt = async (beyond) => {
        await page.evaluate(() => {
          const v = document.querySelector(".pane.focus .grid-viewport");
          v.scrollLeft = 0;
          v.scrollTop = 0;
        });
        await settle(page);
        await pick(page, "B5");
        await settle(page, 400);
        const geometry = await page.evaluate((b5) => {
          const viewport = document.querySelector(".pane.focus .grid-viewport");
          const plane = viewport.querySelector(".grid-plane");
          const v = viewport.getBoundingClientRect();
          const cell = document.querySelector(b5).getBoundingClientRect();
          return {
            left: parseFloat(plane.style.getPropertyValue("--grid-left-w")),
            corner: cell.right - v.left - viewport.clientLeft,
            bottom: cell.bottom,
            vLeft: v.left + viewport.clientLeft,
          };
        }, cellSelector("B5"));
        if (!(await handleCenter(page))) return null;
        // L'angolo si vede a `left + beyond` dall'orlo del riquadro.
        const scroll = geometry.corner - geometry.left - beyond;
        await page.evaluate((left) => {
          const v = document.querySelector(".pane.focus .grid-viewport");
          v.scrollLeft = left;
          v.dispatchEvent(new Event("scroll"));
        }, scroll);
        await settle(page, 400);
        const before = (await readState(page)).calls;
        const x = geometry.vLeft + geometry.left + beyond - 1;
        const y = geometry.bottom - 1;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 30, { steps: 3 });
        await page.mouse.move(x, y + 90, { steps: 3 });
        await page.mouse.up();
        await settle(page);
        const calls = await callsSince(page, before);
        return calls.some((call) => call.gate === "gridBytesCommand" && call.args.includes("edit.autoFill"));
      };
      const near = await tryAt(2);
      if (near === null) return { skip: "la sessione non serve edit.autoFill: il quadratino non c'è" };
      const under = await tryAt(-20);
      return {
        ok: near === true && under === false,
        seen: `a 2 px oltre il filo ${near ? "riempie" : "non riempie"}; a 20 px sotto la fascia ${under ? "riempie" : "non riempie"}`,
      };
    },
  },
  {
    id: "g3-mouse-fitto",
    cantiere: "G3",
    scene: LARGE_SCENE_ID,
    title: "il mouse dal CDP a 1000 Hz senza aspettare: trascinamenti avanti e indietro dentro e fuori dalla riga e dalla colonna bloccate, la rotella durante il trascinamento, Maiusc+clic, frecce svelte; a 1280 e 390 px, CPU 1× e 4×, moto vero",
    expected: "in ogni fotogramma i pezzi di ogni lato d'accordo (0,5 px), nessun lato oltre il bersaglio o all'indietro, anello e velo dentro il bordo, il quadratino un pezzo solo 8×8 nel livello della zona del suo angolo; a gesto finito la cella attiva sotto il puntatore",
    run: (page) => denseMouse(page),
  },
  // **Il dito** (griglia T7), a 390 px col tocco del CDP: trascinare scorre e
  // basta, un tocco sceglie, due aprono, il tocco lungo mette due maniglie
  // che si tirano.
  {
    id: "g7-trascinare-scorre",
    cantiere: "G7",
    scene: LARGE_SCENE_ID,
    title: "a 390 px col dito: un tocco su B4, poi un trascinamento verticale di 300 px nel corpo",
    expected: "lo scorrimento cambia, nessun intervallo, la cella attiva resta B4",
    run: async (page) => {
      const finger = await touchPage(page);
      const b4 = await centerOf(page, cellSelector("B4"));
      await finger.tap(b4.x, b4.y);
      await settle(page, 400);
      const before = await selectionLook(page);
      const viewport = await viewportBox(page);
      const from = { x: viewport.left + viewport.bandLeft + (viewport.width - viewport.bandLeft) / 2, y: viewport.top + viewport.height - 40 };
      await finger.drag(from, { x: from.x, y: from.y - 300 });
      await settle(page, 500);
      const after = await selectionLook(page);
      return {
        ok: before.name === "B4" && after.scrollTop > before.scrollTop + 100 && after.cells <= 1 && after.name === "B4",
        seen: `prima ${before.name} a ${before.scrollTop} px; dopo il dito ${after.name}, ${after.cells} celle scelte, scorso a ${after.scrollTop} px`,
      };
    },
  },
  {
    id: "g7-tocco-sceglie",
    cantiere: "G7",
    title: "a 390 px col dito: un tocco su una cella in vista (B4)",
    expected: "B4 è la cella attiva, da sola",
    run: async (page) => {
      const finger = await touchPage(page);
      const b4 = await centerOf(page, cellSelector("B4"));
      await finger.tap(b4.x, b4.y);
      await settle(page);
      const look = await selectionLook(page);
      const s = await readState(page);
      return { ok: look.name === "B4" && look.cells === 1 && !s.editorOpen, seen: `${look.name}, ${look.cells} celle scelte, ${editorLabel(s)}` };
    },
  },
  {
    id: "g7-due-tocchi-aprono",
    cantiere: "G7",
    title: "a 390 px col dito: due tocchi su B4 a 120 ms l'uno dall'altro",
    expected: "la cella B4 aperta",
    run: async (page) => {
      const finger = await touchPage(page);
      const b4 = await centerOf(page, cellSelector("B4"));
      await finger.tap(b4.x, b4.y);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await finger.tap(b4.x, b4.y);
      await settle(page);
      const s = await readState(page);
      return { ok: s.editorOpen && s.name === "B4", seen: seen(s) };
    },
  },
  {
    id: "g7-tocco-lungo",
    cantiere: "G7",
    title: "a 390 px col dito (si vede solo la colonna A): un tocco lungo su A2, poi la maniglia di fine tirata fino ad A4",
    expected: "due maniglie distinte (`data-handle` a e b) agli angoli della selezione; tirata quella di fine, la selezione è A2:A4 e il foglio non scorre",
    run: async (page) => {
      const finger = await touchPage(page);
      const a2 = await centerOf(page, cellSelector("A2"));
      const a4 = await centerOf(page, cellSelector("A4"));
      await finger.long(a2.x, a2.y);
      await settle(page);
      const grips = await gripsLook(page);
      const a = grips.find((grip) => grip.handle === "a");
      const b = grips.find((grip) => grip.handle === "b");
      const placed = grips.length === 2 && a && b && a.x !== b.x && a.y !== b.y;
      if (!placed) return { ok: false, seen: `${grips.length} maniglie (${grips.map((grip) => grip.handle).join(", ")})` };
      const before = await selectionLook(page);
      await finger.drag({ x: b.x, y: b.y }, a4);
      await settle(page);
      const after = await selectionLook(page);
      const still = after.scrollTop === before.scrollTop && after.scrollLeft === before.scrollLeft;
      return {
        ok: before.range === "A2:A2" && after.range === "A2:A4" && after.name === "A2" && still,
        seen: `maniglie ${a.size} e ${b.size}; prima ${before.range}, tirata quella di fine ${after.range} (attiva ${after.name}); scorso ${still ? "no" : `sì, a ${after.scrollLeft},${after.scrollTop}`}`,
      };
    },
  },
  {
    id: "g7-maniglia-sul-filo",
    cantiere: "G7",
    scene: LARGE_SCENE_ID,
    title: "con la colonna A bloccata, a 390 px col dito: tocco lungo su B5, la maniglia d'inizio presa al centro e tirata; poi 40 px di lato; poi il tocco lungo su A5",
    expected: "la maniglia d'inizio di B5 un elemento solo, 14 × 14, col centro sul filo; presa al centro la tira (la selezione si allarga, il foglio non scorre); dopo 40 px di lato sul filo non ne resta niente; su A5 la maniglia di fine resta intera sul filo, anche dopo 40 px",
    run: async (page) => {
      const finger = await touchPage(page);
      const report = [];
      const b5 = await centerOf(page, cellSelector("B5"));
      await finger.long(b5.x, b5.y);
      await settle(page);
      let grips = await gripsLook(page);
      const a = grips.find((grip) => grip.handle === "a");
      const onWire = (grip, axis) => Math.abs(grip[axis === "x" ? "wireX" : "wireY"]) <= 1;
      const aOk = grips.filter((grip) => grip.handle === "a").length === 1 && a?.size === "14×14" && onWire(a, "x");
      report.push(a ? `B5: maniglia d'inizio ${a.size}, centro dal filo ${a.wireX} px, ${a.visible} punti visti su ${a.samples}` : "B5: nessuna maniglia d'inizio");
      if (!a) return { ok: false, seen: report.join("; ") };
      // Presa al centro (sul filo, metà sotto la fascia) e tirata in
      // giù: B5 è la fine fissa, la selezione cresce fino a B7 (la colonna C
      // a 390 px esce dal riquadro, e il gesto lo farebbe scorrere da sé).
      const before = await selectionLook(page);
      const b7 = await centerOf(page, cellSelector("B7"));
      await finger.drag({ x: a.x, y: a.y }, b7);
      await settle(page);
      const pulled = await selectionLook(page);
      const still = pulled.scrollTop === before.scrollTop && pulled.scrollLeft === before.scrollLeft;
      const pullOk = before.range === "B5:B5" && pulled.range === "B5:B7" && still;
      report.push(`tirata dal centro: ${before.range} → ${pulled.range}, scorso ${still ? "no" : "sì"}`);
      // 40 px di lato: la maniglia d'inizio va sotto la fascia con la sua cella.
      await page.evaluate(() => {
        document.querySelector(".pane.focus .grid-viewport").scrollLeft += 40;
      });
      await settle(page);
      grips = await gripsLook(page);
      const under = grips.find((grip) => grip.handle === "a");
      const underOk = !under || under.visible === 0;
      report.push(`dopo 40 px: ${under ? `${under.visible} punti della maniglia d'inizio visti` : "maniglia d'inizio nascosta"}`);
      // Su A5, nella colonna ferma, la maniglia di fine sta intera sul filo.
      await page.evaluate(() => {
        document.querySelector(".pane.focus .grid-viewport").scrollLeft = 0;
      });
      await settle(page);
      const a5 = await centerOf(page, cellSelector("A5"));
      await finger.long(a5.x, a5.y);
      await settle(page);
      let end = (await gripsLook(page)).find((grip) => grip.handle === "b");
      const wholeAt = (grip) => grip && grip.size === "14×14" && grip.visible === grip.samples && onWire(grip, "x");
      let endOk = wholeAt(end);
      report.push(end ? `A5: maniglia di fine ${end.size}, centro dal filo ${end.wireX} px, ${end.visible}/${end.samples} punti visti` : "A5: nessuna maniglia di fine");
      await page.evaluate(() => {
        document.querySelector(".pane.focus .grid-viewport").scrollLeft += 40;
      });
      await settle(page);
      end = (await gripsLook(page)).find((grip) => grip.handle === "b");
      endOk = endOk && wholeAt(end);
      report.push(end ? `dopo 40 px ${end.visible}/${end.samples} punti, centro dal filo ${end.wireX} px` : "dopo 40 px nessuna maniglia di fine");
      return { ok: aOk && pullOk && underOk && endOk, seen: report.join("; ") };
    },
  },
];

// ---------------------------------------------------------------------------
// G7: il dito.
// ---------------------------------------------------------------------------

/// La larghezza del telefono dei controlli G7.
const G7_WIDTH = 390;
/// Un passo del dito che scorre, come un fotogramma.
const G7_STEP_MS = 16;
/// Quanto resta giù il dito di un tocco lungo: oltre `LONG_PRESS_MS` (450).
const G7_LONG_MS = 700;

/// Accende il tocco del CDP e porta la finestra a 390 px. Il dito passa dal
/// browser vero (`Input.dispatchTouchEvent`): `touch-action` decide chi
/// scorre, come su un telefono.
async function touchPage(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const size = page.viewportSize();
  await page.setViewportSize({ width: G7_WIDTH, height: size.height });
  await gridSteady(page);
  await settle(page);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(({ x, y }) => ({ x, y, id: 1 })) });
  return {
    tap: async (x, y) => {
      await send("touchStart", [{ x, y }]);
      await pause(40);
      await send("touchEnd", []);
    },
    long: async (x, y) => {
      await send("touchStart", [{ x, y }]);
      await pause(G7_LONG_MS);
      await send("touchEnd", []);
    },
    /// Da `from` a `to` in 20 passi di un fotogramma.
    drag: async (from, to) => {
      await send("touchStart", [from]);
      await pause(G7_STEP_MS);
      for (let step = 1; step <= 20; step += 1) {
        const t = step / 20;
        await send("touchMove", [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }]);
        await pause(G7_STEP_MS);
      }
      await send("touchEnd", []);
    },
  };
}

/// Il riquadro della griglia nello schermo e la misura delle fasce ferme.
function viewportBox(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const plane = viewport.querySelector(".grid-plane");
    const v = viewport.getBoundingClientRect();
    return {
      left: v.left + viewport.clientLeft,
      top: v.top + viewport.clientTop,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      bandLeft: parseFloat(plane.style.getPropertyValue("--grid-left-w")),
      bandTop: parseFloat(plane.style.getPropertyValue("--grid-top-h")),
    };
  });
}

/// La selezione che si vede: il nome della cella attiva, quante celle sono
/// scelte, l'intervallo A1 che coprono e lo scorrimento.
function selectionLook(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const chosen = [...viewport.querySelectorAll(".grid-cell.selected, .grid-cell.active")];
    const rows = chosen.map((cell) => Number(cell.dataset.row));
    const columns = chosen.map((cell) => Number(cell.dataset.column));
    const a1 = (row, column) => `${String.fromCharCode(65 + column)}${row + 1}`;
    return {
      name: document.querySelector(".pane.focus .grid-cell-name")?.textContent ?? null,
      cells: new Set(chosen).size,
      range: chosen.length ? `${a1(Math.min(...rows), Math.min(...columns))}:${a1(Math.max(...rows), Math.max(...columns))}` : "niente",
      scrollTop: viewport.scrollTop,
      scrollLeft: viewport.scrollLeft,
    };
  });
}

/// Le maniglie del tocco che si vedono: quale (`data-handle`), il centro
/// nello schermo e dal filo del blocco, la misura, e quanti dei punti
/// campionati dentro il tondo stanno sopra a tutto (le maniglie non prendono
/// il puntatore: per leggerle lo si accende).
function gripsLook(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const plane = viewport.querySelector(".grid-plane");
    const v = viewport.getBoundingClientRect();
    const bands = { top: parseFloat(plane.style.getPropertyValue("--grid-top-h")), left: parseFloat(plane.style.getPropertyValue("--grid-left-w")) };
    const grips = [...viewport.querySelectorAll(".grid-mark-touch")].filter((mark) => !mark.hidden);
    const probe = new CSSStyleSheet();
    probe.replaceSync(".grid-mark-touch { pointer-events: auto !important; }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, probe];
    const out = grips.map((grip) => {
      const box = grip.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      let samples = 0;
      let visible = 0;
      for (const dx of [-4, -2, 0, 2, 4]) {
        for (const dy of [-4, -2, 0, 2, 4]) {
          samples += 1;
          if (document.elementsFromPoint(cx + dx, cy + dy)[0] === grip) visible += 1;
        }
      }
      return {
        handle: grip.dataset.handle,
        x: cx,
        y: cy,
        size: `${Math.round(box.width)}×${Math.round(box.height)}`,
        wireX: Math.round((cx - v.left - viewport.clientLeft - bands.left) * 2) / 2,
        wireY: Math.round((cy - v.top - viewport.clientTop - bands.top) * 2) / 2,
        samples,
        visible,
      };
    });
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== probe);
    return out;
  });
}

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

/// G2: mette nella pagina gli orologi del gestore dello scorrimento. Un
/// ascoltatore in cattura sul documento parte prima di quelli della griglia,
/// uno sul riquadro aggiunto adesso parte dopo il suo: la differenza è il
/// tempo del gestore. Anche i fotogrammi chiesti (`requestAnimationFrame`)
/// hanno il loro orologio: prima di T2 il disegno stava lì.
async function installScrollClocks(page) {
  await page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const clocks = { on: false, start: 0, handler: [], frame: [] };
    window.__g2Clocks = clocks;
    document.addEventListener("scroll", (event) => {
      if (event.target === viewport) clocks.start = performance.now();
    }, { capture: true });
    viewport.addEventListener("scroll", () => {
      if (clocks.on && clocks.start) clocks.handler.push(performance.now() - clocks.start);
      clocks.start = 0;
    });
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => request((time) => {
      const start = performance.now();
      try {
        callback(time);
      } finally {
        if (clocks.on) clocks.frame.push(performance.now() - start);
      }
    });
  });
}

/// Il novantesimo percentile e il peggiore di una serie di tempi, in ms.
function timing(values) {
  if (!values.length) return { count: 0, p90: 0, worst: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  const round = (value) => Math.round(value * 100) / 100;
  return { count: values.length, p90: round(at(0.9)), worst: round(sorted.at(-1)) };
}

/// G2: la fascia più alta di righe di pixel tutte uguali (niente fili, niente
/// testo, niente celle) nell'area `area` di un fotogramma.
function blankBand(png, area) {
  let run = 0;
  let best = 0;
  for (let y = area.y; y < area.y + area.height; y += 1) {
    const row = (png.width * y + area.x) * 4;
    let uniform = true;
    for (let x = 1; x < area.width; x += 1) {
      const p = row + x * 4;
      if (Math.abs(png.data[p] - png.data[row]) > G2_SAME_PIXEL
        || Math.abs(png.data[p + 1] - png.data[row + 1]) > G2_SAME_PIXEL
        || Math.abs(png.data[p + 2] - png.data[row + 2]) > G2_SAME_PIXEL) {
        uniform = false;
        break;
      }
    }
    run = uniform ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/// G2: filma lo scorrimento veloce in giù e misura, in ogni fotogramma, la
/// fascia uniforme più alta nell'area delle celle che scorrono (a destra
/// della colonna bloccata, sotto la testa, senza le barre di scorrimento).
/// Misura anche il tempo del gestore dello scorrimento.
async function blankFilm(page, shotPath) {
  const box = await page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const plane = viewport.querySelector(".grid-plane");
    const v = viewport.getBoundingClientRect();
    const top = parseFloat(plane.style.getPropertyValue("--grid-top-h"));
    const left = parseFloat(plane.style.getPropertyValue("--grid-left-w"));
    return {
      area: {
        x: Math.round(v.left + viewport.clientLeft + left + 4),
        y: Math.round(v.top + viewport.clientTop + top + 4),
        width: Math.round(viewport.clientWidth - left - 8),
        height: Math.round(viewport.clientHeight - top - 8),
      },
      centerX: Math.round(v.left + v.width / 2),
      centerY: Math.round(v.top + v.height / 2),
    };
  });
  await page.mouse.move(box.centerX, box.centerY);
  await settle(page, 400);
  await installScrollClocks(page);

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push(frame.data);
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  for (let wait = 0; frames.length === 0 && wait < 20; wait += 1) await settle(page, 50);
  await page.evaluate(() => { window.__g2Clocks.on = true; });
  for (let wheel = 0; wheel < G2_WHEELS; wheel += 1) {
    await page.mouse.wheel(0, G2_WHEEL_PX);
    await page.waitForTimeout(G2_WHEEL_MS);
  }
  await settle(page, 500);
  await cdp.send("Page.stopScreencast");
  await cdp.detach();
  const clocks = await page.evaluate(() => {
    const clocks = window.__g2Clocks;
    clocks.on = false;
    return { handler: clocks.handler, frame: clocks.frame, scrollTop: document.querySelector(".pane.focus .grid-viewport").scrollTop };
  });

  const pngs = frames
    .map((data) => PNG.sync.read(Buffer.from(data, "base64")))
    .filter((png) => png.width >= box.area.x + box.area.width && png.height >= box.area.y + box.area.height);
  if (pngs.length < 3) {
    return { skip: `lo screencast ha dato ${pngs.length} fotogrammi utili: troppo pochi per dire qualcosa`, frames: frames.length };
  }
  const bands = pngs.map((png) => blankBand(png, box.area));
  const worst = bands.indexOf(Math.max(...bands));
  await writeFile(shotPath, PNG.sync.write(pngs[worst]));
  const over = bands.filter((band) => band > G2_BLANK_LIMIT).length;
  const handler = timing(clocks.handler);
  const frame = timing(clocks.frame);
  return {
    ok: over === 0 && clocks.scrollTop > G2_WHEEL_PX,
    seen: `${pngs.length} fotogrammi, scorso fino a ${clocks.scrollTop} px: fascia uniforme più alta ${bands[worst]} px (n. ${worst}), oltre ${G2_BLANK_LIMIT} px in ${over}; gestore dello scorrimento ${handler.count} volte, p90 ${handler.p90} ms, peggiore ${handler.worst} ms; fotogrammi chiesti ${frame.count}, p90 ${frame.p90} ms, peggiore ${frame.worst} ms`,
    frames: pngs.length,
    bands,
    over,
    handler,
    frame,
  };
}

/// G2: scorre a passi e conta, a ogni passo, le righe del corpo che il DOM
/// aggiunge e toglie (`MutationObserver`) contro quelle entrate e uscite dal
/// margine disegnato; e in ogni fotogramma la parte del riquadro senza una
/// riga disegnata sopra.
async function rowsAtEdges(page) {
  const viewport = await centerOf(page, ".pane.focus .grid-viewport");
  await page.mouse.move(viewport.x, viewport.y);
  await settle(page, 400);
  await page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const plane = viewport.querySelector(".grid-plane");
    const body = viewport.querySelector(".grid-rows");
    const drawn = () => new Set([...body.children].filter((el) => el.classList.contains("grid-row")).map((el) => Number(el.dataset.row)));
    const state = { before: drawn(), added: [], removed: [], cellsAdded: [], uncovered: [], on: true };
    const rowOf = (node) => Number(node.closest?.(".grid-row")?.dataset.row ?? node.dataset?.row);
    const handle = (records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains("grid-row") && node.parentElement === body) state.added.push(Number(node.dataset.row));
          else if (node.classList.contains("grid-cell")) state.cellsAdded.push(rowOf(record.target));
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList.contains("grid-row") && record.target === body) state.removed.push(Number(node.dataset.row));
          else if (node.classList.contains("grid-cell")) state.cellsAdded.push(-1 - rowOf(record.target));
        }
      }
    };
    const observer = new MutationObserver(handle);
    observer.observe(body, { childList: true, subtree: true });
    // In ogni fotogramma: quanta parte del corpo nel riquadro nessuna riga
    // disegnata copre.
    const sample = () => {
      if (!state.on) return;
      const v = viewport.getBoundingClientRect();
      const top = v.top + viewport.clientTop + parseFloat(plane.style.getPropertyValue("--grid-top-h"));
      const bottom = v.top + viewport.clientTop + viewport.clientHeight;
      const spans = [...body.children]
        .filter((el) => el.classList.contains("grid-row"))
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.bottom > top && b.top < bottom)
        .map((b) => [Math.max(b.top, top), Math.min(b.bottom, bottom)])
        .sort((a, b) => a[0] - b[0]);
      let covered = 0;
      let reach = top;
      for (const [from, to] of spans) {
        if (to <= reach) continue;
        covered += to - Math.max(from, reach);
        reach = to;
      }
      state.uncovered.push(Math.max(0, Math.round(bottom - top - covered)));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__g2Rows = {
      step: () => {
        handle(observer.takeRecords());
        const now = drawn();
        const entered = [...now].filter((row) => !state.before.has(row));
        const exited = [...state.before].filter((row) => !now.has(row));
        const kept = new Set([...now].filter((row) => state.before.has(row)));
        const result = {
          entered: entered.length,
          exited: exited.length,
          added: state.added.length,
          removed: state.removed.length,
          // Una riga che c'era prima e c'è dopo, ma è stata tolta e rimessa.
          rebuilt: state.added.filter((row) => state.before.has(row)).length,
          // Le celle aggiunte o tolte in una riga rimasta.
          cells: state.cellsAdded.filter((row) => kept.has(row >= 0 ? row : -1 - row)).length,
        };
        state.before = now;
        state.added = [];
        state.removed = [];
        state.cellsAdded = [];
        return result;
      },
      stop: () => {
        state.on = false;
        observer.disconnect();
        return state.uncovered;
      },
    };
  });
  const steps = [];
  for (let step = 0; step < G2_STEPS; step += 1) {
    await page.mouse.wheel(0, G2_STEP_PX);
    await settle(page, 40);
    steps.push(await page.evaluate(() => window.__g2Rows.step()));
  }
  const look = await page.evaluate(() => ({
    uncovered: window.__g2Rows.stop(),
    scrollTop: document.querySelector(".pane.focus .grid-viewport").scrollTop,
  }));
  const sum = (key) => steps.reduce((total, step) => total + step[key], 0);
  const holes = look.uncovered.filter((px) => px > 0);
  const extra = steps.filter((step) => step.added !== step.entered || step.removed !== step.exited).length;
  const rebuilt = sum("rebuilt");
  const cells = sum("cells");
  return {
    ok: look.scrollTop >= (G2_STEPS - 1) * G2_STEP_PX && holes.length === 0 && extra === 0 && rebuilt === 0 && cells === 0,
    seen: `scorso fino a ${look.scrollTop} px in ${G2_STEPS} passi: ${look.uncovered.length} fotogrammi, senza righe in ${holes.length}${holes.length ? ` (fino a ${Math.max(...holes)} px)` : ""}; righe entrate ${sum("entered")} e aggiunte ${sum("added")}, uscite ${sum("exited")} e tolte ${sum("removed")}, passi fuori conto ${extra}; righe rifatte dentro il margine ${rebuilt}, celle aggiunte o tolte in una riga rimasta ${cells}`,
    steps,
  };
}

// ---------------------------------------------------------------------------
// La corsa.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// G3: il mouse fitto.
// ---------------------------------------------------------------------------

/// I quattro giri di `g3-mouse-fitto`: larghezza della finestra e
/// rallentamento della CPU.
const G3_ROUNDS = [
  { width: 1280, cpu: 1 },
  { width: 1280, cpu: 4 },
  { width: 390, cpu: 1 },
  { width: 390, cpu: 4 },
];
/// Un `mouseMoved` ogni millisecondo, come un mouse a 1000 Hz.
const G3_MOVE_MS = 1;
/// Quanto può sbagliare un lato, fra pezzi e contro il bersaglio.
const G3_TOLERANCE = 0.5;

/// Installa nella pagina il lettore dei fotogrammi: un `ResizeObserver` su
/// una sentinella che un rAF cambia, quindi dopo i rAF (anche quello del
/// motore dei segni) e prima del dipinto, legge ogni pezzo visibile.
async function installMarksRecorder(page) {
  await page.evaluate((tolerance) => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const plane = viewport.querySelector(".grid-plane");
    const state = { frames: 0, moving: 0, disagree: [], overshoot: [], backward: [], outside: [], corner: [], prev: {} };
    const note = (list, text) => {
      if (list.length < 8) list.push(`f${state.frames}: ${text}`);
      list.count = (list.count ?? 0) + 1;
    };
    const sample = () => {
      state.frames += 1;
      const v = viewport.getBoundingClientRect();
      const bands = {
        top: parseFloat(plane.style.getPropertyValue("--grid-top-h")),
        left: parseFloat(plane.style.getPropertyValue("--grid-left-w")),
      };
      const shown = [...viewport.querySelectorAll(".grid-mark")].filter((mark) => !mark.hidden);
      if (shown.some((mark) => mark.style.transform)) state.moving += 1;
      // 1. I pezzi di ogni lato del rettangolo, sullo schermo, d'accordo.
      // Ciò che di un pezzo si vede: un pezzo del corpo sotto una fascia
      // ferma, o della testa sotto la colonna ferma, è coperto.
      const visible = (mark) => {
        const r = mark.getBoundingClientRect();
        const layer = mark.parentElement.className;
        const minX = layer === "grid-marks-body" || layer === "grid-marks-top" ? v.left + viewport.clientLeft + bands.left : -Infinity;
        const minY = layer === "grid-marks-body" || layer === "grid-marks-left" ? v.top + viewport.clientTop + bands.top : -Infinity;
        const left = Math.max(r.left, minX, v.left);
        const top = Math.max(r.top, minY, v.top);
        const right = Math.min(r.right, v.right);
        const bottom = Math.min(r.bottom, v.bottom);
        return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
      };
      const sides = { top: [], bottom: [], left: [], right: [] };
      const now = {};
      for (const mark of shown) {
        const match = /^rect-(top|bottom|left|right)$/.exec(mark.dataset.mark ?? "");
        if (!match) continue;
        const side = match[1];
        const r = mark.getBoundingClientRect();
        const seenRect = visible(mark);
        if (!seenRect) continue;
        const thick = side === "top" || side === "bottom" ? seenRect.height : seenRect.width;
        if (thick < 1.5) continue;
        sides[side].push(side === "top" ? r.top : side === "bottom" ? r.bottom : side === "left" ? r.left : r.right);
        // 2. Il bersaglio: dove sta un pezzo del corpo al suo arrivo, nelle
        // coordinate del suo livello, contro dove si vede.
        if (mark.parentElement.classList.contains("grid-marks-body") && mark.hasAttribute("data-arrive")) {
          const layer = mark.parentElement.getBoundingClientRect();
          const left = parseFloat(mark.style.left);
          const top = parseFloat(mark.style.top);
          const width = parseFloat(mark.style.width);
          const height = parseFloat(mark.style.height);
          now[side] = side === "top"
            ? { target: top, seen: r.top - layer.top }
            : side === "bottom"
              ? { target: top + height, seen: r.bottom - layer.top }
              : side === "left"
                ? { target: left, seen: r.left - layer.left }
                : { target: left + width, seen: r.right - layer.left };
        }
      }
      for (const [side, values] of Object.entries(sides)) {
        if (values.length > 1 && Math.max(...values) - Math.min(...values) > tolerance) {
          note(state.disagree, `${side} ${values.map((x) => Math.round(x * 10) / 10).join("/")}`);
        }
      }
      for (const [side, at] of Object.entries(now)) {
        const before = state.prev[side];
        if (!before) continue;
        const was = before.seen - at.target;
        const is = at.seen - at.target;
        if (was * is < -tolerance * tolerance && Math.abs(is) > tolerance) note(state.overshoot, `${side} ${Math.round(was * 10) / 10} → ${Math.round(is * 10) / 10}`);
        if (Math.abs(is) > Math.abs(was) + tolerance) note(state.backward, `${side} ${Math.round(was * 10) / 10} → ${Math.round(is * 10) / 10}`);
      }
      state.prev = now;
      // 3. L'anello e il velo dentro il bordo.
      const all = Object.values(sides);
      if (all.every((values) => values.length > 0)) {
        const box = { top: Math.min(...sides.top), bottom: Math.max(...sides.bottom), left: Math.min(...sides.left), right: Math.max(...sides.right) };
        for (const mark of shown) {
          if (!mark.matches(".grid-mark-ring, .grid-mark-veil")) continue;
          const r = visible(mark);
          if (!r) continue;
          if (r.left < box.left - tolerance || r.right > box.right + tolerance || r.top < box.top - tolerance || r.bottom > box.bottom + tolerance) {
            note(state.outside, `${mark.dataset.mark}`);
          }
        }
      }
      // 4. Il quadratino: uno solo, intero, nel livello della zona del suo
      // angolo.
      const handles = shown.filter((mark) => mark.matches(".grid-mark-handle"));
      if (handles.length > 1) note(state.corner, `${handles.length} quadratini`);
      for (const handle of handles) {
        const r = handle.getBoundingClientRect();
        if (Math.abs(r.width - 8) > tolerance || Math.abs(r.height - 8) > tolerance) note(state.corner, `quadratino ${r.width}×${r.height}`);
        const x = r.left + 5 - v.left - viewport.clientLeft;
        const y = r.top + 5 - v.top - viewport.clientTop;
        const layer = handle.parentElement.className;
        if (x > bands.left + 1 && y > bands.top + 1 && layer !== "grid-marks-body") note(state.corner, `angolo nel corpo, livello ${layer}`);
        if ((layer === "grid-lift-left" || layer === "grid-lift-corner") && x > bands.left + 1) note(state.corner, `angolo a destra del filo, livello ${layer}`);
        if ((layer === "grid-lift-top" || layer === "grid-lift-corner") && y > bands.top + 1) note(state.corner, `angolo sotto il filo, livello ${layer}`);
      }
    };
    // La cella sotto il puntatore al rilascio: dove il gesto finisce. Dopo,
    // ciò che sta sopra la griglia può cambiare misura e spostarla.
    window.__g3Release = null;
    window.addEventListener("pointerup", (event) => {
      const cell = document.elementsFromPoint(event.clientX, event.clientY).find((node) => node.matches?.(".pane.focus .grid-cell"));
      window.__g3Release = cell ? { row: cell.dataset.row, column: cell.dataset.column } : null;
    }, true);
    const sentinel = document.createElement("div");
    sentinel.style.position = "fixed";
    sentinel.style.left = "0";
    sentinel.style.top = "0";
    sentinel.style.height = "1px";
    sentinel.style.pointerEvents = "none";
    document.body.append(sentinel);
    const observer = new ResizeObserver(sample);
    observer.observe(sentinel);
    let flip = false;
    let frame = 0;
    const tick = () => {
      flip = !flip;
      sentinel.style.width = flip ? "1px" : "2px";
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.__g3Stop = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sentinel.remove();
      const count = (list) => ({ count: list.count ?? 0, first: list });
      return {
        frames: state.frames,
        moving: state.moving,
        disagree: count(state.disagree),
        overshoot: count(state.overshoot),
        backward: count(state.backward),
        outside: count(state.outside),
        corner: count(state.corner),
      };
    };
  }, G3_TOLERANCE);
}

/// Se la cella sotto il puntatore al rilascio (o, senza rilascio, sotto
/// x, y) è un angolo della selezione: scelta, e su ogni asse con una vicina
/// non scelta. Dove un gesto finisce, la selezione finisce.
async function cellUnderIsCorner(page, x, y) {
  const cell = await page.evaluate(([px, py]) => {
    const released = window.__g3Release;
    const element = released
      ? document.querySelector(`.pane.focus .grid-cell[data-row="${released.row}"][data-column="${released.column}"]`)
      : document.elementsFromPoint(px, py).find((node) => node.matches?.(".pane.focus .grid-cell"));
    window.__g3Release = null;
    if (!element) return null;
    const row = Number(element.dataset.row);
    const column = Number(element.dataset.column);
    const chosen = (r, c) => document.querySelector(`.pane.focus .grid-cell[data-row="${r}"][data-column="${c}"]`)?.classList.contains("selected") ?? false;
    return {
      name: `${row},${column}`,
      selected: element.classList.contains("selected"),
      rowEdge: !chosen(row - 1, column) || !chosen(row + 1, column),
      columnEdge: !chosen(row, column - 1) || !chosen(row, column + 1),
    };
  }, [x, y]);
  if (!cell) return { ok: false, text: `niente sotto ${Math.round(x)},${Math.round(y)}` };
  const ok = cell.selected && cell.rowEdge && cell.columnEdge;
  return { ok, text: `cella ${cell.name} ${ok ? "è" : "non è"} un angolo` };
}

/// I gesti di un giro, col mouse del CDP che non aspetta le risposte.
async function denseGestures(page, cdp) {
  const box = await page.evaluate(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const plane = viewport.querySelector(".grid-plane");
    const v = viewport.getBoundingClientRect();
    return {
      left: v.left + viewport.clientLeft,
      top: v.top + viewport.clientTop,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      bandLeft: parseFloat(plane.style.getPropertyValue("--grid-left-w")),
      bandTop: parseFloat(plane.style.getPropertyValue("--grid-top-h")),
    };
  });
  const sent = [];
  const send = (params) => sent.push(cdp.send("Input.dispatchMouseEvent", params).catch(() => {}));
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let at = { x: 0, y: 0 };
  /// Da dove si è a (x, y) in `ms`, un `mouseMoved` per millisecondo.
  const sweep = async (x, y, ms, buttons = 1) => {
    const from = at;
    const steps = Math.max(1, Math.round(ms / G3_MOVE_MS));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      at = { x: from.x + (x - from.x) * t, y: from.y + (y - from.y) * t };
      send({ type: "mouseMoved", x: at.x, y: at.y, button: buttons ? "left" : "none", buttons });
      await pause(G3_MOVE_MS);
    }
  };
  const press = (x, y, modifiers = 0) => {
    at = { x, y };
    send({ type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, modifiers });
  };
  const release = (modifiers = 0) => send({ type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1, modifiers });
  const wheel = (dx, dy) => send({ type: "mouseWheel", x: at.x, y: at.y, deltaX: dx, deltaY: dy });
  // I punti: nel corpo, nella colonna ferma, nella riga ferma.
  const body = (fx, fy) => ({ x: box.left + box.bandLeft + (box.width - box.bandLeft) * fx, y: box.top + box.bandTop + (box.height - box.bandTop) * fy });
  const inColumn = (fy) => ({ x: box.left + box.bandLeft * 0.6, y: box.top + box.bandTop + (box.height - box.bandTop) * fy });
  const inRow = (fx) => ({ x: box.left + box.bandLeft + (box.width - box.bandLeft) * fx, y: box.top + box.bandTop - 6 });
  /// Un punto dove premere comincia una selezione: non sul bordo della
  /// selezione di prima (che la sposterebbe) né sul quadratino (che
  /// riempirebbe). Lo dice il cursore che la griglia mette al passaggio.
  const clear = async (point) => {
    let p = point;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      at = p;
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none", buttons: 0 });
      await settle(page, 40);
      const busy = await page.evaluate(() => {
        const viewport = document.querySelector(".pane.focus .grid-viewport");
        return ["move-selection", "fill-handle", "resize-column", "resize-row"].some((name) => viewport.classList.contains(name));
      });
      if (!busy) return p;
      p = { x: p.x + 14, y: p.y + 14 };
    }
    return p;
  };
  const ends = [];
  const finish = async () => {
    await Promise.all(sent.splice(0));
    await settle(page, 450);
    ends.push(await cellUnderIsCorner(page, at.x, at.y));
  };

  // Un trascinamento avanti e indietro, dentro e fuori dalla colonna e dalla
  // riga ferme, con la rotella a metà.
  const start = await clear(body(0.15, 0.2));
  press(start.x, start.y);
  for (const [point, ms] of [[body(0.8, 0.7), 220], [inColumn(0.5), 160], [body(0.5, 0.3), 120], [inRow(0.4), 140], [body(0.3, 0.6), 160], [body(0.9, 0.2), 90], [body(0.2, 0.25), 90]]) {
    await sweep(point.x, point.y, ms);
  }
  wheel(0, 240);
  await sweep(at.x + 20, at.y + 10, 80);
  wheel(160, 0);
  await sweep(at.x - 30, at.y + 30, 80);
  // Lo scorrimento della rotella può durare oltre l'ultimo movimento: col
  // tasto giù la selezione lo segue, e si rilascia a griglia ferma.
  await Promise.all(sent.splice(0));
  await page.waitForFunction(() => {
    const viewport = document.querySelector(".pane.focus .grid-viewport");
    const now = `${viewport.scrollLeft},${viewport.scrollTop}`;
    const still = window.__g3Scroll === now;
    window.__g3Scroll = now;
    return still;
  }, null, { polling: 120, timeout: 5_000 }).catch(() => {});
  release();
  await finish();
  // Inversioni fitte: avanti e indietro di molte celle, svelte.
  const second = await clear(body(0.5, 0.5));
  press(second.x, second.y);
  for (let turn = 0; turn < 6; turn += 1) {
    const far = turn % 2 === 0 ? body(0.95, 0.9) : inColumn(0.1);
    await sweep(far.x, far.y, 40);
  }
  const last = body(0.6, 0.55);
  await sweep(last.x, last.y, 30);
  release();
  await finish();
  // Maiusc+clic.
  const shift = body(0.7, 0.75);
  await sweep(shift.x, shift.y, 20, 0);
  press(shift.x, shift.y, 8);
  release(8);
  await finish();
  // Frecce svelte, poi un clic: la selezione finisce sotto il puntatore.
  for (const key of ["ArrowRight", "ArrowRight", "ArrowDown", "Shift+ArrowRight", "Shift+ArrowDown", "Control+ArrowRight", "ArrowLeft", "Control+ArrowLeft"]) {
    await page.keyboard.press(key);
  }
  const click = await clear(body(0.4, 0.4));
  await sweep(click.x, click.y, 10, 0);
  press(click.x, click.y);
  release();
  await finish();
  return ends;
}

/// g3-mouse-fitto: i quattro giri, ognuno col suo lettore dei fotogrammi.
async function denseMouse(page) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const cdp = await page.context().newCDPSession(page);
  const size = page.viewportSize();
  const lines = [];
  let ok = true;
  try {
    for (const round of G3_ROUNDS) {
      await page.setViewportSize({ width: round.width, height: size.height });
      await gridSteady(page);
      await page.evaluate(() => {
        const v = document.querySelector(".pane.focus .grid-viewport");
        v.scrollLeft = 0;
        v.scrollTop = 0;
      });
      await settle(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: round.cpu });
      await installMarksRecorder(page);
      const ends = await denseGestures(page, cdp);
      const seen = await page.evaluate(() => window.__g3Stop());
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      const bad = ["disagree", "overshoot", "backward", "outside", "corner"].filter((key) => seen[key].count > 0);
      const missed = ends.filter((end) => !end.ok);
      const good = bad.length === 0 && missed.length === 0 && seen.moving > 0;
      ok = ok && good;
      lines.push(
        `${round.width} px, CPU ${round.cpu}×: ${seen.frames} fotogrammi (${seen.moving} in moto); disaccordo ${seen.disagree.count}, oltre ${seen.overshoot.count}, indietro ${seen.backward.count}, fuori dal bordo ${seen.outside.count}, angoli ${seen.corner.count}; ${ends.map((end) => end.text).join(", ")}`
          + (bad.length ? ` [${bad.map((key) => `${key}: ${seen[key].first.join("; ")}`).join(" | ")}]` : ""),
      );
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => {});
    await page.setViewportSize(size);
  }
  return { ok, seen: lines.join(" — ") };
}

const cantieri = (control) => (Array.isArray(control.cantiere) ? control.cantiere : [control.cantiere]);
const isOn = (control) => cantieri(control).every((sigla) => ACCESI.has(sigla));

/// I controlli che salvano da sé la loro foto: il fotogramma peggiore.
const FILMED = new Set(["d42-intestazioni-durante-scorrimento", "g1-colonna-ferma", "g2-scorrere-senza-bianco"]);

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
    if (!result.skip && !FILMED.has(control.id)) {
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
