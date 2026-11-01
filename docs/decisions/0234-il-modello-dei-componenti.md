# 0234 — Il modello dei componenti

- **Stato:** accolta
- **Data:** 2026-11-01
- **Ambito:** host
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Fub diventa un programma a componenti: le note, il grafo, il correttore, i
documenti, i fogli e, più avanti, i motori delle app Craft si accendono e si
spengono, e un componente spento non costa niente. Per farlo servono tre
risposte che prima stavano sparse: di quali componenti è fatto Fub, chi
richiede chi, e perché un componente è acceso.

Le feature Cargo dicono che cosa è compilato (`fub-features`), i manifest
dei bundle dicono che cosa offre un bundle, `plugins.disabled` dice che cosa
la persona ha spento. Le fasi seguenti (la pagina «Componenti» e i profili,
i motori caricati solo quando servono, le edizioni) leggono tutte la stessa
regola di «acceso»: se ognuna la riscrive a modo suo, prima o poi un
componente resta acceso senza ciò che gli serve, o si spegne qualcosa che
un altro usa.

## Decisione

1. **Un componente si descrive nel manifest.** `PluginManifest` cresce in
   coda (ADR 0180) con `uses` (i requisiti), `kind` (`Mode`, `Engine`,
   `Service`, `Data`), `delivery` (`Included`, `Edition { name }`,
   `Download { url, sha256, bytes }`, vedi ADR 0233), `ui` e `group`. Il WIT
   0.2.0 cresce nello stesso modo; i manifest che non li scrivono prendono i default.
2. **La regola di «acceso» esiste una volta sola**, nel crate puro
   `fub-componenti`: `Mappa` (righe senza cicli, nucleo, requisiti risolti),
   `Stato { scelti, in_attesa }`, `accendi`, `spegni`,
   `spegni_con_dipendenti`, `togli`, `tieni`, `perche`, `applica_profilo`.
   Un componente è attivo se è nel nucleo, se è scelto o se un attivo lo
   richiede; accendere accende anche i requisiti, spegnere rifiuta se un
   attivo lo richiede e dice chi, e ciò che non serve più a nessuno si toglie
   o si tiene, a scelta. Un requisito che più componenti offrono è un
   errore della mappa, non una scelta a caso.
3. **La mappa vera nasce dall'inventario delle feature.**
   `fub-features::componenti` ha una riga per ogni feature Cargo e una per
   ogni componente che non è una feature; i nomi stanno nel catalogo
   `component.<nome>.name`. L'host descrive i manifest dei bundle con la
   riga del loro id. I requisiti che non sono bundle (`SOLO_DELLA_MAPPA`:
   le note in Markdown, i dizionari, la penna, i motori dei documenti e dei
   fogli) stanno solo nella mappa, non nei manifest.
4. **Lo stato resta `plugins.disabled`.** Scelti sono i componenti non di
   supporto che non vi compaiono; si scrive soltanto con
   `set_plugin_enabled`, e soltanto sui bundle. Il nucleo (`fub.core`,
   `fub.maintenance`, `fub.markdown`) non si spegne. Un id in
   `plugins.disabled` che la mappa non ha più non accende niente e non si
   cancella.
5. **Agenti e persone hanno gli stessi comandi.** `fub-cli componenti`
   (elenco, `perche`, `accendi`, `spegni`) e gli strumenti MCP
   `fub_components`, `fub_components_why`, `fub_components_enable`,
   `fub_components_disable` usano la stessa mappa e le stesse parole. Come
   per ADR 0232, senza `apply` è una prova; con `apply` accendere e spegnere
   vogliono tutto il vault fra le radici di scrittura, perché cambiano il
   comportamento di tutto il vault.

## Conseguenze

### Positive

- la pagina «Componenti», i profili e il caricamento dei motori leggono una
  regola sola, provata su mappe casuali;
- un componente nuovo si aggiunge con una riga e il suo manifest, e i test
  dicono subito se manca la feature, il nome o un requisito;
- un agente vede e cambia i componenti con le stesse regole della persona.

### Negative

- i componenti senza bundle (la lavagna, la penna, i dizionari, i
  motori) si possono accendere e spegnere solo nella risposta della CLI: la
  scelta non resta salvata finché non diventano bundle o hanno uno stato
  loro;
- finché lo stato è `plugins.disabled`, «in attesa» non sopravvive fra un
  comando e l'altro;
- `fub-cli` dipende da `fub-componenti` direttamente, perché usa i tipi del
  risolutore nelle firme.

## Alternative scartate

### Una chiave nuova per lo stato dei componenti

Ogni impostazione del gruppo «Componenti» si vede nelle Impostazioni, e K1
non doveva cambiare niente di visibile. Lo stato nuovo arriva con la pagina
«Componenti».

### I requisiti di supporto nei manifest

Le note in Markdown, i dizionari, la penna e i motori non sono bundle: un
`requires` verso di loro non lo soddisferebbe nessun bundle montato. La
mappa li conosce, i manifest no.

### La regola dentro l'host

Avrebbe legato il risolutore al montaggio dei bundle e alle impostazioni:
più difficile da provare su mappe casuali e da riusare nel client e nella
CLI.

## Verifica

- `crates/fub-componenti/tests/proprieta.rs`: nessun attivo con un requisito
  spento, accendere e poi spegnere torna allo stato di prima, su mappe
  casuali con seme fisso stampato quando un caso fallisce;
- `crates/fub-features/tests/componenti.rs` e `cargo_features.rs`: ogni
  feature Cargo ha la sua riga e viceversa, ogni riga ha il nome in tutte le
  lingue dei cataloghi;
- `crates/fub-host/tests/componenti.rs`: un host di default monta gli stessi
  bundle di prima, e i manifest portano i campi della loro riga;
- `crates/fub-cli/tests/componenti.rs` e `tests/mcp.rs`: `spegni` poi
  `accendi` lascia `plugins.disabled` e i bundle montati identici, il
  nucleo e i componenti richiesti rifiutano, gli strumenti MCP senza `apply`
  non cambiano niente e senza tutto il vault fra le radici di scrittura
  rifiutano.
