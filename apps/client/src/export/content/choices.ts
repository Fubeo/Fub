// Le scelte della sezione Contenuto, lette dal profilo (E28, T74).
//
// Il profilo le tiene come stringhe aperte (`scelta_aperta!` del core): un
// valore che questa versione non conosce si conserva nel file e qui vale come
// quello di serie, come fa il core. Le scelte si dividono come le due
// velocità dell'impaginatore (`paginate/slices.ts`):
//
// - i link e le tabelle cambiano solo l'aspetto (variabili CSS, `look.ts`);
// - il resto cambia la resa che si misura (`apply.ts`) e rifà
//   l'impaginazione.

import type { ExportProfile, ProfileContent } from "../profile";

export type PropertiesChoice = "nessuna" | "in-evidenza" | "tutte";
export type CommentsChoice = "no" | "margine" | "in-fondo";
export type LinksChoice = "colorati" | "sottolineati" | "come-il-testo";
export type FoldsChoice = "aperti" | "chiusi";
export type CardsChoice = "anteprima" | "solo-nome" | "pagine-in-coda";
export type TablesChoice = "linee" | "righe-alterne" | "griglia";

export const PROPERTIES_CHOICES: readonly PropertiesChoice[] = ["nessuna", "in-evidenza", "tutte"];
export const COMMENTS_CHOICES: readonly CommentsChoice[] = ["no", "margine", "in-fondo"];
export const LINKS_CHOICES: readonly LinksChoice[] = ["colorati", "sottolineati", "come-il-testo"];
export const FOLDS_CHOICES: readonly FoldsChoice[] = ["aperti", "chiusi"];
export const CARDS_CHOICES: readonly CardsChoice[] = ["anteprima", "solo-nome", "pagine-in-coda"];
export const TABLES_CHOICES: readonly TablesChoice[] = ["linee", "righe-alterne", "griglia"];

/// Le scelte del Contenuto, tutte conosciute.
export interface ContentChoices {
  readonly properties: PropertiesChoice;
  readonly comments: CommentsChoice;
  readonly links: LinksChoice;
  /// I compiti fatti restano (`true`) o escono dal PDF.
  readonly doneTasks: boolean;
  readonly folds: FoldsChoice;
  readonly cards: CardsChoice;
  readonly tables: TablesChoice;
  readonly codeNumbers: boolean;
}

function known<T extends string>(value: string, choices: readonly T[]): T {
  return (choices as readonly string[]).includes(value) ? (value as T) : choices[0]!;
}

/// Le scelte del profilo; un valore sconosciuto vale come quello di serie
/// (il primo di ogni elenco).
export function contentChoicesOf(content: ProfileContent): ContentChoices {
  return {
    properties: known(content.proprieta, PROPERTIES_CHOICES),
    comments: known(content.commenti, COMMENTS_CHOICES),
    links: known(content.link, LINKS_CHOICES),
    doneTasks: content.compiti_fatti !== false,
    folds: known(content.ripiegabili, FOLDS_CHOICES),
    cards: known(content.schede, CARDS_CHOICES),
    tables: known(content.tabelle, TABLES_CHOICES),
    codeNumbers: content.codice_numerato === true,
  };
}

/// Le scelte del Contenuto e delle Interruzioni che cambiano le misure: nelle
/// regolazioni dell'impaginatore (`PrintLayout.content`), così una scelta
/// diversa rifà l'impaginazione e una uguale no.
export interface ContentLayout {
  readonly properties: PropertiesChoice;
  readonly comments: CommentsChoice;
  readonly doneTasks: boolean;
  readonly folds: FoldsChoice;
  readonly cards: CardsChoice;
  readonly codeNumbers: boolean;
  /// Una tabella che continua nella pagina dopo ripete l'intestazione.
  readonly repeatHeader: boolean;
}

export function contentLayoutOf(profile: Pick<ExportProfile, "contenuto" | "interruzioni">): ContentLayout {
  const choices = contentChoicesOf(profile.contenuto);
  return {
    properties: choices.properties,
    comments: choices.comments,
    doneTasks: choices.doneTasks,
    folds: choices.folds,
    cards: choices.cards,
    codeNumbers: choices.codeNumbers,
    repeatHeader: profile.interruzioni.ripeti_intestazione !== false,
  };
}
