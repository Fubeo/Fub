// @vitest-environment happy-dom
// L'editor del disegno: annulla e ripeti, la cronologia, l'accessibilità, il titolo, chi lo monta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { applyOperation } from "../../core/text-operation";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { LAYER } from "./test-support";
import { SOURCE, banco, dialog, drag, key, mount, size, spoken, surface } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

describe("annulla e ripeti", () => {
  it("disfano e rifanno un gesto intero, dalla tastiera", () => {
    mount();
    banco.editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    const drawn = banco.editor.engine.text;
    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Annullato: Rettangolo.");
    key("z", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toBe(drawn);
    expect(spoken()).toBe("Ripetuto: Rettangolo.");
    key("z", { ctrlKey: true });
    // Col foglio a fuoco Ctrl+Y è la vista dei contorni, e non ripete.
    key("y", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(SOURCE);
    key("y", { ctrlKey: true });
    key("z", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toBe(drawn);
    expect(banco.changes.map((change) => change.origin)).toEqual(["input", "undo", "redo", "undo", "redo"]);
  });

  it("la selezione segue ciò che il passo ha toccato", () => {
    mount();
    banco.editor.select(["o1a2b3c4d"]);
    banco.editor.deleteSelection();
    expect(banco.editor.selection).toEqual([]);
    banco.editor.undo();
    expect(banco.editor.selection).toEqual(["o1a2b3c4d"]);
  });

  it("restano quando il documento si ricostruisce dal testo", () => {
    mount();
    banco.editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    banco.editor.setEngine(SceneEngine.open(banco.editor.engine.text));
    expect(banco.editor.canUndo).toBe(true);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(SOURCE);
  });
});

describe("la cronologia, nel Completo", () => {
  const button = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Cronologia"]')!;
  const panel = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-history")!;
  const list = (): HTMLElement => panel().querySelector<HTMLElement>('[role="listbox"]')!;
  const row = (key: string): HTMLElement => panel().querySelector<HTMLElement>(`[role="option"][data-key="${key}"]`)!;
  /// Le righe, dall'alto: il nome, e `*` su quella di adesso, `~` su quelle
  /// da ripetere.
  const rows = (): string[] =>
    [...panel().querySelectorAll<HTMLElement>('[role="option"]')]
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
      .map((item) => `${item.querySelector(".draw-history-label")!.textContent}${item.getAttribute("aria-current") === "step" ? " *" : ""}${item.hasAttribute("data-ahead") ? " ~" : ""}`);

  /// Tre rettangoli, uno dopo l'altro: i testi dopo ciascuno, dal disegno
  /// aperto.
  function three(): string[] {
    const texts = [banco.editor.engine.text];
    banco.editor.setTool("rect");
    for (const y of [100, 150, 200]) {
      drag([[10, y], [40, y + 30]]);
      texts.push(banco.editor.engine.text);
    }
    return texts;
  }

  it("c'è nel Completo: il pulsante la apre a destra del foglio, e aperta prende il fuoco", () => {
    mount(SOURCE, { workspace: "simple" });
    expect(button().hidden).toBe(true);
    banco.editor.setSpace("full");
    expect(button().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel().id);
    button().click();
    expect(panel().hidden).toBe(false);
    expect(panel().closest(".draw-dock")!.hasAttribute("hidden")).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(list());
    expect(rows()).toEqual(["Disegno aperto *"]);
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    // Esc torna al foglio, e la cronologia resta aperta.
    key("Escape", {}, list());
    expect(document.activeElement).toBe(surface());
    expect(panel().hidden).toBe(false);
    button().click();
    expect(panel().hidden).toBe(true);
    expect(panel().closest(".draw-dock")!.hasAttribute("hidden")).toBe(true);
    // Nel Semplice si chiude.
    button().click();
    banco.editor.setSpace("simple");
    expect(button().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(banco.changes).toEqual([]);
  });

  it("ogni gesto è un passo; un clic su un passo ci torna in un colpo, con un cambiamento solo e gli stessi byte", () => {
    mount(SOURCE);
    button().click();
    const texts = three();
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo", "Rettangolo *"]);
    const drawn = banco.changes.length;

    row("p1").click();
    expect(banco.editor.engine.text).toBe(texts[1]);
    expect(banco.changes).toHaveLength(drawn + 1);
    expect(banco.changes[drawn]!.origin).toBe("undo");
    expect(banco.changes[drawn]!.text).toBe(texts[1]);
    expect(applyOperation(texts[3]!, banco.changes[drawn]!.operation)).toBe(texts[1]);
    expect(spoken()).toBe("Indietro fino a «Rettangolo»: 2 passi annullati.");
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo *", "Rettangolo ~", "Rettangolo ~"]);
    expect(banco.editor.canRedo).toBe(true);

    row("p3").click();
    expect(banco.editor.engine.text).toBe(texts[3]);
    expect(banco.changes).toHaveLength(drawn + 2);
    expect(banco.changes[drawn + 1]!.origin).toBe("redo");
    expect(applyOperation(texts[1]!, banco.changes[drawn + 1]!.operation)).toBe(texts[3]);
    expect(spoken()).toBe("Avanti fino a «Rettangolo»: 2 passi ripetuti.");
    // La selezione segue l'ultimo passo del salto, come dopo un ripeti.
    const third = [...texts[3]!.matchAll(/<rect id="([^"]+)"/g)].map((match) => match[1]!).find((id) => !texts[2]!.includes(id))!;
    expect(banco.editor.selection).toEqual([third]);

    row("p0").click();
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(spoken()).toBe("Indietro fino all’apertura del disegno: 3 passi annullati.");
    // Annulla e ripeti continuano da lì, e la cronologia li segue.
    key("z", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toBe(texts[1]);
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo *", "Rettangolo ~", "Rettangolo ~"]);
    // Un gesto nuovo toglie i passi da ripetere.
    drag([[100, 10], [130, 40]]);
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo *"]);
  });

  it("dalla tastiera: le frecce scelgono la riga, Invio ci va", () => {
    mount(SOURCE);
    const texts = three();
    button().click();
    key("ArrowUp", {}, list());
    key("ArrowUp", {}, list());
    expect(banco.editor.engine.text).toBe(texts[3]);
    key("Enter", {}, list());
    expect(banco.editor.engine.text).toBe(texts[1]);
    // Ctrl+Z, dall'elenco, è l'annulla di sempre.
    key("z", { ctrlKey: true }, list());
    expect(banco.editor.engine.text).toBe(SOURCE);
    expect(rows()[0]).toBe("Disegno aperto *");
  });

  it("si ferma al passo che non si annulla più, che esce dalla cronologia, e lo dice", () => {
    mount(SOURCE);
    const texts = three();
    button().click();
    // Il secondo rettangolo, altrove, se n'è andato.
    const second = [...texts[2]!.matchAll(/<rect id="([^"]+)"[^>]*\/>/g)].find((match) => !texts[1]!.includes(match[1]!))!;
    const first = [...texts[1]!.matchAll(/<rect id="([^"]+)"/g)].find((match) => !SOURCE.includes(match[1]!))![1]!;
    banco.editor.setEngine(SceneEngine.open(texts[3]!.replace(second[0], "")));
    row("p0").click();
    expect(spoken()).toBe("Indietro fino a «Rettangolo»: un passo annullato. Impossibile annullare «Rettangolo»: il disegno è cambiato nel frattempo.");
    // Il primo rettangolo resta: il salto si è fermato prima.
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo *", "Rettangolo ~"]);
    expect(banco.editor.engine.text).toContain(first);
    expect(banco.editor.engine.text).not.toContain(second[1]!);
    row("p0").click();
    expect(banco.editor.engine.text).not.toContain(first);
    expect(rows()).toEqual(["Disegno aperto *", "Rettangolo ~", "Rettangolo ~"]);
  });

  it("un segno: «Segna questo punto» lo mette dove si è, col nome da scrivere, e ci si torna", () => {
    mount(SOURCE);
    const texts = three();
    button().click();
    row("p2").click();
    panel().querySelector<HTMLButtonElement>(".draw-history-action")!.click();
    const input = panel().querySelector<HTMLInputElement>(".draw-history-rename")!;
    expect(input.value).toBe("Segno 1");
    expect(document.activeElement).toBe(input);
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo *", "Segno 1", "Rettangolo ~"]);
    input.value = "Due rettangoli";
    key("Enter", {}, input);
    expect(spoken()).toBe("Ora il segno si chiama «Due rettangoli».");
    expect(document.activeElement).toBe(list());
    // Il segno è della sessione: il documento non cambia.
    expect(banco.editor.engine.text).toBe(texts[2]);

    row("p0").click();
    row("m1").click();
    expect(banco.editor.engine.text).toBe(texts[2]);
    expect(spoken()).toBe("Avanti fino al segno «Due rettangoli»: 2 passi ripetuti.");

    // Il prossimo segno ha il numero dopo; Canc lo toglie.
    panel().querySelector<HTMLButtonElement>(".draw-history-action")!.click();
    expect(panel().querySelector<HTMLInputElement>(".draw-history-rename")!.value).toBe("Segno 2");
    key("Escape", {}, panel().querySelector<HTMLInputElement>(".draw-history-rename")!);
    key("Delete", {}, list());
    expect(spoken()).toBe("Segno «Segno 2» tolto.");
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo *", "Due rettangoli", "Rettangolo ~"]);

    // Un gesto nuovo, prima del segno, lo toglie con i passi da ripetere.
    key("z", { ctrlKey: true });
    drag([[100, 10], [130, 40]]);
    expect(rows()).toEqual(["Disegno aperto", "Rettangolo", "Rettangolo *"]);
  });

  it("in sola lettura si guarda soltanto", () => {
    mount(SOURCE);
    const texts = three();
    button().click();
    banco.editor.setReadOnly(true);
    expect(list().getAttribute("aria-disabled")).toBe("true");
    expect(panel().querySelector<HTMLButtonElement>(".draw-history-action")!.disabled).toBe(true);
    const before = banco.changes.length;
    row("p1").click();
    key("Enter", {}, list());
    expect(banco.editor.engine.text).toBe(texts[3]);
    expect(banco.changes).toHaveLength(before);
    banco.editor.setReadOnly(false);
    row("p1").click();
    expect(banco.editor.engine.text).toBe(texts[1]);
  });

  it("un altro disegno ricomincia da capo, senza segni", () => {
    mount(SOURCE);
    three();
    button().click();
    panel().querySelector<HTMLButtonElement>(".draw-history-action")!.click();
    banco.editor.load(SceneEngine.open(SOURCE));
    expect(rows()).toEqual(["Disegno aperto *"]);
    expect(panel().querySelector(".draw-history-count")!.textContent).toBe("0 passi");
  });

  it("«?» elenca i tasti della cronologia", () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    const tables = [...dialog().querySelectorAll(".keys-list > table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((one) => [one.querySelector("th")!.textContent, one.querySelector("td")!.textContent]),
    }));
    expect(tables.find((table) => table.caption === "Cronologia")?.rows).toEqual([
      ["Enter o Space", "Nella cronologia, torna o va avanti fino alla riga"],
      ["F2", "Nella cronologia, cambia il nome del segno"],
      ["Del", "Nella cronologia, toglie il segno"],
      ["Esc", "Dalla cronologia torna al foglio"],
    ]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("la verifica dell'accessibilità, nel Completo", () => {
  const button = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Accessibilità"]')!;
  const panel = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-access")!;
  const rows = (): HTMLElement[] => [...panel().querySelectorAll<HTMLElement>(".draw-access-problem")];
  /// I problemi, dall'alto, come si leggono.
  const problems = (): string[] => rows().map((row) => row.querySelector(".draw-access-what")!.textContent!);
  const action = (at: number, name: string): HTMLButtonElement => rows()[at]!.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  const tree = (): HTMLElement => panel().querySelector<HTMLElement>('[role="tree"]')!;
  const item = (name: string): HTMLElement => [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].find((each) => each.textContent === name)!;
  const active = (): string | null => document.getElementById(tree().getAttribute("aria-activedescendant") ?? "")?.textContent ?? null;
  const warning = (): HTMLElement => panel().querySelector<HTMLElement>(".draw-access-warning")!;
  const ids = (): string[] => [...banco.editor.engine.text.matchAll(/<(?:rect|text|image) id="([^"]+)"/g)].map((found) => found[1]!);

  /// Un testo giallo su bianco, scritto come lo scrive l'editor, e
  /// un'immagine senza descrizione, in un disegno senza titolo.
  const SUN = `<text id="o1a1a1a1a" x="10" y="20" fill="#f0e442">\n  <tspan x="10" dy="0">Sole</tspan>\n</text>`;
  const PHOTO = `<image id="o2b2b2b2b" x="0" y="30" width="10" height="10" href="foto.png"/>`;
  const POOR = doc(`${LAYER}${SUN}${PHOTO}</g>`);
  /// Due quadrati che si sovrappongono e uno lontano, in un disegno che si
  /// legge.
  const STACK = doc(
    `<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="0" y="0" width="20" height="20"/><rect id="ob2b2b2b2" x="10" y="10" width="20" height="20"/>` +
      `<rect id="oc3c3c3c3" x="100" y="100" width="20" height="20"/></g>`,
  );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("c'è nel Completo: il pulsante la apre a destra del foglio, e aperta legge il disegno e prende il fuoco", () => {
    mount(POOR, { workspace: "simple" });
    expect(button().hidden).toBe(true);
    banco.editor.setSpace("full");
    expect(button().hidden).toBe(false);
    expect(panel().hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel().id);
    button().click();
    expect(panel().hidden).toBe(false);
    expect(panel().closest(".draw-dock")!.hasAttribute("hidden")).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(problems()).toEqual(["Avviso: Il disegno non ha un titolo", "Nota: Un testo si legge poco", "Avviso: Un’immagine non ha una descrizione"]);
    expect(panel().querySelector(".draw-access-count")!.textContent).toBe("3 problemi");
    expect(document.activeElement).toBe(action(0, "fix"));
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    // Esc torna al foglio, e la verifica resta aperta.
    key("Escape", {}, action(0, "fix"));
    expect(document.activeElement).toBe(surface());
    expect(panel().hidden).toBe(false);
    button().click();
    expect(panel().hidden).toBe(true);
    expect(panel().closest(".draw-dock")!.hasAttribute("hidden")).toBe(true);
    // Nel Semplice si chiude.
    button().click();
    banco.editor.setSpace("simple");
    expect(button().hidden).toBe(true);
    expect(panel().hidden).toBe(true);
    expect(banco.changes).toEqual([]);
  });

  it("un colore che si legge si mette in un passo; il fuoco passa al problema dopo, e un annulla lo riporta", () => {
    mount(POOR);
    button().click();
    const color = action(1, "fix");
    expect(color.textContent).toMatch(/^Usa #[0-9a-f]{6} \(4,\d\d:1\)$/);
    const chosen = color.textContent!.slice(4, 11);
    color.focus();
    color.click();
    expect(banco.changes).toHaveLength(1);
    expect(banco.editor.engine.text).toBe(POOR.replace('fill="#f0e442"', `fill="${chosen}"`));
    expect(spoken()).toMatch(new RegExp(`ora usa ${chosen}: contrasto 4,\\d\\d:1\\.$`));
    expect(problems()).toEqual(["Avviso: Il disegno non ha un titolo", "Avviso: Un’immagine non ha una descrizione"]);
    expect(document.activeElement).toBe(action(1, "describe"));
    // L'annulla di sempre; la verifica rilegge il disegno un momento dopo.
    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(POOR);
    expect(problems()).toHaveLength(2);
    vi.advanceTimersByTime(250);
    expect(problems()).toHaveLength(3);
  });

  it("una correzione su un disegno che intanto è cambiato si rilegge: se il problema non c'è più, non fa niente", () => {
    mount(POOR);
    button().click();
    banco.editor.setEngine(SceneEngine.open(POOR.replace('fill="#f0e442"', 'fill="#222222"')));
    // Il disegno nuovo non si è ancora riletto: la riga c'è ancora.
    expect(problems()).toHaveLength(3);
    const before = banco.changes.length;
    action(1, "fix").click();
    expect(banco.changes).toHaveLength(before);
    expect(banco.editor.engine.text).toContain('fill="#222222"');
    expect(problems()).toEqual(["Avviso: Il disegno non ha un titolo", "Avviso: Un’immagine non ha una descrizione"]);
  });

  it("«Scrivi il titolo» porta al campo del titolo", () => {
    mount(POOR);
    button().click();
    action(0, "fix").click();
    const input = banco.host.querySelector<HTMLInputElement>(".draw-title-input")!;
    expect(document.activeElement).toBe(input);
    input.value = "Il porto";
    input.dispatchEvent(new Event("change"));
    vi.advanceTimersByTime(250);
    expect(problems()).toEqual(["Nota: Un testo si legge poco", "Avviso: Un’immagine non ha una descrizione"]);
  });

  it("un'immagine si descrive nella riga, o si dichiara decorativa, ciascuna in un passo", () => {
    mount(POOR);
    button().click();
    action(2, "describe").click();
    const field = panel().querySelector<HTMLInputElement>(".draw-access-describe")!;
    expect(document.activeElement).toBe(field);
    field.value = "Il porto al tramonto";
    key("Enter", {}, field);
    expect(banco.changes).toHaveLength(1);
    expect(banco.editor.engine.text).toContain("Il porto al tramonto");
    expect(spoken()).toBe("Descrizione scritta: «Il porto al tramonto».");
    expect(problems()).toEqual(["Avviso: Il disegno non ha un titolo", "Nota: Un testo si legge poco"]);
    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(POOR);
    vi.advanceTimersByTime(250);
    action(2, "decorative").click();
    expect(banco.editor.engine.text).toBe(POOR.replace('href="foto.png"/>', 'href="foto.png" aria-hidden="true"/>'));
    expect(spoken()).toMatch(/è decorativa: lo screen reader la salta\.$/);
    expect(problems()).toHaveLength(2);
  });

  it("un oggetto bloccato non si corregge da qui: ci si va, e si dice perché", () => {
    mount(POOR.replace('<text id="o1a1a1a1a"', '<text id="o1a1a1a1a" fub:locked="true"'));
    button().click();
    expect(action(1, "fix")).toBeNull();
    action(1, "go").click();
    expect(spoken()).toMatch(/non si sceglie: è bloccato, nascosto o fuori dal gruppo isolato\.$/);
    expect(banco.editor.selection).toEqual([]);
  });

  it("in sola lettura i problemi si guardano soltanto", () => {
    mount(POOR);
    button().click();
    banco.editor.setReadOnly(true);
    expect(panel().querySelector<HTMLElement>(".draw-access-note")!.hidden).toBe(false);
    expect(rows().map((row) => row.querySelectorAll('[data-action]:not([data-action="go"])').length)).toEqual([0, 0, 0]);
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
  });

  it("l'ordine di lettura: un clic sceglie l'oggetto, Alt+↓ lo sposta, e se passerebbe sopra un vicino che copre prima lo dice", () => {
    mount(STACK);
    button().click();
    expect(panel().querySelector(".draw-access-count")!.textContent).toBe("nessun problema");
    expect(document.activeElement).toBe(tree());
    const [first, second, third] = ["oa1a1a1a1", "ob2b2b2b2", "oc3c3c3c3"];
    const name = (key: string): string => [...tree().querySelectorAll<HTMLElement>('[role="treeitem"]')].find((each) => each.id.endsWith(key))!.textContent!;
    const firstName = name(first!);
    item(firstName).click();
    expect(banco.editor.selection).toEqual([first]);
    expect(active()).toBe(firstName);
    expect(document.activeElement).toBe(tree());
    key("ArrowDown", { altKey: true }, tree());
    expect(warning().hidden).toBe(false);
    expect(warning().textContent).toMatch(/passerebbe sopra .*, che copre in parte: ripeti per spostarlo lo stesso\.$/);
    expect(banco.changes).toEqual([]);
    key("ArrowDown", { altKey: true }, tree());
    expect(ids()).toEqual([second, first, third]);
    expect(banco.changes).toHaveLength(1);
    expect(warning().hidden).toBe(true);
    expect(spoken()).toMatch(/ora si legge dopo /);
    expect(active()).toBe(firstName);
    // Il vicino lontano non copre niente: si passa subito.
    key("ArrowDown", { altKey: true }, tree());
    expect(ids()).toEqual([second, third, first]);
    // L'ultimo fra i vicini non va oltre; «Leggi prima» lo riporta.
    const [earlier, later] = [...panel().querySelectorAll<HTMLButtonElement>(".draw-access-moves > button")];
    expect(later!.disabled).toBe(true);
    earlier!.click();
    expect(ids()).toEqual([second, first, third]);
    // Ogni spostamento è un passo.
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(STACK);
  });

  it("«?» elenca i tasti della verifica", () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    const tables = [...dialog().querySelectorAll(".keys-list > table")].map((table) => ({
      caption: table.querySelector("caption")!.textContent,
      rows: [...table.querySelectorAll("tr")].map((one) => [one.querySelector("th")!.textContent, one.querySelector("td")!.textContent]),
    }));
    expect(tables.find((table) => table.caption === "Accessibilità")?.rows).toEqual([
      ["↑ o ↓ o Home o End", "Nell’ordine di lettura, l’oggetto prima o dopo, il primo o l’ultimo"],
      ["Enter o Space", "Nell’ordine di lettura, sceglie l’oggetto e lo mostra"],
      ["Alt+↑ o Alt+↓", "Nell’ordine di lettura, sposta l’oggetto prima o dopo il suo vicino"],
      ["Esc", "Dalla verifica torna al foglio"],
    ]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("il titolo", () => {
  it("si scrive con un `meta`, e vuoto si toglie", () => {
    mount();
    const input = banco.host.querySelector<HTMLInputElement>(".draw-title-input")!;
    input.value = "  Il ciclo dell'acqua ";
    input.dispatchEvent(new Event("change"));
    expect(banco.editor.engine.text).toContain("<title>Il ciclo dell'acqua</title>");
    input.value = "";
    input.dispatchEvent(new Event("change"));
    expect(banco.editor.engine.text).not.toContain("<title>");
    banco.editor.undo();
    expect(input.value).toBe("Il ciclo dell'acqua");
  });
});

describe("un documento che non si modifica", () => {
  it("si guarda e basta: la barra è spenta e i gesti non scrivono", () => {
    mount(doc(`${LAYER}<rect id="o1a2b3c4d" width="5" height="5"/></g>`).replace(' fub:version="1"', ""));
    expect(banco.editor.engine.status).not.toBe("fubdraw");
    expect(banco.host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(true);
    expect(banco.host.querySelector<HTMLButtonElement>(".draw-tool")!.disabled).toBe(true);
    expect(banco.host.querySelector<HTMLInputElement>(".draw-title-input")!.disabled).toBe(true);
    drag([[10, 10], [50, 40]]);
    key("a", { ctrlKey: true });
    key("Delete");
    expect(banco.changes).toEqual([]);
  });

  it("e un documento con ogni livello bloccato lo dice: nel Completo nomina il livello", () => {
    const LOCKED = doc('<g id="l1" fub:layer="Uno" fub:locked="true"></g>');
    mount(LOCKED, { workspace: "simple" });
    banco.editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    expect(banco.changes).toEqual([]);
    expect(spoken()).toBe("Ogni livello è bloccato o nascosto: non c’è dove disegnare.");
    banco.editor.setSpace("full");
    drag([[10, 10], [50, 40]]);
    expect(banco.changes).toEqual([]);
    expect(spoken()).toBe("«Uno» è bloccato: sbloccalo, o scegli un altro livello, per disegnare.");
  });
});

describe("per chi lo monta", () => {
  const FOREIGN = doc(`${LAYER}<rect id="o1a2b3c4d" width="5" height="5"/></g>`).replace(' fub:version="1"', "");
  const camera = (): string | null => banco.host.querySelector(".draw-preview g")!.getAttribute("transform");

  it("«Modifica» adotta un SVG estraneo in un passo che si annulla", () => {
    mount(FOREIGN);
    expect(banco.host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(true);
    expect(banco.editor.adopt()).toBe(true);
    expect(banco.editor.engine.status).toBe("fubdraw");
    expect(banco.changes.map((change) => change.origin)).toEqual(["input"]);
    expect(banco.changes[0]!.text).toContain('fub:version="1"');
    expect(spoken()).toBe("Ora il disegno si modifica.");
    expect(banco.host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(false);
    expect(banco.editor.adopt()).toBe(false);
    banco.editor.undo();
    expect(banco.editor.engine.status).toBe("foreign");
    expect(banco.editor.engine.text).toBe(FOREIGN);
    expect(spoken()).toBe("Annullato: Disegno reso modificabile.");
  });

  it("non adotta con la scrittura tolta", () => {
    mount(FOREIGN);
    banco.editor.setReadOnly(true);
    expect(banco.editor.adopt()).toBe(false);
    expect(banco.changes).toEqual([]);
  });

  it("con la scrittura tolta si guarda soltanto, e ridata torna a scrivere", () => {
    mount();
    banco.editor.setReadOnly(true);
    expect(banco.host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(true);
    expect(banco.host.querySelector<HTMLButtonElement>(".draw-tool")!.disabled).toBe(true);
    banco.editor.setTool("rect");
    drag([[10, 10], [50, 40]]);
    key("a", { ctrlKey: true });
    key("Delete");
    expect(banco.changes).toEqual([]);
    banco.editor.setReadOnly(false);
    expect(banco.host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(false);
    drag([[10, 10], [50, 40]]);
    expect(banco.changes).toHaveLength(1);
  });

  it("un documento nuovo azzera cronologia e selezione", () => {
    mount();
    banco.editor.select(["o1a2b3c4d"]);
    key("Delete");
    expect(banco.editor.canUndo).toBe(true);
    const next = doc(`${LAYER}<ellipse id="o5e6f7a8b" cx="20" cy="20" rx="5" ry="5"/></g>`);
    banco.editor.load(SceneEngine.open(next));
    expect(banco.editor.engine.text).toBe(next);
    expect(banco.editor.canUndo).toBe(false);
    expect(banco.editor.canRedo).toBe(false);
    expect(banco.editor.selection).toEqual([]);
  });

  it("un documento in sola lettura non entra nell'editor", () => {
    mount();
    const inert = SceneEngine.open(`<!DOCTYPE svg>${SOURCE}`);
    expect(inert.model).toBeNull();
    expect(() => banco.editor.setEngine(inert)).toThrow();
    expect(() => banco.editor.load(inert)).toThrow();
    expect(banco.editor.engine.text).toBe(SOURCE);
  });

  it("dice quando la selezione cambia, una volta per cambiamento", () => {
    let calls = 0;
    mount(SOURCE, { onSelectionChange: () => calls++ });
    banco.editor.select(["o1a2b3c4d"]);
    banco.editor.select(["o1a2b3c4d"]);
    expect(calls).toBe(1);
    key("Escape");
    expect(calls).toBe(2);
  });

  it("`reveal` sceglie l'oggetto che contiene il byte, e niente fuori dagli oggetti", () => {
    mount();
    const rect = new TextEncoder().encode(SOURCE.slice(0, SOURCE.indexOf("<rect"))).length;
    expect(banco.editor.reveal(rect + 4)).toBe(true);
    expect(banco.editor.selection).toEqual(["o1a2b3c4d"]);
    expect(spoken()).toBe("1 oggetto scelto.");
    banco.editor.select([]);
    expect(banco.editor.reveal(SOURCE.indexOf("<title>") + 2)).toBe(false);
    expect(banco.editor.reveal(SOURCE.indexOf('<g id="l1"') + 2)).toBe(false);
    expect(banco.editor.selection).toEqual([]);
  });

  it("`reveal` di un oggetto senza id lo sceglie per percorso", () => {
    const source = doc(`${LAYER}<rect width="5" height="5"/><rect x="10" width="5" height="5"/></g>`);
    mount(source);
    expect(banco.editor.reveal(source.lastIndexOf("<rect") + 1)).toBe(true);
    expect(banco.editor.selection).toEqual(["@0.1"]);
  });

  it("`reveal` lascia ferma la vista se l'oggetto si vede, se no lo porta al centro o lo inquadra", () => {
    const source = doc(
      `${LAYER}<rect id="oa1a1a1a1" x="60" y="60" width="20" height="20" fill="#000000"/>` +
        `<rect id="ob2b2b2b2" x="60" y="150" width="20" height="20" fill="#000000"/>` +
        `<rect id="oc3c3c3c3" x="0" y="400" width="1000" height="200" fill="#000000"/></g>`,
    );
    mount(source);
    size(200, 100);
    const before = camera();
    expect(banco.editor.reveal(source.indexOf("oa1a1a1a1"))).toBe(true);
    expect(camera()).toBe(before);
    expect(banco.editor.reveal(source.indexOf("ob2b2b2b2"))).toBe(true);
    expect(camera()).toBe("matrix(1 0 0 1 30 -110)");
    expect(banco.editor.reveal(source.indexOf("oc3c3c3c3"))).toBe(true);
    const [scale] = camera()!.slice("matrix(".length).split(" ").map(Number);
    expect(scale).toBeLessThan(1);
  });
});
