// @vitest-environment happy-dom
// Il pannello degli attributi da solo, contro un motore vero: le righe come
// le scrive il file, i valori che partono e quelli che non partono, l'id, e
// un disegno che cambia mentre si scrive.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { doc } from "../scene/test-support";
import { nodeOf } from "./arrange";
import { attributeOps, renameOps, subjectOf, type Subject } from "./attributes";
import { gesture, NewIds } from "./edit";
import { createInspector, SHOWN_CHARS, type Inspector, type InspectorView } from "./inspector";
import { LAYER, open, type Opened } from "./test-support";

const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";
const RECT = `${LAYER}<rect id="oaaaaaaaa" x="1" y="2" width="30" height="20" fill="#0072b2" stroke="#000000" stroke-linecap="round"/></g>`;

let host: HTMLElement;
let life: Lifetime;
let opened: Opened;
let inspector: Inspector;
let announced: string[];
let calls: string[];
let refusal: string | null;
let cited: Set<string>;
let held: Set<string>;
let editable: boolean;
let key: string;

/// L'oggetto a `path`, come lo mostra il pannello.
const subjectAt = (path: readonly number[] = [0, 0]): Subject => subjectOf(nodeOf(opened.engine.model!, { path }))!;

function view(): InspectorView {
  return { subject: subjectAt(), key, label: "Rettangolo, Blu", count: 1, editable };
}

/// Applica `ops` come l'editor: un passo, e il pannello che lo segue.
function apply(ops: Parameters<typeof gesture>[0]): string | null {
  if (refusal !== null) return refusal;
  const outcome = opened.engine.apply(gesture(ops)!);
  if (outcome.outcome !== "applied") return outcome.detail;
  inspector.update(view());
  return null;
}

function mount(source = doc(RECT)): Inspector {
  opened = open(source);
  inspector = createInspector(life, {
    onSet(subject, name, value) {
      calls.push(`set ${name}=${value}`);
      return apply(attributeOps(subject, name, value, new NewIds((id) => opened.engine.holder(id) !== null)).ops);
    },
    onRename(subject, next) {
      calls.push(`rename ${next}`);
      return apply(renameOps(subject, next, opened.engine.model));
    },
    taken: (id) => opened.engine.holder(id) !== null,
    cited: (id) => cited.has(id),
    held: (id) => held.has(id),
    announce: (text) => announced.push(text),
    onLeave: () => calls.push("leave"),
  });
  host.append(inspector.element);
  inspector.relabel();
  inspector.update(view());
  return inspector;
}

const row = (name: string): HTMLTableRowElement => host.querySelector<HTMLTableRowElement>(`tr[data-key="${name}"]`)!;
const control = (name: string): HTMLInputElement => row(name).querySelector<HTMLInputElement>(".draw-inspector-input")!;
const error = (name: string): HTMLElement => row(name).querySelector<HTMLElement>(".draw-inspector-error")!;
const note = (name: string): HTMLElement => row(name).querySelector<HTMLElement>(".draw-inspector-note")!;
const remove = (name: string): HTMLButtonElement => row(name).querySelector<HTMLButtonElement>(".draw-inspector-remove")!;
const keys = (): string[] => [...host.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((tr) => tr.dataset.key!);
const addKey = (): HTMLSelectElement => host.querySelector<HTMLSelectElement>(".draw-inspector-add > select")!;
const addValue = (): HTMLInputElement => host.querySelector<HTMLInputElement>(".draw-inspector-add-value > .draw-inspector-input")!;
const addButton = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-inspector-add-button")!;

/// Scrive `text` nel campo, come chi lo digita.
function write(target: HTMLInputElement | HTMLSelectElement, text: string): void {
  target.focus();
  target.value = text;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(target: HTMLElement, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function choose(target: HTMLSelectElement, value: string): void {
  target.focus();
  target.value = value;
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  life = openLifetime();
  announced = [];
  calls = [];
  refusal = null;
  cited = new Set();
  held = new Set();
  editable = true;
  key = "oaaaaaaaa";
});

afterEach(() => {
  life.close();
  host.remove();
});

describe("le righe", () => {
  it("sono l'id e gli attributi del tag, nell'ordine del file, ciascuno col suo nome", () => {
    mount();
    expect(host.querySelector(".draw-inspector-title")!.textContent).toBe("Attributi");
    expect(host.querySelector(".draw-inspector-subject")!.textContent).toBe("Rettangolo, Blu, elemento rect");
    expect(keys()).toEqual(["id", "x", "y", "width", "height", "fill", "stroke", "stroke-linecap"]);
    expect(control("id").value).toBe("oaaaaaaaa");
    expect(control("fill").value).toBe("#0072b2");
    // Il nome della riga è il nome del campo.
    const label = row("fill").querySelector("label")!;
    expect(label.textContent).toBe("fill");
    expect(label.htmlFor).toBe(control("fill").id);
    // Una scelta per le parole chiave, coi valori del formato.
    const cap = row("stroke-linecap").querySelector("select")!;
    expect([...cap.options].map((option) => option.value)).toEqual(["butt", "round", "square"]);
    expect(cap.value).toBe("round");
    // Il campione accanto a un colore, che non si sente.
    const swatch = row("fill").querySelector<HTMLElement>(".draw-inspector-swatch")!;
    expect(swatch.hidden).toBe(false);
    expect(swatch.style.getPropertyValue("--swatch")).toBe("#0072b2");
    expect(swatch.getAttribute("aria-hidden")).toBe("true");
    // L'id non si toglie; un attributo sì.
    expect(remove("id").hidden).toBe(true);
    expect(remove("fill").getAttribute("aria-label")).toBe("Togli fill");
    expect([...host.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Attributo", "Valore", "Togli"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("in un altro pannello, come sua sezione, il titolo è della sezione", () => {
    mount();
    const title = host.querySelector<HTMLElement>(".draw-inspector-title")!;
    expect(inspector.element.getAttribute("aria-labelledby")).toBe(title.id);
    inspector.nest(true);
    expect(inspector.element.hasAttribute("data-nested")).toBe(true);
    expect(title.hidden).toBe(true);
    expect(inspector.element.hasAttribute("aria-labelledby")).toBe(false);
    expect(formatIssues(checkAccessibility(host))).toBe("");
    inspector.nest(false);
    expect(title.hidden).toBe(false);
    expect(inspector.element.getAttribute("aria-labelledby")).toBe(title.id);
  });

  it("ciò che ha un padrone si legge soltanto, con la ragione accanto", () => {
    const ink = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
    const brush = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";
    mount(doc(`${LAYER}<path xmlns:inkscape="${INKSCAPE}" id="oaaaaaaaa" inkscape:label="Sole" fill="#000000" fub:tool="pen" fub:ink="${ink}" fub:brush="${brush}" d="M0 0Z"/></g>`));
    for (const name of ["d", "fub:tool", "inkscape:label"]) {
      expect(control(name).readOnly, name).toBe(true);
      expect(remove(name).hidden, name).toBe(true);
      expect(note(name).hidden, name).toBe(false);
      expect(control(name).getAttribute("aria-describedby"), name).toBe(note(name).id);
    }
    expect(note("d").textContent).toBe("Viene dall’inchiostro del tratto: si cambia ridisegnandolo.");
    expect(note("fub:tool").textContent).toBe("Lo scrive FubDraw.");
    expect(note("inkscape:label").textContent).toBe("È di un altro programma: FubDraw lo conserva com’è.");
    // Una riga che si legge soltanto non ha campione e non si scrive.
    expect(control("fill").readOnly).toBe(false);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un valore lungo che si legge soltanto si vede tagliato, e la nota dice quanto è lungo", () => {
    const ink = `1 s100 cxypt 12050,3020,128,0${" 1,1,0,8".repeat(60)}`;
    const brush = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";
    mount(doc(`${LAYER}<path id="oaaaaaaaa" fill="#000000" fub:tool="pen" fub:ink="${ink}" fub:brush="${brush}" d="M0 0Z"/></g>`));
    const shown = control("fub:ink").value;
    expect(shown).toHaveLength(SHOWN_CHARS + 1);
    expect(shown.endsWith("…")).toBe(true);
    expect(note("fub:ink").textContent).toBe(`Lo scrive FubDraw. Il valore è lungo ${ink.length} caratteri: qui se ne vedono i primi ${SHOWN_CHARS}.`);
  });

  it("senza un oggetto solo dice come averlo", () => {
    mount();
    inspector.update({ subject: null, key: null, label: "", count: 0, editable: true });
    expect(host.querySelector<HTMLElement>(".draw-inspector-empty")!.textContent).toBe("Scegli un oggetto per vederne gli attributi.");
    expect(host.querySelector<HTMLElement>(".draw-inspector-scroll")!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".draw-inspector-subject")!.hidden).toBe(true);
    inspector.update({ subject: null, key: null, label: "", count: 3, editable: true });
    expect(host.querySelector<HTMLElement>(".draw-inspector-empty")!.textContent).toBe("Gli oggetti scelti sono 3: scegline uno per vederne gli attributi.");
    expect(formatIssues(checkAccessibility(host))).toBe("");
    inspector.update(view());
    expect(host.querySelector<HTMLElement>(".draw-inspector-empty")!.hidden).toBe(true);
    expect(keys()[0]).toBe("id");
  });

  it("un documento in sola lettura si legge tutto, e non si aggiunge niente", () => {
    editable = false;
    mount();
    expect(control("fill").readOnly).toBe(true);
    expect(row("stroke-linecap").querySelector("select")!.disabled).toBe(true);
    expect(remove("fill").hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".draw-inspector-add")!.hidden).toBe(true);
    write(control("fill"), "#ff0000");
    press(control("fill"), "Enter");
    expect(calls).toEqual([]);
  });
});

describe("scrivere un valore", () => {
  it("Invio lo scrive come lo scrive il file, in un passo solo", () => {
    mount();
    write(control("fill"), " #F00 ");
    const event = press(control("fill"), "Enter");
    expect(event.defaultPrevented).toBe(true);
    expect(calls).toEqual(["set fill=#ff0000"]);
    expect(opened.engine.text).toContain('fill="#ff0000"');
    expect(control("fill").value).toBe("#ff0000");
    expect(row("fill").querySelector<HTMLElement>(".draw-inspector-swatch")!.style.getPropertyValue("--swatch")).toBe("#ff0000");
    expect(announced).toEqual(["fill cambiato."]);
    // Lo stesso valore, scritto in un altro modo, non è un cambio.
    write(control("fill"), "#FF0000");
    press(control("fill"), "Enter");
    expect(calls).toHaveLength(1);
    expect(control("fill").value).toBe("#ff0000");
  });

  it("il carattere offre anche le famiglie del vault che l'editor dà", () => {
    mount(doc(`${LAYER}<text id="oaaaaaaaa" x="0" y="10" font-family="Inter, sans-serif"><tspan x="0" dy="0">Ciao</tspan></text></g>`));
    const families = (): string[] => [...row("font-family").querySelector("select")!.options].map((option) => option.value);
    expect(families()).toEqual(["Inter, sans-serif", "Literata, serif", "JetBrains Mono, monospace"]);
    inspector.update({ ...view(), families: ['"Noto Sans JP", sans-serif'] });
    expect(families()).toEqual(["Inter, sans-serif", "Literata, serif", "JetBrains Mono, monospace", '"Noto Sans JP", sans-serif']);
    choose(row("font-family").querySelector("select")!, '"Noto Sans JP", sans-serif');
    expect(calls).toEqual(['set font-family="Noto Sans JP", sans-serif']);
    expect(opened.engine.text).toContain("Noto Sans JP");
    // Senza le famiglie del vault, il valore scritto resta fra le scelte.
    expect(families()).toEqual(["Inter, sans-serif", "Literata, serif", "JetBrains Mono, monospace", '"Noto Sans JP", sans-serif']);
  });

  it("lasciando il campo il valore parte, e una scelta parte quando si fa", () => {
    mount();
    write(control("width"), "12.345");
    control("width").blur();
    expect(calls).toEqual(["set width=12.35"]);
    choose(row("stroke-linecap").querySelector("select")!, "square");
    expect(calls).toEqual(["set width=12.35", "set stroke-linecap=square"]);
    expect(opened.engine.text).toContain('stroke-linecap="square"');
  });

  it("un valore che il formato non ammette non parte: resta scritto e segnato", () => {
    mount();
    write(control("fill"), "rosso");
    press(control("fill"), "Enter");
    expect(calls).toEqual([]);
    expect(control("fill").value).toBe("rosso");
    expect(control("fill").getAttribute("aria-invalid")).toBe("true");
    expect(error("fill").hidden).toBe(false);
    expect(error("fill").textContent).toBe("Ci vuole un colore come #0072b2, o none.");
    expect(control("fill").getAttribute("aria-describedby")).toBe(error("fill").id);
    expect(announced).toEqual(["Ci vuole un colore come #0072b2, o none."]);
    // Lasciato il campo, l'errore resta, e un cambio d'altro non lo perde.
    control("fill").blur();
    write(control("x"), "5");
    press(control("x"), "Enter");
    expect(opened.engine.text).toContain('x="5"');
    expect(control("fill").value).toBe("rosso");
    expect(error("fill").hidden).toBe(false);
    // Esc lo riporta a com'era; di nuovo, torna al foglio.
    press(control("fill"), "Escape");
    expect(control("fill").value).toBe("#0072b2");
    expect(control("fill").hasAttribute("aria-invalid")).toBe(false);
    expect(error("fill").hidden).toBe(true);
    press(control("fill"), "Escape");
    expect(calls).toEqual(["set x=5", "leave"]);
  });

  it("lasciando il campo un valore sbagliato non si dice a voce, Invio sì", () => {
    mount();
    write(control("width"), "-3");
    control("width").blur();
    expect(error("width").textContent).toBe("Ci vuole un numero non negativo, come 12 o 0.5.");
    expect(announced).toEqual([]);
  });

  it("un valore vuoto chiede un valore, o di togliere l'attributo", () => {
    mount();
    write(control("stroke"), "  ");
    press(control("stroke"), "Enter");
    expect(error("stroke").textContent).toBe("Scrivi un valore, o togli l’attributo.");
  });

  it("un rifiuto del disegno si vede accanto al valore, che resta scritto", () => {
    mount();
    refusal = "Modifica non applicata: il disegno è in sola lettura.";
    write(control("fill"), "#00ff00");
    press(control("fill"), "Enter");
    expect(control("fill").value).toBe("#00ff00");
    expect(error("fill").textContent).toBe(refusal);
    expect(announced).toEqual([refusal]);
  });

  it("una transform che è l'identità toglie l'attributo, e il fuoco va alla riga dopo", () => {
    mount(doc(`${LAYER}<rect id="oaaaaaaaa" width="30" height="20" fill="#000000" transform="matrix(2 0 0 2 0 0)" display="inline"/></g>`));
    write(control("transform"), "scale(1)");
    press(control("transform"), "Enter");
    expect(calls).toEqual(["set transform=null"]);
    expect(opened.engine.text).not.toContain("transform=");
    expect(keys()).not.toContain("transform");
    expect(announced).toEqual(["transform tolto."]);
    expect(document.activeElement).toBe(control("display"));
  });

  it("i punti e i percorsi si scrivono su più righe: Maiusc+Invio va a capo", () => {
    mount(doc(`${LAYER}<polygon id="oaaaaaaaa" points="0,0 10,0 10,10" fill="#000000"/></g>`));
    const area = row("points").querySelector("textarea")!;
    expect(area.value).toBe("0,0 10,0 10,10");
    write(area as unknown as HTMLInputElement, "0 0\n20 0\n20 20");
    const newline = press(area, "Enter", { shiftKey: true });
    expect(newline.defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
    press(area, "Enter");
    expect(calls).toEqual(["set points=0,0 20,0 20,20"]);
  });
});

describe("togliere e aggiungere", () => {
  it("il pulsante toglie l'attributo, e il fuoco passa al pulsante della riga dopo", () => {
    mount();
    remove("fill").focus();
    remove("fill").click();
    expect(calls).toEqual(["set fill=null"]);
    expect(keys()).toEqual(["id", "x", "y", "width", "height", "stroke", "stroke-linecap"]);
    expect(announced).toEqual(["fill tolto."]);
    expect(document.activeElement).toBe(remove("stroke"));
  });

  it("si sceglie il nome, il valore parte da quello iniziale, e Aggiungi lo scrive", () => {
    mount();
    expect(host.querySelector(".draw-inspector-add-title")!.textContent).toBe("Aggiungi un attributo");
    expect([...addKey().options].map((option) => option.value)).toEqual([
      "rx", "ry", "fill-opacity", "stroke-width", "stroke-opacity", "stroke-linejoin", "stroke-dasharray", "opacity", "display", "transform",
    ]);
    expect(addKey().getAttribute("aria-label")).toBe("Nome dell’attributo");
    choose(addKey(), "stroke-width");
    expect(addValue().value).toBe("1");
    expect(addValue().getAttribute("aria-label")).toBe("Valore di stroke-width");
    write(addValue(), "3");
    addButton().click();
    expect(calls).toEqual(["set stroke-width=3"]);
    expect(opened.engine.text).toContain('stroke-width="3"');
    expect(announced).toEqual(["stroke-width aggiunto."]);
    // Si riparte dal nome, che è già quello che seguiva.
    expect(addKey().value).toBe("stroke-opacity");
    expect(document.activeElement).toBe(addKey());
    // Una parola chiave si sceglie, e Invio la aggiunge.
    choose(addKey(), "stroke-linejoin");
    const join = host.querySelector<HTMLSelectElement>(".draw-inspector-add-value > select")!;
    expect([...join.options].map((option) => option.value)).toEqual(["miter", "round", "bevel"]);
    choose(join, "bevel");
    expect(calls).toHaveLength(1);
    press(join, "Enter");
    expect(calls).toEqual(["set stroke-width=3", "set stroke-linejoin=bevel"]);
    expect(formatIssues(checkAccessibility(host))).toBe("");
  });

  it("un valore da aggiungere che non va resta lì, col suo errore", () => {
    mount();
    choose(addKey(), "opacity");
    write(addValue(), "2");
    press(addValue(), "Enter");
    const problem = host.querySelector<HTMLElement>(".draw-inspector-add > .draw-inspector-error")!;
    expect(problem.textContent).toBe("Ci vuole un numero da 0 a 1, come 0.5.");
    expect(addValue().getAttribute("aria-invalid")).toBe("true");
    expect(calls).toEqual([]);
    choose(addKey(), "transform");
    write(addValue(), "translate(0 0)");
    press(addValue(), "Enter");
    expect(problem.textContent).toBe("È la trasformazione che non cambia niente: non c’è niente da aggiungere.");
    expect(calls).toEqual([]);
  });

  it("senza altro da aggiungere il riquadro sparisce, e il fuoco va alla riga nuova", () => {
    mount(doc(`${LAYER}<line id="oaaaaaaaa" x1="0" y1="0" x2="10" y2="10" stroke="#000000" stroke-width="2" stroke-opacity="1" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="none" opacity="1" display="inline"/></g>`));
    expect([...addKey().options].map((option) => option.value)).toEqual(["transform"]);
    write(addValue(), "translate(5 5)");
    press(addValue(), "Enter");
    expect(opened.engine.text).toContain('transform="matrix(1 0 0 1 5 5)"');
    expect(host.querySelector<HTMLElement>(".draw-inspector-add")!.hidden).toBe(true);
    expect(document.activeElement).toBe(control("transform"));
  });
});

describe("l'id", () => {
  it("si cambia con ogni nome che il formato ammette, e un annulla lo rimette", () => {
    mount();
    write(control("id"), "Sole_1");
    press(control("id"), "Enter");
    expect(calls).toEqual(["rename Sole_1"]);
    expect(opened.engine.text).toContain('id="Sole_1"');
    expect(announced).toEqual(["Ora l’id è «Sole_1»."]);
    expect(control("id").value).toBe("Sole_1");
  });

  it("dice perché un nome non va, e non lo scrive", () => {
    mount(doc(`${LAYER}<rect id="oaaaaaaaa" width="30" height="20" fill="#000000"/><rect id="obbbbbbbb" width="5" height="5" fill="#000000"/></g>`));
    const cases: Array<[string, string]> = [
      ["", "Un id non può essere vuoto."],
      ["1sole", "Un id comincia con una lettera o _, e continua con lettere, cifre, _, . e -."],
      ["sole luna", "Un id comincia con una lettera o _, e continua con lettere, cifre, _, . e -."],
      ["fub-sole", "Gli id che cominciano con fub- sono di FubDraw."],
      ["obbbbbbbb", "«obbbbbbbb» è già l’id di un altro elemento."],
      ["s".repeat(65), "Un id ha al più 64 caratteri."],
    ];
    for (const [next, text] of cases) {
      write(control("id"), next);
      press(control("id"), "Enter");
      expect(error("id").textContent, next).toBe(text);
    }
    expect(calls).toEqual([]);
  });

  it("un id che una parte estranea cita non si cambia", () => {
    mount();
    cited.add("oaaaaaaaa");
    write(control("id"), "sole");
    press(control("id"), "Enter");
    expect(error("id").textContent).toBe("Una parte di un altro programma cita «oaaaaaaaa»: cambiarlo romperebbe il riferimento.");
    expect(calls).toEqual([]);
  });

  it("un id che un oggetto bloccato nomina non si cambia, e il campo dice come fare", () => {
    mount();
    held.add("oaaaaaaaa");
    write(control("id"), "sole");
    press(control("id"), "Enter");
    expect(error("id").textContent).toBe("Un oggetto bloccato nomina «oaaaaaaaa»: cambiarlo lo staccherebbe. Sblocca prima il suo livello o il suo gruppo.");
    expect(calls).toEqual([]);
  });

  it("un oggetto senza id ne riceve uno, e il campo vuoto dice che non ce l'ha", () => {
    key = "@0.0";
    mount(doc(`${LAYER}<rect width="30" height="20" fill="#000000"/></g>`));
    expect(control("id").value).toBe("");
    expect(control("id").placeholder).toBe("senza id");
    // Lasciato vuoto, niente da fare.
    control("id").focus();
    press(control("id"), "Enter");
    expect(calls).toEqual([]);
    write(control("id"), "sole");
    press(control("id"), "Enter");
    expect(opened.engine.text).toContain('<rect id="sole"');
  });
});

describe("il disegno che cambia mentre si scrive", () => {
  it("il campo col fuoco tiene ciò che si scrive; un altro oggetto lo riporta a com'è", () => {
    mount();
    write(control("fill"), "#12");
    // Un annulla, o chi lavora insieme, cambia il disegno.
    expect(opened.engine.apply(gesture([{ op: "set", id: "oaaaaaaaa", attrs: { fill: "#ffffff", x: "9" } }])!).outcome).toBe("applied");
    inspector.update(view());
    expect(control("fill").value).toBe("#12");
    expect(control("x").value).toBe("9");
    // Esc riporta al valore di adesso, non a quello di prima.
    press(control("fill"), "Escape");
    expect(control("fill").value).toBe("#ffffff");
    write(control("fill"), "#34");
    key = "altro";
    inspector.update(view());
    expect(control("fill").value).toBe("#ffffff");
  });

  it("una riga che se ne va col fuoco lo lascia alla vicina", () => {
    mount();
    control("stroke").focus();
    expect(opened.engine.apply(gesture([{ op: "set", id: "oaaaaaaaa", attrs: { stroke: null } }])!).outcome).toBe("applied");
    inspector.update(view());
    expect(keys()).not.toContain("stroke");
    expect(document.activeElement).toBe(control("stroke-linecap").parentElement!.querySelector("select"));
  });

  it("una riga che se ne va mentre si scrive non riscrive il suo valore", () => {
    mount();
    write(control("stroke"), "#123456");
    // Un browser che, togliendo il campo col fuoco, lo dice con un focusout.
    const tr = row("stroke");
    const field = control("stroke");
    tr.remove = function (this: HTMLTableRowElement) {
      field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      Element.prototype.remove.call(this);
    };
    expect(opened.engine.apply(gesture([{ op: "set", id: "oaaaaaaaa", attrs: { stroke: null } }])!).outcome).toBe("applied");
    inspector.update(view());
    expect(calls).toEqual([]);
    expect(opened.engine.text).not.toContain("stroke=");
  });

  it("l'oggetto che se ne va col fuoco lo lascia al pannello", () => {
    mount();
    control("fill").focus();
    inspector.update({ subject: null, key: null, label: "", count: 0, editable: true });
    expect(document.activeElement).toBe(inspector.element);
  });
});

describe("i tasti", () => {
  it("Invio ed Esc restano al pannello; gli altri tasti salgono, e l'editor sa da dove vengono", () => {
    mount();
    const seen: string[] = [];
    host.addEventListener("keydown", (event) => seen.push(event.key));
    write(control("fill"), "#ff0000");
    press(control("fill"), "Enter");
    press(control("fill"), "Escape");
    press(control("fill"), "Delete");
    press(control("fill"), "?");
    expect(seen).toEqual(["Delete", "?"]);
  });
});
