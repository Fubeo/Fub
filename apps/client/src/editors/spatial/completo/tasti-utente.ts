// I tasti del Disegno completo cambiati dall'utente (piano K6, T9c; D7 (a)):
// il valore dell'impostazione della macchina `draw.keys`, e i file degli
// insiemi di tasti del motore. Puro: niente host, niente DOM.
//
// - **Il valore** è un testo JSON con la sua versione:
//   `{"v":1,"insieme":"classico","tasti":{"<comando>":"Mod-k"|null}}`.
//   `tasti` va sopra i tasti del motore, nell'ordine in cui è scritto: l'ultimo
//   assegnato vince un conflitto (`risolviTasti` in `tasti.ts`), quindi un
//   comando riassegnato si toglie e si rimette in fondo. `null` toglie il
//   tasto. Vuoto: i tasti del motore.
// - **Una versione più nuova** si legge, se `tasti` ha la forma di oggi, ma non
//   si scrive: la sezione delle Impostazioni lo dice e offre solo di azzerare.
// - **Un valore rotto** si ignora, con un avviso nella console, e non si
//   sovrascrive: vale come vuoto finché l'utente non lo azzera.
// - **Gli insiemi** sono quelli del motore (`shortcut_editor.rs`): «di serie» e
//   «classico», entrambi senza modifiche sopra i tasti dell'indice. Sceglierne
//   uno toglie le modifiche. Un file d'insieme è quello del motore,
//   `{"format":"vectorcraft-shortcuts","version":1,"set":…,"overrides":{…}}`,
//   coi tasti scritti come li scrive il motore (`Cmd+Shift+K`, `""` = nessuno).

import { parseChords } from "../../../ui/commands";
import { normaTasto, tastoFub, type ModificheTasti } from "./tasti";

/// L'impostazione della macchina coi tasti dell'utente (`DRAW_KEYS_KEY` in
/// `crates/fub-features/src/draw.rs`; il test `draw-settings-mirror` le
/// confronta).
export const DRAW_KEYS_KEY = "draw.keys";

/// La versione del valore che questo Fub scrive.
export const VERSIONE_TASTI = 1;

/// Gli insiemi di tasti del motore, col nome che il motore scrive nei suoi file.
export const INSIEMI = [
  { id: "serie", motore: "VectorCraft Defaults" },
  { id: "classico", motore: "Classic Defaults" },
] as const;

export type IdInsieme = (typeof INSIEMI)[number]["id"];

/// I nomi che le versioni precedenti del motore scrivevano: si leggono come i
/// nomi di oggi.
const NOMI_VECCHI: Readonly<Record<string, string>> = { "Illustrator Defaults": "Classic Defaults" };

/// Il formato e la versione dei file d'insieme del motore.
export const FORMATO_INSIEME = "vectorcraft-shortcuts";
export const VERSIONE_INSIEME = 1;

/// Oltre questa misura un file d'insieme non si legge: un insieme vero è di
/// qualche chilobyte.
export const MISURA_MASSIMA_INSIEME = 1024 * 1024;

/// I tasti dell'utente: l'insieme scelto (`null`: nessuno, i tasti dell'indice)
/// e le modifiche sopra.
export interface TastiUtente {
  readonly insieme: IdInsieme | null;
  readonly tasti: ModificheTasti;
}

export const TASTI_VUOTI: TastiUtente = { insieme: null, tasti: {} };

/// Il valore letto. `scrivibile` dice se la sezione può riscriverlo.
export type LetturaTasti =
  | { readonly stato: "vuoto"; readonly valore: TastiUtente }
  | { readonly stato: "ok"; readonly valore: TastiUtente }
  /// Di una versione più nuova: `valore` sono i tasti che si sanno leggere
  /// (vuoti se la forma è cambiata). Non si riscrive.
  | { readonly stato: "nuovo"; readonly versione: number; readonly valore: TastiUtente }
  /// Rotto: vale come vuoto, e non si riscrive.
  | { readonly stato: "rotto"; readonly valore: TastiUtente };

const oggetto = (valore: unknown): valore is Record<string, unknown> =>
  typeof valore === "object" && valore !== null && !Array.isArray(valore);

/// Le modifiche lette da un oggetto: ogni valore un testo o `null`. `null` se la
/// forma non è quella.
function modificheDa(valore: unknown): ModificheTasti | null {
  if (!oggetto(valore)) return null;
  const fuori: Record<string, string | null> = {};
  for (const [id, tasto] of Object.entries(valore)) {
    if (tasto !== null && typeof tasto !== "string") return null;
    fuori[id] = tasto;
  }
  return fuori;
}

const insiemeDa = (valore: unknown): IdInsieme | null | undefined =>
  valore === null || valore === undefined ? null : INSIEMI.find((uno) => uno.id === valore)?.id;

/// Legge il valore di `draw.keys` (`testo` è il valore dell'impostazione; ciò
/// che non è un testo vale come rotto).
export function leggiTasti(testo: unknown): LetturaTasti {
  if (testo === "" || testo === null || testo === undefined) return { stato: "vuoto", valore: TASTI_VUOTI };
  const rotto = (perche: string): LetturaTasti => {
    console.warn(`draw.keys: il valore non si legge (${perche}), e vale come vuoto finché non lo si azzera`);
    return { stato: "rotto", valore: TASTI_VUOTI };
  };
  if (typeof testo !== "string") return rotto("non è un testo");
  let dato: unknown;
  try {
    dato = JSON.parse(testo);
  } catch {
    return rotto("non è JSON");
  }
  if (!oggetto(dato)) return rotto("non è un oggetto");
  const v = dato.v;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return rotto("versione mancante");
  const tasti = modificheDa(dato.tasti ?? {});
  const insieme = insiemeDa(dato.insieme);
  if (v > VERSIONE_TASTI) {
    return { stato: "nuovo", versione: v, valore: { insieme: insieme ?? null, tasti: tasti ?? {} } };
  }
  if (tasti === null) return rotto("tasti senza la loro forma");
  if (insieme === undefined) return rotto("insieme sconosciuto");
  return { stato: "ok", valore: { insieme, tasti } };
}

/// Le modifiche da dare alla regola dei tasti.
export function modificheDi(lettura: LetturaTasti): ModificheTasti {
  return lettura.valore.tasti;
}

/// Se il valore è quello di serie: si scrive azzerando l'impostazione.
export function tastiVuoti(valore: TastiUtente): boolean {
  return valore.insieme === null && Object.keys(valore.tasti).length === 0;
}

/// Il testo da scrivere in `draw.keys`.
export function scriviTasti(valore: TastiUtente): string {
  return JSON.stringify({ v: VERSIONE_TASTI, insieme: valore.insieme, tasti: valore.tasti });
}

/// Assegna `tasto` (forma di Fub, `null` = nessuno) al comando `id`: la modifica
/// va in fondo, così vince un conflitto.
export function assegnaTasto(valore: TastiUtente, id: string, tasto: string | null): TastiUtente {
  const tasti: Record<string, string | null> = {};
  for (const [altro, suo] of Object.entries(valore.tasti)) if (altro !== id) tasti[altro] = suo;
  tasti[id] = tasto;
  return { ...valore, tasti };
}

/// Toglie la modifica del comando `id`: torna il tasto del motore.
export function ripristinaTasto(valore: TastiUtente, id: string): TastiUtente {
  if (!(id in valore.tasti)) return valore;
  const tasti: Record<string, string | null> = {};
  for (const [altro, suo] of Object.entries(valore.tasti)) if (altro !== id) tasti[altro] = suo;
  return { ...valore, tasti };
}

/// Sceglie l'insieme `id`: le modifiche se ne vanno.
export function scegliInsieme(id: IdInsieme): TastiUtente {
  return { insieme: id, tasti: {} };
}

/// Perché un file d'insieme non si importa.
export type ErroreInsieme =
  | { readonly tipo: "grande" }
  | { readonly tipo: "json" }
  | { readonly tipo: "formato" }
  | { readonly tipo: "versione"; readonly versione: number }
  | { readonly tipo: "tasto"; readonly comando: string; readonly tasto: string };

/// Un file d'insieme letto: i tasti da mettere al posto delle modifiche, e
/// quanti tasti il file dà a comandi che questo Fub non ha (lasciati fuori).
export interface InsiemeLetto {
  readonly valore: TastiUtente;
  readonly ignorati: number;
}

/// Legge un file d'insieme del motore. `noti` sono gli id dei comandi
/// dell'indice: un tasto per un comando che non c'è si lascia fuori, e si
/// conta. Un tasto che non si sa premere rifiuta il file intero: niente cambia.
export function importaInsieme(testo: string, noti: ReadonlySet<string>): { ok: InsiemeLetto } | { errore: ErroreInsieme } {
  if (testo.length > MISURA_MASSIMA_INSIEME) return { errore: { tipo: "grande" } };
  let dato: unknown;
  try {
    dato = JSON.parse(testo);
  } catch {
    return { errore: { tipo: "json" } };
  }
  if (!oggetto(dato) || dato.format !== FORMATO_INSIEME || !oggetto(dato.overrides)) return { errore: { tipo: "formato" } };
  const versione = dato.version;
  if (typeof versione !== "number" || !Number.isInteger(versione) || versione < 1) return { errore: { tipo: "formato" } };
  if (versione > VERSIONE_INSIEME) return { errore: { tipo: "versione", versione } };
  const tasti: Record<string, string | null> = {};
  let ignorati = 0;
  for (const [comando, tasto] of Object.entries(dato.overrides)) {
    if (typeof tasto !== "string") return { errore: { tipo: "formato" } };
    let fub: string | null = null;
    if (tasto.trim() !== "") {
      fub = tastoFub(tasto);
      if (fub === null) return { errore: { tipo: "tasto", comando, tasto } };
    }
    if (!noti.has(comando)) {
      ignorati++;
      continue;
    }
    tasti[comando] = fub;
  }
  const nome = typeof dato.set === "string" ? (NOMI_VECCHI[dato.set] ?? dato.set) : null;
  const insieme = INSIEMI.find((uno) => uno.motore === nome)?.id ?? null;
  return { ok: { valore: { insieme, tasti }, ignorati } };
}

/// Un tasto di Fub (`Mod-Shift-k`) come lo scrive il motore (`Cmd+Shift+K`), o
/// `null` se non è un accordo solo.
export function tastoMotore(tasto: string): string | null {
  const norma = normaTasto(tasto);
  const accordo = norma === null ? undefined : parseChords(norma)?.[0];
  if (norma === null || accordo === undefined) return null;
  // Il tasto com'è scritto (`ArrowLeft`, non `arrowleft`): l'ultimo pezzo, e
  // `Mod--` è il tasto meno.
  const scritto = norma.endsWith("--") || norma === "-" ? "-" : norma.slice(norma.lastIndexOf("-") + 1);
  const chiave = scritto.length === 1 ? scritto.toUpperCase() : scritto;
  const mods = [accordo.mod ? "Cmd" : "", accordo.ctrl ? "Ctrl" : "", accordo.alt ? "Alt" : "", accordo.shift ? "Shift" : ""];
  return [...mods.filter((parte) => parte !== ""), chiave].join("+");
}

/// Il file d'insieme da esportare: l'insieme scelto e le modifiche, nel formato
/// del motore. Una modifica che il motore non saprebbe leggere resta fuori.
export function esportaInsieme(valore: TastiUtente): string {
  const overrides: Record<string, string> = {};
  for (const [comando, tasto] of Object.entries(valore.tasti)) {
    if (tasto === null) overrides[comando] = "";
    else {
      const suo = tastoMotore(tasto);
      if (suo !== null) overrides[comando] = suo;
    }
  }
  const scelto = INSIEMI.find((uno) => uno.id === valore.insieme);
  const set = Object.keys(overrides).length === 0 && scelto !== undefined ? scelto.motore : "Custom";
  return `${JSON.stringify({ format: FORMATO_INSIEME, version: VERSIONE_INSIEME, set, overrides }, null, 2)}\n`;
}
