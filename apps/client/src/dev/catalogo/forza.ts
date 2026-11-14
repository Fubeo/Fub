// Gli stati che non stanno fermi, tenuti fermi.
//
// Passaggio, pressione e fuoco esistono solo sotto un puntatore o dopo un
// tasto, e un catalogo ne vuole venti insieme. Qui li si tiene fermi senza
// scrivere una riga di pelle: a ogni regola dei fogli montati che nomina
// `:hover`, `:active` o `:focus-visible` si dà un selettore gemello che legge
// `data-force`, **nella stessa regola** — quindi con le stesse dichiarazioni,
// lo stesso posto nella cascata e la stessa specificità (un attributo pesa
// quanto una pseudo-classe). Un campione forzato mostra perciò ciò che la
// pelle dà davvero.
//
// Nell'app i fogli sono quelli vivi della finestra: chiusa la pagina che li ha
// gemellati, ogni regola torna al selettore che aveva. Nessun nodo della shell
// porta `data-force`, quindi i gemelli, finché ci sono, non cambiano niente
// fuori dai campioni.
import type { Lifetime } from "../../ui/lifetime";

export type Force = "hover" | "active" | "focus";

const FORCED: readonly (readonly [RegExp, string])[] = [
  [/:hover\b/g, '[data-force~="hover"]'],
  [/:active\b/g, '[data-force~="active"]'],
  [/:focus-visible\b/g, '[data-force~="focus"]'],
];
/// Un `:not(:hover)` non si gemella: il gemello varrebbe per chiunque non sia
/// forzato, cioè sempre.
const NEGATED = /:not\([^)]*:(?:hover|active|focus-visible)/;

/// Divide una lista di selettori alle virgole che non stanno fra parentesi.
export function selectors(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

/// Il selettore di una regola coi suoi gemelli, o `null` se non ne ha.
export function twinned(selectorText: string): string | null {
  const own = selectors(selectorText);
  const twins: string[] = [];
  for (const selector of own) {
    if (NEGATED.test(selector)) continue;
    let forced = selector;
    for (const [pattern, attribute] of FORCED) forced = forced.replace(pattern, attribute);
    if (forced !== selector) twins.push(forced);
  }
  return twins.length > 0 ? [...own, ...twins].join(", ") : null;
}

/// Gemella i fogli della finestra finché `lifetime` vive, e li rimette come
/// erano quando si chiude.
///
/// Va chiamata **prima** dei campioni: nati già nel loro stato, non hanno una
/// transizione da finire. Un foglio rimontato — il caricatore che cambia tema,
/// o Vite che ricarica un CSS toccato a server acceso — è un foglio nuovo, e
/// senza i gemelli: lo si rifà.
export function holdForcedStates(lifetime: Lifetime, doc: Document = document): void {
  if (lifetime.closed) return;
  const seen = new WeakSet<CSSStyleSheet>();
  const originals = new Map<CSSStyleRule, string>();

  const twin = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const next = twinned(rule.selectorText);
        if (next !== null) {
          originals.set(rule, rule.selectorText);
          rule.selectorText = next;
        }
      }
      const nested = (rule as Partial<CSSGroupingRule>).cssRules;
      if (nested) twin(nested);
    }
  };

  const twinSheets = (): void => {
    for (const sheet of Array.from(doc.styleSheets)) {
      if (seen.has(sheet)) continue;
      seen.add(sheet);
      try {
        twin(sheet.cssRules);
      } catch {
        // Un foglio di un'altra origine non si legge: non è nostro.
      }
    }
  };

  twinSheets();
  // Riscrivere un selettore non tocca il DOM: l'osservatore non si risveglia
  // da solo.
  const remounted = new MutationObserver(twinSheets);
  remounted.observe(doc.head, { childList: true, subtree: true, characterData: true });
  lifetime.add(() => {
    remounted.disconnect();
    for (const [rule, selector] of originals) {
      // Un foglio tolto nel frattempo non ha più niente da rimettere.
      if (rule.parentStyleSheet?.ownerNode?.isConnected) rule.selectorText = selector;
    }
    originals.clear();
  });
}

/// Tiene un campione negli stati dati.
export function force<T extends HTMLElement>(node: T, ...states: Force[]): T {
  node.dataset.force = states.join(" ");
  return node;
}
