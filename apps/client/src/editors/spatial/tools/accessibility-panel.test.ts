// @vitest-environment happy-dom
// La verifica dell'accessibilità come pannello, da sola: i problemi con la
// gravità detta a parole, le correzioni e il fuoco che passa alla riga dopo,
// la descrizione scritta nella riga, la sola lettura, le pagine di problemi e
// l'ordine di lettura con la sua tastiera.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { outline } from "../describe";
import { readScene } from "../scene/read";
import { doc } from "../scene/test-support";
import { createAccessPanel, type AccessPanel, type AccessView } from "./accessibility-panel";
import { readingOrder, type Problem } from "./audit";
import { LAYER } from "./test-support";

const SOURCE = doc(
  `${LAYER}<rect id="oa1a1a1a1" x="0" y="0" width="5" height="5"/><g id="og1g1g1g1"><rect id="ob2b2b2b2" x="10" y="0" width="5" height="5"/>` +
    `<rect id="oc3c3c3c3" x="20" y="0" width="5" height="5"/></g></g>`,
);

const TITLE: Problem = { code: "S001", severity: "warning", key: null, role: null, detail: null, threshold: null, fix: { kind: "title" } };
const SUN: Problem = {
  code: "S009",
  severity: "info",
  key: "oa1a1a1a1",
  role: "text",
  detail: "1.32",
  threshold: 4.5,
  fix: { kind: "color", color: "#7a7100", paint: "fill", ratio: 4.5123 },
};
const PHOTO: Problem = { code: "S012", severity: "warning", key: "ob2b2b2b2", role: "image", detail: null, threshold: null, fix: { kind: "describe" } };
const NOTE: Problem = { code: "S013", severity: "info", key: "oc3c3c3c3", role: "text", detail: "8.00", threshold: null, fix: { kind: "size", size: 12 } };
/// Due colori di codice che si distinguono soltanto per la tinta: tre aree del
/// primo, la prima è l'oggetto della riga.
const CODE: Problem = {
  code: "S017",
  severity: "info",
  key: "oa1a1a1a1",
  role: "rect",
  detail: "#88b4d2 #a6cee3 1.32",
  threshold: 3,
  fix: { kind: "hatch", color: "#88b4d2", keys: ["oa1a1a1a1", "ob2b2b2b2", "oc3c3c3c3"] },
};

let host: HTMLElement;
let life: Lifetime;
let panel: AccessPanel;
let state: { problems: Problem[]; selected: string | null; editable: boolean };
let calls: string[];
/// Ciò che `onMove` risponde: l'avviso, o niente.
let warn: string | null;

const reading = readingOrder(outline(readScene(SOURCE).items));
const view = (): AccessView => ({ ...state, reading, nameOf: (key) => `Nome ${key}` });

function mount(more: Partial<typeof state> = {}): AccessPanel {
  state = { problems: [TITLE, SUN, PHOTO, NOTE], selected: null, editable: true, ...more };
  panel = createAccessPanel(life, {
    onGo: (key) => calls.push(`go ${key}`),
    onFix: (problem) => calls.push(`fix ${problem.code} ${problem.key}`),
    onDescribe: (key, text) => calls.push(`describe ${key} ${text}`),
    onDecorative: (key) => calls.push(`decorative ${key}`),
    onMove: (key, later, confirmed) => {
      calls.push(`move ${key} ${later ? "later" : "earlier"}${confirmed ? " confirmed" : ""}`);
      return confirmed ? null : warn;
    },
    onLeave: () => calls.push("leave"),
  });
  host.append(panel.element);
  panel.update(view());
  return panel;
}

const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".draw-access-problem")];
const buttonsOf = (row: HTMLElement): string[] => [...row.querySelectorAll<HTMLElement>("button, input")].map((each) => each.textContent || (each as HTMLInputElement).placeholder);
const tree = (): HTMLElement => host.querySelector<HTMLElement>('[role="tree"]')!;
const active = (): HTMLElement | null => document.getElementById(tree().getAttribute("aria-activedescendant") ?? "");
const warning = (): HTMLElement => host.querySelector<HTMLElement>(".draw-access-warning")!;
const [earlier, later] = [0, 1].map((at) => (): HTMLButtonElement => host.querySelectorAll<HTMLButtonElement>(".draw-access-moves > button")[at]!);

function key(name: string, init: KeyboardEventInit = {}, target: Element = tree()): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  calls = [];
  warn = null;
});

afterEach(() => {
  life.close();
  host.remove();
  vi.unstubAllGlobals();
});

describe("i problemi", () => {
  it("dicono la gravità a parole, il titolo, il dettaglio, l'oggetto e la correzione", () => {
    mount();
    expect(host.querySelector("h2")!.textContent).toBe("Accessibilità");
    expect(panel.element.getAttribute("aria-labelledby")).toBe(host.querySelector("h2")!.id);
    expect(host.querySelector(".draw-access-count")!.textContent).toBe("4 problemi");
    expect(host.querySelector<HTMLElement>(".draw-access-empty")!.hidden).toBe(true);
    expect(rows().map((row) => [row.dataset.severity, row.querySelector(".draw-access-what")!.textContent, row.querySelector(".draw-access-detail")!.textContent])).toEqual([
      ["warning", "Avviso: Il disegno non ha un titolo", "Il titolo è il nome con cui uno screen reader presenta il disegno."],
      ["info", "Nota: Un testo si legge poco", "Contrasto 1,32:1 col fondo; ne serve almeno 4,5:1."],
      ["warning", "Avviso: Un’immagine non ha una descrizione", "Chi non la vede non sa che cosa mostra. Se è solo un ornamento, dichiarala decorativa."],
      ["info", "Nota: Un testo è molto piccolo", "A grandezza naturale è alto 8 px; sotto i 12 px si legge a fatica."],
    ]);
    expect(rows().map(buttonsOf)).toEqual([
      ["Scrivi il titolo"],
      ["Nome oa1a1a1a1", "Usa #7a7100 (4,51:1)"],
      ["Nome ob2b2b2b2", "Descrivi…", "Decorativa"],
      ["Nome oc3c3c3c3", "Porta a 12 px"],
    ]);
    // Il colore dice anche il campione, che è solo per gli occhi; il nome
    // del pulsante lo dice per intero.
    const color = rows()[1]!.querySelector<HTMLButtonElement>('[data-action="fix"]')!;
    expect(color.getAttribute("aria-label")).toBe("Usa il colore #7a7100, con contrasto 4,51 a 1");
    expect(color.querySelector(".draw-access-swatch")!.getAttribute("aria-hidden")).toBe("true");
    expect(rows()[0]!.querySelector(".draw-access-glyph")!.getAttribute("aria-hidden")).toBe("true");
    expect(rows()[1]!.querySelector('[data-action="go"]')!.getAttribute("aria-label")).toBe("Vai a Nome oa1a1a1a1");
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("due colori che si distinguono soltanto per la tinta: i campioni, il testo e una campitura per tutte le aree", () => {
    mount({ problems: [CODE] });
    const row = rows()[0]!;
    expect(row.dataset.severity).toBe("info");
    expect(row.querySelector(".draw-access-what")!.textContent).toBe("Nota: Due colori si distinguono solo per la tinta");
    // I campioni sono per gli occhi; il testo dice i colori per esteso.
    const detail = row.querySelector<HTMLElement>(".draw-access-detail")!;
    expect(detail.textContent).toBe(
      "Le aree di colore #88b4d2 e quelle di colore #a6cee3 hanno un contrasto di 1,32:1, ne servono almeno 3:1: chi non vede le tinte non sa quali vanno insieme.",
    );
    const chips = [...detail.querySelectorAll<HTMLElement>(".draw-access-swatch")];
    expect(chips.map((chip) => [chip.style.background, chip.getAttribute("aria-hidden")])).toEqual([
      ["#88b4d2", "true"],
      ["#a6cee3", "true"],
    ]);
    expect(buttonsOf(row)).toEqual(["Nome oa1a1a1a1", "Dai una campitura"]);
    const fix = row.querySelector<HTMLButtonElement>('[data-action="fix"]')!;
    expect(fix.getAttribute("aria-label")).toBe("Dai una campitura alle 3 aree di colore #88b4d2");
    fix.click();
    expect(calls).toEqual(["fix S017 oa1a1a1a1"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("una campitura per un'area sola, in sola lettura nessuna, e in inglese le parole dell'inglese", () => {
    mount({ problems: [{ ...CODE, fix: { kind: "hatch", color: "#88b4d2", keys: ["oa1a1a1a1"] } }] });
    expect(rows()[0]!.querySelector('[data-action="fix"]')!.getAttribute("aria-label")).toBe("Dai una campitura all’area di colore #88b4d2");
    vi.stubGlobal("navigator", { language: "en-GB" });
    panel.relabel();
    expect(rows()[0]!.querySelector(".draw-access-what")!.textContent).toBe("Note: Two colors are told apart only by hue");
    expect(rows()[0]!.querySelector(".draw-access-detail")!.textContent).toBe(
      "Areas of color #88b4d2 and areas of color #a6cee3 have a contrast of 1.32:1, at least 3:1 is needed: someone who can’t see hues can’t tell which go together.",
    );
    const fix = rows()[0]!.querySelector<HTMLButtonElement>('[data-action="fix"]')!;
    expect([fix.textContent, fix.getAttribute("aria-label")]).toEqual(["Add a hatch", "Add a hatch to the area of color #88b4d2"]);
    state.problems = [CODE];
    panel.update(view());
    expect(rows()[0]!.querySelector('[data-action="fix"]')!.getAttribute("aria-label")).toBe("Add a hatch to the 3 areas of color #88b4d2");
    state.editable = false;
    panel.update(view());
    expect(buttonsOf(rows()[0]!)).toEqual(["Nome oa1a1a1a1"]);
  });

  it("i pulsanti portano all'oggetto e correggono; il fuoco passa alla riga che prende il posto", () => {
    mount();
    rows()[1]!.querySelector<HTMLButtonElement>('[data-action="go"]')!.click();
    const fix = rows()[1]!.querySelector<HTMLButtonElement>('[data-action="fix"]')!;
    fix.focus();
    fix.click();
    rows()[2]!.querySelector<HTMLButtonElement>('[data-action="decorative"]')!.click();
    expect(calls).toEqual(["go oa1a1a1a1", "fix S009 oa1a1a1a1", "decorative ob2b2b2b2"]);
    // Corretto il colore, la riga se ne va: il fuoco va alla correzione
    // della riga dopo, che ora ha il suo posto.
    state.problems = [TITLE, PHOTO, NOTE];
    panel.update(view());
    expect(document.activeElement).toBe(rows()[1]!.querySelector('[data-action="describe"]'));
    // L'ultimo problema corretto: il fuoco va all'intestazione.
    state.problems = [NOTE];
    panel.update(view());
    rows()[0]!.querySelector<HTMLButtonElement>('[data-action="fix"]')!.focus();
    state.problems = [];
    panel.update(view());
    expect(document.activeElement).toBe(host.querySelector("h2"));
    expect(host.querySelector(".draw-access-count")!.textContent).toBe("nessun problema");
    expect(host.querySelector<HTMLElement>(".draw-access-empty")!.hidden).toBe(false);
  });

  it("una descrizione si scrive nella riga: Invio la scrive, Esc lascia com'era", () => {
    mount();
    rows()[2]!.querySelector<HTMLButtonElement>('[data-action="describe"]')!.click();
    const field = (): HTMLInputElement | null => host.querySelector<HTMLInputElement>(".draw-access-describe");
    expect(document.activeElement).toBe(field());
    expect(field()!.getAttribute("aria-label")).toBe("Descrizione di Nome ob2b2b2b2");
    field()!.value = "  Il porto   al tramonto ";
    expect(key("Enter", {}, field()!).defaultPrevented).toBe(true);
    expect(calls).toEqual(["describe ob2b2b2b2 Il porto al tramonto"]);
    expect(field()).toBeNull();
    // Esc: niente, e il fuoco torna su «Descrivi…».
    rows()[2]!.querySelector<HTMLButtonElement>('[data-action="describe"]')!.click();
    field()!.value = "Altro";
    key("Escape", {}, field()!);
    expect(calls).toHaveLength(1);
    expect(field()).toBeNull();
    expect(document.activeElement).toBe(rows()[2]!.querySelector('[data-action="describe"]'));
    // Uscire dal campo con qualcosa scritto lo scrive; vuoto, no.
    rows()[2]!.querySelector<HTMLButtonElement>('[data-action="describe"]')!.click();
    field()!.value = "Barche";
    field()!.blur();
    expect(calls).toEqual(["describe ob2b2b2b2 Il porto al tramonto", "describe ob2b2b2b2 Barche"]);
    rows()[2]!.querySelector<HTMLButtonElement>('[data-action="describe"]')!.click();
    field()!.blur();
    expect(calls).toHaveLength(2);
  });

  it("il campo resta finché l'immagine ha il problema, e il disegno può cambiare intanto", () => {
    mount();
    rows()[2]!.querySelector<HTMLButtonElement>('[data-action="describe"]')!.click();
    const field = host.querySelector<HTMLInputElement>(".draw-access-describe")!;
    field.value = "Mezza";
    state.problems = [PHOTO, NOTE];
    panel.update(view());
    expect(host.querySelector(".draw-access-describe")).toBe(field);
    expect(field.value).toBe("Mezza");
    state.problems = [NOTE];
    panel.update(view());
    expect(host.querySelector(".draw-access-describe")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("in sola lettura si vedono e portano all'oggetto, ma non si correggono", () => {
    mount({ editable: false });
    expect(host.querySelector<HTMLElement>(".draw-access-note")!.hidden).toBe(false);
    expect(rows().map(buttonsOf)).toEqual([[], ["Nome oa1a1a1a1"], ["Nome ob2b2b2b2"], ["Nome oc3c3c3c3"]]);
    expect(later().disabled).toBe(true);
    rows()[3]!.querySelector<HTMLButtonElement>('[data-action="go"]')!.click();
    expect(calls).toEqual(["go oc3c3c3c3"]);
  });

  it("un problema senza correzione porta comunque all'oggetto", () => {
    mount({ problems: [{ ...SUN, fix: null }] });
    expect(rows().map(buttonsOf)).toEqual([["Nome oa1a1a1a1"]]);
    rows()[0]!.querySelector<HTMLButtonElement>('[data-action="go"]')!.click();
    expect(calls).toEqual(["go oa1a1a1a1"]);
  });

  it("si mostrano cento alla volta", () => {
    const many = Array.from({ length: 150 }, (_, at): Problem => ({ ...NOTE, key: `@0.${at}` }));
    mount({ problems: many });
    expect(rows()).toHaveLength(100);
    const more = host.querySelector<HTMLButtonElement>(".draw-access-more")!;
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe("Mostra altri 50 di 150");
    more.click();
    expect(rows()).toHaveLength(150);
    expect(more.hidden).toBe(true);
    expect(document.activeElement).toBe(rows()[100]!.querySelector("button"));
  });
});

describe("l'ordine di lettura", () => {
  it("è un albero coi livelli, e la riga attiva segue l'oggetto scelto", () => {
    mount({ selected: "ob2b2b2b2" });
    const items = [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    expect(items.map((item) => [item.textContent, item.getAttribute("aria-level"), item.getAttribute("aria-expanded")])).toEqual([
      ["Nome l1", "1", "true"],
      ["Nome oa1a1a1a1", "2", null],
      ["Nome og1g1g1g1", "2", "true"],
      ["Nome ob2b2b2b2", "3", null],
      ["Nome oc3c3c3c3", "3", null],
    ]);
    expect(active()!.textContent).toBe("Nome ob2b2b2b2");
    expect(active()!.getAttribute("aria-selected")).toBe("true");
    state.selected = "oa1a1a1a1";
    panel.update(view());
    expect(active()!.textContent).toBe("Nome oa1a1a1a1");
  });

  it("le frecce muovono la riga attiva, Invio sceglie, Esc torna al foglio", () => {
    mount();
    expect(active()!.textContent).toBe("Nome l1");
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    key("ArrowDown");
    expect(active()!.textContent).toBe("Nome og1g1g1g1");
    key("End");
    expect(active()!.textContent).toBe("Nome oc3c3c3c3");
    key("Home");
    key("ArrowUp");
    expect(active()!.textContent).toBe("Nome l1");
    key("PageDown");
    expect(active()!.textContent).toBe("Nome oc3c3c3c3");
    key("Enter");
    key("Escape");
    expect(calls).toEqual(["go oc3c3c3c3", "leave"]);
    // Un altro tasto non è suo.
    expect(key("a").defaultPrevented).toBe(false);
  });

  it("Alt e le frecce spostano l'oggetto fra i suoi vicini; un livello e i capi no", () => {
    mount({ selected: "ob2b2b2b2" });
    expect(earlier().disabled).toBe(true);
    expect(later().disabled).toBe(false);
    expect(later().getAttribute("aria-keyshortcuts")).toBe("Alt+ArrowDown");
    key("ArrowDown", { altKey: true });
    key("ArrowUp", { altKey: true });
    later().click();
    expect(calls).toEqual(["move ob2b2b2b2 later", "move ob2b2b2b2 later"]);
    // Il livello non si sposta da qui.
    key("Home");
    expect(earlier().disabled).toBe(true);
    expect(later().disabled).toBe(true);
    key("ArrowDown", { altKey: true });
    expect(calls).toHaveLength(2);
  });

  it("uno spostamento che cambia ciò che si vede sopra avvisa, e ripetuto si fa", () => {
    mount({ selected: "oa1a1a1a1" });
    warn = "Passerebbe sopra";
    key("ArrowDown", { altKey: true });
    expect(warning().hidden).toBe(false);
    expect(warning().textContent).toBe("Passerebbe sopra");
    key("ArrowDown", { altKey: true });
    expect(calls).toEqual(["move oa1a1a1a1 later", "move oa1a1a1a1 later confirmed"]);
    expect(warning().hidden).toBe(true);
    // Muovere la riga attiva dimentica l'avviso: si ricomincia.
    key("ArrowDown", { altKey: true });
    key("ArrowDown");
    key("ArrowUp");
    key("ArrowDown", { altKey: true });
    expect(calls.slice(2)).toEqual(["move oa1a1a1a1 later", "move oa1a1a1a1 later"]);
  });

  it("un clic su una riga la fa attiva e sceglie l'oggetto", () => {
    mount();
    const item = [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].find((each) => each.textContent === "Nome oc3c3c3c3")!;
    item.click();
    expect(calls).toEqual(["go oc3c3c3c3"]);
    expect(active()).toBe(item);
    expect(document.activeElement).toBe(tree());
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });
});
