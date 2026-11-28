// La porta del banco (`fake-ipc.ts`), primo pezzo: i parametri dell'indirizzo
// (`params`) e i casi che ne nascono al caricamento (grafo, connettori,
// cartella grande, albero, Live), coi loro `globalThis.__fub*`.
// I pezzi girano al caricamento nell'ordine di prima: ognuno importa solo
// quelli che vengono prima.

import type { IndexQuery } from "../src/host/contract";
import { CONNECTORS_DOC, connectorsFixture, type ConnectorsFixture } from "./connectors-fixture";
import { LARGE_DOC, largeFixture, type LargeFixture } from "./large-fixture";
import { LIVE_DOC, liveCase } from "./live-fixture";
import { treeFixture, type TreeFixture } from "./vault-fixture";
import {
  generateGraphFixture as graphFixture,
  type GraphFixture,
} from "./graph-fixture";

export type GraphBenchMetadata = Readonly<{
  fixture: Readonly<{
    nodes: readonly string[];
    edges: readonly { readonly from: string; readonly to: string }[];
    seed: number;
    digest: string;
  }> | null;
}>;

/// Ciò che le scene del disegno (`scene.mjs`) leggono del disegno dei
/// connettori: dove sta, le forme e i connettori con ciò che li unisce, i nodi.
export type ConnectorsBenchMetadata = Readonly<{
  fixture: Readonly<{
    doc: string;
    shapes: ConnectorsFixture["shapes"];
    connectors: ConnectorsFixture["connectors"];
    hubs: ConnectorsFixture["hubs"];
    labels: ConnectorsFixture["labels"];
    elements: number;
    bytes: number;
    digest: string;
  }> | null;
}>;

/// Ciò che il banco dell'albero (`tree.mjs`) legge del vault che apre: le
/// cartelle, la catena, il nome lungo e la nota da cercare, e quando ogni
/// risposta dell'indice è arrivata al client.
export type TreeBenchMetadata = Readonly<{
  fixture: Readonly<{
    total: number;
    folders: TreeFixture["folders"];
    big: string;
    chain: TreeFixture["chain"];
    deepest: string;
    longName: string;
    target: string;
    digest: string;
  }> | null;
  arrivals: TreeArrival[];
}>;

/// Una risposta dell'indice durante il banco dell'albero: di che specie è la
/// domanda, di quale cartella (`scope`, `null` se non ne ha una), e l'ora della
/// domanda e quella della risposta, in millisecondi dall'avvio della pagina. Il
/// finto risponde sul thread della pagina, quindi il suo tempo sta dentro i
/// fotogrammi: il banco lo conta a parte.
type TreeArrival = {
  kind: IndexQuery["kind"];
  scope: string | null;
  descendants: boolean | null;
  requestedAt: number;
  answeredAt: number;
};

/// Ciò che il banco delle scene grandi (`large.mjs`) legge del disegno che
/// apre: dove sta, quanto è grande, il rettangolo da scegliere.
export type LargeBenchMetadata = Readonly<{
  fixture: Readonly<{
    doc: string;
    elements: number;
    objects: number;
    strokes: number;
    size: LargeFixture["size"];
    cells: number;
    columns: number;
    target: LargeFixture["target"];
    bytes: number;
    digest: string;
  }> | null;
}>;

// ---------------------------------------------------------------------------
// Ciò che il banco decide dalla query string.
// ---------------------------------------------------------------------------

export const params = new URLSearchParams(globalThis.window.location.search);

const graphNodesParam = params.get("graphNodes");
const graphSeedParam = params.get("graphSeed");
export let GRAPH_PAYLOAD: { nodes: string[]; edges: { from: string; to: string }[] } | null = null;
let GRAPH_FIXTURE: GraphFixture | null = null;

if (graphNodesParam === null) {
  if (graphSeedParam !== null) {
    throw new RangeError("graphSeed requires graphNodes");
  }
} else {
  const nodeCount =
    graphNodesParam === "2000" ? 2_000 : graphNodesParam === "10000" ? 10_000 : null;
  if (nodeCount === null) {
    throw new RangeError("graphNodes must be 2000 or 10000");
  }

  let seed = 6;
  if (graphSeedParam !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(graphSeedParam)) {
      throw new RangeError("graphSeed must be a canonical decimal uint32");
    }
    seed = Number(graphSeedParam);
    if (seed > 0xffff_ffff) {
      throw new RangeError("graphSeed must be a canonical decimal uint32");
    }
  }

  GRAPH_FIXTURE = graphFixture(nodeCount, seed);
  Object.freeze(GRAPH_FIXTURE.nodes);
  for (const edge of GRAPH_FIXTURE.edges) Object.freeze(edge);
  Object.freeze(GRAPH_FIXTURE.edges);
  Object.freeze(GRAPH_FIXTURE);
  GRAPH_PAYLOAD = { nodes: GRAPH_FIXTURE.nodes, edges: GRAPH_FIXTURE.edges };
}

globalThis.__fubGraphBench = Object.freeze({
  fixture: GRAPH_FIXTURE
    ? Object.freeze({
        nodes: GRAPH_FIXTURE.nodes,
        edges: GRAPH_FIXTURE.edges,
        seed: graphSeedParam === null ? 6 : Number(graphSeedParam),
        digest: GRAPH_FIXTURE.digest,
      })
    : null,
});

// `?connectors=N` mette nel vault il disegno di N connettori
// (`connectors-fixture.ts`), con due forme ogni tre connettori, accende la
// feature `draw`, che apre un `.svg` come disegno, e mette l'editor al livello
// Standard. Senza, il vault e le impostazioni restano quelli che le foto
// conoscono.
//
// Questo modulo sta nel giro fra le stringhe della shell e l'host
// (`i18n/strings.ts` legge le impostazioni dall'host, che qui è lui): ciò che
// importa si valuta mentre le stringhe sono a metà. Perciò i due disegni si
// fanno coi moduli dell'editor che non leggono le stringhe: un catalogo
// valutato qui troverebbe quello della shell non ancora pronto, e la pagina
// del catalogo del banco non partirebbe.
const connectorsParam = params.get("connectors");
export let CONNECTORS: ConnectorsFixture | null = null;
if (connectorsParam !== null) {
  if (!/^[1-9]\d*$/.test(connectorsParam)) throw new RangeError("connectors must be a positive decimal integer");
  CONNECTORS = connectorsFixture(Number(connectorsParam));
}

globalThis.__fubConnectorsBench = Object.freeze({
  fixture: CONNECTORS
    ? Object.freeze({
        doc: CONNECTORS_DOC,
        shapes: CONNECTORS.shapes,
        connectors: CONNECTORS.connectors,
        hubs: CONNECTORS.hubs,
        labels: CONNECTORS.labels,
        elements: CONNECTORS.elements,
        bytes: new TextEncoder().encode(CONNECTORS.text).length,
        digest: CONNECTORS.digest,
      })
    : null,
});

// `?large=N` mette nel vault la lavagna di N elementi del banco delle scene
// grandi (`large-fixture.ts`), e accende l'editor come `?connectors=N`. Non
// sta insieme all'altro disegno.
const largeParam = params.get("large");
export let LARGE: LargeFixture | null = null;
if (largeParam !== null) {
  if (CONNECTORS !== null) throw new RangeError("large is a drawing of its own");
  if (!/^[1-9]\d*$/.test(largeParam)) throw new RangeError("large must be a positive decimal integer");
  LARGE = largeFixture(Number(largeParam));
}

globalThis.__fubLargeBench = Object.freeze({
  fixture: LARGE
    ? Object.freeze({
        doc: LARGE_DOC,
        elements: LARGE.elements,
        objects: LARGE.objects,
        strokes: LARGE.strokes,
        size: LARGE.size,
        cells: LARGE.cells,
        columns: LARGE.columns,
        target: LARGE.target,
        bytes: new TextEncoder().encode(LARGE.text).length,
        digest: LARGE.digest,
      })
    : null,
});

// `?vault=5000` mette nel vault i cinquemila file del banco dell'albero
// (`vault-fixture.ts`), e basta: né il corpus né la scenografia, perché
// l'albero conta i file del vault e non deve contarne altri. `TREE_ARRIVALS`
// dice quando ogni risposta dell'indice arriva al client: il primo disegno si
// misura da lì.
export const TREE: TreeFixture | null = params.get("vault") === "5000" ? treeFixture() : null;
export const TREE_ARRIVALS: TreeArrival[] = [];

globalThis.__fubTreeBench = Object.freeze({
  fixture: TREE
    ? Object.freeze({
        total: TREE.total,
        folders: TREE.folders,
        big: TREE.big,
        chain: TREE.chain,
        deepest: TREE.deepest,
        longName: TREE.longName,
        target: TREE.target,
        digest: TREE.digest,
      })
    : null,
  arrivals: TREE_ARRIVALS,
});

// `?live=<caso>` mette nel vault la nota delle scene della Live
// (`live-fixture.ts`), con il punto del cursore che la scena legge da qui.
// Soltanto le scene che la chiedono la hanno.
export const LIVE = liveCase(params.get("live"), params.get("testo"));

globalThis.__fubLiveBench = Object.freeze({
  doc: LIVE === null ? null : LIVE_DOC,
  cursor: LIVE?.cursor ?? null,
  head: LIVE?.head ?? null,
});
