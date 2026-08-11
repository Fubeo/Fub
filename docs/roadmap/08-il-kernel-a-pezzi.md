# 8. Il kernel a pezzi, e chi lo monta

Questa è una **seduta** della [roadmap infrastrutturale](../todo.md). Tutti gli obiettivi sono raggiunti. Ecco i risultati:

- **Scomposizione:** L'oggetto-dio (la struttura centrale che contiene tutto lo stato) è diviso in parti più piccole ([0022](../decisions/0022-il-kernel-a-pezzi.md)).
- **Montaggio:** Un crate (libreria Rust separata) gestisce ora il montaggio dei componenti ([0023](../decisions/0023-chi-monta-il-kernel.md)).
- **Lock a grana fine:** Il blocco per l'accesso ai dati agisce su parti specifiche invece che sull'intero sistema ([0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)).
- **Ricerca concorrente:** Le operazioni di ricerca avvengono contemporaneamente senza bloccarsi a vicenda ([0026](../decisions/0026-due-query-insieme.md)). In quest'area non resta niente da fare.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

L'ordine di precedenza era rigoroso e derivava dal quarto giro. Il punto **8.1** precedeva l'**8.2** e l'**8.3**. Questo ha evitato di costruire il crate host attorno all'oggetto-dio. Ha anche permesso l'implementazione del lock a grana fine.

Le tre fasi sono chiuse nel seguente ordine:

- L'**8.1** tramite la [decisione 0022](../decisions/0022-il-kernel-a-pezzi.md): `Workspace` (lo stato globale del vault Fub) organizza i suoi ventiquattro campi sotto cinque proprietari logici. Questi proprietari sono `DocumentStore`, `Indexes`, `ProviderRegistry`, `Dispatcher` e `Session`.
- L'**8.2** tramite la [decisione 0023](../decisions/0023-chi-monta-il-kernel.md): Il composition root (il modulo che unisce le dipendenze) si trova nel crate `fub-host`. Questo crate è indipendente da Tauri. Il crate `fub-app` contiene esclusivamente i comandi IPC (comunicazione tra processi), il ponte eventi e la gestione delle finestre.
- L'**8.3** tramite la [decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md): Un `RwLock` (blocco lettura-scrittura) protegge il workspace. Le letture usano un prestito condiviso. L'implementazione ha richiesto uno sforzo minimo. Il tipo `Workspace` implementava già `Sync` e il passaggio dei riferimenti `&self` era pronto.

L'ordine di esecuzione ha offerto un vantaggio imprevisto. La motivazione principale per l'**8.3** differiva da quella originariamente documentata. Il piano prometteva il ridisegno di N view (visualizzazioni) senza code. Questo risultato si è rivelato meno importante. Le misurazioni hanno mostrato gli svantaggi del `Mutex` (un blocco esclusivo). Il salvataggio di una nota richiedeva secondi di attesa dietro ai lettori, senza limiti prefissati. Il problema causava una condizione di fame (starvation) delle risorse, non una semplice lentezza.

La quarta voce (§8.4) non è stata definita da un ciclo di lavoro. È nata dalla stessa misurazione della decisione 0024. Di sei letture, cinque risultavano da 7 a 25 volte più veloci. La ricerca rimaneva bloccata. Il metodo `SearchIndex::query` dichiarava una lettura ma acquisiva un proprio `Mutex` interno.

La [decisione 0026](../decisions/0026-due-query-insieme.md) risolve l'impedimento e lascia due elementi:

- **Le regole del contratto sono immutate.** La scadenza non c'era. La voce era P0 condizionale. Il limite del freeze (blocco delle modifiche) si applicava solo all'introduzione di un campo obbligatorio. L'invocazione di `query` da N thread è già permessa dai vincoli `Send + Sync` e `&self`. Una dichiarazione aggiuntiva avrebbe documentato solo le attese, ovvero un fatto non verificabile. Rimangono un paragrafo descrittivo nel trait (interfaccia Rust) e nel WIT (WebAssembly Interface Type), e un presidio per indice. La concorrenza di una query rappresenta una proprietà di implementazione.
- **Il guadagno per l'utente è arrivato adesso.** La decisione 0024 documentava un fattore di 1,0× per il carico misto. Una ricerca occupava il 99,6% del tempo nel test. Senza la serializzazione dell'indice, le prestazioni salgono a **6,8×** a otto thread e 9,1× a sedici. Il numero della decisione 0024 mancava di una voce.

Il componente `CoreIndex` (l'indice principale) costituisce un oggetto-dio annidato, come evidenziato nella decisione 0022. Trenta accessi a `indexes` su trentuno passano attraverso `indexes.core`. L'intervento richiede la medesima procedura applicata un giro più in basso. Il ticket non possiede ancora un numero. `CoreIndex` differisce dalla situazione §8.4. Di lock interni non ne ha nessuno e restituisce le informazioni già in suo possesso.

Le quattro decisioni hanno spostato alcune problematiche senza risolverle direttamente. Questa dinamica trasferisce le responsabilità alle sedute successive. I componenti possiedono ora un posto solo dove atterrare all'interno di `fub-host`, sostituendo i ventidue comandi Tauri precedenti.

I seguenti elementi definiscono i progressi compiuti:

- Il registry dei bundle (registro dei plugin, ~~§9.3~~), lo spegnimento (~~§9.5~~), le sessioni multiple (~~§9.6~~) e gli errori tipizzati (§12.2) convergono su `fub-host`. Le prime tre componenti sono atterrate lì davvero.
- La mappa delle sessioni risiede in `host/session.rs` ([decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)). L'applicazione `fub-app` collega un gancio su `RunEvent::Exit` e offre tre firme IPC.
- Il registry e il pool dei job (gestione dei task) trovano posto in `host/registry.rs` e `host/runner.rs` ([0031](../decisions/0031-chi-possiede-i-bundle.md), [0032](../decisions/0032-il-runner-dei-job.md)).

I due punti dell'8.3, pur non derivando direttamente dall'8.3, riguardavano il lavoro lungo fuori dal lock e la cancellazione. Questi problemi si posizionano ora accanto ai loro impedimenti:

- Il punto §9.1 si chiude con la [decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md). Il lavoro lungo adesso risiede fuori dal lock.
- Il punto ~~§9.3~~ è chiuso. Il codice gira regolarmente e si annulla.
- Il punto ~~§10.3~~ si chiude con la [decisione 0035](../decisions/0035-il-lavoro-lungo-si-racconta.md). L'utente vede il lavoro e lo ferma.

Il costo di una query richiedeva ~21 ms su duemila note. Questa seduta ha diviso il tempo per otto senza fornire spiegazioni iniziali. Il problema apparteneva alla voce ~~§21.9~~ e si chiude con la [decisione 0074](../decisions/0074-selezionare-non-e-raccontare.md). Il tempo di calcolo non dipendeva dalla query, ma dalla generazione di duemila estratti testuali per mostrarne venti. La stessa ricerca costa attualmente ~3,2 ms.
