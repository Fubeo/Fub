// Lo spazio di lavoro (G2) e la colonna personalizzata (G3). «Completo» ha
// tutto; «Semplice» offre le parti per disegnare a mano o col dito, con
// pulsanti grandi, e «Completo» resta a un clic, nel menu ≡ e in fondo alla
// colonna. «Personalizza la barra…» sceglie quali strumenti stanno nella
// colonna e in che ordine: quelli tolti restano nei tasti e nella ricerca
// dei comandi. Chi monta l'editor ricorda le scelte (`onWorkspace`,
// `onToolbar`); l'editor le applica subito.

import { textButton } from "../../../../../kit";
import { settings } from "../../../../../host/query";
import { components, onComponents } from "../../../../../state/components";
import type { MenuItem } from "../../../../../ui/menu";
import { t } from "../../../strings";
import type { ToolId, Workspace } from "../../registry";
import { openToolbarDialog } from "../../toolbar-dialog";
import type { EditorContext } from "../context";
import { gesture } from "../../edit";
import { elemDi, opsDellEsito } from "../../../motore/gesti";
import { segniComeForma } from "../../../motore/tracciati";
import { IDENTITY } from "../../../scene/matrix";
import type { Sezioni } from "../../../completo/sezioni";
import { railLayout } from "./rail";
import { comandoDiFub, statoClienteCompleto, voceClienteCompleto } from "./status";
import type { Completo } from "../../../completo";
import type { EffettiSpazio, SchedaSpazio } from "../../../completo/spazi";

/// Fino a questa larghezza della finestra, in px, la colonna sta sotto il
/// foglio; e così in un riquadro largo fino a `NARROW_PANE`, anche in una
/// finestra larga. Un riquadro di 670 px fra le note e l'ispettore di una
/// finestra di 1280 tiene la colonna a sinistra.
const NARROW_WIDTH = 700;
const NARROW_PANE = 480;

/// Il componente del Disegno completo (`crates/fub-components`).
export const DISEGNO_COMPLETO = "fub.disegno-completo";

/// L'impostazione dello spazio di lavoro nel bundle del disegno: le stesse di
/// `preferences.ts` (`WORKSPACE_KEY`), che sta nel chunk della superficie e
/// da qui non si importa.
const DRAW_BUNDLE = "fub.draw";
const WORKSPACE_KEY = "draw.workspace";

/// Lo spazio di base che il vault ha scelto, letto adesso: `simple` per il
/// Semplice, `full` per ogni altro id (un preset, uno salvato, o uno che nessuno
/// conosce); `null` se è quello di serie, o se la lettura non riesce.
async function spazioDelVault(): Promise<Workspace | null> {
  try {
    const entry = (await settings(DRAW_BUNDLE)).find((one) => one.spec.key === WORKSPACE_KEY);
    if (entry === undefined || entry.source === "default") return null;
    return entry.value === "simple" ? "simple" : "full";
  } catch {
    return null;
  }
}

/// La base di uno spazio: il Semplice per il suo id, il Completo per tutti gli
/// altri (i preset e gli spazi salvati sono del Completo).
export function baseOf(space: string): Workspace {
  return space === "simple" ? "simple" : "full";
}

export interface WorkspaceContext {
  /// La base dello spazio in uso: `simple` o `full`.
  workspace: Workspace;
  /// Lo spazio in uso: `full`, `simple`, un preset o uno salvato.
  space: string;
  /// Gli strumenti della colonna, in ordine; vuoto, quelli di serie.
  column: readonly ToolId[];
  /// Un altro spazio, dal vivo; con `toolbar`, anche la colonna.
  setSpace: (next: string, toolbar?: readonly ToolId[]) => void;
  /// Riapplica i dati dello spazio in uso (Ripristina).
  resetSpace: () => void;
  /// Il Completo non si è caricato: si riprova (Riprova).
  retryCompleto: () => void;
  completoFailed: () => boolean;
  /// La colonna, la scheda e la sezione adesso, per salvare lo spazio.
  spaceSnapshot: () => { colonna: string[]; scheda: SchedaSpazio; sezione: string | null; righelli: boolean };
  /// Le voci «Spazio di lavoro» e «Personalizza la barra…» del menu ≡.
  workspaceItems: () => MenuItem[];
  /// Apre «Personalizza la barra…».
  customizeToolbar: () => void;
}

/// L'ordine di serie della colonna con gli strumenti `offered`.
export function defaultColumn(ctx: EditorContext): ToolId[] {
  return railLayout(ctx.tools, ctx.profile).flat(2);
}

/// La colonna di `toolbar` fra gli strumenti offerti: quelli che non ci sono
/// più non contano, e senza nessuno resta quella di serie; la Selezione c'è
/// sempre, come nella colonna.
export function columnOf(ctx: EditorContext, toolbar: readonly ToolId[]): ToolId[] {
  return railLayout(ctx.tools, ctx.profile, toolbar).flat(2);
}

export function installWorkspace(ctx: EditorContext): void {
  const { options } = ctx;
  ctx.space = options.space ?? ctx.workspace;
  ctx.root.dataset.workspace = ctx.workspace;
  // In una scheda (T46) gli strumenti sono sempre una fila sopra il foglio:
  // la scheda è larga quanto la colonna del testo, e una colonna di lato le
  // ruberebbe il disegno.
  const compact = options.compact === true;
  // Nel Semplice le caselle sono bersagli da 44 px, anche col mouse; non in
  // una scheda, dove la fila deve stare accanto alla barra.
  const sizeOf = (workspace: Workspace): string => (workspace === "simple" && !compact ? "large" : "normal");
  ctx.rail.element.dataset.size = sizeOf(ctx.workspace);
  if (compact) {
    ctx.root.dataset.compact = "";
    ctx.rail.setOrientation("horizontal");
  }

  // Su uno schermo stretto, o in un riquadro molto stretto, la colonna va
  // sotto il foglio e scorre di lato.
  if (!compact && typeof ResizeObserver !== "undefined") {
    const narrowObserver = new ResizeObserver(() => {
      const width = ctx.root.clientWidth;
      if (width === 0) return;
      const narrow = width <= NARROW_PANE || window.innerWidth <= NARROW_WIDTH;
      if (narrow === (ctx.root.dataset.narrow !== undefined)) return;
      ctx.root.toggleAttribute("data-narrow", narrow);
      ctx.rail.setOrientation(narrow ? "horizontal" : "vertical");
    });
    narrowObserver.observe(ctx.root);
    ctx.life.add(() => narrowObserver.disconnect());
  }

  // «Completo» in fondo alla colonna, nello spazio Semplice. Non in una
  // scheda: lì il resto si trova aprendo il disegno.
  const full = textButton({ label: t("draw.workspace.full"), onPress: () => choose("full"), lifetime: ctx.life });
  full.classList.add("draw-rail-full");
  const fullHidden = (workspace: Workspace): boolean => compact || workspace !== "simple";
  full.hidden = fullHidden(ctx.workspace);
  ctx.railColumn.append(full);
  ctx.relabels.push(() => {
    full.textContent = t("draw.workspace.full");
    full.title = t("draw.workspace.full.hint");
  });

  // Il Disegno completo (K6): col componente acceso, entrare nel Completo
  // porta il suo ingresso con un `import()`, una volta per disegno aperto. Il
  // Semplice, una scheda e il componente spento non lo chiedono mai.
  //
  // Prima dell'`import()` si legge la scelta del vault: il primo disegno
  // della sessione nasce nel Completo finché la superficie non ha letto
  // l'impostazione (`preferences.ts`, il Completo è la scelta di serie), e
  // senza questa lettura un vault nel Semplice porterebbe il Completo a ogni
  // avvio. Una lettura che non riesce non ferma niente: decide lo spazio
  // dell'editor.
  // Lo stato del Completo: `fallito` quando il suo ingresso non arriva, e allora
  // lo spazio di prima resta e il menu lo dice, con «Riprova».
  let completo: "no" | "verifica" | "in-arrivo" | "aperto" | "fallito" = "no";
  /// Il Completo aperto: vi si applica lo spazio in uso.
  let aperto: Completo | null = null;
  // La scheda che lo spazio apre passa dal pannello dell'ispettore. Le sezioni
  // dell'ispettore (T10) non si aprono ancora per nome: lo spazio le salta.
  const effetti: EffettiSpazio = {
    scheda: (scheda) => options.chrome?.reveal?.(scheda),
    sezione: () => false,
  };
  const applicaSpazio = (): void => {
    // Uno spazio salvato porta la sua scheda; un preset chiede il Completo.
    const salvato = options.spazioSalvato?.(ctx.space) ?? null;
    if (salvato !== null) {
      effetti.scheda(salvato.scheda);
      return;
    }
    aperto?.spazio(ctx.space, effetti);
  };
  // Le sezioni del Completo aperto (T10): la scheda Risorse le legge di qui.
  let sezioniAperte: Sezioni | null = null;
  const vuoleCompleto = (): boolean =>
    !compact && !ctx.disposed && ctx.workspace === "full" && components()?.on(DISEGNO_COMPLETO) === true;
  // La scheda Risorse è quella del Completo del motore: c'è solo col Completo
  // aperto, col componente acceso, col motore del disegno e nello spazio
  // «Completo». Spento il componente, senza motore o nel Semplice, si toglie.
  const mostraRisorse = (): void => {
    if (completo !== "aperto" || sezioniAperte === null) return;
    const motore = options.motore ?? null;
    const attivo = !ctx.disposed && ctx.workspace === "full" && motore !== null && components()?.on(DISEGNO_COMPLETO) === true;
    ctx.collegaCompleto(attivo ? sezioniAperte : null, attivo ? motore : null);
  };
  // La colonna del Completo (K6 T8) c'è quando il Completo è aperto e acceso
  // nello spazio «Completo»: la colonna la chiede a ogni sincronia.
  ctx.completo = () => {
    const porta = aperto;
    if (porta === null || !vuoleCompleto()) return null;
    return {
      colonna: (offerti) => porta.colonna(offerti),
      strumentoMotore: (id) => porta.strumentoMotore(id),
      cassetto: (anchor, opzioni) => porta.cassetto(anchor, opzioni, ctx.life),
    };
  };
  // Il Completo aperto e acceso, per il menu ≡ e la ricerca Ctrl+/ (K6 T9a):
  // le sue voci vengono dall'indice. Senza, quelli di oggi.
  ctx.completoVoci = () => (aperto === null || !vuoleCompleto() ? null : aperto);
  // La fila delle opzioni dello strumento del motore (K6 T11) col Completo aperto e
  // acceso; senza, la testata non ha fila.
  ctx.completoMotore = () => (aperto === null || !vuoleCompleto() ? null : aperto);
  // I comandi di livello dell'albero (K6 T15, giro 4) passano dal motore col Completo
  // aperto e acceso; nel Semplice, o senza motore, li fa l'editor come sempre.
  ctx.livelliMotore = () => (aperto === null || !vuoleCompleto() ? null : aperto.livelli);
  // Il campo «Testo» di un testo in area (K6 T16) passa dal motore col Completo aperto e
  // acceso: rifà gli a capo nel riquadro. Senza motore il campo non c'è per un testo in area.
  ctx.areaWordsWriter = () => {
    const ora = aperto === null || !vuoleCompleto() || (options.motore ?? null) === null ? null : aperto;
    return ora === null ? null : (elemento, testo) => ora.parole(elemento, testo);
  };
  const portaCompleto = (): void => {
    if ((completo !== "no" && completo !== "fallito") || !vuoleCompleto()) return;
    completo = "verifica";
    void spazioDelVault().then((scelto) => {
      if (ctx.disposed) return;
      if (scelto === "simple" || !vuoleCompleto()) {
        // La superficie porterà l'editor nel Semplice; il prossimo ingresso
        // nel Completo ci riprova.
        completo = "no";
        return;
      }
      completo = "in-arrivo";
      import("../../../completo").then(
        ({ apri }) => {
          if (ctx.disposed) return;
          aperto = apri({ motore: options.motore ?? null, life: ctx.life }, {
            // I tasti del motore (K6 T9b): la radice dell'editor, la selezione, e la
            // cronologia e l'annuncio di sempre. L'anteprima di una finestra (T12,
            // giro 3) va sullo strato dell'anteprima come quella dei gesti: la forma,
            // o i contorni nuovi in coordinate di scena; `null` la toglie.
            tasti: {
              radice: ctx.root,
              selezione: () => ctx.selection,
              strumento: (id) => ctx.sceltaMotore(id),
              seleziona: (ids) => ctx.select(ids),
              anteprima: (anteprima) =>
                ctx.showShape(
                  anteprima === null ? null : (elemDi(anteprima.shape) ?? segniComeForma(anteprima.overlays ?? [], ctx.camera.scale)),
                  IDENTITY,
                ),
              stato: () => {
                const id = ctx.motoreTool;
                const stato = id === null ? null : ctx.statoStrumento(id);
                return { vuoleTesto: stato?.wants_text === true, componendo: stato?.composing === true };
              },
              // I punti scelti con lo strumento del motore di adesso (Media, K6 T12).
              punti: () => {
                const id = ctx.motoreTool;
                const punti = id === null ? undefined : ctx.statoStrumento(id)?.anchors;
                return Array.isArray(punti) ? punti : [];
              },
              rileggiStato: () => {
                const id = ctx.motoreTool;
                if (id !== null && !ctx.disposed) ctx.rileggiStato(id);
              },
              leggi: (ops) => {
                const letto = opsDellEsito(ops);
                return "ops" in letto ? letto.ops : null;
              },
              commit: (ops, nome) => ctx.commit({ name: nome }, gesture(ops)) !== null,
              annuncia: (testo) => ctx.announce(testo),
              diFub: (id) => comandoDiFub(ctx, id),
            },
            // Le voci del client che il Completo fa: la banda, e ≡ › Visualizza.
            clientVoce: (id) => voceClienteCompleto(ctx, id),
            clientStato: (id) => statoClienteCompleto(ctx, id),
          });
          sezioniAperte = aperto.sezioni;
          // Il campo «Testo» di un testo in area scelto c'è adesso (`areaWordsWriter`).
          ctx.syncProperties();
          // Lo strumento del motore aspetta la sua famiglia dal Completo aperto
          // (`sceltaMotore`): una famiglia che non arriva non fa partire il gesto.
          ctx.preparaStrumento = (id) => aperto!.preparaStrumento(id);
          // Il clic senza trascinare di uno strumento di forma apre la sua finestra (T13).
          ctx.clicStrumento = (strumento, punto) => aperto?.clicStrumento(strumento, punto);
          // Le caselle degli strumenti del motore (K6 T11) cambiano col nome e
          // con lo stato della loro famiglia, e la casella accesa con lo
          // strumento scelto: la colonna si risincronizza.
          const risincronizza = (): void => {
            if (!ctx.disposed) ctx.syncRail(ctx.editable());
          };
          ctx.life.add(aperto.ascoltaColonna(risincronizza));
          ctx.life.add(ctx.ascoltaStrumentoMotore(risincronizza));
          completo = "aperto";
          applicaSpazio();
          mostraRisorse();
          ctx.syncRail(ctx.editable());
          // La voce dello zoom della banda sceglie il suo menu solo col Completo
          // presente (`status.ts`): la banda si rilegge adesso.
          ctx.statusChanged();
          options.onWorkspaceChange?.();
        },
        // Un chunk che non arriva: lo spazio di prima resta, e «Riprova» ci
        // riprova.
        () => {
          completo = "fallito";
          options.onWorkspaceChange?.();
        },
      );
    });
  };
  ctx.life.add(onComponents(() => {
    portaCompleto();
    mostraRisorse();
    ctx.syncRail(ctx.editable());
    ctx.statusChanged();
  }));

  ctx.setSpace = (next, toolbar) => {
    if (ctx.disposed) return;
    ctx.space = next;
    ctx.workspace = baseOf(next);
    if (toolbar !== undefined) ctx.column = toolbar;
    // Uno spazio salvato dà la sua colonna, sopra quella dell'utente.
    const salvato = options.spazioSalvato?.(next) ?? null;
    if (salvato !== null) ctx.column = [...salvato.colonna] as ToolId[];
    ctx.root.dataset.workspace = ctx.workspace;
    ctx.rail.element.dataset.size = sizeOf(ctx.workspace);
    full.hidden = fullHidden(ctx.workspace);
    ctx.offer(ctx.featuresOf(ctx.workspace));
    ctx.syncRail(ctx.editable());
    ctx.syncPenOptions();
    portaCompleto();
    applicaSpazio();
    mostraRisorse();
    ctx.statusChanged();
  };
  ctx.resetSpace = applicaSpazio;
  ctx.retryCompleto = () => portaCompleto();
  ctx.completoFailed = () => completo === "fallito";
  ctx.spaceSnapshot = () => ({
    colonna: [...ctx.column],
    scheda: "design",
    sezione: null,
    righelli: ctx.ruler !== null,
  });
  portaCompleto();

  /// Lo spazio scelto da chi disegna: si applica, si dice e si ricorda.
  const choose = (next: string): void => {
    if (next === ctx.space) return;
    ctx.setSpace(next);
    ctx.announce(t("draw.workspace.on", { name: t(next === "full" ? "draw.workspace.full" : "draw.workspace.simple") }));
    options.onWorkspace?.(next);
  };

  // In una scheda lo spazio e la colonna restano quelli dati: si cambiano
  // nel disegno aperto, dove valgono per tutti i disegni.
  ctx.workspaceItems = () => compact ? [] : [
    {
      label: t("draw.workspace"),
      separator: true,
      submenu: true,
      items: (["full", "simple"] as const).map(
        (each): MenuItem => ({
          label: t(each === "full" ? "draw.workspace.full" : "draw.workspace.simple"),
          description: t(each === "full" ? "draw.workspace.full.hint" : "draw.workspace.simple.hint"),
          choice: "radio",
          checked: ctx.workspace === each,
          run: () => choose(each),
        }),
      ),
    },
    { label: t("draw.toolbar.customize"), run: () => ctx.customizeToolbar() },
  ];

  ctx.customizeToolbar = () => {
    if (ctx.asking || ctx.disposed) return;
    ctx.asking = true;
    ctx.cancelGesture();
    const before = ctx.column;
    const standard = defaultColumn(ctx);
    /// La colonna come si salva: vuota se è quella di serie.
    const saved = (on: readonly string[]): ToolId[] =>
      on.length === standard.length && on.every((id, at) => id === standard[at]) ? [] : (on as ToolId[]);
    const shown = columnOf(ctx, before);
    const name = (id: ToolId): string => t(ctx.toolLabel(id));
    void openToolbarDialog({
      rows: [...shown.map((id) => ({ id, name: name(id), on: true })), ...standard.filter((id) => !shown.includes(id)).map((id) => ({ id, name: name(id), on: false }))],
      standard,
      fixed: "select",
      // L'anteprima: la colonna vera cambia mentre si sceglie.
      preview: (on) => {
        if (ctx.disposed) return;
        ctx.column = saved(on);
        ctx.syncRail(ctx.editable());
      },
      announce: ctx.announce,
      lifetime: ctx.life,
    }).then((chosen) => {
      ctx.asking = false;
      if (ctx.disposed) return;
      ctx.column = chosen === null ? before : saved(chosen);
      ctx.syncRail(ctx.editable());
      if (chosen === null) return;
      ctx.announce(t("draw.toolbar.saved"));
      options.onToolbar?.(ctx.column);
    });
  };
}
