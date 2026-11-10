# Documentazione di Fub

Questa è la porta della documentazione: una riga per pagina, e per prima
cosa la domanda «che cosa devi fare?». La documentazione descrive **ciò che
esiste**; le attività eseguibili vivono nelle GitHub Issues; una decisione
costosa da invertire vive negli ADR; la cronologia resta in Git.

```mermaid
flowchart LR
    START["Che cosa devi fare?"] --> ORIENTA["Orientarsi"]
    START --> USARE["Usare o capire Fub"]
    START --> CODE["Modificare il codice"]
    START --> DESIGN["Capire l'architettura"]
    START --> STATUS["Vedere stato e direzione"]
    ORIENTA --> MAP["map/"]
    USARE --> PRODUCT["product/"]
    CODE --> DEV["development/"]
    DESIGN --> ARCH["architecture/ e reference/"]
    STATUS --> PROJECT["project/ e decisions/"]
```

## Orientarsi

| Pagina | Risponde |
|---|---|
| [La mappa del repository](map/repo.md) | dove sta ogni cosa, e come si prova da sola |
| [Chi possiede che cosa](map/ownership.md) | ogni regola, il file che la possiede e il test che la presidia |
| [Dove sta X](map/dove-sta-x.md) | un tipo, un comando, un'impostazione: il file che lo definisce |
| [Le pagine per domanda](map/pagine.md) | ogni pagina di `docs/`, con la domanda a cui risponde |
| [Le sigle](map/sigle.md) | che cosa sono K3, N6, P17, M5, S1, T17, D07, A1 |
| [Orientarsi nella repository](getting-started/repository-tour.md) | il percorso guidato, per chi comincia |

## Iniziare

- [Installare, avviare e verificare](getting-started/install-and-run.md)

## Capire il prodotto

| Pagina | Risponde |
|---|---|
| [Panoramica](product/overview.md) | che cosa offre Fub |
| [Vault e file](product/vault-and-files.md) | che cosa Fub legge, scrive e conserva |
| [Operazioni sul vault](product/vault-operazioni.md) | note, cartelle, cattura, import/export |
| [Recupero e versioni](product/vault-recupero-e-versioni.md) | cestino, rinomine, versioni, snapshot |
| [Explorer e cartelle](product/explorer-and-folders.md) | l'albero, le appuntate, gli spazi |
| [Editor e anteprima](product/editor-and-preview.md) | le superfici di scrittura |
| [Blocchi](product/editor-blocks.md) | la superficie a blocchi |
| [Tasto destro, mini-barra e «/»](product/editor-menus.md) | i menu degli editor |
| [Correttore](product/proofing.md) | l'ortografia mentre si scrive |
| [Documenti di Word](product/word-documents.md) | la videoscrittura nel vault |
| [Annotazioni dei PDF](product/pdf-annotations.md) | scrivere accanto ai PDF |
| [File delle app Craft](product/craft-files.md) | disegni, immagini e foto delle app Craft |
| [Ricerca, link e grafo](product/search-links-and-graph.md) | trovare e seguire |
| [Importare ed esportare](product/import-and-export.md) | dentro e fuori dal vault |
| [Plugin ed estensioni](product/plugins-and-extensions.md) | come Fub cresce |
| [Budget prestazionali](product/performance-budget.md) | i numeri e i gate della CI |
| [Criteri di accettazione](product/acceptance.md) | quando una modifica è accettabile |

I disegni sono una famiglia di pagine, con l'indice dentro
[Disegni](product/drawing.md): dalla penna alle tavole, dall'import
all'export, dalla sessione dal tablet ai disegni grandi.

## Capire l'architettura

- [Vista d'insieme](architecture/overview.md) e
  [Componenti e confini](architecture/components-and-boundaries.md)
- [Modello del documento](architecture/document-model.md) e
  [Storage e identità](architecture/storage-and-identity.md)
- [Runtime, eventi e job](architecture/runtime-events-and-jobs.md)
- [Frontend e IPC](architecture/frontend-and-ipc.md) e
  [la cornice del telefono](architecture/phone-frame.md)
- [Superfici dell'editor](architecture/editor-surfaces.md), la
  [superficie ricca e il correttore](architecture/rich-surface-and-proofing.md)
  e la [superficie dei fogli](architecture/grid-surface.md), con gli
  [editor dei componenti](architecture/component-editors.md)
- [Inchiostro e strumenti](architecture/ink-and-tools.md)
- [Runtime dei plugin](architecture/plugin-runtime.md), i [provider WASM](architecture/wasm-providers.md) e [capability e sandbox](architecture/plugin-security.md)
- [Lo strato dei motori](architecture/motori.md)

## Sviluppare

- [Workflow](development/workflow.md) e [test e qualità](development/testing-and-quality.md)
- Prove manuali: [l'inchiostro](development/ink-input-smoke-test.md) e [il moto](development/motion-smoke-test.md)
- [Le misure nella WebView](development/webview-measurements.md) e [le misure prese](misure/README.md)
- [Creare un plugin](development/plugin-authoring.md)
- [Stile della documentazione](development/documentation-style.md) e [versionamento e release](development/versioning-and-releases.md)

## Consultare i contratti

- [ABI e WIT](reference/abi-and-wit.md), [contratto IPC](reference/ipc-contract.md)
  (con il [contratto dei componenti](reference/components-contract.md)),
  [layout su disco](reference/on-disk-layout.md) e
  [permessi e sicurezza](reference/permissions-and-security.md)
- [Il formato della scena](reference/scene-format.md) con le sue
  pagine di dettaglio, e le
  [operazioni sulla scena](reference/scene-operations.md)
- [Le annotazioni PDF](reference/annotation-format.md), la
  [proiezione dei documenti di videoscrittura](reference/rich-projection.md)
  e la [sessione live](reference/live-session.md)
- [Il formato della lavagna](reference/canvas-format.md): il nucleo
  `fub-canvas-core` e le regole di lettura e scrittura delle `.canvas`, e
  le [operazioni sulla lavagna](reference/canvas-operations.md): le toppe e
  la loro inversa
- [Il server MCP](reference/mcp-server.md)
- [I formati dei file Craft](reference/craft-formats.md), gli
  [XMP accanto alle foto](reference/xmp-sidecars.md) e le
  [app esterne](reference/external-editors.md)

## Vedere stato e direzione

- [Stato del progetto](project/status.md): dove siamo, l'ordine di lavoro, il
  rilascio e lo stato di M5
- [Runtime dei plugin](architecture/plugin-runtime.md), con i
  [provider WASM](architecture/wasm-providers.md)

## Capire le decisioni

- [Indice ADR](decisions/README.md)

## Gerarchia delle fonti

Quando due fonti divergono, usa questo ordine:

1. codice e test;
2. WIT, schemi e formati persistenti;
3. pagine architetturali e riferimenti canonici;
4. ADR, limitatamente alla motivazione;
5. stato e TODO attivi;
6. cronologia Git.

Una pagina non sostituisce il codice. Deve spiegare i confini, i flussi e le
proprietà che una persona deve conoscere per modificarlo senza romperli.
