# Censimento delle porte

> **Per chi:** chi costruisce su Fub da fuori, a mano o con un'AI, e vuole sapere
> quali funzioni ufficiali può rifare con le porte pubbliche e quali no.
> **Fonte autorevole:** `crates/fub-features/src/componenti.rs` (le righe),
> `crates/fub-features/src/inventory.rs` (che cosa registra ogni riga),
> `crates/fub-wasm-host/src/component.rs` (gli export che l'host non serve).
> **Presidi:** `crates/fub-features/tests/censimento.rs` per la prima tabella,
> il test `il_censimento_conosce_gli_export_non_serviti` in `component.rs` per la
> seconda.

Questa pagina risponde a una domanda: ogni funzione ufficiale di Fub si può
rifare con un componente di terzi? Le prime due tabelle le tiene vere un test:
una riga che manca, o una cella che dice una cosa diversa dal codice, fa fallire
la prova con un messaggio che nomina la riga e che cosa scrivere. La terza
tabella non ha un test e lo dice.

## Come si leggono le tabelle

Una **porta** è un modo in cui un componente entra in Fub: un pannello, un
comando, un indice, una regola di sintassi e così via. Un componente WASM di terzi
(vedi [ABI e WIT](abi-and-wit.md)) le usa attraverso gli export di
`plugin-world` che l'host collega; un componente nativo, compilato dentro Fub,
le usa attraverso i trait di `fub-abi`.

La colonna `porte` elenca i campi pieni della riga d'inventario
(`OfficialFeature`), nell'ordine dei campi:

| Parola | Campo di `OfficialFeature` | Export WIT corrispondente |
|---|---|---|
| `vista` | `view` | `fub:abi/view`, servito |
| `comandi` | `commands` | `fub:abi/command`, servito |
| `indice` | `index` | `fub:abi/index`, servito |
| `sintassi` | `syntax` | `fub:abi/syntax`, non servito |
| `renderer` | `renderers` | `fub:abi/renderer`, non servito |
| `export` | `exports` | `fub:abi/exporter`, non servito |
| `impostazioni` | `settings` | il campo `settings` del manifest |
| `collegamento:<variante>` | `wiring` | nessuno: lo fa soltanto l'host |

La variante del collegamento è quella di `HostWiring` in kebab-case
(`SearchIndex` diventa `search-index`); `None` non si scrive. Una riga della
mappa senza riga d'inventario ha `—`.

La colonna `da fuori` usa cinque parole:

- `sì`: tutto ciò che la riga registra ha un export WIT che l'host serve, quindi
  un componente di terzi può rifarla;
- `solo nativa`: usa sintassi, renderer o export, che il WIT descrive ma l'host
  WASM non collega (vedi la seconda tabella);
- `solo host`: ha un `HostWiring`, oppure è un bundle, un motore o una libreria
  che l'host costruisce senza una riga d'inventario;
- `nucleo`: sta in `componenti::NUCLEO`, si monta sempre e non si spegne;
- `client`: è una riga senza bundle che vive nel client (ha cartelle in `ui`).

Il test deriva la parola dal codice: un `HostWiring` diverso da `None` vuol dire
`solo host`; sintassi, renderer o export senza collegamento vogliono dire
`solo nativa`; il resto delle righe d'inventario è `sì`. Fra le righe senza
inventario, gli id di `NUCLEO` sono `nucleo`, una riga senza bundle con cartelle
del client è `client`, e le altre sono `solo host`.

## Le funzioni ufficiali

Una riga per ogni riga di `fub_features::componenti::righe()` con tutte le
cargo feature accese, `draw` compresa. Una build con meno feature ha meno righe
in `righe()`: il test accetta una riga della tabella che quella build non
compila soltanto se la sua cargo feature è dichiarata in `[features]` di
`crates/fub-features/Cargo.toml`.

<!-- censimento:funzioni:inizio -->
| id | cargo feature | porte | da fuori |
|---|---|---|---|
| `fub.core` | — | — | nucleo |
| `fub.maintenance` | — | — | nucleo |
| `fub.markdown` | — | — | nucleo |
| `fub.search` | `search` | impostazioni, collegamento:search-index | solo host |
| `fub.versioning` | `versioning` | vista, comandi, impostazioni, collegamento:version-store | solo host |
| `fub.backlinks` | `backlinks` | vista | sì |
| `fub.outline` | `outline` | vista, comandi | sì |
| `fub.tags` | `tags` | vista, comandi | sì |
| `fub.properties` | `properties` | vista, comandi | sì |
| `fub.template` | `template` | vista, comandi, impostazioni | sì |
| `fub.queries` | `queries` | vista, comandi | sì |
| `fub.dashboard` | `dashboard` | vista | sì |
| `fub.backup` | `backup` | vista, comandi, impostazioni | sì |
| `fub.trash` | `trash` | vista | sì |
| `fub.stats` | `stats` | vista | sì |
| `fub.graph` | `graph` | vista, comandi | sì |
| `fub.commands` | `commands` | comandi | sì |
| `fub.blocks` | `blocks` | sintassi, renderer | solo nativa |
| `fub.base` | `base` | indice, sintassi, renderer | solo nativa |
| `fub.formatting` | `formatting` | comandi | sì |
| `fub.proof` | `proof` | comandi, impostazioni, collegamento:machine-dictionaries | solo host |
| `fub.draw` | `draw` | comandi, indice, export, impostazioni | solo nativa |
| `fub.rich` | `rich` | — | solo host |
| `fub.xlsx` | `xlsx` | — | solo host |
| `fub.lavagna` | — | — | client |
| `fub.penna` | — | — | solo host |
| `fub.dizionari` | — | — | solo host |
| `fub.motore-documenti` | `engine-documents` | — | solo host |
| `fub.motore-fogli` | `engine-sheets` | — | solo host |
| `fub.importers` | — | — | solo host |
| `fub.linkcard` | `http-client` | — | solo host |
| `fub.updates` | `http-client` | — | solo host |
| `fub.publish` | `http-client` | — | solo host |
| `fub.sync` | `http-client` | — | solo host |
<!-- censimento:funzioni:fine -->

Che cosa dice la tabella:

- le funzioni `sì` usano soltanto pannelli, comandi, indici e impostazioni: un
  componente WASM le può rifare con le stesse porte;
- le funzioni `solo nativa` hanno bisogno di una porta che il WIT descrive e
  l'host non collega: un componente che esporta quell'interfaccia è rifiutato
  al caricamento (`LoadError::UnservedExports`), non montato a metà;
- le funzioni `solo host` dipendono da ciò che soltanto chi monta sa fare:
  aprire l'indice full-text nella cartella dati, tenere lo store delle versioni,
  leggere i dizionari della macchina, oppure un codec o un bundle che
  `fub-host` costruisce da sé.

Quando una riga entra nella mappa, il test fallisce e chiede di aggiungerla
qui con le sue porte.

## Gli export WIT che l'host non serve

Una riga per ogni voce della costante `EXPORTS_UNSERVED` di
`crates/fub-wasm-host/src/component.rs`. Sono le porte che mancano perché le
funzioni `solo nativa` diventino `sì`.

<!-- censimento:export:inizio -->
| interfaccia | chi la userebbe |
|---|---|
| `fub:abi/syntax` | chi aggiunge una sintassi alle note, come `fub.blocks` e `fub.base` |
| `fub:abi/renderer` | chi disegna i blocchi di quella sintassi, come `fub.blocks` e `fub.base` |
| `fub:abi/service` | chi offre metodi ad altri componenti per `ns`, letti con `host-services` |
| `fub:abi/importer` | chi porta dentro il vault file di altri programmi, come `fub.importers` |
| `fub:abi/exporter` | chi aggiunge destinazioni al dialogo di export, come `fub.draw` |
<!-- censimento:export:fine -->

## Che cosa si cambia dell'interfaccia

Questa tabella non ha un test. I percorsi sono verificati nel codice; ciò che
non è verificato lo dice la cella.

| Parte | Dove sta | Un'aggiunta la cambia? |
|---|---|---|
| temi e skin | `crates/fub-host/src/theme.rs` (il bundle del tema), `apps/client/src/theme/loader.ts` (il montaggio), `apps/client/src/theme/snippets.ts` (i frammenti CSS) | sì: un tema `theme-1` o `theme-2` installato in `<config>/themes/<id>/`, senza permessi, e i frammenti CSS dell'utente passano dal sanitizer |
| scorciatoie | `crates/fub-abi/src/command.rs` (`CommandSpec.keybinding`), `crates/fub-host/src/shell.rs` (gli accordi della shell), `apps/client/src/ui/commands.ts` (le chiavi `keys.*`) | in parte: un comando dichiara un accordo suggerito; lo assegna la persona con le chiavi `keys.*`, e un accordo arrivato con il vault resta sospeso finché non lo guarda; se un componente possa scrivere le chiavi `keys.*` di altri non è verificato |
| pannelli e viste | `crates/fub-abi/src/traits.rs` (`ViewSpec`, `ViewSurface`), `apps/client/src/ui/views.ts` (il disegno) | sì: un `ViewProvider`, anche WASM (`fub:abi/view`), compare sulla superficie che dichiara con un albero `UiNode` |
| barra di formattazione | `crates/fub-abi/src/command.rs` (`CommandSurface::Toolbar`), `apps/client/src/panels/format-bar.ts` | sì, come pulsante col suo titolo: le azioni che scrivono nel testo aperto le dichiara soltanto il core |
| menu «/» | `crates/fub-abi/src/command.rs` (`CommandSurface::Slash` e `SlashSelection`), `apps/client/src/state/slash.ts`, `apps/client/src/panels/slash/` | sì: un comando che dichiara la superficie compare nel menu per la stessa via delle funzioni ufficiali |
| disposizione dello Scrittoio | `apps/client/src/state/layout.ts` (riquadri e linguette), `apps/client/src/shells/scrittoio/` (zone, spazio, preferenze) | no: nessuna porta del contratto sposta riquadri o zone; un'aggiunta sceglie soltanto la superficie della sua vista |

## Vedi anche

- [ABI e WIT](abi-and-wit.md): il contratto dei componenti WASM.
- [Creare un plugin](../development/plugin-authoring.md): come si scrive un
  componente.
- [Permessi e sicurezza](permissions-and-security.md): che cosa un componente
  può chiedere.
