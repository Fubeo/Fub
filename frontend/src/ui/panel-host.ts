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
import type { EventMask, KernelEvent, KernelNotice, ViewSpec } from "../host/contract";
import { maskWants } from "../rules/mirrored";
import { onAnyEvent, onEvent } from "../state/kernel";
import { on } from "../state/store";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";

export type EventType = KernelEvent["type"];

/// Una maschera sulle sole specie: nessun filtro di topic, di soggetto, né di
/// cosa è cambiato.
///
/// È `EventMask::of` scritta di qua, e serve ai pannelli **nativi** — che sono
/// di questa shell e guardano tutto il vault. Una view dichiarata non passa da
/// qui: la sua maschera arriva dal provider, e può essere più stretta di così
/// (§10.1).
export function refreshOn(...kinds: EventType[]): EventMask {
  return { kinds, topics: [], subjects: [], changes: [] };
}

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
  /// Come si chiama, **nell'inventario**.
  ///
  /// È l'unica stringa della shell che non passa dal catalogo (§12.4), e non
  /// per dimenticanza: `registeredPanels()` non ha ancora un lettore — è il
  /// pezzetto di §7.6 che riguarda la shell, e nessuna superficie lo mostra.
  /// Tradurla oggi vorrebbe dire risolverla **al montaggio**, cioè congelarla
  /// nella lingua di quel momento: un nome che non si vede e che, il giorno che
  /// si vedesse, sarebbe già quello sbagliato. Il giorno che l'inventario avrà
  /// una superficie, questo campo diventa una `Chiave` e la risolve chi
  /// disegna — che è dove la 0040 mette la risoluzione anche per le view
  /// dichiarate.
  readonly title: string;
  readonly placement: PanelPlacement;
  /// Gli eventi al cui arrivo questo pannello è invecchiato: la **maschera del
  /// contratto**, non un elenco di specie (§10.1).
  ///
  /// Che sia la stessa forma non è simmetria: `ViewSpec.refresh` arriva di qui
  /// così com'è, e una view dichiarata può restringere per topic e per soggetto.
  /// Se questa fosse rimasta una lista di specie, la shell avrebbe **ignorato**
  /// quelle due restrizioni — cioè avrebbe ridisegnato di più di quanto il
  /// provider ha chiesto, che è la stessa promessa mancata del §10.1 vista dal
  /// lato che disegna. I pannelli nativi la scrivono con [`refreshOn`].
  ///
  /// `overflow` **non va dichiarato**: non è un fatto del dominio, è la coda
  /// troncata — ci pensa l'host, riconciliando tutti da zero.
  readonly refresh: EventMask;
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
    console.error(`Fub: ${t("panel.render_failed", { panel: id, reason: errorText(e) })}`);
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
      // La regola è quella del contratto (`rules/mirrored.ts`, gemella di
      // `fub_abi::rules::events::mask_wants`), non un `includes` scritto qui:
      // due letture della stessa maschera sarebbero un pannello che si ridisegna
      // quando il provider aveva chiesto di no, e non lo direbbe nessun test.
      if (maskWants(panel.refresh, n.event)) void refreshPanel(panel.id, n);
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
