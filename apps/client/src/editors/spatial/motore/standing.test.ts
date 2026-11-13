// Il chip del disegno (`standing.ts`): «N parti restano come sono» (K5 T21)
// e le parti che il motore tiene per la sessione aperta (`perdite()` e
// `trovate()` di `motoreDa`), e il motore spento, fermo o assente da questa
// versione (T23), con «Accendi…» e «Riprova». Le parti dei modelli sono
// quelle che il motore vero dà (`crates/fub-disegno/tests/corpus/perdite.tsv`).

import { describe, expect, it, vi } from "vitest";
import type { DrawingLoss } from "../../../host/contract";
import type { Item } from "../scene/classify";
import { SceneEngine } from "../scene/engine";
import { t } from "../strings";
import { motoreDa, type MotoreDelDisegno } from "./gesti";
import type { MotoreAssente, SessioneMotore } from "./sessione";
import { drawEngineState, drawStanding, drawStandingState, lossName, MOTORE_VETTORIALE, type DrawStandingSource } from "./standing";

const TEMPLATES = import.meta.glob("../../../../../../crates/fub-features/templates/*.it.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const CORPUS = import.meta.glob("../../../../../../crates/fub-scene/tests/corpus/illustrator.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const template = (name: string): string => {
  const found = Object.entries(TEMPLATES).find(([path]) => path.endsWith(`/${name}.it.svg`));
  if (found === undefined) throw new Error(`manca il modello ${name}`);
  return found[1];
};

/// La scena di `text` come la legge l'editor.
const sceneOf = (text: string): readonly Item[] => SceneEngine.open(text).scene();

/// Le sei scene della lavagna, come le dice il motore.
const STORYBOARD_LOSSES: readonly DrawingLoss[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  element: `bscena00${n}`,
  kind: "unmapped",
  detail: "il motore non ne fa un oggetto suo",
}));

/// Un disegno di Fub con `count` rettangoli; il primo ha l'id `first`.
function drawingOf(count: number, first = "o00000001"): string {
  const shapes: string[] = [];
  for (let n = 1; n <= count; n++) {
    const id = n === 1 ? first : `o${String(n).padStart(8, "0")}`;
    shapes.push(`    <rect id="${id}" x="${(n % 20) * 20}" y="${Math.floor(n / 20) * 20}" width="10" height="10" fill="#000000"/>`);
  }
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 400 600" width="400" height="600">',
    "  <title>Prova</title>",
    '  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="400" height="600" fill="#ffffff"/>',
    '  <g id="l1a2b3c4d" fub:layer="Livello 1">',
    ...shapes,
    "  </g>",
    "</svg>",
    "",
  ].join("\n");
}

const filter = (element: string, detail = "il filtro «ombra» resta com’è"): DrawingLoss => ({ element, kind: "approximated", detail });

describe("lo stato del chip", () => {
  it("le parti di un disegno: il chip le conta, il riquadro le chiede e ne dice una per posto", () => {
    const go = vi.fn();
    const state = drawStandingState(STORYBOARD_LOSSES, sceneOf(template("storyboard")), go)!;
    expect(state).toMatchObject({
      kind: "closed",
      text: "6 parti restano come sono",
      title: "6 parti restano come sono nel file",
      body: t("draw.standing.lost.body"),
      source: "SVG · ciò che il disegno non tocca resta nel file",
      placesAsk: "Che cosa manca?",
      actions: [],
      recording: false,
    });
    expect(state.places!.map((place) => place.label)).toEqual(STORYBOARD_LOSSES.map((loss) => `${loss.element}: il motore non ne fa un oggetto suo`));
    // Ogni scena si vede: ogni posto ha il suo «Vai».
    expect(state.places!.every((place) => place.run !== undefined)).toBe(true);
    state.places![2]!.run!();
    expect(go).toHaveBeenCalledWith("bscena003");
  });

  it("una parte sola si dice al singolare", () => {
    const state = drawStandingState([filter("o00000002")], sceneOf(drawingOf(3)), () => {})!;
    expect([state.text, state.title]).toEqual(["1 parte resta com’è", "1 parte resta com’è nel file"]);
  });

  it("senza parti, niente chip", () => {
    expect(drawStandingState([], sceneOf(template("storyboard")), () => {})).toBeNull();
  });

  it("un disegno che il motore non modifica affatto (`unsupported`): niente chip, parla l'avviso della sola lettura", () => {
    const illustrator = Object.values(CORPUS)[0]!;
    const losses: DrawingLoss[] = [{ element: "svg", kind: "unsupported", detail: "sola lettura: c'è un DOCTYPE" }];
    expect(drawStandingState(losses, sceneOf(illustrator), () => {})).toBeNull();
    // Anche accanto ad altre parti.
    expect(drawStandingState([...STORYBOARD_LOSSES, ...losses], sceneOf(template("storyboard")), () => {})).toBeNull();
  });

  it("500 parti: tutte nel riquadro, col numero intero; un nome lunghissimo resta intero (lo taglia la skin)", () => {
    const long = `gruppo-${"livello-annidato-".repeat(20)}`.slice(0, 300);
    const scene = sceneOf(drawingOf(500, long));
    const losses = scene.flatMap((item) => (item.kind === "element" && item.tag === "rect" && item.id !== "fub-paper" ? [filter(item.id!)] : []));
    expect(losses).toHaveLength(500);
    const state = drawStandingState(losses, scene, () => {})!;
    expect(state.text).toBe("500 parti restano come sono");
    expect(state.title).toBe("500 parti restano come sono nel file");
    expect(state.places).toHaveLength(500);
    expect(state.places![0]!.label).toBe(`${long}: il filtro «ombra» resta com’è`);
  });

  it("una parte su un elemento cancellato perde il suo posto, e il numero la segue", () => {
    const losses = [filter("o00000002"), filter("o00000003")];
    const before = drawStandingState(losses, sceneOf(drawingOf(3)), () => {})!;
    expect(before.places).toHaveLength(2);
    const engine = SceneEngine.open(drawingOf(3));
    const removed = engine.text.replace(/\n\s*<rect id="o00000003"[^>]*\/>/, "");
    expect(removed).not.toContain("o00000003");
    const after = drawStandingState(losses, sceneOf(removed), () => {})!;
    expect(after.text).toBe("1 parte resta com’è");
    expect(after.places!.map((place) => place.label)).toEqual(["o00000002: il filtro «ombra» resta com’è"]);
    // Cancellati tutti, niente chip.
    expect(drawStandingState([filter("o00000009")], sceneOf(drawingOf(3)), () => {})).toBeNull();
  });

  it("una parte dentro `<defs>` non si vede sul foglio: il posto c'è, senza «Vai»", () => {
    const losses: DrawingLoss[] = [
      { element: "fub-defs", kind: "unmapped", detail: "dentro <defs>: una risorsa, non un oggetto del disegno" },
      { element: "rlink1001", kind: "unmapped", detail: "dentro <defs>: una risorsa, non un oggetto del disegno" },
      filter("oargom001"),
    ];
    const state = drawStandingState(losses, sceneOf(template("concept-map")), () => {})!;
    expect(state.places!.map((place) => place.run === undefined)).toEqual([true, true, false]);
  });

  it("un elemento senza id si chiama col tag e il percorso, come lo chiama il motore", () => {
    const text = drawingOf(2).replace('<rect id="o00000002"', "<rect");
    const scene = sceneOf(text);
    const rect = scene.find((item) => item.kind === "element" && item.tag === "rect" && item.id === null);
    expect(rect).toBeDefined();
    expect(lossName(rect as Extract<Item, { kind: "element" }>)).toBe("rect[2/1]");
    const state = drawStandingState([filter("rect[2/1]")], scene, () => {})!;
    expect(state.places).toHaveLength(1);
  });
});

/// Ciò che il motore finto è adesso: aperto con le sue parti, che si apre,
/// o che manca.
type FakeState = { readonly kind: "aperto"; readonly losses: readonly DrawingLoss[] } | { readonly kind: "apertura" } | MotoreAssente;

/// Un motore finto: le parti di adesso, perché manca, e chi lo ascolta.
/// `riapri` lo porta ad aprirsi e lo conta.
function fakeMotore(initial: readonly DrawingLoss[] | null): MotoreDelDisegno & {
  set(next: readonly DrawingLoss[] | null): void;
  to(next: FakeState): void;
  readonly riaperture: number;
} {
  let state: FakeState = initial === null ? { kind: "apertura" } : { kind: "aperto", losses: initial };
  let riaperture = 0;
  const listeners = new Set<() => void>();
  const to = (next: FakeState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    adesso: () => (state.kind === "apertura" ? "apertura" : null),
    pronta: async () => null,
    assente: () => (state.kind === "assente" ? state : null),
    riapri() {
      if (state.kind !== "assente") return;
      riaperture++;
      to({ kind: "apertura" });
    },
    perdite: () => (state.kind === "aperto" ? state.losses : null),
    trovate: () => {},
    quandoCambia(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      to(next === null ? { kind: "apertura" } : { kind: "aperto", losses: next });
    },
    to,
    get riaperture() {
      return riaperture;
    },
  };
}

/// Il chip su `motore`, con la scena di `text`; `extra` cambia la sorgente.
function standingOn(motore: MotoreDelDisegno | null, text: string, extra: Partial<DrawStandingSource> = {}) {
  return drawStanding({ motore: () => motore, scene: () => sceneOf(text), reveal: () => true, inBuild: () => true, ...extra });
}

describe("il chip della superficie", () => {
  const text = drawingOf(3);

  it("segue il motore: le parti si sanno solo col motore aperto", () => {
    const motore = fakeMotore(null);
    let scene: readonly Item[] | null = sceneOf(text);
    const standing = drawStanding({ motore: () => motore, scene: () => scene, reveal: () => true, inBuild: () => true });
    // Si apre, o è spento, o fermo: non si sanno (il chip è un altro).
    expect(standing.current()).toBeNull();
    motore.set([filter("o00000002")]);
    expect(standing.current()?.text).toBe("1 parte resta com’è");
    // Lo stesso stato finché parti e scena restano.
    expect(standing.current()).toBe(standing.current());
    // In sola lettura, o in Lettura, la superficie non dà la scena.
    scene = null;
    expect(standing.current()).toBeNull();
    scene = sceneOf(text);
    // Il motore che si ferma col riquadro aperto: `null`, e la shell lo chiude.
    motore.set(null);
    expect(standing.current()).toBeNull();
  });

  it("senza motore, niente chip", () => {
    const standing = drawStanding({ motore: () => null, scene: () => sceneOf(text), reveal: () => true, inBuild: () => true });
    expect(standing.current()).toBeNull();
  });

  it("«Vai» cerca l'elemento nella scena di adesso e lo porta in vista", () => {
    const motore = fakeMotore([filter("o00000003")]);
    let scene = sceneOf(text);
    const reveal = vi.fn((_offset: number) => true);
    const standing = drawStanding({ motore: () => motore, scene: () => scene, reveal, inBuild: () => true });
    const place = standing.current()!.places![0]!;
    // La scena cambia dopo che il riquadro si è disegnato: l'elemento ha
    // un altro posto nel file.
    const moved = text.replace("<title>Prova</title>", "<title>Una prova col titolo più lungo</title>");
    scene = sceneOf(moved);
    place.run!();
    const item = scene.find((each) => each.kind === "element" && each.id === "o00000003")!;
    expect(reveal).toHaveBeenCalledWith(item.bytes[0]);
    // I byte del file, non le unità UTF-16: «più» ne ha uno in più.
    const bytes = new TextEncoder().encode(moved).slice(item.bytes[0], item.bytes[0] + 20);
    expect(new TextDecoder().decode(bytes)).toBe('<rect id="o00000003"');
  });

  it("`changed()` avvisa chi ascolta; dopo `dispose()` niente", () => {
    const standing = drawStanding({ motore: () => fakeMotore([filter("o00000002")]), scene: () => sceneOf(text), reveal: () => true, inBuild: () => true });
    const listener = vi.fn();
    const stop = standing.subscribe(listener);
    standing.changed();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    standing.changed();
    expect(listener).toHaveBeenCalledTimes(1);
    standing.subscribe(listener);
    standing.dispose();
    standing.changed();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(standing.current()).toBeNull();
  });
});

const SPENTO: MotoreAssente = { kind: "assente", perche: "spento" };
const FERMO: MotoreAssente = { kind: "assente", perche: "errore" };

describe("il chip del motore che manca", () => {
  const text = drawingOf(3);

  it("spento: «Motore spento», il segno vuoto, e «Accendi…» che porta alla riga del motore", () => {
    const motore = fakeMotore(null);
    motore.to(SPENTO);
    const show = vi.fn((_id: string) => true);
    const standing = standingOn(motore, text, { showComponent: show });
    const state = standing.current()!;
    expect(state).toMatchObject({
      kind: "reduced",
      text: "Motore spento: strumenti semplici",
      title: "Motore del disegno spento",
      body: "Disegni con gli strumenti semplici: fanno le stesse cose, senza il motore del disegno.",
      source: "Impostazioni · Componenti · Motore del disegno",
      recording: false,
    });
    expect(state.places).toBeUndefined();
    expect(state.actions!.map((action) => action.label)).toEqual(["Accendi…"]);
    state.actions![0]!.run();
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith("fub.motore-vettoriale");
    expect(MOTORE_VETTORIALE).toBe("fub.motore-vettoriale");
    // «Accendi…» non accende niente da sé: il motore resta spento.
    expect(motore.riaperture).toBe(0);
    expect(standing.current()).toBe(state);
  });

  it("spento senza la porta delle Impostazioni: lo stesso chip, senza «Accendi…»", () => {
    const motore = fakeMotore(null);
    motore.to(SPENTO);
    const state = standingOn(motore, text).current()!;
    expect(state.text).toBe("Motore spento: strumenti semplici");
    expect(state.actions).toEqual([]);
  });

  it("la versione senza il motore (la riga non è nella mappa): «Senza motore», e nessuna azione", () => {
    const motore = fakeMotore(null);
    motore.to(SPENTO);
    const show = vi.fn((_id: string) => true);
    const inBuild = vi.fn((_id: string) => false);
    const state = standingOn(motore, text, { showComponent: show, inBuild }).current()!;
    expect(inBuild).toHaveBeenCalledWith("fub.motore-vettoriale");
    expect(state).toMatchObject({
      kind: "reduced",
      text: "Senza motore: strumenti semplici",
      title: "Questa versione di Fub non ha il motore del disegno",
      body: "Disegni con gli strumenti semplici. Il motore non si può accendere: questa versione è stata costruita senza.",
      source: "Componenti · non incluso",
      actions: [],
    });
    expect(show).not.toHaveBeenCalled();
  });

  it("fermo: «Motore fermo», il segno d'errore, e «Riprova» che chiama `riapri()`", () => {
    const motore = fakeMotore(null);
    motore.to(FERMO);
    const show = vi.fn((_id: string) => true);
    const standing = standingOn(motore, text, { showComponent: show });
    const state = standing.current()!;
    expect(state).toMatchObject({
      kind: "stopped",
      text: "Motore fermo: strumenti semplici",
      title: "Il motore del disegno si è fermato",
      body: "Disegni con gli strumenti semplici finché non riparte. Il file non ha perso niente.",
      source: "Motore del disegno · fermo",
    });
    expect(state.actions!.map((action) => action.label)).toEqual(["Riprova"]);
    const riapri = vi.spyOn(motore, "riapri");
    state.actions![0]!.run();
    expect(riapri).toHaveBeenCalledTimes(1);
    expect(motore.riaperture).toBe(1);
    expect(show).not.toHaveBeenCalled();
  });

  it("«Riprova» che fallisce di nuovo: il chip resta «fermo» mentre riapre e dopo, senza altri tentativi da sé", () => {
    const motore = fakeMotore(null);
    motore.to(FERMO);
    const standing = standingOn(motore, text);
    const listener = vi.fn();
    standing.subscribe(listener);
    motore.quandoCambia(() => standing.changed());
    standing.current()!.actions![0]!.run();
    // Si riapre: il chip resta quello del motore fermo.
    expect(motore.adesso()).toBe("apertura");
    expect(standing.current()?.text).toBe("Motore fermo: strumenti semplici");
    // L'apertura risponde con un altro errore.
    motore.to(FERMO);
    expect(standing.current()?.kind).toBe("stopped");
    expect(motore.riaperture).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("acceso: il chip delle parti, o nessuno", () => {
    const motore = fakeMotore([]);
    const standing = standingOn(motore, text, { showComponent: () => true });
    expect(standing.current()).toBeNull();
    motore.set([filter("o00000002")]);
    expect(standing.current()).toMatchObject({ kind: "closed", text: "1 parte resta com’è", actions: [] });
  });

  it("il motore che si apre la prima volta: niente chip", () => {
    expect(standingOn(fakeMotore(null), text).current()).toBeNull();
  });

  it("il motore che si spegne a metà sessione cambia il chip senza riaprire il file; riacceso torna quello delle parti", () => {
    const motore = fakeMotore([filter("o00000002")]);
    const standing = standingOn(motore, text, { showComponent: () => true });
    const listener = vi.fn();
    standing.subscribe(listener);
    motore.quandoCambia(() => standing.changed());
    expect(standing.current()?.kind).toBe("closed");
    motore.to(SPENTO);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(standing.current()?.text).toBe("Motore spento: strumenti semplici");
    // Riacceso: mentre si apre resta «spento», poi le parti della sessione nuova.
    motore.riapri();
    expect(standing.current()?.text).toBe("Motore spento: strumenti semplici");
    motore.set([]);
    expect(standing.current()).toBeNull();
    motore.to(FERMO);
    motore.set([filter("o00000003")]);
    expect(standing.current()?.text).toBe("1 parte resta com’è");
    // Dopo una sessione aperta, il motore che si riapre non ripesca lo stato
    // di prima.
    motore.set(null);
    expect(standing.current()).toBeNull();
  });

  it("in sola lettura, in Lettura o su un SVG estraneo (nessuna scena): niente chip del motore, parla l'avviso", () => {
    for (const assente of [SPENTO, FERMO]) {
      const motore = fakeMotore(null);
      motore.to(assente);
      const standing = drawStanding({ motore: () => motore, scene: () => null, reveal: () => true, inBuild: () => true, showComponent: () => true });
      expect(standing.current()).toBeNull();
    }
  });

  it("senza motore (nessuna `DocumentSession`): niente chip", () => {
    expect(standingOn(null, text, { showComponent: () => true }).current()).toBeNull();
  });

  it("`drawEngineState` da solo: le parole del catalogo, e il fermo resta fermo anche senza il motore nella versione", () => {
    const state = drawEngineState(SPENTO, { inBuild: true, accendi: () => {}, riprova: () => {} });
    expect(state.text).toBe(t("draw.standing.off"));
    expect(drawEngineState(FERMO, { inBuild: false, accendi: null, riprova: () => {} }).kind).toBe("stopped");
  });

  it("dopo `dispose()` niente", () => {
    const motore = fakeMotore(null);
    motore.to(FERMO);
    const standing = standingOn(motore, text);
    standing.dispose();
    expect(standing.current()).toBeNull();
  });
});

/// Una sessione finta, aperta, con le parti `losses`.
function fakeSession(instance: string, losses: readonly DrawingLoss[]): SessioneMotore {
  let stato: "aperta" | "chiusa" = "aperta";
  return {
    kind: "sessione",
    instance,
    mapped: 1,
    unmapped: losses.length,
    losses,
    revision: () => "0",
    stato: () => stato,
    quandoAssente: () => () => {},
    quandoChiusa: () => () => {},
    gesto: async () => null,
    comandi: async () => null,
    comando: async () => null,
    chiudi: async () => {
      stato = "chiusa";
    },
  };
}

describe("le parti della sessione aperta", () => {
  it("quelle dell'apertura, più quelle trovate dagli esiti, una per elemento; una sessione nuova riparte dalle sue", async () => {
    const sessions = [fakeSession("uno", [filter("a"), filter("b")]), fakeSession("due", [filter("c")])];
    let next = 0;
    const motore = motoreDa(async (): Promise<SessioneMotore | MotoreAssente> => sessions[next++]!);
    // Si apre: non si sanno.
    expect(motore.perdite()).toBeNull();
    motore.trovate([filter("x")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(motore.perdite()!.map((loss) => loss.element)).toEqual(["a", "b"]);
    expect(motore.perdite()).toBe(motore.perdite());
    let changes = 0;
    motore.quandoCambia(() => changes++);
    // Una già nota, e una nuova due volte: si aggiunge una sola, e lo si dice.
    motore.trovate([filter("b", "un'altra frase"), filter("d"), filter("d")]);
    expect(changes).toBe(1);
    expect(motore.perdite()!.map((loss) => loss.element)).toEqual(["a", "b", "d"]);
    expect(motore.perdite()![1]!.detail).toBe("il filtro «ombra» resta com’è");
    // Niente di nuovo: nessun avviso.
    motore.trovate([filter("a")]);
    motore.trovate([]);
    expect(changes).toBe(1);
    // Spento: non si sanno; riacceso, la sessione nuova ha le sue.
    motore.spento();
    expect(motore.perdite()).toBeNull();
    motore.riapri();
    await Promise.resolve();
    await Promise.resolve();
    expect(motore.perdite()!.map((loss) => loss.element)).toEqual(["c"]);
    await motore.chiudi();
    expect(motore.perdite()).toBeNull();
  });
});
