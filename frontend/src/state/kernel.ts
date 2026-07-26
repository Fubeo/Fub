// Il router degli eventi del kernel.
//
// Prima c'era una funzione sola — `handleKernelEvent` — che conosceva
// privatamente ogni pannello: la lista file, il cestino, la ricerca,
// l'anteprima, la cronologia, l'editor. Aggiungere un pannello significava
// tornare lì, e il §1.2 lo nomina come il sintomo principale del monolite.
//
// Qui l'evento non viene *smistato a mano*: chi ha interesse **dichiara quale
// evento gli interessa**, e chi arriva dopo non tocca questo file. La differenza
// pratica è che il router non importa nessun pannello — quindi non può
// diventare, con l'uso, il posto dove sta la logica di tutti.
import { onKernelEvent } from "../host/ipc";
import type { KernelEvent, KernelNotice, Origin } from "../host/contract";

type EventType = KernelEvent["type"];

/// Un ascoltatore riceve l'evento **già ristretto alla sua variante** (quindi
/// con i suoi campi, senza `if` di riconoscimento) e l'origine, che dice chi ha
/// chiesto l'operazione (decisione 0012) — è ciò che distingue «l'ha riscritta
/// un'altra applicazione» da «l'abbiamo riscritta noi».
type TypedHandler<T extends EventType> = (
  event: Extract<KernelEvent, { type: T }>,
  origin: Origin,
) => void;

/// Come il router li tiene: la restrizione alla variante è una promessa fatta a
/// chi si iscrive, non un'informazione che serva qui — al momento della
/// consegna il tipo è già stato usato per scegliere la lista.
type AnyHandler = (event: KernelEvent, origin: Origin) => void;

const perTipo = new Map<EventType, AnyHandler[]>();
const perQualsiasi: ((n: KernelNotice) => void)[] = [];

/// Iscrive un ascoltatore a **un** tipo di evento.
export function onEvent<T extends EventType>(type: T, handler: TypedHandler<T>): void {
  const largo = handler as unknown as AnyHandler;
  const lista = perTipo.get(type);
  if (lista) lista.push(largo);
  else perTipo.set(type, [largo]);
}

/// Iscrive un ascoltatore a **tutti** gli eventi.
///
/// Serve a chi reagisce per *maschera dichiarata* invece che per tipo noto:
/// l'host dei pannelli (`ui/panel-host.ts`) chiama chi ha dichiarato interesse
/// per quell'evento, e l'elenco dei tipi non lo conosce questa shell — per una
/// view del protocollo lo porta il `ViewSpec` a runtime. È l'unico caso
/// legittimo, e infatti l'unico chiamante: un pannello che si iscrive qui per
/// comodità sta ricostruendo il vecchio smistatore.
export function onAnyEvent(handler: (n: KernelNotice) => void): void {
  perQualsiasi.push(handler);
}

function consegna(n: KernelNotice): void {
  // Prima i generici, poi i tipizzati. L'ordine conta per un motivo solo, ma
  // vero: le view dichiarative si ridisegnano da `refresh` qualunque sia
  // l'evento, e farlo per primo evita che un pannello lento le ritardi.
  for (const handler of perQualsiasi) chiama(() => handler(n));
  for (const handler of perTipo.get(n.event.type) ?? []) {
    chiama(() => handler(n.event, n.origin));
  }
}

/// Un ascoltatore che sbaglia non deve zittire gli altri: sarebbe metà finestra
/// ferma senza che nulla lo dica, il difetto che il §20.3 chiama «l'esito
/// buttato via». Qui l'esito si nomina e si prosegue.
function chiama(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error(`FubMD: un ascoltatore di eventi del kernel ha lanciato: ${e}`);
  }
}

/// Attacca il router al canale del kernel. Da chiamare una volta sola, dal
/// punto di montaggio.
export function startKernelRouter(): Promise<() => void> {
  return onKernelEvent(consegna);
}
