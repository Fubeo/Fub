// Che cosa resta com'è nel disegno, detto prima di toccarlo (K5): il chip
// «N parti restano come sono» accanto al percorso e il suo riquadro, con
// «Che cosa manca?» e un «Vai» per parte. La shell li disegna
// (`panels/standing.ts`); qui si decide che cosa dicono, come fa
// `editors/rich/standing.ts` per i documenti.
//
// - **Le parti sono del motore.** Quelle che `DrawingOpen` ha detto
//   all'apertura e quelle che gli esiti hanno trovato dopo
//   (`MotoreDelDisegno.perdite()`), una per elemento: l'id, o il tag col
//   percorso (`rect[2/0]`) per un elemento senza id.
// - **Una parte, un posto.** Il posto dice l'elemento e il perché (il
//   `detail` del motore); il suo «Vai» sceglie l'oggetto che lo contiene e lo
//   porta in vista. Una parte dentro `<defs>` o un titolo non si vedono sul
//   foglio: il posto c'è, senza «Vai». Un elemento che non è più nella scena
//   (cancellato) perde il suo posto, e il numero lo segue.
// - **Senza motore non si sa.** Col motore spento, fermo o che si sta
//   aprendo le parti non si conoscono: niente chip da qui (quello del motore
//   spento o fermo è un altro). Niente chip nemmeno senza parti, né su un
//   disegno che il motore non modifica affatto (una parte `unsupported`: la
//   sola lettura, un SVG di un altro programma), né quando il disegno non si
//   modifica qui (in Lettura, in sola lettura): lì parla l'avviso della
//   superficie.

import type { DrawingLoss } from "../../../host/contract";
import type { Teardown } from "../../../ui/lifetime";
import type { SurfaceStanding, SurfaceStandingPlace, SurfaceStandingState } from "../../core/registry";
import type { ElementItem, Item } from "../scene/classify";
import { plural, t } from "../strings";
import type { MotoreDelDisegno } from "./gesti";

/// Ciò che il chip legge dalla superficie del disegno.
export interface DrawStandingSource {
  /// Il motore del disegno, se il disegno ne ha uno.
  motore(): MotoreDelDisegno | null;
  /// La scena che si modifica adesso, in ordine di documento; `null` se il
  /// disegno qui non si modifica (in Lettura, in sola lettura, estraneo,
  /// senza editor). Lo stesso array finché la scena non cambia.
  scene(): readonly Item[] | null;
  /// Sceglie l'oggetto che contiene il byte `offset` del file e lo porta in
  /// vista (`DrawEditor.reveal`).
  reveal(offset: number): boolean;
}

/// Il chip del disegno: chi lo crea avvisa con `changed()` quando la scena,
/// il modo, la scrittura o il motore possono essere cambiati.
export interface DrawStanding extends SurfaceStanding {
  changed(): void;
  dispose(): void;
}

/// Il nome di un elemento come lo scrive il motore nelle sue parti: l'id, o
/// il tag col percorso (`nome` di `fub-disegno/src/perdite.rs`).
export function lossName(item: ElementItem): string {
  return item.id !== null && item.id !== "" ? item.id : `${item.tag}[${item.path.join("/")}]`;
}

/// Gli elementi che non si vedono sul foglio: un «Vai» non li troverebbe.
const UNSEEN_ROLES: ReadonlySet<string> = new Set(["defs", "resource", "title", "desc"]);

/// Gli elementi della scena per nome, e quali stanno fuori dal foglio.
interface SceneNames {
  readonly items: ReadonlyMap<string, ElementItem>;
  readonly unseen: ReadonlySet<string>;
}

function namesOf(scene: readonly Item[]): SceneNames {
  const items = new Map<string, ElementItem>();
  const unseen = new Set<string>();
  /// I percorsi delle `defs`, come testo: chi ci sta dentro non si vede.
  const hidden: string[] = [];
  for (const item of scene) {
    if (item.kind !== "element") continue;
    const name = lossName(item);
    if (!items.has(name)) items.set(name, item);
    const path = item.path.join("/");
    const inside = hidden.some((prefix) => path.startsWith(`${prefix}/`));
    if (inside || UNSEEN_ROLES.has(item.role)) unseen.add(name);
    if (item.role === "defs" || item.tag === "defs") hidden.push(path);
  }
  return { items, unseen };
}

/// Lo stato del chip per le parti `losses` sulla scena `scene`; `null` se
/// non c'è niente da dire. `go` sceglie l'elemento di nome `name`.
export function drawStandingState(losses: readonly DrawingLoss[], scene: readonly Item[], go: (name: string) => void): SurfaceStandingState | null {
  if (losses.length === 0 || losses.some((loss) => loss.kind === "unsupported")) return null;
  const names = namesOf(scene);
  const places: SurfaceStandingPlace[] = [];
  for (const loss of losses) {
    // Un elemento che non c'è più non resta in nessun posto.
    if (!names.items.has(loss.element)) continue;
    const label = t("draw.standing.place", { name: loss.element, detail: loss.detail });
    places.push(names.unseen.has(loss.element) ? { label } : { label, run: () => go(loss.element) });
  }
  const count = places.length;
  if (count === 0) return null;
  return {
    kind: "closed",
    text: plural(count, "draw.standing.lost.one", "draw.standing.lost", { count }),
    title: plural(count, "draw.standing.lost.title.one", "draw.standing.lost.title", { count }),
    body: t("draw.standing.lost.body"),
    source: t("draw.standing.lost.source"),
    places,
    placesAsk: t("draw.standing.missing"),
    actions: [],
    recording: false,
  };
}

/// Il chip del disegno di `source`.
export function drawStanding(source: DrawStandingSource): DrawStanding {
  const listeners = new Set<() => void>();
  /// L'ultimo stato, finché parti, scena e lingua sono le stesse.
  let memo: { readonly losses: readonly DrawingLoss[]; readonly scene: readonly Item[]; readonly said: string; readonly state: SurfaceStandingState | null } | null = null;
  let disposed = false;

  /// «Vai»: l'elemento cercato nella scena di adesso, che dal disegno del
  /// riquadro può essere cambiata.
  const go = (name: string): void => {
    const scene = source.scene();
    if (scene === null) return;
    const item = namesOf(scene).items.get(name);
    if (item !== undefined) source.reveal(item.bytes[0]);
  };

  const current = (): SurfaceStandingState | null => {
    if (disposed) return null;
    const losses = source.motore()?.perdite() ?? null;
    const scene = losses === null ? null : source.scene();
    if (losses === null || scene === null) return null;
    // La lingua cambia le parole, non le parti.
    const said = t("draw.standing.missing");
    if (memo === null || memo.losses !== losses || memo.scene !== scene || memo.said !== said) {
      memo = { losses, scene, said, state: drawStandingState(losses, scene, go) };
    }
    return memo.state;
  };

  return {
    current,
    subscribe(listener): Teardown {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    changed() {
      if (disposed) return;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.error(error);
        }
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
      memo = null;
    },
  };
}
