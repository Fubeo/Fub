// Scaldare il motore di un formato prima che il documento si apra.
//
// I fogli e i documenti di Word hanno un motore che l'host costruisce alla
// prima apertura: chiedergli di scaldarlo quando il puntatore si ferma su un
// file, o quando una cartella si apre, lo prepara prima del clic. È un
// suggerimento: l'host non fa niente se il tipo non ha motore o il componente
// è spento, e un errore non si dice a nessuno.
//
// Al più una chiamata per estensione finché il vault resta lo stesso: un
// motore acceso non si riscalda, e l'host non deve sentire una domanda a ogni
// passaggio del mouse.
import { formatKindOf, type FormatKind } from "../ui/format-kind";

/// Quanto il puntatore deve restare su un file prima di scaldare: abbastanza
/// per non scaldare a ogni riga attraversata scendendo nell'albero, poco
/// rispetto al tempo di un clic deciso.
export const WARM_HOVER_MS = 300;

/// Le specie con un motore nell'host: i documenti di videoscrittura e le
/// cartelle di Excel.
const WITH_ENGINE: ReadonlySet<FormatKind> = new Set(["word", "odt", "sheet"]);

/// L'estensione di un file con motore, minuscola e senza punto.
export function engineExtension(id: string): string | null {
  const kind = formatKindOf(id);
  if (kind === null || !WITH_ENGINE.has(kind)) return null;
  const base = id.split("#")[0]!.split("/").pop() ?? "";
  return base.slice(base.lastIndexOf(".") + 1).toLowerCase();
}

export interface EngineWarmup {
  /// Il puntatore è entrato sulla riga di questo file.
  hover(id: string): void;
  /// Il puntatore è uscito prima del ritardo: non si scalda.
  leave(): void;
  /// Una cartella si è aperta con questi figli: si scalda ogni estensione con
  /// motore, una volta ciascuna.
  folder(children: readonly string[]): void;
  /// Il vault è cambiato: le estensioni già scaldate si dimenticano.
  reset(): void;
  /// Il timer si ferma e niente parte più.
  dispose(): void;
}

export function engineWarmup(warm: (extension: string) => Promise<void>, delay = WARM_HOVER_MS): EngineWarmup {
  const warmed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function cancel(): void {
    clearTimeout(timer);
    timer = undefined;
  }

  function now(extension: string): void {
    if (disposed || warmed.has(extension)) return;
    warmed.add(extension);
    void warm(extension).catch(() => {});
  }

  return {
    hover(id) {
      cancel();
      const extension = engineExtension(id);
      if (extension === null || warmed.has(extension) || disposed) return;
      timer = setTimeout(() => {
        timer = undefined;
        now(extension);
      }, delay);
    },
    leave: cancel,
    folder(children) {
      for (const child of children) {
        const extension = engineExtension(child);
        if (extension !== null) now(extension);
      }
    },
    reset() {
      cancel();
      warmed.clear();
    },
    dispose() {
      cancel();
      disposed = true;
    },
  };
}
