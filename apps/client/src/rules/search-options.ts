// Le opzioni della ricerca nel cassetto: maiuscole, parola intera, espressione
// regolare, tolleranza. Sono **regole pure** sulla query già letta: la barra
// resta una sola lingua (`parseSearch`), e l'interruttore cambia come il
// risultato di quella lingua viene chiesto, mai la lingua stessa.
//
// Solo ciò che la porta regge. `TextQuery` ha `case_sensitive`, `tolerance` e
// `partial_last_term`; l'espressione regolare è un predicato suo (`regex`).
// «Parola intera» per la ricerca è la fine della parola: l'ultimo termine non è
// un prefisso (la barra cerca mentre si digita, e `arch` trova *architettura*).
// La sostituzione nel vault ha un suo `whole_word` e non passa di qui.
import type { QueryExpr, QueryPredicate } from "../host/contract";
import { ignoresCase } from "./search-syntax";

export interface SearchOptions {
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
  readonly typos: boolean;
}

export const NO_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  typos: false,
};

export type SearchOptionName = keyof SearchOptions;

/// Una opzione è accesa?
export function anyOption(options: SearchOptions): boolean {
  return options.caseSensitive || options.wholeWord || options.regex || options.typos;
}

/// La riga da dare alla sintassi della barra. Con l'espressione regolare accesa
/// tutta la riga è il modello: si racchiude fra barre, e le barre che contiene
/// si proteggono con la barra rovescia, come vuole la sintassi.
export function queryText(input: string, options: SearchOptions): string {
  const raw = input.trim();
  if (!options.regex || raw === "") return raw;
  return `/${raw.split("/").join("\\/")}/`;
}

/// L'espressione con le opzioni applicate ai predicati di testo. Un'espressione
/// regolare non ha maiuscole né tolleranza da regolare: il suo modello dice già
/// tutto, e i predicati `regex` restano come sono.
export function applyOptions(expression: QueryExpr, options: SearchOptions): QueryExpr {
  if (!options.caseSensitive && !options.wholeWord && !options.typos) return expression;
  return {
    any: expression.any.map((clause) => ({
      all: clause.all.map((literal) => ({
        negated: literal.negated,
        predicate: textOptions(literal.predicate, options),
      })),
    })),
  };
}

function textOptions(predicate: QueryPredicate, options: SearchOptions): QueryPredicate {
  if (predicate.kind !== "text" || ignoresCase(predicate)) return predicate;
  return {
    ...predicate,
    case_sensitive: predicate.case_sensitive || options.caseSensitive,
    tolerance: options.typos && !options.caseSensitive ? "typos" : predicate.tolerance,
    partial_last_term: options.wholeWord ? false : predicate.partial_last_term,
  };
}

/// Il testo che la sostituzione nel vault può prendere da questa query, o
/// `null` se la query non è un testo semplice. `vault.replace` sostituisce una
/// **stringa**: una query con operatori, gruppi, esclusioni o un modello non ha
/// una stringa sola da sostituire, e indovinarla vorrebbe dire riscrivere note
/// che l'utente non ha guardato.
export function replaceableText(expression: QueryExpr, options: SearchOptions): string | null {
  if (options.regex || options.typos) return null;
  if (expression.any.length !== 1) return null;
  const literals = expression.any[0]!.all;
  if (literals.length !== 1) return null;
  const only = literals[0]!;
  if (only.negated || only.predicate.kind !== "text") return null;
  const { text, fields, mode } = only.predicate;
  if (fields.length > 0 || text.trim() === "") return null;
  // Più parole in AND non sono una stringa: solo la frase fra virgolette o un
  // termine solo si cercano e si sostituiscono come scritti.
  if (mode === "terms" && /\s/u.test(text.trim())) return null;
  return text;
}
