// @vitest-environment happy-dom
// L'editor del disegno: disporre nel Completo, i collegamenti a una nota.
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";
import { doc } from "../scene/test-support";
import { appearance, LAYER } from "./test-support";
import { banco, dialog, key, mount, properties, spoken, surface } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

describe("disporre, nel Completo", () => {
  /// Tre rettangoli pieni senza contorno: i loro riquadri sono quelli scritti.
  const ROW = doc(
    `<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="10" fill="#0072b2"/>` +
      `<rect id="ob2b2b2b2" x="40" y="40" width="10" height="10" fill="#000000"/>` +
      `<rect id="oc3c3c3c3" x="80" y="20" width="10" height="20" fill="#d55e00"/></g>`,
  );
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const C = "oc3c3c3c3";

  const bar = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-arrange")!;
  const named = (label: string): HTMLButtonElement => bar().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  /// Gli id dei rettangoli, nell'ordine del file.
  const order = (): string[] => [...banco.editor.engine.text.matchAll(/<rect id="(o[a-z0-9]{8})"/g)].map((match) => match[1]!);
  /// Il menu aperto per ultimo, voce per voce: il nome, e se è spenta.
  const menu = (): HTMLButtonElement[] => {
    const open = document.querySelectorAll<HTMLElement>(".context-menu");
    return [...open[open.length - 1]!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  };
  const item = (label: string): HTMLButtonElement => menu().find((entry) => entry.querySelector(".menu-label")!.textContent === label)!;

  afterEach(() => {
    for (const open of document.querySelectorAll(".context-menu")) open.remove();
  });

  it("accanto alla selezione mostra al più sei azioni, e le altre nel «…»", () => {
    mount(ROW);
    banco.editor.select([A, B]);
    const more = named("Altri comandi");
    const shown = (): HTMLButtonElement[] =>
      [...bar().querySelectorAll<HTMLButtonElement>("button")].filter((control) => !control.hidden && !control.hasAttribute("data-more") && control !== more);
    const extra = (): HTMLButtonElement[] => [...bar().querySelectorAll<HTMLButtonElement>("button[data-more]")];
    // Senza l'Esperto (ADR 0231) le azioni di due forme stanno nella barra.
    expect(shown().length).toBeLessThanOrEqual(6);
    expect(more.hidden).toBe(extra().length === 0);
    if (extra().length > 0) {
      // Le altre non si raggiungono con le frecce: ci porta il «…».
      expect(extra().every((control) => control.tabIndex === -1)).toBe(true);
      more.click();
      expect(more.getAttribute("aria-expanded")).toBe("true");
      expect(menu().map((entry) => entry.querySelector(".menu-label")!.textContent)).toEqual(extra().map((control) => control.getAttribute("aria-label")));
      closeContextMenu();
    }
    // Con meno azioni, niente «…».
    banco.editor.setSpace("full");
    banco.editor.select([A]);
    expect(extra()).toEqual([]);
    expect(shown().length).toBeLessThanOrEqual(6);
    expect(more.hidden).toBe(true);
  });

  it("accanto alla selezione non si vede durante lo zoom con la rotella, e torna quando la rotella tace", async () => {
    mount(ROW);
    banco.editor.select([A]);
    expect(bar().hasAttribute("data-beside")).toBe(true);
    expect(bar().hasAttribute("data-gesture")).toBe(false);
    const event = new WheelEvent("wheel", { deltaY: -40, bubbles: true, cancelable: true });
    // happy-dom fa di WheelEvent un UIEvent: i tasti e il punto si danno a mano.
    for (const [name, value] of Object.entries({ ctrlKey: true, shiftKey: false, metaKey: false, clientX: 40, clientY: 40 })) Object.defineProperty(event, name, { value });
    surface().dispatchEvent(event);
    expect(bar().hasAttribute("data-gesture")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(bar().hasAttribute("data-gesture")).toBe(false);
  });

  it("la barra della selezione c'è nel Completo, con qualcosa di scelto; Alt+F10 ci va ed Esc torna al foglio", () => {
    mount(ROW, { workspace: "simple" });
    banco.editor.select([A]);
    expect(bar().hidden).toBe(true);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(false);

    banco.editor.setSpace("full");
    expect(bar().hidden).toBe(false);
    expect(bar().getAttribute("role")).toBe("toolbar");
    expect(bar().getAttribute("aria-label")).toBe("Disponi");
    // «Sposta in un livello» non serve con un livello solo, che ha già tutto.
    expect([...bar().querySelectorAll("button:not([hidden])")].map((control) => control.getAttribute("aria-label"))).toEqual([
      "Duplica",
      "Raggruppa",
      "Separa",
      "Ordine",
      "Allinea e distribuisci",
    ]);
    expect(named("Duplica").title).toBe("Duplica (Ctrl+D)");
    expect(named("Duplica").getAttribute("aria-keyshortcuts")).toBe("Control+D");
    expect(named("Ordine").getAttribute("aria-haspopup")).toBe("menu");
    // Un oggetto solo non si raggruppa, e non è un gruppo da separare.
    expect(named("Raggruppa").disabled).toBe(true);
    expect(named("Separa").disabled).toBe(true);
    const hint = document.getElementById(surface().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("Alt+F10");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");

    surface().focus();
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(named("Duplica"));
    key("ArrowRight", {}, named("Duplica"));
    expect(document.activeElement).toBe(named("Ordine"));
    key("Escape", {}, named("Ordine"));
    expect(document.activeElement).toBe(surface());
    expect(banco.editor.selection).toEqual([A]);

    banco.editor.select([]);
    expect(bar().hidden).toBe(true);
    expect(key("F10", { altKey: true }).defaultPrevented).toBe(false);
    banco.editor.select([A]);
    banco.editor.setSpace("simple");
    expect(bar().hidden).toBe(true);
    expect(hint?.textContent).not.toContain("Alt+F10");
    expect(banco.changes).toEqual([]);
  });

  it("Ctrl+D copia sopra l'originale, un passo più in là, e la selezione passa alla copia", () => {
    mount(ROW);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(false);
    banco.editor.select([A]);
    expect(key("d", { ctrlKey: true }).defaultPrevented).toBe(true);
    const [copy] = banco.editor.selection;
    expect(copy).toMatch(/^o[a-z0-9]{8}$/);
    expect(order()).toEqual([A, copy, B, C]);
    expect(banco.editor.engine.text).toContain(`<rect id="${copy}" x="10" y="10" width="20" height="10" fill="#0072b2" transform="matrix(1 0 0 1 24 24)"/>`);
    expect(spoken()).toBe("1 oggetto duplicato. Il disegno ha 4 oggetti.");
    // Un secondo Ctrl+D prosegue la fila, dalla copia.
    named("Duplica").click();
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 48 48)"/>');
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(ROW);
    expect(spoken()).toBe("Annullato: Duplicazione.");
  });

  it("Ctrl+G raggruppa al posto del più alto, e Ctrl+Maiusc+G separa", () => {
    mount(ROW);
    banco.editor.select([A, C]);
    expect(named("Raggruppa").disabled).toBe(false);
    key("g", { ctrlKey: true });
    const [group] = banco.editor.selection;
    expect(banco.editor.engine.text).toMatch(new RegExp(`<rect id="${B}"[^>]*/>\\s*<g id="${group}">\\s*<rect id="${A}"[^>]*/>\\s*<rect id="${C}"[^>]*/>\\s*</g>`));
    expect(spoken()).toBe("Gruppo di 2 oggetti.");
    expect(named("Raggruppa").disabled).toBe(true);
    expect(named("Separa").disabled).toBe(false);

    key("G", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).not.toContain(`id="${group}"`);
    expect(banco.editor.engine.text).not.toContain("transform");
    expect(order()).toEqual([B, A, C]);
    expect(banco.editor.selection).toEqual([A, C]);
    expect(spoken()).toBe("1 gruppo separato.");
    key("z", { ctrlKey: true });
    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(ROW);
  });

  it("l'ordine: Ctrl+] e Ctrl+[ di un posto, con Maiusc agli estremi, anche su una tastiera italiana e con PagSu e PagGiù", () => {
    mount(ROW);
    banco.editor.select([A]);
    key("]", { ctrlKey: true, code: "BracketRight" });
    expect(order()).toEqual([B, A, C]);
    expect(spoken()).toBe("Un posto più avanti.");
    // La tastiera italiana ha «+» dove quella americana ha «]».
    key("+", { ctrlKey: true, code: "BracketRight" });
    expect(order()).toEqual([B, C, A]);
    key("PageDown");
    expect(order()).toEqual([B, A, C]);
    key("PageDown", { shiftKey: true });
    expect(order()).toEqual([A, B, C]);
    expect(spoken()).toBe("In secondo piano.");
    key("{", { ctrlKey: true, shiftKey: true, code: "BracketLeft" });
    expect(spoken()).toBe("È già così: niente da cambiare.");
    key("PageUp", { shiftKey: true });
    expect(order()).toEqual([B, C, A]);
    // Ogni passo si annulla da sé.
    key("z", { ctrlKey: true });
    expect(order()).toEqual([A, B, C]);
    expect(spoken()).toBe("Annullato: Cambio d’ordine.");
    expect(banco.editor.selection).toEqual([A]);
  });

  it("il menu dell'ordine spegne le voci che non cambierebbero niente, e dice le scorciatoie", () => {
    mount(ROW);
    banco.editor.select([C]);
    named("Ordine").click();
    expect(named("Ordine").getAttribute("aria-expanded")).toBe("true");
    expect(menu().map((entry) => [entry.querySelector(".menu-label")!.textContent, entry.querySelector(".menu-hint")!.textContent, entry.getAttribute("aria-disabled")])).toEqual([
      ["Porta in primo piano", "Ctrl Maiusc ]", "true"],
      ["Porta avanti", "Ctrl ]", "true"],
      ["Porta indietro", "Ctrl [", null],
      ["Porta in secondo piano", "Ctrl Maiusc [", null],
    ]);
    item("Porta in secondo piano").click();
    expect(order()).toEqual([C, A, B]);
    expect(named("Ordine").getAttribute("aria-expanded")).toBe("false");
  });

  it("allinea al riquadro della selezione, o alla pagina un oggetto solo, e distribuisce lo spazio", () => {
    mount(ROW);
    banco.editor.select([A, B, C]);
    named("Allinea e distribuisci").click();
    expect(menu().map((entry) => entry.querySelector(".menu-label")!.textContent)).toEqual([
      "Allinea a sinistra",
      "Allinea al centro",
      "Allinea a destra",
      "Allinea in alto",
      "Allinea in mezzo",
      "Allinea in basso",
      "Distribuisci orizzontalmente",
      "Distribuisci verticalmente",
    ]);
    item("Distribuisci orizzontalmente").click();
    // Fra 30 e 80 restano 40 unità, dopo il quadrato largo 10: 20 per parte.
    expect(banco.editor.engine.text).toContain(`<rect id="${B}" x="40" y="40" width="10" height="10" fill="#000000" transform="matrix(1 0 0 1 10 0)"/>`);
    expect(spoken()).toBe("3 oggetti distribuiti.");

    named("Allinea e distribuisci").click();
    item("Allinea a sinistra").click();
    expect(banco.editor.engine.text).toContain(`<rect id="${B}" x="40" y="40" width="10" height="10" fill="#000000" transform="matrix(1 0 0 1 -30 0)"/>`);
    expect(banco.editor.engine.text).toContain(`<rect id="${C}" x="80" y="20" width="10" height="20" fill="#d55e00" transform="matrix(1 0 0 1 -70 0)"/>`);
    expect(spoken()).toBe("3 oggetti allineati.");

    banco.editor.select([A]);
    named("Allinea e distribuisci").click();
    expect(item("Distribuisci orizzontalmente").getAttribute("aria-disabled")).toBe("true");
    expect(item("Distribuisci orizzontalmente").querySelector(".menu-description")!.textContent).toBe("Servono almeno tre oggetti.");
    item("Allinea a destra, rispetto alla pagina").click();
    expect(banco.editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="10" fill="#0072b2" transform="matrix(1 0 0 1 70 0)"/>`);
  });

  it("allinea con Alt e A, D, W, S, centra con Alt+H e Alt+V, distribuisce con Maiusc", () => {
    mount(ROW);
    banco.editor.select([A, B, C]);
    surface().focus();
    expect(key("ç", { altKey: true, shiftKey: true, code: "KeyH" }).defaultPrevented).toBe(true);
    expect(banco.editor.engine.text).toContain(`<rect id="${B}" x="40" y="40" width="10" height="10" fill="#000000" transform="matrix(1 0 0 1 10 0)"/>`);
    expect(spoken()).toBe("3 oggetti distribuiti.");
    // Per posizione: Alt+A su un Mac scrive «å».
    key("å", { altKey: true, code: "KeyA" });
    expect(banco.editor.engine.text).toContain(`<rect id="${C}" x="80" y="20" width="10" height="20" fill="#d55e00" transform="matrix(1 0 0 1 -70 0)"/>`);
    expect(spoken()).toBe("3 oggetti allineati.");
    const steps = banco.changes.length;
    key("w", { altKey: true, code: "KeyW" });
    key("v", { altKey: true, code: "KeyV" });
    expect(banco.changes.length).toBe(steps + 2);
  });

  it("riflette la selezione con Maiusc+H e Maiusc+V, in un passo che si annulla", () => {
    mount(ROW);
    banco.editor.select([A]);
    surface().focus();
    const before = banco.editor.engine.text;
    key("H", { shiftKey: true, code: "KeyH" });
    expect(banco.editor.engine.text).toContain(`<rect id="${A}" x="10" y="10" width="20" height="10" fill="#0072b2" transform="matrix(-1 0 0 1 40 0)"/>`);
    expect(spoken()).toBe("Riflesso da sinistra a destra.");
    key("V", { shiftKey: true, code: "KeyV" });
    expect(spoken()).toBe("Riflesso dall'alto in basso.");
    banco.editor.undo();
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(before);
    // Senza selezione Maiusc+H non fa niente.
    banco.editor.select([]);
    expect(key("H", { shiftKey: true, code: "KeyH" }).defaultPrevented).toBe(false);
  });

  it("un pulsante che si spegne passa il fuoco a quello che prende il Tab", () => {
    mount(doc(`${LAYER}<g id="og1g1g1g1">${"<rect id=\"oa1a1a1a1\" x=\"0\" y=\"0\" width=\"5\" height=\"5\"/>"}<rect id="ob2b2b2b2" x="10" y="0" width="5" height="5"/></g></g>`));
    banco.editor.select(["og1g1g1g1"]);
    surface().focus();
    key("F10", { altKey: true });
    key("ArrowRight", {}, named("Duplica"));
    expect(document.activeElement).toBe(named("Separa"));
    named("Separa").click();
    expect(banco.editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("1 gruppo separato.");
    expect(named("Separa").disabled).toBe(true);
    expect(document.activeElement).toBe(named("Duplica"));
  });

  it("un gruppo con parti estranee si separa, e loro restano dove si vedevano; non si duplica", () => {
    const source = doc(`${LAYER}<g id="og1g1g1g1" transform="translate(5 0)"><rect id="oa1a1a1a1" x="0" y="0" width="5" height="5"/><use href="#oa1a1a1a1" x="10"/><circle class="c" r="2"/></g></g>`);
    mount(source);
    banco.editor.select(["og1g1g1g1"]);
    key("d", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(source);
    expect(spoken()).toContain("Non duplicato");
    key("g", { ctrlKey: true, shiftKey: true });
    // La copia collegata mostra il quadrato con la sua trasformazione nuova:
    // resta com'era scritta.
    expect(banco.editor.engine.text).toContain('<rect id="oa1a1a1a1" x="0" y="0" width="5" height="5" transform="matrix(1 0 0 1 5 0)"/>');
    expect(banco.editor.engine.text).toContain('<use href="#oa1a1a1a1" x="10"/>');
    expect(banco.editor.engine.text).toContain('<circle class="c" r="2" transform="matrix(1 0 0 1 5 0)"/>');
    expect(appearance(banco.editor.engine.text)).toEqual(appearance(source));
    expect(spoken()).toBe("1 gruppo separato. 1 elemento riscritto perché resti com’era.");
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(source);
  });

  it("il diagramma di Mermaid del banco di fedeltà si separa coi tasti e con la barra, e si vede com'era", () => {
    const source = FIDELITY.find((scene) => scene.id === "mermaid")!.text;
    mount(source);
    banco.editor.select(["m"]);
    expect(key("g", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    const after = banco.editor.engine.text;
    expect(after).not.toContain('id="m"');
    expect(after).toContain('<rect x="10" y="50" width="90" height="40" rx="5" fill="#ECECFF" stroke="#9370DB"/>');
    expect(appearance(after)).toEqual(appearance(source));
    expect(spoken()).toBe("1 gruppo separato. 5 elementi riscritti perché restino com’erano.");
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(source);
    expect(banco.editor.selection).toEqual(["m"]);

    named("Separa").click();
    // Lo stesso testo, salvo l'id nuovo della punta della freccia.
    const unnamed = (text: string): string => text.replace(/id="o[a-z0-9]{8}"/g, 'id=""');
    expect(unnamed(banco.editor.engine.text)).toBe(unnamed(after));
    expect(spoken()).toBe("1 gruppo separato. 5 elementi riscritti perché restino com’erano.");
    // Si sceglie la punta della freccia, l'unica parte che FubDraw sa
    // scrivere; le altre restano parti estranee.
    expect(banco.editor.selection).toHaveLength(1);
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
  });

  it("Ctrl+G e Ctrl+Maiusc+G restano all'editor anche senza niente di scelto, o dal pannello, e lo dicono", () => {
    mount(doc(`${LAYER}<g id="og1g1g1g1"><rect id="${A}" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`));
    expect(key("g", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    expect(key("g", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Nessun oggetto scelto.");
    banco.editor.select(["og1g1g1g1"]);
    banco.host.querySelector<HTMLButtonElement>(`[aria-controls="${properties().id}"]`)!.click();
    expect(key("g", { ctrlKey: true, shiftKey: true }, properties()).defaultPrevented).toBe(true);
    expect(spoken()).toBe("1 gruppo separato.");
    // Nel Semplice non si raggruppa: i tasti restano a chi li aveva.
    banco.editor.setSpace("simple");
    expect(key("g", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  });

  it("non raggruppa né riordina ciò a cui il foglio di stile del disegno darebbe uno stile che non si può togliere, e dice perché", () => {
    const source = doc(`<style>g g rect{fill:#d55e00}rect:last-child{stroke:#000}</style>${LAYER}<rect id="${A}" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g>`);
    mount(source);
    banco.editor.select([A, B]);
    key("g", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(source);
    expect(spoken()).toBe("Non raggruppato: un elemento cambierebbe «fill», e Fub non sa riscriverlo com’era.");
    banco.editor.select([A]);
    key("]", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toBe(source);
    expect(spoken()).toBe("Ordine invariato: un elemento cambierebbe «stroke», e Fub non sa riscriverlo com’era.");
  });

  it("un foglio di stile che dipende da dove si guarda il disegno ferma il comando, e si dice quale", () => {
    const source = doc(`<style>@media (prefers-color-scheme: dark){#m rect{fill:#ffffff}}</style>${LAYER}<g id="m"><rect id="${A}" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`);
    mount(source);
    banco.editor.select(["m"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toBe(source);
    expect(spoken()).toBe("Non separato: il foglio di stile del disegno ha uno stile che dipende da dove si guarda il disegno, «@media (prefers-color-scheme: dark)», e l’aspetto potrebbe cambiare.");
  });

  it("un foglio di stile che sceglie per classe, come quelli di Illustrator, lascia separare", () => {
    mount(doc(`<style>.st0{fill:#d55e00}</style>${LAYER}<g id="og1g1g1g1"><rect id="${A}" class="st0" x="0" y="0" width="5" height="5"/><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`));
    banco.editor.select(["og1g1g1g1"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("1 gruppo separato.");
    expect(banco.editor.engine.text).not.toContain("og1g1g1g1");
  });

  it("un gruppo con un ritaglio resta intero, e si dice perché", () => {
    const source = doc(
      '<defs id="fub-defs"><clipPath id="rcccccccc"><circle cx="5" cy="5" r="5"/></clipPath></defs>' +
        `${LAYER}<g id="og1g1g1g1" clip-path="url(#rcccccccc)"><rect id="${A}" x="0" y="0" width="5" height="5"/></g>` +
        `<g id="og2g2g2g2"><rect id="${B}" x="10" y="0" width="5" height="5"/></g></g>`,
    );
    mount(source);
    banco.editor.select(["og1g1g1g1"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toBe(source);
    expect(spoken()).toBe("Non separato: un ritaglio, una maschera, degli effetti o un filtro valgono per tutto il gruppo.");
    banco.editor.select(["og1g1g1g1", "og2g2g2g2"]);
    key("g", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("1 gruppo separato. I gruppi con un ritaglio, una maschera, degli effetti o un filtro restano interi.");
    expect(banco.editor.engine.text).toContain('<g id="og1g1g1g1" clip-path="url(#rcccccccc)">');
    expect(banco.editor.engine.text).not.toContain("og2g2g2g2");
  });

  it("«?» elenca anche i tasti per disporre", () => {
    mount(ROW);
    key("?", { shiftKey: true });
    expect([...dialog().querySelectorAll("caption")].map((caption) => caption.textContent)).toContain("Disponi");
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+D", "Duplica"]);
    expect(rows).toContainEqual(["Ctrl+Shift+G", "Separa"]);
    expect(rows).toContainEqual(["Ctrl+] o PgUp", "Porta avanti"]);
    expect(rows).toContainEqual(["Ctrl+Shift+[ o Shift+PgDn", "Porta in secondo piano"]);
    expect(rows).toContainEqual(["Alt+F10", "Va alla barra della selezione"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("i collegamenti a una nota", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const L = "ol1l1l1l1";
  const RECT_A = `<rect id="${A}" x="10" y="10" width="20" height="10" fill="#0072b2"/>`;
  const RECT_B = `<rect id="${B}" x="40" y="40" width="10" height="10" fill="#000000"/>`;
  const ROW = doc(`<title>Prova</title>${LAYER}${RECT_A}${RECT_B}</g>`);
  const NOTE = "Note/Ciclo%20dell'acqua.md";
  const LINKED = doc(`<title>Prova</title>${LAYER}<a id="${L}" href="${NOTE}">${RECT_A}</a>${RECT_B}</g>`);

  /// Chi monta l'editor: sceglie `answer`, e apre ciò che gli si chiede.
  const stub = (answer: string | null = NOTE) => ({ choose: vi.fn(async (_current: string | null) => answer), open: vi.fn() });
  /// Aspetta che l'editor riceva la scelta.
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const bar = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-arrange")!;
  const named = (label: string): HTMLButtonElement | null => bar().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  /// Le azioni che la barra offre, accanto o nel suo «…».
  const shown = (): string[] => [...bar().querySelectorAll("button:not([hidden]):not(.draw-arrange-more)")].map((control) => control.getAttribute("aria-label")!);
  const layer = (): HTMLElement => banco.host.querySelector<HTMLElement>(".draw-link-layer")!;
  const marks = (): HTMLButtonElement[] => [...layer().querySelectorAll<HTMLButtonElement>(".draw-link-mark")];

  it("Ctrl+K mette gli oggetti scelti in un collegamento alla nota che si sceglie, al posto del più alto", async () => {
    const links = stub();
    mount(ROW, { links });
    banco.editor.select([A, B]);
    expect(shown()).toEqual(["Duplica", "Raggruppa", "Separa", "Collega a una nota…", "Ordine", "Allinea e distribuisci"]);
    const link = named("Collega a una nota…")!;
    expect(link.title).toBe("Collega a una nota… (Ctrl+K)");
    expect(link.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    expect(link.getAttribute("aria-haspopup")).toBe("dialog");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");

    expect(key("k", { ctrlKey: true }).defaultPrevented).toBe(true);
    await settle();
    expect(links.choose).toHaveBeenCalledWith(null);
    const [created] = banco.editor.selection;
    expect(banco.editor.engine.text).toContain(`<a id="${created}" href="${NOTE}">`);
    expect(banco.editor.engine.text).toMatch(new RegExp(`<a id="${created}" href="[^"]+">\\s*<rect id="${A}"[^>]*/>\\s*<rect id="${B}"[^>]*/>\\s*</a>`));
    expect(spoken()).toBe("Collegato a «Ciclo dell'acqua».");
    expect(banco.changes.map((change) => change.origin)).toEqual(["input"]);
    // Scelto da solo, il collegamento si cambia, si apre e si toglie.
    expect(shown()).toEqual(["Duplica", "Raggruppa", "Separa", "Cambia il collegamento…", "Apri «Ciclo dell'acqua»", "Togli il collegamento", "Ordine", "Allinea e distribuisci"]);
    expect(named("Togli il collegamento")!.title).toBe("Togli il collegamento (Ctrl+Shift+K)");

    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(ROW);
    expect(spoken()).toBe("Annullato: Collegamento.");
  });

  it("col collegamento scelto da solo, Ctrl+K lo porta a un'altra nota, partendo da quella di adesso", async () => {
    const links = stub("Altre/b.md");
    mount(LINKED, { links });
    banco.editor.select([L]);
    named("Cambia il collegamento…")!.click();
    await settle();
    expect(links.choose).toHaveBeenCalledWith(NOTE);
    expect(banco.editor.engine.text).toContain(`<a id="${L}" href="Altre/b.md">`);
    expect(banco.editor.selection).toEqual([L]);
    expect(spoken()).toBe("Ora il collegamento porta a «b».");
    expect(named("Apri «b»")!.hidden).toBe(false);
    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(LINKED);
    expect(spoken()).toBe("Annullato: Cambio del collegamento.");
  });

  it("un collegamento non ne contiene un altro: il pulsante si spegne, e Ctrl+K lo dice", () => {
    const links = stub();
    mount(LINKED, { links });
    banco.editor.select([L, B]);
    expect(named("Collega a una nota…")!.disabled).toBe(true);
    key("k", { ctrlKey: true });
    expect(spoken()).toContain("Non collegato");
    expect(links.choose).not.toHaveBeenCalled();
    expect(banco.changes).toEqual([]);
  });

  it("una scelta lasciata a metà, o che non riesce, non cambia niente; una seconda non parte finché c'è la prima", async () => {
    const empty = stub(null);
    mount(ROW, { links: empty });
    banco.editor.select([A]);
    key("k", { ctrlKey: true });
    key("k", { ctrlKey: true });
    await settle();
    expect(empty.choose).toHaveBeenCalledTimes(1);
    expect(banco.changes).toEqual([]);

    banco.owner.close();
    banco.owner = openLifetime();
    banco.host.replaceChildren();
    const failing = { choose: vi.fn(async () => Promise.reject(new Error("no"))), open: vi.fn() };
    mount(ROW, { links: failing });
    banco.editor.select([A]);
    key("k", { ctrlKey: true });
    await settle();
    expect(failing.choose).toHaveBeenCalledTimes(1);
    expect(banco.changes).toEqual([]);
  });

  it("mentre si sceglie la nota, valgono gli oggetti scelti alla fine", async () => {
    let answer: (href: string | null) => void = () => {};
    const links = { choose: vi.fn(() => new Promise<string | null>((resolve) => (answer = resolve))), open: vi.fn() };
    mount(ROW, { links });
    banco.editor.select([A, B]);
    key("k", { ctrlKey: true });
    banco.editor.select([B]);
    answer("c.md");
    await settle();
    expect(banco.editor.engine.text).toMatch(new RegExp(`${RECT_A}\\s*<a id="${banco.editor.selection[0]}" href="c.md">\\s*${RECT_B}\\s*</a>`));
  });

  it("Ctrl+Maiusc+K toglie i collegamenti scelti e lascia gli oggetti dov'erano, anche senza chi sceglie le note", () => {
    mount(LINKED);
    banco.editor.select([B]);
    // Senza chi sceglie le note non si collega: Ctrl+K resta al browser.
    expect(shown()).not.toContain("Collega a una nota…");
    expect(key("k", { ctrlKey: true }).defaultPrevented).toBe(false);
    key("K", { ctrlKey: true, shiftKey: true });
    expect(spoken()).toBe("Fra gli oggetti scelti non c’è un collegamento.");

    banco.editor.select([L, B]);
    expect(shown()).toContain("Togli il collegamento");
    expect(shown()).not.toContain("Apri «Ciclo dell'acqua»");
    expect(key("K", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(banco.editor.engine.text).not.toContain("<a ");
    expect(banco.editor.engine.text).toMatch(new RegExp(`${RECT_A}\\s*${RECT_B}`));
    expect(banco.editor.selection).toEqual([A, B]);
    expect(spoken()).toBe("1 collegamento tolto.");
    key("z", { ctrlKey: true });
    expect(banco.editor.engine.text).toBe(LINKED);
    expect(spoken()).toBe("Annullato: Rimozione del collegamento.");
  });

  it("ogni collegamento che si vede ha un segno sull'angolo in alto a destra, che apre la sua nota", () => {
    const links = stub();
    const source = doc(
      `<title>Prova</title>${LAYER}<a id="${L}" href="${NOTE}">${RECT_A}</a><g id="og1g1g1g1"><a id="ol2l2l2l2" href="b.md">${RECT_B}</a></g>` +
        `<a id="ol3l3l3l3" href="https://example.org"><rect x="70" y="70" width="5" height="5"/></a></g>`,
    );
    mount(source, { links });
    // Anche nel Semplice, e anche dentro un gruppo; un indirizzo
    // del web non porta a una nota, e non ha segno.
    expect(marks().map((mark) => [mark.getAttribute("aria-label"), mark.title, mark.tabIndex, mark.style.transform])).toEqual([
      ["Apri «Ciclo dell'acqua»", "Apri «Ciclo dell'acqua»", -1, "translate(30px, 10px)"],
      ["Apri «b»", "Apri «b»", -1, "translate(50px, 40px)"],
    ]);
    // Il tocco è di chi disegna, tranne con la Selezione.
    expect(layer().hasAttribute("data-active")).toBe(false);
    banco.editor.setTool("select");
    expect(layer().hasAttribute("data-active")).toBe(true);
    marks()[1]!.querySelector("svg")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(links.open).toHaveBeenCalledWith("b.md");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");

    // I segni seguono la camera e il disegno.
    key("+");
    expect(marks()[0]!.style.transform).not.toBe("translate(30px, 10px)");
    key("0", { ctrlKey: true });
    banco.editor.select([L]);
    banco.editor.deleteSelection();
    expect(marks().map((mark) => mark.getAttribute("aria-label"))).toEqual(["Apri «b»"]);
  });

  it("senza chi apre le note, i segni non ci sono", () => {
    mount(LINKED);
    expect(layer().hidden).toBe(true);
    expect(marks()).toEqual([]);
  });

  it("Alt+Invio apre la nota del collegamento scelto, a ogni livello e anche in un disegno che non si modifica", () => {
    const links = stub();
    mount(LINKED.replace(' fub:version="1"', ""), { links });
    expect(banco.host.querySelector(".draw-editor")!.hasAttribute("data-readonly")).toBe(true);
    expect(layer().hasAttribute("data-active")).toBe(true);
    expect(key("Enter", { altKey: true }).defaultPrevented).toBe(true);
    expect(spoken()).toBe("Scegli un collegamento per aprire la sua nota.");
    banco.editor.select([L]);
    key("Enter", { altKey: true });
    expect(links.open).toHaveBeenCalledWith(NOTE);
    expect(banco.changes).toEqual([]);
  });

  it("l'albero degli oggetti nomina la nota", () => {
    mount(LINKED, { links: stub() });
    banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    expect([...banco.host.querySelectorAll(".draw-object-label")].map((label) => label.textContent)).toEqual([
      "Livello 1",
      "Rettangolo, Nero",
      "Collegamento a «Ciclo dell'acqua», 1 oggetto",
    ]);
  });

  it("un livello mostra solo il suo nome, e a parole dice che è un livello e che è quello corrente", () => {
    mount(LINKED, { links: stub() });
    banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!.click();
    const layerRow = banco.host.querySelector<HTMLElement>('[role="treeitem"][aria-level="1"]')!;
    expect(layerRow.querySelector(".draw-object-label")!.textContent).toBe("Livello 1");
    expect(layerRow.getAttribute("aria-label")).toBe("Livello «Livello 1», corrente");
    expect(layerRow.hasAttribute("data-current")).toBe(true);
    expect(banco.host.querySelector('[role="treeitem"][aria-level="2"]')!.hasAttribute("data-current")).toBe(false);
    // Un oggetto dice già che cos'è nella riga: non ha un nome accessibile a parte.
    expect(banco.host.querySelector('[role="treeitem"][aria-level="2"]')!.hasAttribute("aria-label")).toBe(false);
  });

  it("«?» elenca i tasti dei collegamenti", () => {
    mount(ROW, { links: stub() });
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["Ctrl+K", "Collega a una nota, o cambia il collegamento scelto"]);
    expect(rows).toContainEqual(["Ctrl+Shift+K", "Togli il collegamento"]);
    expect(rows).toContainEqual(["Alt+Enter", "Apre la nota del collegamento scelto"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});
