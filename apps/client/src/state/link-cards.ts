// Le schede dei collegamenti (K8): ciò che `fub.linkcard` sa di ogni indirizzo
// scritto da solo in un paragrafo. La prima volta che la Live ne mostra uno si
// chiede la cache, che risponde subito nell'effetto del comando e non scarica
// niente; «Mostra l'anteprima» chiede di scaricare, e la scheda arriva col
// `job_done` del job `linkcard.fetch`. Si tiene una risposta per indirizzo,
// finché il vault resta quello.

import { api } from "../host/ipc";
import type { CommandOutcome, KernelNotice } from "../host/contract";
import { asPluginError, errorText } from "../host/errors";
import type { LinkCard, LinkCardView } from "../editors/text/profiles/markdown/link-card";
import { liveStrings } from "../editors/text/profiles/markdown/strings";
import type { Lifetime } from "../ui/lifetime";
import { onAnyEvent } from "./kernel";
import { emit, on, openVaultRoot, vaultArg } from "./store";

/// Il bundle, il comando e il job: i gemelli di `crates/fub-host/src/link_card.rs`.
export const LINK_CARD_ID = "fub.linkcard";
export const LINK_CARD_FETCH = "linkcard.fetch";

let known = new Map<string, LinkCardView>();
/// Le domande partite con il vault di adesso: una risposta di un altro vault
/// non entra.
let generation = 0;

/// La scheda di una risposta, se ha la forma che il bundle consegna.
export function cardOf(value: unknown, url: string): LinkCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Record<string, unknown>;
  const text = (key: string) => (typeof card[key] === "string" ? card[key] : "");
  if (card.url !== url) return null;
  return { url, title: text("title"), description: text("description"), site: text("site"), icon: text("icon") };
}

/// La frase di un esito che non è una scheda, nella lingua di chi guarda.
export function failureText(result: Record<string, unknown>): string {
  const reason = result.failed === "status"
    ? liveStrings.t("linkcard.status", { status: String(result.status) })
    : result.failed === "too_large"
      ? liveStrings.t("linkcard.too_large")
      : liveStrings.t("linkcard.not_html");
  return liveStrings.t("linkcard.failed", { reason });
}

/// Ciò che dice un `job_done` di `linkcard.fetch`: l'indirizzo e la sua
/// scheda, o `null` se il risultato non è di questo job.
export function readDone(result: unknown): { url: string; view: LinkCardView } | null {
  if (!result || typeof result !== "object") return null;
  if ("Ok" in result) {
    const ok = (result as { Ok: unknown }).Ok as Record<string, unknown> | null;
    if (!ok || typeof ok !== "object" || typeof ok.url !== "string") return null;
    const card = cardOf(ok.card, ok.url);
    if (card) return { url: ok.url, view: { kind: "card", card } };
    if (typeof ok.failed === "string") return { url: ok.url, view: { kind: "failed", reason: failureText(ok) } };
    return { url: ok.url, view: { kind: "bare" } };
  }
  return null;
}

/// Ciò che dice l'effetto del comando: la scheda in cache, un download
/// partito, o niente.
export function readOutcome(outcome: CommandOutcome, url: string): LinkCardView {
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== LINK_CARD_ID) return { kind: "bare" };
  const payload = effect.payload as Record<string, unknown> | null;
  const card = cardOf(payload?.card, url);
  if (card) return { kind: "card", card };
  return payload?.pending === true ? { kind: "loading" } : { kind: "bare" };
}

function set(url: string, view: LinkCardView): void {
  known.set(url, view);
  emit("link-cards");
}

function failed(error: unknown): LinkCardView {
  if (asPluginError(error)?.kind === "permission_denied") return { kind: "failed", reason: liveStrings.t("linkcard.denied") };
  return { kind: "failed", reason: liveStrings.t("linkcard.failed", { reason: errorText(error) }) };
}

async function ask(url: string, fetch: boolean): Promise<void> {
  const vault = openVaultRoot();
  const asked = generation;
  if (!vault) return;
  try {
    const outcome = await api.invokeCommand(LINK_CARD_FETCH, { url, fetch }, "apply", ...vaultArg(vault));
    if (asked !== generation) return;
    const view = readOutcome(outcome, url);
    // Una scheda arrivata nel frattempo da un job non torna indietro.
    if (view.kind === "bare" && known.get(url)?.kind === "card") return;
    set(url, view);
  } catch (error) {
    // La cache che non risponde (un vault senza il bundle, un host vecchio)
    // lascia l'indirizzo com'è; il guasto si dice soltanto a chi ha chiesto.
    if (asked === generation) set(url, fetch ? failed(error) : { kind: "bare" });
  }
}

/// Ciò che si sa di `url`. La prima volta chiede la cache e intanto risponde
/// «senza scheda».
export function linkCardView(url: string): LinkCardView {
  const seen = known.get(url);
  if (seen) return seen;
  known.set(url, { kind: "bare" });
  void ask(url, false);
  return { kind: "bare" };
}

/// «Mostra l'anteprima».
export function requestLinkCard(url: string): void {
  if (known.get(url)?.kind === "loading") return;
  set(url, { kind: "loading" });
  void ask(url, true);
}

function clear(): void {
  generation++;
  if (known.size === 0) return;
  known = new Map();
  emit("link-cards");
}

/// Ascolta gli esiti dei download finché `lifetime` è vivo.
export function mountLinkCards(lifetime: Lifetime): void {
  lifetime.add(onAnyEvent((notice: KernelNotice) => {
    const event = notice.event;
    if (event.type === "vault_opened" || event.type === "vault_closed") {
      clear();
      return;
    }
    if (event.type !== "job_done" || event.job !== LINK_CARD_FETCH) return;
    const done = readDone(event.result);
    if (done) {
      set(done.url, done.view);
      return;
    }
    // Un errore non dice l'indirizzo: vale per ogni scheda che aspettava.
    const error = (event.result as { Err?: unknown } | null)?.Err;
    if (error === undefined) return;
    for (const [url, view] of known) if (view.kind === "loading") known.set(url, failed(error));
    emit("link-cards");
  }));
  lifetime.add(on("vault", clear));
  lifetime.add(clear);
}
