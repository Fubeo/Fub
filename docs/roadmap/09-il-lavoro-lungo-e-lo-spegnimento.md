# 9. Il lavoro lungo, e come un componente smette

Una **seduta** della [roadmap infrastrutturale](../todo.md): lo spegnimento è chiuso per intero — un componente, il vault, le sessioni, e il rilevamento che adesso si può chiedere — chi possiede i bundle ha un nome, e resta **chi esegue il lavoro lungo**.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Il quinto giro chiedeva di decidere insieme ~~§9.2~~, ~~§9.4~~ e ~~§9.1~~ — «tre
facce del momento in cui un componente smette, e oggi nessuna delle tre ha una
risposta» — e ~~§9.5~~ andava con ~~§9.6~~, perché «chiudere una sessione» e
«chiuderle tutte» sono lo stesso codice. Il registry (9.3) sta qui perché è chi
**possiede** i bundle: senza di lui non c'è nessuno che apra e chiuda alcunché, e
il runner dei job non ha un chiamante in produzione.

**Le tre facce sono chiuse.** La ~~9.1~~ andava sopra tutte per la ragione del
quarto giro — non allargava una capacità, ne rendeva una **inesprimibile** — ed è
chiusa dalla [decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md):
un job riceve l'`HostApi` intero, e lo riceve *per chiamata*. Le altre due —
~~9.2~~ (il contratto non ha uno spegnimento) e ~~9.4~~ (si può solo *non
registrare*) — le chiude la [decisione 0028](../decisions/0028-come-un-componente-smette.md):
`IndexProvider::close` è **obbligatoria**, e `Workspace::deactivate_plugin` è
l'inverso esatto della strada di registrazione. Lì è finita anche la terza faccia
per intero: i job in coda di chi si spegne ricevono un esito, e le capacità di un
job in volo evaporano da sé — la politica se la fa dare dal registro a ogni
chiamata, e un id che nessuno ha più dichiarato non ottiene niente.

**E il vault si chiude.** La ~~9.5~~ e la ~~9.6~~ le chiude insieme, com'era
previsto, la [decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md):
chiudere è `VaultClosed` mentre tutti sono ancora vivi, poi un flush di tutti gli
indici — il punto di consistenza che non è il watcher — e poi ogni plugin che
smette in ordine inverso di dichiarazione. Sotto, `Host` ha smesso di tenere una
sessione sola: i vault aperti sono una mappa, ogni comando IPC accetta un
`vault` opzionale, e il "corrente" è tornato a essere ciò che diceva di essere —
una comodità della shell. Del §9.6 è rimasto fuori un punto solo, il **registro
dei vault** (recenti, preferiti, icone), che è configurazione globale e si è
spostato al [§11.1](11-impostazioni-e-i-tre-stati.md).

**E il rilevamento si può chiedere.** La ~~9.7~~ l'aveva aggiunta il settimo
giro perché era la 9.5 sull'altro asse: là il watcher assente costava la
**durabilità** di un indice — e quel costo l'ha tolto la 0029, perché adesso il
flush ha un chiamante che non è il watcher — qui costava il fatto stesso di
sapere che il vault è cambiato, e nessuno chiedeva mai se il watcher fosse vivo.
La chiude la [decisione 0030](../decisions/0030-il-rilevamento-si-puo-chiedere.md):
`IndexQuery::VaultStatus` è la domanda, la bandiera del rilevamento è **una
sola** e la tiene chi guarda, e ogni sincronizzazione per-path che fallisce resta
scritta nel vault anche quando il chiamante butta via il proprio `Result`. Con
lei è a verbale anche **cosa promette FubMD dove il rilevamento non c'è**, che
era la decisione vera della voce. Ne è rimasto fuori un residuo, nominato: la
`base` che manca a `write_document`, che è il conflitto buffer↔disco del
[§18.1](18-editor-e-tastiera.md).

**E chi possiede i bundle ha un nome.** Il primo punto della 9.3 lo chiude la
[decisione 0031](../decisions/0031-chi-possiede-i-bundle.md): un bundle si monta
in quattro passi sempre uguali — la versione del contratto, la dichiarazione,
`Plugin::activate`, i provider — e li percorre un registry che sta **dalla parte
dell'host**, perché l'`HostApi` non ha capacità di registrazione ([0013](../decisions/0013-elenco-delle-capacita.md))
e un plugin non può registrarsi da sé. Da lì vengono le due cose che non avevano
un posto: `Plugin::deactivate` ha un chiamante — e arriva **prima** che il kernel
tolga i provider, che è l'unico momento in cui il suo `host` serve a qualcosa —
e `abi_compatible`, che era una regola senza applicazione, si applica.

Quel che resta della seduta è quindi **chi esegue il lavoro lungo**: la 9.3 è
aperta per la sua seconda metà, e basta.

### 9.3 Registry di plugin/feature e runner dei job

*ex §2.3 · kernel · **P1** — leva alta: è chi usa la disattivazione della [0028](../decisions/0028-come-un-componente-smette.md) e la chiusura della [0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md), ed è il registry su cui poggia il capitolo 7. **È l'ultima voce della seduta, ed è aperta a metà**: il registry lo ha chiuso la [0031](../decisions/0031-chi-possiede-i-bundle.md), restano il runner, la cancellazione e il safe mode — che vanno decisi insieme.*

- [x] ~~**Una tabella di montaggio unica**~~ — **chiusa dalla
      [decisione 0031](../decisions/0031-chi-possiede-i-bundle.md)**: le feature
      erano cablate a mano in `mount` (`host/mount.rs`), e adesso ogni riga è un
      `Bundle` che passa dalla stessa strada di un plugin di terzi. Il registry
      dichiara, verifica `abi_compatible`, chiama `Plugin::activate`, fa
      registrare i provider e **possiede** il `Box<dyn Plugin>` finché è vivo;
      lo spazio dati continua ad assegnarlo il kernel (`plugin_data_dir`), e
      `Trust` lo dice chi monta, non il manifest. È il pezzo che a M5 il
      caricatore WASM riuserà tale e quale, perché a M5 il caricatore è
      host-side per costruzione.
- [ ] **Runner dei job**: un pool che draina `take_pending_jobs`, esegue
      `run_job` fuori dal lock e riconsegna con `complete_job`. Esiste il giro,
      esiste il test, **non esiste il chiamante in produzione**: oggi
      `spawn_job` accoda e basta. «Fuori dal lock» adesso vuol dire una cosa
      precisa e non più una figura: il workspace ha un `RwLock`
      ([decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)) e
      il job ha un host che il prestito se lo prende da sé, una chiamata alla
      volta ([decisione 0027](../decisions/0027-il-lavoro-lungo-vede-il-vault.md)
      — è `JobHost`, in `fubmd-host`). Il pool quindi **non deve tenere niente in
      mano** mentre chiama `run_job`: il ponte c'è, e ciò che resta da scrivere è
      chi lo usa. Prima di quella decisione un runner scritto qui avrebbe
      eseguito soltanto funzioni pure. E adesso c'è anche **a chi chiedere il
      corpo**: la coda dice quale plugin (`PendingJob.plugin`), e chi possiede
      quel plugin è il registry della
      [0031](../decisions/0031-chi-possiede-i-bundle.md) — `BundleRegistry::plugin`
      è l'unica cosa che quella decisione ha lasciato senza chiamante.
- [ ] **Cancellazione** — il terzo punto del §8.3, e sta qui perché prima del
      runner non c'è niente da cancellare: `spawn_job` accoda, e una coda non si
      ferma, si svuota. Un job che non si può fermare è un job che blocca la
      chiusura dell'app, e adesso quella chiusura **esiste**
      ([decisione 0029](../decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)):
      oggi non aspetta nessuno perché non c'è nessuno in volo, e la domanda «chi
      chiude aspetta chi?» diventa dovuta il giorno in cui il runner c'è. L'altro
      lato è il §10.3 (dove l'utente vede il pulsante). Va disegnata **con** il
      runner, non dopo: un pool che non nasce cancellabile si riscrive per
      diventarlo.
- [ ] ~~**Namespace per-plugin sullo `storage_*`**~~ — **decaduta**: lo
      `storage_*` volatile è stato **ritirato** dal contratto dalla
      [decisione 0013](../decisions/0013-elenco-delle-capacita.md), quindi non c'è
      più niente da namespacare. Il recinto per-plugin che resta è quello dei
      `data_*`, che ce l'ha già (`plugin_data_dir`, che delega a `DocumentStore::plugin_data_root` in `documents.rs`). Dove il
      buco è rimasto aperto è lo **stato di vista**, che non ha più nemmeno un
      contenitore sbagliato: §11.2.
- [ ] **Safe mode / isolamento**: un provider che pania non deve portarsi via il
      vault (`catch_unwind` al confine, disattivazione con avviso) — 24.2, 20.3.
      La [decisione 0024](../decisions/0024-chi-legge-non-aspetta-chi-legge.md)
      ne ha tolto **una metà**, e va detto quale: un `RwLock` si avvelena solo se
      a paniare è chi tiene il prestito esclusivo, quindi un provider che
      **disegna** non se lo porta più via. Chi **agisce** sì, ed è tutto lì
      dentro: `view_action` e `invoke_command` prendono `write()`
      (`app/lib.rs`), e `write_document` ci fa passare il parse del formato e
      l'alimentazione degli indici. Da lì il panico avvelena, e i quindici
      `.read()/.write().unwrap()` di `app/lib.rs` lo traducono in un panico su
      **ogni** comando successivo: non è la chiamata persa di cui parla la 0024,
      è il vault irraggiungibile fino al riavvio. Finché i provider sono in-repo
      è il caso raro; con un'estensione installata un handler di comando che
      pania è il caso normale — la metà che resta non è la metà meno probabile.
