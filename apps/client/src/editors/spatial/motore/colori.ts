// I colori e lo spessore del disegno sul motore (K5): il colore del tratto,
// quello del riempimento e lo spessore che si scelgono per gli oggetti scelti
// sono comandi del motore del disegno, non scritture del client.
//
// - **Una richiesta, un passo.** Un campo del pannello cambiato con una
//   selezione manda `drawingCommand` (`disegno.colore-tratto`,
//   `disegno.colore-riempimento`, `disegno.spessore`) col valore come lo
//   scrive oggi il campo: il colore `#rrggbb` (per il riempimento `null` è
//   «nessuno»), lo spessore in unità della scena. Le operazioni dell'esito
//   passano da `parseWireOp` e si applicano come ogni scrittura del pannello
//   (`changeFromPanel`, quindi `ctx.attempt`), col nome di oggi: un passo di
//   annulla.
// - **Ciò che il motore non dice resta del client.** Un campione del
//   documento (`url(#…)`), un contorno «nessuno», un valore che non è un
//   colore o uno spessore, il foglio delle annotazioni di un PDF, un gruppo
//   isolato e il motore che non c'è vanno per la strada di oggi: lì il
//   pannello scrive da sé. Un motore che smette di rispondere mentre la
//   richiesta è in volo fa lo stesso, se la selezione e il disegno sono
//   ancora quelli.
// - **Quali comandi valgono.** `drawingCommands` dice, per la selezione e il
//   disegno di adesso, quali comandi il motore sa fare; i campi degli altri
//   il pannello li mostra disattivati, col meccanismo che ha già. Finché la
//   risposta non c'è, i campi restano come sono.
// - **Uno alla volta.** Un comando parte dopo che l'esito del precedente è
//   stato applicato: la copia del motore lo ha già avuto.
// - **La selezione che cambia nel frattempo.** L'esito si applica lo stesso
//   (le operazioni portano gli id); la selezione resta quella che si è scelta
//   dopo.

import { DRAWING_COMMAND_FILL_COLOR, DRAWING_COMMAND_STROKE_COLOR, DRAWING_COMMAND_WIDTH, type DrawingOutcome, type DrawingRefusal } from "../../../host/contract";
import type { LengthUnit } from "../scene/rulers";
import { t, type DrawKey } from "../strings";
import type { EditorContext } from "../tools/editor/context";
import { lookAction, lookUnit } from "../tools/fields";
import { customColor } from "../tools/palette";
import type { FieldId, FieldState, PropertiesView } from "../tools/properties";
import { fromUnit } from "../tools/rulers";
import { ATTESA_APERTURA_MS, opsDellEsito } from "./gesti";
import type { SessioneMotore } from "./sessione";

/// I campi del pannello che sono comandi del motore, col loro id.
export const COMANDI_DEI_CAMPI = {
  stroke: DRAWING_COMMAND_STROKE_COLOR,
  fill: DRAWING_COMMAND_FILL_COLOR,
  strokeWidth: DRAWING_COMMAND_WIDTH,
} as const satisfies Partial<Record<FieldId, string>>;

export type CampoDelMotore = keyof typeof COMANDI_DEI_CAMPI;

const campoDelMotore = (id: FieldId): id is CampoDelMotore => id === "stroke" || id === "fill" || id === "strokeWidth";

/// Il valore che il comando del campo `id` porta, da `value` come lo scrive
/// il pannello; `undefined` se non è un valore per il motore (e il pannello
/// scrive da sé, come oggi).
export function valoreDelComando(id: CampoDelMotore, value: number | string | boolean, unit: LengthUnit): string | number | null | undefined {
  switch (id) {
    case "stroke":
      return typeof value === "string" ? (customColor(value) ?? undefined) : undefined;
    case "fill":
      if (typeof value !== "string") return undefined;
      return value.trim().toLowerCase() === "none" ? null : (customColor(value) ?? undefined);
    case "strokeWidth": {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
      const width = fromUnit(value, lookUnit(unit));
      return Number.isFinite(width) && width >= 0 ? width : undefined;
    }
  }
}

/// Il motivo a parole di un comando che il motore non ha fatto; `null` se
/// non c'è niente da dire (non cambiava niente).
export function motivoDelRifiuto(refused: DrawingRefusal): DrawKey | null {
  switch (refused) {
    case "empty":
      return null;
    case "locked":
    case "hidden":
      return "draw.reason.locked";
    case "unmapped":
    case "unsupported":
      return "draw.reason.foreign";
    case "too_large":
      return "draw.reason.limit";
    case "stale":
    case "closed":
    case "not_ready":
      return "draw.reason.invalid";
  }
}

/// Che cosa i colori sul motore danno agli altri pezzi dell'editor.
export interface ColoriMotoreContext {
  /// Il campo `id` del pannello, cambiato a `value`, mandato al motore: `null`
  /// se la richiesta è partita (l'esito arriva dopo), la ragione se non può
  /// partire; `undefined` se il campo non passa dal motore, e lo scrive il
  /// pannello come oggi.
  coloreDalMotore: (id: FieldId, value: number | string | boolean) => string | null | undefined;
  /// `view` coi campi dei comandi che il motore adesso non sa fare
  /// disattivati.
  campiDelMotore: (view: PropertiesView) => PropertiesView;
}

/// Ciò che `drawingCommands` ha detto, per quale disegno e quale selezione.
interface Attivi {
  readonly index: unknown;
  readonly keys: string;
  readonly sessione: SessioneMotore;
  /// Gli id dei comandi attivi; `null` finché la risposta non c'è, o se non
  /// è venuta.
  attivi: ReadonlySet<string> | null;
}

/// Monta i colori sul motore. `scriviDaSe` è la scrittura del pannello di
/// oggi, che fa la stessa cosa senza il motore.
export function installColoriMotore(ctx: EditorContext, scriviDaSe: (id: FieldId, value: number | string | boolean) => string | null): void {
  const porta = ctx.options.motore;
  /// L'esito dell'ultimo comando applicato: il comando dopo parte da lì.
  let ultimo: Promise<unknown> = Promise.resolve();
  let attivi: Attivi | null = null;

  /// Il motore si usa per i campi della selezione: non sul foglio delle
  /// annotazioni, non dentro un gruppo isolato (come i gesti, `gesti.ts`).
  const motoreQui = (): boolean =>
    porta !== undefined && ctx.folio === undefined && ctx.isolatedNode() === null && porta.adesso() !== null;

  const keysNow = (): string => ctx.selection.join("\n");

  /// Il pannello come lo vuole il disegno di adesso.
  const rinfresca = (): void => {
    if (ctx.disposed) return;
    ctx.panelShown = null;
    ctx.syncProperties();
  };

  /// Gli id dei comandi attivi per la selezione di adesso; `null` se non si
  /// sa (e la domanda parte).
  const attiviOra = (): ReadonlySet<string> | null => {
    if (porta === undefined || !motoreQui() || ctx.selection.length === 0) return null;
    const sessione = porta.adesso();
    if (sessione === null || sessione === "apertura") return null;
    const index = ctx.currentIndex();
    const keys = keysNow();
    if (attivi !== null && attivi.index === index && attivi.keys === keys && attivi.sessione === sessione) return attivi.attivi;
    const entry: Attivi = { index, keys, sessione, attivi: null };
    attivi = entry;
    void sessione.comandi([...ctx.selection]).then(
      (risposta) => {
        if (attivi !== entry || ctx.disposed || risposta === null || !Array.isArray(risposta)) return;
        entry.attivi = new Set(risposta.filter((each) => each.enabled).map((each) => each.id));
        rinfresca();
      },
      (error: unknown) => console.error(error),
    );
    return null;
  };

  const campiDelMotore = (view: PropertiesView): PropertiesView => {
    const now = attiviOra();
    if (now === null) return view;
    let fields: Partial<Record<FieldId, FieldState>> | null = null;
    for (const [id, command] of Object.entries(COMANDI_DEI_CAMPI) as Array<[CampoDelMotore, string]>) {
      const state = view.fields[id];
      if (state === undefined || state.disabled === true || now.has(command)) continue;
      fields ??= { ...view.fields };
      fields[id] = { ...state, disabled: true };
    }
    return fields === null ? view : { ...view, fields };
  };
  ctx.campiDelMotore = campiDelMotore;

  const coloreDalMotore = (id: FieldId, value: number | string | boolean): string | null | undefined => {
    if (porta === undefined || !campoDelMotore(id) || !motoreQui()) return undefined;
    if (ctx.selection.length === 0 || ctx.engine.model === null || ctx.selectedUnits().length === 0 || !ctx.editable()) return undefined;
    const valore = valoreDelComando(id, value, ctx.docUnit());
    if (valore === undefined) return undefined;
    const command = COMANDI_DEI_CAMPI[id];
    const known = attiviOra();
    if (known !== null && !known.has(command)) return t("draw.rejected", { reason: t("draw.reason.foreign") });
    const label = lookAction(id, value);
    if (label === null) return undefined;
    const index = ctx.currentIndex();
    const keys = keysNow();
    const selection = [...ctx.selection];
    /// Senza il motore, la scrittura di oggi: solo se il disegno e la
    /// selezione sono ancora quelli da cui si era partiti.
    const daSe = (): void => {
      if (ctx.disposed || ctx.currentIndex() !== index || keysNow() !== keys) return;
      const outcome = scriviDaSe(id, value);
      if (outcome !== null) ctx.announce(outcome);
      rinfresca();
    };
    const done = ultimo.then(async () => {
      if (ctx.disposed) return;
      const sessione = await porta.pronta(ATTESA_APERTURA_MS);
      if (ctx.disposed) return;
      if (sessione === null) {
        daSe();
        return;
      }
      const esito = await sessione.comando({ id: command, selection, value: valore });
      if (ctx.disposed) return;
      if (esito === null || "kind" in esito || esito.refused === "closed") {
        daSe();
        return;
      }
      applica(id, value, label, keys, esito);
    }).catch((error: unknown) => {
      console.error(error);
    });
    ultimo = done;
    return null;
  };
  ctx.coloreDalMotore = coloreDalMotore;

  /// L'esito di un comando: le operazioni in un passo, o perché no.
  const applica = (id: CampoDelMotore, value: number | string | boolean, label: DrawKey, keys: string, esito: DrawingOutcome): void => {
    if (esito.refused !== null) {
      const motivo = motivoDelRifiuto(esito.refused);
      if (motivo !== null) ctx.announce(t("draw.rejected", { reason: t(motivo) }));
      rinfresca();
      return;
    }
    const read = opsDellEsito(esito.ops);
    if ("reason" in read) {
      console.error(`motore del disegno: un'operazione dell'esito non vale (${read.reason}): ${read.detail}`);
      ctx.announce(t("draw.rejected", { reason: t(read.reason === "limit" ? "draw.reason.limit" : "draw.reason.invalid") }));
      rinfresca();
      return;
    }
    // La selezione cambiata nel frattempo resta quella di adesso: le
    // operazioni portano i loro id.
    const same = keysNow() === keys;
    const outcome = ctx.changeFromPanel(label, read.ops, same ? esito.selection : null);
    if (outcome !== null) {
      ctx.announce(outcome);
    } else if (read.ops.length > 0 && (id === "fill" || id === "stroke") && typeof value === "string") {
      // Un colore scritto entra fra i recenti, come dal pannello di oggi.
      const code = customColor(value);
      if (code !== null) ctx.rememberColors(code);
    }
    rinfresca();
  };
}
