// La pelle composta nella build, divisa in più chunk dello stesso testo.
//
// La pelle è un modulo solo (`skin.css?raw`) e Rollup non divide un modulo:
// cresciuta con le superfici, il suo chunk superava il budget per chunk di
// `vite.config.ts`. Qui la si taglia ai confini fra i pezzi che la compongono
// (le testate `/* ── skin/<pezzo>.css ── */` che scrive
// `src/theme/scrittoio/skin/order.ts`), si raccolgono i pezzi consecutivi in
// gruppi di peso simile, e si minimizza ogni gruppo con `minifySkin`.
//
// Il modulo della pelle, nella build, importa i gruppi e li rimette insieme
// nell'ordine: il testo che arriva al tema è **lo stesso, byte per byte**, di
// `minifySkin` sulla pelle intera, e `skinGroups` si ferma se non lo è. Le
// regole, il loro ordine e il cancello del tema quindi non cambiano; cambia
// soltanto in quanti file viaggia il testo. Tutti i gruppi sono import statici
// del modulo della pelle: si caricano all'avvio con lei, come prima.

import { minifySkin } from "./skin-minify.mjs";

/**
 * Il peso, in byte minimizzati, verso cui la build divide la pelle: tanti
 * gruppi quanti ne servono perché la media stia sotto. Un taglio cade al
 * confine fra due pezzi, quindi un gruppo può superarlo di mezzo pezzo (il più
 * grosso, `document.css`, minimizzato pesa circa 75 KB): resta comunque ben
 * sotto il budget per chunk di `vite.config.ts`.
 */
export const SKIN_GROUP_TARGET = 300_000;

/** La testata di un pezzo, all'inizio di una riga. */
const PART_HEADER = /^\/\* ── skin\/([a-z0-9-]+)\.css ─+ \*\/$/gm;

/**
 * La pelle composta nei suoi pezzi, nell'ordine in cui stanno nel file. Il
 * primo porta con sé la testata del file; ognuno comincia con la sua testata e
 * finisce dove comincia quella dopo, così i testi rimessi insieme sono la
 * pelle intera.
 *
 * @param {string} css
 * @returns {{ name: string; text: string }[]}
 */
export function skinParts(css) {
  const starts = [...css.matchAll(PART_HEADER)].map((match) => ({ name: match[1], at: match.index }));
  if (starts.length === 0) {
    throw new Error("pelle: nessuna testata `/* ── skin/<pezzo>.css ── */`; il testo non viene da `theme:generate`");
  }
  return starts.map((start, index) => ({
    name: start.name,
    text: css.slice(index === 0 ? 0 : start.at, starts[index + 1]?.at ?? css.length),
  }));
}

/**
 * La pelle minimizzata in gruppi di pezzi consecutivi, ognuno vicino a
 * `target` byte o sotto: tanti gruppi quanti ne servono perché il peso medio
 * stia sotto `target`, con i tagli al confine fra pezzi più vicino alla parte
 * uguale. I gruppi rimessi insieme sono `minifySkin(css)`.
 *
 * @param {string} css
 * @param {number} target
 * @returns {{ parts: string[]; text: string }[]}
 */
export function skinGroups(css, target) {
  if (!(target > 0)) throw new Error(`pelle: il peso dei gruppi dev'essere positivo, non ${target}`);
  const parts = skinParts(css).map((part) => ({ name: part.name, text: minifySkin(part.text) }));
  const sizes = parts.map((part) => Buffer.byteLength(part.text, "utf8"));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const count = Math.min(parts.length, Math.max(1, Math.ceil(total / target)));

  // Il taglio k va dopo il pezzo la cui fine è più vicina a k·totale/count.
  const ends = [];
  let sum = 0;
  for (const size of sizes) ends.push((sum += size));
  const cuts = [];
  for (let k = 1; k < count; k++) {
    const ideal = (total * k) / count;
    const first = (cuts.at(-1) ?? 0) + 1;
    let best = first;
    for (let i = first; i <= parts.length - (count - k); i++) {
      if (Math.abs(ends[i - 1] - ideal) < Math.abs(ends[best - 1] - ideal)) best = i;
    }
    cuts.push(best);
  }

  const groups = [];
  let from = 0;
  for (const to of [...cuts, parts.length]) {
    const slice = parts.slice(from, to);
    groups.push({ parts: slice.map((part) => part.name), text: slice.map((part) => part.text).join("") });
    from = to;
  }
  if (groups.map((group) => group.text).join("") !== minifySkin(css)) {
    throw new Error("pelle: i gruppi minimizzati, rimessi insieme, non sono la pelle minimizzata intera");
  }
  return groups;
}
