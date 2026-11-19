// L'esportazione chiesta da fuori (E28, T79): un agente, via MCP, chiede il
// PDF di una nota col comando `pdf.export_note`, e il core lo manda qui, come
// evento, perché il core da solo non impagina (ADR 0247: la vista impagina e
// misura, il core scrive).
//
// Finché è aperta, la shell rinnova la sua presenza (`pdf.export_listen`):
// senza di lei il comando risponde che serve l'app aperta. Per ogni richiesta
// la shell salva la nota se ha modifiche, la impagina fuori dallo schermo con
// gli stessi pezzi dello spazio «Esporta in PDF» (l'impaginatore della stampa,
// i fogli con testata, frontespizio e indice), misura ciò che il browser ha
// disegnato su ogni foglio (`pageListOf`) e lo manda a `pdf.write_pages`, che
// accoda il lavoro del core.
//
// `pageListOf` è la strada che lo spazio potrà usare per «Esporta»: dai fogli
// impaginati all'elenco delle pagine del core.
//
// Il modulo si carica all'avvio, per la presenza: l'impaginazione e i suoi
// pezzi (la resa per la stampa, i fogli, i diagrammi) si caricano solo alla
// prima richiesta (`headless-run.ts`, poi `loadPipeline`), come lo spazio:
// all'avvio si carica solo la presenza e la coda.

import type { CommandOutcome, InvokeMode } from "../host/contract";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import type { PrintRenderer } from "../editors/media/print-view";
import type { PdfPagesPorts } from "./content/pdf-pages";
import type { BlockSource, Scheduler } from "./paginate/slices";
import type { measureSheets } from "./probe";
import type { VaultFontSource } from "./sections/fonts";
import type { ExportMount } from "./space";

/// La shell dice al core che c'è e sa impaginare.
export const LISTEN_COMMAND = "pdf.export_listen";
/// Il comando che accoda la scrittura del PDF.
export const WRITE_COMMAND = "pdf.write_pages";
/// L'evento con cui il core chiede un'esportazione (`TOPIC_RICHIESTA`).
export const REQUEST_TOPIC = "fub.draw:pdf.export";
/// Ogni quanto si rinnova la presenza, se il core non dice altro: la promessa
/// vale due minuti (`TTL_PRESENZA_MS`), il rinnovo è largo.
export const RENEW_MS = 30_000;
/// Quante richieste aspettano al più: le altre si rifiutano, con un avviso.
export const QUEUE_LIMIT = 8;

/// Una richiesta del core, come arriva nell'evento. Il profilo è quello del
/// file, intero: lo completa la vista quando lo usa (`profileFromCore`).
export interface ExportRequest {
  readonly request: string;
  readonly note: string;
  readonly target: string;
  readonly replace: boolean;
  readonly profileId: string;
  readonly profile: unknown;
}

/// La richiesta dal payload dell'evento, o `null` se non lo è: il payload
/// viene dal core, ma la shell non si fida della forma.
export function parseRequest(payload: unknown): ExportRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const request = text(p["request"]);
  const note = text(p["note"]);
  const target = text(p["target"]);
  if (!request || !note || !target) return null;
  return { request, note, target, replace: p["replace"] === true, profileId: text(p["profile_id"]) ?? "", profile: p["profile"] ?? null };
}

/// Chi aiuta l'esportazione fuori dallo schermo: la stessa resa, lo stesso
/// montaggio e lo stesso salvataggio dello spazio.
export interface HeadlessDeps {
  readonly render: PrintRenderer;
  /// Chi monta la resa della nota (le forme che dichiara si leggono prima).
  readonly mount?: (doc: string) => Promise<ExportMount>;
  /// Salva la nota, se ha modifiche: il core la rende dal disco.
  readonly save: (doc: string) => Promise<void>;
  readonly properties?: (doc: string) => Promise<readonly { readonly key: string; readonly value: unknown }[]>;
  readonly title: (doc: string) => string;
  readonly invoke: (command: string, args: Record<string, unknown>, mode: InvokeMode) => Promise<CommandOutcome>;
  /// Si iscrive agli eventi `custom` del core; torna lo smontaggio.
  readonly listen: (handler: (topic: string, payload: unknown) => void) => () => void;
  readonly notify: (message: string, kind: "info" | "guasto") => void;
  /// Il lavoro accodato: la shell gli dà un nome nel centro attività.
  readonly queued?: (jobId: string, request: ExportRequest) => void;
  /// Il CSS delle regole `@font-face` del tema di adesso (vedi `ProbeOptions`).
  readonly fontFaces?: () => readonly string[];
  /// I caratteri del vault per la stampa, come allo spazio (T72).
  readonly vaultFonts?: VaultFontSource;
  /// I PDF incorporati, per le loro pagine in coda, come allo spazio (T74).
  readonly pdf?: PdfPagesPorts;
  readonly parent?: HTMLElement;
  readonly scheduler?: Scheduler;
  readonly waitMs?: number;
  readonly measure?: (page: HTMLElement) => BlockSource & { dispose?(): void };
  /// Chi misura i fogli (i test ne danno uno finto: happy-dom non dispone).
  readonly measureSheets?: typeof measureSheets;
  readonly renewMs?: number;
  /// Se il core del vault aperto ha il comando della presenza (i disegni
  /// accesi): senza, la shell non lo chiama. Di serie sì.
  readonly available?: () => boolean;
  /// Avvisa quando l'elenco dei comandi cambia (un vault aperto, un
  /// componente acceso); torna lo smontaggio.
  readonly onAvailability?: (changed: () => void) => () => void;
}

/// Comincia ad ascoltare le richieste e a rinnovare la presenza; torna lo
/// smontaggio, che smette tutte e due e lascia scadere la presenza.
export function startHeadlessExport(deps: HeadlessDeps): () => void {
  let stopped = false;
  let pending = 0;
  let chain: Promise<void> = Promise.resolve();
  let timer = 0;

  const schedule = (ms: number) => {
    if (stopped) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(renew, ms);
  };
  function renew(): void {
    window.clearTimeout(timer);
    if (stopped || !(deps.available?.() ?? true)) return;
    deps.invoke(LISTEN_COMMAND, {}, "apply").then(
      (outcome) => schedule(renewOf(outcome) ?? deps.renewMs ?? RENEW_MS),
      // Un core senza il comando (i disegni spenti) o che non risponde: si
      // riprova al giro dopo, senza disturbare.
      () => schedule(deps.renewMs ?? RENEW_MS),
    );
  }

  const unlisten = deps.listen((topic, payload) => {
    if (stopped || topic !== REQUEST_TOPIC) return;
    const request = parseRequest(payload);
    if (!request) return;
    if (pending >= QUEUE_LIMIT) {
      deps.notify(t("pdf_export.headless.busy", { doc: deps.title(request.note) }), "guasto");
      return;
    }
    pending++;
    // Una alla volta: due impaginazioni insieme si contenderebbero la pagina.
    chain = chain.then(async () => {
      try {
        if (stopped) return;
        const run = await loadRun().catch((error: unknown) => {
          deps.notify(t("pdf_export.headless.failed", { doc: deps.title(request.note), reason: errorText(error) }), "guasto");
          return null;
        });
        if (run && !stopped) await run.exportRequested(request, deps);
      } finally {
        pending--;
      }
    });
  });

  // Un vault nuovo ha un core suo: la presenza si dice subito a lui.
  const unwatch = deps.onAvailability?.(renew) ?? (() => {});
  renew();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    unwatch();
    unlisten();
  };
}

/// Ogni quanto il core vuole il rinnovo, dall'esito di `pdf.export_listen`.
function renewOf(outcome: CommandOutcome): number | null {
  const effect = outcome.effect;
  if (effect.kind !== "custom") return null;
  const every = (effect.payload as { renew_ms?: unknown } | null)?.renew_ms;
  return typeof every === "number" && every >= 1000 ? every : null;
}

let runLoad: Promise<typeof import("./headless-run")> | null = null;

/// Carica (una volta) l'esportazione vera; un caricamento fallito si riprova
/// alla richiesta dopo.
export function loadRun(): Promise<typeof import("./headless-run")> {
  runLoad ??= import("./headless-run").catch((error: unknown) => {
    runLoad = null;
    throw error;
  });
  return runLoad;
}
