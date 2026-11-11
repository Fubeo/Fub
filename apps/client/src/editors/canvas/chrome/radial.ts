// Il menu radiale della lavagna (T63): lo stesso menu del disegno
// (`editors/spatial/tools/radial.ts`, `openRadial`), con le voci della
// lavagna. In alto Annulla, in basso Ripeti; a destra gli ultimi tre strumenti,
// il più recente in orizzontale (est), poi nord-est e sud-est; a sinistra,
// allo stesso modo, gli ultimi tre colori della penna. Nel mezzo lo strumento
// di adesso col colore della penna.
//
// Le voci sono comandi del catalogo (`commands.ts`): il nome, il tasto e se si
// può vengono da lì. Gli strumenti e i colori recenti sono della seduta: li
// tiene la tela finché è aperta, e qui si leggono soltanto. Con meno di tre
// recenti il menu si riempie con quelli di riserva, sempre senza quello di
// adesso, che sta nel mezzo.
//
// Qui si costruiscono le voci; il menu lo apre e lo chiude `openRadial`, con
// l'aspetto del disegno così com'è.

import { t } from "../../../i18n/strings";
import { INK_PALETTE } from "../../../ink/palette";
import { openRadial, type Radial, type RadialItem, type RadialPointer } from "../../spatial/tools/radial";
import { inkColorName } from "../pen-menu";
import { commandHint, toolCommandId, type CanvasCommand, type CanvasToolId } from "./commands";
import { CANVAS_TOOL_ICONS } from "./rail";

/// Quanti strumenti e colori recenti la tela ricorda: i tre del menu più
/// quello di adesso, che il menu non mostra.
export const RADIAL_RECENT_MAX = 4;

/// Gli strumenti che il menu offre quando se ne sono usati meno di tre: prima
/// quelli che si alternano di più alla penna sulla lavagna.
export const RADIAL_FILL_TOOLS: readonly CanvasToolId[] = ["text", "select", "highlighter", "pen", "eraser", "hand", "lasso", "connect"];

/// I colori che il menu offre quando se ne sono usati meno di tre: la
/// tavolozza della penna, i colori più leggibili prima.
export const RADIAL_FILL_COLORS: readonly string[] = (() => {
  const first = ["vermilion", "green", "blue", "black"];
  const rank = (id: string): number => (first.includes(id) ? first.indexOf(id) : first.length);
  return [...INK_PALETTE].sort((a, b) => rank(a.id) - rank(b.id)).map((swatch) => swatch.color);
})();

/// `next` in testa alla lista dei recenti `list`, e dietro di lui `previous`
/// (quello che c'era prima, se la lista non lo ha ancora); senza doppioni, al
/// più [`RADIAL_RECENT_MAX`].
export function rememberRecent<T>(list: readonly T[], next: T, previous?: T): T[] {
  const all = previous === undefined ? [next, ...list] : [next, previous, ...list];
  return all.filter((each, at) => all.indexOf(each) === at).slice(0, RADIAL_RECENT_MAX);
}

/// Le tre voci di una lista del menu: le recenti che valgono, poi quelle di
/// riserva, senza quella di adesso. Un posto che resta vuoto è `undefined`.
export function threeOf<T>(recent: readonly T[], fill: readonly T[], now: T, valid: (each: T) => boolean): (T | undefined)[] {
  const out: T[] = [];
  for (const each of [...recent, ...fill]) {
    if (out.length === 3) break;
    if (each !== now && valid(each) && !out.includes(each)) out.push(each);
  }
  return [out[0], out[1], out[2]];
}

/// Ciò che il menu legge dalla tela quando si apre.
export interface CanvasRadialSource {
  /// Il comando `id` del catalogo, com'è adesso, o `null` se la tela non lo ha.
  command(id: string): CanvasCommand | null;
  /// Lo strumento di adesso e quelli scelti prima, il più recente in testa.
  readonly tool: CanvasToolId;
  readonly recentTools: readonly CanvasToolId[];
  /// Il colore della penna di adesso (`#rrggbb`) e quelli usati prima.
  readonly color: string;
  readonly recentColors: readonly string[];
  /// La lavagna non si può cambiare: Annulla e Ripeti sono spenti.
  readonly readOnly: boolean;
  /// Sceglie lo strumento, come dalla colonna.
  pickTool(tool: CanvasToolId): void;
  /// Dà alla penna il colore `color`.
  pickColor(color: string): void;
}

/// Il nome di una voce di colore: «Colore: Blu».
export function radialColorLabel(color: string): string {
  return t("canvas.radial.color", { name: inkColorName(color) });
}

/// Le otto voci del menu, dall'alto in senso orario (`DIRECTIONS`): Annulla,
/// il secondo strumento, il primo, il terzo, Ripeti, il terzo colore, il
/// primo, il secondo. `null` lascia vuoto un posto.
export function canvasRadialItems(source: CanvasRadialSource): (RadialItem | null)[] {
  const fromCatalog = (id: string, icon: string, off = false): RadialItem | null => {
    const command = source.command(id);
    if (command === null) return null;
    const hint = commandHint(command);
    return {
      label: command.label,
      icon,
      ...(hint === "" ? {} : { hint }),
      disabled: off || command.disabled() !== null,
      run: () => {
        if (command.disabled() === null) command.run();
      },
    };
  };
  const toolItem = (tool: CanvasToolId | undefined): RadialItem | null => {
    if (tool === undefined) return null;
    const item = fromCatalog(toolCommandId(tool), CANVAS_TOOL_ICONS[tool]);
    // Dal menu lo strumento si prende come dalla colonna: C con una scheda
    // scelta non comincia un filo.
    return item === null ? null : { ...item, run: () => source.pickTool(tool) };
  };
  const colorItem = (color: string | undefined): RadialItem | null =>
    color === undefined ? null : { label: radialColorLabel(color), swatch: { color }, run: () => source.pickColor(color) };
  const [tool1, tool2, tool3] = threeOf(source.recentTools, RADIAL_FILL_TOOLS, source.tool, (tool) => source.command(toolCommandId(tool)) !== null);
  const [color1, color2, color3] = threeOf(source.recentColors, RADIAL_FILL_COLORS, source.color, () => true);
  return [
    fromCatalog("canvas.undo", "draw-undo", source.readOnly),
    toolItem(tool2),
    toolItem(tool1),
    toolItem(tool3),
    fromCatalog("canvas.redo", "draw-redo", source.readOnly),
    colorItem(color3),
    colorItem(color1),
    colorItem(color2),
  ];
}

export interface CanvasRadialOptions {
  /// Il puntatore ancora giù che l'ha aperto: il menu lo segue.
  readonly held?: RadialPointer | null;
  /// Aperto dalla tastiera (Maiusc+F10 › «Menu radiale»).
  readonly keyboard?: boolean;
  /// Il menu si è chiuso, con una voce o senza.
  readonly onClose?: () => void;
}

/// Apre il menu radiale della lavagna in `x`, `y` sullo schermo; a un bordo
/// della finestra il menu si sposta dove si vede intero (`radialCenter`).
export function openCanvasRadial(x: number, y: number, source: CanvasRadialSource, options: CanvasRadialOptions = {}): Radial {
  return openRadial(x, y, canvasRadialItems(source), {
    label: t("canvas.radial"),
    center: { icon: CANVAS_TOOL_ICONS[source.tool], color: source.color },
    held: options.held ?? null,
    keyboard: options.keyboard === true,
    ...(options.onClose === undefined ? {} : { onClose: options.onClose }),
  });
}
