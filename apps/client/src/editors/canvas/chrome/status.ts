// La banda di stato della lavagna (T52): sotto la lavagna, nella banda della
// shell, lo zoom (un clic apre 50%, 100%, 200%, Mostra tutta la lavagna,
// Inquadra la selezione), le schede scelte, la sola lettura col perché e la
// cartella dove vanno i file trascinati (un clic apre le Impostazioni su
// `canvas.drop_folder`, la voce che «Cambia cartella» apre già, T34).
//
// Il modello è la banda del disegno (`editors/spatial/tools/editor/chrome/
// status.ts`): la tela tiene le voci, la superficie le dà alla shell
// (`EditorSurface.status`), e la shell le disegna solo quando la lavagna ha il
// fuoco. Le voci si leggono quando la shell le disegna; la tela le dice
// cambiate a fine gesto (`onStatusChange`), non a ogni fotogramma.
//
// Che cosa non c'è ancora: le copie della stessa nota (C14, T22: non c'è un
// modo per contarle sulla lavagna), e il modo della lavagna, che la shell dice
// già con le sue modalità.

import { settings } from "../../../host/query";
import { t } from "../../../i18n/strings";
import { folderForNote } from "../../../rules/mirrored";
import type { SurfaceStatusItem } from "../../core/registry";
import { DEFAULT_ATTACHMENT_FOLDER } from "../../media/attachment-target";
import { dropFolderFor, type DropFolderChoice } from "../../../state/canvas-intake";
import { DROP_FOLDER_KEY } from "../preferences";
import { showContextMenu, type MenuItem, type MenuPoint } from "../../../ui/menu";

/// La cartella degli allegati delle note: la lavagna la segue quando
/// `canvas.drop_folder` vale «notes» (o non è ancora arrivato).
export const ATTACHMENT_FOLDER_KEY = "files.attachment-folder";

/// La voce che «Cambia cartella» e la banda aprono (T34).
export const BAND_FOLDER_KEY = DROP_FOLDER_KEY;

/// Le misure dello zoom del menu, in percentuale: 100 è 1:1.
export const CANVAS_ZOOM_PRESETS: readonly number[] = [50, 100, 200];

/// Un comando del catalogo come la banda lo mostra nel suo menu.
export interface CanvasStatusCommand {
  readonly label: string;
  readonly hint: string;
  /// Perché adesso non si può, o `null`.
  readonly disabled: string | null;
  run(): void;
}

/// Ciò che la banda legge della lavagna e ciò che la banda può chiedere.
export interface CanvasStatusPort {
  /// Lo zoom in percentuale intera.
  zoomPercent(): number;
  /// Quante schede sono scelte adesso.
  chosenCount(): number;
  /// Il nome della scheda in cui si scrive adesso (T41), o `null`; assente,
  /// non si scrive mai.
  writing?(): string | null;
  /// Perché la lavagna non si cambia adesso, o `null` se si cambia.
  readOnlyWhy(): string | null;
  /// La cartella dove vanno i file trascinati adesso.
  folder(): string;
  /// Lo zoom assoluto, al centro della vista.
  zoomTo(zoom: number): void;
  /// Un comando del catalogo per id, o `null` se la lavagna non lo conosce.
  command(id: string): CanvasStatusCommand | null;
  /// Il punto della finestra dove si apre il menu dello zoom.
  zoomMenuAt(): MenuPoint;
  /// Apre le Impostazioni su una voce; assente se non c'è un modo per farlo.
  openSettings?: (key: string) => void;
}

/// La cartella degli allegati delle note come la scrive l'impostazione, o `null`
/// se non è un testo: il deposito fa lo stesso (`document-controller`).
export async function readAttachmentFolder(): Promise<string | null> {
  const entry = (await settings()).find((item) => item.spec.key === ATTACHMENT_FOLDER_KEY);
  return typeof entry?.value === "string" ? entry.value : null;
}

/// La cartella dove vanno i file trascinati nella lavagna `documentId`, con la
/// regola del deposito: `dropFolderFor` di T34 sceglie fra la cartella delle
/// note (`declared`), accanto alla lavagna e dalla radice; `folderForNote` la
/// risolve come fa `depositAttachment`. `choice` `null` (non ancora letta) vale
/// «notes», il valore di serie.
export function dropFolderOf(declared: string | null, choice: DropFolderChoice | null, documentId: string): string {
  const notes = declared ?? DEFAULT_ATTACHMENT_FOLDER;
  const folder = choice === null ? notes : dropFolderFor(choice, documentId, notes);
  return folderForNote(folder, documentId);
}

/// Le voci della banda adesso, nell'ordine in cui la shell le mette.
export function canvasStatusItems(port: CanvasStatusPort): SurfaceStatusItem[] {
  const items: SurfaceStatusItem[] = [];
  const percent = port.zoomPercent();
  items.push({
    id: "zoom",
    text: `${percent}%`,
    hint: t("canvas.status.zoom", { n: percent }),
    open: () => openZoomMenu(port),
  });
  const chosen = port.chosenCount();
  // Mentre si scrive in una scheda la banda dice dove, al posto della scelta.
  const writing = port.writing?.() ?? null;
  if (writing !== null) items.push({ id: "writing", text: t("canvas.status.writing", { name: writing }) });
  else if (chosen === 1) items.push({ id: "chosen", text: t("canvas.status.chosen.one") });
  else if (chosen > 1) items.push({ id: "chosen", text: t("canvas.status.chosen", { n: chosen }) });
  const why = port.readOnlyWhy();
  if (why !== null) items.push({ id: "readonly", text: t("canvas.status.readonly"), hint: why });
  const folder = port.folder();
  const openSettings = port.openSettings;
  if (openSettings) {
    items.push({
      id: "folder",
      text: folder,
      hint: t("canvas.status.folder.open", { folder }),
      open: () => openSettings(BAND_FOLDER_KEY),
    });
  } else {
    items.push({ id: "folder", text: folder, hint: t("canvas.status.folder", { folder }) });
  }
  return items;
}

/// Il menu dello zoom: le misure, poi «Mostra tutta la lavagna» e «Inquadra la
/// selezione» coi loro comandi (i tasti e il perché, se spenti, sono i loro).
export function openZoomMenu(port: CanvasStatusPort): void {
  const current = port.zoomPercent();
  const items: MenuItem[] = CANVAS_ZOOM_PRESETS.map((percent): MenuItem => ({
    label: t("canvas.zoom.preset", { n: percent }),
    choice: "radio",
    checked: percent === current,
    run: () => port.zoomTo(percent / 100),
  }));
  for (const id of ["canvas.fit", "canvas.fit_selection"]) {
    const command = port.command(id);
    if (command === null) continue;
    items.push({
      label: command.label,
      hint: command.hint || undefined,
      description: command.disabled ?? undefined,
      disabled: command.disabled !== null,
      separator: id === "canvas.fit",
      run: () => command.run(),
    });
  }
  showContextMenu(port.zoomMenuAt(), items, { label: t("canvas.status.zoom.menu") });
}

/// Una firma delle voci: la tela avvisa la banda solo quando cambia.
export function statusSignature(items: readonly SurfaceStatusItem[]): string {
  return items.map((item) => `${item.id}\u0000${item.text}\u0000${item.hint ?? ""}`).join("\u0001");
}
