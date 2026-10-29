// L'indice (K4): un recinto ```toc``` diventa l'elenco dei titoli della nota,
// ognuno un link al suo titolo, in Lettura, in Live e nei Blocchi. Nel
// recinto può stare `livelli: 2-3` (o `levels: 2-3`) per tenere soltanto quei
// livelli; senza, ci sono tutti. Il testo resta il recinto: l'indice non si
// scrive nel file e segue i titoli da solo. L'export ha la gemella in
// `crates/fub-format-markdown/src/render.rs`.
import { escapeHtml } from "./render-inline";
import { liveStrings } from "./strings";

/// Un titolo della nota, come l'indice lo elenca: il livello, il testo
/// visibile e l'id che la resa gli dà.
export interface TocEntry {
  readonly level: number;
  readonly text: string;
  readonly id: string;
}

const LEVELS = /^[ \t]*(?:livelli|levels)[ \t]*:[ \t]*([1-6])(?:[ \t]*-[ \t]*([1-6]))?[ \t]*$/i;

/// I livelli che il recinto chiede, `[da, a]`: tutti se non lo dice, o se lo
/// dice in un modo che non si legge.
export function tocLevels(body: string): readonly [number, number] {
  for (const line of body.split(/\r?\n/)) {
    const found = LEVELS.exec(line);
    if (!found) continue;
    const a = Number(found[1]);
    const b = found[2] === undefined ? a : Number(found[2]);
    return [Math.min(a, b), Math.max(a, b)];
  }
  return [1, 6];
}

/// L'HTML dell'indice: un elenco piatto, ogni voce rientrata di quanto il
/// suo livello sta sotto il più alto elencato. `attrs` sono gli attributi
/// della sorgente del recinto.
export function tocHtml(body: string, entries: readonly TocEntry[], attrs: string): string {
  const [from, to] = tocLevels(body);
  const shown = entries.filter((entry) => entry.level >= from && entry.level <= to && entry.id !== "");
  const label = escapeHtml(liveStrings.t("live.toc"));
  if (shown.length === 0) {
    return `<div class="fub-toc" data-empty="true"${attrs}><p class="fub-toc-empty">${escapeHtml(liveStrings.t("live.toc.empty"))}</p></div>`;
  }
  const top = Math.min(...shown.map((entry) => entry.level));
  const items = shown.map((entry) => {
    const id = escapeHtml(entry.id);
    return `<li class="fub-toc-item" data-depth="${entry.level - top}"><a href="#${id}" data-md-anchor="${id}">${escapeHtml(entry.text)}</a></li>`;
  }).join("");
  return `<div class="fub-toc"${attrs}><ul aria-label="${label}">${items}</ul></div>`;
}
