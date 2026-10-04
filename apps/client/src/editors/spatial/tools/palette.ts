// La tavolozza e gli spessori del livello Essenziale, e ciò che il livello
// Standard ci aggiunge: gli spessori dell'evidenziatore e i colori scelti a
// piacere.
//
// Gli otto colori sono quelli di Okabe–Ito, leggibili con le forme comuni di
// daltonismo. Ogni campione ha un nome e una forma oltre al colore, così due
// colori che qualcuno non distingue restano due campioni diversi: la forma si
// vede nel campione, il nome lo dicono il suggerimento e lo screen reader.
// Giallo, Arancione e Azzurro sulla carta bianca stanno sotto il contrasto
// 3:1: la tavolozza li segna come chiari, perché un tratto in quei colori si
// legge poco. Il campione nella barra ha sempre un filo nel colore del testo,
// che lo stacca dal fondo in entrambi i temi, nero compreso.
//
// Un colore personalizzato si scrive come quelli della tavolozza, `#rrggbb`
// minuscolo, e si dice col suo codice: un nome inventato direbbe meno.
//
// I valori sono quelli che le operazioni scrivono nel file: colori `#rrggbb`
// minuscoli e spessori in unità della scena.

import type { DrawKey } from "../strings";
import { contrast, WHITE } from "../scene/analysis";
import { paint } from "../scene/values";

/// La forma di un campione.
export type SwatchShape = "circle" | "square" | "triangle" | "diamond" | "pentagon" | "hexagon" | "star" | "cross";

export interface Swatch {
  readonly id: string;
  /// Il colore come si scrive nel file.
  readonly color: string;
  readonly shape: SwatchShape;
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

export const PALETTE: readonly Swatch[] = [
  { id: "black", color: "#000000", shape: "circle", light: false, label: "draw.color.black" },
  { id: "blue", color: "#0072b2", shape: "square", light: false, label: "draw.color.blue" },
  { id: "vermilion", color: "#d55e00", shape: "triangle", light: false, label: "draw.color.vermilion" },
  { id: "green", color: "#009e73", shape: "diamond", light: false, label: "draw.color.green" },
  { id: "purple", color: "#cc79a7", shape: "pentagon", light: false, label: "draw.color.purple" },
  { id: "orange", color: "#e69f00", shape: "hexagon", light: true, label: "draw.color.orange" },
  { id: "sky", color: "#56b4e9", shape: "star", light: true, label: "draw.color.sky" },
  { id: "yellow", color: "#f0e442", shape: "cross", light: true, label: "draw.color.yellow" },
];

export const WIDTHS: readonly Width[] = [
  { id: "thin", value: 2, label: "draw.width.thin" },
  { id: "medium", value: 4, label: "draw.width.medium" },
  { id: "thick", value: 8, label: "draw.width.thick" },
];

/// Gli spessori dell'evidenziatore, con gli stessi nomi: un segno che copre
/// una riga di testo, da una sottile a una da titolo.
export const HIGHLIGHTER_WIDTHS: readonly Width[] = [
  { id: "thin", value: 8, label: "draw.width.thin" },
  { id: "medium", value: 16, label: "draw.width.medium" },
  { id: "thick", value: 24, label: "draw.width.thick" },
];

/// Il colore e lo spessore di partenza: Nero e Medio, quelli dell'esempio del
/// formato.
export const DEFAULT_COLOR = "#000000";
export const DEFAULT_WIDTH = 4;

/// L'evidenziatore parte giallo e medio; la sua opacità è quella del formato.
export const HIGHLIGHTER_COLOR = "#f0e442";
export const HIGHLIGHTER_WIDTH = 16;
export const HIGHLIGHTER_OPACITY = "0.4";

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
