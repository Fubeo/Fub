# Funzionalità di Fub

Questa pagina è la sintesi canonica dello stato del prodotto. Il capitolato
completo è in [`features/`](features/README.md); i gesti più piccoli sono in
[`microfeatures/`](microfeatures/README.md).

## Implementato

### Vault e documenti

- apertura di una cartella locale come vault;
- lettura e scrittura di note Markdown con frontmatter YAML;
- riconoscimento di wikilink, tag, callout ed embed previsti dal provider Markdown;
- creazione, rinomina, spostamento, eliminazione e recupero dal cestino;
- watcher del filesystem e aggiornamento degli indici dopo modifiche esterne.

### Ricerca e conoscenza

- ricerca full-text indicizzata;
- link in uscita e backlink;
- risoluzione di nomi, alias e percorsi;
- tag, outline e altre query ufficiali;
- graph view navigabile.

### Scrittura e navigazione

- editor CodeMirror 6;
- anteprima e navigazione dei collegamenti;
- file explorer e pannelli della shell;
- palette dei comandi e impostazioni;
- protocollo di UI dichiarativa per viste e azioni dei provider.

### Architettura di estensione

- contratto comune in `fub-abi`;
- provider nativi per formato e funzionalità ufficiali;
- registro dei provider, eventi, capacità e policy nel kernel/host;
- contratto WIT `fub:abi@0.1.1` con disciplina additiva.

## Parziale

### Plugin WASM di terzi

Il runtime Wasmtime è presente e attraversa già le superfici iniziali del
contratto. Non tutte le famiglie di provider hanno ancora un adattatore completo
e l'esperienza di installazione/distribuzione non è conclusa. Lo stato preciso è
in [`PIANO.md`](PIANO.md) e nella milestone
[`M5-wasm-runtime.md`](milestones/M5-wasm-runtime.md).

### Temi installabili

La shell dispone di un sistema di temi e di sorgenti generate, ma alcune scelte
su caricamento, selezione e scheda del tema sono ancora aperte. Sono elencate in
[`todo.md`](todo.md).

## Pianificato o differito

Le idee future non vengono presentate come funzioni disponibili. Sono raccolte
nel capitolato e diventano lavoro operativo soltanto quando entrano in
[`PIANO.md`](PIANO.md) o [`todo.md`](todo.md).

Esempi già differiti con un criterio esplicito:

- layout salvati con nome;
- voci derivate nell'anagrafe del vault;
- query incorporate nelle note;
- parsing localizzato dei nomi dei mesi;
- rendering incrementale dell'anteprima;
- payload aggiuntivi per regole sintattiche di terzi.

## Come leggere gli inventari

Una casella `[ ]` nei file di `features/` o `microfeatures/` descrive un
requisito o un gesto da coprire. Non equivale automaticamente a “non
implementato”. Per conoscere lo stato usare questa pagina, il piano e il backlog.
