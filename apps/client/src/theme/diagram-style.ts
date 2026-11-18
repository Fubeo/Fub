// Lo stile dei diagrammi Mermaid: la scelta dell'utente
// (`appearance.diagram-style`, riletta con le altre impostazioni d'aspetto) e
// la scelta di un diagramma solo, scritta nel suo sorgente come commento
// Mermaid — `%% stile: acquerello` —, che GitHub e gli altri editor ignorano.
//
// Qui ci sono soltanto i nomi e le regole per leggerli e scriverli: i colori
// stanno in `ui/mermaid-styles.ts`, che li disegna.

/// Gli stili, il predefinito per primo. Gemelli di `DIAGRAM_STYLES` in
/// fub-host/src/settings.rs: `legacy_tests/switches.rs` li confronta.
export const DIAGRAM_STYLE_IDS = ["armonia", "acquerello", "aurora", "blueprint", "inchiostro"] as const;

export type DiagramStyleId = (typeof DIAGRAM_STYLE_IDS)[number];

export const DEFAULT_DIAGRAM_STYLE: DiagramStyleId = "armonia";

/// La chiave dell'impostazione. Gemella di `DIAGRAM_STYLE_KEY` in `theme.ts`,
/// che la rilegge: qui la usa chi la scrive, senza tirarsi dietro il tema.
export const DIAGRAM_STYLE_SETTING = "appearance.diagram-style";

/// I nomi inglesi, per chi scrive la direttiva in inglese.
const ALIASES: Readonly<Record<string, DiagramStyleId>> = {
  harmony: "armonia",
  watercolor: "acquerello",
  watercolour: "acquerello",
  ink: "inchiostro",
};

/// Lo stile di un nome, id o alias, senza badare a maiuscole; `null` se non
/// è uno stile.
export function diagramStyleNamed(name: string): DiagramStyleId | null {
  const key = name.trim().toLowerCase();
  if ((DIAGRAM_STYLE_IDS as readonly string[]).includes(key)) return key as DiagramStyleId;
  return ALIASES[key] ?? null;
}

/// Lo stile di un valore dell'impostazione: uno sconosciuto è il predefinito.
export function diagramStyleOf(value: unknown): DiagramStyleId {
  return (typeof value === "string" ? diagramStyleNamed(value) : null) ?? DEFAULT_DIAGRAM_STYLE;
}

let current: DiagramStyleId = DEFAULT_DIAGRAM_STYLE;
const listeners = new Set<() => void>();

/// La preferenza, riletta da `theme.ts`. Chi disegna diagrammi è avvisato
/// solo quando cambia davvero.
export function setDiagramStylePreference(value: unknown): void {
  const next = diagramStyleOf(value);
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

export function diagramStylePreference(): DiagramStyleId {
  return current;
}

/// Iscrive `listener` ai cambi di stile; restituisce il disposer.
export function onDiagramStyleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// La riga della direttiva: un commento Mermaid (`%%`), la parola `stile` o
/// `style`, due punti e un nome. Non `%%{`, che è una direttiva di Mermaid.
const DIRECTIVE = /^[ \t]*%%(?!\{)[ \t]*(?:stile|style)[ \t]*:[ \t]*([\w-]*)[ \t]*$/i;

export interface StyleDirective {
  /// Lo stile nominato, o `null` se il nome non è uno stile.
  readonly style: DiagramStyleId | null;
  /// Il nome com'è scritto: chi legge uno stile sconosciuto sa quale.
  readonly name: string;
  /// Inizio e fine della riga nel sorgente, senza il suo a capo.
  readonly from: number;
  readonly to: number;
}

/// La prima direttiva di stile del sorgente di un diagramma, se c'è.
export function styleDirective(source: string): StyleDirective | null {
  let from = 0;
  while (from <= source.length) {
    const end = source.indexOf("\n", from);
    const to = end < 0 ? source.length : end;
    const line = source.slice(from, to).replace(/\r$/, "");
    const match = DIRECTIVE.exec(line);
    if (match) return { style: diagramStyleNamed(match[1] ?? ""), name: match[1] ?? "", from, to: from + line.length };
    if (end < 0) break;
    from = end + 1;
  }
  return null;
}

/// Lo stile che il diagramma chiede per sé, o `null`: allora vale quello
/// dell'utente.
export function ownDiagramStyle(source: string): DiagramStyleId | null {
  return styleDirective(source)?.style ?? null;
}

/// Una modifica del sorgente del diagramma, in offset della stringa.
export interface SourceEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/// Dove finisce il frontmatter di Mermaid (`---` … `---` in cima al corpo):
/// l'offset della riga che lo segue, o 0 se il corpo non ne ha uno chiuso.
export function frontmatterEnd(source: string): number {
  const first = source.indexOf("\n");
  if (first < 0 || source.slice(0, first).replace(/\r$/, "").trim() !== "---") return 0;
  let from = first + 1;
  while (from < source.length) {
    const end = source.indexOf("\n", from);
    const to = end < 0 ? source.length : end;
    if (source.slice(from, to).replace(/\r$/, "").trim() === "---") return end < 0 ? source.length : end + 1;
    if (end < 0) break;
    from = end + 1;
  }
  return 0;
}

/// La modifica che dà al diagramma lo stile `style`, o che toglie la sua
/// scelta con `null`. La direttiva nuova sta in cima, dopo l'eventuale
/// frontmatter di Mermaid, che deve restare la prima cosa del corpo; se c'era
/// già si riscrive al suo posto. `null` quando non c'è niente da cambiare.
export function styleDirectiveEdit(source: string, style: DiagramStyleId | null): SourceEdit | null {
  const found = styleDirective(source);
  if (style === null) {
    if (!found) return null;
    // Via la riga intera, col suo a capo.
    const next = source.indexOf("\n", found.to);
    return { from: found.from, to: next < 0 ? found.to : next + 1, insert: "" };
  }
  const line = `%% stile: ${style}`;
  if (found) {
    if (found.style === style) return null;
    return { from: found.from, to: found.to, insert: line };
  }
  const at = frontmatterEnd(source);
  // Un frontmatter chiuso sull'ultima riga, senza a capo: la direttiva va a
  // capo dopo di lui.
  if (at === source.length && at > 0 && !source.endsWith("\n")) return { from: at, to: at, insert: `\n${line}` };
  return { from: at, to: at, insert: `${line}\n` };
}
