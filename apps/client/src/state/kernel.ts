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
import { errorText } from "../host/errors";
import { notify } from "../ui/notify";
import { t } from "../i18n/strings";

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
type TypedRegistration = { handler: AnyHandler };
type AnyRegistration = { handler: (n: KernelNotice) => void };

const forType = new Map<EventType, TypedRegistration[]>();
const forAny: AnyRegistration[] = [];

/// Iscrive un ascoltatore a **un** tipo di evento e restituisce il suo
/// smontaggio.
export function onEvent<T extends EventType>(
  type: T,
  handler: TypedHandler<T>,
): () => void {
  const registration: TypedRegistration = {
    handler: handler as unknown as AnyHandler,
  };
  const list = forType.get(type);
  if (list) list.push(registration);
  else forType.set(type, [registration]);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const current = forType.get(type);
    if (!current) return;
    const index = current.indexOf(registration);
    if (index < 0) return;
    current.splice(index, 1);
    if (current.length === 0) forType.delete(type);
  };
}

/// Iscrive un ascoltatore a **tutti** gli eventi e restituisce il suo
/// smontaggio.
///
/// Serve a chi reagisce per **maschera dichiarata** invece che per tipo noto:
/// l'host dei pannelli (`ui/panel-host.ts`) invoca chi ha dichiarato interesse
/// per quell'evento, e l'elenco dei tipi non lo conosce questa shell — per una
/// view del protocollo lo porta il `ViewSpec` a runtime. È l'unico caso
/// legittimo; un pannello che si iscrive qui per comodità sta ricostruendo il
/// vecchio smistatore.
export function onAnyEvent(handler: (n: KernelNotice) => void): () => void {
  const registration: AnyRegistration = { handler };
  forAny.push(registration);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const index = forAny.indexOf(registration);
    if (index >= 0) forAny.splice(index, 1);
  };
}

function dispatchNotice(n: KernelNotice): void {
  // Prima i generici, poi i tipizzati. L'ordine conta per un motivo solo, ma
  // vero: le view dichiarative si ridisegnano da `refresh` qualunque sia
  for (const { handler } of forAny) invokeHandler(() => handler(n));
  for (const { handler } of forType.get(n.event.type) ?? []) {
    invokeHandler(() => handler(n.event, n.origin));
  }
}

/// Un ascoltatore che sbaglia non deve zittire gli altri: sarebbe metà finestra
/// ferma senza che nulla lo dica, il difetto che il §20.3 chiama «esito buttato
/// via». Qui l'esito si nomina e si prosegue.
function invokeHandler(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    notify(t("kernel.listener_failed", { reason: errorText(e) }), "guasto");
  }
}

/// Attacca il router al canale del kernel. Da invocare una volta sola, dal
/// punto di montaggio.
export function startKernelRouter(): Promise<() => void> {
  return onKernelEvent(dispatchNotice);
}

/// Consegna al router un notice arrivato **per tiraggio** (l'avviso di
/// sessione, §25.5) invece che dal canale.
///
/// La diagnosi «la cartella di configurazione non si può scrivere» nasce
/// all'avvio del backend, quando nessun ascoltatore esiste ancora: una spinta
/// sarebbe persa, e la shell la tira appena il router è in piedi. Un notice
/// tirato è un notice come gli altri — passa da `dispatchNotice` perché ogni
/// ascoltatore lo veda, e l'unica alternativa sarebbe un secondo canale per i
/// guasti, che è esattamente ciò che questo router esiste per non avere.
export function forwardNotice(n: KernelNotice): void {
  dispatchNotice(n);
}
