// La tavolozza: i token del foglio e il contrasto dei colori sulle superfici.
//
// La usano il catalogo del banco (`bench/catalog.ts`), che mostra ogni token
// del foglio col suo valore e i suoi conti, e la pagina «Tutti i componenti»
// (`pagina.ts`), che mostra i colori dei ruoli e il contrasto del testo.
import { contrast } from "../../theme/contrast";

/// I nomi dei token, **letti dal foglio** e nel suo ordine.
///
/// Non da un elenco scritto a mano: un elenco a mano è la seconda metà di una
/// coppia che nessuno tiene insieme, e il giorno che diverge il catalogo non
/// diventa rosso — smette solo di mostrare un token, che è il difetto che
/// questo catalogo è nato per non avere più.
export function tokenNames(stylesheet: string): string[] {
  const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]!);
}

/// Le quattro superfici su cui un inchiostro può stare. Sono i quattro fondi che
/// la pelle usa davvero, e sono anche quelle che `contrast.test.ts` enumera:
/// il catalogo mostra lo stesso conto, misurato sull'altro lato — lì dal foglio
/// come testo, qui da `getComputedStyle` sulla pagina.
export const SURFACES = ["--bg", "--bg-chrome", "--bg-elev", "--bg-input"] as const;

/// Un token è un colore se il suo valore, reso, è un colore pieno che il conto
/// sa leggere. I veli e le ombre (`rgb(… / …)`, `0 1px 2px …`) non lo sono, e
/// il loro contrasto non è una funzione dei soli token: si mostrano col loro
/// valore e senza conti, che è la cosa vera da dire.
export function isColor(value: string): boolean {
  return /^#|^rgba?\(/i.test(value.trim()) && !/\/\s*0?\.\d/.test(value);
}

/// I colori dei ruoli che la pagina «Tutti i componenti» mostra in fila: i
/// fondi, l'inchiostro, l'accento e i quattro toni.
export const ROLE_SWATCHES = [
  "bg",
  "bg-chrome",
  "sheet",
  "text",
  "muted",
  "border",
  "accent",
  "accent-soft",
  "danger",
  "warning",
  "success",
  "info",
] as const;

/// La soglia del testo normale (WCAG AA).
export const TEXT_MINIMUM = 4.5;

/// Il contrasto fra due token resi sulla radice, o `null` se uno dei due non è
/// un colore che il conto sa leggere.
export function renderedContrast(ink: string, paper: string, root: Element = document.documentElement): number | null {
  const style = getComputedStyle(root);
  const a = style.getPropertyValue(ink).trim();
  const b = style.getPropertyValue(paper).trim();
  if (!isColor(a) || !isColor(b)) return null;
  try {
    return contrast(a, b);
  } catch {
    return null;
  }
}
