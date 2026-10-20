// I collegamenti `fub://` che il sistema apre: dal browser, dal clipper, da
// un'altra app.
//
// La coda è dell'host (`uri.pending`), che li tiene anche quando arrivano a
// freddo, prima che questa finestra esista; l'evento `fub://pending-action` è
// il campanello. La shell la prende all'avvio e a ogni campanello, e la
// svuota un collegamento alla volta.
//
// Nessun collegamento scrive da solo. Aprire una nota e cercare non scrivono, e
// si eseguono; creare una nota, la giornaliera o una cattura passano da una
// conferma che dice che cosa nascerà (la prova di `uri.apply`), e scrivono
// soltanto dopo il sì — o subito, se l'utente ha messo quell'azione fra le
// consentite (`uri.allowed`, di macchina). Un collegamento che nomina un altro vault chiede prima
// di aprirlo. Un collegamento non valido, o con una callback, lo dice.
import { api } from "../host/ipc";
import type { CommandOutcome } from "../host/contract";
import { errorText, isErrorKind } from "../host/errors";
import { t } from "../i18n/strings";
import type { ConfirmOptions } from "../platform/confirm";
import type { Lifetime } from "./lifetime";

export const URI_APPLY = "uri.apply";
/// L'impostazione delle azioni che scrivono senza chiedere.
export const URI_ALLOWED = "uri.allowed";
/// Le azioni che scrivono, nell'ordine in cui il campo le mostra.
export const WRITING_ACTIONS = ["new", "daily", "unique", "capture"] as const;
export type WritingAction = (typeof WRITING_ACTIONS)[number];

/// Un collegamento come l'host lo descrive.
export interface IncomingLink {
  raw: string;
  /// Perché non vale, al posto di tutto il resto.
  error?: string;
  action?: "open" | "new" | "daily" | "unique" | "search" | "capture" | "choose-vault";
  writes?: boolean;
  vault?: { asked: string; root: string | null; current: boolean } | null;
  note?: string | null;
  heading?: string | null;
  block?: string | null;
  split?: string | null;
  window?: string | null;
  q?: string | null;
  tag?: string | null;
  folder?: string | null;
  title?: string | null;
  name?: string | null;
  date?: string | null;
  markdown?: string | null;
}

/// Dove si apre una nota di `fub://open`.
export type OpenPlace = "here" | "row" | "col" | "window";

export interface IncomingPorts {
  confirm(message: string, opts: ConfirmOptions): Promise<boolean>;
  notify(message: string, level: "info" | "guasto"): void;
  /// Apre il vault; `false` se non è diventato quello corrente.
  openVault(root: string): Promise<boolean>;
  /// Apre la nota al punto chiesto; `false` se non c'è.
  open(note: string, heading: string | null, block: string | null, place: OpenPlace): Promise<boolean>;
  search(query: string): void;
  /// Apre il selettore dei vault (`fub://choose-vault`).
  chooseVault(): void;
  /// Apre la nota che un collegamento ha appena scritto.
  show(doc: string): Promise<void>;
  /// Le azioni che scrivono senza chiedere (`uri.allowed`), lette a ogni
  /// collegamento: un cambio nelle impostazioni vale dal successivo.
  allowed(): Promise<readonly string[]>;
}

interface Pending {
  actions: IncomingLink[];
  refused: number;
}

/// Prende la coda dell'host. Un host senza la porta (un banco, un browser) non
/// ha collegamenti da dare: la coda è vuota, non un guasto.
async function take(): Promise<Pending> {
  let outcome: CommandOutcome;
  try {
    outcome = await api.takePendingUris();
  } catch (error) {
    if (isErrorKind(error, "unknown_command")) return { actions: [], refused: 0 };
    throw error;
  }
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== "fub.uri.pending") return { actions: [], refused: 0 };
  const payload = effect.payload as Partial<Pending> | null;
  return {
    actions: Array.isArray(payload?.actions) ? payload.actions : [],
    refused: typeof payload?.refused === "number" ? payload.refused : 0,
  };
}

/// Il `split` di un collegamento: «down» e i suoi sinonimi sotto, tutto il
/// resto a destra.
function placeOf(link: IncomingLink): OpenPlace {
  if (link.window) return "window";
  if (!link.split) return "here";
  return /^(down|below|bottom|col|vertical|sotto)$/i.test(link.split.trim()) ? "col" : "row";
}

/// La ricerca che `fub://search` chiede, nella sintassi della barra.
export function searchQuery(link: IncomingLink): string {
  const quote = (value: string) => (/[\s"()[\]]/.test(value) ? `"${value.replace(/"/g, "")}"` : value);
  return [
    link.q?.trim() ?? "",
    link.tag ? `tag:${quote(link.tag.replace(/^#/, ""))}` : "",
    link.folder ? `folder:${quote(link.folder)}` : "",
  ].filter(Boolean).join(" ");
}

/// Che cosa un collegamento che scrive chiede, in una riga per la conferma.
function asked(link: IncomingLink): string {
  switch (link.action) {
    case "capture":
      return t("incoming.ask.capture", { title: link.title ?? "" });
    case "daily":
      return link.date ? t("incoming.ask.daily_on", { date: link.date }) : t("incoming.ask.daily");
    case "unique":
      return t("incoming.ask.unique");
    default:
      return link.title || link.name
        ? t("incoming.ask.new_named", { name: link.title || link.name || "" })
        : t("incoming.ask.new");
  }
}

/// Le prime righe del testo di una cattura, perché chi approva veda che cosa
/// entra nel vault.
function excerpt(markdown: string | null | undefined): string {
  if (!markdown) return "";
  const text = markdown.trim();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export function mountIncomingLinks(life: Lifetime, ports: IncomingPorts): void {
  let running: Promise<void> | null = null;
  let again = false;

  async function handle(link: IncomingLink): Promise<void> {
    if (link.error !== undefined || !link.action) {
      ports.notify(t("incoming.invalid", { why: link.error ?? link.raw }), "guasto");
      return;
    }
    if (link.action === "choose-vault") {
      ports.chooseVault();
      return;
    }
    const vault = link.vault;
    if (vault && !vault.current) {
      if (!vault.root) {
        ports.notify(t("incoming.unknown_vault", { vault: vault.asked }), "guasto");
        return;
      }
      const yes = await ports.confirm(t("incoming.switch.message", { vault: vault.asked, link: link.raw }), {
        title: t("incoming.switch.title"),
        okLabel: t("incoming.switch.ok"),
      });
      if (!yes || life.closed) return;
      if (!(await ports.openVault(vault.root)) || life.closed) return;
    }
    if (link.action === "open") {
      if (!link.note) return;
      const found = await ports.open(link.note, link.heading ?? null, link.block ?? null, placeOf(link));
      if (!found) ports.notify(t("incoming.not_found", { note: link.note }), "guasto");
      return;
    }
    if (link.action === "search") {
      ports.search(searchQuery(link));
      return;
    }
    // Chi scrive: prima la prova, che dice quale nota nascerà, poi il sì —
    // tranne un'azione che l'utente ha consentito una volta per tutte.
    const trusted = (await ports.allowed()).includes(link.action);
    if (life.closed) return;
    if (!trusted) {
      const plan = await api.invokeCommand(URI_APPLY, { uri: link.raw }, "dry_run");
      const planned = plan.effect.kind === "plan" ? plan.effect.summary : "";
      const body = link.action === "capture" ? excerpt(link.markdown) : "";
      const message = [asked(link), planned, body].filter(Boolean).join("\n\n");
      const yes = await ports.confirm(message, {
        title: t("incoming.write.title"),
        okLabel: t("incoming.write.ok"),
      });
      if (!yes || life.closed) return;
    }
    const done = await api.invokeCommand(URI_APPLY, { uri: link.raw }, "apply");
    if (done.notify) ports.notify(done.notify, "info");
    if (done.effect.kind === "navigate") await ports.show(done.effect.doc);
  }

  async function drain(): Promise<void> {
    do {
      again = false;
      const pending = await take();
      if (pending.refused > 0) ports.notify(t("incoming.refused", { count: pending.refused }), "guasto");
      for (const link of pending.actions) {
        if (life.closed) return;
        try {
          await handle(link);
        } catch (error) {
          ports.notify(t("incoming.failed", { reason: errorText(error) }), "guasto");
        }
      }
    } while (again && !life.closed);
  }

  /// Un campanello mentre si svuota la coda non avvia un secondo giro in
  /// parallelo: quello in corso ne fa un altro alla fine.
  function ring(): void {
    if (life.closed) return;
    if (running) {
      again = true;
      return;
    }
    running = drain()
      .catch((error: unknown) => ports.notify(t("incoming.failed", { reason: errorText(error) }), "guasto"))
      .finally(() => {
        running = null;
      });
  }

  void api.onPendingUris(ring).then(
    (off) => (life.closed ? off() : life.add(off)),
    (error: unknown) => ports.notify(t("incoming.failed", { reason: errorText(error) }), "guasto"),
  );
  ring();
}
