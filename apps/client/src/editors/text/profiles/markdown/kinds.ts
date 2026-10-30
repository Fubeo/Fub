// I tipi di riquadro e i linguaggi di codice che il profilo conosce. Stanno
// a parte, senza CodeMirror, perché li legge anche la shell: i passi del menu
// «/» (`panels/slash/pickers/`).
import { childName, pageName, resolutionKey } from "../../../../rules/mirrored";

/// I tipi di riquadro, come li riconosce la resa.
export const CALLOUT_TYPES = [
  "note", "abstract", "info", "todo", "tip", "success", "question",
  "warning", "failure", "danger", "bug", "example", "quote",
] as const;

/// I linguaggi proposti su un recinto di codice appena aperto: i più comuni.
export const CODE_LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "diff", "go", "html", "java", "javascript", "json",
  "kotlin", "latex", "markdown", "mermaid", "php", "python", "ruby", "rust", "sql", "swift",
  "toml", "typescript", "xml", "yaml",
] as const;

/// Un titolo come lo scrive un link: senza i caratteri che il wikilink usa
/// per sé, che lo chiuderebbero o ne aprirebbero un altro campo.
export function headingLinkText(text: string): string {
  return text.replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim();
}

/// Il path di un DocId senza l'ultima estensione (`Progetti/Alpha.md` →
/// `Progetti/Alpha`): la forma univoca di un wikilink quando il solo nome
/// pagina è ambiguo.
export function pathWithoutExtension(doc: string): string {
  const base = childName(doc);
  return doc.slice(0, doc.length - base.length) + pageName(doc);
}

/// Le note come le scrive un wikilink: il nome pagina, o il path senza
/// estensione quando il nome è ambiguo dentro `docs` (stesso nome in cartelle
/// diverse, confrontati con la `resolutionKey`, come li confronta chi risolve
/// i link) o quando `preservePath` lo chiede. L'ordine di `docs` resta.
export function noteTargets(docs: readonly string[], preservePath = false): { label: string; detail: string; target: string }[] {
  const seen = new Map<string, number>();
  for (const doc of docs) {
    const key = resolutionKey(pageName(doc));
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return docs.map((doc) => {
    const name = pageName(doc);
    const ambiguous = (seen.get(resolutionKey(name)) ?? 0) > 1;
    return { label: name, detail: doc, target: preservePath || ambiguous ? pathWithoutExtension(doc) : name };
  });
}
