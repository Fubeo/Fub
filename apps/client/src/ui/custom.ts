// I `ns` che questa shell **sa disegnare**, e il modo di aggiungerne uno.
//
// `UiKind::Custom { ns, payload, fallback }` è il varco del protocollo
// dichiarativo: un componente manda un dato con un namespace suo, e chi disegna
// o lo riconosce o mostra il ripiego. Fino alla §3.3 questa shell non ne
// riconosceva **nessuno** — il ramo mancava, e il commento in `ui/node.ts`
// diceva che sarebbe arrivato «col suo primo cliente, cioè il giorno che il
// grafo smetterà di essere un pannello nativo».
//
// # Perché un registro e non un `if` dentro `node.ts`
//
// Perché il renderer del grafo è un force-directed su canvas: qualche centinaio
// di righe di simulazione che non hanno niente a che vedere con il disegno di un
// `UiNode`, e che dentro `node.ts` renderebbero il traduttore del protocollo il
// posto in cui vive la fisica delle molle. La stessa forma che
// `ui/panel-host.ts` ha dato ai pannelli vale qui: **chi sa disegnare qualcosa
// si dichiara**, e chi traduce l'albero cerca nel registro invece di conoscere
// per nome.
//
// Il guadagno si vede alla seconda voce, non a questa: la Suite (FEATURES 21.1)
// ha cinque moduli che vogliono un renderer proprio — canvas, database, grafici,
// mappe, form — e ognuno arriverà come una riga qui e un file accanto, senza
// toccare né il contratto né `node.ts`.
//
// # Il limite, che resta quello dichiarato
//
// Un renderer sta **in questo bundle**: registrarlo è codice della shell, non di
// un plugin. È l'asterisco di onestà di `../../../docs/architecture/frontend-and-ipc.md`, e
// questo registro lo circoscrive invece di toglierlo — un `ns` di terzi riceve
// il `fallback` finché la `WebView` non avrà asset story e CSP (M5). Ciò che è
// cambiato con la §3.3 è che il privilegio riguarda ormai solo i **pixel**: i
// dati del grafo passano dal canale di tutti.
import type { ActionRef, FieldValue } from "../host/contract";

/// Cosa può fare un nodo custom quando l'utente lo tocca: la stessa porta delle
/// azioni di ogni altro nodo, così un renderer non ha un canale suo verso il
/// provider.
export type OnAction = (action: ActionRef, fields: FieldValue[]) => void;

/// Chi sa disegnare un `ns`.
///
/// Riceve l'elemento in cui disegnare — già nel documento, già vuoto — il
/// `payload` così com'è arrivato dal provider, e la porta delle azioni.
/// Restituisce come **smontarsi**, o niente se non ha nulla da rilasciare: un
/// canvas con un `requestAnimationFrame` in volo che nessuno ferma è un ciclo
/// che continua a girare su un elemento tolto dal DOM.
export type CustomRenderer = (
  host: HTMLElement,
  payload: unknown,
  onAction: OnAction,
) => (() => void) | void;

const registry = new Map<string, CustomRenderer>();

/// Dichiara che questa shell sa disegnare `ns`.
///
/// Un `ns` già presente viene sostituito. Non serve a nessuno oggi — i renderer
/// si registrano una volta al montaggio — ed è la stessa scelta di
/// `registerPanel`: la mappa è un registro, e un registro che rifiuta la seconda
/// scrittura obbliga chi rimonta a ricordarsi di svuotarla.
export function registerCustomRenderer(ns: string, render: CustomRenderer): void {
  registry.set(ns, render);
}

export function customRenderer(ns: string): CustomRenderer | undefined {
  return registry.get(ns);
}

/// I `ns` che questa shell riconosce. Per chi deve mostrarli o contarli.
export function knownCustomNamespaces(): string[] {
  return [...registry.keys()];
}
