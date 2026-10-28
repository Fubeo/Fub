// La tavolozza e gli spessori del disegno: quelli dell'inchiostro
// (`ink/palette.ts`, gli otto colori di Okabe–Ito e gli spessori 2/4/8) con i
// nomi del disegno, più i colori scelti a piacere.
//
// Due colori che qualcuno non distingue restano due campioni diversi per il
// nome, che dicono il pozzo, il suggerimento e lo screen reader: i campioni
// sono tutti tondi, senza forme (DEC-13). Il campione ha sempre un filo nel
// colore del testo, che lo stacca dal fondo in entrambi i temi, nero
// compreso.
//
// Un colore personalizzato si scrive come quelli della tavolozza, `#rrggbb`
// minuscolo, e si dice col suo codice: un nome inventato direbbe meno.
//
// I valori sono quelli che le operazioni scrivono nel file: colori `#rrggbb`
// minuscoli e spessori in unità della scena.

import { INK_HIGHLIGHTER_WIDTHS, INK_PALETTE, INK_WIDTHS } from "../../../ink/palette";
import type { DrawKey } from "../strings";
import { contrast, WHITE } from "../scene/analysis";
import { paint } from "../scene/values";

export interface Swatch {
  readonly id: string;
  /// Il colore come si scrive nel file.
  readonly color: string;
  /// Sotto il contrasto 3:1 sulla carta bianca.
  readonly light: boolean;
  readonly label: DrawKey;
}

export interface Width {
  readonly id: string;
  /// Lo spessore in unità della scena: `size` della penna, `stroke-width`
  /// delle forme.
  readonly value: number;
  readonly label: DrawKey;
}

export const PALETTE: readonly Swatch[] = INK_PALETTE.map((swatch) => ({ ...swatch, label: `draw.color.${swatch.id}` as const }));

export const WIDTHS: readonly Width[] = INK_WIDTHS.map((width) => ({ ...width, label: `draw.width.${width.id}` as const }));

/// Gli spessori dell'evidenziatore, con gli stessi nomi: un segno che copre
/// una riga di testo, da una sottile a una da titolo.
export const HIGHLIGHTER_WIDTHS: readonly Width[] = INK_HIGHLIGHTER_WIDTHS.map((width) => ({ ...width, label: `draw.width.${width.id}` as const }));

/// Il colore e lo spessore di partenza: Nero e Medio, quelli dell'esempio del
/// formato.
export const DEFAULT_COLOR = "#000000";
export const DEFAULT_WIDTH = 4;

/// L'evidenziatore parte giallo e medio; quanto copre lo dice lo strumento
/// (`ink/tools/highlighter`).
export const HIGHLIGHTER_COLOR = "#f0e442";
export const HIGHLIGHTER_WIDTH = 16;

/// La copertura delle annotazioni di un PDF parte nera, col suo colore, che
/// non cambia quello della penna.
export const COVER_COLOR = "#000000";

/// Quanti colori scelti di recente si ricordano: quelli che offrono la
/// sezione «Colori del documento» e, i primi tre, il menu radiale.
export const RECENT_COLORS = 8;

/// Il campione di un colore scritto nel file, se è della tavolozza.
export function swatchOf(color: string): Swatch | null {
  const lower = color.toLowerCase();
  return PALETTE.find((swatch) => swatch.color === lower) ?? null;
}

/// Il colore scritto da chi lo sceglie, come lo scrive il file: `#rrggbb`
/// minuscolo. Vale un codice di tre o sei cifre, anche senza `#`, o un nome
/// di colore CSS; `null` per tutto il resto, `none` compreso.
export function customColor(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  const value = paint(/^[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(text) ? `#${text}` : text);
  if (value === null || value === "none") return null;
  return `#${value.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/// Vero se `color`, `#rrggbb`, sta sotto il contrasto 3:1 sulla carta
/// bianca, come i colori chiari della tavolozza.
export function isLight(color: string): boolean {
  const value = paint(color);
  return value !== null && value !== "none" && contrast(value, WHITE) < 3;
}
