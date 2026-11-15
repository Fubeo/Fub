// La parte della porta delle schede (N6 T40) che c'è dall'avvio: le schede
// della lavagna che scrivono adesso, l'unica strada per lasciare una sessione
// fuori dal controllore (T96) e la porta che arriva al primo uso.
//
// Sta fuori da `card-editors.ts` perché la usano la disposizione dei
// riquadri, il ponte dei documenti e il controllore, che le finestre caricano
// all'avvio, mentre la porta arriva con un `import()` quando una lavagna ci
// scrive: così non pesa sull'avvio (`NOT_AT_STARTUP` in `vite.config.ts`).

import type { CardEditorHub } from "./card-editors";
import { documentSessions, type CloseResult, type DocumentSessionCollection } from "./document-session";

/// La porta delle schede che nasce al primo uso: `load` porta il modulo della
/// porta (un `import()`) e dà chi la costruisce. Finché non c'è nessuna
/// scheda scrive, e le domande sincrone hanno la risposta di una porta vuota.
/// Un'apertura partita prima di `destroyAll` (la shell se ne va) e ancora in
/// attesa del modulo dà `null` e non monta niente; un caricamento fallito non
/// resta in memoria, e la prossima apertura riprova.
export function lazyCardEditorHub(load: () => Promise<() => CardEditorHub>): CardEditorHub {
  let hub: CardEditorHub | null = null;
  let loading: Promise<() => CardEditorHub> | null = null;
  let epoch = 0;
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
  return {
    open: async (path, host, options) => (await ready())?.open(path, host, options) ?? null,
    openText: async (host, text, options) => (await ready())?.openText(host, text, options) ?? null,
    written: (surfaceId, change) => hub?.written(surfaceId, change) ?? false,
    failed: (surfaceId, error) => hub?.failed(surfaceId, error) ?? false,
    holds: (path) => hub?.holds(path) ?? false,
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
