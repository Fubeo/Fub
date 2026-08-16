// La vista grafo del vault: renderer force-directed su Canvas.
//
// # Cosa è questo file, dalla §3.3
//
// **La metà shell di un componente che sta di là dal confine.** Il grafo è un
// `ViewProvider` (`crates/fub-features/src/graph.rs`): è lui a chiedere al
// canale dati quali documenti ci sono e quali archi li legano, e a mandarli qui
// dentro un `UiKind::Custom { ns: "fub:graph", payload }`. Questo file non parla
// con il kernel: riceve un payload e disegna.
//
// La divisione è quella che il §3.3 chiedeva, e la riga passa dove deve. `UiNode`
// non esprime un canvas, **né deve** — un protocollo dichiarativo che esprimesse
// un force-directed sarebbe un motore grafico travestito da enum — quindi il
// disegno resta di qua. Ciò che è passato di là sono i **dati**, che era la
// parte davvero privilegiata: finché a decidere nodi e archi era questo file, la
// vista a grafo era una cosa che solo la shell poteva fare.
//
// Di conseguenza questo modulo non è più un pannello e non ha più un overlay.
// Non si registra in `ui/panel-host.ts` — chi si registra è il pannello che
// `ui/views.ts` crea per il riquadro che ospita la view — e non sa **dove** sta
// disegnando: riceve un elemento, e quell'elemento è un riquadro dell'area
// principale, cioè una superficie con tab, che si divide e che si ricorda com'era.
//
// # Il 2.0: l'orchestratore sottile
//
// La fisica, il disegno e l'interazione stanno nei lotti B (`sim/*`,
// `render/*`, `interazione.ts`); qui resta solo il binding: leggere il payload,
// caricare la conf (`config.ts`), creare il `grafico` e il `pannello-fisica`,
// e collegarli agli eventi della shell (il segnale `layout` per le note aperte,
// `onLingua` per i testi). Il dispose restituisce lo smontaggio di entrambi.

import { apriVistaIn, documenti, layout, pane, panes } from "../state/layout";
import { registerCustomRenderer, type OnAction } from "../ui/custom";
import { registerShellCommand } from "../ui/commands";
import { $ } from "../ui/dom";
import { on } from "../state/store";
import { onLingua, t } from "../i18n/strings";
import { caricaConf, salvaConf } from "../graph/config";
import { creaGrafico } from "../graph/grafico";
import { creaPannelloFisica, type TestiPannello } from "../graph/pannello-fisica";

/// Il namespace con cui il grafo arriva dal provider. È `fub_features::graph::GRAPH_NS`,
/// e la costanza dei due nomi è il contratto fra le due metà del componente.
export const NS_GRAFO = "fub:graph";
/// L'id della `ViewSpec` che il provider dichiara (`fub_features::graph::GRAPH_VIEW`).
///
/// Che questo file lo conosca **non** è la conoscenza privata che il §1.2 ha
/// tolto ai pannelli: quella era la shell che sapeva quali pannelli esistono.
/// Questo è un componente che conosce il proprio altro capo — la stessa cosa che
/// fa già con lo `ns` — e i due nomi viaggiano insieme perché nominano lo stesso
/// componente.
export const VISTA_GRAFO = "graph";

/// L'azione con cui si chiede al provider di aprire una nota, e la chiave del
/// suo payload. Gemelle di `OPEN` e `DOC` in `graph.rs`.
const APRI = "open";
const DOC = "doc";


/// Ciò che arriva nel `payload` del nodo custom. La forma la decide `graph.rs`,
/// e questo tipo è la sua lettura di qua: se le due divergono, il grafo si
/// disegna vuoto invece di lanciare — un payload storto viene da un provider, e
/// un provider può essere di terzi.
interface DatiGrafo {
  nodes: string[];
  edges: { from: string; to: string }[];
}

/// Attacca la metà shell del grafo: il renderer del suo `ns` e il comando che lo
/// apre.
export function mountGraph(): void {
  $("#show-graph").addEventListener("click", () => apriGrafo());

  // Il grafo come **comando** (§18.2): era un bottone nella barra, e chi non lo
  // trovava con il mouse non lo trovava. L'id e la scorciatoia sono quelli di
  // prima — chi li ha imparati li tiene — ed è cambiato cosa fa: apriva un
  // overlay sopra tutto, adesso apre una tab nel riquadro col fuoco. Che sia un
  // comando è la parte che la 0077 ha reso non negoziabile.
  registerShellCommand({
    id: "shell.graph",
    title: "commands.graph",
    description: "commands.graph.desc",
    run: () => apriGrafo(),
  });

  registerCustomRenderer(NS_GRAFO, disegnaGrafo);
}

/// Apre il grafo nel riquadro col fuoco.
///
/// **Nel riquadro col fuoco e non in uno nuovo**, che è la stessa regola con cui
/// si apre una nota dall'esploratore: chi lo vuole di lato divide prima, ed è un
/// gesto che ha già un comando suo (`shell.pane.split.right`). L'alternativa —
/// dividere da sé — deciderebbe al posto dell'utente come vuole la finestra, e
/// lo farebbe ogni volta.
///
/// Se la tab c'è già ci si sposta sopra: lo garantisce `apriVistaIn`, e per il
/// grafo conta più che per una nota — due tab sullo stesso grafo sarebbero due
/// simulazioni che girano insieme.
function apriGrafo(): void {
  apriVistaIn(layout.focus, VISTA_GRAFO);
}

/// I documenti aperti in un riquadro qualunque: sono i nodi che il grafo accende.
///
/// Erano **uno** — la nota attiva — e con N riquadri non lo sono più. Prenderne
/// uno solo vorrebbe dire scegliere fra due note che l'utente sta guardando
/// entrambe; e la nota «attiva» sarebbe per giunta `null` proprio mentre si
/// guarda il grafo, visto che il fuoco ce l'ha lui.
function apertiOra(): Set<string> {
  return new Set(
    panes().flatMap((id) => {
      const p = pane(id);
      return p ? documenti(p) : [];
    }),
  );
}

/// Legge il payload del provider, con la tolleranza che si deve a un dato che
/// viene da fuori.
function leggiDati(payload: unknown): DatiGrafo {
  const o = (payload ?? {}) as Partial<DatiGrafo>;
  const nodes = Array.isArray(o.nodes) ? o.nodes.filter((n) => typeof n === "string") : [];
  const edges = Array.isArray(o.edges)
    ? o.edges.filter(
        (e): e is { from: string; to: string } =>
          !!e && typeof e.from === "string" && typeof e.to === "string",
      )
    : [];
  return { nodes, edges };
}

/// Costruisce i testi del pannello nella lingua corrente. Le chiavi dei campi
/// e dei preset sono letterali, così il compilatore verifica che ogni
/// `t(chiave)` sia una chiave vera del catalogo — niente cast.
function testiPannello(): TestiPannello {
  const presets: Record<string, string> = {
    organica: t("graph.preset.organica"),
    costellazione: t("graph.preset.costellazione"),
    alveare: t("graph.preset.alveare"),
    nebulosa: t("graph.preset.nebulosa"),
    rigido: t("graph.preset.rigido"),
    custom: t("graph.preset.custom"),
  };
  const campi: Record<string, string> = {
    repulsione: t("graph.conf.repulsione"),
    lunghezzaBase: t("graph.conf.lunghezzaBase"),
    rigiditaMolla: t("graph.conf.rigiditaMolla"),
    smorzamentoMolla: t("graph.conf.smorzamentoMolla"),
    gravita: t("graph.conf.gravita"),
    attrito: t("graph.conf.attrito"),
    maxVelocita: t("graph.conf.maxVelocita"),
    pesoGrado: t("graph.conf.pesoGrado"),
    collisioni: t("graph.conf.collisioni"),
    theta: t("graph.conf.theta"),
    jitter: t("graph.conf.jitter"),
    raffreddamento: t("graph.conf.raffreddamento"),
    glow: t("graph.conf.glow"),
    pulse: t("graph.conf.pulse"),
    trail: t("graph.conf.trail"),
    griglia: t("graph.conf.griglia"),
    curvaturaArchi: t("graph.conf.curvaturaArchi"),
    densitaEtichette: t("graph.conf.densitaEtichette"),
  };
  return {
    titolo: t("graph.conf.titolo"),
    preset: t("graph.conf.preset"),
    riscalda: t("graph.conf.riscalda"),
    sblocca: t("graph.conf.sblocca"),
    reimposta: t("graph.conf.reimposta"),
    apri: t("graph.conf.apri"),
    chiudi: t("graph.conf.chiudi"),
    presets,
    campi,
  };
}

/// Il renderer di `fub:graph`: disegna il grafo dentro `host` e restituisce
/// come spegnerlo. Sottile: la fisica, il disegno e l'interazione stanno nei
/// lotti B; qui si legano a una conf persistente, un pannello di fisica e
/// gli eventi della shell (layout, lingua).
function disegnaGrafo(host: HTMLElement, payload: unknown, onAction: OnAction): () => void {
  const dati = leggiDati(payload);
  const conf = caricaConf();
  const grafico = creaGrafico({ conf, dati });
  const pannello = creaPannelloFisica({
    conf,
    onCambia: (c) => {
      salvaConf(c);
      grafico.impostaConf(c);
    },
    onRiscalda: () => grafico.riscalda(0.6),
    onSbloccaPanni: () => grafico.sbloccaNodi(),
    testi: testiPannello,
    riportaFocus: () => {
      const c = host.querySelector<HTMLCanvasElement>("canvas.graph-main");
      if (c) c.focus();
    },
  });
  // L'apertura nota: il grafico non conosce `onAction`, lo riceve qui.
  grafico.apri = (id: string) => onAction({ action: APRI, payload: { [DOC]: id } }, []);

  // Il conto di nodi e archi: sopra il canvas, annotazione non testata.
  const conto = document.createElement("div");
  conto.className = "graph-count";
  conto.textContent = t("graph.count", { note: dati.nodes.length, archi: dati.edges.length });

  grafico.monta(host);
  host.append(conto, pannello.elemento);
  grafico.impostaAperti(apertiOra());
  grafico.impostaEtichettaA11y(t("graph.a11y.superficie", { note: dati.nodes.length, archi: dati.edges.length }));

  let disposed = false;

  // `on` non ha unsubscribe (§9.4): i moduli shell vivono quanto la finestra.
  // La guard `disposed` ferma il callback quando il grafo è smontato, e il
  // commento dice perché non c'è un `off` da chiamare nel dispose.
  on("layout", () => {
    if (disposed) return;
    grafico.impostaAperti(apertiOra());
  });

  const smontaLingua = onLingua(() => {
    if (disposed) return;
    conto.textContent = t("graph.count", { note: dati.nodes.length, archi: dati.edges.length });
    grafico.impostaEtichettaA11y(t("graph.a11y.superficie", { note: dati.nodes.length, archi: dati.edges.length }));
    pannello.aggiornaLingua();
  });

  return () => {
    disposed = true;
    smontaLingua();
    grafico.smonta();
    pannello.distruggi();
  };
}
