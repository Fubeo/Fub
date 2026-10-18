// Gli avvisi che il foglio tiene sopra il testo: fatti che riguardano **quella
// nota** e che chi scrive deve poter vedere finché contano, non un toast che
// passa. Il conflitto di salvataggio ha il suo banner (`drawConflict`); qui
// stanno gli altri, quelli che nessuna sessione può ricavare dal proprio stato:
// «è rientrata una bozza», «è cambiato su disco», «è stato ricaricato», e la
// modalità limitata dei componenti, che è del vault e non della nota.
//
// È solo memoria di ciò che il controllore ha visto, con un disegno che la
// legge: non decide niente e non tocca la sessione (R01–R04 intatti).
import type { Key } from "../i18n/strings";

/// Gli avvisi di una nota che si ricordano finché chi scrive non li chiude, o
/// finché il fatto non passa (un salvataggio riuscito li toglie).
export type SheetNoticeKind = "recovered" | "changed_on_disk" | "overwritten" | "reloaded";

export interface SheetNotice {
  readonly kind: SheetNoticeKind;
  /// La frase di dettaglio, se il fatto ne ha una sua (il caso di una bozza).
  readonly detail?: Key;
}

const byDoc = new Map<string, Map<SheetNoticeKind, SheetNotice>>();

export function addSheetNotice(doc: string, kind: SheetNoticeKind, detail?: Key): void {
  const own = byDoc.get(doc) ?? new Map<SheetNoticeKind, SheetNotice>();
  own.set(kind, detail ? { kind, detail } : { kind });
  byDoc.set(doc, own);
}

export function dismissSheetNotice(doc: string, kind: SheetNoticeKind): void {
  const own = byDoc.get(doc);
  if (!own) return;
  own.delete(kind);
  if (own.size === 0) byDoc.delete(doc);
}

export function sheetNoticesOf(doc: string): SheetNotice[] {
  return [...(byDoc.get(doc)?.values() ?? [])];
}

export function clearSheetNotices(doc: string): void {
  byDoc.delete(doc);
}

/// La nota cambia nome: i suoi avvisi la seguono.
export function moveSheetNotices(from: string, to: string): void {
  const own = byDoc.get(from);
  if (!own) return;
  byDoc.delete(from);
  byDoc.set(to, own);
}

let limited: { readonly reason?: string } | null = null;

/// La modalità limitata dei componenti, come l'host l'ha dichiarata l'ultima
/// volta che si è chiesto. `null` = non limitata (o non si sa).
export function setLimitedMode(info: { enabled: boolean; reason?: string } | null): void {
  limited = info?.enabled ? (info.reason ? { reason: info.reason } : {}) : null;
}

export function limitedMode(): { readonly reason?: string } | null {
  return limited;
}

/// Una nota rimossa da fuori mentre un riquadro la mostrava. La linguetta si
/// chiude, quindi l'avviso sta sul riquadro e non sulla nota: ci resta finché
/// chi scrive non lo chiude. Se c'era testo non salvato, `recreate` lo riscrive.
export interface RemovedNotice {
  readonly doc: string;
  readonly recreate?: () => Promise<void>;
}

const removedByPane = new Map<string, RemovedNotice>();

export function setRemovedNotice(pane: string, notice: RemovedNotice): void {
  removedByPane.set(pane, notice);
}

export function removedNoticeOf(pane: string): RemovedNotice | undefined {
  return removedByPane.get(pane);
}

export function clearRemovedNotice(pane: string): void {
  removedByPane.delete(pane);
}

export function clearAllRemovedNotices(): void {
  removedByPane.clear();
}
