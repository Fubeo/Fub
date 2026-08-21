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
- **Job** — la chiamata al modello (locale o cloud) è lavoro lungo: **mai**
  dentro `invoke`/`handle`. Il comando raccoglie il contesto (sincrono, breve),
  fa `HostApi::spawn_job` col prompt nel payload e ritorna; il completamento
  arriva come `Event::JobDone` e solo lì si scrive nel vault — il pattern del
  contratto, vedi [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md),
  "Lavoro lungo: i job".
- `EventHandler` — suggerimenti reattivi (es. su `DocumentChanged`), se/quando si
  vorrà un autocomplete "ambientale"; riceve anche i `JobDone`.
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

- Streaming dei token nell'editor: `JobDone` consegna un esito unico; lo
  streaming richiederebbe un canale di **progresso dei job** nel contratto.
  Da decidere **entro il freeze di M4** se aggiungerlo (vedi
  [M4](../milestones/M4-wit-hardening.md)) o accettare completamenti non
  incrementali.
- Gestione del contesto (finestra, note collegate, RAG sul vault via
  `IndexProvider`).
- Costi/limiti e UX offline↔online.

Nessuno di questi tocca il contratto dei trait: è il motivo per cui l'AI può
restare un'appendice e non un vincolo architetturale.
