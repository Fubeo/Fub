// La famiglia «nucleo» lato client (piano K6, T11): gli strumenti del motore per
// scegliere e per la vista nella colonna del Completo, e le voci
// dell'interfaccia che il motore non esegue. È la `prova` dei casi di
// `crates/fub-disegno/tests/famiglie/nucleo.json` che non hanno un gesto:
// `hand`, `zoom`, `rotateView` (la vista è di Fub), `tool.select` (la casella
// della colonna sceglie lo strumento del motore), `tool.setOption` e
// `tool.options` (la fila delle opzioni in testata).

import { describe, expect, it } from "vitest";
import { toolsFor } from "../tools/registry";
import { gradiAttorno, VISTA_DEL_MOTORE, vistaDelMotore } from "../tools/editor/hand-zoom";
import { casellaMotore, casellePresenti, caselleCheStanno, PREFISSO_MOTORE, spazioCaselle, type MisureColonna } from "../tools/editor/chrome/rail";
import { descrivi } from "./opzioni";
import { ICONE_MOTORE, iconaMotore, ICONA_MOTORE_GENERICA, layoutCompleto, MOTORE_PRONTO } from "./colonna";
import { TESTI as TESTI_NUCLEO } from "./famiglie/nucleo/testi";
import { COLONNA_EN, COLONNA_IT } from "../strings/completo";

/// I nomi corti dei tracciati (T12): nelle parole della colonna, perché la
/// colonna li mostra prima che la famiglia arrivi.
const TESTI_TRACCIATI: Record<string, { it: string; en: string }> = Object.fromEntries(
  Object.entries(COLONNA_IT)
    .filter(([chiave]) => chiave.startsWith("draw.engine.name."))
    .map(([chiave, it]) => [`strumento:${chiave.slice("draw.engine.name.".length)}`, { it, en: COLONNA_EN[chiave as keyof typeof COLONNA_EN] }]),
);

/// I nomi corti degli strumenti pronti: del nucleo (T11) e dei tracciati (T12).
const TESTI = { ...TESTI_NUCLEO, ...TESTI_TRACCIATI };
import indiceGenerato from "./indice.generated.json";
import { DRAW_ICONS } from "../icons";
import { t } from "../strings";
import { nomeCortoColonna, type StrumentoMotoreColonna } from "./index";

interface VoceGenerata {
  readonly fonte: string;
  readonly id: string;
  readonly famiglia: string;
  readonly chiamata: { readonly strumento?: string };
}

const VOCI = (indiceGenerato as { readonly voci: readonly VoceGenerata[] }).voci;
const STRUMENTI_NUCLEO = VOCI.filter((voce) => voce.famiglia === "nucleo" && voce.chiamata.strumento !== undefined).map((voce) => voce.chiamata.strumento!);

describe("gli strumenti del nucleo nella colonna", () => {
  it("MOTORE_PRONTO è l'elenco degli strumenti «fatto» dell'indice generato", () => {
    const fatti = VOCI.filter((voce) => voce.chiamata.strumento !== undefined).map((voce) => voce.chiamata.strumento!);
    expect([...MOTORE_PRONTO].sort()).toEqual([...fatti].sort());
    expect([...STRUMENTI_NUCLEO].sort()).toEqual(["directSelection", "groupSelection", "hand", "lasso", "rotateView", "selection", "zoom"]);
  });

  it("ogni strumento pronto ha il nome corto nelle due lingue e un'icona del catalogo", () => {
    for (const id of MOTORE_PRONTO) {
      const nome = TESTI[`strumento:${id}`];
      expect(nome, id).toBeDefined();
      expect(nome!.it.trim()).not.toBe("");
      expect(nome!.en.trim()).not.toBe("");
      expect(nome!.it).not.toContain(id);
      expect(iconaMotore(id)).not.toBe(ICONA_MOTORE_GENERICA);
      expect(DRAW_ICONS[iconaMotore(id)], iconaMotore(id)).toBeDefined();
    }
    // Uno strumento che il prototipo non disegna ha l'icona generica, che c'è.
    expect(iconaMotore("inventato")).toBe(ICONA_MOTORE_GENERICA);
    expect(DRAW_ICONS[ICONA_MOTORE_GENERICA]).toBeDefined();
    expect(Object.keys(ICONE_MOTORE).sort()).toEqual([...MOTORE_PRONTO].sort());
  });

  it("nella stessa casella uno strumento del motore non si chiama come quello di Fub", () => {
    const nomiFub = new Map(toolsFor("full", "vector").map((spec) => [spec.id as string, [t(`draw.tool.${spec.id}` as never), spec.id] as const]));
    for (const gruppo of layoutCompleto(toolsFor("full", "vector"), MOTORE_PRONTO)) {
      for (const casella of gruppo.caselle) {
        const diFub = casella.filter((id) => !id.startsWith(PREFISSO_MOTORE)).map((id) => nomiFub.get(id)?.[0]);
        for (const id of casella.filter((one) => one.startsWith(PREFISSO_MOTORE))) {
          const nome = TESTI[`strumento:${id.slice(PREFISSO_MOTORE.length)}`]!.it;
          expect(diFub, id).not.toContain(nome);
        }
      }
    }
  });

  it("i sette strumenti stanno nelle caselle del prototipo, dopo quelli di Fub della stessa casella", () => {
    const layout = layoutCompleto(toolsFor("full", "vector"), MOTORE_PRONTO);
    const pick = layout.find((gruppo) => gruppo.id === "pick")!;
    expect(pick.caselle).toEqual([["select", "motore:selection"], ["motore:directSelection", "motore:groupSelection"], ["motore:lasso"]]);
    const view = layout.find((gruppo) => gruppo.id === "view")!;
    expect(view.caselle).toEqual([["hand", "zoom", "motore:hand", "motore:zoom", "motore:rotateView"]]);
    const delMotore = layout.flatMap((gruppo) => gruppo.caselle.flat()).filter((id) => id.startsWith(PREFISSO_MOTORE) && STRUMENTI_NUCLEO.includes(id.slice(PREFISSO_MOTORE.length)));
    expect(delMotore).toHaveLength(7);
  });
});

describe("gli strumenti dei tracciati nella colonna (T12)", () => {
  it("i ventuno stanno nelle tre caselle di «disegnare», nell'ordine del prototipo", () => {
    const layout = layoutCompleto(toolsFor("full", "vector"), MOTORE_PRONTO);
    const draw = layout.find((gruppo) => gruppo.id === "draw")!;
    // La Penna è quella del motore; la Matita del motore apre la sua casella,
    // con l'Inchiostro e l'Evidenziatore di Fub dopo; la Gomma del motore apre
    // la sua, con la gomma di Fub dopo (`colonna-penna` del prototipo).
    expect(draw.caselle).toEqual([
      ["motore:pen", "motore:smartPen", "motore:curvature", "motore:addAnchor", "motore:deleteAnchor", "motore:anchorPoint", "motore:cornerTool", "motore:slideAnchor", "motore:extendPath"],
      ["motore:pencil", "pen", "highlighter", "motore:smooth", "motore:join", "motore:sharedEdge"],
      ["motore:eraser", "eraser", "motore:pathEraser", "motore:anchorEraserBrush", "motore:scissors", "motore:knife", "motore:mirrorCut", "motore:lineCut", "motore:rectCut"],
    ]);
    const tracciati = VOCI.filter((voce) => voce.famiglia === "tracciati" && voce.chiamata.strumento !== undefined).map((voce) => voce.chiamata.strumento!);
    expect(tracciati).toHaveLength(21);
    expect(draw.caselle.flat().filter((id) => id.startsWith(PREFISSO_MOTORE)).map((id) => id.slice(PREFISSO_MOTORE.length)).sort()).toEqual([...tracciati].sort());
  });

  it("la Penna di Fub si chiama «Inchiostro», e la Penna è quella del motore", () => {
    expect(t("draw.tool.pen")).toBe("Inchiostro");
    expect(TESTI["strumento:pen"]).toEqual({ it: "Penna", en: "Pen" });
    expect(TESTI["strumento:pencil"]).toEqual({ it: "Matita", en: "Pencil" });
  });

  it("la colonna ha i nomi corti dei tracciati prima che la famiglia arrivi; gli altri no", () => {
    expect(nomeCortoColonna("pen")).toBe("Penna");
    expect(nomeCortoColonna("slideAnchor")).toBe("Fai scorrere il punto di ancoraggio lungo il tracciato");
    expect(nomeCortoColonna("selection")).toBeNull();
    expect(nomeCortoColonna("inventato")).toBeNull();
  });
});

describe("tool.select: la casella di uno strumento del motore", () => {
  const descritto = (famiglia: StrumentoMotoreColonna["famiglia"]): StrumentoMotoreColonna => ({ nome: "Selezione diretta", icona: "draw-direct-select", famiglia });

  it("c'è solo se il Completo la sa descrivere: mai un id al posto del nome", () => {
    const offerti = toolsFor("full", "vector");
    const caselle = [["select", "motore:selection"], ["motore:directSelection", "motore:groupSelection"], ["motore:lasso"]];
    expect(casellePresenti(caselle, offerti)).toEqual([["select"]]);
    expect(casellePresenti(caselle, offerti, (id) => id !== "lasso")).toEqual([["select", "motore:selection"], ["motore:directSelection", "motore:groupSelection"]]);
  });

  it("col nome e l'icona della famiglia; mentre si prepara, e se non si è preparata, lo dice", () => {
    expect(casellaMotore("directSelection", descritto("pronta"))).toEqual({ id: "motore:directSelection", label: "Selezione diretta", icon: "draw-direct-select", description: "Selezione diretta" });
    const prepara = casellaMotore("directSelection", descritto("in-arrivo"));
    expect(prepara.label).toBe(t("draw.engine.tool.preparing", { tool: "Selezione diretta" }));
    expect(prepara.label).toContain("Selezione diretta");
    const errore = casellaMotore("directSelection", descritto("errore"));
    expect(errore.label).toBe(t("draw.engine.tool.failed", { tool: "Selezione diretta" }));
    expect(errore.description).toBe(errore.label);
    // Una famiglia non ancora chiesta si prepara alla scelta: il nome basta.
    expect(casellaMotore("directSelection", descritto("assente")).label).toBe("Selezione diretta");
  });

  it("più di sei caselle a 1280×800: la colonna da 44 px ne tiene otto in 550 px, il resto va nel cassetto", () => {
    const offerti = toolsFor("full", "vector");
    const gruppi = layoutCompleto(offerti, MOTORE_PRONTO).map((gruppo) => casellePresenti(gruppo.caselle, offerti, (id) => MOTORE_PRONTO.has(id)).length);
    const quante = gruppi.reduce((somma, n) => somma + n, 0);
    expect(quante).toBeGreaterThan(6);
    // Le misure della colonna grande del kit: 44 px a casella, 2 fra due
    // caselle, 8 fra due gruppi, 4 di respiro per gruppo, 12 di cornice.
    const misure: MisureColonna = { lato: 44, filoCasella: 2, filoGruppo: 8, respiroGruppo: 4, cornice: 12 };
    expect(spazioCaselle([...gruppi, 1], misure)).toBeLessThanOrEqual(550);
    expect(caselleCheStanno(550, gruppi, misure)).toBe(quante);
    // Una finestra più bassa: quelle che non stanno passano nel cassetto, e
    // «Tutti gli strumenti» resta.
    const stanno = caselleCheStanno(300, gruppi, misure);
    expect(stanno).toBeLessThan(quante);
    expect(stanno).toBeGreaterThan(0);
  });
});

describe("hand, zoom, rotateView: la vista è di Fub", () => {
  it("gli strumenti della vista del motore fanno la Mano, la Lente e il giro della vista", () => {
    expect(VISTA_DEL_MOTORE).toEqual({ hand: "pan", zoom: "zoom", rotateView: "turn" });
    expect(vistaDelMotore("hand")).toBe("pan");
    expect(vistaDelMotore("zoom")).toBe("zoom");
    expect(vistaDelMotore("rotateView")).toBe("turn");
    expect(vistaDelMotore("selection")).toBeNull();
    expect(vistaDelMotore(null)).toBeNull();
    // Un nome di Object non è uno strumento della vista.
    expect(vistaDelMotore("toString")).toBeNull();
  });

  it("il giro della vista è l'angolo del puntatore attorno al centro, in gradi, nel verso dell'orologio", () => {
    expect(gradiAttorno([0, 0], [10, 0], [0, 10])).toBeCloseTo(90);
    expect(gradiAttorno([0, 0], [10, 0], [0, -10])).toBeCloseTo(-90);
    expect(gradiAttorno([50, 50], [60, 50], [60, 50])).toBeCloseTo(0);
    // Passando da −180 a 180 si gira di poco, non di un giro intero.
    expect(gradiAttorno([0, 0], [-10, 1], [-10, -1])).toBeCloseTo(11.42, 1);
  });
});

describe("tool.setOption e tool.options: la fila delle opzioni", () => {
  it("le opzioni degli strumenti del nucleo sono solo forma: la fila non ha controlli, e non inventa etichette", () => {
    // `directSelection` e `groupSelection` portano i punti scelti
    // (`meshPoints`), che non si mostrano in una fila; `selection` non ha opzioni.
    const punti = descrivi({ meshPoints: [] }, TESTI);
    expect(punti.controlli).toEqual([]);
    expect(punti.fuori.map((one) => one.chiave)).toEqual(["meshPoints"]);
    expect(descrivi(null, TESTI).controlli).toEqual([]);
  });

  it("un'opzione con la sua etichetta è un controllo della fila (`disegno.strumento.opzione` la manda)", () => {
    const etichette = { ...TESTI, spessore: { it: "Spessore", en: "Width" } };
    expect(descrivi({ spessore: 3 }, etichette).controlli).toEqual([{ tipo: "numero", chiave: "spessore", valore: 3 }]);
  });
});
