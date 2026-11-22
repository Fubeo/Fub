// @vitest-environment happy-dom
// Il menu ≡ › Selezione del Disegno completo (K6 T15, giro 1): Uguale e Oggetto sono sottomenu con le
// loro voci dall'indice; una voce che non vale per ciò che è scelto è spenta col suo perché, e una che
// vale resta accesa. Il percorso è quello vero: `menu()` del Completo, con lo stato del motore.
import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../../../ui/menu";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

/// Il motore: i comandi della selezione stanno accesi solo con qualcosa di scelto.
function motoreFinto() {
  const comandi = vi.fn((selezione: readonly string[]) =>
    Promise.resolve(
      ["disegno.select.same.fillColor", "disegno.select.same.opacity", "disegno.select.object.allOnSameLayers"].map((id) =>
        selezione.length === 0 ? { id, enabled: false, disabled_reason: "no_selection" } : { id, enabled: true, disabled_reason: null },
      ),
    ),
  );
  const sessione = { comandi, comando: vi.fn() } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comandi };
}

/// La voce del menu con questa etichetta, cercata anche dentro i sottomenu.
function trova(voci: readonly MenuItem[], etichetta: string): MenuItem | undefined {
  for (const voce of voci) {
    if (voce.label === etichetta) return voce;
    const dentro = Array.isArray(voce.items) ? trova(voce.items, etichetta) : undefined;
    if (dentro !== undefined) return dentro;
  }
  return undefined;
}

/// I figli di una voce di menu, se è un sottomenu (il tipo di `items` è quello di un menu a funzione).
function figli(voce: MenuItem | undefined): readonly MenuItem[] {
  return voce !== undefined && Array.isArray(voce.items) ? (voce.items as readonly MenuItem[]) : [];
}

const AZIONI = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };

describe("il menu ≡ › Selezione", () => {
  it("Uguale ha le sue voci, e Oggetto è un sottomenu di Selezione", async () => {
    const { motore } = motoreFinto();
    const c = apri({ motore, life: openLifetime() } as never, { indice: () => Promise.resolve(indiceDi(indiceGenerato as never)) } as never);
    const voci = await c.menu(() => [], AZIONI);
    const selezione = voci.find((voce) => Array.isArray(voce.items) && voce.items.some((dentro) => dentro.label === "Uguale"));
    expect(selezione, "il menu Selezione").toBeDefined();
    const uguale = trova(selezione!.items as MenuItem[], "Uguale");
    expect(figli(uguale).map((voce) => voce.label)).toEqual(expect.arrayContaining(["Colore riempimento", "Opacità", "Istanza di simbolo"]));
    expect((selezione!.items as MenuItem[]).some((voce) => voce.label === "Oggetto" && Array.isArray(voce.items))).toBe(true);
    c.chiudi();
  });

  it("con niente di scelto le voci Uguale sono spente; con un oggetto scelto restano accese", async () => {
    const { motore } = motoreFinto();
    const c = apri({ motore, life: openLifetime() } as never, { indice: () => Promise.resolve(indiceDi(indiceGenerato as never)) } as never);
    const spente = trova(await c.menu(() => [], AZIONI), "Colore riempimento");
    expect(spente?.disabled).toBe(true);
    expect(spente?.description).toBe(t("draw.disabled.no_selection"));
    const accese = trova(await c.menu(() => ["oa1a1a1a1"], AZIONI), "Colore riempimento");
    expect(accese?.disabled).toBeFalsy();
    c.chiudi();
  });
});

/// Ciò che una voce di ≡ › Selezione dice: `true` se è accesa, altrimenti il perché che il client mostra.
type Atteso = true | string;

/// Le otto voci nuove di ≡ › Selezione (K6 T15, giro 6): l'etichetta del sottomenu, e ciò che si vede senza
/// scelta, con un testo scelto (`ot1a1a1a1`) e con un rettangolo scelto (`oe7e7e7e7`).
interface VoceNuova {
  readonly id: string;
  readonly label: string;
  readonly sottomenu: "Uguale" | "Oggetto";
  readonly senza: Atteso;
  readonly testo: Atteso;
  readonly rettangolo: Atteso;
}

const SENZA_OGGETTO = t("draw.disabled.no_selection");
const SENZA_TESTO = t("draw.disabled.needs_text");
const SENZA_PUNTI_ISOLATI = "Nel disegno non ci sono punti isolati.";

const NUOVE: readonly VoceNuova[] = [
  { id: "select.same.fontFamily", label: "Famiglia di font", sottomenu: "Uguale", senza: SENZA_OGGETTO, testo: true, rettangolo: SENZA_TESTO },
  { id: "select.same.fontFamilyStyle", label: "Famiglia e stile font", sottomenu: "Uguale", senza: SENZA_OGGETTO, testo: true, rettangolo: SENZA_TESTO },
  { id: "select.same.fontFamilyStyleSize", label: "Famiglia, stile e dimensione font", sottomenu: "Uguale", senza: SENZA_OGGETTO, testo: true, rettangolo: SENZA_TESTO },
  { id: "select.same.fontSize", label: "Dimensione font", sottomenu: "Uguale", senza: SENZA_OGGETTO, testo: true, rettangolo: SENZA_TESTO },
  { id: "select.same.textFillColor", label: "Colore riempimento testo", sottomenu: "Uguale", senza: SENZA_OGGETTO, testo: true, rettangolo: SENZA_TESTO },
  { id: "select.same.textStrokeColor", label: "Colore tratto testo", sottomenu: "Uguale", senza: SENZA_OGGETTO, testo: true, rettangolo: SENZA_TESTO },
  { id: "select.object.strayPoints", label: "Punti isolati", sottomenu: "Oggetto", senza: SENZA_PUNTI_ISOLATI, testo: SENZA_PUNTI_ISOLATI, rettangolo: SENZA_PUNTI_ISOLATI },
  { id: "select.object.openPaths", label: "Tracciati aperti", sottomenu: "Oggetto", senza: true, testo: true, rettangolo: true },
];

/// Il motore del disegno di prova: `ot1a1a1a1` è un testo di punto, c'è un tracciato aperto, e non ci sono
/// punti isolati. Uguale vuole una scelta, e un testo nella scelta.
function comandiDelDisegnoDiProva(selezione: readonly string[]) {
  return NUOVE.map(({ id }) => {
    const accesa = { id: `disegno.${id}`, enabled: true, disabled_reason: null };
    const spenta = (perche: unknown) => ({ id: `disegno.${id}`, enabled: false, disabled_reason: perche });
    if (id.startsWith("select.same.")) {
      if (selezione.length === 0) return spenta("no_selection");
      return selezione.includes("ot1a1a1a1") ? accesa : spenta("needs_text");
    }
    if (id === "select.object.strayPoints") return spenta({ other: { text: SENZA_PUNTI_ISOLATI } });
    return accesa;
  });
}

/// Il sottomenu Uguale o Oggetto di ≡ › Selezione: si cerca dentro Selezione, perché ≡ ha anche un suo «Oggetto».
function sottomenuDiSelezione(voci: readonly MenuItem[], sottomenu: string): readonly MenuItem[] {
  const selezione = voci.find((voce) => Array.isArray(voce.items) && voce.items.some((dentro) => dentro.label === "Uguale"));
  return figli(figli(selezione).find((voce) => voce.label === sottomenu));
}

describe("le voci nuove di ≡ › Selezione (K6 T15, giro 6)", () => {
  it.each(NUOVE)("$label sta nel suo sottomenu, accesa dove vale, e dice perché è spenta", async (voce) => {
    const comandi = vi.fn((selezione: readonly string[]) => Promise.resolve(comandiDelDisegnoDiProva(selezione)));
    const sessione = { comandi, comando: vi.fn() } as unknown as SessioneMotore;
    const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
    const c = apri({ motore, life: openLifetime() } as never, { indice: () => Promise.resolve(indiceDi(indiceGenerato as never)) } as never);
    const scelte: ReadonlyArray<readonly [readonly string[], Atteso]> = [
      [[], voce.senza],
      [["ot1a1a1a1"], voce.testo],
      [["oe7e7e7e7"], voce.rettangolo],
    ];
    for (const [scelta, atteso] of scelte) {
      const item = sottomenuDiSelezione(await c.menu(() => [...scelta], AZIONI), voce.sottomenu).find((dentro) => dentro.label === voce.label);
      const dove = `${voce.label} con ${scelta.length === 0 ? "niente" : scelta[0]}`;
      expect(item, dove).toBeDefined();
      if (atteso === true) {
        expect(item?.disabled, dove).toBeFalsy();
      } else {
        expect(item?.disabled, dove).toBe(true);
        expect(item?.description, dove).toBe(atteso);
      }
    }
    c.chiudi();
  });

  it("Uguale mette il testo in una fila sua, dopo gli oggetti, con una riga di separazione", async () => {
    const comandi = vi.fn((selezione: readonly string[]) => Promise.resolve(comandiDelDisegnoDiProva(selezione)));
    const sessione = { comandi, comando: vi.fn() } as unknown as SessioneMotore;
    const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
    const c = apri({ motore, life: openLifetime() } as never, { indice: () => Promise.resolve(indiceDi(indiceGenerato as never)) } as never);
    const voci = sottomenuDiSelezione(await c.menu(() => ["ot1a1a1a1"], AZIONI), "Uguale");
    const testo = NUOVE.filter((voce) => voce.id.startsWith("select.same.font") || voce.id.startsWith("select.same.text"));
    const posti = testo.map((voce) => voci.findIndex((dentro) => dentro.label === voce.label));
    expect(posti.every((posto) => posto >= 0), "tutte le voci del testo nel sottomenu").toBe(true);
    expect(Math.max(...posti) - Math.min(...posti), "una dopo l'altra").toBe(testo.length - 1);
    const primo = Math.min(...posti);
    expect(voci[primo]?.separator, "riga di separazione prima del testo").toBe(true);
    expect(voci[primo - 1]?.label, "prima del testo ci sono gli oggetti").toBe("Istanza di simbolo");
    c.chiudi();
  });

  it("Oggetto mette punti isolati e tracciati aperti in una fila sua, con una riga di separazione", async () => {
    const comandi = vi.fn((selezione: readonly string[]) => Promise.resolve(comandiDelDisegnoDiProva(selezione)));
    const sessione = { comandi, comando: vi.fn() } as unknown as SessioneMotore;
    const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
    const c = apri({ motore, life: openLifetime() } as never, { indice: () => Promise.resolve(indiceDi(indiceGenerato as never)) } as never);
    const voci = sottomenuDiSelezione(await c.menu(() => ["ot1a1a1a1"], AZIONI), "Oggetto");
    const posto = (etichetta: string) => voci.findIndex((dentro) => dentro.label === etichetta);
    expect(posto("Punti isolati"), "Punti isolati nel sottomenu").toBeGreaterThanOrEqual(0);
    expect(posto("Tracciati aperti"), "Tracciati aperti subito dopo").toBe(posto("Punti isolati") + 1);
    expect(voci[posto("Punti isolati")]?.separator, "riga di separazione prima dei punti isolati").toBe(true);
    expect(posto("Tutti gli oggetti di testo"), "il testo resta nella sua fila prima").toBeLessThan(posto("Punti isolati"));
    c.chiudi();
  });
});

describe("Riseleziona in ≡ › Selezione (K6 T15, giro 2)", () => {
  it("sta nel menu Selezione, e dice perché è spenta quando il banco non ha un comando da ripetere", async () => {
    const perche = "Prima scegli un comando di selezione, per esempio Uguale o Oggetto.";
    const comandi = vi.fn(() =>
      Promise.resolve([{ id: "disegno.select.reselect", enabled: false, disabled_reason: { other: { text: perche } } }]),
    );
    const sessione = { comandi, comando: vi.fn() } as unknown as SessioneMotore;
    const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
    const c = apri({ motore, life: openLifetime() } as never, { indice: () => Promise.resolve(indiceDi(indiceGenerato as never)) } as never);
    const voci = await c.menu(() => ["oa1a1a1a1"], AZIONI);
    const selezione = voci.find((voce) => Array.isArray(voce.items) && voce.items.some((dentro) => dentro.label === "Uguale"));
    const riseleziona = (selezione!.items as MenuItem[]).find((voce) => voce.label === "Riseleziona");
    expect(riseleziona, "Riseleziona nel menu Selezione").toBeDefined();
    expect(riseleziona?.disabled).toBe(true);
    expect(riseleziona?.description).toBe(perche);
    c.chiudi();
  });
});
