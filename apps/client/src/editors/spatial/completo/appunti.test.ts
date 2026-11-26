// Gli appunti del Completo (K6 T11): copia e taglia passano dal motore e
// scrivono SVG, PNG e testo; incolla usa l'impronta o importa; i conflitti di
// nomi si chiedono; un formato che non si legge si dice; «Cancella cronologia»
// si conferma. Motore, sessione e finestra sono finti: nessun DOM.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DialogHandle } from "../../../kit/dialog";
import { openDialog } from "../../../kit/dialog";
import type { DrawingOutcome } from "../../../host/contract";
import { readClipboard, writeClipboardData, type ClipboardEntry } from "../../../platform/clipboard";
import { displayBinding } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { MAX_EDIT_BYTES } from "../scene/read";
import { plural, t } from "../strings";
import type { MotoreDelDisegno } from "../motore/gesti";
import { appuntiCompletoDi, cronologiaDi, registraAppuntiCompleto, registraCronologia, leggiAppuntiDaEvento, readPaste, SVG_TYPE, type LetturaAppunti } from "../tools/clipboard";
import { creaAppuntiCompleto, type DipendenzeAppunti } from "./appunti";

vi.mock("../../../kit/dialog", () => ({ openDialog: vi.fn() }));
// Il lettore di Excalidraw e draw.io: si finge solo la conversione, e il riconoscimento
// resta quello vero salvo per il caso del test.
vi.mock("../import/foreign", async (importOriginal) => {
  const reale = await importOriginal<typeof import("../import/foreign")>();
  return { ...reale, foreignDrawing: vi.fn(reale.foreignDrawing) };
});
vi.mock("../import/paste", () => ({
  pastedDrawing: vi.fn(() => Promise.resolve({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect x="1" y="1" width="28" height="18" fill="#ff0000"/></svg>', notes: [] })),
}));
vi.mock("../../../platform/clipboard", async (importOriginal) => {
  const reale = await importOriginal<typeof import("../../../platform/clipboard")>();
  return {
    ...reale,
    clipboardSupports: vi.fn(() => true),
    writeClipboardData: vi.fn(() => Promise.resolve()),
    readClipboard: vi.fn(() => Promise.resolve([])),
  };
});

/// Il disegno che `clipboard.exportSvg` dà per il rettangolo copiato.
const SVG = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">\n  <rect x="0" y="0" width="100" height="50" fill="#000000"/>\n</svg>\n`;
/// Un altro SVG, come quello di un altro programma o del Semplice.
const ALTRO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect x="1" y="1" width="28" height="18" fill="#ff0000"/></svg>`;
/// Un PNG di un pixel, in base64.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function esito(extra: Partial<DrawingOutcome> = {}): DrawingOutcome {
  return { revision: "r1", preview: null, ops: null, selection: [], losses: [], refused: null, frame: null, reading: null, ...extra };
}

const vite: Lifetime[] = [];
afterEach(() => {
  for (const life of vite.splice(0)) life.close();
  vi.clearAllMocks();
});

/// Un motore finto: le risposte per ogni id di comando, e le chiamate registrate.
function motoreFinto(risposte: Record<string, Partial<DrawingOutcome>> = {}) {
  const chiamate: { id: string; value: unknown }[] = [];
  const sessione = {
    comando: vi.fn(async (richiesta: { id: string; value: unknown }) => {
      chiamate.push({ id: richiesta.id, value: richiesta.value });
      return esito(risposte[richiesta.id] ?? { refused: "unsupported" });
    }),
  };
  const motore = { pronta: vi.fn(async () => sessione) } as unknown as MotoreDelDisegno;
  return { motore, sessione, chiamate, ids: () => chiamate.map((c) => c.id) };
}

const RISPOSTE_COPIA: Record<string, Partial<DrawingOutcome>> = {
  "disegno.edit.copy": { refused: "empty" },
  "disegno.clipboard.flavours": { reading: { flavours: ["text/plain", "image/svg+xml", "image/png"] } },
  "disegno.clipboard.exportSvg": { reading: { svg: SVG } },
  "disegno.clipboard.exportPng": { reading: { dataBase64: PNG_BASE64, width: 100, height: 50, warnings: [] } },
  "disegno.clipboard.exportText": { reading: { text: null } },
};

function creaCon(motore: MotoreDelDisegno, selezione: string[] = ["oa1a1a1a1"]) {
  const vita = openLifetime();
  vite.push(vita);
  const dipendenze: DipendenzeAppunti = {
    motore,
    vita,
    selezione: () => selezione,
    applica: vi.fn(),
    annuncia: vi.fn(),
  };
  return { appunti: creaAppuntiCompleto(dipendenze), dipendenze, vita };
}

/// La lettura di una copia del Completo, come la dà il Semplice dagli appunti.
function letturaDi(svg: string | null, altri: string[] = []): LetturaAppunti {
  return { testo: svg, svg, immagini: [], altri };
}

function finestraConRisposta(valore: unknown): void {
  vi.mocked(openDialog).mockReturnValue({ element: {} as HTMLElement, result: Promise.resolve(valore), close: () => undefined } as unknown as DialogHandle<unknown>);
}

describe("copia e taglia", () => {
  it("copia scrive nel sistema SVG, PNG e testo del motore, e lo dice", async () => {
    const { motore, ids } = motoreFinto(RISPOSTE_COPIA);
    const { appunti, dipendenze } = creaCon(motore);
    await appunti.copia("copy");
    expect(ids()).toEqual([
      "disegno.edit.copy",
      "disegno.clipboard.flavours",
      "disegno.clipboard.exportSvg",
      "disegno.clipboard.exportPng",
      "disegno.clipboard.exportText",
    ]);
    expect(vi.mocked(writeClipboardData)).toHaveBeenCalledOnce();
    const contenuto = vi.mocked(writeClipboardData).mock.calls[0]![0] as Record<string, Blob>;
    expect(Object.keys(contenuto).sort()).toEqual(["image/png", SVG_TYPE, "text/plain"].sort());
    expect(await contenuto["text/plain"]!.text()).toBe(SVG);
    expect(await contenuto[SVG_TYPE]!.text()).toBe(SVG);
    expect(contenuto["image/png"]!.type).toBe("image/png");
    expect(vi.mocked(dipendenze.annuncia)).toHaveBeenCalledWith(plural(1, "draw.copied.one", "draw.copied.other"));
  });

  it("il testo del motore vince sull'SVG per text/plain", async () => {
    const { motore } = motoreFinto({ ...RISPOSTE_COPIA, "disegno.clipboard.exportText": { reading: { text: "Ciao" } } });
    const { appunti } = creaCon(motore);
    await appunti.copia("copy");
    const contenuto = vi.mocked(writeClipboardData).mock.calls[0]![0] as Record<string, Blob>;
    expect(await contenuto["text/plain"]!.text()).toBe("Ciao");
  });

  it("taglia fa il passo di taglia e poi scrive gli appunti", async () => {
    const ops = JSON.stringify([{ op: "remove", target: "oa1a1a1a1" }]);
    const { motore, ids } = motoreFinto({ ...RISPOSTE_COPIA, "disegno.edit.cut": { ops } });
    const { appunti, dipendenze } = creaCon(motore);
    await appunti.copia("cut");
    expect(ids()[0]).toBe("disegno.edit.cut");
    expect(vi.mocked(dipendenze.applica)).toHaveBeenCalledWith(expect.objectContaining({ ops }), t("draw.cut"));
    expect(vi.mocked(writeClipboardData)).toHaveBeenCalledOnce();
  });

  it("un motore che lancia lo dice, senza lasciare una promessa rifiutata", async () => {
    const sessione = { comando: vi.fn(async () => Promise.reject({ kind: "bad_args", message: "non servito" })) };
    const motore = { pronta: vi.fn(async () => sessione) } as unknown as MotoreDelDisegno;
    const { appunti, dipendenze } = creaCon(motore);
    await expect(appunti.copia("copy")).resolves.toBeUndefined();
    expect(vi.mocked(dipendenze.annuncia)).toHaveBeenCalledWith(t("draw.completo.key.failed"));
    expect(vi.mocked(writeClipboardData)).not.toHaveBeenCalled();
  });

  it("senza selezione lo dice e non tocca il motore", async () => {
    const { motore } = motoreFinto(RISPOSTE_COPIA);
    const { appunti, dipendenze } = creaCon(motore, []);
    await appunti.copia("copy");
    expect(vi.mocked(motore.pronta)).not.toHaveBeenCalled();
    expect(vi.mocked(dipendenze.annuncia)).toHaveBeenCalledWith(t("draw.selected.none"));
  });

  it("una copia rifiutata dal motore non scrive niente", async () => {
    const { motore } = motoreFinto({ "disegno.edit.copy": { refused: "locked" } });
    const { appunti, dipendenze } = creaCon(motore);
    await appunti.copia("copy");
    expect(vi.mocked(writeClipboardData)).not.toHaveBeenCalled();
    expect(vi.mocked(dipendenze.applica)).toHaveBeenCalledWith(expect.objectContaining({ refused: "locked" }), t("draw.copy"));
  });
});

describe("incolla e l'impronta", () => {
  it("gli stessi appunti della propria copia: solo edit.paste, senza importare", async () => {
    const { motore, ids } = motoreFinto({ ...RISPOSTE_COPIA, "disegno.edit.paste": { ops: "[]" } });
    const { appunti } = creaCon(motore);
    await appunti.copia("copy");
    await appunti.incolla(letturaDi(SVG));
    expect(ids().slice(5)).toEqual(["disegno.clipboard.conflicts", "disegno.edit.paste"]);
    expect(ids()).not.toContain("disegno.clipboard.importSvg");
  });

  it("un SVG diverso: importa, chiede i conflitti, poi edit.paste", async () => {
    const { motore, ids, chiamate } = motoreFinto({
      "disegno.clipboard.importSvg": { reading: { count: 1 } },
      "disegno.clipboard.conflicts": { reading: { swatches: [] } },
      "disegno.edit.paste": { ops: "[]" },
    });
    const { appunti } = creaCon(motore);
    await appunti.incolla(letturaDi(ALTRO_SVG));
    expect(ids()).toEqual(["disegno.clipboard.importSvg", "disegno.clipboard.conflicts", "disegno.edit.paste"]);
    expect(chiamate[0]!.value).toEqual({ svg: ALTRO_SVG });
  });

  it("dopo un SVG importato, lo stesso SVG non si importa di nuovo", async () => {
    const { motore, ids } = motoreFinto({
      "disegno.clipboard.importSvg": { reading: { count: 1 } },
      "disegno.clipboard.conflicts": { reading: { swatches: [] } },
      "disegno.edit.paste": { ops: "[]" },
    });
    const { appunti } = creaCon(motore);
    await appunti.incolla(letturaDi(ALTRO_SVG));
    await appunti.incolla(letturaDi(ALTRO_SVG));
    expect(ids().filter((id) => id === "disegno.clipboard.importSvg")).toHaveLength(1);
  });

  it("una copia azzera l'impronta: l'incolla che segue importa", async () => {
    const { motore, ids } = motoreFinto({
      ...RISPOSTE_COPIA,
      "disegno.clipboard.importSvg": { reading: { count: 1 } },
      "disegno.clipboard.conflicts": { reading: { swatches: [] } },
      "disegno.edit.paste": { ops: "[]" },
    });
    const { appunti } = creaCon(motore);
    await appunti.copia("copy");
    await appunti.incolla(letturaDi(ALTRO_SVG));
    expect(ids()).toContain("disegno.clipboard.importSvg");
  });

  it("i campioni con lo stesso nome si chiedono: Aggiungi passa swatchConflict", async () => {
    const { motore, chiamate } = motoreFinto({
      "disegno.clipboard.importSvg": { reading: { count: 1 } },
      "disegno.clipboard.conflicts": { reading: { swatches: [{ name: "Blu", document: "#0000ff", clipboard: "#ff0000", spot: false }] } },
      "disegno.edit.paste": { ops: "[]" },
    });
    finestraConRisposta("add");
    const { appunti } = creaCon(motore);
    await appunti.incolla(letturaDi(ALTRO_SVG));
    expect(vi.mocked(openDialog)).toHaveBeenCalledOnce();
    expect(chiamate.find((c) => c.id === "disegno.edit.paste")!.value).toEqual({ swatchConflict: "add" });
  });

  it("annullando la scelta dei campioni non si incolla", async () => {
    const { motore, ids } = motoreFinto({
      "disegno.clipboard.importSvg": { reading: { count: 1 } },
      "disegno.clipboard.conflicts": { reading: { swatches: [{ name: "Blu", document: "#0000ff", clipboard: "#ff0000", spot: false }] } },
      "disegno.edit.paste": { ops: "[]" },
    });
    finestraConRisposta(null);
    const { appunti } = creaCon(motore);
    await appunti.incolla(letturaDi(ALTRO_SVG));
    expect(ids()).not.toContain("disegno.edit.paste");
  });

  it("un formato che il motore non sa leggere si dice, e niente cambia", async () => {
    const { motore } = motoreFinto();
    const { appunti, dipendenze } = creaCon(motore);
    await appunti.incolla({ testo: null, svg: null, immagini: [], altri: ["application/pdf"] });
    expect(vi.mocked(motore.pronta)).not.toHaveBeenCalled();
    expect(vi.mocked(dipendenze.annuncia)).toHaveBeenCalledWith(t("draw.paste.format_unsupported"));
  });

  it("un SVG oltre i limiti di K5 si rifiuta col suo errore, senza il motore", async () => {
    const { motore } = motoreFinto();
    const { appunti, dipendenze } = creaCon(motore);
    const troppo = `<svg>${"a".repeat(MAX_EDIT_BYTES)}</svg>`;
    await appunti.incolla(letturaDi(troppo));
    expect(vi.mocked(motore.pronta)).not.toHaveBeenCalled();
    expect(vi.mocked(dipendenze.annuncia)).toHaveBeenCalledWith(expect.stringContaining("20 MiB"));
  });

  it("un SVG che non si legge si rifiuta col suo errore", async () => {
    const { motore } = motoreFinto();
    const { appunti, dipendenze } = creaCon(motore);
    await appunti.incolla(letturaDi("<svg"));
    expect(vi.mocked(motore.pronta)).not.toHaveBeenCalled();
    expect(vi.mocked(dipendenze.annuncia)).toHaveBeenCalledWith(t("draw.paste.malformed"));
  });

  it("un SVG copiato nel Completo si legge come lo legge il Semplice, e viceversa", async () => {
    // Completo → Semplice: il Semplice legge l'SVG che il Completo scrive.
    expect(typeof readPaste(SVG)).not.toBe("string");
    // Semplice → Completo: l'SVG del Semplice (come `copySvg`) si importa.
    const { motore, chiamate } = motoreFinto({
      "disegno.clipboard.importSvg": { reading: { count: 1 } },
      "disegno.clipboard.conflicts": { reading: { swatches: [] } },
      "disegno.edit.paste": { ops: "[]" },
    });
    const { appunti } = creaCon(motore);
    await appunti.incolla(letturaDi(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 10 10" width="10" height="10"><rect x="0" y="0" width="10" height="10"/></svg>`));
    expect(chiamate[0]!.id).toBe("disegno.clipboard.importSvg");
  });

  it("un disegno di Excalidraw negli appunti arriva come SVG, e il motore lo importa", async () => {
    const { foreignDrawing } = await import("../import/foreign");
    const { pastedDrawing } = await import("../import/paste");
    const testo = '{"type":"excalidraw","elements":[]}';
    vi.mocked(foreignDrawing).mockReturnValueOnce({ source: "excalidraw", text: testo } as unknown as ReturnType<typeof foreignDrawing>);
    const { motore, chiamate } = motoreFinto({
      "disegno.clipboard.importSvg": { reading: { count: 1 } },
      "disegno.clipboard.conflicts": { reading: { swatches: [] } },
      "disegno.edit.paste": { ops: "[]" },
    });
    const { appunti } = creaCon(motore);
    await appunti.incolla({ testo, svg: null, immagini: [], altri: [] });
    expect(vi.mocked(pastedDrawing)).toHaveBeenCalledWith(testo);
    expect(chiamate[0]!.id).toBe("disegno.clipboard.importSvg");
    expect(String((chiamate[0]!.value as { svg: string }).svg)).toContain("<svg");
  });

  it("gli appunti che un evento porta: l'SVG e il tipo che non si legge", () => {
    const dati = {
      types: ["text/plain", SVG_TYPE, "application/pdf"],
      getData: (tipo: string) => (tipo === "text/plain" || tipo === SVG_TYPE ? SVG : ""),
      files: [],
    } as unknown as DataTransfer;
    const lettura = leggiAppuntiDaEvento(dati);
    expect(lettura?.svg).toBe(SVG);
    expect(lettura?.altri).toEqual(["application/pdf"]);
    expect(leggiAppuntiDaEvento(null)).toBeNull();
  });

  it("gli appunti del menu che il sistema nega si dicono con i tasti", async () => {
    vi.mocked(readClipboard).mockRejectedValueOnce(new Error("negato"));
    const { motore } = motoreFinto();
    const { appunti, dipendenze } = creaCon(motore);
    await appunti.incollaDaMenu();
    expect(vi.mocked(dipendenze.annuncia)).toHaveBeenCalledWith(t("draw.paste.keys", { key: displayBinding("Mod-v") }));
    expect(vi.mocked(motore.pronta)).not.toHaveBeenCalled();
  });
});

describe("cancella cronologia", () => {
  it("annullata nella conferma non chiama niente", async () => {
    const { motore } = motoreFinto();
    const svuota = vi.fn();
    const ritira = registraCronologia(motore, svuota);
    const { appunti } = creaCon(motore);
    finestraConRisposta(false);
    await appunti.cancellaCronologia();
    expect(vi.mocked(motore.pronta)).not.toHaveBeenCalled();
    expect(svuota).not.toHaveBeenCalled();
    ritira();
  });

  it("confermata: una sola chiamata alla cronologia e una sola al motore", async () => {
    const { motore, ids } = motoreFinto({ "disegno.edit.clearHistory": { refused: "empty" } });
    const svuota = vi.fn();
    const ritira = registraCronologia(motore, svuota);
    const { appunti, dipendenze } = creaCon(motore);
    finestraConRisposta(true);
    await appunti.cancellaCronologia();
    expect(svuota).toHaveBeenCalledOnce();
    expect(ids()).toEqual(["disegno.edit.clearHistory"]);
    expect(vi.mocked(dipendenze.annuncia)).toHaveBeenCalledWith(t("draw.clear_history.done"));
    expect(cronologiaDi(motore)).toBe(svuota);
    ritira();
    expect(cronologiaDi(motore)).toBeNull();
  });

  it("la conferma dice che si svuota la cronologia della superficie, non le versioni", async () => {
    const { motore } = motoreFinto();
    const { appunti } = creaCon(motore);
    finestraConRisposta(false);
    await appunti.cancellaCronologia();
    const opzioni = vi.mocked(openDialog).mock.calls[0]![0];
    expect(opzioni.description).toBe(t("draw.clear_history.body"));
    expect(t("draw.clear_history.body")).toContain("versioni");
    expect(opzioni.actions.map((a) => a.id)).toEqual(["cancel", "clear"]);
  });
});

/// Una voce degli appunti di sistema che porta un SVG, come la legge la shell.
function voceConSvg(testo: string): ClipboardEntry {
  return { types: [SVG_TYPE], getType: (tipo: string) => Promise.resolve(new Blob([testo], { type: tipo })) } as unknown as ClipboardEntry;
}

describe("le varianti d'incolla (K6 T11, giro F)", () => {
  const RISPOSTE_INCOLLA: Record<string, Partial<DrawingOutcome>> = {
    "disegno.clipboard.importSvg": { reading: { count: 1 } },
    "disegno.clipboard.conflicts": { reading: { swatches: [] } },
  };

  it("ogni variante fa il suo comando, con la stessa lettura, e il nome della sua voce nei messaggi", async () => {
    const varianti = ["edit.pasteInFront", "edit.pasteInBack", "edit.pasteInPlace", "edit.pasteOnAllArtboards", "edit.pasteWithoutFormatting"] as const;
    for (const comando of varianti) {
      const { motore, ids } = motoreFinto({ ...RISPOSTE_INCOLLA, [`disegno.${comando}`]: { ops: "[]" } });
      const { appunti, dipendenze } = creaCon(motore);
      await appunti.incolla(letturaDi(ALTRO_SVG), { comando, etichetta: "Etichetta della voce" });
      expect(ids()).toEqual(["disegno.clipboard.importSvg", "disegno.clipboard.conflicts", `disegno.${comando}`]);
      expect(vi.mocked(dipendenze.applica)).toHaveBeenCalledWith(expect.objectContaining({ ops: "[]" }), "Etichetta della voce");
    }
  });

  it("la copia del motore vale per ogni variante: si chiede solo il comando, senza importare", async () => {
    const { motore, ids } = motoreFinto({ ...RISPOSTE_COPIA, ...RISPOSTE_INCOLLA, "disegno.edit.pasteInPlace": { ops: "[]" } });
    const { appunti } = creaCon(motore);
    await appunti.copia("copy");
    await appunti.incolla(letturaDi(SVG), { comando: "edit.pasteInPlace" });
    expect(ids().slice(5)).toEqual(["disegno.clipboard.conflicts", "disegno.edit.pasteInPlace"]);
  });

  it("dal menu la variante sulle tavole legge gli appunti di sistema e chiede il suo comando", async () => {
    vi.mocked(readClipboard).mockResolvedValueOnce([voceConSvg(ALTRO_SVG)]);
    const { motore, ids } = motoreFinto({ ...RISPOSTE_INCOLLA, "disegno.edit.pasteOnAllArtboards": { ops: "[]" } });
    const { appunti, dipendenze } = creaCon(motore);
    await appunti.incollaDaMenu({ comando: "edit.pasteOnAllArtboards", etichetta: "Incolla su tutte le tavole" });
    expect(ids()).toEqual(["disegno.clipboard.importSvg", "disegno.clipboard.conflicts", "disegno.edit.pasteOnAllArtboards"]);
    expect(vi.mocked(dipendenze.applica)).toHaveBeenCalledWith(expect.objectContaining({ ops: "[]" }), "Incolla su tutte le tavole");
  });

  it("senza opzioni l'incolla resta «Incolla» del motore", async () => {
    const { motore, ids } = motoreFinto({ ...RISPOSTE_INCOLLA, "disegno.edit.paste": { ops: "[]" } });
    const { appunti, dipendenze } = creaCon(motore);
    await appunti.incolla(letturaDi(ALTRO_SVG));
    expect(ids()).toContain("disegno.edit.paste");
    expect(vi.mocked(dipendenze.applica)).toHaveBeenCalledWith(expect.anything(), t("draw.paste"));
  });
});

describe("il registro degli appunti del motore", () => {
  it("il Completo registra i suoi appunti per il motore, e li ritira alla chiusura", () => {
    const motore = {} as MotoreDelDisegno;
    const { appunti } = creaCon(motore);
    expect(appuntiCompletoDi(motore)).toBeNull();
    const ritira = registraAppuntiCompleto(motore, appunti);
    expect(appuntiCompletoDi(motore)).toBe(appunti);
    expect(appuntiCompletoDi({} as MotoreDelDisegno)).toBeNull();
    ritira();
    expect(appuntiCompletoDi(motore)).toBeNull();
    expect(appuntiCompletoDi(null)).toBeNull();
  });
});
