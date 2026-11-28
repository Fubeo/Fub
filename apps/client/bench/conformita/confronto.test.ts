// **Il presidio del comparatore della conformità al prototipo.**
//
// Il controllo vero (`verifica.mjs`) apre un browser e non gira qui. Qui gira
// la sua parte pura, `confronto.mjs`: un confronto sbagliato darebbe verde a
// tutti i pezzi insieme, e un elemento che non c'è deve essere rosso, non un
// verde silenzioso. In fondo, la mappa dell'editor contro i suoi valori
// estratti e le sue eccezioni: una mappa cambiata senza rigenerare
// l'estrazione si vede già in `npm test`, prima del banco.
import { describe, expect, it } from "vitest";

import { SCENE } from "../scene.mjs";
import {
  BASE,
  TOLLERANZA,
  applicaEccezioni,
  colore,
  confronta,
  confrontaPezzo,
  coperture,
  decodifica,
  espandi,
  espressioniFub,
  famiglia,
  mescola,
  ombre,
  scriviDifferenza,
  scriviMancante,
  sentinelle,
  traduzioneDi,
  validaEccezioni,
  validaTraduzioni,
  type Differenza,
  type Eccezione,
  type Pezzo,
} from "./confronto.mjs";
import { DA_COPRIRE, PEZZI, STATI, TRADUZIONE, TRADUZIONI, VISTE } from "./mappa-editor.mjs";
import estratti from "./editor.json";
import eccezioniEditor from "./eccezioni-editor.json";

const pezzo: Pezzo = {
  id: "prova.superficie",
  prototipo: ".k",
  app: ".launcher",
  proprieta: ["width", "padding", "color", "box-shadow"],
};

const differenza = (proprieta: string, stato = "chiaro-1280"): Differenza => ({
  pezzo: pezzo.id,
  stato,
  selettorePrototipo: pezzo.prototipo,
  selettoreApp: pezzo.app,
  proprieta,
  atteso: "a",
  trovato: "b",
  motivo: "a ≠ b",
});

const eccezione = (proprieta: string, extra: Partial<Eccezione> = {}): Eccezione => ({
  pezzo: pezzo.id,
  proprieta,
  motivo: "una ragione scritta",
  riferimento: "DECISIONS 2026-11-16",
  ...extra,
});

describe("le lunghezze", () => {
  it("stanno nel mezzo pixel, e non oltre", () => {
    expect(TOLLERANZA.lunghezza).toBe(0.5);
    expect(confronta("width", "740px", "740.4px")).toBeNull();
    expect(confronta("width", "740px", "739.5px")).toBeNull();
    expect(confronta("width", "740px", "640px")).toBe("740px ≠ 640px");
    expect(confronta("padding-left", "18px", "18.6px")).not.toBeNull();
  });

  it("confrontano alla lettera le parole chiave", () => {
    expect(confronta("display", "flex", "flex")).toBeNull();
    expect(confronta("display", "flex", "grid")).toBe("flex ≠ grid");
    expect(confronta("line-height", "normal", "18px")).not.toBeNull();
  });

  it("tengono i numeri senza unità entro un centesimo", () => {
    expect(confronta("opacity", "0.5", "0.505")).toBeNull();
    expect(confronta("font-weight", "600", "700")).toBe("600 ≠ 700");
  });
});

describe("i colori", () => {
  it("si leggono in ogni formato che il browser restituisce", () => {
    const verde = [0, 87, 58, 1];
    expect(colore("rgb(0, 87, 58)")).toEqual(verde);
    expect(colore("rgba(0, 87, 58, 1)")).toEqual(verde);
    expect(colore("rgb(0 87 58 / 100%)")).toEqual(verde);
    expect(colore("#00573a")).toEqual(verde);
    expect(colore("#00573aff")).toEqual(verde);
    const srgb = colore("color(srgb 0 0.3411765 0.227451)")!;
    expect(srgb[1]).toBeCloseTo(87, 3);
    expect(colore("transparent")).toEqual([0, 0, 0, 0]);
    expect(colore("calc(1px)")).toBeNull();
  });

  it("portano oklch e oklab in sRGB", () => {
    // Il bianco e il rosso sRGB, coi valori OKLab di riferimento di Ottosson.
    const bianco = colore("oklch(1 0 0)")!;
    bianco.slice(0, 3).forEach((c) => expect(c).toBeCloseTo(255, 0));
    expect(confronta("color", "rgb(255, 0, 0)", "oklch(0.62796 0.25768 29.2339)")).toBeNull();
    expect(confronta("color", "rgb(255, 0, 0)", "oklab(0.62796 0.22486 0.12585)")).toBeNull();
    expect(confronta("color", "rgb(255, 0, 0)", "oklch(0.62796 0.25768 29.2339 / 0.5)")).not.toBeNull();
    expect(colore("oklch(62.796% 0.25768 29.2339deg)")![0]).toBeCloseTo(255, 0);
  });

  it("tollerano due punti per canale e un centesimo di alfa", () => {
    expect(confronta("color", "rgb(10, 20, 30)", "rgb(12, 18, 32)")).toBeNull();
    expect(confronta("color", "rgb(10, 20, 30)", "rgb(13, 20, 30)")).toBe(
      "rgba(10, 20, 30, 1) ≠ rgba(13, 20, 30, 1)",
    );
    expect(confronta("background-color", "rgba(0, 0, 0, 0.05)", "rgba(0, 0, 0, 0.055)")).toBeNull();
    expect(confronta("background-color", "rgba(0, 0, 0, 0.05)", "rgba(0, 0, 0, 0.07)")).not.toBeNull();
  });

  it("sono uguali quando sono tutti e due trasparenti, qualunque tinta abbiano", () => {
    expect(confronta("background-color", "rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0)")).toBeNull();
  });
});

describe("le ombre", () => {
  it("si scompongono nelle loro parti", () => {
    expect(ombre("none")).toEqual([]);
    expect(ombre("rgb(204, 215, 207) 0px 0px 0px 1px inset")).toEqual([
      { inset: true, x: 0, y: 0, blur: 0, spread: 1, colore: [204, 215, 207, 1] },
    ]);
  });

  it("si confrontano una per una, ombre multiple comprese", () => {
    const due = "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 4px 12px 0px";
    expect(confronta("box-shadow", due, "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 4.3px 12px 0px")).toBeNull();
    expect(confronta("box-shadow", due, "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px")).toBe("2 ombre ≠ 1 ombre");
    expect(confronta("box-shadow", due, "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.2) 0px 8px 12px 0px")).toBe(
      "ombra 2: y 4px ≠ 8px",
    );
    expect(confronta("box-shadow", due, "rgba(0, 0, 0, 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.4) 0px 4px 12px 0px")).toBe(
      "ombra 2: colore rgba(0, 0, 0, 0.2) ≠ rgba(0, 0, 0, 0.4)",
    );
    expect(confronta("box-shadow", "rgb(0, 0, 0) 0px 0px 0px 1px inset", "rgb(0, 0, 0) 0px 0px 0px 1px")).toBe(
      "inset true ≠ false",
    );
  });
});

describe("i gradienti e i caratteri", () => {
  it("confrontano funzione e argomenti, coi colori a tolleranza", () => {
    const g = "linear-gradient(rgba(0, 0, 0, 0), rgb(252, 254, 253))";
    expect(confronta("background-image", g, "linear-gradient(rgba(9, 9, 9, 0), rgb(251, 253, 254))")).toBeNull();
    expect(confronta("background-image", g, "radial-gradient(rgba(0, 0, 0, 0), rgb(252, 254, 253))")).toBe(
      "linear-gradient ≠ radial-gradient",
    );
    expect(confronta("background-image", g, "none")).toBe("1 immagini ≠ 0 immagini");
  });

  it("guardano la famiglia principale, e il taglio variabile è lo stesso carattere", () => {
    expect(famiglia('"Hanken Grotesk Variable", system-ui, sans-serif')).toBe("hanken grotesk");
    expect(confronta("font-family", '"Hanken Grotesk", system-ui', '"Hanken Grotesk Variable", Roboto')).toBeNull();
    expect(confronta("font-family", "Newsreader, serif", '"Hanken Grotesk", sans-serif')).toBe(
      "newsreader ≠ hanken grotesk",
    );
  });
});

describe("un pezzo", () => {
  const attesi = {
    width: "740px",
    "padding-top": "0px",
    "padding-right": "12px",
    "padding-bottom": "0px",
    "padding-left": "18px",
    color: "rgb(24, 35, 28)",
    "box-shadow": "none",
  };

  it("passa quando ogni proprietà coincide, gruppi sciolti", () => {
    expect(espandi(["padding", "padding-top", "gap"])).toEqual([
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "row-gap",
      "column-gap",
    ]);
    expect(confrontaPezzo(pezzo, "chiaro-1280", attesi, { ...attesi })).toEqual({ mancanti: [], differenze: [] });
  });

  it("dice pezzo, stato, selettori, proprietà, atteso e trovato", () => {
    const { differenze } = confrontaPezzo(pezzo, "chiaro-700", attesi, { ...attesi, width: "640px" });
    expect(differenze).toHaveLength(1);
    expect(scriviDifferenza(differenze[0])).toBe(
      "prova.superficie [chiaro-700] .k → .launcher: width atteso «740px», trovato «640px» (740px ≠ 640px)",
    );
  });

  it("è rosso se il selettore dell'app non trova niente: mai un verde silenzioso", () => {
    const { mancanti, differenze } = confrontaPezzo(pezzo, "scuro-1280", attesi, null);
    expect(differenze).toEqual([]);
    expect(mancanti).toHaveLength(1);
    expect(scriviMancante(mancanti[0])).toContain("nessun elemento visibile nel banco dell'app (.launcher)");
    expect(confrontaPezzo(pezzo, "scuro-1280", null, attesi).mancanti[0].lato).toBe("prototipo");
  });

  it("accetta un'alternativa fra le espressioni coi token di Fub", () => {
    const conToken = { ...attesi, color: [
      { come: "var(--accent-soft)", valore: "rgb(0, 96, 60)" },
      { come: "var(--accent-veil)", valore: "rgba(0, 96, 60, 0.1)" },
    ] };
    expect(confrontaPezzo(pezzo, "chiaro-1280", conToken, { ...attesi, color: "rgba(0, 96, 60, 0.1)" }).differenze).toEqual([]);
    const [d] = confrontaPezzo(pezzo, "chiaro-1280", conToken, { ...attesi, color: "rgb(1, 2, 3)" }).differenze;
    expect(d.atteso).toBe("var(--accent-soft) = rgb(0, 96, 60) | var(--accent-veil) = rgba(0, 96, 60, 0.1)");
  });
});

describe("le eccezioni", () => {
  it("coprono la differenza del loro pezzo e della loro proprietà, o del suo gruppo", () => {
    const r = applicaEccezioni(
      [differenza("box-shadow"), differenza("padding-left"), differenza("width")],
      [eccezione("box-shadow"), eccezione("padding")],
    );
    expect(r.rosse.map((d) => d.proprieta)).toEqual(["width"]);
    expect(r.giustificate.map((d) => d.proprieta)).toEqual(["box-shadow", "padding-left"]);
    expect(r.inutili).toEqual([]);
  });

  it("non più usate sono rosse anche loro", () => {
    const r = applicaEccezioni([], [eccezione("box-shadow")]);
    expect(r.inutili).toHaveLength(1);
  });

  it("ristrette a degli stati non coprono gli altri", () => {
    const r = applicaEccezioni([differenza("width", "scuro-700")], [eccezione("width", { stati: ["chiaro-700"] })]);
    expect(r.rosse).toHaveLength(1);
    expect(r.inutili).toHaveLength(1);
  });

  it("senza motivo o riferimento non valgono", () => {
    expect(validaEccezioni([{ pezzo: pezzo.id, proprieta: "width" }], [pezzo])).toEqual([
      "eccezione 1: manca «motivo»",
      "eccezione 1: manca «riferimento»",
    ]);
    expect(validaEccezioni([eccezione("width", { pezzo: "altro" })], [pezzo])).toEqual([
      "eccezione 1: il pezzo «altro» non è nella mappa",
    ]);
  });

  it("le proprietà da coprire si comportano come eccezioni, e un pezzo intero non si confronta", () => {
    const { errori, voci } = coperture(
      [
        { id: pezzo.id, proprieta: ["padding"], perche: "da correggere" },
        { id: "intero", prototipo: ".x", app: null, perche: "in lavorazione" },
      ],
      [pezzo],
    );
    expect(errori).toEqual([]);
    expect(voci).toEqual([
      { pezzo: pezzo.id, proprieta: "padding", motivo: "da correggere", riferimento: "DA_COPRIRE", daCoprire: true },
    ]);
    expect(coperture([{ id: pezzo.id, perche: "x" }], [pezzo]).errori).toEqual([
      "prova.superficie: è un pezzo intero da coprire, ma è anche in PEZZI",
    ]);
    expect(coperture([{ id: pezzo.id, proprieta: ["gap"], perche: "x" }], [pezzo]).errori).toEqual([
      "prova.superficie: «gap» da coprire non è fra le proprietà che il pezzo confronta",
    ]);
    expect(coperture([{ id: "nessuno", proprieta: ["width"], perche: "" }], [pezzo]).errori).toHaveLength(2);
  });

  it("una proprietà da coprire può valere solo in alcuni stati", () => {
    const { errori, voci } = coperture(
      [{ id: pezzo.id, proprieta: ["padding"], stati: ["chiaro-1280"], perche: "solo di giorno" }],
      [pezzo],
    );
    expect(errori).toEqual([]);
    const { rosse, inutili } = applicaEccezioni(
      [differenza("padding-top", "chiaro-1280"), differenza("padding-top", "scuro-1280")],
      voci,
    );
    expect(rosse.map((d) => d.stato)).toEqual(["scuro-1280"]);
    expect(inutili).toEqual([]);
    expect(coperture([{ id: pezzo.id, proprieta: ["padding"], stati: [], perche: "x" }], [pezzo]).errori).toEqual([
      "prova.superficie: `stati` da coprire è un elenco non vuoto",
    ]);
  });
});

describe("i token del prototipo", () => {
  const traduzione = { "--line": ["--border"], "--tray": ["--sheet-2"], "--sheet": ["--sheet"], "--acc-soft": ["--accent-soft", "--accent-veil"] };
  const sent = sentinelle(traduzione);
  const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map((x) => Math.round(x)).join(", ")})`;

  it("riconoscono una sentinella, una mescolanza e il trasparente", () => {
    expect(decodifica(sent["--line"], sent)).toEqual(["var(--line)"]);
    expect(decodifica(mescola(sent["--tray"], 0.55, sent["--sheet"]), sent)).toEqual([
      "color-mix(in srgb, var(--tray) 55%, var(--sheet))",
    ]);
    expect(decodifica([...sent["--line"].slice(0, 3), 0.09] as never, sent)).toEqual([
      "color-mix(in srgb, var(--line) 9%, transparent)",
    ]);
    expect(decodifica([1, 2, 3, 1], sent)).toEqual([]);
  });

  it("riscrivono il valore coi token di Fub, e lasciano crudi i colori scritti a mano", () => {
    expect(
      espressioniFub(
        "rgb(223, 231, 225) 0px -1px 0px 0px inset, rgba(20, 44, 30, 0.08) 0px 4px 12px 0px",
        `${rgb(sent["--line"])} 0px -1px 0px 0px inset, rgba(20, 44, 30, 0.08) 0px 4px 12px 0px`,
        traduzione,
      ),
    ).toEqual(["var(--border) 0px -1px 0px 0px inset, rgba(20, 44, 30, 0.08) 0px 4px 12px 0px"]);
    expect(espressioniFub("rgba(0, 110, 70, 0.1)", rgb(sent["--acc-soft"]), traduzione)).toEqual([
      "var(--accent-soft)",
      "var(--accent-veil)",
    ]);
    expect(espressioniFub("rgb(1, 2, 3)", "rgb(1, 2, 3)", traduzione)).toBeNull();
    expect(espressioniFub("none", "none", traduzione)).toBeNull();
  });

  it("si traducono col contesto del pezzo: la stessa sentinella, un token di Fub diverso", () => {
    const traduzioni = { interfaccia: traduzione, documento: { ...traduzione, "--line": ["--doc-rule-soft"] } };
    const documento = traduzioneDi({ contesto: "documento" }, traduzioni)!;
    expect(traduzioneDi({}, traduzioni)).toBe(traduzione);
    expect(espressioniFub("rgb(223, 231, 225)", rgb(sent["--line"]), documento)).toEqual(["var(--doc-rule-soft)"]);
    expect(validaTraduzioni(traduzioni, [{ ...pezzo, contesto: "documento" }])).toEqual([]);
  });

  it("vogliono gli stessi token in ogni contesto, e un contesto che esiste", () => {
    const { "--line": _tolto, ...senzaFilo } = traduzione;
    expect(validaTraduzioni({ interfaccia: traduzione, documento: senzaFilo }, [])).toHaveLength(1);
    expect(validaTraduzioni({ documento: traduzione }, [])).toHaveLength(1);
    expect(validaTraduzioni({ interfaccia: traduzione }, [{ ...pezzo, contesto: "stampa" }])).toHaveLength(1);
  });
});

describe("la mappa dell'editor", () => {
  it("nomina viste, stati e scene che esistono, e ha dei pezzi", () => {
    expect(PEZZI.length).toBeGreaterThan(0);
    for (const [id, vista] of Object.entries(VISTE)) {
      // La scena di una vista coi soli pezzi che attendono può nascere con
      // quel lavoro: la verifica non la apre.
      const letta = PEZZI.some((p) => p.vista === id && !p.attende);
      if (letta) expect(SCENE.some((s: { id: string }) => s.id === vista.app.scena), `vista «${id}»`).toBe(true);
      expect(PEZZI.some((p) => p.vista === id), `vista «${id}» senza pezzi`).toBe(true);
      for (const stato of vista.stati) expect(STATI).toHaveProperty(stato);
    }
    for (const p of PEZZI) {
      expect(VISTE).toHaveProperty(p.vista);
      expect(new Set(PEZZI.map((q) => q.id)).size).toBe(PEZZI.length);
    }
    expect(BASE).toContain("box-shadow");
  });

  it("dice per ogni pezzo che attende quale lavoro lo porta", () => {
    for (const p of PEZZI.filter((q) => "attende" in q)) {
      expect(p.attende, p.id).toMatch(/^(#\d+|[a-z]+\/[a-z0-9-]+)$/);
    }
  });

  it("ha i valori estratti di ogni pezzo in ogni stato, con le sue proprietà", () => {
    expect(estratti.traduzioni).toEqual(TRADUZIONI);
    expect(validaTraduzioni(TRADUZIONI, PEZZI)).toEqual([]);
    expect(TRADUZIONI.interfaccia).toBe(TRADUZIONE);
    const valori = estratti.valori as unknown as Record<
      string,
      Record<string, { prototipo: string; contesto: string; proprieta: Record<string, string> }>
    >;
    for (const p of PEZZI) {
      const vista = VISTE[p.vista as keyof typeof VISTE];
      for (const stato of p.stati ?? vista.stati) {
        const v = valori[p.id]?.[stato];
        expect(v, `${p.id} [${stato}]: rigenera con estrai.mjs`).toBeDefined();
        expect(v.prototipo).toBe(p.prototipo);
        expect(v.contesto, `${p.id} [${stato}]`).toBe(p.contesto ?? "interfaccia");
        expect(Object.keys(v.proprieta).sort()).toEqual(espandi(p.proprieta).sort());
      }
    }
    expect(Object.keys(valori).sort()).toEqual(PEZZI.map((p) => p.id).sort());
  });

  it("ha eccezioni scritte bene e voci da coprire coerenti", () => {
    expect(validaEccezioni(eccezioniEditor, PEZZI)).toEqual([]);
    expect(coperture(DA_COPRIRE, PEZZI).errori).toEqual([]);
  });
});
