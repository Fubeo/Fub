// Le copie dei connettori e delle loro etichette (Disegni, connettori):
// duplicare, copiare e incollare oggetti coi connettori che li uniscono.
//
// - **Un riferimento segue la copia.** `fub:from` e `fub:to` di un connettore
//   nominano gli oggetti a cui è agganciato, `fub:along` di un'etichetta il
//   suo connettore: se ciò che nominano è copiato nello stesso comando, anche
//   dentro un gruppo, la copia nomina la copia, e tiene il resto del valore
//   com'era scritto, il punto d'aggancio, `t` e la distanza.
// - **Altrimenti si toglie.** Un capo agganciato a ciò che non è stato copiato
//   resta libero, e un'etichetta senza il suo connettore è un testo qualunque,
//   col suo `transform`: nominare l'originale, o peggio un oggetto che il
//   disegno di arrivo ha con lo stesso id, la porterebbe a seguire altro.
// - **Fuori grammatica resta com'è.** Un valore che il formato non legge non
//   si usa, e non si cambia (formato della scena, connettori).
// - **La geometria non si tocca.** `fub:geom` e `d` restano quelli
//   dell'originale: quando anche i due capi sono copie, il seguito dei
//   connettori (`connectors.ts`) li ricalcola da sé.
//
// Qui non c'è né il DOM né il testo del documento: il valore di un attributo
// (`relinked`) e gli elementi di un'operazione (`relinkCopies`), per chi
// duplica (`arrange.ts`); chi incolla riscrive il testo (`clipboard.ts`) e
// chiede qui soltanto il valore.

import { readConnectorEnd, readLabelPlace } from "../scene/connectors";
import type { Elem } from "../scene/serialize";

/// Gli attributi di FubDraw che nominano un altro oggetto per id: i due capi
/// di un connettore e il connettore di un'etichetta.
export type LinkName = "from" | "to" | "along";

const LINK_NAMES: ReadonlySet<string> = new Set<LinkName>(["from", "to", "along"]);

/// Vero se `local`, il nome senza prefisso di un attributo del namespace di
/// FubDraw, nomina un altro oggetto per id.
export function isLinkName(local: string): local is LinkName {
  return LINK_NAMES.has(local);
}

/// La prima parola di un valore, con gli spazi di SVG che la precedono: l'id.
const FIRST_WORD = /^([ \t\n\r\f]*)[^ \t\n\r\f]+/;

/// Il valore di `name` per una copia, dato `value` dell'originale e `renamed`,
/// che dice l'id della copia di un oggetto copiato, `null` degli altri:
/// il valore con l'id della copia al posto di quello dell'originale, e il
/// resto com'era scritto; `null` se ciò che nomina non è stato copiato, e
/// l'attributo va tolto. Un valore fuori dalla grammatica torna com'è.
export function relinked(name: LinkName, value: string, renamed: (id: string) => string | null): string | null {
  const parsed = name === "along" ? readLabelPlace(value) : readConnectorEnd(value);
  if (parsed === null) return value;
  const next = renamed(parsed.id);
  return next === null ? null : value.replace(FIRST_WORD, (_, lead: string) => lead + next);
}

/// `elem` con i riferimenti dei connettori e delle etichette, anche dei suoi
/// discendenti, rivolti alle copie: `renamed` dice per ogni id di un oggetto
/// copiato quello della copia. Gli elementi che non cambiano restano gli
/// stessi oggetti.
function relinkedElem(elem: Elem, renamed: (id: string) => string | null): Elem {
  let attrs: Record<string, string> | null = null;
  for (const [key, value] of Object.entries(elem.attrs)) {
    if (!key.startsWith("fub:")) continue;
    const name = key.slice(4);
    if (!isLinkName(name)) continue;
    const next = relinked(name, value, renamed);
    if (next === value) continue;
    attrs ??= { ...elem.attrs };
    if (next === null) delete attrs[key];
    else attrs[key] = next;
  }
  const children = elem.children?.map((child) => relinkedElem(child, renamed));
  const changed = children !== undefined && children.some((child, at) => child !== elem.children![at]);
  if (attrs === null && !changed) return elem;
  return { ...elem, attrs: attrs ?? elem.attrs, ...(changed ? { children } : {}) };
}

/// Le copie `elems`, appena scritte con id nuovi, coi riferimenti dei
/// connettori e delle etichette rivolti alle copie. `renamed` ha per ogni
/// oggetto copiato nello stesso comando il suo id e quello della copia.
export function relinkCopies(elems: readonly Elem[], renamed: ReadonlyMap<string, string>): Elem[] {
  const copy = (id: string): string | null => renamed.get(id) ?? null;
  return elems.map((elem) => relinkedElem(elem, copy));
}
