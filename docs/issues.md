## Audit 2026-07-31 02:17

### Rust Lints
- No clippy warnings.

### Test Failures
- All Rust tests passed.
- Frontend tests passed (no failures).

### Frontend Lint
- No lint script defined; npm test executed successfully.

# Issues

> [!WARNING]
> Questo file è un contenitore "raw" di osservazioni. Molti di questi punti sono stati
> **promossi a voci architetturali** in [`todo.md`](todo.md) e raggruppati per area (es. §15.8, §20.7).
> I bug promossi vivono e si risolvono lavorando sulle rispettive sedute di `todo.md`.
> Se lo Stato di un'issue indica che è stata promossa, **non va risolta qui come fix isolato**.

> [!IMPORTANT]
> **I rimandi «Promossa alla voce §…» oggi non colpiscono niente.** Il
> raggruppamento che aveva creato quelle voci — §15.8, §16.9, §16.10, §17.4,
> §18.3, §18.4, §20.6, §20.7, §20.8, §21.11 e §23.1, e con loro la seduta 23 — è
> andato perso prima di essere committato, e in [`todo.md`](todo.md) quei numeri
> non esistono. Le righe sono rimaste perché dicono comunque una cosa vera e
> utile: *queste osservazioni sono famiglie, non fix isolati*. Chi rifarà il
> raggruppamento le trova già scritte; fino ad allora vanno lette come un
> proposito, non come un rimando.

L'elenco delle osservazioni che **non sono decisioni chiuse** (quelle stanno in
[`decisions/`](decisions/README.md)) né lavoro aperto con priorità (quello sta
in [`todo.md`](todo.md)): sono punti notati durante un controllo, che oggi non
rompono nulla ma che vale la pena tenere d'occhio, perché il giorno in cui
cambiano le condizioni smettono di essere innocui senza avvisare.

Una issue non impegna a fare nulla: impegna a **saperla**. Quando qualcuno la
tocca, la ragione scritta qui è il contesto che si è perso.

| # | Issue | Dove | Nota del |
|---|---|---|---|
| [0001](#0001--versionref-attraversa-lipc) | `VersionRef` attraversa l'IPC, e per lui `fub-app` dipende da `fub-features` | `crates/fub-app/Cargo.toml` | 2026-07-31 |
| [0002](#0002--restore_from_trash-limita-il-ripristino-ai-soli-documenti) | `restore_from_trash` limita il ripristino ai soli documenti (no asset) | `crates/fub-kernel/src/workspace.rs` | 2026-07-31 |
| [0003](#0003--inerzia-del-contesto-di-session-alla-disattivazione-di-un-plugin) | Inerzia del contesto di `Session` alla disattivazione di un plugin | `crates/fub-kernel/src/workspace.rs` | 2026-07-31 |
| [0004](#0004--accumulo-di-sidecar-orfani-in-fubdatatrash-per-cancellazioni-esterne) | Accumulo di sidecar orfani in `.fub/data/trash/` per cancellazioni esterne | `crates/fub-kernel/src/vault.rs` | 2026-07-31 |
| [0005](#0005--is_ignored_name-su-cartelle-con-nomi-in-maiuscolo-su-filesystem-case-insensitive) | `IGNORED_DIRS` in `Vault` confronta `node_modules` in modo case-sensitive | `crates/fub-kernel/src/vault.rs` | 2026-07-31 |
| [0006](#0006--permanenza-del-contatore-sync_failures-in-vaultstatus-fino-alla-chiusura-del-vault) | Permanenza del contatore `sync_failures` in `VaultStatus` fino alla chiusura | `crates/fub-kernel/src/index/core.rs` | 2026-07-31 |
| [0007](#0007--hostclose_vault-e-with_session-falliscono-se-la-cartella-del-vault-viene-eliminata-o-spostata-su-disco) | `Host::close_vault` e `with_session` falliscono se la cartella del vault viene eliminata o spostata su disco | `crates/fub-host/src/session.rs` | 2026-07-31 |
| [0008](#0008--set_plugin_enabledfalse-non-disattiva-i-plugin-con-job-in-volo-e-salta-plugindeactivate) | `set_plugin_enabled(false)` non disattiva i plugin con job in volo e salta `Plugin::deactivate` | `crates/fub-host/src/session.rs` | 2026-07-31 |
| [0009](#0009--bancocon_spia-cancella-gli-eventi-della-semina-e-della-scansione-iniziale) | `Banco::con_spia` cancella gli eventi della semina e della scansione iniziale | `crates/fub-testkit/src/lib.rs` | 2026-07-31 |
| [0010](#0010--notifiche-di-errori-nei-comandi-tauri-close_vault-e-set_plugin_enabled-ritornano-stringhe-invece-di-pluginerror-tipizzati) | Notifiche di errore nei comandi Tauri `close_vault` e `set_plugin_enabled` ritornano stringhe non tipizzate | `crates/fub-app/src/lib.rs` | 2026-07-31 |
| [0011](#0011--omissione-di-tipi-fondamentali-di-traitsrs-dai-re-export-di-livello-radice-in-fub-abi) | Omissione di tipi fondamentali di `traits.rs` dai re-export di livello radice in `fub-abi` | `crates/fub-abi/src/lib.rs` | 2026-07-31 |
| [0012](#0012--conversione-usize---u32-senza-try_from-nella-generazione-di-short_id) | Conversione `usize` -> `u32` senza `try_from` nella generazione di `short_id` | `crates/fub-sdk/src/ids.rs` | 2026-07-31 |
| [0013](#0013--divergenza-potenziale-fra-i-default-di-optionmap-e-i-booleani-nelle-capabilities) | Divergenza potenziale fra i default di `OptionMap` e i booleani nelle capabilities | `crates/fub-abi/src/options.rs` | 2026-07-31 |
| [0014](#0014--dettaglio-diagnostico-del-rifiuto-di-documentsourcebytes-in-formatprovider) | Dettaglio diagnostico del rifiuto di `DocumentSource::Bytes` in `FormatProvider` | `crates/fub-abi/src/format.rs` | 2026-07-31 |
| [0015](#0015--import-misto-di-codemirror-e-pacchetti-modulari-codemirror) | Import misto di `codemirror` e pacchetti modulari `@codemirror/*` in `editor.ts` | `frontend/src/editor/editor.ts` | 2026-07-31 |
| [0016](#0016--accumulo-di-listener-in-onlingua-senza-meccanismo-di-rimozione) | Accumulo di listener in `onLingua` senza meccanismo di rimozione | `frontend/src/i18n/strings.ts` | 2026-07-31 |
| [0017](#0017--list_trash-fallisce-per-intero-se-nel-cestino-trash-è-presente-un-symlink-rotto) | `list_trash()` fallisce per intero se nel cestino `.trash/` è presente un symlink rotto | `crates/fub-kernel/src/vault.rs` | 2026-07-31 |
| [0018](#0018--scansione-lineare-on-cdot-m-con-normalizzazione-unicode-nella-risoluzione-dei-link-rotti) | Scansione lineare $O(N \cdot M)$ con normalizzazione Unicode nella risoluzione dei link rotti | `crates/fub-kernel/src/index/core.rs` | 2026-07-31 |
| [0019](#0019--data_root-e-trash_dir-compongono-path-relativi-sensibili-al-cambio-di-working-directory) | `data_root` e `TRASH_DIR` compongono path relativi sensibili al cambio di working directory | `crates/fub-kernel/src/vault.rs` | 2026-07-31 |
| [0020](#0020--disallineamento-sul-conteggio-e-lelenco-delle-famiglie-di-hostapi-in-traitsmd) | Disallineamento sul conteggio e l'elenco delle famiglie di `HostApi` in `traits.md` | `docs/architecture/traits.md` | 2026-07-31 |
| [0021](#0021--omissione-dei-moduli-i18n-e-statelocalets-nella-mappa-dellalbero-frontend-in-shellmd) | Omissione dei moduli `i18n` e `state/locale.ts` nella mappa dell'albero frontend in `shell.md` | `docs/architecture/shell.md` | 2026-07-31 |
| [0022](#0022--riferimento-di-riga-obsoleto-per-schema_version-in-versioningrs-allinterno-di-versionamentomd) | Riferimento di riga obsoleto per `SCHEMA_VERSION` in `versioning.rs` all'interno di `versionamento.md` | `docs/versionamento.md` | 2026-07-31 |
| [0023](#0023--omissione-della-specifica-di-troncamento-dellultima-estensione-per-docidpage_name-in-data-modelmd) | Omissione della specifica di troncamento dell'ultima estensione per `DocId::page_name()` in `data-model.md` | `docs/architecture/data-model.md` | 2026-07-31 |
| [0024](#0024--listener-click-pendente-in-showcontextmenu-dopo-la-chiusura-del-menu-via-tastiera) | Listener `click` pendente in `showContextMenu` dopo la chiusura del menu via tastiera | `frontend/src/ui/menu.ts` | 2026-07-31 |
| [0025](#0025--riconciliazione-incompleta-di-select-radio-e-attributi-input-in-uinodets) | Riconciliazione incompleta di `select`, `radio` e attributi `input` in `ui/node.ts` | `frontend/src/ui/node.ts` | 2026-07-31 |
| [0026](#0026--cambio-di-scheda-nella-sidebar-forzato-al-termine-di-una-ricerca-in-volo) | Cambio di scheda nella sidebar forzato al termine di una ricerca in volo | `frontend/src/panels/search.ts` | 2026-07-31 |
| [0027](#0027--wikilink-interni-alla-nota-sezione-blocco-ignorati-in-openwikilink) | Wikilink interni alla nota (`[[#Sezione]]`, `[[#^blocco]]`) ignorati in `openWikilink` | `frontend/src/panels/document.ts` | 2026-07-31 |
| [0028](#0028--inclusione-forzata-di-false-nei-parametri-booleani-opzionali-in-argsfromform) | Inclusione forzata di `false` nei parametri booleani opzionali in `argsFromForm` | `frontend/src/ui/palette.ts` | 2026-07-31 |
| [0029](#0029--mancata-esposizione-di-editorviewdestroy-nel-wrapper-delleditor) | Mancata esposizione di `EditorView.destroy` nel wrapper dell'editor | `frontend/src/editor/editor.ts` | 2026-07-31 |
| [0030](#0030--race-condition-durante-il-salvataggio-asincrono-con-input-continuo) | Race condition durante il salvataggio asincrono con input continuo | `frontend/src/panels/document.ts` | 2026-07-31 |
| [0031](#0031--sovrascrittura-dello-stato-chiuso-dellanteprima-con-rendering-stale) | Sovrascrittura dello stato chiuso dell'anteprima con rendering stale | `frontend/src/panels/preview.ts` | 2026-07-31 |
| [0032](#0032--lock-contention-e-deadlock-potenziali-nellhost-risolto) | Lock contention e deadlock potenziali nell'Host (Risolto) | `crates/fub-host/src/session.rs` | 2026-07-31 |
| [0033](#0033--race-condition-su-chiamate-concorrenti-a-opendocument) | Race condition su chiamate concorrenti a `openDocument` | `frontend/src/panels/document.ts` | 2026-07-31 |
| [0034](#0034--race-condition-da-concorrenza-non-gestita-in-refreshfromkernel) | Race condition da concorrenza non gestita in `refreshFromKernel` (out-of-order UI updates) | `frontend/src/panels/explorer.ts` | 2026-07-31 |
| [0089](#0089--interruzione-della-potatura-in-forget_vault-al-primo-errore-io) | Interruzione della potatura in `forget_vault` al primo errore I/O | `crates/fub-host/src/session.rs` | 2026-07-31 |
| [0090](#0090--divergenza-in-memoria-su-fallimento-di-set_setting-in-set_plugin_enabled) | Divergenza in memoria su fallimento di `set_setting` in `set_plugin_enabled` | `crates/fub-host/src/session.rs` | 2026-07-31 |
| [0091](#0091--cambio-di-vault-corrente-alfabetico-alla-chiusura) | Cambio di vault corrente alfabetico alla chiusura | `crates/fub-host/src/session.rs` | 2026-07-31 |
| [0035](#0035--eventi-pendenti-non-drenati-in-deactivate_plugin-se-il-plugin-non-ha-indici) | Application Crash on Poisoned Locks | `crates/fub-app/src/lib.rs` | 2026-07-31 |
| [0092](#0092--application-crash-on-poisoned-locks) | Application Crash on Poisoned Locks | `crates/fub-app/src/lib.rs` | 2026-07-31 |
| [0036](#0036--silent-event-loss-during-initialization) | Silent Event Loss During Initialization | `crates/fub-app/src/lib.rs` | 2026-07-31 |
| [0037](#0037--unhandled-serialization-failures-in-event-bridge) | Unhandled Serialization Failures in Event Bridge | `crates/fub-app/src/lib.rs` | 2026-07-31 |
| [0038](#0038--synchronous-io-and-blocking-ipc-commands) | Synchronous I/O and Blocking IPC Commands | `crates/fub-app/src/lib.rs` | 2026-07-31 |
| [0039](#0039--toctou-race-condition-in-propose_free_name) | TOCTOU Race Condition in propose_free_name | `crates/fub-app/src/lib.rs` | 2026-07-31 |
| [0040](#0040--massive-synchronous-io-bottleneck-in-vault_replace) | Massive Synchronous I/O Bottleneck in vault_replace | `crates/fub-features/src/commands.rs` | 2026-07-31 |
| [0041](#0041--deadlock-risk-in-searchindexcommit-double-checked-locking) | Deadlock Risk in SearchIndex::commit (Double-Checked Locking) | `crates/fub-features/src/search.rs` | 2026-07-31 |
| [0042](#0042--inconsistent-state-management-in-searchindexup_to_date-causing-data-loss) | Inconsistent State Management in SearchIndex::up_to_date causing Data Loss | `crates/fub-features/src/search.rs` | 2026-07-31 |
| [0043](#0043--out-of-memory-oom-risk-due-to-unbounded-pagination-in-search) | Out-of-Memory (OOM) Risk due to Unbounded Pagination in search | `crates/fub-features/src/search.rs` | 2026-07-31 |
| [0044](#0044--silent-failure-on-metajson-parsing-allows-directory-hijacking) | Silent failure on meta.json parsing allows directory hijacking | `crates/fub-features/src/versioning.rs` | 2026-07-31 |
| [0045](#0045--massive-memory-bottleneck-during-index-rebuild) | Massive memory bottleneck during index rebuild | `crates/fub-features/src/versioning.rs` | 2026-07-31 |
| [0046](#0046--holding-mutex-locks-across-io-boundaries) | Holding Mutex locks across I/O boundaries | `crates/fub-features/src/versioning.rs` | 2026-07-31 |
| [0047](#0047--action-reveal-lacks-doc_id-in-payload-risking-cross-document-jumps) | Action Reveal lacks doc_id in payload, risking cross-document jumps | `crates/fub-features/src/outline.rs` | 2026-07-31 |
| [0048](#0048--incomplete-attribute-escaping-in-escape_attr) | Incomplete attribute escaping in escape_attr | `crates/fub-features/src/blocks.rs` | 2026-07-31 |
| [0049](#0049--severe-redundant-full-document-reads-on-cursor-movement) | Severe Redundant Full-Document Reads on Cursor Movement | `crates/fub-features/src/stats.rs` | 2026-07-31 |
| [0050](#0050--double-text-traversal-for-statistics) | Double Text Traversal for Statistics | `crates/fub-features/src/stats.rs` | 2026-07-31 |
| [0051](#0051--continuous-string-allocation-in-render-loop) | Continuous String Allocation in Render Loop | `crates/fub-features/src/tags.rs` | 2026-07-31 |
| [0052](#0052--hardcoded-ui-element-keys-risking-state-leakage) | Hardcoded UI Element Keys Risking State Leakage | `crates/fub-features/src/tags.rs` | 2026-07-31 |
| [0053](#0053--perdita-di-blocchi-html-crudi-durante-la-serializzazione) | Perdita di blocchi HTML crudi durante la serializzazione | `crates/fub-format-markdown/src/serialize.rs` | 2026-07-31 |
| [0054](#0054--perdita-del-testo-di-fallback-per-gli-inlinecustom-sconosciuti) | Perdita del testo di fallback per gli Inline::Custom sconosciuti | `crates/fub-format-markdown/src/serialize.rs` | 2026-07-31 |
| [0055](#0055--rottura-dei-code-block-contenenti-backticks) | Rottura dei Code Block contenenti backticks | `crates/fub-format-markdown/src/serialize.rs` | 2026-07-31 |
| [0056](#0056--esportazione-documento-singolo-con-frontmatter-corrotto) | Esportazione documento singolo con Frontmatter corrotto | `crates/fub-format-markdown/src/transfer.rs` | 2026-07-31 |
| [0057](#0057--assenza-di-contesto-context-per-i-link-presenti-in-intestazioni-e-tabelle) | Assenza di contesto (context) per i Link presenti in Intestazioni e Tabelle | `crates/fub-format-markdown/src/parse.rs` | 2026-07-31 |
| [0058](#0058--restore_from_trash-scrive-il-documento-prima-di-cancellare-la-copia-nel-cestino) | `restore_from_trash` scrive il documento prima di cancellare la copia nel cestino: due copie in caso di crash | `crates/fub-kernel/src/workspace.rs` | 2026-07-31 |
| [0059](#0059--link_rewrite_plan-verifica-lambiguità-su-metas-ma-non-su-entries) | `link_rewrite_plan` verifica l'ambiguità su `metas` ma non su `entries` (allegati omonimi sfuggono) | `crates/fub-kernel/src/workspace.rs` | 2026-07-31 |
| [0060](#0060--section_of-usa-usizemax-come-sentinella-di-fine-sezione) | `section_of` usa `usize::MAX` come sentinella di fine sezione: overflow teorico su span di documenti enormi | `crates/fub-kernel/src/workspace.rs` | 2026-07-31 |
| [0061](#0061--insert_sortedremove_sorted-usano-binary_search_by-con-comparatore-non-strettamente-totale-su-alias-duplicati) | `insert_sorted`/`remove_sorted` usano `binary_search_by` con un comparatore che non è strettamente totale su alias duplicati | `crates/fub-kernel/src/graph.rs` | 2026-07-31 |
| [0062](#0062--backlink-duplicati-non-vengono-deduplicati-in-refs_by_key) | Backlink duplicati non vengono deduplicati in `refs_by_key`: `unregister_links` può lasciare riferimenti orfani | `crates/fub-kernel/src/graph.rs` | 2026-07-31 |
| [0063](#0063--jobbell-usa-un-contatore-u64-che-non-si-azzera-mai) | `JobBell` usa un contatore `u64` che non si azzera mai: overflow teorico dopo lunghissimo uptime | `crates/fub-kernel/src/dispatcher.rs` | 2026-07-31 |
| [0064](#0064--subscriptionrecv-con-canale-disconnected-restituisce-overflow-e-poi-chiama-recv-bloccante-su-canale-chiuso) | `Subscription::recv` con canale `Disconnected` restituisce un `Overflow` sintetico ma poi chiama `recv` bloccante su un canale già chiuso | `crates/fub-kernel/src/bus.rs` | 2026-07-31 |
| [0065](#0065--notifywatcher-tiene-il-lock-esclusivo-del-workspace-durante-lintera-raffica-debounced-e-il-flush_indexes) | `NotifyWatcher`: lock esclusivo del workspace tenuto per tutto il ciclo di eventi + `flush_indexes` (I/O su disco sotto lock) | `crates/fub-host/src/watcher.rs` | 2026-07-31 |
| [0066](#0066--nel-ramo-err-del-watcher-levento-trouble-non-viene-mai-emesso-se-il-lock-del-workspace-è-avvelenato) | Nel ramo `Err` del watcher il flag `watching` viene abbassato prima del lock: se il lock è avvelenato l'evento `Trouble` non viene mai emesso | `crates/fub-host/src/watcher.rs` | 2026-07-31 |
| [0067](#0067--bundleregistrystop-arcget_mut-fallisce-silenziosamente-se-un-job-è-ancora-in-volo-plugindeactivate-non-viene-mai-chiamato) | `BundleRegistry::stop`: `Arc::get_mut` fallisce silenziosamente se un job è ancora in volo, `Plugin::deactivate` non viene chiamato e nessun assert codifica l'invariante | `crates/fub-host/src/registry.rs` | 2026-07-31 |
| [0068](#0068--checkpath-namingnew-accetta-nomi-con-spazi-in-testa-che-normalized-trasforma-in-file-nascosti-namefaulthidden) | `check(path, Naming::New)` accetta nomi con spazi in testa che `normalized` trasforma in file nascosti | `crates/fub-abi/src/rules/path_policy.rs` | 2026-07-31 |
| [0069](#0069--in-caso-di-panico-in-workspacebatch-batch-resta-attivo-e-blocca-per-sempre-il-dispatch-degli-eventi) | In caso di panico in `workspace.batch()`, `batch` resta attivo e blocca per sempre il dispatch eventi | `crates/fub-kernel/src/workspace.rs` | 2026-07-31 |
| [0070](#0070--prefix_len_ci-in-occurrencesrs-confronta-caratteri-unicode-char-by-char-fallendo-su-espansioni) | `prefix_len_ci` in `occurrences.rs` confronta caratteri Unicode char-by-char fallendo su espansioni | `crates/fub-kernel/src/occurrences.rs` | 2026-07-31 |
| [0071](#0071--undostackpush-usa-vecremove0-con-spostamenti-on-ad-ogni-inserimento-oltre-il-tetto) | `UndoStack::push` usa `Vec::remove(0)` con spostamenti $O(N)$ ad ogni inserimento oltre il tetto | `crates/fub-kernel/src/undo.rs` | 2026-07-31 |
| [0072](#0072--accumulo-di-entry-orfane-in-flagslive-per-cancel_job-con-jobid-inesistenti) | Accumulo di entry orfane in `Flags::live` per `cancel_job` con `JobId` inesistenti | `crates/fub-host/src/runner.rs` | 2026-07-31 |
| [0073](#0073--scrittura-sincrona-su-disco-in-set_view_state-blocca-il-thread-ipc-di-tauri-durante-le-interazioni-ui) | Scrittura sincrona su disco in `set_view_state` blocca il thread IPC di Tauri | `crates/fub-app/src/lib.rs` | 2026-07-31 |
| [0074](#0074--mancato-aggiornamento-del-timestamp-last_opened-alla-riapertura-di-un-vault-già-aperto) | Mancato aggiornamento del timestamp `last_opened` alla riapertura di un vault già aperto | `crates/fub-host/src/session.rs` | 2026-07-31 |
| [0075](#0075--impossibilità-di-ripristinare-il-nome-di-default-del-vault-tramite-set_vault_look) | Impossibilità di ripristinare il nome di default del vault tramite `set_vault_look` | `crates/fub-host/src/vaults.rs` | 2026-07-31 |
| [0076](#0076--panico-in-vaultsessionclose-con-lock-del-workspace-avvelenato-e-perdita-di-dati) | Panico in `VaultSession::close` con lock del workspace avvelenato e perdita di dati | `crates/fub-host/src/session.rs` | 2026-07-31 |
| [0077](#0077--fallimento-di-fallback-per-config_dir-se-la-cartella-fub-config-non-è-scrivibile) | Fallimento di fallback per `config_dir` se la cartella `fub-config` non è skrivibile | `crates/fub-host/src/config.rs` | 2026-07-31 |
| [0078](#0078--silenziosa-terminazione-del-thread-bridgers-su-disconnessione-del-bus) | Silenziosa terminazione del thread `bridge.rs` su disconnessione del bus senza log | `crates/fub-host/src/bridge.rs` | 2026-07-31 |
| [0079](#0079--omissione-dellattributo-data-embed-block-per-la-transclusione-dei-blocchi-nei-wikilink-incorporati) | `render_html` omette l'attributo `data-embed-block` nei wikilink incorporati `![[Nota#^blocco]]` | `crates/fub-format-markdown/src/render.rs` | 2026-07-31 |
| [0080](#0080--serializzazione-errata-di-linktargetwiki-con-ancora-di-blocco-senza-prefisso-) | `serialize` genera wikilink con ancora di blocco senza `#` (es. `[[page^block]]` anziché `[[page#^block]]`) | `crates/fub-format-markdown/src/serialize.rs` | 2026-07-31 |
| [0081](#0081--disallineamento-dello-span-nei-link-incorporati--fra-parser-ast-comrak-e-fallback-testuale) | Disallineamento dello span nei link incorporati (`![[...]]`) fra parser AST comrak e fallback testuale | `crates/fub-format-markdown/src/parse.rs` | 2026-07-31 |
| [0082](#0082--impossibilità-di-spuntare-task-non-completati---in-notetasktoggle) | `note_task_toggle` tratta `[ ]` (`Some(' ')`) come completato e non spunta mai i task da fare | `crates/fub-features/src/commands.rs` | 2026-07-31 |
| [0083](#0083--memory-leak-e-listener-pendenti-in-pickicon-alla-riapertura-del-selettore) | Memory leak e listener pendenti in `pickIcon` alla riapertura del selettore | `frontend/src/ui/menu.ts` | 2026-07-31 |
| [0084](#0084--memory-leak-di-listener-keydown-su-document-alla-riapertura-del-grafo) | Memory leak di listener `keydown` su `document` alla riapertura del grafo | `frontend/src/panels/graph.ts` | 2026-07-31 |
| [0085](#0085--conflitto-globale-sullattributo-name-nei-campi-radio-tra-form-differenti) | Conflitto globale sull'attributo `name` nei campi `radio` tra form differenti | `frontend/src/ui/node.ts` | 2026-07-31 |
| [0086](#0086--mancata-gestione-degli-errori-nelle-azioni-asincrone-delle-viste-dichiarative) | Mancata gestione degli errori nelle azioni asincrone delle viste dichiarative | `frontend/src/ui/views.ts` | 2026-07-31 |
| [0087](#0087--race-condition-nel-fallback-da-patch-a-renderdeclaredview-per-aggiornamenti-concorrenti) | Race condition nel fallback da `patch` a `renderDeclaredView` per aggiornamenti concorrenti | `frontend/src/ui/views.ts` | 2026-07-31 |
| [0088](#0088--inconsistenza-dello-stato-delle-viste-alla-chiusuraapertura-se-apilistviews-fallisce) | Inconsistenza dello stato delle viste se `api.listViews` fallisce | `frontend/src/ui/views.ts` | 2026-07-31 |

---

## 0001 — `VersionRef` attraversa l'IPC

**Dove:** `crates/fub-app/Cargo.toml` — `fub-features = { workspace = true }`,
con il commento «solo per `VersionRef`, che è un tipo che attraversa l'IPC».

**Stato:** Promossa alla voce [§16.9](todo.md)

**Perché si nota:** `fub-app` è la colla Tauri, e la sua superficie ideale è
«comandi, finestre, niente tipi di dominio». `VersionRef` è un tipo di dominio,
e sta in `fub-features` perché è nato con il versioning — ma il posto naturale
dei tipi che attraversano il confine è `fub-abi`, che è il contratto e che già
ospita i tipi (il `DocumentModel`, gli `Span`, le `IndexQuery`) pensati per essere
visti da fuori. Se `VersionRef` cresce, o se ne aggiungono altri come lui,
l'arco `app → features` diventa il posto dove l'app prende a prestito la
libreria delle feature per un tipo solo, e un tipo solo è esattamente la
soglia sotto cui una dipendenza si tollera e sopra cui si riformula.

**Cosa guardare:** `crates/fub-features/src/versioning.rs`. Il giorno in cui un
secondo tipo segua `VersionRef` oltre il confine, vale la pena di spostarli
insieme in `fub-abi` (dove `ipc.rs` già raccoglie ciò che attraversa), e di
togliere `fub-features` dalle dipendenze normali di `fub-app`. Fino ad allora,
lasciarlo è la scelta giusta: spostarlo oggi sarebbe muovere un tipo per un
problema che non c'è.

**Collegamenti:** [0016](decisions/0016-cosa-e-una-view.md) (cosa è una view),
[`fub-abi` come firewall anti-lock-in](../crates/fub-abi/Cargo.toml).

---

## 0002 — `restore_from_trash` limita il ripristino ai soli documenti

**Dove:** `crates/fub-kernel/src/workspace.rs` (`restore_from_trash`) e `crates/fub-kernel/src/vault.rs` (`list_trash`).

**Stato:** Promossa alla voce [§16.9](todo.md)

**Perché si nota:** La Decisione 0046 (`VaultEntry`) ha distinto la specie `Document` da `Asset` e `Unknown`. Il cestino `.trash/` è piatto e condiviso con Obsidian, permettendo la cancellazione di qualunque file del vault. Chi elenca il cestino vede gli allegati, ma provando a ripristinarli riceve un errore di provider mancante anziché un ripristino dei byte.

**Cosa guardare:** `crates/fub-kernel/src/workspace.rs#L1844-L1899`. Quando l'anagrafe o le capacità dell'HostApi introdurranno il ripristino degli asset generici, `restore_from_trash` dovrà ramificare tra documenti (che passano da `write_document` per parse/versioning/eventi) e asset (che spostano/scrivono i byte grezzi ed emettono `EntryChanged`/`EntryRenamed`).

**Collegamenti:** [0046](decisions/0046-l-anagrafe-del-vault.md) (anagrafe del vault), [0013](decisions/0013-elenco-delle-capacita.md) (elenco delle capacità).

---

## 0003 — Inerzia del contesto di `Session` alla disattivazione di un plugin

**Dove:** `crates/fub-kernel/src/workspace.rs` (`deactivate_plugin`) e `crates/fub-kernel/src/session.rs`.

**Stato:** Promossa alla voce [§16.10](todo.md)

**Perché si nota:** Se la shell o un chiamante legge `Session::context()` o `Session::document()` subito dopo la disattivazione del plugin senza aver pubblicato un nuovo contesto, il kernel restituisce il riferimento al contesto della view disattivata.

**Cosa guardare:** `crates/fub-kernel/src/workspace.rs#L699-L795`. Se in futuro un plugin disattivato al volo dovesse notificare la shell del cambio di focus, si potrebbe chiamare `session.invalidate` o pubblicare un contesto nullo durante `deactivate_plugin`.

**Collegamenti:** [0007](decisions/0007-contesto-di-sessione.md) (contesto di sessione), [0028](decisions/0028-come-un-componente-smette.md) (disattivazione plugin).

---

## 0004 — Accumulo di sidecar orfani in `.fub/data/trash/` per cancellazioni esterne

**Dove:** `crates/fub-kernel/src/vault.rs` (`remove_trashed`, `empty_trash`, `trash_sidecar_path`).

**Stato:** Promossa alla voce [§15.8](todo.md)

**Perché si nota:** `list_trash()` legge i file presenti in `.trash/` e cerca i sidecar corrispondenti. I sidecar orfani non compaiono nell'elenco (perché la chiave è il nome del file in `.trash/`), ma occupano spazio in `.fub/data/trash/` finché non viene invocato `empty_trash()`, che esegue `remove_dir_all(trash_meta_dir())`.

**Cosa guardare:** `crates/fub-kernel/src/vault.rs#L486-L502`. Qualora si volesse una pulizia incrementale dei sidecar orfani, `list_trash` o la scansione dell'anagrafe potrebbero potare i sidecar `.json` il cui corrispettivo in `.trash/` non esiste più.

**Collegamenti:** [0048](decisions/0048-una-radice-sola.md) (radice `.fub/data`), `Vault::empty_trash`.

---

## 0005 — `is_ignored_name` su cartelle con nomi in maiuscolo su filesystem case-insensitive

**Dove:** `crates/fub-kernel/src/vault.rs` (`IGNORED_DIRS`, `is_ignored_name`).

**Stato:** Promossa alla voce [§15.8](todo.md)

**Perché si nota:** I nomi nascosti che iniziano per `.` (`.obsidian`, `.git`, `.fub`, `.trash`) vengono catturati da `starts_with('.')` indipendentemente dal maiuscolo/minuscolo. Tuttavia `"node_modules"` è l'unico elemento che non inizia per `.`. Se su un filesystem case-insensitive (es. macOS o Windows) una cartella viene rinominata in `Node_Modules` o `NODE_MODULES`, `IGNORED_DIRS.contains(&name)` restituisce `false` e la scansione del vault cammina dentro la cartella dei moduli.

**Cosa guardare:** `crates/fub-kernel/src/vault.rs#L34` e `L82-L84`. Si può considerare di rendere `is_ignored_name` insensibile al maiuscolo/minuscolo (es. `name.eq_ignore_ascii_case("node_modules")`).

**Collegamenti:** `Vault::scan`, `Vault::is_ignored`.

---

## 0006 — Permanenza del contatore `sync_failures` in `VaultStatus` fino alla chiusura del vault

**Dove:** `crates/fub-kernel/src/index/core.rs` (`note_sync_failure`) e `crates/fub-kernel/src/workspace.rs` (`note_sync`).

**Stato:** Promossa alla voce [§16.9](todo.md)

**Perché si nota:** Una sincronizzazione successiva andata a buon fine per lo stesso file o per altri file non decrementa né azzera `sync_failures`. L'interfaccia utente continua a vedere `sync_failures > 0` e `last_sync_error` valorizzato anche se il vault sul disco è ritornato completamente consistente.

**Cosa guardare:** `crates/fub-kernel/src/index/core.rs#L316-L327` e `docs/decisions/0030-il-rilevamento-si-puo-chiedere.md`. Come stabilito a verbale 0030, l'azzeramento del contatore avviene solo riaprendo il vault (`reindex`).

**Collegamenti:** [0030](decisions/0030-il-rilevamento-si-puo-chiedere.md) (il rilevamento si può chiedere).

---

## 0007 — `Host::close_vault` e `with_session` falliscono se la cartella del vault viene eliminata o spostata su disco

**Dove:** `crates/fub-host/src/session.rs` — funzioni `canonical`, `close_vault`, `set_current`, `with_session`.

**Stato:** Promossa alla voce [§15.8](todo.md)

**Perché si nota:** Se un vault aperto viene eliminato dal disco, o se l'unità esterna/volume su cui risiede viene scollegata mentre il vault è aperto in Fub, l'invocazione di `host.close_vault(path)` o `host.with_session(Some(path), ...)` esegue in prima battuta `canonical(root)?`. La chiamata a `root.canonicalize()` fallisce con errore I/O (`NotFound`), interrompendo la funzione prima di poter consultare la mappa delle sessioni aperte `sessions.open`. Di conseguenza, l'oggetto `VaultSession` in memoria (con i relativi thread del watcher e del `JobRunner`) rimane bloccato nella mappa `sessions.open` e non può più essere chiuso tramite `close_vault`.

**Cosa guardare:** `session.rs` (funzione `canonical` e risoluzione delle chiavi in `sessions.open`). A differenza di `forget_vault` (che impiega `forme_della_radice` per tentare la corrispondenza con le forme del path prima e dopo l'eventuale scomparsa), `close_vault` e `with_session` si affidano esclusivamente a `canonical(root)?`. Sarebbe opportuno cercare direttamente il path passato nelle chiavi di `sessions.open` prima di fallire sulla risoluzione canonica di un percorso non più presente su disco.

**Collegamenti:** [`VaultRegistry::forget`](../crates/fub-host/src/vaults.rs), [decisione 0029](decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md).

---

## 0008 — `set_plugin_enabled(false)` non disattiva i plugin con job in volo e salta `Plugin::deactivate`

**Dove:** `crates/fub-host/src/session.rs` (`Host::set_plugin_enabled`) e `crates/fub-host/src/registry.rs` (`BundleRegistry::stop`).

**Stato:** Promossa alla voce [§16.10](todo.md)

**Perché si nota:** Quando l'utente disattiva un componente tramite IPC (`set_plugin_enabled`), il metodo `Host::set_plugin_enabled` invoca `registry.unmount(&mut ws, id)`, che a sua volta chiama `stop(ws, id)`. `stop()` tenta di ottenere un riferimento mutabile esclusivo via `Arc::get_mut(&mut bundle.plugin)`. Se un lavoro lungo (job) appartenente a quel plugin è attualmente in volo nel `JobRunner`, la struct `Shared` dei worker possiede un clone dell'`Arc<dyn Plugin>`. Di conseguenza `Arc::get_mut` fallisce e restituisce `None`. In questo scenario `stop()` logga un errore interno ma salta la chiamata a `Plugin::deactivate(host)`. Subito dopo `unmount` procede comunque a rimuovere la dichiarazione del plugin dal kernel (`ws.deactivate_plugin(id)`). Il plugin viene quindi smontato dal workspace senza che il suo handler di chiusura `deactivate` sia mai stato eseguito.

**Cosa guardare:** In `session.rs` e `runner.rs`, `set_plugin_enabled(vault, id, false)` dovrebbe annullare e attendere il completamento/cancellazione dei job pendenti o in volo relativi a `id` prima di procedere con `registry.unmount`.

**Collegamenti:** [decisione 0028](decisions/0028-come-un-componente-smette.md), [decisione 0031](decisions/0031-chi-possiede-i-bundle.md), [decisione 0032](decisions/0032-il-runner-dei-job.md).

---

## 0009 — `Banco::con_spia` cancella gli eventi della semina e della scansione iniziale

**Dove:** `crates/fub-testkit/src/lib.rs` — metodo `Banco::monta`.

**Stato:** Nota di comportamento nel banco di prova del lato host.

**Perché si nota:** Durante l'inizializzazione del banco in `Banco::monta()`, l'invocazione di `registro.lock().unwrap().clear()` viene eseguita subito dopo `ws.reindex()`. Il commento nel codice spiega che "chi chiede la spia vuole vedere gli eventi delle proprie mosse, non quelli della semina". Tuttavia, questo fa sì che l'opzione `con_spia()` cancelli anche gli eventi generati dalla prima scansione dell'indicizzatore se il banco viene creato senza `.senza_scansione()`. Un test che intenda verificare gli eventi emessi durante l'indicizzazione iniziale deve ricordarsi di passare `.senza_scansione()` al builder e chiamare `reindex()` manualmente dopo il montaggio.

**Cosa guardare:** `crates/fub-testkit/src/lib.rs` (metodo `Banco::monta`). È un comportamento documentato nei commenti ma da tenere a mente nell'uso del `Banco`.

**Collegamenti:** [decisione 0055](decisions/0055-il-banco-del-lato-host.md), `crates/fub-testkit/src/lib.rs`.

---

## 0010 — Notifiche di errori nei comandi Tauri `close_vault` e `set_plugin_enabled` ritornano stringhe invece di `PluginError` tipizzati

**Dove:** `crates/fub-app/src/lib.rs` — comandi `close_vault` e `set_plugin_enabled`.

**Stato:** Promossa alla voce [§16.9](todo.md)

**Perché si nota:** La quasi totalità dei comandi IPC Tauri in `fub-app` è stata convertita per restituire `Result<T, PluginError>`, consentendo la trasmissione di errori tipizzati in formato JSON (`{"kind": "...", "message": "..."}`). Tuttavia, i comandi `close_vault` e `set_plugin_enabled` restituiscono rispettivamente `Result<Vec<String>, PluginError>` e `Result<Vec<String>, PluginError>`, convertendo la lista degli avvisi/errori generati dal kernel o dai plugin con `.map(|e| e.to_string())`. In questo modo le singole notifiche all'interno del vettore perdono la propria variante di errore tipizzata sul confine IPC.

**Cosa guardare:** In `crates/fub-app/src/lib.rs`, valutare se restituire `Result<Vec<PluginError>, PluginError>` per mantenere la medesima struttura tipizzata di errore su tutta la superficie IPC.

**Collegamenti:** [decisione 0041](decisions/0041-un-errore-e-testo-che-qualcuno-legge.md), [decisione 0057](decisions/0057-la-dieta-dell-ipc.md).

---

## 0011 — Omissione di tipi fondamentali di `traits.rs` dai re-export di livello radice in `fub-abi`

**Dove:** `crates/fub-abi/src/lib.rs` — blocco `pub use traits::{ ... }` (righe 97-105).

**Stato:** Promossa alla voce [§16.9](todo.md)

**Perché si nota:** Il file `lib.rs` di `fub-abi` dichiara di offrire un re-export dei tipi più usati per un import ergonomico dai crate consumatori. Tuttavia, 7 tipi primari definiti in `src/traits.rs` non sono stati inclusi nel blocco `pub use traits::{...}`: `DocPosition`, `ResolvedRef`, `JobSpec`, `JobId`, `JobProgress`, `JobStatus`, `PluginPermissions`. Mentre tutti gli altri tipi analoghi (`TrashEntry`, `IndexResult`, `DocumentMatch`, `QueryRoute`, `IndexLoss`, `Page`, `Paged`) sono riesportati alla radice del crate `fub_abi`, chi consuma questi 7 tipi è costretto ad accedere a `fub_abi::traits::*` invece che a `fub_abi::*`.

**Cosa guardare:** `crates/fub-abi/src/lib.rs`. Aggiungere i 7 tipi mancanti al blocco `pub use traits::{ ... }`.

**Collegamenti:** `crates/fub-abi/src/lib.rs`, `crates/fub-abi/src/traits.rs`.

---

## 0012 — Conversione `usize` -> `u32` senza `try_from` nella generazione di `short_id`

**Dove:** `crates/fub-sdk/src/ids.rs` — funzione `short_id` (riga 85).

**Stato:** Promossa alla voce [§16.9](todo.md)

**Perché si nota:** Nella funzione `short_id(host: &dyn HostEnv, len: usize)`, il parametro `len` viene convertito verso l'API dell'host tramite un cast diretto `len as u32`: `let bytes = host.random_bytes(len as u32);`. In `fub-abi/src/arena.rs` la conversione inversa dei contatori di arena tra `usize` e `u32` è presidiata con `u32::try_from(len).expect(...)`. Nelle architetture a 64 bit, un valore anomalo di `len` superiore a `u32::MAX` verrebbe troncato a 32 bit dal cast `as u32` prima del controllo `bytes.len() < len`, richiedendo all'host un numero errato di byte casuali invece di fallire immediatamente a `None`.

**Cosa guardare:** `crates/fub-sdk/src/ids.rs` (riga 85). Sostituire `len as u32` con `u32::try_from(len).ok()?`.

**Collegamenti:** `crates/fub-sdk/src/ids.rs`, `crates/fub-abi/src/arena.rs`.

---

## 0013 — Divergenza potenziale fra i default di `OptionMap` e i booleani nelle capabilities

**Dove:** `crates/fub-abi/src/options.rs` (metodi `enabled`, `get`) e `crates/fub-abi/src/format.rs`.

**Stato:** Promossa alla voce [§16.9](todo.md)

**Perché si nota:** La Decisione 0017 definisce la mappa con namespace `OptionMap` (`ns:nome` -> valore JSON) per sostituire gli elenchi di booleani. La regola stabilita recita: "presente = acceso, il valore è il dettaglio, un `false` esplicito spegne". Nel metodo `OptionMap::enabled(&self, key: &str) -> bool`, la presenza della chiave restituirà `false` sia se la chiave è assente, sia se la chiave è presente ed ha valore `false`. Questo non consente a chi legge una capability di distinguere tra "sintassi disattivata nel ParseContext" e "sintassi non supportata affatto dal FormatProvider".

**Cosa guardare:** `crates/fub-abi/src/options.rs`. Valutare se esporre un metodo helper `status(&self, key: &str) -> OptionStatus` per distinguere l'assenza della chiave dal disinserimento esplicito `false`.

**Collegamenti:** [Decisione 0017](decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md), `crates/fub-abi/src/options.rs`.

---

## 0014 — Dettaglio diagnostico del rifiuto di `DocumentSource::Bytes` in `FormatProvider`

**Dove:** `crates/fub-abi/src/format.rs` e `crates/fub-abi/src/error.rs`.

**Stato:** Promossa alla voce [§16.9](todo.md)

**Perché si nota:** `FormatDescriptor::source` specifica se un formato richiede un sorgente testuale UTF-8 (`SourceKind::Text`) o byte grezzi (`SourceKind::Bytes`). La documentazione dei trait specifica che un provider testuale che riceve `DocumentSource::Bytes` deve restituire `FormatError::Unsupported`. Tuttavia, la variante `FormatError::Unsupported` è una variante nuda o generica e non porta una prosa di spiegazione localizzabile, diversamente dai requisiti introdotti con la Decisione 0041 (errore come testo leggibile localizzato).

**Cosa guardare:** `crates/fub-abi/src/error.rs`. Valutare l'arricchimento della variante `Unsupported` con un campo `Text` facoltativo per spiegare la ragione dell'incompatibilità sorgente/formato.

**Collegamenti:** [Decisione 0041](decisions/0041-un-errore-e-testo-che-qualcuno-legge.md), `crates/fub-abi/src/format.rs`, `crates/fub-abi/src/error.rs`.

---

## 0015 — Import misto di `codemirror` e pacchetti modulari `@codemirror/*`

**Dove:** `frontend/src/editor/editor.ts` — riga 9: `import { basicSetup } from "codemirror";` a fianco di import dai singoli sottomoduli `@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`.

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** Il pacchetto `codemirror` è un meta-pacchetto che riesporta l'ambiente base. Mischiarlo con gli import diretti dalle librerie atomiche (`@codemirror/*`) aumenta il rischio che futuri aggiornamenti delle dipendenze in `package.json` possano tirare dentro due versioni distinte dello stato di CodeMirror, causando l'errore `Unrecognized extension value` a runtime.

**Cosa guardare:** `frontend/package.json` e `frontend/src/editor/editor.ts`. Se si desidera mantenere la massima disciplina sul bundling, si può sostituire `basicSetup` con la composizione esplicita o importarlo direttamente da `@codemirror/language` / `@codemirror/commands` / `@codemirror/view`.

**Collegamenti:** [`frontend/package.json`](../frontend/package.json), `editor/editor.ts`.

---

## 0016 — Accumulo di listener in `onLingua` senza meccanismo di rimozione

**Dove:** `frontend/src/i18n/strings.ts` — registro degli ascoltatori `onLingua(cb: () => void)`.

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** `onLingua` aggiunge una callback all'array globale `ascoltatori` senza restituire una funzione di disiscrizione (unlisten). Se in futuro i pannelli o i moduli della UI dovessero essere smontati e rimontati dinamicamente (es. con il modello di layout a tab/pane della feature 3.3), ogni rimontaggio registrerebbe nuovi listener senza rimuovere i precedenti, generando un memory leak silente ad ogni cambio di lingua.

**Cosa guardare:** `frontend/src/i18n/strings.ts`. In vista dell'introduzione del layout dinamico (FEATURES 3.3), è opportuno far restituire a `onLingua` una funzione `() => void` per la disiscrizione.

**Collegamenti:** [`frontend/src/i18n/strings.ts`](../frontend/src/i18n/strings.ts), [decisione 0040](decisions/0040-chi-localizza.md).

---

## 0017 — `list_trash()` fallisce per intero se nel cestino `.trash/` è presente un symlink rotto

**Dove:** `crates/fub-kernel/src/vault.rs` — metodo `walk_trash` (righe 427-464).

**Stato:** Promossa alla voce [§15.8](todo.md)

**Perché si nota:** Durante l'esplorazione ricorsiva del cestino `walk_trash`, il codice invoca `entry.metadata()` per ogni elemento in `.trash/`. Poiché `metadata()` segue i collegamenti simbolici (symlink), se nel cestino è presente un symlink la cui destinazione non esiste più (symlink rotto), l'invocazione restituisce un errore I/O `NotFound`. La funzione propaga immediatamente questo errore interrompendo la scansione dell'intero cestino con `KernelError::Io`. Di conseguenza, l'utente o l'interfaccia non possono elencare né svuotare il cestino finché il symlink rotto non viene rimosso manualmente dal filesystem.

**Cosa guardare:** `crates/fub-kernel/src/vault.rs` (funzione `walk_trash`). Sostituire l'uso diretto di `entry.metadata()` con `entry.symlink_metadata()` oppure gestire l'errore di risoluzione del symlink ignorando i link spezzati anziché far fallire l'intera enumerazione.

**Collegamenti:** `Vault::list_trash`, `Vault::empty_trash`.

---

## 0018 — Scansione lineare $O(N \cdot M)$ con normalizzazione Unicode nella risoluzione dei link rotti

**Dove:** `crates/fub-kernel/src/index/core.rs` — funzioni `resolve_entry_in` (righe 219-224) e `named_entry_in` (righe 238-256).

**Stato:** Promossa alla voce [§17.4](todo.md)

**Perché si nota:** Quando la risoluzione esatta di un link o wikilink fallisce la ricerca esatta per chiave nella `BTreeMap` delle voci (`entries.contains_key(&id)` torna `false`), `resolve_entry_in` e `named_entry_in` eseguono un ripiego (fallback) iterando linearmente su tutte le voci dell'anagrafe. Per ciascuna voce viene calcolata `resolution_key(other.as_str())`, una funzione che esegue pulizia di spazi, conversione a minuscolo e normalizzazione Unicode NFC. In vault con decine di migliaia di file e molti collegamenti non risolti (link rotti o riferimenti ad allegati esterni), questa ricerca lineare viene ripetuta per ogni riferimento in ogni documento, trasformando l'indicizzazione in un'operazione quadraticamente lenta $O(N \cdot M)$.

**Cosa guardare:** `crates/fub-kernel/src/index/core.rs`. Valutare il mantenimento di un indice inverso secondario o di una mappa delle `resolution_key` per evitare scansioni esaustive di tutte le voci sul ripiego.

**Collegamenti:** `CoreIndex::resolve_entry_in`, `CoreIndex::named_entry_in`, `fub_abi::rules::path::resolution_key`.

---

## 0019 — `data_root` e `TRASH_DIR` compongono path relativi sensibili al cambio di working directory

**Dove:** `crates/fub-kernel/src/vault.rs` — funzioni `data_root`, `TRASH_DIR` e `Vault::open`.

**Stato:** Promossa alla voce [§15.8](todo.md)

**Perché si nota:** `Vault::open` accetta un qualunque percorso `root`. Se la radice passata è un percorso relativo (es. `"./mio-vault"`), l'oggetto `Vault` memorizza `root` come `Utf8PathBuf` relativo. Le funzioni `path_for`, `data_root` (`<root>/.fub/data`) e i metodi per il cestino compongono percorsi relativi rispetto a `root`. Qualora il processo principale o un worker modifichi la working directory corrente del processo (`std::env::set_current_dir`), le successive operazioni I/O del vault su `.fub` o `.trash` punteranno a percorsi errati sul filesystem.

**Cosa guardare:** `crates/fub-kernel/src/vault.rs` (metodo `Vault::open`). Canonicalizzare o convertire la radice in percorso assoluto durante `Vault::open` per garantire l'immutabilità della risoluzione dei percorsi.

**Collegamenti:** `Vault::open`, `Vault::path_for`, `data_root`.

---

## 0020 — Disallineamento sul conteggio e l'elenco delle famiglie di `HostApi` in `traits.md`

**Dove:** `docs/architecture/traits.md` — riga 134 (sezione `HostApi`).

**Stato:** Risolto

**Perché si nota:** La sezione `HostApi` in `docs/architecture/traits.md` dichiara: "È una somma di dieci trait (decisione 0021, §7.1)... Le famiglie sono `VaultRead`, `VaultWrite`, `VaultStructure`, `DataRead`, `DataWrite`, `HostEnv`, `HostEvents`, `HostQuery`, `HostCommands`, `HostServices`". Tuttavia, in `crates/fub-abi/src/traits.rs` (righe 1123–1185), in `docs/architecture/plugin-boundary.md` (riga 17) e nella Decisione 0013, l'`HostApi` è definita come la somma di 14 famiglie (`ReadApi` composta da 6 famiglie: `VaultRead`, `DataRead`, `HostQuery`, `HostEnv`, `SettingsRead`, `ViewStateRead` + 8 famiglie di scrittura/eventi: `VaultWrite`, `VaultStructure`, `DataWrite`, `SettingsWrite`, `ViewStateWrite`, `HostEvents`, `HostCommands`, `HostServices`). La prosa di `traits.md` indica erroneamente "dieci trait" ed omette `SettingsRead`, `SettingsWrite`, `ViewStateRead` e `ViewStateWrite`.

**Cosa guardare:** `docs/architecture/traits.md` (sezione `HostApi`). Correggere la descrizione indicando 14 famiglie ed includendo i trait relativi a `Settings` e `ViewState`.

**Collegamenti:** [decisione 0013](decisions/0013-elenco-delle-capacita.md), [decisione 0021](decisions/0021-il-confine.md), `crates/fub-abi/src/traits.rs`.

---

## 0021 — Omissione dei moduli `i18n` e `state/locale.ts` nella mappa dell'albero frontend in `shell.md`

**Dove:** `docs/architecture/shell.md` — sezione `L'albero` (righe 25–79).

**Stato:** Risolto

**Perché si nota:** La mappa dell'albero `frontend/src/` in `shell.md` elenca la disposizione dei moduli (`host/`, `state/`, `ui/`, `panels/`, `editor/`, `rules/`, `theme/`, `__fixtures__/`). Tuttavia, a seguito dell'introduzione della localizzazione (Decisione 0040 e Decisione 0042), sono stati introdotti la cartella `frontend/src/i18n/` (con `strings.ts` e `strings.test.ts`) e il modulo `frontend/src/state/locale.ts`. Entrambi gli elementi mancano nello schema dell'albero riportato in `docs/architecture/shell.md`.

**Cosa guardare:** `docs/architecture/shell.md` (sezione `L'albero`). Aggiornare lo schema dell'albero aggiungendo `frontend/src/i18n/` e `frontend/src/state/locale.ts`.

**Collegamenti:** [decisione 0040](decisions/0040-chi-localizza.md), [decisione 0042](decisions/0042-il-catalogo-della-shell.md), `frontend/src/i18n/strings.ts`.

---

## 0022 — Riferimento di riga obsoleto per `SCHEMA_VERSION` in `versioning.rs` all'interno di `versionamento.md`

**Dove:** `docs/versionamento.md` — tabella al §3 (`Le versioni degli schemi su disco`, riga 102).

**Stato:** Risolto

**Perché si nota:** La tabella degli schemi su disco in `docs/versionamento.md` indica la dichiarazione di `SCHEMA_VERSION` del versioning al riferimento `crates/fub-features/src/versioning.rs:147`. Nei sorgenti correnti la costante `const SCHEMA_VERSION: u32 = 1;` si trova a riga 168 di `crates/fub-features/src/versioning.rs`.

**Cosa guardare:** `docs/versionamento.md` (riga 102). Aggiornare il riferimento di riga a `:168`.

**Collegamenti:** `crates/fub-features/src/versioning.rs#L168`.

---

## 0023 — Omissione della specifica di troncamento dell'ultima estensione per `DocId::page_name()` in `data-model.md`

**Dove:** `docs/architecture/data-model.md` — sezione `DocId` (riga 28).

**Stato:** Risolto

**Perché si nota:** `docs/architecture/data-model.md` descrive `page_name()` affermando che "restituisce il basename senza estensione". Nei sorgenti (`crates/fub-abi/src/model.rs`, righe 81–99), la regola è definita precisamente per rimuovere solo l'ultima estensione (`rsplit_once('.')`) preservando i dotfile (`.obsidian` -> `.obsidian`, `note.backup.md` -> `note.backup`). La formulazione sintetica in `data-model.md` dice genericamente "senza estensione", che potrebbe far pensare alla rimozione di tutte le estensioni o al troncamento scorretto dei dotfile.

**Cosa guardare:** `docs/architecture/data-model.md` (sezione `DocId`). Chiarire la regola esatta del basename (rimozione dell'ultima estensione via `rsplit_once`, dotfile inalterati).

**Collegamenti:** `crates/fub-abi/src/model.rs#L81-L99`.

---

## 0024 — Listener `click` pendente in `showContextMenu` dopo la chiusura del menu via tastiera

**Dove:** `frontend/src/ui/menu.ts` (`showContextMenu`, `closeContextMenu`).

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** Quando si apre un menu contestuale, `showContextMenu` registra un ascoltatore globale con `setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 0)` per chiudere il menu al primo click esterno. Tuttavia, se l'utente chiude il menu tramite il tasto `Escape`, la trappola del fuoco invoca `closeContextMenu()`, rimuovendo l'elemento dal DOM e sciogliendo la trappola, ma **senza** rimuovere l'ascoltatore `click` registrato nel `setTimeout`. L'ascoltatore rimane registrato su `document`. Il click successivo effettuato dall'utente in un punto qualsiasi dell'applicazione (o durante l'apertura di un nuovo menu contestuale) consuma l'ascoltatore pendente ed esegue subito `closeContextMenu()`, chiudendo inaspettatamente elementi della UI appena aperti.

**Cosa guardare:** In `frontend/src/ui/menu.ts`, conservare il riferimento alla funzione di ascolto del click e rimuoverla esplicitamente con `document.removeEventListener("click", ...)` dentro `closeContextMenu()`.

---

## 0025 — Riconciliazione incompleta di `select`, `radio` e attributi `input` in `ui/node.ts`

**Dove:** `frontend/src/ui/node.ts` (funzione `aggiorna`).

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** Nel confronto fra due alberi `UiNode` consecutivi:
1. Per i nodi `select`, se il numero di opzioni e i relativi valori (`value`) rimangono invariati, `aggiorna` restituisce `true` senza aggiornare le etichette di testo (`textContent`) dei tag `<option>`. Se le etichette cambiano (es. a seguito di un cambio di lingua o di un aggiornamento del conteggio nelle opzioni), il DOM conserva i testi precedenti.
2. Per i nodi `radio`, se il numero di opzioni non varia, `aggiorna` aggiorna solo lo stato `checked` senza verificare se i valori o le etichette delle opzioni sono variati, lasciando nel DOM i vecchi testi ed i vecchi valori.
3. Per i nodi `text_input`, `number`, `slider` e `date_picker`, gli attributi `placeholder`, `min`, `max` e `step` non vengono riallineati se cambiano nel nuovo nodo `next`.

**Cosa guardare:** In `frontend/src/ui/node.ts` nella funzione `aggiorna`, aggiornare esplicitamente `textContent` ed i valori delle opzioni per `select` e `radio`, e riallineare gli attributi `placeholder`, `min`, `max` e `step` per gli input numerici e testuali.

---

## 0026 — Cambio di scheda nella sidebar forzato al termine di una ricerca in volo

**Dove:** `frontend/src/panels/search.ts` (funzione `showSearchResults`).

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** Quando viene avviata una ricerca (sia tramite digitazione nella barra di ricerca, sia via `searchFor`), l'invocazione di `runSearch()` richiede i risultati al canale dati via IPC. Al termine dell'operazione asincrona, `showSearchResults` chiama incondizionatamente `showPanel("search")`. Se l'utente, durante l'attesa dei risultati o durante il debounce di 180ms, ha deliberatamente cambiato pannello nella sidebar (es. cliccando su "Torna alle note" per visualizzare l'albero `files` o sul `trash`), l'arrivo della risposta di ricerca forza il cambio di scheda riportando lo stato visivo della sidebar su `search`.

**Cosa guardare:** In `frontend/src/panels/search.ts`, verificare se il pannello della ricerca era già attivo o se l'azione è stata avviata direttamente dall'utente prima di chiamare `showPanel("search")` in `showSearchResults`.

---

## 0027 — Wikilink interni alla nota (`[[#Sezione]]`, `[[#^blocco]]`) ignorati in `openWikilink`

**Dove:** `frontend/src/panels/document.ts` (funzione `openWikilink`).

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** La funzione `openWikilink(page, heading, block)` inizia con la riga `if (!page) return;`. Quando l'utente clicca su un wikilink rivolto ad una sezione o blocco interno al documento corrente (es. `[[#Sezione]]` o `[[#^blocco]]`), il parser di live preview / anteprima estrae `page = ""` ed invoca `openWikilink("", "Sezione")`. A causa del controllo `if (!page) return;`, la funzione termina immediatamente senza invocare `riferimentoRisolto` con il documento corrente (`state.currentDoc`), impedendo lo scorrimento automatico tramite `revealByteOffset`.

**Cosa guardare:** In `frontend/src/panels/document.ts`, consentire a `openWikilink` di procedere quando `page` è vuota ma `heading` o `block` sono valorizzati, passando `state.currentDoc` a `riferimentoRisolto` per ottenere l'offset di posizionamento ed effettuare il `revealByteOffset`.

---

## 0028 — Inclusione forzata di `false` nei parametri booleani opzionali in `argsFromForm`

**Dove:** `frontend/src/ui/palette.ts` (funzione `argsFromForm`).

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** Nella funzione `argsFromForm`, per la variante `bool`, il valore del parametro viene impostato come `args[param.name] = value === true || value === "true"`. Di conseguenza, se un parametro booleano di un comando è opzionale (`required: false`) e la casella di spunta non viene toccata dall'utente, `args[param.name]` viene comunque popolato con `false`. Per tutti gli altri tipi di parametri opzionali (`number`, `text`, `documents`, `choice`), i campi non compilati vengono omessi dall'oggetto `args` per consentire l'uso dei valori predefiniti del kernel.

**Cosa guardare:** In `frontend/src/ui/palette.ts`, distinguere se un campo booleano opzionale debba essere omesso dal payload quando non presente o non interagito nel form.

---

## 0029 — Mancata esposizione di `EditorView.destroy` nel wrapper dell'editor

**Dove:** `frontend/src/editor/editor.ts` (funzione `createEditor`).

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** Il wrapper generato da `createEditor` non espone un metodo per distruggere l'istanza dell'editor sottostante. `EditorView.destroy()` è cruciale per scollegare correttamente l'editor dal DOM, ripulire gli eventi (come i listener di aggiornamento e la trappola del focus) e dereferenziare lo stato di CodeMirror 6. Nel paradigma attuale (un singolo editor globale) questo non è bloccante, ma con l'evoluzione verso "pannelli smontabili" (vedi commenti in `store.ts`), ricreare l'editor causerà un leak delle risorse.

**Cosa guardare:** Aggiungere un metodo `destroy(): void` al wrapper in `editor.ts` che invochi internamente `view.destroy()`, e ricordarsi di chiamarlo in `panels/document.ts` al momento dello smontaggio del componente editor, se applicabile.

---

## 0030 — Race condition durante il salvataggio asincrono con input continuo

**Dove:** `frontend/src/panels/document.ts` (funzione `saveCurrent`).

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** L'auto-salvataggio temporizzato di 400ms (`scheduleSave`) invoca `saveCurrent()`, che a sua volta invoca asincronamente `api.writeDocument`. Tuttavia, non ci sono meccanismi di locking o lock-out per evitare esecuzioni concorrenti di `saveCurrent()`. Se l'utente continua a scrivere e `writeDocument` impiega più di 400ms a rispondere via IPC, una seconda chiamata a `saveCurrent()` può essere innescata prima che la prima sia terminata. Il backend rischia così di ricevere due chiamate asincrone accavallate o fuori ordine. Inoltre il check in fondo `if (editor.getDoc() === text) state.dirty = false;` può generare anomalie nel momento in cui più task paralleli di salvataggio si sfidano per alterare il boolean di stato.

**Cosa guardare:** Introdurre un flag o un meccanismo a "coda" asincrona nel `panels/document.ts` per garantire che i cicli di salvataggio e di ripristino di `dirty` siano elaborati in modo strettamente sequenziale.

---

## 0031 — Sovrascrittura dello stato chiuso dell'anteprima con rendering stale

**Dove:** `frontend/src/panels/preview.ts` (funzione `updatePreview`).

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** Quando si cambia documento o lo si chiude (`closeDocument`), viene invocato contestualmente `clearPreview()`, il quale pulisce brutalmente l'innerHTML dell'elemento DOM dell'anteprima. Tuttavia, se c'era una chiamata asincrona `updatePreview(id)` in volo, e il tempo IPC di `api.renderPreview(id)` scade **dopo** aver ripulito la UI, il thread riprenderà invocando `innesta(previewEl, reso);`. Ne risulta che il vecchio documento in volo finisce per venire iniettato nel DOM nonostante il file sia stato appena chiuso o ne sia stato appena caricato un altro.

**Cosa guardare:** Aggiungere in `updatePreview` una logica di cancellazione, o un token generazionale, in modo da rifiutare l'innesto di HTML proveniente da un ID che non corrisponde più all'ID atteso correntemente dal pannello di anteprima.

---

## 0032 — Lock contention e deadlock potenziali nell'Host (Risolto)

**Dove:** `crates/fub-host/src/session.rs` (`Host::with_session`, `Host::set_plugin_enabled`).

**Stato:** Era un rischio di deadlock e blocco I/O globale per l'host. Corretto durante l'audit odierno.

**Perché si nota:** La funzione `with_session` eseguiva la closure passata mantenendo bloccato il mutex globale `self.sessions`. Funzioni come `set_plugin_enabled` richiedevano lock aggiuntivi (`workspace.write()` e `registry.lock()`) *all'interno* di questa closure. Se un `JobRunner` o un'altra operazione in volo tenevano bloccato il `workspace` per il proprio lavoro, la chiamata utente a `set_plugin_enabled` bloccava indefinitamente il mutex di tutte le sessioni. Questo impediva non solo la gestione della sessione corrente, ma bloccava l'intero backend per tutti gli altri vault aperti. In aggiunta, `canonical()` veniva eseguito tenendo bloccato il mutex, introducendo operazioni di I/O sincrone sul filesystem mentre gli altri thread attendevano.

**Cosa guardare:** Il fix rilasciato ha modificato la logica per chiamare `canonical()` prima di acquisire il lock. Inoltre, `set_plugin_enabled` ora usa `with_session` solo per clonare le istanze (`Arc<RwLock<Workspace>>` e `Arc<Mutex<BundleRegistry>>`) per il vault specifico, rilasciando subito dopo il lock globale delle sessioni e prima di prendere i lock di scrittura sul workspace e registro. Le dipendenze per `fub-kernel`, `fub-abi` e `fub-host` rimangono rigorosamente intatte da `tauri`, `comrak` e `wasmtime` secondo l'invariante di progetto.

---

## 0033 — Race condition su chiamate concorrenti a `openDocument`

**Dove:** `frontend/src/panels/document.ts` (`openDocument`).

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** Se l'utente clicca rapidamente due note di seguito nella sidebar, `openDocument` esegue due chiamate asincrone `api.readDocument(id)`. L'assegnazione dello stato (`state.currentDoc = id`) avviene prima dell'attesa di rete. Dato che l'assegnazione al buffer (`editor.setDoc`) avviene *dopo* l'`await` sul backend, se la prima chiamata risolve più lentamente della seconda, l'editor finirà per visualizzare il contenuto del primo documento mentre `state.currentDoc` e la UI (incluso il path attivo) punteranno al secondo.

**Cosa guardare:** In `frontend/src/panels/document.ts` (funzione `openDocument`), salvare in una variabile locale l'ID richiesto o usare un token di sequenza e verificare, prima di fare `editor.setDoc` e `publishContext`, che `state.currentDoc === id`, ignorando la risposta se l'utente ha già cambiato nota.

---

## 0034 — Race condition da concorrenza non gestita in `refreshFromKernel`

**Dove:** `frontend/src/panels/explorer.ts` (`refreshFromKernel`).

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** `refreshFromKernel` interroga asincronamente il backend per ricaricare le cartelle visibili (`caricaVisibili()`) e ricostruisce la variabile globale `vista`. Poiché non vi è alcun meccanismo di locking o debouncing/cancellazione delle chiamate in volo, se l'utente espande/contrae rapidamente più cartelle (es. tramite navigazione da tastiera veloce) o se si scatenano eventi multipli contemporaneamente, più istanze di `refreshFromKernel` possono trovarsi in esecuzione concorrente. Se una chiamata precedente impiega più tempo a risolvere di una successiva, la sovrascrittura di `vista` avverrà in un ordine errato (out-of-order), ripristinando il vecchio stato dell'albero e scartando le modifiche successive.

**Cosa guardare:** Introdurre in `frontend/src/panels/explorer.ts` (`refreshFromKernel`) un contatore generazionale o un flag di locking per impedire aggiornamenti obsoleti o accavallati della variabile `vista`.

---

## 0089 — Interruzione della potatura in `forget_vault` al primo errore I/O

**Dove:** `crates/fub-host/src/session.rs` (`Host::forget_vault`).

**Stato:** Rischio di memory leak silente e stato inconsistente per vault dimenticati.

**Perché si nota:** `forget_vault` itera sulle `forme_della_radice` per ripulire lo stato di vista da `view_states`. Se `view_states.forget_vault(forma.as_str())` fallisce per un errore I/O, il ciclo viene interrotto immediatamente con un `?` propagando l'errore al chiamante. Poiché `self.vaults.forget(&forme)?` è già stato eseguito con successo, il vault viene rimosso dal registro dei recenti, ma le forme successive non vengono eliminate da `view_states`. L'utente non potendo più "dimenticare" il vault (in quanto non più presente nella UI), lascia un residuo permanente nel file di stato di vista.

**Cosa guardare:** In `crates/fub-host/src/session.rs`, raccogliere eventuali errori I/O emessi da `view_states.forget_vault` nel ciclo for e restituirli alla fine, garantendo l'esecuzione della pulizia per tutte le `forme` disponibili.

**Collegamenti:** [`Host::forget_vault`].

---

## 0090 — Divergenza in memoria su fallimento di `set_setting` in `set_plugin_enabled`

**Dove:** `crates/fub-host/src/session.rs` (`Host::set_plugin_enabled`).

**Stato:** Stato inconsistente tra memoria (registro) e disco (settings) in caso di errore I/O.

**Perché si nota:** Durante l'attivazione/disattivazione di un plugin, `BundleRegistry::enable` o `unmount` vengono eseguiti con successo in memoria. Successivamente, la funzione tenta di persistere l'elenco dei plugin disattivati tramite `ws.set_setting(crate::settings::PLUGINS_DISABLED, ...)?`. Se questa operazione di I/O fallisce, la funzione propaga l'errore terminando anticipatamente. Il plugin rimane attivato (o disattivato) nel `Workspace` e nel `BundleRegistry` per la sessione corrente, ma il disco non riflette questa modifica, portando a una divergenza al prossimo avvio.

**Cosa guardare:** In `crates/fub-host/src/session.rs`, gestire il fallimento di `set_setting` ripristinando lo stato in memoria del plugin, oppure segnalare un warning (come avviene in altre parti del sistema) anziché causare un fallimento hard dopo che lo stato in memoria è già mutato.

**Collegamenti:** [`BundleRegistry::enable`], [`BundleRegistry::unmount`].

---

## 0091 — Cambio di vault corrente alfabetico alla chiusura

**Dove:** `crates/fub-host/src/session.rs` (`Host::close_vault`).

**Stato:** Comportamento UX non ottimale durante la gestione di multipli vault.

**Perché si nota:** Quando si chiude il vault impostato come "corrente", `Host::close_vault` aggiorna il vault corrente prendendo il primo elemento disponibile tramite `sessions.open.keys().next().cloned()`. Poiché `sessions.open` è un `BTreeMap`, `keys()` restituisce i percorsi in ordine alfabetico. Questo comporta che il nuovo vault corrente diventi semplicemente il primo in ordine alfabetico, ignorando l'ordine cronologico o l'ultimo vault effettivamente utilizzato dall'utente.

**Cosa guardare:** In `crates/fub-host/src/session.rs`, valutare l'uso del `VaultRegistry` per determinare quale tra i vault ancora aperti è stato utilizzato più di recente, promuovendolo a corrente.

**Collegamenti:** [`Host::close_vault`].

---

## 0035 — Eventi pendenti non drenati in `deactivate_plugin` se il plugin non ha indici

**Dove:** `crates/fub-kernel/src/workspace.rs` (`Workspace::deactivate_plugin`).

**Stato:** Eventi pendenti e completamenti di job non segnalati tempestivamente ai subscriber.

**Perché si nota:** `Workspace::deactivate_plugin` cancella i job in volo o pendenti per il plugin tramite `self.complete_job(..., Err(...))`. Questo accoda un evento `Event::JobDone`. Inoltre, le chiamate a `index.flush()` o `index.close()` potrebbero aver accodato eventi tramite l'API dell'host. Tuttavia, il drenaggio della coda eventi (`ws.dispatch_pending()`) viene eseguito alla fine della funzione *esclusivamente* se `removed_indexes` è vero (ovvero se il plugin aveva registrato indici). Se il plugin non ha indici, gli eventi generati dalla cancellazione dei job rimangono nella coda del `Dispatcher` finché un'altra operazione sul workspace non li drena in modo fortuito.

**Cosa guardare:** In `crates/fub-kernel/src/workspace.rs`, sollevare `ws.dispatch_pending()` fuori dal condizionale `if removed_indexes` per garantire che tutti gli eventi accumulati durante la disattivazione (compresi i `JobDone`) vengano propagati tempestivamente ai listener.

**Collegamenti:** [`Workspace::deactivate_plugin`], [`Workspace::complete_job`].

---

## 0092 — Application Crash on Poisoned Locks

**Dove:** `crates/fub-app/src/lib.rs`

**Stato:** Promossa alla voce [§20.6](todo.md)

**Perché si nota:** The application relies entirely on `.unwrap()` to extract `RwLock` guards. If any thread panics while holding the lock, the lock becomes 'poisoned'. Any subsequent IPC command from the frontend attempting to acquire the lock will panic on the `.unwrap()`, crashing the entire Tauri application.
**Recommendation:** Handle the `PoisonError` gracefully (e.g., `ws.read().map_err(|_| PluginError::Internal("Lock poisoned"))`), allowing the frontend to receive a descriptive error instead of crashing the backend.

---

## 0036 — Silent Event Loss During Initialization

**Dove:** `crates/fub-app/src/lib.rs`

**Stato:** Promossa alla voce [§20.8](todo.md)

**Perché si nota:** The `WebviewEvents` bridge silently ignores events emitted before the `AppHandle` is injected into the `OnceLock` during Tauri's `setup` hook. If the `Host` configuration or setup logic emits early system-level warnings or notices, they will vanish without a trace.
**Recommendation:** Buffer early events in a `Mutex<Vec<Notice>>` until the `AppHandle` is attached, at which point the buffer can be flushed to the frontend, or at minimum, log the dropped events using `tracing::debug!`/`warn!`.

---

## 0037 — Unhandled Serialization Failures in Event Bridge

**Dove:** `crates/fub-app/src/lib.rs`

**Stato:** Promossa alla voce [§20.8](todo.md)

**Perché si nota:** The result of `app.emit` is actively swallowed. If a `notice` payload fails to serialize to JSON, the event is silently lost. The frontend will fail to update without any indication as to why.
**Recommendation:** Log the failure instead of ignoring it: `if let Err(e) = app.emit(...) { tracing::error!("Failed to emit event: {}", e); }`.

---

## 0038 — Synchronous I/O and Blocking IPC Commands

**Dove:** `crates/fub-app/src/lib.rs`

**Stato:** Promossa alla voce [§20.7](todo.md)

**Perché si nota:** The Tauri commands are declared as synchronous functions and perform standard thread blocking (waiting for a lock) followed by file I/O operations. While Tauri offloads synchronous commands to a thread pool, heavy lock contention or slow disk I/O on large documents will monopolize this thread pool. If the pool is exhausted, subsequent IPC requests will bottleneck and freeze the application's responsiveness.
**Recommendation:** Consider declaring the Tauri commands as `async fn` and using `tauri::async_runtime::spawn_blocking` internally to encapsulate the lock acquisition and blocking file operations.

---

## 0039 — TOCTOU Race Condition in propose_free_name

**Dove:** `crates/fub-app/src/lib.rs`

**Stato:** Da revisionare

**Perché si nota:** The `propose_free_name` command queries a free name under a read lock. As acknowledged in the docstring, it does not reserve the name. This introduces a potential race condition for rapid automated creation, requiring the frontend to handle late-stage name-conflict rejections gracefully.
**Recommendation:** Ensure the frontend handles the `PluginError` properly when a late-stage collision happens, or implement a short-lived reservation system within the workspace lock.

---

## 0040 — Massive Synchronous I/O Bottleneck in vault_replace

**Dove:** `crates/fub-features/src/commands.rs`

**Stato:** Promossa alla voce [§20.7](todo.md)

**Perché si nota:** In the `vault_replace` command, if no explicit `docs` argument is provided, the system retrieves all documents in the vault and reads every single one. In large vaults, this triggers massive synchronous disk I/O and unnecessary memory allocations for files that likely don't contain the search term, blocking the entire thread.
**Recommendation:** Leverage the HostApi to query the search index first. Execute an initial `host.query_index` with the search term to retrieve only the `DocId`s of notes that actually contain the text, heavily reducing the number of documents loaded into memory.

---

## 0041 — Deadlock Risk in SearchIndex::commit (Double-Checked Locking)

**Dove:** `crates/fub-features/src/search.rs`

**Stato:** Promossa alla voce [§21.11](todo.md)

**Perché si nota:** `SearchIndex::commit` uses a double-checked locking mechanism with a `dirty` flag and `self.writer.lock()`. Because `writer.commit()` and `reader.reload()` are slow disk operations, the `dirty` flag stays `true` for an extended period. Concurrent read queries will see `dirty == true` and attempt to acquire `writer.lock()`, stalling all searches until the commit finishes and defeating read parallelism.
**Recommendation:** Use a non-blocking lock mechanism (e.g., `try_lock()`) or manage the `dirty` state alongside a `committing` flag to allow read queries to proceed with slightly stale index data without deadlocking.

---

## 0042 — Inconsistent State Management in SearchIndex::up_to_date causing Data Loss

**Dove:** `crates/fub-features/src/search.rs`

**Stato:** Promossa alla voce [§21.11](todo.md)

**Perché si nota:** The `up_to_date` method unconditionally executes `announced.clear()` right away. If the Host API batches metadata in multiple calls, previously registered revisions in the `announced` map will be overwritten and lost before `on_documents_indexed` can consume them. This leaves documents indexed without their source revision, forcing continuous re-indexing on every startup.
**Recommendation:** Remove `announced.clear()` from the top of `up_to_date`. Cache clearing is already correctly handled at the end of the loop within the `reconcile` method.

---

## 0043 — Out-of-Memory (OOM) Risk due to Unbounded Pagination in search

**Dove:** `crates/fub-features/src/search.rs`

**Stato:** Promossa alla voce [§17.4](todo.md)

**Perché si nota:** When `page` is `None`, limits default to the total vault size (`total`). A broad query in a large vault will cause the Tantivy library to allocate huge heap structures for `TopDocs::with_limit(total)`, loading and storing snippets for the entire vault in memory, which risks OOM panics.
**Recommendation:** Implement a hard safety limit (e.g., maximum 1000 results) when `page` is omitted to prevent memory exhaustion.

---

## 0044 — Silent failure on meta.json parsing allows directory hijacking

**Dove:** `crates/fub-features/src/versioning.rs`

**Stato:** Da revisionare

**Perché si nota:** In `read_meta`, parsing errors from `serde_json::from_slice` are silently converted to `None` using `.ok()`. Inside `ensure_dir`, if `read_meta` returns `None`, the directory is assumed to be free. If `meta.json` becomes corrupted, the system will claim the directory for a new document, potentially intermingling histories or overwriting snapshots.
**Recommendation:** Properly handle deserialization errors and fail explicitly rather than swallowing them.

---

## 0045 — Massive memory bottleneck during index rebuild

**Dove:** `crates/fub-features/src/versioning.rs`

**Stato:** Promossa alla voce [§17.4](todo.md)

**Perché si nota:** In `rebuild_from_store`, the code iterates over every snapshot, loading its entire content into memory via `host.data_read` just to compute its `hash` (`fingerprint(&source)`). Rebuilding an index in a vault with hundreds of large snapshots will trigger huge memory spikes.
**Recommendation:** Calculate hashes via chunked streaming readers rather than loading whole snapshots into memory simultaneously, or cache the fingerprints alongside the snapshots.

---

## 0046 — Holding Mutex locks across I/O boundaries

**Dove:** `crates/fub-features/src/versioning.rs`

**Stato:** Promossa alla voce [§20.7](todo.md)

**Perché si nota:** Methods on `VersionStore` lock the internal state and hold this lock while performing synchronous host I/O operations (`host.data_read`, `host.data_write`). This serializes all versioning operations, blocking other threads.
**Recommendation:** Release the mutex before performing I/O operations, or transition to using async locking primitives if applicable.

---

## 0047 — Action Reveal lacks doc_id in payload, risking cross-document jumps

**Dove:** `crates/fub-features/src/outline.rs`

**Stato:** Da revisionare

**Perché si nota:** In `on_action`, the `REVEAL` action relies on fetching the active document dynamically (`host.active_context()`). If a user clicks an outline item but switches documents in the split-second before the action is processed, the system attempts to reveal the old document's span within the newly active document.
**Recommendation:** Capture the exact `doc_id` inside the `REVEAL` payload when building the `UiNode` to ensure referential integrity.

---

## 0048 — Incomplete attribute escaping in escape_attr

**Dove:** `crates/fub-features/src/blocks.rs`

**Stato:** Da revisionare

**Perché si nota:** The `escape_attr` function escapes `&`, `"`, `<`, and `>`, but misses single quotes (`'`). While strings are currently injected into double-quoted blocks, this creates a latent XSS or layout breakage vulnerability if templates are modified to use single quotes later.
**Recommendation:** Include `'` in the escaping logic (`&#x27;`).

---

## 0049 — Severe Redundant Full-Document Reads on Cursor Movement

**Dove:** `crates/fub-features/src/stats.rs`

**Stato:** Promossa alla voce [§17.4](todo.md)

**Perché si nota:** The `StatsView` uses `ContextMask::all()`, triggering `render_view` on every context change (including cursor moves/selections). Inside `render_view`, it fetches the entire document (`host.read_document`) and recounts all words/characters (`count(&source)`). Doing this on every keystroke/cursor move causes severe UI stuttering and CPU overhead.
**Recommendation:** Cache document statistics and recalculate them only on `EventKind::IndexUpdated`. Selection stats can be computed cheaply from the provided `selection.text` without re-reading the entire document.

---

## 0050 — Double Text Traversal for Statistics

**Dove:** `crates/fub-features/src/stats.rs`

**Stato:** Promossa alla voce [§17.4](todo.md)

**Perché si nota:** The `count` function computes statistics by iterating over the text twice: once for `text.split_whitespace().count()` and once for `text.chars().count()`. Since this runs on a hot path, it unnecessarily doubles CPU cycles.
**Recommendation:** Compute both word and character counts in a single pass over the string.

---

## 0051 — Continuous String Allocation in Render Loop

**Dove:** `crates/fub-features/src/tags.rs`

**Stato:** Promossa alla voce [§17.4](todo.md)

**Perché si nota:** When filtering tags in `build_tags_view`, the logic executes `t.name.to_lowercase().contains(&cerca)`. Calling `.to_lowercase()` allocates a new heap `String` for every tag, on every single keystroke in the filter field.
**Recommendation:** Use case-insensitive string comparisons without allocating (e.g., `eq_ignore_ascii_case`) or pre-compute lowercase names once.

---

## 0052 — Hardcoded UI Element Keys Risking State Leakage

**Dove:** `crates/fub-features/src/tags.rs`

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** The `FILTER_STATE` state key and `FILTER_FIELD` are tightly coupled and hardcoded. If the Host API changes its reconciliation strategy or fails to properly isolate view instances via implicit namespacing, state could leak across different components.
**Recommendation:** Explicitly include the view instance ID or doc ID inside the state key defensively, rather than relying on implicit host-side isolation.

---

## 0053 — Perdita di blocchi HTML crudi durante la serializzazione

**Dove:** `crates/fub-format-markdown/src/serialize.rs`

**Stato:** Promossa alla voce [§23.1](todo.md)

**Perché si nota:** Quando il parser incontra HTML grezzo, genera un `Block::Custom` di tipo `custom_kind::HTML` inserendo la stringa letterale all'interno di `attrs["html"]` e lasciando vuoto l'array `blocks`. Tuttavia, nella funzione `write_block`, i blocchi `Custom` non riconosciuti vengono serializzati iterando sul loro array `blocks`. Poiché per l'HTML questo array è vuoto, i blocchi HTML originali vengono completamente e silenziosamente eliminati dal documento generato.

---

## 0054 — Perdita del testo di fallback per gli Inline::Custom sconosciuti

**Dove:** `crates/fub-format-markdown/src/serialize.rs`

**Stato:** Promossa alla voce [§23.1](todo.md)

**Perché si nota:** In `serialize.rs`, il pattern matching su `Inline::Custom` (ad eccezione delle footnotes) è vuoto (`Inline::Custom { .. } => {}`). Qualsiasi inline custom sconosciuto sparirà completamente durante la serializzazione anziché degradare a testo semplice.

---

## 0055 — Rottura dei Code Block contenenti backticks

**Dove:** `crates/fub-format-markdown/src/serialize.rs`

**Stato:** Promossa alla voce [§23.1](todo.md)

**Perché si nota:** Il serializzatore recinta incondizionatamente tutti i blocchi di codice con tre backtick (```). Se il contenuto `code` del blocco contiene già al suo interno 3 backtick consecutivi, il blocco generato verrà terminato prematuramente, distruggendo la sintassi del documento risultante.

---

## 0056 — Esportazione documento singolo con Frontmatter corrotto

**Dove:** `crates/fub-format-markdown/src/transfer.rs`

**Stato:** Promossa alla voce [§23.1](todo.md)

**Perché si nota:** Quando si esegue un export verso `TARGET_SINGLE` con il parametro `frontmatter = true`, i documenti vengono uniti. Se i file di origine possiedono un frontmatter YAML, questo viene copiato verbatim nel file finale. Tutti i frontmatter dei file successivi al primo verranno interpretati come divisori orizzontali (`---`) seguiti da testo grezzo visibile in pagina.

---

## 0057 — Assenza di contesto (context) per i Link presenti in Intestazioni e Tabelle

**Dove:** `crates/fub-format-markdown/src/parse.rs`

**Stato:** Promossa alla voce [§23.1](todo.md)

**Perché si nota:** In fase di parsing, il campo `link.context` dei link viene valorizzato unicamente nel ramo di `NodeValue::Paragraph`. Qualsiasi link scoperto all'interno di un'Intestazione o di una cella di Tabella manterrà il contesto vuoto (`None`), riducendo la qualità dell'astrazione logica per tali riferimenti nel grafo.

---

## 0058 — `restore_from_trash` scrive il documento prima di cancellare la copia nel cestino

**Dove:** `crates/fub-kernel/src/workspace.rs`, funzione `restore_from_trash` (righe ~1874–1898)

**Stato:** Promossa alla voce [§15.8](todo.md)

**Perché si nota:** Il flusso è: (1) leggi sorgente dal cestino → (2) `write_document` (scrive il file al path di destinazione) → (3) eventuale `migrate_doc_data` → (4) `vault.remove_trashed`. Se il processo crasha fra il passo (2) e il passo (4), l'utente si ritrova con due copie della nota: una al path originale ripristinato e una ancora nel cestino. Al successivo avvio il kernel non riconosce automaticamente la copia nel cestino come orfana (il cestino è piatto e il file esiste già). L'ordine corretto sarebbe: leggere il sorgente, spostare il file dal cestino al path di destinazione (`rename`), poi aggiornare lo stato in memoria — lo stesso pattern atomico che `delete_document` usa in direzione inversa (`vault.trash` prima, poi `remove_document`).

**Cosa guardare:** Il comportamento cambia se `write_document` fallisce dopo la scrittura su disco ma prima che Rust possa restituire il controllo; la copia nel cestino non viene mai rimossa. Da risolvere a M4/M5 quando si introduce il journal (§15.2).
**Collegamento:** Issue 0002 (limitazione complementare: `restore_from_trash` non gestisce asset).

---

## 0059 — `link_rewrite_plan` verifica l'ambiguità su `metas` ma non su `entries`

**Dove:** `crates/fub-kernel/src/workspace.rs`, funzione `link_rewrite_plan` (righe ~2331–2441)

**Stato:** Promossa alla voce [§21.11](todo.md)

**Perché si nota:** La funzione calcola `ambiguous` verificando se esiste un altro documento con lo stesso `page_name` in `self.indexes.core.metas`. Tuttavia `metas` contiene solo i documenti indicizzati (quelli con un `FormatProvider`), non gli allegati. Se nel vault esiste un allegato chiamato `logo.png` e si rinomina la nota `logo.md` in `grafico.md`, la verifica dell'ambiguità non vede `logo.png` in `metas`, e il nuovo wikilink viene scritto come `[[grafico]]` (senza path assoluto) anche se `grafico` è già il nome-senza-estensione di un altro file. Il confronto corretto dovrebbe avvenire su `self.indexes.core.entries` — l'anagrafe completa del vault — come fa già `entry_rewrite_plan` (riga ~2098).

**Cosa guardare:** Rilevante al §14.1 (allegati nel vault); peggiora con ogni formato aggiuntivo registrato.

---

## 0060 — `section_of` usa `usize::MAX` come sentinella di fine sezione

**Dove:** `crates/fub-kernel/src/workspace.rs`, funzione `section_of` (righe ~4351–4376)

**Stato:** innocuo in pratica; teoricamente unsafe se un blocco avesse `span.start == usize::MAX`.

**Perché si nota:** Per trovare la fine di una sezione il codice cerca il successivo heading di livello uguale o superiore; se non esiste, usa `usize::MAX` come valore di confine:
```rust
.unwrap_or(usize::MAX);
```
Il filtro successivo è `s >= start && s < end`. Se un futuro `DocumentModel` avesse un blocco con `span.start == usize::MAX` (ad esempio un blocco sintetico prodotto da un plugin), verrebbe incluso nella sezione quando non dovrebbe. Il valore corretto sarebbe `model.body.last().map(|b| b.span().end).unwrap_or(0)` oppure semplicemente `usize::MAX` con un commento che chiarisca l'invariante. Minore, ma merita un commento esplicito.

**Cosa guardare:** Nessun impatto oggi. Rilevante se si introducono blocchi sintetici con span arbitrari.

---

## 0061 — `insert_sorted`/`remove_sorted` usano `binary_search_by` con comparatore non strettamente totale su alias duplicati

**Dove:** `crates/fub-kernel/src/graph.rs`, funzioni `insert_sorted` e `remove_sorted` (righe ~532–548)

**Stato:** Promossa alla voce [§21.11](todo.md)

**Perché si nota:** `insert_sorted` usa `binary_search_by` con la chiave `priority` = `(segments, id.as_str())`. Dal momento che i `DocId` sono path unici nel vault, due `DocId` diversi non possono avere priorità uguale, quindi l'ordinamento è totale in pratica. Tuttavia `remove_sorted` usa lo stesso comparatore per trovare *quale posizione rimuovere*: se per qualsiasi ragione lo stesso `DocId` venisse inserito due volte (bug di chiamata), `binary_search_by` troverebbe la prima posizione e la seconda rimarrebbe — perdita silenziosa nel grafo. L'invariante di unicità è garantita dal resto del codice (un `DocId` entra in `keys` una sola volta), ma non è codificata nella firma di `insert_sorted`. Un `debug_assert!(!ids.contains(id))` in `insert_sorted` renderebbe esplicita la precondizione.

**Cosa guardare:** Sorvegliare se in futuro si aggiunge una chiamata a `insert_sorted` senza prima aver verificato l'assenza del `DocId`.

---

## 0062 — Backlink duplicati non vengono deduplicati in `refs_by_key`

**Dove:** `crates/fub-kernel/src/graph.rs`, funzione `unregister_links` (righe ~414–438)

**Stato:** Promossa alla voce [§21.11](todo.md)

**Perché si nota:** Quando un documento contiene due link allo stesso target (es. `[[Nota]]` scritto due volte), `register_links` inserisce la stessa chiave due volte in `refs_by_key` (è un `BTreeSet<DocId>`, quindi il documento sorgente appare una sola volta — corretto), ma `backlinks` contiene due `BacklinkRef` con la stessa `source` perché `link_document` li aggiunge entrambi senza deduplicare. Il test alla riga 793 afferma esplicitamente che `sources` restituisce `["a.md", "a.md"]`, il che significa che l'API pubblica `backlinks()` (riga 225) ritorna duplicati. Chi chiama `backlinks()` riceve una lista con ripetizioni e deve deduplicarla da solo, ma questo non è documentato nel contratto di `backlinks()`. Il conteggio dei backlink mostrato nell'UI sarebbe gonfiato.

**Cosa guardare:** `IndexQuery::Backlinks` espone questo via IPC; il pannello backlink conta le righe senza deduplicare. Verificare se `BacklinkRef` deve avere semantica di molteplicità o di unicità per sorgente.

---

## 0063 — `JobBell` usa un contatore `u64` che non si azzera mai

**Dove:** `crates/fub-kernel/src/dispatcher.rs`, struct `JobBell` e metodo `ring` (righe ~401–430)

**Stato:** teoricamente innocuo in pratica (overflow di `u64` richiede 1,8×10¹⁹ job); documentato per completezza.

**Perché si nota:** Il campo `queued: Mutex<u64>` è un contatore monotono crescente: ogni chiamata a `ring()` lo incrementa senza mai azzerarlo. Chi aspetta un job chiama `wait_beyond(seen)` con il valore letto prima del drenaggio; se il contatore wrappasse (overflow di u64), il valore nuovo sarebbe minore di `seen` e `wait_while(|q| *q == seen)` non si sveglierebbe mai — deadlock permanente del thread dei job. In pratica, a 1 job/ms l'overflow avviene dopo ~585 milioni di anni. Nessun rischio reale, ma vale un `wrapping_add` e un commento per chi legge in futuro.

**Cosa guardare:** Se il contatore venisse mai azzerato esplicitamente (reset del runtime) il bug diventerebbe reale.

---

## 0064 — `Subscription::recv` con canale `Disconnected` restituisce `Overflow` e poi chiama `recv` bloccante su canale chiuso

**Dove:** `crates/fub-kernel/src/bus.rs`, metodo `Subscription::recv` (righe ~66–82)

**Stato:** Promossa alla voce [§20.8](todo.md)

**Perché si nota:** Quando il canale è disconnesso (`Disconnected`) e c'è un debito di `Overflow`, il metodo restituisce l'`Overflow` sintetico (`Ok(overflow)`). Fin qui corretto. Ma nella chiamata successiva, il canale è ancora disconnesso e non ci sarà mai un `overflow` (è stato già riscosso con `swap(0)`): il codice arriva al ramo `None => self.rx.recv()`, che su un canale disconnesso restituisce immediatamente `Err(RecvError)`. Questo è corretto — il chiamante riceve `Err` e sa che è finita. Il problema è che tra la restituzione dell'`Overflow` e il successivo `Err` il chiamante non ha modo di sapere che il canale è già chiuso: potrebbe interpretare l'`Overflow` come «recupera e poi riprova» e aspettarsi ulteriori messaggi. Il comportamento è tecnicamente corretto ma semanticamente ambiguo: un `Overflow` su un canale già disconnesso dice «riconcilia» a qualcuno che non riceverà mai la conferma di aver finito. Da documentare nel contratto di `Subscription::recv`.

**Cosa guardare:** Rilevante se il subscriber del bus (il thread degli eventi in `fub-host`) non gestisce `RecvError` dopo un `Overflow` su disconnessione.

---

## 0065 — `NotifyWatcher` tiene il lock esclusivo del workspace durante l'intera raffica debounced e il `flush_indexes`

**Dove:** `crates/fub-host/src/watcher.rs`, closure `Ok(events)` di `new_debouncer` (righe 156–208)

**Stato:** Promossa alla voce [§20.7](todo.md)

**Perché si nota:** Il callback del debouncer acquisisce `workspace.write().unwrap()` una sola volta all'inizio e lo tiene per tutto il ciclo:
```rust
let mut ws = workspace.write().unwrap();  // (1) lock preso
for event in events { … ws.sync_path(…); … }  // (2) N sync su indice in memoria
let flush_errors = ws.flush_indexes();  // (3) I/O su disco sotto lock
ws.with_host(…, |host| host.emit(…));  // (4) emissione eventi sotto lock
```
I comandi IPC sincroni — `read_document`, `query_index`, `render_view` — acquisiscono lo stesso lock in lettura (`ws.read().unwrap()`). Per tutto il tempo del `flush_indexes` (che scrive gli indici su disco) nessuna lettura IPC può procedere: la webview si blocca in attesa. Con vault grandi e notifiche frequenti (sync in background, editor esterno aperto) questo può durare centinaia di millisecondi per ciclo debounced.
Il pattern corretto — già seguito in `jobs.rs` — è acquisire il lock **per singola operazione** e rilasciarlo prima dell'I/O. Il `flush_indexes` potrebbe essere separato in un passo fuori dal lock, oppure i sync potrebbero raccogliere un set di path da elaborare e poi rilasciare il lock prima del flush.

**Cosa guardare:** Si acuisce su vault con molti file e watcher attivo (la configurazione di default). Confrontare con la 0046 (stesso pattern in `versioning.rs`). Direttamente collegata alla 0038 (I/O bloccante nei comandi IPC), che peggiora quando il lock è già tenuto dal watcher.
**Collegamento:** Issue 0046 (stesso pattern in `fub-features/src/versioning.rs`); issue 0038 (I/O bloccante nei comandi IPC).
```rust
failed.store(false, Ordering::Relaxed);  // (1) abbassa il flag
let mut ws = workspace.write().unwrap(); // (2) può panizzare se avvelenato
…
ws.with_host("fub.host", |host| {        // (3) emette Event::Trouble
    host.emit(Event::Trouble { … });
});
```
Se al passo (2) il lock è avvelenato (un thread precedente ha panicato tenendo il lock in scrittura), `unwrap()` panica. Il flag `watching` è già stato abbassato al passo (1), quindi `is_watching()` restituisce `false` correttamente. Ma l'evento `Event::Trouble` al passo (3) non viene mai emesso: il frontend vede il vault marcato come non monitorato ma non riceve spiegazioni. In un'app impacchettata, dove `stderr` non ha lettori, la perdita è silenziosa e l'utente non sa se il vault sia semplicemente chiuso o se ci sia stato un guasto.
La correzione minima è invertire i passi (1) e (3): emettere prima il `Trouble` (se il lock è sano), poi abbassare il flag. Se il lock è avvelenato il `Trouble` non si può emettere comunque, ma almeno l'ordine non peggiora il caso normale.

**Cosa guardare:** Si incrocia con la 0035 (lock avvelenato nei comandi IPC) e con la 0036 (perdita silenziosa di eventi durante l'inizializzazione). Rilevante se si aggiunge un meccanismo di recovery dei lock avvelenati.
**Collegamento:** Issue 0035 (lock avvelenato in `fub-app`); issue 0036 (perdita silenziosa di eventi).

---

## 0066 — Nel ramo `Err` del watcher l'evento `Trouble` non viene mai emesso se il lock del workspace è avvelenato

**Dove:** `crates/fub-host/src/watcher.rs`, closure `Err(errors)` di `new_debouncer` (righe 210–238)

**Stato:** bassa probabilità ma scenario peggiore: il vault segna `watching: false` e l'utente non riceve alcuna notifica del motivo.

**Perché si nota:** L'ordine delle operazioni nel ramo degli errori del debouncer è:
```rust
failed.store(false, Ordering::Relaxed);  // (1) abbassa il flag
let mut ws = workspace.write().unwrap(); // (2) può panizzare se avvelenato
…
ws.with_host("fub.host", |host| {        // (3) emette Event::Trouble
    host.emit(Event::Trouble { … });
});
```
Se al passo (2) il lock è avvelenato (un thread precedente ha panicato tenendo il lock in scrittura), `unwrap()` panica. Il flag `watching` è già stato abbassato al passo (1), quindi `is_watching()` restituisce `false` correttamente. Ma l'evento `Event::Trouble` al passo (3) non viene mai emesso: il frontend vede il vault marcato come non monitorato ma non riceve spiegazioni. In un'app impacchettata, dove `stderr` non ha lettori, la perdita è silenziosa e l'utente non sa se il vault sia semplicemente chiuso o se ci sia stato un guasto.
La correzione minima è invertire i passi (1) e (3): emettere prima il `Trouble` (se il lock è sano), poi abbassare il flag. Se il lock è avvelenato il `Trouble` non si può emettere comunque, ma almeno l'ordine non peggiora il caso normale.

**Cosa guardare:** Si incrocia con la 0035 (lock avvelenato nei comandi IPC) e con la 0036 (perdita silenziosa di eventi durante l'inizializzazione). Rilevante se si aggiunge un meccanismo di recovery dei lock avvelenati.
**Collegamento:** Issue 0035 (lock avvelenato in `fub-app`); issue 0036 (perdita silenziosa di eventi).

---

## 0067 — `BundleRegistry::stop`: `Arc::get_mut` fallisce silenziosamente se un job è ancora in volo, `Plugin::deactivate` non viene mai chiamato

**Dove:** `crates/fub-host/src/registry.rs`, funzione `BundleRegistry::stop` (righe 366–391)

**Stato:** Promossa alla voce [§16.10](todo.md)

**Perché si nota:** `stop` usa `Arc::get_mut` per verificare di essere l'unico detentore del plugin prima di chiamare `deactivate`:
```rust
let out = match Arc::get_mut(&mut bundle.plugin) {
    Some(plugin) => ws.with_host(id, |host| plugin.deactivate(host)).err(),
    None => Some(PluginError::Internal(
        format!("`{id}` ha un job ancora in volo: il suo `deactivate` non è stato chiamato …")
    )),
};
```
Se `Arc::get_mut` restituisce `None` (il runner ha ancora un clone dell'`Arc`), `Plugin::deactivate` non viene mai chiamato. Il codice emette un `PluginError::Internal` che dice «ferma prima i job», ma:
1. **Non c'è alcun `assert!` o `debug_assert!`** che verifichi in anticipo che `JobRunner::stop` sia stato chiamato — l'invariante è solo documentata in un commento.
2. **L'errore viene restituito come elemento di `Vec<PluginError>`** da `unmount`/`close`, che chi chiama può ignorare (es. `let _ = registry.close(ws)`). In `session.rs` la chiusura del vault chiama `registry.close(ws)` e logga gli errori, ma non si interrompe.
3. **Un plugin che non riceve `deactivate` può perdere stato**: file aperti, connessioni di rete, cache in memoria che avrebbe svuotato in quel metodo.
La soluzione robusta è che `stop` aspetti attivamente che tutti i cloni dell'`Arc` siano rilasciati (con timeout), oppure che `JobRunner::stop` garantisca il rilascio prima di restituire il controllo a chi chiude il vault.

**Cosa guardare:** Rilevante ogni volta che `unmount` o `close` vengono chiamati durante la chiusura del vault (path normale) o per spegnere un plugin dalle impostazioni (`set_plugin_enabled(false)`). Verificare in `session.rs` se `jobs.stop_for(id)` è sempre chiamato prima di `registry.stop(ws, id)`.
**Collegamento:** Decisione 0028 (`Plugin::deactivate`); decisione 0032 (il runner dei job); issue 0008 (`set_plugin_enabled` non disattiva plugin con job in volo).

---

## 0068 — `check(path, Naming::New)` accetta nomi con spazi in testa che `normalized` trasforma in file nascosti (`NameFault::Hidden`)

**Dove:** `crates/fub-abi/src/rules/path_policy.rs`

**Stato:** Promossa alla voce [§15.8](todo.md)

**Perché si nota:** La funzione `path_policy::check` con la modalità `Naming::New` verifica che ciascun segmento di path non sia vuoto, non contenga caratteri riservati o di controllo, non finisca con uno spazio o con un punto (`segment.ends_with(' ') || segment.ends_with('.')`), e non inizi con un punto (`segment.starts_with('.')`). Tuttavia, non rifiuta i segmenti che iniziano con uno spazio (es. `" .nota.md"`).
Successivamente, quando si chiama `path_policy::normalized(" .nota.md")`, il segmento viene processato tramite `segment.trim().nfc()`, rimuovendo gli spazi sia in coda che in testa. L'eliminazione dello spazio iniziale trasforma `" .nota.md"` in `".nota.md"`.
Di conseguenza, `normalized` genera un nome che inizia con un punto, ossia un file nascosto che verrà ignorato dalla scansione del vault (`is_ignored_name`) oppure rifiutato se controllato successivamente da `check(".nota.md", Naming::New)` sollevando `NameFault::Hidden`.

**Cosa guardare:** `crates/fub-abi/src/rules/path_policy.rs`, in particolare le funzioni `check` (righe 236–285) e `normalized` (righe 309–314). Occorre allineare il comportamento: rifiutare gli spazi iniziali in `check` (o modificare `normalized` in modo da rimuovere solo gli spazi finali anziché usare `.trim()`), preservando l'invariante per cui un nome valido non diventi un nome nascosto/rifiutato dopo la normalizzazione.

**Collegamenti:** Issue 0005, 0019; `crates/fub-abi/src/rules/path_policy.rs`.

---

## 0069 — In caso di panico in `workspace.batch()`, `batch` resta attivo e blocca per sempre il dispatch degli eventi

**Dove:** `crates/fub-kernel/src/workspace.rs` e `crates/fub-kernel/src/dispatcher.rs`

**Stato:** Promossa alla voce [§20.6](todo.md)

**Perché si nota:** La funzione `Workspace::batch` apre un lotto chiamando `self.dispatch.open_batch()`, esegue la closure `f(self)` e successivamente invoca `self.end_batch()`.
Se la closure `f(self)` o una delle operazioni invocate all'interno di essa va in panico (e l'unwinding del panico viene intercettato più in alto, ad esempio tramite `catch_unwind` nei varchi Host/Tauri o nei test), la chiamata a `self.end_batch()` viene saltata.
Questo lascia il campo `batch` in `Dispatcher` nello stato `Some(BatchState)`. Poiché `Dispatcher::begin_drain()` controlla espressamente `if self.batch.is_some() { return false; }`, ogni successivo tentativo di effettuare il dispatch degli eventi restituirà `false`. Di conseguenza, tutti gli eventi emessi da quel momento in poi rimarranno bloccati nella coda `pending` e non verranno mai più consegnati a nessun `EventHandler` fino al riavvio del vault/kernel.

**Cosa guardare:** `crates/fub-kernel/src/workspace.rs` (righe 3617–3634) e `crates/fub-kernel/src/dispatcher.rs`. Si raccomanda di utilizzare un pattern RAII / ScopeGuard per assicurare che `end_batch()` / `close_batch()` venga eseguito anche in caso di unwinding da panico prima che l'eccezione risalga.

**Collegamenti:** Issue 0035, 0036; `crates/fub-kernel/src/safety.rs`, `crates/fub-kernel/src/workspace.rs`.

---

## 0070 — `prefix_len_ci` in `occurrences.rs` confronta caratteri Unicode char-by-char fallendo su espansioni

**Dove:** `crates/fub-kernel/src/occurrences.rs`

**Stato:** Promossa alla voce [§21.11](todo.md)

**Perché si nota:** La localizzazione delle occorrenze di ricerca (`occurrences::locate`) utilizza `first_at_or_after` e `prefix_len_ci` per individuare la posizione del testo cercato nei byte del sorgente. La funzione `prefix_len_ci` confronta il testo cercato con il testo del documento carattere per carattere invocando `found.to_lowercase().eq(wanted.to_lowercase())`.
In Unicode, la conversione in minuscolo di alcuni caratteri non preserva una corrispondenza 1-a-1 di code point (ad esempio la lettera turca `'İ'` produce la sequenza `['i', '\u{307}']`). Confrontare gli iteratori `ToLowercase` con `.eq()` su singoli `char` restituisce `false` quando una forma minuscola espansa viene confrontata con la corrispondente sequenza di caratteri decomposed (o viceversa), causando il mancato rilevamento di occorrenze valide. In aggiunta, l'iterazione byte-per-byte con allocazione/ricerca ad ogni offset introduce un overhead prestazionale evitabile su documenti di grandi dimensioni.

**Cosa guardare:** `crates/fub-kernel/src/occurrences.rs`, funzioni `locate`, `first_at_or_after` e `prefix_len_ci` (righe 119–187).

**Collegamenti:** Issue 0018, 0049; `crates/fub-kernel/src/occurrences.rs`.

---

## 0071 — `UndoStack::push` usa `Vec::remove(0)` con spostamenti $O(N)$ ad ogni inserimento oltre il tetto

**Dove:** `crates/fub-kernel/src/undo.rs`

**Stato:** Promossa alla voce [§17.4](todo.md)

**Perché si nota:** Nella struttura `UndoStack`, quando il numero di elementi inseriti tramite `push` supera la costante `TETTO` (100 operazioni), la pila elimina l'operazione più vecchia posizionata all'indice 0 mediante `self.entries.remove(0)`.
In una `std::vec::Vec`, l'operazione `remove(0)` ha complessità temporale $O(N)$, poiché costringe la memoria a traslare tutti i 100 elementi rimanenti ad ogni singolo inserimento. Durante sessioni di lavoro prolungate con molte modifiche o durante l'esecuzione di script/automazioni, ad ogni nuovo comando aggiunto alla cronologia di undo si pagano continue riallocazioni e copie contigue di memoria.

**Cosa guardare:** `crates/fub-kernel/src/undo.rs`, riga 74 nella funzione `UndoStack::push`. La sostituzione del campo `entries: Vec<Undo>` con un `std::collections::VecDeque<Undo>` consentirebbe di sostituire `remove(0)` con `pop_front()`, rendendo la rimozione dell'elemento in testa un'operazione $O(1)$.

**Collegamenti:** Issue 0049, 0063; `crates/fub-kernel/src/undo.rs`.

---

## 0072 — Accumulo di entry orfane in `Flags::live` per `cancel_job` con `JobId` inesistenti

**Dove:** `crates/fub-host/src/runner.rs`, metodo `Flags::cancel` (righe ~120–138) e `JobRunner::cancel` (riga ~344)

**Stato:** Promossa alla voce [§16.10](todo.md)

**Perché si nota:** Quando la shell o un IPC chiama `cancel_job` passando un `JobId` numerico maggiore dell'ID massimo finora processato (`seen`), la funzione `Flags::cancel` valuta la condizione `id.0 > seen` come `true` ed inserisce una nuova voce `live.insert(id, Arc::new(AtomicBool::new(true)))` nella mappa delle bandiere attive. Se tale `JobId` non corrisponde ad alcun job reale che verrà mai accodato o processato dal kernel, la chiamata di pulizia `self.forget(id)` (che viene eseguita solo al termine del metodo `Shared::run`) non verrà mai invocata. Di conseguenza, ogni annullamento effettuato con ID non validi o inesistenti lascia indefinitamente una voce orfana nella mappa `Flags::live`, causando un consumo di memoria incrementale non rilasciabile per tutta la vita della sessione del vault.

**Cosa guardare:** In `crates/fub-host/src/runner.rs`, limitare l'inserimento preventivo delle bandiere di cancellazione per ID futuri oppure implementare una pulizia/TTL periodica per i job mai presi in carico dal runner.

---

## 0073 — Scrittura sincrona su disco in `set_view_state` blocca il thread IPC di Tauri durante le interazioni UI

**Dove:** `crates/fub-app/src/lib.rs`, comando `set_view_state` (righe ~625–640) e `crates/fub-host/src/session.rs` (righe ~614–640)

**Stato:** Promossa alla voce [§20.7](todo.md)

**Perché si nota:** Il comando IPC `set_view_state` viene invocato dal frontend a fronte di eventi ad alta frequenza come lo scorrimento di un pannello o ridimensionamenti del layout. Il commento nel codice dichiara che l'operazione usa un prestito condiviso per "non bloccare chi legge per il tempo di una scrittura su disco". Tuttavia, la funzione sottostante `ws.set_view_state` (e la persistenza in `ViewStates`) esegue una scrittura atomica sincrona su disco (`write_atomic` sul file `view-state.json`). L'esecuzione di I/O sincrono bloccante direttamente sul thread gestore dell'IPC di Tauri paralizza il ciclo di messaggi della webview durante gli eventi di scroll, generando latenze percepibili.

**Cosa guardare:** In `crates/fub-app/src/lib.rs` e `crates/fub-host/src/session.rs`, scaricare la persistenza dello stato di vista su un thread di background o deboursare le scritture atomiche su disco invece di eseguirle nel thread IPC sincrono.

---

## 0074 — Mancato aggiornamento del timestamp `last_opened` alla riapertura di un vault già aperto

**Dove:** `crates/fub-host/src/session.rs`, metodo `Host::open` (righe ~370–376)

**Stato:** Inconsistenza nello stato dell'elenco dei vault recenti (`vaults.json`).

**Perché si nota:** Quando viene chiamato `Host::open` per un vault il cui path è già presente nella mappa `self.sessions.open`, il metodo restituisce immediatamente `Ok(info)` (righe 370–376) per evitare di ricreare la sessione. Tuttavia, la chiamata a `self.vaults.note_opened(&root, now)` si trova esclusivamente alla fine di `Host::open` (riga ~483), dopo la creazione di una nuova sessione. Di conseguenza, riaprire o selezionare un vault già aperto tramite il menu o la lista dei recenti non aggiorna il timestamp `last_opened` in `vaults.json`, lasciando l'ordine relativo dei recenti obsoleto finché l'applicazione non viene riavviata e il vault riaperto da chiuso.

**Cosa guardare:** In `crates/fub-host/src/session.rs` (`Host::open`), invocare `self.vaults.note_opened(&root, now)` anche nel ramo di successo in cui il vault è già presente in `sessions.open`.

---

## 0075 — Impossibilità di ripristinare il nome di default del vault tramite `set_vault_look`

**Dove:** `crates/fub-host/src/vaults.rs`, metodo `VaultRegistry::set_look` (righe ~170–178) e `crates/fub-host/src/session.rs`

**Stato:** Incoerenza nell'API di aggiornamento dei metadati dei vault.

**Perché si nota:** La struttura `VaultEntry` specifica che una stringa vuota `name: ""` indica l'uso del nome predefinito del vault (il nome della cartella su disco). Il metodo `VaultRegistry::set_look` accetta `name: Option<String>`, ma aggiorna il campo solo se `Some(name)` è presente (`if let Some(name) = name.clone() { entry.name = name; }`). Passare `name: None` lascia `entry.name` invariato invece di azzerarlo o resettarlo. Di conseguenza, dopo che un vault ha ricevuto un nome personalizzato, non esiste alcun valore di `Option<String>` che consenta di rimuovere il nome personalizzato e tornare al comportamento di default senza sovrascriverlo con una stringa vuota esplicita.

**Cosa guardare:** In `crates/fub-host/src/vaults.rs` (`VaultRegistry::set_look`), distinguere il caso `None` (nessun cambiamento desiderato) da un segnale di reset, oppure documentare/implementare la gestione di `Some("")` per consentire il ripristino del nome cartella originale.

---

## 0076 — Panico in `VaultSession::close` con lock del workspace avvelenato e perdita di dati

**Dove:** `crates/fub-host/src/session.rs`, metodo `VaultSession::close` (righe ~168–171)

**Stato:** Promossa alla voce [§20.6](todo.md)

**Perché si nota:** Durante la chiusura di una sessione (`VaultSession::close`), dopo aver fermato il watcher e i job runner, il codice esegue: `let mut ws = workspace.write().expect("workspace avvelenato");`. Se un thread precedente ha subito un panico tenendo il lock del `Workspace`, la chiamata a `.expect()` panica a sua volta. Questo interrompe bruscamente la funzione `close()`, impedendo la successiva esecuzione di `registry.lock().close(&mut ws)` e `ws.close_with(...)`. Di conseguenza, il flush finale degli indici di ricerca su disco e l'invocazione di `Plugin::deactivate` vengono saltati, causando perdita di dati negli indici ed un'uscita sporca del processo.

**Cosa guardare:** In `crates/fub-host/src/session.rs` (`VaultSession::close`), utilizzare `unwrap_or_else(|e| e.into_inner())` per recuperare il guard del lock avvelenato e procedere comunque con il flush ed il salvataggio di emergenza degli indici prima di restituire l'errore.

---

## 0077 — Fallimento di fallback per `config_dir` se la cartella `fub-config` non è scrivibile

**Dove:** `crates/fub-host/src/config.rs`, funzione `config_dir` (righe ~46–54) e `portable_dir` (righe ~133–139)

**Stato:** Rischio di fallimento completo delle operazioni di scrittura della configurazione in ambienti di sistema o di sola lettura.

**Perché si nota:** La funzione `config_dir()` determina il percorso della configurazione verificando prima l'eventuale presenza del file marcatore `fub.portable` tramite `portable_dir()`. Se tale file è presente nella directory dell'eseguibile, `portable_dir()` restituisce immediatamente `Some(dir.join("fub-config"))`. Tuttavia, la funzione non verifica se il percorso risultante sia effettivamente scrivibile. Se l'applicazione è installata in una directory di sistema (es. `/usr/bin/` o `C:\Program Files\`) dove il marcatore è stato creato o lasciato per errore ma il processo non ha permessi di scrittura, `config_dir()` restituirà comunque il path portable inaccessibile senza effettuare il fallback sulla directory di configurazione dell'utente (`~/.config/fub`). Ciò causa il fallimento sistematico di `Host::installed()` nel salvare impostazioni, preferiti e log.

**Cosa guardare:** In `crates/fub-host/src/config.rs` (`portable_dir` / `config_dir`), verificare la scrivibilità (o la possibilità di creare) della directory portable prima di selezionarla come configurazione attiva.

---

## 0078 — Silenziosa terminazione del thread `bridge.rs` su disconnessione del bus

**Dove:** `crates/fub-host/src/bridge.rs`, funzione `spawn` (righe ~69–84)

**Stato:** Promossa alla voce [§20.8](todo.md)

**Perché si nota:** Il thread che gestisce il ponte degli eventi verso l'host esegue un ciclo `while let Ok(first) = rx.recv()`. In caso di disconnessione o errore del canale di abbonamento `rx` (ad esempio se il bus del workspace viene chiuso o riscontra una disconnessione anomala), `rx.recv()` restituisce `Err` e il loop termina silenciosamente, provocando la terminazione del thread. Nessuna riga di log `tracing::warn!` viene emessa e nessun evento `Event::Trouble` viene notificato all'`EventSink`. Se il vault rimane in memoria dopo tale evento, la perdita del ponte eventi avviene in modo del tutto trasparente, rendendo l'applicazione incapace di inoltrare le notifiche successive alla UI senza che la diagnostica o lo sviluppatore se ne accorgano.

**Cosa guardare:** In `crates/fub-host/src/bridge.rs` (`spawn`), catturare l'uscita dal ciclo `while` e loggare un avviso esplicito con `tracing::warn!` (o emettere una notifica di diagnostica) prima che il thread termini.

---

## 0079 — Omissione dell'attributo `data-embed-block` per la transclusione dei blocchi nei wikilink incorporati

**Dove:** `crates/fub-format-markdown/src/render.rs`, funzione `render_link` (righe 263–277)

**Stato:** Promossa alla voce [§23.1](todo.md)

**Perché si nota:** Durante il rendering HTML dei wikilink incorporati (`embed == true` e `LinkTarget::Wiki`), la funzione `render_link` genera l'attributo `data-embed-heading` se `heading` è `Some(...)`, ma ignora completamente il campo `block` (`Some(b)`):
```rust
if embed {
    let heading_attr = heading
        .as_ref()
        .map(|h| format!(" data-embed-heading=\"{}\"", escape_attr(h)))
        .unwrap_or_default();
    out.push_str(&format!(
        "<div class=\"embed\" data-embed-page=\"{}\"{}>",
        escape_attr(page),
        heading_attr
    ));
    render_link_label(label, page, out);
    out.push_str("</div>");
    return;
}
```
Se un utente scrive `![[Nota#^blocco1]]`, l'elemento HTML generato è `<div class="embed" data-embed-page="Nota">`, perdendo l'ancora del blocco. Di conseguenza, il motore di transclusione nel frontend/kernel non riceve l'informazione sul blocco specifico da incorporare.

**Cosa guardare:** `render_link` in `crates/fub-format-markdown/src/render.rs#L263-L277`. È necessario aggiungere la generazione di `data-embed-block="..."` analogamente a quanto viene fatto per `data-wikilink-block` nei wikilink non incorporati (righe 290–294).
**Collegamento:** Protocollo di transclusione (`docs/architecture/ui-protocol.md`); issue 0027 (wikilink di blocco).

---

## 0080 — Serializzazione errata di `LinkTarget::Wiki` con ancora di blocco senza prefisso `#`

**Dove:** `crates/fub-format-markdown/src/serialize.rs`, funzione `write_link` (righe 218–242)

**Stato:** Promossa alla voce [§23.1](todo.md)

**Perché si nota:** La funzione `write_link` serializza i wikilink componendo la stringa come segue:
```rust
LinkTarget::Wiki {
    page,
    heading,
    block,
} => {
    out.push_str("[[");
    out.push_str(page);
    if let Some(h) = heading {
        out.push('#');
        out.push_str(h);
    }
    if let Some(b) = block {
        out.push('^');
        out.push_str(b);
    }
    ...
```
Se `heading` è `None` e `block` è `Some("b1")`, il codice non aggiunge il carattere `#` prima di `^`, generando `[[page^b1]]` anziché `[[page#^b1]]`. Nella sintassi dei wikilink di Obsidian e del parser comrak di Fub, le ancore di blocco sono identificate dal prefisso `#^` (oppure `#` seguito da `heading#^block`). La serializzazione `[[page^b1]]` produce un markdown non valido dove `page^b1` viene interpretato come nome pagina.

**Cosa guardare:** `write_link` in `crates/fub-format-markdown/src/serialize.rs#L218-L242`. Assicurarsi che prima dell'ancora di blocco `^` venga sempre inserito `#` se `heading` non è presente (ossia `#^block`).
**Collegamento:** `parse_wikilink_inner` in `fub-abi`; `serialize.rs`.

---

## 0081 — Disallineamento dello span nei link incorporati (`![[...]]`) fra parser AST comrak e fallback testuale

**Dove:** `crates/fub-format-markdown/src/parse.rs`, funzioni `convert_inlines` (righe 620–631) e `push_text_features` / `find_embeds` (righe 685–734)

**Stato:** Promossa alla voce [§23.1](todo.md)

**Perché si nota:** Per i wikilink incorporati `![[Nota]]`:
1. Quando comrak riconosce il nodo AST `NodeValue::WikiLink(wl)`, `span_of(child, offsets)` restituisce lo span del nodo comrak che inizia al carattere `[` (es. offset 11..19), poiché comrak non include il punto esclamativo `!` nel nodo `WikiLink`. La presenza di `!` viene verificata a parte (`span.start > 0 && source.as_bytes()[span.start - 1] == b'!'`).
2. Quando comrak **non** riconosce il wikilink e si attiva il fallback `push_text_features` / `find_embeds`, lo span prodotto include il punto esclamativo iniziale `!` (es. offset 10..19).
Quando una funzione di refactoring o rinomina riscrittura dei wikilink (es. `note.rename`) sostituisce la fetta di sorgente identificata da `link.span`, nel primo caso (nodo comrak AST) sostituire `span` lascia il carattere `!` isolato nella sorgente (`![[Nota]]` sostituito a `span` diventa `! [[NuovaNota]]` o lascia `!` orfano), mentre nel secondo caso lo span copre anche il `!`.

**Cosa guardare:** `parse_markdown` e `convert_inlines` in `crates/fub-format-markdown/src/parse.rs`. Normalizzare l'estensione di `link.span` per gli `embed` in modo che includa uniformemente il `!` iniziale (estendendo `span.start` di 1 byte se preceduto da `!`).
**Collegamento:** `note.rename` in `commands.rs`; `Link` in `fub-abi`.

---

## 0082 — Impossibilità di spuntare task non completati (`[ ]`) in `note.task.toggle`

**Dove:** `crates/fub-features/src/commands.rs`, funzione `note_task_toggle` (righe 1711–1714)

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** In `note_task_toggle`, il calcolo del nuovo simbolo del task è implementato così:
```rust
let (simbolo, fatto) = match marker.symbol {
    None => ("x", true),
    Some(_) => (" ", false),
};
```
Quando comrak effettua il parsing di un task non spuntato (`- [ ] task`), il campo `symbol` del `TaskMarker` viene popolato con `Some(' ')` (carattere spazio). Poiché `Some(' ')` corrisponde al ramo `Some(_)`, la funzione valuta `simbolo = " "` e `fatto = false`, sostituendo lo spazio con un altro spazio. Di conseguenza, l'esecuzione del comando `note.task.toggle` su un task `[ ]` non modifica lo stato del task e non lo spunta mai in `[x]`.

**Cosa guardare:** `note_task_toggle` in `crates/fub-features/src/commands.rs#L1711-L1714`. Utilizzare il metodo `marker.checked()` (definita in `TaskMarker` in `fub-abi`) oppure matchare esplicitamente `None | Some(' ') => ("x", true)` vs `_ => (" ", false)`.
**Collegamento:** `TaskMarker::checked` in `fub-abi/src/model.rs`; comando `note.task.toggle`.

---

## 0083 — Memory leak e listener pendenti in `pickIcon` alla riapertura del selettore

**Dove:** `frontend/src/ui/menu.ts` (`pickIcon`).

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** Quando `pickIcon(at, onPick)` viene invocato mentre un selettore `#icon-picker` è già aperto nel DOM, il codice esegue `document.getElementById("icon-picker")?.remove()`. Questa rimozione diretta del nodo DOM bypassa l'esecuzione della funzione `chiudi()`. Di conseguenza:
1. Il listener `mousedown` in fase di cattura (`fuori`) registrato su `document` non viene rimosso.
2. La funzione `sciogli` creata da `intrappolaFuoco` (che gestisce la trappola del fuoco e il listener `keydown` per il tasto Escape) non viene mai invocata.
A ogni successiva riapertura del selettore prima della sua chiusura, si accumulano listener pendenti in memoria su `document` che mantengono riferimenti ai nodi DOM e alle closure `onPick` precedenti.

**Cosa guardare:** In `frontend/src/ui/menu.ts` (`pickIcon`), prima di rimuovere il nodo o creare un nuovo selettore, verificare se esiste un selettore aperto ed eseguire la relativa funzione `chiudi()` dell'istanza precedente.

---

## 0084 — Memory leak di listener `keydown` su `document` alla riapertura del grafo

**Dove:** `frontend/src/panels/graph.ts` (`openGraph`).

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** All'invocazione di `openGraph()`, se l'overlay `#graph-overlay` è già aperto nel DOM, il codice esegue `document.getElementById(OVERLAY_ID)?.remove()`. Questa operazione distrugge il nodo DOM ma non invoca la funzione `dispose()` dell'istanza del grafo precedente. Di conseguenza, `document.removeEventListener("keydown", onKey)` non viene mai eseguito e il listener registrato per intercettare il tasto Escape rimane permanentemente agganciato a `document`. Ogni riapertura del grafo accumula listener `keydown` inutilizzati che continuano a scattare simultaneamente a ogni pressione del tasto Escape.

**Cosa guardare:** In `frontend/src/panels/graph.ts` (`openGraph`), mantenere un riferimento a livello di modulo alla funzione `dispose` dell'istanza del grafo correntemente attiva ed eseguirla prima di rimuovere il nodo DOM o istanziare un nuovo overlay.

---

## 0085 — Conflitto globale sull'attributo `name` nei campi `radio` tra form differenti

**Dove:** `frontend/src/ui/node.ts` (`disegna`, caso `radio`).

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** Durante il rendering dei nodi UI per i campi `radio`, il nome del gruppo HTML viene generato come `const gruppo = radio-${node.field}`. Nello standard HTML/DOM, gli elementi `<input type="radio" name="...">` che condividono lo stesso valore dell'attributo `name` appartengono al medesimo gruppo radio a livello di intero documento. Se due form o viste differenti presenti contemporaneamente nel DOM contengono un campo radio con la stessa chiave `field` (ad esempio `mode`), la selezione di un'opzione nel primo form deseleziona automaticamente la radio nel second form.

**Cosa guardare:** In `frontend/src/ui/node.ts` nella gestione di `case "radio"`, generare un identificatore unico per ogni gruppo di opzioni (ad es. usando `identificatore("radio-" + node.field)`) anziché assegnare direttamente la stringa fissa del campo.

---

## 0086 — Mancata gestione degli errori nelle azioni asincrone delle viste dichiarative

**Dove:** `frontend/src/ui/views.ts` (funzione `disegna`).

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** In `frontend/src/ui/views.ts`, la funzione `disegna` passa a `mountTree` un handler per le azioni che esegue `await api.viewAction(...)`. Qualora la chiamata IPC `api.viewAction(...)` sollevi un'eccezione (es. errore di comunicazione IPC, fallimento o panic del plugin), il codice non racchiude l'`await` in un blocco `try...catch`. La promessa viene rifiutata senza essere intercettata, lasciando il componente UI nello stato precedente senza notificare l'utente tramite `notify` o ripristinare i controlli, facendo sembrare l'applicazione congelata.

**Cosa guardare:** In `frontend/src/ui/views.ts` (`disegna`), avvolgere l'invocazione di `api.viewAction` in un blocco `try...catch`, notificando l'errore all'utente tramite `notify` in caso di errore.

---

## 0087 — Race condition nel fallback da `patch` a `renderDeclaredView` per aggiornamenti concorrenti

**Dove:** `frontend/src/ui/views.ts` (funzione `disegna`).

**Stato:** Promossa alla voce [§18.3](todo.md)

**Perché si nota:** Quando un aggiornamento di tipo `patch` non trova la chiave nel DOM (`patchTree` restituisce `false`), `disegna` esegue in fallback `await renderDeclaredView(id)`. Trattandosi di un'operazione asincrona verso l'IPC priva di un contatore generazionale o di un token di sequenza per l'istanza montata, se si verificano più azioni dell'utente o invalidazioni in rapida successione, risposte giunte fuori ordine (out-of-order) possono sovrascrivere la vista con uno stato precedente obsoleto.

**Cosa guardare:** In `frontend/src/ui/views.ts`, associare un numero di sequenza/generazione a ciascuna vista in `montate` e verificare che il token sia ancora valido prima di applicare il risultato di `renderDeclaredView`.

---

## 0088 — Inconsistenza dello stato delle viste alla chiusura/apertura se `api.listViews` fallisce

**Dove:** `frontend/src/ui/views.ts` (funzione `mountDeclaredViews`).

**Stato:** Promossa alla voce [§18.4](todo.md)

**Perché si nota:** La funzione `mountDeclaredViews()` smonta le viste esistenti, invoca `unregisterPanel(id)` e ripulisce la mappa `montate` prima di effettuare la chiamata asincrona `await api.listViews()`. Se `api.listViews()` solleva un errore (es. durante l'apertura del vault o la riconfigurazione dei plugin), la funzione interrompe l'esecuzione prima di svuotare i contenitori DOM e prima di registrare le nuove viste. Questo lascia i nodi DOM precedenti renderizzati a schermo ma privi di gestione interna in `montate` e nel registro dei pannelli.

**Cosa guardare:** In `frontend/src/ui/views.ts` (`mountDeclaredViews`), effettuare prima la chiamata `api.listViews()`, salvando le spec in una variabile locale, e procedere allo smontaggio e alla registrazione solo dopo che la chiamata ha avuto successo.

---

## Rilevazioni automatiche

Non sono issue: sono l'uscita grezza di un passaggio automatico, tenuta qui perché è da dove alcune delle voci qui sopra sono state scritte.

- **File:** crates/fub-abi/src/arena.rs:1749 – `tree.rebuild().unwrap()` – unwrap may panic; replace with `?` error handling.
- **File:** crates/fub-abi/src/arena.rs:1960 – `let rebuilt = tree.rebuild().unwrap();` – unwrap may panic; use `?`.
- **File:** crates/fub-abi/src/arena.rs:1972 – same as above.
- **File:** crates/fub-abi/src/arena.rs:1984 – `items[1].task.unwrap().span` – unwrap may panic; handle the `Option` safely.
- **File:** crates/fub-abi/src/arena.rs:1996 – `head.as_ref().unwrap().cells.len()` – unwrap may panic; use proper error handling.
- **File:** crates/fub-abi/src/edit.rs:400 – `req.apply_to(source).unwrap()` – unwrap may panic; propagate error.
- **File:** crates/fub-abi/src/edit.rs:418 – `.unwrap();` – unwrap may panic; replace with `?`.
- **File:** crates/fub-abi/src/edit.rs:428 – `.unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:493 – `.unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:523 – `.unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:538 – `.unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:546 – `report.inverse().apply_to(&out).unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:553 – `request(source, vec![]).apply_to(source).unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:573 – `req.apply_to(source).unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:581 – `indietro.apply_to(&nuovo).unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:599 – `request(source, edits).apply_to(source).unwrap();` – unwrap may panic.
- **File:** crates/fub-abi/src/edit.rs:600 – `report.inverse().apply_to(&nuovo).unwrap();` – unwrap may panic.
All occurrences of `unwrap()` (and `expect()`) in production code should be replaced with proper error propagation (`?`) or explicit handling to avoid panics at runtime.
- **File:** crates/fub-abi/src/arena.rs:99 – `len: u32::try_from(len).unwrap_or(u32::MAX)` – unwrap_or may mask overflow; replace with proper error handling (`try_from` with `?`).
- **File:** crates/fub-abi/src/arena.rs:116 – `u32::try_from(len).expect("un'arena con più di 2^32 nodi non è esprimibile nel contratto")` – panic on overflow; handle error explicitly.
- **File:** crates/fub-abi/src/edit.rs:503 – `source.find('\n').expect("c'è un \n")` – panics if newline not found; handle Option safely.
- **File:** crates/fub-abi/src/edit.rs:532 – `source.find("due").expect("c'è `due`")` – panics if substring missing; handle Option.
- **File:** crates/fub-abi/src/options.rs:335 – `serde_json::to_string(&m).expect("serializza")` – panics on serialization error; propagate error.
- **File:** crates/fub-abi/src/options.rs:337 – `serde_json::from_str(&s).expect("deserializza")` – panics on deserialization error; propagate error.
- **File:** crates/fub-abi/src/query.rs:683 – `serde_json::to_string(&expr).expect("una query è JSON, o non arriva a nessuno")` – panics on serialization error; propagate error.
- **File:** crates/fub-host/src/config.rs:175 – `unsafe { std::env::set_var("FUB_CONFIG_DIR", "/tmp/fub-prova") };` – unsafe block unnecessary; use safe `std::env::set_var`.
- **File:** crates/fub-host/src/config.rs:177 – `unsafe { std::env::remove_var("FUB_CONFIG_DIR") };` – unsafe block unnecessary.
- **File:** crates/fub-host/src/config.rs:183 – `unsafe { std::env::set_var("FUB_CONFIG_DIR", "   ") };` – unsafe block unnecessary.
- **File:** crates/fub-host/src/config.rs:185 – `unsafe { std::env::remove_var("FUB_CONFIG_DIR") };` – unsafe block unnecessary.
