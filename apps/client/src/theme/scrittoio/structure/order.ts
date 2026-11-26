// La struttura della shell Scrittoio si scrive a pezzi e si monta in
// `structure.css`, come la pelle (`../skin/order.ts`), col montaggio comune
// (`../assemble.ts`). I pezzi seguono le aree della cornice: chi cambia la
// geometria di un'area tocca il suo pezzo e rigenera con
// `npm run theme:generate`.
import { assemblePieces } from "../assemble";

/// I pezzi, nell'ordine in cui si montano. L'ordine è quello del file di
/// prima: le fondamenta (i token e le garanzie) per prime, poi la finestra,
/// il corpo, i fogli e gli stati della cornice, poi le superfici degli editor.
/// `foundation` resta primo: chi legge il primo `:root {` vuole i token.
export const ORDER = [
  "foundation",
  "window",
  "rail",
  "sheets",
  "frame-states",
  "grid",
  "ribbons",
  "rich",
  "canvas",
  "canvas-cards",
  "base-window",
  "draw",
  "draw-panels",
] as const;

export type StructurePart = (typeof ORDER)[number];

/// Il file che i pezzi compongono, relativo a `src/theme/scrittoio/`.
export const STRUCTURE = "structure.css";

const HEADER = `/* La struttura della shell Scrittoio: ciò che non si tematizza.
 *
 * GENERATO da \`theme/scrittoio/structure/\`: non si modifica qui. Si tocca il
 * pezzo e si rigenera con \`npm run theme:generate\`; una regola scritta a mano
 * in questo file sparisce alla prima rigenerazione.
 *
 * Tre cose stanno qui e in nessun pezzo di pelle:
 *
 * 1. **La griglia della finestra**: barra del titolo, binario, cassetti,
 *    scrivania, banda di stato. Un tema veste queste regioni, non le sposta.
 * 2. **Le misure della cornice**, come token. Il passo 0 dello «spazio
 *    dell'interfaccia» è dichiarato qui; gli altri passi li ridichiara la shell
 *    nel canale delle preferenze, dopo ogni pelle, così la scelta della persona
 *    vince su qualunque tema. Le misure dei fogli non hanno passi: lo spazio
 *    che la cornice cede va al foglio, e il foglio non cambia forma.
 * 3. **Le garanzie**: \`[hidden]\` nasconde, il fuoco si vede, il moto ridotto è
 *    ridotto, i colori forzati restano leggibili. Una pelle non le può revocare
 *    perché non passano da lei.
 *
 * Questo file è importato dall'ingresso della shell e non dal caricatore: non
 * attraversa il sanificatore, quindi può usare ciò che a una pelle è negato
 * (\`container-type\`, \`overscroll-behavior\`, \`scrollbar-gutter\`).
 */
`;

/// Monta la struttura dai suoi pezzi. `content` è il testo di ogni pezzo, per nome.
export function assemble(content: Readonly<Record<string, string>>): string {
  return assemblePieces({ order: ORDER, header: HEADER, folder: "structure", label: "struttura", content });
}
