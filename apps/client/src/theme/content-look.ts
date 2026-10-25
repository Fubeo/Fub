// L'aspetto del contenuto di una superficie: chi ha l'autorità sui suoi
// colori, sui caratteri e sulla carta.
//
// - `tema`: il tema veste il contenuto; del file restano struttura ed enfasi;
// - `file`: vince ogni valore del file, sulla sua carta;
// - `adattato`: le tinte del file sulla carta del tema, corrette da
//   `adapt.ts`.
//
// Quali aspetti offre una modalità lo dichiara la modalità (`SurfaceMode.looks`,
// il predefinito per primo); quale si vede lo decidono la scelta del riquadro e
// l'impostazione `appearance.content-look`. La radice del contenuto riceve la
// classe `look-*`: una classe e non un attributo, perché i frammenti CSS
// accettano soltanto selettori di classe.

import type { Paper } from "./adapt";

/// Gli aspetti di una modalità.
export const LOOKS = ["tema", "file", "adattato"] as const;
export type Look = (typeof LOOKS)[number];

/// I valori dell'impostazione, il predefinito per primo. Gemelli di
/// `CONTENT_LOOKS` in fub-host/src/settings.rs: `legacy_tests/switches.rs` li
/// confronta.
export const CONTENT_LOOK_CHOICES = ["auto", "file", "adattato"] as const;
export type ContentLookChoice = (typeof CONTENT_LOOK_CHOICES)[number];

/// Ciò che vale senza una modalità, o con un elenco vuoto: il tema, cioè ciò
/// che succedeva prima che gli aspetti esistessero.
const UNDECLARED: readonly Look[] = ["tema"];

export function isLook(value: unknown): value is Look {
  return (LOOKS as readonly unknown[]).includes(value);
}

/// Il valore dell'impostazione: uno sconosciuto è `auto`.
export function contentLookChoiceOf(value: unknown): ContentLookChoice {
  return (CONTENT_LOOK_CHOICES as readonly unknown[]).includes(value) ? (value as ContentLookChoice) : "auto";
}

/// L'aspetto che si vede.
///
/// La scelta del riquadro vale se la modalità la offre. Altrimenti decide
/// l'impostazione, se la modalità offre ciò che chiede: `auto` è il predefinito
/// della modalità, o `adattato` con il contrasto alto. Altrimenti il
/// predefinito della modalità. Passando a una modalità che non offre l'aspetto
/// scelto si torna così al suo predefinito, senza cancellare la scelta.
export function resolveLook(
  offered: readonly Look[] | undefined,
  chosen: unknown,
  preference: ContentLookChoice,
  highContrast: boolean,
): Look {
  const looks = offered && offered.length > 0 ? offered : UNDECLARED;
  if (isLook(chosen) && looks.includes(chosen)) return chosen;
  const wanted = preference === "auto" ? (highContrast ? "adattato" : null) : preference;
  if (wanted && looks.includes(wanted)) return wanted;
  return looks[0]!;
}

/// La classe della radice del contenuto.
export function lookClass(look: Look): `look-${Look}` {
  return `look-${look}`;
}

/// Mette su `root` la classe dell'aspetto, e toglie le altre.
export function markLook(root: HTMLElement, look: Look | null): void {
  for (const each of LOOKS) root.classList.toggle(lookClass(each), each === look);
}

/// L'aspetto che `root` mostra, dalla sua classe; `null` senza.
export function shownLook(root: HTMLElement): Look | null {
  return LOOKS.find((look) => root.classList.contains(lookClass(look))) ?? null;
}

/// La carta del tema su cui portare i colori del file (`adapt.ts`), quando
/// `root` mostra l'aspetto adattato: il fondo e l'inchiostro della carta
/// (`--doc-bg`, `--doc-fg`) come li vede `at`. Negli altri aspetti, nessuna.
export function adaptedPaper(root: HTMLElement, at: Element = root): Paper | null {
  if (shownLook(root) !== "adattato") return null;
  const css = getComputedStyle(at);
  const bg = css.getPropertyValue("--doc-bg").trim();
  const ink = css.getPropertyValue("--doc-fg").trim();
  return bg && ink ? { bg, ink } : null;
}

let preference: ContentLookChoice = "auto";
let highContrast = false;
const listeners = new Set<() => void>();

/// L'impostazione e il contrasto, riletti da `theme.ts`. Chi mostra un
/// contenuto è avvisato solo quando cambia davvero.
export function setContentLookPreference(value: unknown, high: boolean): void {
  const next = contentLookChoiceOf(value);
  if (next === preference && high === highContrast) return;
  preference = next;
  highContrast = high;
  for (const listener of [...listeners]) listener();
}

export function contentLookPreference(): { readonly preference: ContentLookChoice; readonly highContrast: boolean } {
  return { preference, highContrast };
}

/// Iscrive `listener` ai cambi; restituisce il disposer.
export function onContentLookChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
