// I colori delle schede e dei fili della lavagna (T47, D-13 c): una fonte sola
// per il menu della scheda, la riga delle opzioni, la ricerca dei comandi e il
// lettore di schermo.
//
// - **Che cosa c'è.** I sei colori di JSON Canvas (`"1"`…`"6"`, col loro nome);
//   i nove «Colori delle note», gli stessi dei Blocchi, scritti nel file come
//   esadecimali chiari fissi, così Obsidian li mostra esatti; e ogni altro
//   colore `#rrggbb` («Altro…»).
// - **Che cosa si scrive.** Il numero per i sei, l'esadecimale chiaro per i
//   nove, e per un colore scelto a mano `#rrggbb` minuscolo (`writeColor`).
// - **Che cosa si legge.** Tutto, com'è: `#ABC` o `#aabbccdd` restano scritti
//   così finché nessuno cambia il colore. Il valore si guarda soltanto: un
//   nove scritto in maiuscolo si riconosce, un colore che non è un colore
//   (`"7"`, `"rosso"`) si tiene e si disegna senza colore.
// - **Che aspetto ha** lo dice la pelle (`skin/editors.css`), non questo
//   modulo: il nodo porta `data-canvas-color` con la chiave del colore (`1`…`6`,
//   il nome di uno dei nove o `custom`) e, per un colore libero, la variabile
//   `--canvas-color` col suo valore, che è un dato del file. Al buio i nove
//   prendono le tinte scure dei Blocchi.

import { t, type Key } from "../../i18n/strings";

/// Il colore di JSON Canvas e di Fub: `#rgb`, `#rgba`, `#rrggbb` o
/// `#rrggbbaa`, come lo legge anche `CanvasColor::Hex` nel nucleo.
export const CANVAS_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/// I sei colori di JSON Canvas, nell'ordine del menu.
export const JSON_CANVAS_COLORS = ["1", "2", "3", "4", "5", "6"] as const;
export type JsonCanvasColor = (typeof JSON_CANVAS_COLORS)[number];

/// I nove «Colori delle note», nell'ordine dei Blocchi, col valore chiaro
/// che si scrive nel file.
export const NOTE_COLORS = [
  { id: "gray", hex: "#5e626b" },
  { id: "brown", hex: "#84573e" },
  { id: "orange", hex: "#984b00" },
  { id: "yellow", hex: "#795f00" },
  { id: "green", hex: "#007231" },
  { id: "blue", hex: "#0064b0" },
  { id: "purple", hex: "#7847a6" },
  { id: "pink", hex: "#9e366f" },
  { id: "red", hex: "#b7191c" },
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number]["id"];

/// Le scelte del menu dei colori, che sono anche i comandi
/// `canvas.color.<scelta>`: nessun colore, i sei, i nove, «Altro…».
export const CANVAS_COLOR_CHOICES = ["none", ...JSON_CANVAS_COLORS, ...NOTE_COLORS.map((color) => color.id), "other"] as const;
export type CanvasColorChoice = (typeof CANVAS_COLOR_CHOICES)[number];

/// La chiave dell'aspetto: uno dei sei, uno dei nove, o un colore libero.
export type CanvasColorKey = JsonCanvasColor | NoteColor | "custom";

/// Come si disegna un colore letto: la chiave per `data-canvas-color` e, per
/// un colore libero, il valore per `--canvas-color`, com'è nel file.
export interface CanvasColorLook {
  readonly key: CanvasColorKey;
  readonly custom: string | null;
}

const isJson = (value: string): value is JsonCanvasColor => (JSON_CANVAS_COLORS as readonly string[]).includes(value);

/// Uno dei nove, dal suo esadecimale scritto in qualunque maiuscola.
function noteOf(value: string): NoteColor | null {
  const lower = value.toLowerCase();
  return NOTE_COLORS.find((color) => color.hex === lower)?.id ?? null;
}

/// Come si disegna il colore `value`; `null` senza colore, o per un valore che
/// non è un colore (`"7"`, `"rosso"`), che resta nel file ma non si vede.
export function colorLook(value: string | undefined): CanvasColorLook | null {
  if (!value) return null;
  if (isJson(value)) return { key: value, custom: null };
  if (!CANVAS_COLOR.test(value)) return null;
  const note = noteOf(value);
  return note ? { key: note, custom: null } : { key: "custom", custom: value };
}

/// La scelta del menu che il colore `value` segna: `none` senza colore,
/// `other` per un colore libero, `null` per un valore che non è un colore.
export function colorChoiceOf(value: string | undefined): CanvasColorChoice | null {
  if (!value) return "none";
  const look = colorLook(value);
  if (!look) return null;
  return look.key === "custom" ? "other" : look.key;
}

/// Il valore da scrivere per la scelta `choice`: `undefined` per nessun
/// colore; `null` per «Altro…», che lo chiede al selettore.
export function colorValueOf(choice: CanvasColorChoice): string | undefined | null {
  if (choice === "none") return undefined;
  if (choice === "other") return null;
  if (isJson(choice)) return choice;
  return NOTE_COLORS.find((color) => color.id === choice)!.hex;
}

/// Un colore scelto a mano come si scrive: `#rrggbb` minuscolo, con le due
/// cifre dell'opacità solo se non è pieno; `null` se non è un colore.
export function writeColor(text: string): string | null {
  const value = text.trim();
  if (!CANVAS_COLOR.test(value)) return null;
  const digits = value.slice(1).toLowerCase();
  const long = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return long.length === 8 && long.endsWith("ff") ? `#${long.slice(0, 6)}` : `#${long}`;
}

/// Il nome della scelta nel menu: «Nessuno», «Rosso», «Blu», «Altro…».
export function colorMenuLabel(choice: CanvasColorChoice): string {
  return t(`canvas_menu.color.${choice}` satisfies Key);
}

/// Il nome del comando della scelta nella ricerca dei comandi, dove non c'è il
/// sottomenu a dire di che cosa si parla: «Nessun colore», «Rosso delle note».
export function colorCommandLabel(choice: CanvasColorChoice): Key {
  if (choice === "none") return "canvas.color.command.none";
  if (choice === "other") return "canvas.color.command.other";
  if (isJson(choice)) return `canvas_menu.color.${choice}`;
  return `canvas.color.command.${choice}`;
}

/// Il nome del colore `value` per chi ascolta e per il pozzo della riga:
/// «Predefinito» senza colore, il nome dei sei e dei nove («Rosso delle note»,
/// perché il Rosso dei sei è un altro), il codice minuscolo per un colore
/// libero, il valore com'è per uno che non è un colore.
export function colorName(value: string | undefined): string {
  if (!value) return t("canvas.default");
  const look = colorLook(value);
  if (!look) return value;
  if (look.key === "custom") return value.toLowerCase();
  return t(colorCommandLabel(look.key));
}
