// Il profilo dell'esportazione in PDF dal lato della vista (E28, T68, T70).
//
// Il profilo vive nel core (`crates/fub-features/src/pdf_export/profile.rs`,
// la forma del file in `docs/reference/pdf-export-format.md`): tema, colori,
// caratteri, pagina, testata, contenuto, interruzioni, uscita. Non passa
// ancora dall'IPC (lo farà coi profili salvati, T79), e qui c'è la sua forma
// con gli stessi nomi dei campi del file, e i valori di serie del profilo
// «Di serie». Le sezioni dello spazio (`sections/`) lo leggono e ne fanno una
// copia cambiata; `printSettingsOf` ne fa le regolazioni dell'impaginatore
// (`paginate/slices.ts`): ciò che cambia le misure (`PrintLayout`) e ciò che
// cambia solo l'aspetto (`PrintLook`).
//
// Le scelte aperte del core (`scelta_aperta!`) arrivano come stringhe: un
// valore che questa versione non conosce si conserva e si mostra come quello
// di serie, come fa il core.

import { clampMargins } from "./guides";
import type { PageGeometry } from "./probe";
import { contentChoicesOf, contentLayoutOf } from "./content/choices";
import { contentLookVariables } from "./content/look";
import { lookVariables, textOf, typeVariables } from "./themes";
import type { PrintLayout, PrintLook, PrintSettings } from "./paginate/slices";
import { TITLE_ID } from "./paginate/toc";

/// I temi di stampa di Fub, nell'ordine in cui la vista li mostra
/// (`IdTema::DI_FUB`).
export const PRINT_THEMES = ["fub", "classico", "relazione", "rivista", "accademico", "quaderno", "essenziale", "notte"] as const;

export type PaperFormat = "A4" | "A5" | "A3" | "Lettera" | "proprio";

/// I margini, in millimetri.
export interface Margins {
  readonly sopra: number;
  readonly destra: number;
  readonly sotto: number;
  readonly sinistra: number;
}

export interface ProfilePage {
  readonly formato: PaperFormat | (string & {});
  /// Larghezza e altezza in millimetri, col formato `proprio`.
  readonly misura_propria?: readonly [number, number] | null;
  readonly orizzontale: boolean;
  readonly margini: Margins;
  readonly specchio: boolean;
  readonly filigrana: string;
}

/// Le scelte del testo: ciò che manca lo decide il tema.
export interface ProfileText {
  readonly carattere_testo?: string | null;
  readonly carattere_titoli?: string | null;
  readonly corpo?: number | null;
  readonly interlinea?: number | null;
  readonly paragrafi?: string | null;
  readonly giustificato?: boolean | null;
  readonly titoli_numerati?: boolean | null;
  readonly scala_titoli?: number | null;
  readonly allineamento_titoli?: string | null;
  readonly colonne?: number | null;
  readonly sillabazione: boolean;
}

export interface ProfileInk {
  readonly bianco_e_nero: boolean;
  readonly risparmio: boolean;
}

export interface HeaderSlot {
  readonly voce: string;
  readonly testo?: string;
}

export interface ProfileHeaderFooter {
  /// I posti che hanno qualcosa (`sopra-sinistra` … `sotto-destra`).
  readonly posti: Readonly<Record<string, HeaderSlot>>;
  readonly filo: boolean;
  readonly prima_pagina_senza: boolean;
  readonly numeri_romani: boolean;
}

export interface ProfileFront {
  readonly frontespizio: boolean;
  readonly indice: boolean;
  readonly profondita_indice: number;
  readonly segnalibri: boolean;
}

export interface ProfileContent {
  readonly proprieta: string;
  readonly commenti: string;
  readonly link: string;
  readonly compiti_fatti: boolean;
  readonly ripiegabili: string;
  readonly schede: string;
  readonly tabelle: string;
  readonly codice_numerato: boolean;
}

export interface ProfileDiagrams {
  readonly stile: string;
  readonly fondo: boolean;
}

export interface ProfileBreaks {
  readonly ogni_titolo_2: boolean;
  readonly separatore: boolean;
  readonly ripeti_intestazione: boolean;
}

export interface ProfileOutput {
  readonly pagine: string;
  readonly immagini: string;
  readonly accessibile: boolean;
  readonly pdfa: boolean;
}

/// Un profilo d'esportazione, coi nomi dei campi del file.
export interface ExportProfile {
  readonly nome: string;
  readonly tema: string;
  /// I colori cambiati uno per uno (`carta`, `testo`, …), `#rrggbb`.
  readonly colori: Readonly<Record<string, string>>;
  readonly inchiostro: ProfileInk;
  readonly testo: ProfileText;
  readonly pagina: ProfilePage;
  readonly testata: ProfileHeaderFooter;
  readonly frontespizio: ProfileFront;
  readonly contenuto: ProfileContent;
  readonly diagrammi: ProfileDiagrams;
  readonly interruzioni: ProfileBreaks;
  readonly uscita: ProfileOutput;
}

/// Il nome del profilo che c'è anche senza nessun file (`NOME_DI_SERIE`).
export const DEFAULT_PROFILE_NAME = "Di serie";

/// Il profilo «Di serie»: gli stessi valori di `Profilo::di_serie()`.
export function defaultProfile(): ExportProfile {
  return {
    nome: DEFAULT_PROFILE_NAME,
    tema: PRINT_THEMES[0],
    colori: {},
    inchiostro: { bianco_e_nero: false, risparmio: false },
    testo: { sillabazione: true },
    pagina: {
      formato: "A4",
      misura_propria: null,
      orizzontale: false,
      margini: { sopra: 25, destra: 22, sotto: 25, sinistra: 22 },
      specchio: false,
      filigrana: "",
    },
    testata: {
      posti: { "sopra-destra": { voce: "titolo" }, "sotto-centro": { voce: "pagina-di-pagine" } },
      filo: true,
      prima_pagina_senza: false,
      numeri_romani: false,
    },
    frontespizio: { frontespizio: false, indice: false, profondita_indice: 2, segnalibri: true },
    contenuto: {
      proprieta: "nessuna",
      commenti: "no",
      link: "colorati",
      compiti_fatti: true,
      ripiegabili: "aperti",
      schede: "anteprima",
      tabelle: "linee",
      codice_numerato: false,
    },
    diagrammi: { stile: "nota", fondo: true },
    interruzioni: { ogni_titolo_2: false, separatore: true, ripeti_intestazione: true },
    uscita: { pagine: "", immagini: "piene", accessibile: true, pdfa: false },
  };
}

/// Le misure dei formati, in millimetri, in verticale.
export const PAPER_MM: Readonly<Record<Exclude<PaperFormat, "proprio">, readonly [number, number]>> = {
  A4: [210, 297],
  A5: [148, 210],
  A3: [297, 420],
  Lettera: [215.9, 279.4],
};

/// Un millimetro in pixel CSS: 96 punti per pollice, 25,4 mm per pollice.
export const MM = 96 / 25.4;

/// Lo spazio fra le due colonne, in millimetri (7 mm, come nel prototipo).
export const COLUMN_GAP_MM = 7;

/// Il lato più corto e il più lungo di una misura propria, in millimetri: da
/// un biglietto da visita a un A0.
export const MIN_PAPER_MM = 50;
export const MAX_PAPER_MM = 1189;

/// Se una misura propria regge: due lati fra `MIN_PAPER_MM` e `MAX_PAPER_MM`.
export function validPaper(size: readonly number[] | null | undefined): size is readonly [number, number] {
  return Array.isArray(size) && size.length === 2 && size.every((side) => Number.isFinite(side) && side >= MIN_PAPER_MM && side <= MAX_PAPER_MM);
}

/// La misura del foglio in millimetri, già girata se orizzontale. Un formato
/// che questa versione non conosce, o una misura propria che non regge, è A4.
export function paperSize(page: ProfilePage): readonly [number, number] {
  const own = page.formato === "proprio" ? page.misura_propria : null;
  const known = PAPER_MM[page.formato as keyof typeof PAPER_MM];
  const [w, h] = validPaper(own) ? own : known ?? PAPER_MM.A4;
  return page.orizzontale ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
}

/// La pagina in pixel CSS, coi margini tenuti dentro la pagina
/// (`clampMargins`): un profilo scritto a mano non lascia il testo senza
/// posto.
export function geometryOf(page: ProfilePage): PageGeometry {
  const paper = paperSize(page);
  const [w, h] = paper;
  const m = clampMargins(page.margini, paper);
  const px = (mm: number) => Math.round(mm * MM * 100) / 100;
  return {
    width: px(w),
    height: px(h),
    margin: { top: px(m.sopra), right: px(m.destra), bottom: px(m.sotto), left: px(m.sinistra) },
  };
}

/// Le colonne del profilo: le tue se le hai scelte, se no quelle del tema.
export function columnsOf(profile: ExportProfile): 1 | 2 {
  return textOf(profile).colonne;
}

/// Le variabili della carta: i colori del tema di stampa coi tuoi sopra
/// (`themes.ts`). Un colore scritto male non entra (resta quello del tema).
export function paperColorsOf(profile: ExportProfile): Record<string, string> {
  return lookVariables(profile);
}

/// Le regolazioni dell'impaginatore dal profilo: pagina, colonne,
/// interruzioni scelte, i caratteri e l'impostazione del tema (o i tuoi) e i
/// blocchi lasciati fuori (dalla memoria della nota, `excluded`) rifanno
/// l'impaginazione; i colori cambiano solo l'aspetto. Col frontespizio il
/// titolo in cima alla nota esce dall'impaginazione: sta sul frontespizio.
export function printSettingsOf(profile: ExportProfile, excluded: readonly string[] = []): PrintSettings {
  const layout: PrintLayout = {
    page: geometryOf(profile.pagina),
    columns: columnsOf(profile),
    columnGap: Math.round(COLUMN_GAP_MM * MM * 100) / 100,
    breaks: { everyHeading2: profile.interruzioni.ogni_titolo_2, separator: profile.interruzioni.separatore },
    type: typeVariables(profile),
    excluded: profile.frontespizio.frontespizio && !excluded.includes(TITLE_ID) ? [...excluded, TITLE_ID] : excluded,
    content: contentLayoutOf(profile),
  };
  const look: PrintLook = { colors: { ...lookVariables(profile), ...contentLookVariables(contentChoicesOf(profile.contenuto)) } };
  return { layout, look };
}
