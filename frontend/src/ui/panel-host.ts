// Il registro dei pannelli, e l'unico posto che decide **quando** uno si
// ridisegna.
//
// Il §1.2 chiede «un solo modo di montare un pannello», e la ragione non è
// l'ordine: finché convivono due modi, il secondo vince per pigrizia. I due
// erano questi — una view dichiarata dal backend si montava per **dato**
// (`ViewSpec`: id, titolo, placement, quando invecchia), mentre un pannello
// nativo si montava per **conoscenza privata**, iscrivendosi da sé agli eventi
// che riteneva suoi. Il secondo modo costa poco a scriverlo e si paga tre
// volte: la terna `index_updated`/`batch_ended`/`overflow` era copiata in
// explorer, ricerca e cestino, e chi ne avesse dimenticato un pezzo — è già
// successo con `batch_ended` (decisione 0011) — si ritrovava un pannello fermo
// senza che nulla lo dicesse.
//
// Qui il modo è uno: **un pannello dichiara chi è, dove sta e cosa lo fa
// invecchiare; l'host decide quando chiamarlo.** Una view dichiarata è un
// pannello il cui `render` chiede l'albero al provider (`ui/views.ts`); un
// pannello nativo è un pannello il cui `render` disegna da sé. Da qui in giù
// non c'è differenza, e il registro è anche l'unico elenco di quali superfici
// questa shell abbia davvero — il pezzetto di §7.6 che riguarda la shell.
//
// Cosa **non** è: un modello di layout. Dove un pannello sta lo dice
// `placement`, ma chi glielo ritaglia è ancora l'HTML per i nativi e
// `ui/views.ts` per le dichiarate. Tab, split e pane sono l'altra metà del
// §1.2, che è una feature (FEATURES 3.3) e non un refactor.
import type { KernelEvent, KernelNotice, ViewSpec } from "../host/contract";
import { onAnyEvent, onEvent } from "../state/kernel";
import { on } from "../state/store";

export type EventType = KernelEvent["type"];

/// Dove sta un pannello.
///
/// Le superfici del contratto (`ViewSurface`, dieci dal §2.2), più l'overlay che
/// esiste solo qui — il grafo, che è una superficie privilegiata decisa in M2 e
/// non un `UiNode`. Che l'alias sia questo e non un elenco scritto a mano è ciò
/// che ha reso il §2.2 una riga sola da questa parte: le sette superfici nuove
/// sono arrivate qui dal contratto, e a decidere quali questa shell sappia
/// davvero ospitare è `ui/views.ts`, in un punto solo.
export type PanelPlacement = ViewSpec["surface"] | "overlay";

export interface Panel {
  /// L'identità. Per una view dichiarata è l'id del provider; per un pannello
  /// nativo il prefisso `shell:` dice che il proprietario è questa shell — che
  /// è la regola di namespace del §7.4 applicata all'unico spazio di nomi che
  /// la shell possiede già.
  readonly id: string;
  readonly title: string;
  readonly placement: PanelPlacement;
  /// Gli eventi del kernel al cui arrivo questo pannello è invecchiato.
  ///
  /// `overflow` **non va dichiarato**: non è un fatto del dominio, è la coda
  /// troncata — ci pensa l'host, riconciliando tutti da zero.
  readonly refresh: readonly EventType[];
  /// Invecchia anche quando cambia il documento aperto?
  ///
  /// È il `follows` del contratto, ridotto all'unica parte di contesto che la
  /// shell sa produrre da sé. Per le view dichiarate la risposta la dà il
  /// kernel (segnale `stale-views`), che sa leggere `ViewSpec.follows`.
  readonly followsDoc?: boolean;
  /// C'è qualcuno che lo sta guardando?
  ///
  /// Un pannello nascosto non si ridisegna: era il `refreshIfOpen` che ogni
  /// pannello della sidebar si scriveva da sé. Chi non lo dichiara si ridisegna
  /// sempre — ed è giusto per l'explorer, che alimenta anche ciò che si vede
  /// mentre la sidebar mostra altro.
  readonly visible?: () => boolean;
  /// Disegnalo.
  ///
  /// `notice` è l'evento che lo ha invecchiato, quando è stato un evento.
  /// Riceverlo non è un ritorno alla conoscenza privata — è il motivo per cui
  /// il pannello si era dichiarato interessato: la cronologia si è iscritta a
  /// `document_changed` e ha diritto di sapere **quale** documento è cambiato,
  /// senza per questo doversi iscrivere al bus.
  render(notice?: KernelNotice): void | Promise<void>;
}

const registro = new Map<string, Panel>();

/// Mette un pannello nel registro. Un id già presente viene sostituito: è ciò
/// che serve a `mountDeclaredViews`, che riparte da zero a ogni vault aperto.
export function registerPanel(panel: Panel): void {
  registro.set(panel.id, panel);
}

export function unregisterPanel(id: string): void {
  registro.delete(id);
}

/// L'inventario di ciò che è montato, per chi deve mostrarlo o contarlo.
export function registeredPanels(): Panel[] {
  return [...registro.values()];
}

/// Ridisegna un pannello, se c'è e se qualcuno lo sta guardando.
///
/// Un pannello che lancia non deve zittire gli altri: sarebbe metà finestra
/// ferma senza che nulla lo dica, il difetto che il §20.3 chiama «l'esito
/// buttato via». Qui l'esito si nomina e si prosegue — e il §20.4 chiede una
/// superficie vera, che oggi non c'è.
export async function refreshPanel(id: string, notice?: KernelNotice): Promise<void> {
  const panel = registro.get(id);
  if (!panel) return;
  if (panel.visible && !panel.visible()) return;
  try {
    await panel.render(notice);
  } catch (e) {
    console.error(`FubMD: il pannello «${id}» non si è ridisegnato: ${e}`);
  }
}

/// Riconcilia tutto da zero.
export async function refreshAllPanels(): Promise<void> {
  await Promise.all([...registro.keys()].map((id) => refreshPanel(id)));
}

/// Attacca il registro ai due bus. Da chiamare una volta sola, dal punto di
/// montaggio, **prima** dei pannelli: l'ordine non conta per la consegna (il
/// registro si consulta all'arrivo dell'evento), ma tenerlo in testa dice che
/// l'host c'è già quando i pannelli si presentano.
export function mountPanelHost(): void {
  // L'unico ascoltatore "di tutto" della shell, ed è legittimo per la ragione
  // scritta in `state/kernel.ts`: decide per **dato** — la maschera che ogni
  // pannello ha dichiarato — e non per conoscenza privata di chi c'è.
  onAnyEvent((n) => {
    // `overflow` non passa di qui: ha una strada sua, sotto, perché non
    // ridisegna «chi è interessato» ma **tutti**.
    if (n.event.type === "overflow") return;
    for (const panel of registro.values()) {
      if (panel.refresh.includes(n.event.type)) void refreshPanel(panel.id, n);
    }
  });
  // Eventi persi (coda troncata): ciò che deriva dagli eventi si riconcilia da
  // zero, non si aggiorna.
  onEvent("overflow", () => void refreshAllPanels());
  // Il contesto di sessione è stato pubblicato e il kernel ha detto **quali**
  // view seguono ciò che è cambiato (`ViewSpec.follows`).
  on("stale-views", (ids) => {
    for (const id of ids) void refreshPanel(id);
  });
  // Il documento aperto è cambiato: invecchia chi lo segue.
  on("active-doc", () => {
    for (const panel of registro.values()) {
      if (panel.followsDoc) void refreshPanel(panel.id);
    }
  });
}
