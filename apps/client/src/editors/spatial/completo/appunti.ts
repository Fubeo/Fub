// Gli appunti del Disegno completo (piano K6, T11, «Gli appunti»): copiare,
// tagliare e incollare passano dal motore, così un costrutto ricco resta tale
// fra due disegni; gli appunti di sistema restano SVG, PNG e testo, come nel
// Semplice (`tools/clipboard.ts`, `tools/editor/clipboard-commands.ts`).
//
// - **Copia e taglia.** `edit.copy` (o `edit.cut`, che porta il suo passo),
//   poi `clipboard.flavours`, e l'SVG, il PNG e il testo che il motore rende
//   (`clipboard.exportSvg`, `exportPng`, `exportText`) vanno negli appunti di
//   sistema con `writeClipboardData`. Il testo è quello del motore, o l'SVG se
//   non ce n'è.
// - **Impronta.** Il Completo ricorda l'SVG che ha messo negli appunti di
//   sistema, e l'SVG che ha portato al motore. Se negli appunti di sistema c'è
//   lo stesso, il motore ha ancora quegli oggetti: si fa solo `edit.paste`.
//   Altrimenti i byte passano al motore (`clipboard.importSvg`, `importImage`,
//   `importText`), poi `edit.paste`. Ogni copia azzera l'impronta prima di
//   chiedere al motore, e la rimette solo quando il sistema ha scritto.
// - **Conflitti di nomi.** `clipboard.conflicts` dice quali campioni hanno nel
//   disegno un altro colore: si chiede una volta sola, «Unisci» o «Aggiungi».
// - **Cancella cronologia.** Una conferma del kit; poi svuota i passi di
//   annulla della superficie e quelli del motore. Il file e le sue versioni
//   restano come sono.
// - **Fuori:** la posizione (il motore mette l'incolla dove dice il suo default,
//   senza il cursore), e le immagini oltre `MAX_IMAGE_BYTES`, che si rifiutano.

import { clipboardSupports, readClipboard, writeClipboardData, type ClipboardEntry } from "../../../platform/clipboard";
import type { DrawingOutcome } from "../../../host/contract";
import { openDialog } from "../../../kit/dialog";
import { displayBinding } from "../../../ui/commands";
import type { Lifetime } from "../../../ui/lifetime";
import { foreignDrawing } from "../import/foreign";
import { MAX_IMAGE_BYTES } from "../scene/analysis";
import { MAX_EDIT_BYTES } from "../scene/read";
import { utf8Length } from "../scene/text";
import { plural, t, type DrawKey } from "../strings";
import type { MotoreDelDisegno } from "../motore/gesti";
import { cronologiaDi, leggiAppuntiDaVoci, PASTE_PROBLEMS, readPaste, SVG_TYPE, type AppuntiCompleto, type LetturaAppunti } from "../tools/clipboard";

/// Quanto un comando aspetta la sessione del motore: come `esegui.ts`.
const ATTESA_MOTORE_MS = 2_000;

/// Ciò che il Completo dà alla sua copia degli appunti: il motore, la vita del
/// disegno, la selezione, e come si mostra un esito (`applicaEsito` di
/// `esegui.ts`, che porta il passo della cronologia).
export interface DipendenzeAppunti {
  readonly motore: MotoreDelDisegno;
  readonly vita: Lifetime;
  /// La selezione adesso, come id del motore.
  readonly selezione: () => readonly string[];
  /// Mostra un esito del motore: la selezione, le operazioni in un passo, il messaggio.
  readonly applica: (esito: DrawingOutcome, etichetta: string) => void;
  readonly annuncia: (testo: string) => void;
}

/// Una sessione del motore, come la dà `pronta`.
type Sessione = NonNullable<Awaited<ReturnType<MotoreDelDisegno["pronta"]>>>;

/// Il limite di una dimensione in parole («20 MiB»).
function limite(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

/// Il testo di un SVG senza differenze di fine riga: gli appunti di sistema
/// possono riscriverle.
function stessoTesto(a: string, b: string): boolean {
  const normale = (testo: string): string => testo.replace(/\r\n?/g, "\n");
  return normale(a) === normale(b);
}

/// I byte di un PNG in base64, come li dà il motore.
function bytesDiBase64(base64: string, tipo: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

/// Un'immagine in base64, come la vuole `clipboard.importImage`. A pezzi, per
/// non far crescere lo stack di `String.fromCharCode`.
async function base64Di(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

/// Il valore di un campo di una lettura del motore, se è testo.
function testoDi(letto: Record<string, unknown> | null, campo: string): string | null {
  const valore = letto?.[campo];
  return typeof valore === "string" ? valore : null;
}

/// Le stringhe di un elenco che il motore dà (`flavours`), e nient'altro.
function stringheDi(valore: unknown): string[] {
  return Array.isArray(valore) ? valore.filter((x): x is string => typeof x === "string") : [];
}

/// I nomi dei campioni in conflitto che `clipboard.conflicts` dà.
function nomiDeiCampioni(letto: Record<string, unknown> | null): string[] {
  const campioni: unknown = letto?.swatches;
  if (!Array.isArray(campioni)) return [];
  return campioni.flatMap((campione: unknown) => {
    const nome = (campione as { readonly name?: unknown } | null)?.name;
    return typeof nome === "string" ? [nome] : [];
  });
}

/// La lettura che il motore dà a un comando di sola lettura; `null` se non c'è.
function letturaDi(esito: DrawingOutcome | null): Record<string, unknown> | null {
  if (esito === null || esito.refused !== null || esito.ops !== null) return null;
  const letto = esito.reading;
  return typeof letto === "object" && letto !== null && !Array.isArray(letto) ? (letto as Record<string, unknown>) : null;
}

/// Perché un SVG non si incolla, a parole; `null` se va bene.
function problemaSvg(testo: string): DrawKey | null {
  const letto = readPaste(testo);
  return typeof letto === "string" ? PASTE_PROBLEMS[letto] : null;
}

/// Gli appunti del Completo per il motore `dipendenze.motore`. Il Semplice li
/// chiama dove fa copia, taglia e incolla, mentre il Completo è aperto
/// (`tools/clipboard.ts`); `esegui.ts` li chiama per il menu e la tavolozza.
export function creaAppuntiCompleto(dipendenze: DipendenzeAppunti): AppuntiCompleto {
  const { motore, vita, applica, annuncia } = dipendenze;
  /// L'SVG che gli appunti del motore e quelli di sistema hanno in comune; `null`
  /// se non c'è niente di sicuro.
  let impronta: string | null = null;

  /// Il comando al motore, come `esegui.ts`: `null` se il motore non risponde.
  async function chiama(id: string, valore: unknown, selezione: readonly string[] = []): Promise<DrawingOutcome | null> {
    try {
      const sessione: Sessione | null = await motore.pronta(ATTESA_MOTORE_MS);
      if (sessione === null) return null;
      const esito = await sessione.comando({ id, selection: [...selezione], value: valore, preview: false });
      if (esito === null || "kind" in esito) return null;
      return esito;
    } catch {
      // Un motore che lancia non ha fatto il comando: chi chiede lo dice, senza
      // lasciare una promessa rifiutata.
      return null;
    }
  }

  // --- Copia e taglia ---------------------------------------------------------

  async function copia(tipo: "copy" | "cut"): Promise<void> {
    const selezione = dipendenze.selezione();
    if (selezione.length === 0) {
      annuncia(t("draw.selected.none"));
      return;
    }
    // Finché il motore non ha copiato, gli appunti di sistema non sono più la
    // sua copia: l'impronta vecchia non vale.
    impronta = null;
    const esito = await chiama(`disegno.edit.${tipo}`, {}, selezione);
    if (vita.closed) return;
    if (esito === null) {
      annuncia(t("draw.completo.key.failed"));
      return;
    }
    if (tipo === "cut") {
      applica(esito, t("draw.cut"));
      if (esito.ops === null) return;
    } else if (esito.refused !== null && esito.refused !== "empty") {
      applica(esito, t("draw.copy"));
      return;
    }
    // Il motore dice che cosa sa dare agli appunti; `flavours` vuoto: niente.
    const elenco = stringheDi(letturaDi(await chiama("disegno.clipboard.flavours", {}))?.flavours);
    if (elenco.length === 0 || vita.closed) return;
    const svg = testoDi(letturaDi(await chiama("disegno.clipboard.exportSvg", {})), "svg");
    const png = elenco.includes("image/png") ? testoDi(letturaDi(await chiama("disegno.clipboard.exportPng", {})), "dataBase64") : null;
    const testo = testoDi(letturaDi(await chiama("disegno.clipboard.exportText", {})), "text") ?? svg;
    if (vita.closed) return;
    const contenuto: Record<string, Blob> = {};
    if (testo !== null) contenuto["text/plain"] = new Blob([testo], { type: "text/plain" });
    if (svg !== null && clipboardSupports(SVG_TYPE)) contenuto[SVG_TYPE] = new Blob([svg], { type: SVG_TYPE });
    if (png !== null && clipboardSupports("image/png")) contenuto["image/png"] = bytesDiBase64(png, "image/png");
    if (Object.keys(contenuto).length === 0) return;
    try {
      await writeClipboardData(contenuto);
    } catch {
      annuncia(t("draw.copy.failed"));
      return;
    }
    if (vita.closed) return;
    impronta = svg;
    annuncia(
      tipo === "cut"
        ? plural(selezione.length, "draw.cut.one", "draw.cut.other")
        : plural(selezione.length, "draw.copied.one", "draw.copied.other"),
    );
  }

  // --- Incolla ----------------------------------------------------------------

  /// Fa `edit.paste` con quello che il motore ha negli appunti, dopo aver
  /// chiesto i conflitti di nomi. `false` se il motore non ha niente da incollare.
  async function incollaDalMotore(): Promise<boolean> {
    const nomi = nomiDeiCampioni(letturaDi(await chiama("disegno.clipboard.conflicts", {})));
    let scelta: "merge" | "add" = "merge";
    if (nomi.length > 0) {
      const risposta = await chiediConflitti(nomi);
      if (risposta === null || vita.closed) return true;
      scelta = risposta;
    }
    const esito = await chiama("disegno.edit.paste", { swatchConflict: scelta });
    if (vita.closed) return true;
    if (esito === null) {
      annuncia(t("draw.completo.key.failed"));
      return true;
    }
    if (esito.refused === "empty") return false;
    applica(esito, t("draw.paste"));
    return true;
  }

  /// La scelta sui campioni con lo stesso nome: `null` se si annulla.
  function chiediConflitti(nomi: readonly string[]): Promise<"merge" | "add" | null> {
    return openDialog<"merge" | "add" | null>({
      title: t("draw.swatches.conflict.title"),
      description: t("draw.swatches.conflict.body", { names: nomi.join(", ") }),
      actions: [
        { id: "cancel", label: t("draw.window.cancel"), value: null },
        { id: "add", label: t("draw.swatches.add"), value: "add" },
        { id: "merge", label: t("draw.swatches.merge"), kind: "primary", value: "merge", autofocus: true },
      ],
      dismissValue: null,
      lifetime: vita,
    }).result;
  }

  /// Porta `lettura` negli appunti del motore: `true` se ci sono, `false` se
  /// non si può (il motore non risponde, o il formato non si legge, o è troppo
  /// grande: in quei casi lo si dice qui).
  /// Un disegno di Excalidraw o di draw.io negli appunti, come SVG: il lettore
  /// dell'importazione lo fa, come nel Semplice. `null` se non si legge.
  async function disegnoEstero(testo: string): Promise<string | null> {
    try {
      const { pastedDrawing } = await import("../import/paste");
      const fatto = await pastedDrawing(testo);
      if (fatto.notes.length > 0) annuncia(fatto.notes.join(" "));
      return fatto.svg;
    } catch {
      annuncia(t("draw.paste.foreign.failed"));
      return null;
    }
  }

  async function porta(lettura: LetturaAppunti): Promise<boolean> {
    let svg = lettura.svg;
    if (svg === null && lettura.testo !== null && foreignDrawing(lettura.testo) !== null) {
      svg = await disegnoEstero(lettura.testo);
      if (svg === null) return false;
    }
    if (svg !== null) {
      const problema = problemaSvg(svg);
      if (problema !== null) {
        annuncia(t(problema, { limit: limite(MAX_EDIT_BYTES) }));
        return false;
      }
      if ((await chiama("disegno.clipboard.importSvg", { svg })) === null) {
        annuncia(t("draw.completo.key.failed"));
        return false;
      }
      // L'impronta è dell'SVG che sta anche negli appunti di sistema: un disegno
      // estero non ci sta, e allora non ne ha.
      impronta = lettura.svg;
      return true;
    }
    const immagine = lettura.immagini[0];
    if (immagine !== undefined) {
      if (immagine.byte.size > MAX_IMAGE_BYTES) {
        annuncia(t("draw.paste.image_too_large", { limit: limite(MAX_IMAGE_BYTES) }));
        return false;
      }
      const dataBase64 = await base64Di(immagine.byte);
      if ((await chiama("disegno.clipboard.importImage", { dataBase64, mime: immagine.tipo })) === null) {
        annuncia(t("draw.completo.key.failed"));
        return false;
      }
      return true;
    }
    if (lettura.testo !== null) {
      if (utf8Length(lettura.testo) > MAX_EDIT_BYTES) {
        annuncia(t("draw.paste.too_large", { limit: limite(MAX_EDIT_BYTES) }));
        return false;
      }
      if ((await chiama("disegno.clipboard.importText", { text: lettura.testo })) === null) {
        annuncia(t("draw.completo.key.failed"));
        return false;
      }
      return true;
    }
    annuncia(lettura.altri.length > 0 ? t("draw.paste.format_unsupported") : t("draw.paste.nothing"));
    return false;
  }

  async function incolla(lettura: LetturaAppunti): Promise<void> {
    if (vita.closed) return;
    // Gli stessi appunti di una copia del Completo: il motore ha già gli oggetti.
    if (lettura.svg !== null && impronta !== null && stessoTesto(impronta, lettura.svg)) {
      if (await incollaDalMotore()) return;
    }
    impronta = null;
    if (!(await porta(lettura)) || vita.closed) return;
    await incollaDalMotore();
  }

  async function incollaDaMenu(): Promise<void> {
    let voci: readonly ClipboardEntry[];
    try {
      voci = await readClipboard();
    } catch {
      if (!vita.closed) annuncia(t("draw.paste.keys", { key: displayBinding("Mod-v") }));
      return;
    }
    if (vita.closed) return;
    await incolla(await leggiAppuntiDaVoci(voci));
  }

  // --- Cancella cronologia ----------------------------------------------------

  /// Una conferma del kit: la cronologia della superficie, non le versioni del
  /// file. Annullata, non chiama niente.
  async function cancellaCronologia(): Promise<void> {
    const confermato = await openDialog<boolean>({
      title: t("draw.clear_history.title"),
      description: t("draw.clear_history.body"),
      actions: [
        { id: "cancel", label: t("draw.window.cancel"), value: false },
        { id: "clear", label: t("draw.clear_history.ok"), kind: "danger", value: true },
      ],
      dismissValue: false,
      lifetime: vita,
    }).result;
    if (!confermato || vita.closed) return;
    cronologiaDi(motore)?.();
    await chiama("disegno.edit.clearHistory", {});
    if (!vita.closed) annuncia(t("draw.clear_history.done"));
  }

  return {
    copia: (tipo) => copia(tipo),
    incolla: (lettura) => incolla(lettura),
    incollaDaMenu,
    cancellaCronologia,
  };
}
