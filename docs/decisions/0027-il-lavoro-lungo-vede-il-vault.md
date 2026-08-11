# 0027 — Il lavoro lungo vede il vault: un host per chiamata, non uno snapshot

|  |  |
|---|---|
| **Decisa** | 2026-07-27 |
| **Origine** | `todo.md` §9.1 (seduta 9) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/09-il-lavoro-lungo-e-lo-spegnimento.md)

---

`Plugin::run_job` era deliberatamente senza `HostApi` — «input nel `payload`,
output nel risultato» — e per un calcolo puro era la firma giusta. Per tutto il
resto era il divieto di esistere: l'unico modo di dare input a un job diventava
che il **chiamante** leggesse il vault dentro il giro sincrono, cioè facesse lì,
in esclusiva sul workspace, esattamente il lavoro che il job doveva togliere da
lì. Il conto di ciò che con quella firma non era esprimibile lo aveva già fatto
la voce: import ed export (17, ~120 voci), embedding e RAG locale (22.1-22.3),
sync (18.1), backup e snapshot (18.2), sito statico (19.4), OCR e trascrizione
(13.4), health check e diagnostic bundle (24.2), reindicizzazione (24.1). Tutte
camminano il vault, e quasi tutte ci scrivono.

Era la voce a leva più alta del piano per una ragione che vale solo per lei e
per poche altre: non allargava una capacità, ne rendeva una **inesprimibile**.

## La risposta, in una frase

**Il job riceve l'`HostApi` intero — quello di sempre, con davanti i permessi
del suo plugin — e lo riceve *per chiamata*: nessuno snapshot, nessuna scrittura
differita, e contro il vault che cambia nel frattempo la guardia è quella che il
contratto ha già dalla [0008](0008-modifica-chirurgica.md).**

| un job che cammina 150 note, quanto aspetta chi salva | prima (il chiamante legge nel giro sincrono) | adesso (il job legge da sé) |
|---|---|---|
| attesa di un salvataggio | **~5,0 ms** (tutta la camminata) | **~0,6 µs** (una lettura sola) |

Le due colonne sono lo stesso lavoro sullo stesso vault nella stessa corsa, e
stanno in un presidio, non in un banco: `mentre_un_job_cammina_il_vault_chi_salva_non_aspetta`
in [`crates/fub-host/tests/lavoro_lungo.rs`](../../crates/fub-host/tests/lavoro_lungo.rs).
Il confronto è un **rapporto** e non una soglia in millisecondi, perché una
macchina lenta allunga tutte e due le colonne e non la distanza fra loro: chi
salva aspetta *una* lettura da una parte e *tutte* dall'altra.

## Le decisioni prese, da NON ridiscutere senza motivo

- **Nessuna delle due strade che la voce elencava, e non per terza via: perché
  erano due modi di comprare una coerenza che il contratto già vende.** La prima
  — un `JobHost` in sola lettura su uno **snapshot coerente** — ha due difetti e
  il secondo è fatale: uno snapshot coerente di un vault è una copia del vault
  (la cache del kernel tiene i soli metadati, il corpo no), e comunque lascia
  fuori metà del volume, perché import, clipper, sync e backup **scrivono**. La
  seconda — **scritture differite** al `JobDone` — mette il risultato di un
  import dentro un `serde_json::Value` e poi lo consegna tutto insieme al giro
  sincrono: cinquemila note in memoria e una scrittura sola lunga come l'import.
  È il blocco che si voleva togliere, spostato di dieci righe più in là.
- **«Un job può scrivere?» non è una domanda della firma: è una domanda del
  permesso**, e ha già un posto dove essere fatta. Dalla
  [0021](0021-il-confine.md) ogni prestito passa da una politica che compone i
  permessi dichiarati e la fiducia; un job di chi non ha `write_vault` riceve
  gli stessi rifiuti che riceve il suo `handle`, con lo stesso messaggio.
  Metterlo nella firma avrebbe voluto dire deciderlo **una volta per tutti i
  plugin**, che è l'opposto di ciò che una politica serve a fare.
- **Il prestito è per chiamata, ed è contratto — non un dettaglio del
  `JobHost`.** Ogni capacità prende il prestito del workspace, fa il suo lavoro
  e lo rilascia; fra due chiamate il vault può cambiare, e chi lo cammina vedrà
  qualcosa che non è mai stato vero tutto insieme. Detto così sembra una
  rinuncia ed è la cosa comprata: l'alternativa è un'app ferma per la durata di
  un export. Non dirlo sarebbe stato peggio che non averlo — una promessa di
  atomicità che nessuno mantiene è come si scrivono le corse invisibili.
- **La semantica di «e se il vault è cambiato nel frattempo» era già decisa, e
  vale per entrambi come la voce chiedeva.** Chi scrive un pezzo passa da
  `apply_edit` con la `base` che `document_revision` gli ha dato e riceve
  `Conflict`; chi crea passa da `create_document`, che rifiuta un path occupato;
  `free_name` non prenota, e lo dice. La [0008](0008-modifica-chirurgica.md)
  aveva scritto che una base opzionale la si omette «proprio nel caso lungo
  (l'automazione che calcola per un minuto), che è l'unico in cui serve»:
  quell'automazione è questa, e la frase è diventata un presidio
  (`un_job_che_scrive_su_una_base_vecchia_riceve_conflict`).
- **Al confine WIT non cambia niente, e non è un cavillo — è la scoperta che
  rendeva la voce più urgente di come era scritta.** In WIT le capacità sono
  **import del world**, non un parametro di `run-job`: un componente che gira un
  job può chiamarle, e l'host non ha modo di impedirglielo perché non esiste il
  posto dove dire «queste no, adesso». Cioè «dentro un job non c'è `HostApi`»
  era una regola **solo Rust**, che a M5 sarebbe stata falsa in silenzio. Ciò
  che scadeva col freeze era la firma Rust, ed è quella che è cambiata; il WIT
  guadagna la prosa che dice la disciplina, e zero campi.
- **Ed è per questo che era P0.** Una funzione **nuova** in un'interfaccia è
  additiva (è il ragionamento del §9.2); un **parametro in più su una firma
  esistente** non lo è, nemmeno con un corpo di default — chi implementa smette
  di compilare. Oggi costa un parametro perché gli implementatori di `Plugin`
  sono zero; dopo il freeze sarebbe stata una major.
- **Il ponte sta in `fub-host` e non nel kernel, perché il kernel non sa che
  esiste un lock.** Il `Workspace` è un oggetto normale, ed è chi lo monta a
  metterlo dietro un `RwLock` ([0024](0024-chi-legge-non-aspetta-chi-legge.md)):
  un host che prende il prestito per chiamata può nascere solo dove il lock è di
  casa. `JobHost` sta accanto al watcher, che è l'altro componente che entra nel
  workspace da un thread suo.
- **Le letture di un job passano da `read()`, e ha voluto un metodo nuovo del
  kernel.** `Workspace::with_read_host` è il gemello in sola lettura di
  `with_host` e prende `&self`: senza, il `JobHost` avrebbe dovuto passare dal
  prestito esclusivo anche per leggere, e un job che cammina il vault fa quasi
  solo letture — sarebbero state migliaia di serializzazioni di chi disegna, in
  silenzio, perché `write()` al posto di `read()` compila.
- **Il default di `run_job` resta, e con esso il job puro.** Chi non tocca
  l'host scrive lo stesso job di prima: la firma vecchia non era sbagliata, era
  insufficiente, e toglierle il caso che serviva sarebbe stato cambiarla due
  volte. Il presidio che c'era nel kernel — un handler che chiede un job e ne
  scrive l'esito al rientro — non è stato toccato e passa com'era.

## Trovato per strada

- **`JobSpec.payload` cambia significato senza cambiare forma.** Era «tutto
  l'input necessario» perché non c'era altro modo di farlo entrare; adesso sono
  gli **argomenti** del job — quale cartella esportare, quale URL importare.
  Zero campi aggiunti, zero tolti, e un record che al freeze si congela dicendo
  una cosa che è vera.
- **Il secondo punto del §8.3 atterra qui, e adesso ha un numero.** «Lavoro
  lungo fuori dal lock» non dipendeva dal tipo del lock ma dal fatto che il
  lavoro lungo *non potesse* stare fuori. La
  [0024](0024-chi-legge-non-aspetta-chi-legge.md) aveva reso il costo visibile
  (780 ms di workspace tenuto in esclusiva da `reindex` su 2000 note); qui il
  costo si toglie, e la distanza fra le due strade è di **tre ordini di
  grandezza** sulla stessa camminata.
- **La rete non ha più bloccanti nominati.** La
  [0013](0013-elenco-delle-capacita.md) aveva lasciato fuori `http_fetch`
  legandola a due voci: §9.1 «perché sia utile», §7.3 «perché sia sicura». La
  seconda l'ha chiusa la [0021](0021-il-confine.md), questa chiude la prima. Non
  entra qui — non è questa voce, ed è additiva — ma va detto cosa resta prima di
  aggiungerla: le **allowlist dei permessi non sono ancora applicate** (lo
  dichiara la 0021), quindi oggi `network` sarebbe tutto-o-niente invece che un
  elenco di host.
- **Un job che chiama `run_command` non porta i comandi fuori dal kernel: ce li
  fa entrare.** Il comando gira dentro il prestito esclusivo, nel giro sincrono,
  esattamente come se lo avesse invocato la shell — e quindi eredita modo,
  attore e lotto come li eredita chiunque altro. Non è stato deciso qui: è ciò
  che la [0009](0009-registro-dei-comandi.md) e la [0011](0011-il-lotto.md)
  dicono già, e che il `JobHost` non aveva titolo a dire diversamente.

## Cosa NON è stato fatto, e perché

- **Il runner resta il §9.3, e con lui la cancellazione.** Qui c'è ciò che un
  job riceve, non chi lo esegue: `spawn_job` accoda ancora e in produzione
  nessuno draina. La differenza è che il pool del §9.3 adesso ha **qualcosa da
  passare al job**, e prima non ce l'aveva — un runner scritto ieri avrebbe
  eseguito soltanto funzioni pure. La cancellazione va disegnata *con* il pool,
  perché un pool che non nasce cancellabile si riscrive per diventarlo.
- **Nessuno snapshot, e nessuna revisione dell'intero vault.** Un job che vuole
  sapere se il vault gli è cambiato sotto una camminata può chiedere la
  revisione di un documento (ce l'ha) e non ha un fatto solo da guardare per
  l'insieme. Inventarne uno qui avrebbe voluto dire decidere cosa sia una
  versione del vault senza la sua domanda davanti: è il §15.2 (durabilità e
  recovery) col §14.2 (i metadati di entry).
- **Un job non è un lotto, e non gli è stato dato modo di aprirne uno.** N
  scritture da un job sono N eventi, come da chiunque altro; raggrupparle è il
  §10.2 (il freno e il raggruppamento del ponte eventi), che vale per ogni
  sorgente di eventi e non per questa. Il lotto (0011) copre ciò che accade
  dentro **una** chiamata del kernel, e un job dura più di una chiamata per
  definizione.
- **Nessun limite di durata, nessuna deadline.** Il confine dichiara che a M5
  una deadline tronca le chiamate sincrone; un job è per definizione ciò che sta
  fuori da quel limite, e ucciderlo a tempo è una politica dell'host che vuole
  il runner per avere dove stare (§9.3) e il §10.3 per avere dove mostrarsi.
- **`Plugin` continua a non avere implementatori in produzione.** Il primo vero
  arriva col registry del §9.3; quello del presidio è un plugin di banco, e lo
  dice.

## Verifica

- `cargo build --workspace` — pulita, zero warning; anche
  `-p fub-host --no-default-features`.
- `cargo clippy --workspace --all-targets` — pulita nelle due configurazioni.
- `cargo test --workspace` — **56 suite, 0 fallimenti**. Sono le 55 della
  [0026](0026-due-query-insieme.md) più `fub-host/tests/lavoro_lungo.rs`, che è
  una suite nuova e non un test aggiunto a una che c'era: le sue quattro prove
  vogliono un vault aperto e un thread, cioè le due cose che il kernel non ha.
  Nessun test preesistente è stato tolto né adattato — la firma nuova ha un
  parametro in più e zero implementatori da aggiornare.
- Il presidio del confronto, provato al contrario: la colonna «prima» è nel test
  stesso, ed è la camminata dentro un prestito solo — se il `JobHost` tenesse il
  prestito per la durata del job, le due colonne coinciderebbero e il test
  fallirebbe con il proprio messaggio. Misurato su tre corse: 0,63 / 0,63 / 1,14
  µs contro 5,02 / 4,98 / 5,39 ms.
- `cargo fmt --all` — pulita.
