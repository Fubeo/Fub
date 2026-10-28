// La pelle della serie Scrittoio si scrive a pezzi e si monta in un file.
//
// Vale ciò che valeva per la serie precedente: in CSS l'ordine di due regole
// della stessa specificità decide chi vince, quindi l'ordine è **dichiarato**
// qui e non dedotto dalla cartella; e un pezzo scritto ma non elencato non si
// monta, quindi `assemble` lo rifiuta invece di uscire più corta in silenzio.
//
// Ogni pezzo ha accanto il suo modulo di anatomia (`../anatomia/<pezzo>.ts`):
// l'elenco qui sotto e quello di `../anatomia.ts` sono lo stesso, e un presidio
// li confronta.

/// I pezzi, nell'ordine in cui si montano: dal generale al particolare.
///
/// Le fondamenta e le primitive (`kit`) per prime; poi la cornice della
/// finestra, i fogli, ciò che sta dentro i fogli, le superfici che si aprono
/// sopra; il moto per ultimo, perché tocca componenti che gli altri pezzi
/// hanno già vestito.
export const ORDER = [
  "foundation",
  "controls",
  "kit",
  "frame",
  "drawers",
  "tree",
  "search",
  "sheets",
  "document",
  "tabella",
  "editors",
  "draw",
  "media",
  "nodes",
  "graph",
  "menus",
  "launcher",
  "centres",
  "draw-dialogs",
  "settings",
  "welcome",
  "motion",
] as const;

export type SkinPart = (typeof ORDER)[number];

/// Il file che i pezzi compongono, relativo a `src/theme/scrittoio/`.
export const SKIN = "skin.css";

const HEADER = `/* La pelle della serie Scrittoio.
 *
 * GENERATO da \`theme/scrittoio/skin/\`: non si modifica qui. Si tocca il pezzo
 * e si rigenera con \`npm run theme:generate\`; una regola scritta a mano in
 * questo file sparisce alla prima rigenerazione.
 *
 * Qui sta ciò che si vede: fondi, fili, rilievo, caratteri, e la geometria
 * interna dei componenti. La griglia della finestra, i piani e le garanzie
 * (\`[hidden]\`, anello del fuoco, moto ridotto) stanno nella struttura
 * (\`theme/scrittoio/structure.css\`), che è della shell. I valori stanno nei
 * fogli: questa pelle li consuma e non li dichiara.
 */
`;

function header(part: string): string {
  const prefix = `/* ── skin/${part}.css `;
  return `${prefix}${"─".repeat(Math.max(3, 76 - prefix.length))} */\n`;
}

/// Monta la pelle dai suoi pezzi. `content` è il testo di ogni pezzo, per nome.
export function assemble(content: Readonly<Record<string, string>>): string {
  const extraParts = Object.keys(content).filter((name) => !(ORDER as readonly string[]).includes(name));
  if (extraParts.length > 0) {
    throw new Error(
      `pelle: ${extraParts.map((name) => `«${name}.css»`).join(", ")} non è nell'ordine, e un pezzo ` +
        "fuori dall'ordine non si monta: aggiungilo al punto in cui deve valere.",
    );
  }

  const out = [HEADER];
  for (const part of ORDER) {
    const text = content[part];
    if (text === undefined) throw new Error(`pelle: manca il pezzo «${part}.css»`);
    out.push(`\n${header(part)}\n${text.replace(/\n+$/, "\n")}`);
  }
  return out.join("");
}
