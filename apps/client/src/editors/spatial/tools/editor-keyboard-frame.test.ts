// @vitest-environment happy-dom
// L'editor del disegno: da tastiera, la cornice di trasformazione, l'albero degli oggetti.
import { describe, expect, it, vi } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { decodeInk } from "../ink/codec";
import { doc } from "../scene/test-support";
import { type DrawEditorOptions } from "./editor";
import { LAYER } from "./test-support";
import { DEFAULT_CURVE } from "../../../ink/input/pressure";
import { MOUSE, SOURCE, banco, dialog, drag, field, key, mount, pointer, size, spoken, submit, surface } from "./editor-test-support";

// happy-dom non disegna: il PNG degli appunti è il testo che riceve.
vi.mock("./png", async (real) => ({
  ...(await real<typeof import("./png")>()),
  rasterize: vi.fn(async (svg: string) => new Blob([svg], { type: "image/png" })),
}));

describe("da tastiera", () => {
  /// Un rettangolo pieno senza contorno: il suo riquadro è quello scritto.
  const BOXES = doc(
    `<title>Prova</title>${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="20" height="10" fill="#0072b2"/>` +
      `<rect id="ob2b2b2b2" x="50" y="50" width="10" height="10" fill="#000000"/></g>`,
  );

  it("il foglio dice che cosa fanno i tasti", () => {
    mount();
    const hint = document.getElementById(surface().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toContain("Spazio preme e rilascia");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
  });

  it("le frecce muovono il cursore dal centro, e dicono dove è e che cosa c'è sotto", () => {
    mount();
    size(120, 140);
    const mark = banco.host.querySelector<HTMLElement>(".draw-cursor")!;
    expect(mark.hidden).toBe(true);
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    key("ArrowRight");
    expect(spoken()).toBe("x 70, y 70");
    expect(mark.hidden).toBe(false);
    expect(mark.style.transform).toBe("translate(70px, 70px)");
    key("ArrowLeft", { shiftKey: true });
    expect(spoken()).toBe("x 20, y 70");
    key("ArrowRight", { ctrlKey: true });
    expect(spoken()).toBe("x 21, y 70");
    expect(banco.changes).toEqual([]);
  });

  it("dice l'oggetto sotto il cursore, col colore", () => {
    mount();
    size(120, 140);
    key("ArrowUp", { ctrlKey: true });
    expect(spoken()).toBe("x 60, y 69: Rettangolo, Nero");
  });

  it("la vista segue il cursore quando arriva al bordo", () => {
    mount();
    size(100, 100);
    for (let i = 0; i < 3; i++) key("ArrowRight", { shiftKey: true });
    expect(spoken()).toBe("x 200, y 50");
    expect(banco.host.querySelector(".draw-cursor")!.getAttribute("style")).toContain("translate(76px, 50px)");
    expect(banco.host.querySelector(".draw-preview g")!.getAttribute("transform")).toBe("matrix(1 0 0 1 -124 0)");
  });

  it("un rettangolo: Spazio preme, le frecce tracciano, Spazio rilascia", () => {
    mount();
    size(400, 300);
    key("r");
    key("ArrowRight");
    key(" ");
    expect(spoken()).toBe("Premuto: le frecce tracciano, Spazio rilascia, Esc annulla.");
    expect(banco.host.querySelector(".draw-cursor")!.hasAttribute("data-pressed")).toBe(true);
    key("ArrowRight", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    key("ArrowDown", { shiftKey: true });
    expect(banco.host.querySelector(".draw-preview rect")).not.toBeNull();
    key(" ");
    expect(banco.editor.engine.text).toMatch(/<rect id="o[a-z0-9]{8}" x="210" y="150" width="100" height="50" fill="none" stroke="#000000" stroke-width="4"\/>/);
    expect(spoken()).toBe("Rettangolo aggiunto. Il disegno ha 2 oggetti.");
    expect(banco.host.querySelector(".draw-cursor")!.hasAttribute("data-pressed")).toBe(false);
    expect(banco.changes).toHaveLength(1);
  });

  it("la penna scrive un tratto, fitto come col mouse; Invio rilascia", () => {
    mount();
    size(400, 300);
    key(" ");
    key("ArrowRight", { shiftKey: true });
    key("ArrowDown");
    key("Enter");
    expect(banco.editor.engine.text).toMatch(/<path id="o[a-z0-9]{8}" fub:tool="pen" [^>]*fub:ink="1 [^"]+"\/>/);
    const ink = decodeInk(/fub:ink="([^"]+)"/.exec(banco.editor.engine.text)![1]!);
    // Un campione ogni 4 pixel: 50 px e 10 px fanno 13 e 3 campioni, più il
    // primo; 16 ms l'uno dall'altro.
    expect(ink.values.length / ink.channels.length).toBe(17);
    expect(spoken()).toBe("Tratto aggiunto. Il disegno ha 2 oggetti.");
  });

  it("la gomma toglie ciò che il cursore attraversa", () => {
    mount();
    size(100, 140);
    key("e");
    key(" ");
    key("ArrowRight");
    key("ArrowRight");
    key(" ");
    expect(banco.editor.engine.text).not.toContain("o1a2b3c4d");
    expect(spoken()).toBe("1 oggetto cancellato. Il disegno ha 0 oggetti.");
  });

  it("la selezione: Spazio due volte sceglie, e premendo si trascina", () => {
    mount();
    size(120, 140);
    key("v");
    key(" ");
    key(" ");
    expect(banco.editor.selection).toEqual(["o1a2b3c4d"]);
    expect(spoken()).toBe("1 oggetto scelto.");
    // Mentre la tastiera preme, le frecce muovono il cursore anche con una
    // selezione: il gesto trascina.
    key(" ");
    key("ArrowRight", { shiftKey: true });
    key(" ");
    expect(banco.editor.engine.text).toContain('transform="matrix(1 0 0 1 50 0)"');
    expect(spoken()).toBe("1 oggetto spostato.");
  });

  it("un tocco senza niente sotto dice che il cursore è su", () => {
    mount();
    size(400, 300);
    key("l");
    key(" ");
    key(" ");
    expect(banco.changes).toEqual([]);
    expect(spoken()).toBe("Rilasciato.");
  });

  it("Esc annulla il gesto, e il puntatore lo prende al suo posto", () => {
    mount();
    size(400, 300);
    key("r");
    key(" ");
    key("ArrowRight", { shiftKey: true });
    key("Escape");
    expect(banco.host.querySelector(".draw-preview rect")).toBeNull();
    key(" ");
    key("ArrowDown", { shiftKey: true });
    drag([[10, 10], [50, 40]]);
    expect(banco.changes).toHaveLength(1);
    expect(banco.editor.engine.text).toContain('x="10" y="10" width="40" height="30"');
    expect(banco.host.querySelector<HTMLElement>(".draw-cursor")!.hidden).toBe(true);
  });

  it("il fuoco che se ne va porta via il gesto", () => {
    mount();
    size(400, 300);
    banco.editor.focus();
    key("r");
    key(" ");
    key("ArrowRight", { shiftKey: true });
    surface().dispatchEvent(new FocusEvent("blur"));
    key(" ");
    expect(banco.changes).toEqual([]);
  });

  it("Tab passa all'oggetto dopo e lo dice; alla fine lascia uscire", () => {
    mount(BOXES);
    expect(key("Tab").defaultPrevented).toBe(false);
    expect(key("Home").defaultPrevented).toBe(true);
    expect(banco.editor.selection).toEqual(["oa1a1a1a1"]);
    expect(spoken()).toBe("Rettangolo, Blu, 1 di 2.");
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(banco.editor.selection).toEqual(["ob2b2b2b2"]);
    expect(spoken()).toBe("Rettangolo, Nero, 2 di 2.");
    expect(key("Tab").defaultPrevented).toBe(false);
    key("Tab", { shiftKey: true });
    expect(banco.editor.selection).toEqual(["oa1a1a1a1"]);
    expect(key("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    key("End");
    expect(banco.editor.selection).toEqual(["ob2b2b2b2"]);
  });

  it("Ctrl e le frecce ridimensionano la selezione, ferma in alto a sinistra", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    mount(BOXES);
    banco.editor.select(["oa1a1a1a1"]);
    key("ArrowRight", { ctrlKey: true, shiftKey: true });
    expect(banco.editor.engine.text).toContain('transform="matrix(1.5 0 0 1 -5 0)"');
    expect(spoken()).toBe("Misure: 30 × 10.");
    key("ArrowUp", { metaKey: true });
    expect(banco.editor.engine.text).toContain('transform="matrix(1.5 0 0 0.9 -5 1)"');
    expect(spoken()).toBe("Misure: 30 × 9.");
    expect(banco.editor.selection).toEqual(["oa1a1a1a1"]);
    // I due colpi di fila sono un passo solo.
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Ridimensionamento.");
    expect(banco.editor.engine.text).toBe(BOXES);
  });

  it("una linea dritta non si ridimensiona sul lato che misura zero", () => {
    mount(doc(`${LAYER}<line id="oc3c3c3c3" x1="10" y1="10" x2="30" y2="10" stroke="#000000" stroke-width="0"/></g>`));
    banco.editor.select(["oc3c3c3c3"]);
    key("ArrowDown", { ctrlKey: true });
    expect(banco.changes).toEqual([]);
  });

  it("Invio apre posizione e misure; i campi non toccati restano esatti", async () => {
    // Senza il pannello delle proprietà, che il PDF non ha, Invio apre una finestra.
    mount(BOXES, { profile: "pdf" });
    banco.editor.select(["oa1a1a1a1"]);
    banco.editor.focus();
    key("Enter");
    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().querySelector("h2")!.textContent).toBe("Posizione e misure");
    expect(["x", "y", "w", "h"].map((name) => field(name).value)).toEqual(["10", "10", "20", "10"]);
    expect(document.activeElement).toBe(field("x"));
    field("x").value = "100";
    field("w").value = "40";
    await submit();
    expect(banco.editor.engine.text).toContain('transform="matrix(2 0 0 1 80 0)"');
    expect(document.activeElement).toBe(surface());
    // Soltanto la posizione: uno spostamento.
    key("Enter");
    field("y").value = "15";
    await submit();
    expect(banco.editor.engine.text).toContain('transform="matrix(2 0 0 1 80 5)"');
    expect(spoken()).toBe("1 oggetto spostato.");
  });

  it("Invio senza selezione apre le proprietà del disegno, in un passo che si annulla", async () => {
    // Senza il pannello delle proprietà, che il PDF non ha, Invio apre una finestra.
    mount(BOXES, { profile: "pdf" });
    key("Enter");
    expect(dialog().querySelector("h2")!.textContent).toBe("Proprietà del disegno");
    expect(field("title").value).toBe("Prova");
    expect(field("desc").tagName).toBe("TEXTAREA");
    expect([field("w").value, field("h").value]).toEqual(["100", "100"]);
    field("title").value = " Casa ";
    field("desc").value = "La pianta";
    field("w").value = "150";
    await submit();
    expect(banco.editor.engine.text).toContain("<title>Casa</title>");
    expect(banco.editor.engine.text).toContain("<desc>La pianta</desc>");
    expect(banco.editor.engine.text).toContain('viewBox="0 0 150 100"');
    expect(banco.changes).toHaveLength(1);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(BOXES);
    expect(spoken()).toBe("Annullato: Proprietà del disegno.");
  });

  it("annullare la finestra non scrive niente", () => {
    // Senza il pannello delle proprietà, che il PDF non ha, Invio apre una finestra.
    mount(BOXES, { profile: "pdf" });
    banco.editor.select(["oa1a1a1a1"]);
    key("Enter");
    // Un secondo Invio non apre un'altra finestra.
    key("Enter");
    expect(document.querySelectorAll(".modale")).toHaveLength(1);
    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(banco.changes).toEqual([]);
  });

  it("«?» elenca i tasti, gruppo per gruppo", () => {
    mount(SOURCE, { workspace: "simple" });
    key("?", { shiftKey: true });
    expect(dialog().querySelector("h2")!.textContent).toBe("Tasti del disegno");
    expect([...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent)).toEqual([
      "Strumenti",
      "Disegnare da tastiera",
      "Oggetti",
      "Evidenziatore",
      "Proprietà",
      "Vista",
      "Modifica",
    ]);
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["R", "Rettangolo"]);
    expect(rows).toContainEqual(["Space o Enter", "Preme, e poi rilascia"]);
    expect(rows).toContainEqual(["Ctrl+←↑→↓", "Ridimensiona la selezione di 1, con Maiusc di 10"]);
    expect(rows).toContainEqual(["Ctrl+Shift+Z", "Ripeti"]);
    expect(rows).toContainEqual(["Esc", "Toglie la selezione"]);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("nel Completo non c'è «Mostra tutto»: non ci sono altri tasti (ADR 0231)", () => {
    mount(SOURCE);
    key("?", { shiftKey: true });
    expect(dialog().querySelector(".keys-show-all")).toBeNull();
    const captions = [...dialog().querySelectorAll(".keys-list > table caption")].map((caption) => caption.textContent);
    expect(captions.some((caption) => /Nodi|Bézier|Attributi|Maschera|Tracciato/.test(caption ?? ""))).toBe(false);
    expect(formatIssues(checkAccessibility(dialog()))).toBe("");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("i pulsanti della barra fanno lo stesso", () => {
    mount();
    const named = (label: string): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`)!;
    expect(named("Proprietà").getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(named("Tasti del disegno").getAttribute("aria-haspopup")).toBe("dialog");
    named("Tasti del disegno").click();
    expect(dialog().querySelector("h2")!.textContent).toBe("Tasti del disegno");
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });

  it("la camera non si anima mai: ogni inquadratura è subito quella nuova", () => {
    const source = doc(`${LAYER}<rect id="oa1a1a1a1" x="10" y="10" width="10" height="10" fill="#000000"/><rect id="ob2b2b2b2" x="500" y="500" width="10" height="10" fill="#000000"/></g>`);
    mount(source);
    size(100, 100);
    key("Home");
    key("Tab");
    // Nello stesso gestore del tasto: nessun fotogramma in mezzo.
    expect(banco.host.querySelector(".draw-preview g")!.getAttribute("transform")).toBe("matrix(1 0 0 1 -455 -455)");
  });
});

describe("la cornice di trasformazione", () => {
  const A = "oa1a1a1a1";
  const B = "ob2b2b2b2";
  const G = "og1g1g1g1";
  /// Un rettangolo pieno senza contorno, da (100, 100) a (200, 150). La
  /// cornice gli sta a 4 px: l'angolo in basso a destra è (204, 154), il lato
  /// destro (204, 125), la maniglia della rotazione (150, 72).
  const RECT = `<rect id="${A}" x="100" y="100" width="100" height="50" fill="#000000"/>`;
  const ONE = doc(`${LAYER}${RECT}</g>`);
  /// Lo stesso riquadro, in due metà raccolte in un gruppo.
  const GROUP = doc(
    `${LAYER}<g id="${G}"><rect id="${A}" x="100" y="100" width="50" height="50" fill="#000000"/>` +
      `<rect id="${B}" x="150" y="100" width="50" height="50" fill="#000000"/></g></g>`,
  );
  /// Due oggetti diversi: il loro riquadro comune, da (30, 30) a (62, 70),
  /// cambia forma quando ruotano, e ruotando restano nella pagina.
  const TWO = doc(
    `${LAYER}<rect id="${A}" x="30" y="30" width="20" height="10" fill="#000000"/>` +
      `<rect id="${B}" x="55" y="45" width="7" height="25" fill="#000000"/></g>`,
  );

  const transformOf = (id: string): string | null => banco.editor.engine.text.match(new RegExp(`id="${id}"[^>]*? transform="([^"]*)"`))?.[1] ?? null;
  const matrixOf = (id: string): number[] => transformOf(id)!.match(/^matrix\((.*)\)$/)![1]!.split(" ").map(Number);
  const hover = (x: number, y: number): void => {
    surface().dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 0, clientX: x, clientY: y, timeStamp: (banco.clock += 8) }));
  };
  const selecting = (source: string, keys: readonly string[], options: DrawEditorOptions = {}): void => {
    mount(source, options);
    banco.editor.setTool("select");
    banco.editor.select(keys);
  };

  it("un angolo tira due bordi e tiene fermo l'opposto; le misure si dicono, e il passo si annulla", () => {
    selecting(ONE, [A]);
    drag([[204, 154], [230, 170], [254, 179]]);
    expect(transformOf(A)).toBe("matrix(1.5 0 0 1.5 -50 -50)");
    expect(spoken()).toBe("Misure: 150 × 75.");
    expect(banco.editor.selection).toEqual([A]);
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(ONE);
    expect(spoken()).toBe("Annullato: Ridimensionamento.");
  });

  it("un lato tira un bordo solo; con Alt il centro resta fermo", () => {
    selecting(ONE, [A]);
    drag([[204, 125], [230, 140], [254, 140]]);
    expect(transformOf(A)).toBe("matrix(1.5 0 0 1 -50 0)");
    banco.editor.undo();
    drag([[204, 125], [214, 125], [224, 125]], { altKey: true });
    expect(transformOf(A)).toBe("matrix(1.4 0 0 1 -60 0)");
    expect(spoken()).toBe("Misure: 140 × 50.");
  });

  it("con Maiusc un angolo tiene le proporzioni", () => {
    selecting(ONE, [A]);
    drag([[204, 154], [230, 154], [254, 154]], { shiftKey: true });
    expect(transformOf(A)).toBe("matrix(1.4 0 0 1.4 -40 -40)");
  });

  it("un gruppo tiene le proporzioni da sé, e Maiusc lo lascia libero", () => {
    selecting(GROUP, [G]);
    drag([[204, 154], [230, 154], [254, 154]]);
    expect(transformOf(G)).toBe("matrix(1.4 0 0 1.4 -40 -40)");
    banco.editor.undo();
    drag([[204, 154], [230, 154], [254, 154]], { shiftKey: true });
    expect(transformOf(G)).toBe("matrix(1.5 0 0 1 -50 0)");
    expect(banco.editor.selection).toEqual([G]);
  });

  it("più oggetti si ridimensionano insieme, nel loro riquadro comune", () => {
    const PAIR = doc(
      `${LAYER}<rect id="${A}" x="100" y="100" width="50" height="20" fill="#000000"/>` +
        `<rect id="${B}" x="160" y="120" width="40" height="30" fill="#000000"/></g>`,
    );
    selecting(PAIR, [A, B]);
    drag([[204, 154], [230, 170], [254, 179]]);
    expect(transformOf(A)).toBe("matrix(1.5 0 0 1.5 -50 -50)");
    expect(transformOf(B)).toBe("matrix(1.5 0 0 1.5 -50 -50)");
    expect(spoken()).toBe("Misure: 150 × 75.");
    expect(banco.editor.selection).toEqual([A, B]);
  });

  it("con la griglia il bordo va sulla riga, e Ctrl o ⌘ lo lascia libero", () => {
    selecting(ONE, [A], { grid: { shown: false, snap: true, step: 20, steps: {}, panel: null, bar: true, shapes: true, closed: [], twist: true, taps: true, pen: DEFAULT_CURVE } });
    drag([[204, 125], [220, 125], [237, 125]]);
    expect(transformOf(A)).toBe("matrix(1.4 0 0 1 -40 0)");
    banco.editor.undo();
    drag([[204, 125], [220, 125], [237, 125]], { ctrlKey: true });
    expect(transformOf(A)).toBe("matrix(1.33 0 0 1 -33 0)");
  });

  it("una linea dritta ha solo le maniglie lungo di sé, e si allunga col suo contorno", () => {
    const LINE = doc(`${LAYER}<line id="${A}" x1="100" y1="100" x2="200" y2="100" stroke="#000000" stroke-width="2"/></g>`);
    selecting(LINE, [A]);
    // Il contorno arriva a 201, la cornice 4 px più in là.
    hover(205, 100);
    expect(surface().dataset.grip).toBe("ew");
    hover(150, 105);
    expect(surface().dataset.grip).toBeUndefined();
    drag([[205, 100], [230, 100], [256, 100]]);
    expect(transformOf(A)).toBe("matrix(1.5 0 0 1 -49.5 0)");
  });

  it("un oggetto ruotato si ridimensiona lungo i suoi assi, e le maniglie lo seguono", () => {
    const TURNED = doc(`${LAYER}<rect id="${A}" x="100" y="100" width="100" height="50" fill="#000000" transform="rotate(90 150 125)"/></g>`);
    selecting(TURNED, [A]);
    // Ruotato di 90° attorno al centro, il lato destro guarda in basso.
    hover(150, 179);
    expect(surface().dataset.grip).toBe("ns");
    drag([[150, 179], [150, 200], [150, 229]]);
    expect(transformOf(A)).toBe("matrix(0 1.5 -1 0 275 -75)");
    expect(spoken()).toBe("Misure: 150 × 50.");
  });

  it("la maniglia in alto ruota attorno al centro, e si ferma da sola sugli angoli retti", () => {
    selecting(ONE, [A]);
    drag([[150, 72], [180, 80], [203, 125]]);
    expect(transformOf(A)).toBe("matrix(0 1 -1 0 275 -25)");
    expect(spoken()).toBe("Rotazione di 90° in senso orario.");
    banco.editor.undo();
    expect(spoken()).toBe("Annullato: Rotazione.");
    // Poco più di un grado prima dell'angolo retto: la calamita lo prende,
    // Ctrl o ⌘ la spegne.
    drag([[150, 72], [180, 80], [203, 124]]);
    expect(transformOf(A)).toBe("matrix(0 1 -1 0 275 -25)");
    banco.editor.undo();
    drag([[150, 72], [180, 80], [203, 124]], { ctrlKey: true });
    expect(spoken()).toBe("Rotazione di 88,9° in senso orario.");
    banco.editor.undo();
    drag([[150, 72], [120, 80], [97, 125]]);
    expect(transformOf(A)).toBe("matrix(0 -1 1 0 25 275)");
    expect(spoken()).toBe("Rotazione di 90° in senso antiorario.");
  });

  it("con Maiusc la rotazione va a passi di 15°", () => {
    selecting(ONE, [A]);
    // 20° dalla maniglia: il passo più vicino è 15°.
    drag([[150, 72], [160, 74], [168, 75]], { shiftKey: true });
    expect(spoken()).toBe("Rotazione di 15° in senso orario.");
    const [a, b] = matrixOf(A);
    expect(a).toBeCloseTo(Math.cos(Math.PI / 12), 3);
    expect(b).toBeCloseTo(Math.sin(Math.PI / 12), 3);
  });

  it("[ e ] ruotano la selezione di 15°, con Maiusc di 90°, anche con AltGr; senza selezione il tasto resta a chi lo aveva", () => {
    mount(ONE);
    // Con la Penna `[` e `]` sono della punta (P4).
    banco.editor.setTool("select");
    expect(key("]").defaultPrevented).toBe(false);
    banco.editor.select([A]);
    expect(key("]").defaultPrevented).toBe(true);
    expect(spoken()).toBe("Rotazione di 15° in senso orario.");
    const [a, b] = matrixOf(A);
    expect(a).toBeCloseTo(Math.cos(Math.PI / 12), 3);
    expect(b).toBeCloseTo(Math.sin(Math.PI / 12), 3);
    key("}", { shiftKey: true });
    expect(spoken()).toBe("Rotazione di 90° in senso orario.");
    key("{", { shiftKey: true });
    key("[");
    expect(spoken()).toBe("Rotazione di 15° in senso antiorario.");
    // Su una tastiera italiana [ è AltGr+è, che arriva come Ctrl e Alt.
    const event = new KeyboardEvent("keydown", { key: "[", ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(event, "getModifierState", { value: (state: string) => state === "AltGraph" });
    surface().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(spoken()).toBe("Rotazione di 15° in senso antiorario.");
    const [c, d] = matrixOf(A);
    expect(c).toBeCloseTo(Math.cos(Math.PI / 12), 3);
    expect(d).toBeCloseTo(-Math.sin(Math.PI / 12), 3);
  });

  it("più oggetti tengono la loro cornice ruotata: un giro intero li riporta dov'erano, e si annulla in un passo", () => {
    mount(TWO);
    banco.editor.setTool("select");
    banco.editor.select([A, B]);
    for (let turn = 0; turn < 24; turn++) key("]");
    expect(banco.editor.selection).toEqual([A, B]);
    for (const id of [A, B]) {
      const [a, b, c, d, e, f] = matrixOf(id);
      expect([a, b, c, d]).toEqual([1, 0, 0, 1].map((value) => expect.closeTo(value, 3)));
      expect([e, f]).toEqual([0, 0].map((value) => expect.closeTo(value, 1)));
    }
    banco.editor.undo();
    expect(banco.editor.engine.text).toBe(TWO);
  });

  it("Esc a metà del gesto lascia tutto com'era, e un tocco su una maniglia non cambia niente", () => {
    selecting(ONE, [A]);
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 204, clientY: 154, timeStamp: (banco.clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 254, clientY: 179, timeStamp: (banco.clock += 8) }));
    expect(surface().dataset.grip).toBe("nwse");
    key("Escape");
    expect(surface().dataset.grip).toBeUndefined();
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 254, clientY: 179, timeStamp: (banco.clock += 8) }));
    drag([[204, 154], [204, 154]]);
    drag([[150, 72], [150, 72]]);
    expect(banco.editor.engine.text).toBe(ONE);
    expect(banco.changes).toEqual([]);
    expect(banco.editor.selection).toEqual([A]);
  });

  it("sopra una maniglia il puntatore dice che cosa farà; con un altro strumento no", () => {
    selecting(ONE, [A]);
    hover(204, 154);
    expect(surface().dataset.grip).toBe("nwse");
    hover(204, 96);
    expect(surface().dataset.grip).toBe("nesw");
    hover(150, 154);
    expect(surface().dataset.grip).toBe("ns");
    hover(150, 72);
    expect(surface().dataset.grip).toBe("rotate");
    hover(150, 125);
    expect(surface().dataset.grip).toBeUndefined();
    hover(204, 125);
    expect(surface().dataset.grip).toBe("ew");
    banco.editor.setTool("pen");
    expect(surface().dataset.grip).toBeUndefined();
    hover(204, 125);
    expect(surface().dataset.grip).toBeUndefined();
  });

  it("il segno di un collegamento scelto lascia libera la maniglia d'angolo, e segue la cornice", () => {
    const L = "ol1l1l1l1";
    const LINKED = doc(`${LAYER}<a id="${L}" href="n.md">${RECT}</a></g>`);
    mount(LINKED, { links: { choose: vi.fn(async () => null), open: vi.fn() } });
    const mark = (): string => banco.host.querySelector<HTMLElement>(".draw-link-mark")!.style.transform;
    banco.editor.select([L]);
    expect(mark()).toBe("translate(200px, 100px)");
    banco.editor.setTool("select");
    expect(mark()).toBe("translate(208px, 92px)");
    const target = surface();
    target.dispatchEvent(pointer("pointerdown", { ...MOUSE, button: 0, buttons: 1, pressure: 0.5, clientX: 204, clientY: 154, timeStamp: (banco.clock += 8) }));
    target.dispatchEvent(pointer("pointermove", { ...MOUSE, button: -1, buttons: 1, pressure: 0.5, clientX: 254, clientY: 179, timeStamp: (banco.clock += 8) }));
    expect(mark()).toBe("translate(258px, 92px)");
    target.dispatchEvent(pointer("pointerup", { ...MOUSE, button: 0, buttons: 0, pressure: 0, clientX: 254, clientY: 179, timeStamp: (banco.clock += 8) }));
    expect(transformOf(L)).toBe("matrix(1.5 0 0 1.5 -50 -50)");
    expect(mark()).toBe("translate(258px, 92px)");
  });

  it("«?» elenca i tasti della rotazione", () => {
    mount(ONE);
    key("?", { shiftKey: true });
    const rows = [...dialog().querySelectorAll("tr")].map((row) => [row.querySelector("th")!.textContent, row.querySelector("td")!.textContent]);
    expect(rows).toContainEqual(["[ o ]", "Ruota la selezione di 15° in senso antiorario o orario, con Maiusc di 90°"]);
    dialog().querySelector<HTMLButtonElement>(".palette-actions .primary")!.click();
  });
});

describe("l'albero degli oggetti", () => {
  const button = (): HTMLButtonElement => banco.host.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Oggetti"]')!;
  const tree = (): HTMLElement => banco.host.querySelector<HTMLElement>('[role="tree"]')!;
  const labels = (): string[] => [...banco.host.querySelectorAll(".draw-object-label")].map((label) => label.textContent ?? "");

  it("è chiuso finché non lo si apre; aperto prende il fuoco", () => {
    mount();
    const panel = banco.host.querySelector<HTMLElement>(".draw-objects")!;
    expect(panel.hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe(panel.id);
    button().click();
    expect(panel.hidden).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(tree());
    expect(labels()).toEqual(["Livello 1", "Rettangolo, Nero"]);
    expect(banco.host.querySelector(".draw-objects-count")!.textContent).toBe("1 oggetto");
    expect(formatIssues(checkAccessibility(banco.host))).toBe("");
    button().click();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(surface());
  });

  it("ha la stessa selezione del foglio, nei due sensi", () => {
    mount();
    button().click();
    const row = (): HTMLElement => banco.host.querySelector<HTMLElement>('[data-key="o1a2b3c4d"]')!;
    expect(row().getAttribute("aria-selected")).toBe("false");
    banco.editor.select(["o1a2b3c4d"]);
    expect(row().getAttribute("aria-selected")).toBe("true");
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(surface());
    key("Escape");
    expect(row().getAttribute("aria-selected")).toBe("false");
    tree().focus();
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(banco.editor.selection).toEqual(["o1a2b3c4d"]);
  });

  it("segue il disegno: un oggetto nuovo ci entra, uno eliminato ne esce", () => {
    mount();
    button().click();
    banco.editor.setTool("ellipse");
    drag([[10, 10], [50, 30]]);
    expect(labels()).toEqual(["Livello 1", "Ellisse, Nero", "Rettangolo, Nero"]);
    banco.editor.select(["o1a2b3c4d"]);
    banco.editor.deleteSelection();
    expect(labels()).toEqual(["Livello 1", "Ellisse, Nero"]);
  });

  it("Invio su un oggetto apre le sue proprietà, Canc lo elimina", () => {
    mount();
    button().click();
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const properties = banco.host.querySelector<HTMLElement>(".draw-properties")!;
    expect(properties.hidden).toBe(false);
    expect(properties.querySelector(".draw-properties-subject")!.textContent).not.toBe("Il disegno");
    tree().dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    expect(banco.editor.engine.text).not.toContain("o1a2b3c4d");
  });
});
