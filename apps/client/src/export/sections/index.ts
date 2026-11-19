// Le dieci sezioni del pannello dello spazio «Esporta in PDF» (E28, T70).
//
// Il pannello (`space.ts`) le mostra in quest'ordine, una sotto l'altra: la
// testa di ogni sezione è un pulsante che la apre e la chiude, col nome a
// sinistra e a destra ciò che vale adesso (`summary`), così una sezione
// chiusa dice già com'è regolata. Il corpo delle regolazioni lo scrive il
// task della sezione, in un file suo (A-7: questo elenco si unisce):
//
// | sezione                 | file                         |
// |-------------------------|------------------------------|
// | Tema, Colori            | `theme.ts`, `colors.ts` (T71) |
// | Caratteri, Pagina       | `fonts.ts`, `page.ts` (T72)   |
// | Testata e piè, Frontespizio e indice | `header-footer.ts`, `cover-toc.ts` (T73) |
// | Contenuto, Interruzioni | `content.ts` (T74)            |
// | Diagrammi               | `diagrams.ts` (T75)           |
// | Uscita                  | (T77b, T79)                   |
//
// Finché una sezione non ha il suo corpo, aperta dice che le sue regolazioni
// arrivano e che vale ciò che è scritto in testa.
//
// Un corpo riceve il profilo e `change`: mentre si trascina un controllo
// (`live`) cambiano solo le pagine, e il pannello non si ridisegna; a gesto
// finito il pannello si ridisegna tutto, teste e corpi, col fuoco sul
// controllo che l'aveva (per `id`: ogni controllo di un corpo ne ha uno
// stabile). `preview` mostra un profilo sulle pagine senza sceglierlo,
// `highlight` contorna sulle pagine dove sta un colore.

import { plural, t, type Key } from "../../i18n/strings";
import { paperSize, PAPER_MM, type ExportProfile } from "../profile";
import { ownCount, type PageColor } from "../themes";
import { colorsBody } from "./colors";
import { coverTocBody } from "./cover-toc";
import { headerFooterBody, SLOT_IDS, slotShortName } from "./header-footer";
import { themeBody } from "./theme";

export interface SectionContext {
  readonly profile: ExportProfile;
  /// Cambia il profilo. `live`: il gesto è in corso (un cursore trascinato,
  /// un colore scelto nel selettore): le pagine seguono, il pannello no.
  change(next: ExportProfile, options?: { readonly live?: boolean }): void;
  /// Apre un'altra sezione e la porta sotto gli occhi.
  open(id: string): void;
  /// Mostra sulle pagine un profilo senza sceglierlo (il passaggio su un
  /// tema); `null` torna al profilo scelto. Il pannello non cambia.
  preview(next: ExportProfile | null): void;
  /// Contorna sulle pagine i punti dove un colore è usato (il passaggio su un
  /// colore); `null` toglie il contorno.
  highlight(color: PageColor | null): void;
  /// Ridisegna il pannello col fuoco dov'era, senza cambiare il profilo (una
  /// riga che si apre).
  redraw(): void;
  /// Ciò che una sezione ricorda fra un disegno del pannello e l'altro, finché
  /// lo spazio è aperto (quale colore è aperto).
  readonly memory: Map<string, unknown>;
}

export interface ExportSection {
  /// L'identità stabile della sezione: la usano il clic sulla pagina (T76)
  /// per aprire quella giusta e il banco.
  readonly id: string;
  readonly title: Key;
  /// Ciò che vale adesso, per la testa della sezione chiusa.
  summary(profile: ExportProfile): string;
  /// Le regolazioni della sezione aperta.
  body?(context: SectionContext): HTMLElement;
}

const THEME_NAMES: Readonly<Record<string, Key>> = {
  fub: "pdf_export.theme.fub",
  classico: "pdf_export.theme.classico",
  relazione: "pdf_export.theme.relazione",
  rivista: "pdf_export.theme.rivista",
  accademico: "pdf_export.theme.accademico",
  quaderno: "pdf_export.theme.quaderno",
  essenziale: "pdf_export.theme.essenziale",
  notte: "pdf_export.theme.notte",
};

/// Il nome di un tema di stampa: uno che questa versione non conosce si
/// mostra come il tema Fub, come lo disegna la vista.
export function themeName(id: string): string {
  return t(THEME_NAMES[id] ?? "pdf_export.theme.fub");
}

/// I colori che la persona ha cambiato, senza quelli dei diagrammi.
function ownPageColors(profile: ExportProfile): number {
  return Object.keys(profile.colori).filter((key) => !key.startsWith("diagramma-")).length;
}

function decimal(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

/// Il formato come si legge: «A4», o la misura propria in millimetri.
export function formatName(profile: ExportProfile): string {
  const { formato } = profile.pagina;
  if (formato in PAPER_MM) return formato;
  const [w, h] = paperSize(profile.pagina);
  return t("pdf_export.page.own_size", { width: decimal(w), height: decimal(h) });
}

/// «A4 verticale», «A5 orizzontale».
export function paperName(profile: ExportProfile): string {
  return t(profile.pagina.orizzontale ? "pdf_export.page.landscape" : "pdf_export.page.portrait", { format: formatName(profile) });
}

export const SECTIONS: readonly ExportSection[] = [
  {
    id: "tema",
    title: "pdf_export.section.theme",
    summary: (profile) => {
      const own = ownCount(profile);
      const name = themeName(profile.tema);
      return own > 0 ? `${name} · ${plural(own, "pdf_export.theme.own.one", "pdf_export.theme.own.other")}` : name;
    },
    body: themeBody,
  },
  {
    id: "colori",
    title: "pdf_export.section.colors",
    summary: (profile) => {
      if (profile.inchiostro.bianco_e_nero) return t("pdf_export.colors.gray");
      const own = ownPageColors(profile);
      return own > 0 ? plural(own, "pdf_export.colors.own.one", "pdf_export.colors.own.other") : t("pdf_export.colors.theme");
    },
    body: colorsBody,
  },
  {
    id: "caratteri",
    title: "pdf_export.section.fonts",
    summary: (profile) => {
      const { carattere_testo: face, corpo: size } = profile.testo;
      if (!face && !size) return t("pdf_export.fonts.theme");
      const points = size ? t("pdf_export.fonts.size", { size: decimal(size) }) : "";
      return [face, points].filter(Boolean).join(" · ");
    },
  },
  {
    id: "pagina",
    title: "pdf_export.section.page",
    summary: (profile) => (profile.testo.colonne === 2 ? `${paperName(profile)} · ${t("pdf_export.page.two_columns")}` : paperName(profile)),
  },
  {
    id: "testata",
    title: "pdf_export.section.header",
    summary: (profile) => {
      const names = SLOT_IDS.map((slot) => profile.testata.posti[slot]?.voce ?? "").filter((voce) => voce !== "").map(slotShortName);
      return names.length > 0 ? names.join(", ") : t("pdf_export.header.empty");
    },
    body: headerFooterBody,
  },
  {
    id: "fronte",
    title: "pdf_export.section.front",
    summary: ({ frontespizio: front }) => {
      if (front.frontespizio && front.indice) return t("pdf_export.front.both");
      if (front.frontespizio) return t("pdf_export.front.cover");
      if (front.indice) return t("pdf_export.front.toc");
      return t("pdf_export.front.none");
    },
    body: coverTocBody,
  },
  {
    id: "contenuto",
    title: "pdf_export.section.content",
    summary: (profile) => (profile.contenuto.commenti !== "no" ? t("pdf_export.content.comments") : t("pdf_export.content.all")),
  },
  {
    id: "diagrammi",
    title: "pdf_export.section.diagrams",
    summary: ({ diagrammi }) => {
      if (diagrammi.stile === "nota") return t("pdf_export.diagrams.note");
      if (diagrammi.stile === "tema") return t("pdf_export.diagrams.theme");
      return diagrammi.stile;
    },
  },
  {
    id: "interruzioni",
    title: "pdf_export.section.breaks",
    summary: ({ interruzioni }) => (interruzioni.ogni_titolo_2 ? t("pdf_export.breaks.heading2") : t("pdf_export.breaks.auto")),
  },
  {
    id: "uscita",
    title: "pdf_export.section.output",
    summary: ({ uscita }) => {
      const pages = uscita.pagine.trim() ? t("pdf_export.output.range", { range: uscita.pagine.trim() }) : t("pdf_export.output.all");
      return uscita.pdfa ? `${pages} · PDF/A` : pages;
    },
  },
];
