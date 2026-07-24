# Appendice — Autocompletamento AI (design, non milestone)

Torna a [../PIANO.md](../PIANO.md).

L'autocompletamento AI **non è un milestone numerato**: è deliberatamente rimandato
e progettato come **plugin core** costruito sui trait esistenti, così da non
condizionare l'architettura. Questa appendice fissa l'approccio per non doverlo
reinventare quando arriverà (dopo che il confine plugin di [M5](../milestones/M5-wasm-runtime.md)
è pronto).

## Principio

L'AI è **un plugin come gli altri**: nessun gancio speciale nel kernel. Si aggancia
ai trait già definiti in [../architecture/traits.md](../architecture/traits.md):

- `CommandProvider` — comandi espliciti ("continua il paragrafo", "riassumi la
  selezione", "genera da prompt"), con `CommandOutcome.notify` per il feedback.
- `EventHandler` — suggerimenti reattivi (es. su `DocumentChanged`), se/quando si
  vorrà un autocomplete "ambientale".
- `HostApi` — lettura del contesto (`read_document`) e scrittura del risultato
  (`write_document`); `storage_get/set` per configurazione e cache.
- `ViewProvider` (opzionale) — un pannello dichiarativo per cronologia/impostazioni.

## Backend: locale + cloud

Doppio backend dietro un'astrazione interna al plugin:

- **Locale** — modello on-device (via runtime locale) per privacy e uso offline.
- **Cloud** — provider remoto per qualità/velocità superiori. Per il default cloud si
  punta ai **modelli Claude più capaci** (famiglia Claude più recente); l'accesso
  rete passa dal permesso `network` del manifest
  (vedi [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md)).

Selezione del backend nei settings (form dichiarativi introdotti a
[M3](../milestones/M3-editor-fidelity.md)); chiavi/API-token nello storage
per-plugin.

## Requisiti di supporto (da avere prima)

- **M3** — command palette e settings dichiarativi (superficie utente dell'AI).
- **M5** — confine plugin + permesso `network` applicato (se distribuito come plugin
  WASM di terzi). Come plugin **core nativo** potrebbe arrivare anche prima, ma
  resta fuori dalla sequenza M2–M5 per non spostare il focus.

## Nodi aperti (da decidere quando si affronta)

- Streaming dei token nell'editor (serve un canale evento/IPC incrementale?).
- Gestione del contesto (finestra, note collegate, RAG sul vault via
  `IndexProvider`).
- Costi/limiti e UX offline↔online.

Nessuno di questi tocca il contratto dei trait: è il motivo per cui l'AI può
restare un'appendice e non un vincolo architetturale.
