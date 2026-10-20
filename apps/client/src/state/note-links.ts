// Come nasce il link a una nota: la preferenza del vault.
//
// `files.link-style` dice la specie (wikilink o link Markdown), `files.link-format`
// il percorso (il più corto, relativo, dalla radice). Le due forme non hanno le
// stesse possibilità, e la regola sta qui una volta:
//
// - un link Markdown è sempre un percorso, e Fub lo risolve relativo alla nota
//   che lo contiene o, con la `/` davanti, dalla radice del vault; «il più
//   corto» quindi lo scrive relativo;
// - un wikilink si risolve per nome, o per percorso dalla radice se contiene
//   una `/`; non ha forma relativa, quindi «relativo» lo scrive dalla radice.
//
// Il nome più corto lo decide la risoluzione del vault, non questo modulo:
// chi scrive un wikilink passa il nome che il vault ha confermato.
import { settings } from "../host/query";
import { relativeUrl } from "../editors/media/attachment-target";

export const LINK_STYLE_KEY = "files.link-style";
export const LINK_FORMAT_KEY = "files.link-format";

export type LinkStyle = "wiki" | "markdown";
export type LinkFormat = "shortest" | "relative" | "absolute";

export interface LinkPreference {
  readonly style: LinkStyle;
  readonly format: LinkFormat;
}

/// Il default è quello di prima delle impostazioni: wikilink col nome più corto.
export const DEFAULT_LINK_PREFERENCE: LinkPreference = { style: "wiki", format: "shortest" };

/// La preferenza dai valori delle impostazioni; un valore sconosciuto è il default.
export function linkPreferenceOf(value: (key: string) => unknown): LinkPreference {
  const style = value(LINK_STYLE_KEY);
  const format = value(LINK_FORMAT_KEY);
  return {
    style: style === "markdown" ? "markdown" : "wiki",
    format: format === "relative" || format === "absolute" ? format : "shortest",
  };
}

/// La preferenza del vault aperto. Senza impostazioni leggibili vale il default:
/// un link si scrive comunque, come prima.
export async function linkPreference(): Promise<LinkPreference> {
  try {
    const entries = await settings();
    return linkPreferenceOf((key) => entries.find((entry) => entry.spec.key === key)?.value);
  } catch {
    return DEFAULT_LINK_PREFERENCE;
  }
}

/// La destinazione di un link Markdown scritto in `from` verso `to`, con
/// l'estensione e il percent-encoding: relativa, o dalla radice con la `/`.
export function markdownDestination(from: string, to: string, format: LinkFormat): string {
  return format === "absolute" ? `/${relativeUrl("", to)}` : relativeUrl(from, to);
}

/// I candidati di un wikilink per percorso, dal più corto: senza l'estensione
/// della prosa, poi il percorso intero. Il primo che il vault risolve alla nota
/// è quello da scrivere.
export function wikiPathCandidates(doc: string): string[] {
  const withoutExtension = doc.replace(/\.[^./]+$/, "");
  return withoutExtension === doc ? [doc] : [withoutExtension, doc];
}
