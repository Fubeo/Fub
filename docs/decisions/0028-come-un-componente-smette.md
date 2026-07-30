# 0028 — Come un componente smette: una chiusura obbligatoria, e una disattivazione che toglie davvero

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §9.2 + §9.4 (seduta 9) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md)

---

Il kernel sapeva **solo aggiungere**. `register_event_handler`,
`register_index_provider` e `register_view_provider` facevano `push`;
`IndexProvider` aveva `activate` e `flush` e nessun `close`;
`Plugin::deactivate` esisteva nel contratto e non aveva **un solo chiamante** in
tutto il repo. Da lì venivano due cose diverse che sono la stessa:

- un indice che possiede risorse esterne — tantivy tiene segmenti mmappati, un
  lock file sulla propria cartella e dei thread di merge — non aveva un punto in
  cui chiuderle, e il kernel non aveva modo di chiedergliele;
- «spento» poteva voler dire una cosa sola, *non registrato all'avvio*, decisa
  da una variabile d'ambiente (D7). Con le impostazioni del §11.1 la decisione si
  prende a runtime, e senza un modo di togliere un provider quella parola smette
  di significare qualcosa.

## La risposta, in una frase

**`IndexProvider::close` è obbligatoria — niente corpo di default — e
`Workspace::deactivate_plugin` è l'inverso esatto della strada di
registrazione: chiude gli indici (`flush` e poi `close`), toglie tutto ciò che
il plugin aveva registrato, dà un esito ai job che non partiranno, e ritira la
dichiarazione dall'inventario.**

## Le decisioni prese, da NON ridiscutere senza motivo

- **Obbligatoria, non con default no-op — ed è per questo che la voce era
  P0.** Il §9.2 aveva impostato la domanda nel modo giusto: per
  `wit_additivity` una funzione **nuova** in un'interfaccia è additiva, quindi
  `close` aggiunto dopo il freeze non romperebbe il WIT; romperebbe **chi
  implementa**, e solo se nasce senza corpo di default. La P0 non era sulla voce,
  era sulla scelta. La scelta è: obbligatoria. Un indice che tiene un lock file e
  non ha dove rilasciarlo lo rilascia quando il processo muore, cioè mai; un
  default no-op avrebbe reso quel caso **indistinguibile da chi non ha niente da
  chiudere**. Costa una riga a chi non ha niente da chiudere (`Ok(())`), e la
  scrive sapendo di non averne.
- **Perché non basta il `Drop`, che in Rust ci sarebbe.** Perché un `Drop` non ha
  l'`HostApi`: ciò che un indice rende durevole passa da `data_*`, e un provider
  che persistesse mentre viene distrutto dovrebbe usare `std::fs` — cioè uscire
  dal proprio recinto — o non persistere affatto. E a M5 il `Drop` **non c'è**:
  un componente che l'host smonta non esegue niente al proprio smontaggio, quindi
  senza questa funzione un indice di terzi non avrebbe alcun modo di chiudersi
  bene. È la stessa scoperta della [0027](0027-il-lavoro-lungo-vede-il-vault.md):
  una regola vera solo in nativo è una regola falsa in silenzio al confine.
- **`flush` e poi `close`, e il `close` ha l'host lo stesso.** Sono due momenti e
  non uno: il primo è il punto di persistenza che già c'era, il secondo è
  «lascia andare ciò che tieni». L'host c'è in tutti e due perché una chiusura
  può avere qualcosa di **suo** da scrivere — un marcatore di spegnimento
  pulito, che alla riapertura distingue «chiuso bene» da «il processo è morto».
  Dopo `close` un indice non riceve più niente: né alimentazione, né `flush`, né
  `query`.
- **La chiusura di un solo trait, e non di tutti.** `ViewProvider`,
  `CommandProvider` ed `EventHandler` non hanno un `close` e non lo avranno per
  simmetria: per contratto non possiedono niente che vada rilasciato, e il punto
  in cui un **bundle** libera ciò che possiede è `Plugin::deactivate`, che esiste
  già. L'indice è il caso speciale perché è l'unico che il kernel **alimenta** e
  che possiede uno stato derivato su disco: è l'unico a cui il kernel deve dire
  *ho finito con te* mentre ha ancora un host da prestargli.
- **Disattivare ritira la dichiarazione, non solo le registrazioni.**
  «Dichiarato con zero registrazioni» è uno stato vero e diverso — è chi si è
  presentato e non ha registrato niente — e usarlo anche per dire «spento» li
  renderebbe indistinguibili proprio nel posto in cui si va a leggere cosa è
  attivo (l'inventario del §7.6). Riaccendere passa dalla stessa porta della
  prima volta: `register_plugin`, e poi i `register_*`.
- **Le rotte del canale dati si rimappano, e non è un dettaglio
  d'implementazione.** Un bersaglio (`Target::Provider`) è una **posizione**
  nell'elenco degli indici registrati: togliere il primo di due, senza
  rimappare, manderebbe le domande del primo al secondo — che risponderebbe, e
  nessuno avrebbe modo di accorgersi che sta rispondendo per conto di un altro.
  Le rotte di chi se ne va **spariscono**: chi le chiede riceve `Unserved`, che è
  la verità. Il presidio esiste e fallisce se la rimappatura si toglie
  (`le_rotte_di_chi_se_ne_va_non_passano_a_chi_gli_stava_dietro`).
- **I nomi tornano liberi, tutti.** Le regole sintattiche e i renderer non stanno
  in una tabella di provider e i loro registri conoscono l'id della *regola*, non
  quello di chi l'ha registrata: i nomi da togliere si prendono
  dall'inventario, che è l'unico che sa di chi erano. Se restassero appesi, un
  plugin riacceso troverebbe un conflitto contro il proprio fantasma.
- **I job in coda di chi si spegne ricevono un esito.** È la **terza faccia** del
  §9.2 — quella che la 0027 aveva lasciato aperta. Il corpo di un job è
  `Plugin::run_job`: spento il plugin, quel corpo non esiste più. Ogni job in
  coda viene tolto e completato con un errore che nomina il plugin, perché un
  job che sparisce in silenzio è un chiamante che aspetta per sempre.
- **E un job *in volo* non ha voluto niente di nuovo.** Le sue capacità
  evaporano da sé alla chiamata successiva: dalla 0027 il `JobHost` prende il
  prestito **per chiamata** e la politica se la fa dare dal registro, e un id
  che nessuno ha più dichiarato riceve `Granted::undeclared` — cioè un host che
  nega tutto, dicendo perché. Era una proprietà già pagata, e questa voce si è
  limitata a non romperla. Chi *aspetta* un job in volo resta il §9.3, col
  runner.
- **Da dentro la chiamata di un provider non si disattiva: `RegistryError::Busy`.**
  Non è prudenza. Lì i provider sono **in prestito** (§7.2), la loro tabella è
  vuota, e una rimozione calcolata su una tabella vuota toglierebbe zero e li
  vedrebbe tornare tutti al ripristino — cioè una disattivazione che riesce e non
  succede. È la risposta alla domanda che il §9.4 poneva come «va decisa, non
  scoperta a runtime».

## Trovato per strada

- **La coda dei job non sapeva di chi fossero.** `take_pending_jobs`
  restituiva `(JobId, JobSpec)`, e il corpo di un job è `Plugin::run_job`: chi
  drena la coda non aveva modo di sapere **a quale plugin** chiederlo. Non era un
  problema finché in produzione nessuno drenava (§9.3); lo sarebbe diventato il
  giorno dopo. Adesso la coda porta un `PendingJob { id, plugin, spec }`, e la
  disattivazione ha qualcosa su cui filtrare.
- **`SearchIndex` teneva il lock della propria cartella fino alla morte del
  processo.** Il `Mutex<IndexWriter>` è diventato `Mutex<Option<IndexWriter>>`
  perché chiudere vuol dire **restituire** il writer a tantivy e aspettarne i
  thread di merge: è l'unico modo di lasciare andare il lock esclusivo mentre
  l'oggetto è ancora vivo. Il presidio è in `search.rs`
  (`un_indice_chiuso_lascia_la_cartella_a_chi_arriva_dopo`) e prova esattamente
  quello: un secondo indice si apre sulla stessa cartella mentre il primo è
  ancora in vita. Senza la restituzione, fallisce.
- **La disattivazione emette `IndexUpdated`.** Se il canale dati smette di
  rispondere come prima, chi disegna da una query sta mostrando il passato.
  L'attore è `Actor::Kernel`: non lo ha chiesto un documento né un plugin, è il
  kernel che dichiara di aver cambiato forma ([0012](0012-origine-degli-eventi.md)).

## Cosa NON è stato fatto, e perché

- **`Plugin::deactivate` continua a non avere chiamanti, ed è giusto così
  finché il §9.3 non c'è.** Il kernel non possiede i `Box<dyn Plugin>`: possiede
  i loro **provider**. Chi possiede i bundle è il registry del §9.3, ed è lui a
  dover chiamare `deactivate` e poi `Workspace::deactivate_plugin`. Fare
  chiamare al kernel una funzione su un oggetto che non ha avrebbe voluto dire
  dargli quell'oggetto, cioè scrivere il registry qui dentro con un altro nome.
- **Non c'è ancora una chiusura del *workspace*.** «Spegnere un plugin» e
  «chiudere il vault» sono due cose e la seconda è il §9.5: flush finale,
  disattivazione di tutti, e un punto di consistenza che non sia il watcher.
  Questa voce le ha dato il mattone — `deactivate_plugin` — e non l'ha usata.
- **La `Busy` non ha un presidio, e il perché va detto.** Oggi non la può
  ricevere nessuno: `deactivate_plugin` vuole `&mut Workspace`, e durante una
  chiamata a un provider quel prestito ce l'ha l'host che il provider sta usando
  — il compilatore è la prima difesa, e non c'è modo di aggirarlo dall'interno
  per provare la seconda. La variante esiste perché la porta che la renderà
  raggiungibile è già nominata (una capacità che spenga un plugin, §11.1, e a M5
  un guest che la chiami mentre il suo frame è aperto): una semantica decisa
  *dopo* che il chiamante esiste è una semantica decisa da lui.
- **Niente `close` per gli altri provider e niente riavvio a caldo.** Riaccendere
  è oggi «ridichiarare e riregistrare», e basta perché i bundle li monta il repo.
  L'hot reload vero (20.2) vuole il registry del §9.3 e le impostazioni del
  §11.1.

## Verifica

- `cargo build --workspace` — pulita, zero warning; anche
  `-p fub-host --no-default-features`.
- `cargo clippy --workspace --all-targets` — pulita.
- `cargo test --workspace` — **57 suite, 0 fallimenti**. Sono le 56 della
  [0027](0027-il-lavoro-lungo-vede-il-vault.md) più
  `fub-kernel/tests/disattivazione.rs`, che è una suite nuova con cinque prove:
  l'ordine `flush` → `close` e il silenzio che segue, le rotte che non si
  ereditano, la rimozione di tutte le famiglie con i nomi che tornano liberi, i
  job in coda che ricevono un esito, e il rifiuto su un id mai dichiarato.
- Le due prove che contano sono state **provate al contrario**: togliendo la
  rimappatura delle rotte, `le_rotte_di_chi_se_ne_va_non_passano_a_chi_gli_stava_dietro`
  fallisce con il proprio messaggio (la domanda del primo indice riceve la
  risposta del secondo); togliendo la restituzione del writer,
  `un_indice_chiuso_lascia_la_cartella_a_chi_arriva_dopo` fallisce (la seconda
  apertura non ottiene il lock).
- I quattro doppi di test che implementano `IndexProvider` hanno guadagnato una
  riga a testa, e nessun test preesistente è stato adattato d'altro: la firma
  nuova è una funzione in più, non un cambio di firma.
- `cargo fmt --all` — pulita.
