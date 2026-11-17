// La regola di classificazione di §4: che cosa della scena è modificabile e
// che cosa è estraneo. È `classify.rs` di `fub-scene`.
//
// Si parte dalla radice, che non si classifica, e si scende solo dentro i
// contenitori modificabili (`g` e `a`), dove ogni figlio si giudica da sé. Un
// elemento di qualunque altro tag è un'unità con i suoi figli: o è tutto
// modificabile o è tutto estraneo. I nodi estranei contigui, con gli spazi fra
// loro, diventano un solo blocco, che la superficie disegna come uno strato
// inerte; gli spazi fra un elemento modificabile e un blocco non sono di
// nessuno.
//
// La visita usa una pila esplicita, non la ricorsione: un SVG con centomila
// gruppi annidati è un file valido, e non deve esaurire lo stack.
//
// Le risorse stanno nelle `defs` della radice (formato della scena, risorse), e
// un oggetto le usa per riferimento: un oggetto è modificabile solo se ciò a
// cui rimanda lo è. Per questo la lettura passa due volte: prima giudica le
// risorse, le sfumature e poi le altre, che possono usare le sfumature nel loro
// contenuto; poi classifica il documento chiedendo a quell'indice che cosa è
// ogni id. Il tracciato di un testo su tracciato è anch'esso una risorsa, un
// `path` nelle `defs` della radice (formato della scena, testo).
//
// Il codice sta in `classify/`: le voci, i tag e i tipi delle risorse
// (`types.ts`), gli attributi ammessi (`attributes.ts`), i fatti di stili,
// campioni e motivi (`facts.ts`), le risorse e i simboli (`resources.ts`), le
// ripetizioni, l'indice delle risorse e il giudizio di un figlio
// (`children.ts`), i dettagli di un elemento (`describe.ts`) e la visita del
// documento (`document.ts`). Questo file ne ri-esporta i nomi pubblici.

export {
  MAX_DEPTH,
  isResourceTag,
  resourceKind,
  STYLE_GRAPHIC_POINTS,
  NO_RESOURCES,
  type Tags,
  type Layer,
  type RootItem,
  type ConnectorFacts,
  type ElementItem,
  type ForeignItem,
  type Item,
  type Tag,
  type ResourceTag,
  type ResourceKind,
  type Lifecycle,
  type StyleFacts,
  type SwatchFacts,
  type MotifFacts,
  type Resolve,
  type Place,
} from "./classify/types";
export { motifOf, swatchOf, styleKindOf, styleOf } from "./classify/facts";
export { tagOf, svgAttribute, characterData, firstTitle, lineText, textPathOf, textPathTarget } from "./classify/attributes";
export { MAX_STOPS, MAX_PRIMITIVES, MAX_CONTENT_DEPTH, resourceFault, referencesOf, symbolAllowed, type ResourceFault } from "./classify/resources";
export { repeatOf, originalsOf, withOriginals, withArrivingSymbols, resourceIndex, styleIndex, localGradients, classifyChild, boardBox, type Styles } from "./classify/children";
export { readStroke, followedKind, describe, elementItem, type Details, type StrokeProblem } from "./classify/describe";
export { classifyDocument, type Classified } from "./classify/document";
