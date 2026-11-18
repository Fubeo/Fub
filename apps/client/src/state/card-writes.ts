// La parte della porta delle schede (N6 T40) che c'è dall'avvio: le schede
// della lavagna che scrivono adesso, l'unica strada per lasciare una sessione
// fuori dal controllore (T96) e la porta che arriva al primo uso.
//
// Sta fuori da `editors/core/cards/editor-port.ts` perché la usano la disposizione dei
// riquadri, il ponte dei documenti e il controllore, che le finestre caricano
// all'avvio, mentre la porta arriva con un `import()` quando una lavagna ci
// scrive: così non pesa sull'avvio (`NOT_AT_STARTUP` in `vite.config.ts`).

import type { CardEditorHub } from "../editors/core/cards/editor-port";
import { documentSessions, type CloseResult, type DocumentSessionCollection } from "./document-session";

/// Ciò che la porta pigra usa della finestra mentre il modulo arriva.
export interface LazyCardEditorDeps {
  /// Le sessioni della finestra: `retain` le tiene, `release` le lascia.
  /// Si chiedono al primo uso: creare la porta non le legge ancora.
  sessions(): Pick<DocumentSessionCollection, "retain" | "release">;
  /// Se un riquadro mostra adesso il documento.
  shownInPane(path: string): boolean;
  /// Una sessione lasciata senza salvare: la domanda di un riquadro.
  unsaved?(path: string): Promise<void>;
}

/// La porta delle schede che nasce al primo uso: `load` porta il modulo della
/// porta (un `import()`) e dà chi la costruisce. Finché non c'è nessuna
/// scheda scrive, e le domande sincrone hanno la risposta di una porta vuota.
///
/// Un'apertura prende subito la sessione (`retain`), come faceva la porta
/// vera prima del suo primo `await`: un riquadro che si chiude mentre il
/// modulo arriva non la chiude sotto la scheda. La lascia quando la porta vera
/// ha risposto: con un editor la tiene lui; con `null` o un rifiuto la
/// sessione, se nessuno la guarda più, si lascia come la lascerebbe la porta.
/// Un'apertura partita prima di `destroyAll` (la shell se ne va) e ancora in
/// attesa del modulo dà `null` e non monta niente. Un modulo che non arriva
/// rifiuta l'apertura: il rifiuto arriva a chi apre e la scheda resta in
/// lettura (il browser ricorda l'`import()` fallito, e non lo riprova).
export function lazyCardEditorHub(load: () => Promise<() => CardEditorHub>, deps: LazyCardEditorDeps): CardEditorHub {
  let hub: CardEditorHub | null = null;
  let loading: Promise<() => CardEditorHub> | null = null;
  let epoch = 0;
  /// Le aperture in corso, per documento: anche loro guardano la sessione.
  const opening = new Map<string, number>();
  const ready = async (): Promise<CardEditorHub | null> => {
    const started = epoch;
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    const create = await loading;
    if (started !== epoch) return null;
    hub ??= create();
    return hub;
  };
  const watched = (path: string): boolean =>
    (opening.get(path) ?? 0) > 0 || deps.shownInPane(path) || (hub?.holds(path) ?? false);
  // Una sessione che nessuno guarda più si lascia; se non si salva, la domanda.
  const settle = async (path: string): Promise<void> => {
    if (watched(path)) return;
    const outcome = await releaseSession(path, deps.sessions());
    if (outcome.kind === "unsaved" && deps.unsaved && !watched(path)) await deps.unsaved(path);
  };
  const open: CardEditorHub["open"] = async (path, host, options) => {
    const release = deps.sessions().retain(path);
    opening.set(path, (opening.get(path) ?? 0) + 1);
    let editor: Awaited<ReturnType<CardEditorHub["open"]>> = null;
    try {
      const port = await ready();
      editor = port ? await port.open(path, host, options) : null;
      return editor;
    } finally {
      release();
      const left = (opening.get(path) ?? 1) - 1;
      if (left > 0) opening.set(path, left);
      else opening.delete(path);
      if (!editor) void settle(path).catch((error: unknown) => console.error(error));
    }
  };
  return {
    open,
    openText: async (host, text, options) => (await ready())?.openText(host, text, options) ?? null,
    written: (surfaceId, change) => hub?.written(surfaceId, change) ?? false,
    failed: (surfaceId, error) => hub?.failed(surfaceId, error) ?? false,
    holds: (path) => (opening.get(path) ?? 0) > 0 || (hub?.holds(path) ?? false),
    renamed: () => hub?.renamed(),
    refreshReadOnly: () => hub?.refreshReadOnly(),
    setTheme: (theme) => hub?.setTheme(theme),
    destroyAll: () => {
      epoch++;
      hub?.destroyAll();
    },
  };
}

/// Una scheda che scrive: basta la sua sessione, che segue le rinomine.
export interface CardWriter {
  readonly session: { readonly id: string };
}

/// Le schede che scrivono, di ogni porta della finestra.
const writing = new Set<CardWriter>();

/// Una scheda comincia a scrivere sulla sua sessione: fino a `cardStopped`,
/// `releaseSession` lascia aperta quella sessione.
export function cardWriting(writer: CardWriter): void {
  writing.add(writer);
}

/// La scheda non scrive più (smontata, o la porta se ne va).
export function cardStopped(writer: CardWriter): void {
  writing.delete(writer);
}

/// Se una scheda della lavagna scrive adesso nel documento `path`.
export function cardWrites(path: string): boolean {
  for (const writer of writing) if (writer.session.id === path) return true;
  return false;
}

/// Lascia la sessione di `path` per chi non la guarda più (un riquadro chiuso,
/// un layout nuovo, una finestra del documento che se ne va): se una scheda
/// ci scrive, la sessione resta (`active`) e la lascerà la scheda uscendo.
/// È l'unica strada per lasciare una sessione fuori da `document-controller.ts`
/// (T96).
export async function releaseSession(
  path: string,
  sessions: Pick<DocumentSessionCollection, "release"> = documentSessions,
): Promise<CloseResult> {
  if (cardWrites(path)) return { kind: "active" };
  return sessions.release(path);
}
