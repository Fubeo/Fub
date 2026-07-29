# 16. I crate, l'SDK, i banchi di prova

Una **seduta** della [roadmap infrastrutturale](../todo.md): i banchi e i confini fra crate, **prima** di ciò che li moltiplica.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

La precedenza dura del sesto giro — **16.2 prima di 16.3**, o i venti bundle di
21.2 si portano dietro venti copie del banco di prova — è **soddisfatta**: la
16.2 è chiusa dalla [decisione 0055](../decisions/0055-il-banco-del-lato-host.md),
e la 16.3 non ha più precondizioni.

Il cappello diceva anche che 16.1 e 16.2 erano due banchi **diversi**, e che non
potevano stare nello stesso crate perché «`fubmd-kernel` nel grafo dell'SDK
violerebbe l'invariante che `dependency_invariant.rs` presidia». La conclusione
regge — le due voci sono chiuse da due verbali, la
[0054](../decisions/0054-il-banco-del-lato-provider.md) e la
[0055](../decisions/0055-il-banco-del-lato-host.md) — ma **la ragione era
falsa**: quel file non nominava `fubmd-sdk` da nessuna parte. L'invariante c'era
nelle intenzioni e non nel test, e adesso c'è in tutti e due. La ragione vera è
più stretta di quella che il cappello dava: `fubmd-sdk` è dipendenza **normale**
di `fubmd-format-markdown` **oggi**, quindi il kernel là dentro non finirebbe nel
grafo di un futuro guest — finirebbe nella libreria di un provider che esiste.

Ed è il primo caso in cui un cappello di seduta ha dichiarato in anticipo una
**separazione** invece di un accorpamento: la 0053 aveva inaugurato la forma, e
queste due mostrano che la stessa forma può concludere all'opposto. Il criterio
sta nel [README delle decisioni](../decisions/README.md).

La 16.6 va **dopo** la 5.4, o l'allowlist si trova a dire di no a feature che non
hanno altra strada.

La precedenza più dura di questa seduta era un'altra — *la 16.4 prima delle P0
del terzo giro, o quelle si scrivono quattro volte* — ed è **decaduta insieme
alla voce**: la [decisione 0053](../decisions/0053-il-contratto-ha-una-sorgente.md)
ha chiuso la 16.4 con la 16.5, come la seduta chiedeva («la 16.5 non è una voce
autonoma: è la gamba TS della domanda che pone la 16.4»). La risposta — la
sorgente è **Rust**, e il WIT e il mirror TS sono due proiezioni su **due confini
con due forme diverse**, quindi nessuno dei due si genera dall'altro — vale la
pena tenerla presente leggendo il resto del file, perché corregge un numero che
ci gira dentro: quello che si scrive quattro volte non è il contratto, sono i
**presidi**, ed è il termine più grande del conto.

Il settimo giro ha aggiunto la 16.7, che sta qui e non fra i presidi della
[seduta 17](17-presidi-che-restano.md) perché ciò che le manca è esattamente il
banco della 16.2: un elenco dei provider ufficiali da cui un test possa
**iterare** invece di ricopiarlo. Quel banco adesso **c'è**
(`crates/fubmd-testkit`), e la [0055](../decisions/0055-il-banco-del-lato-host.md)
ha scelto dove andrebbe l'inventario senza costruirlo — costruirlo vuol dire
mettere `fubmd-features` fra le dipendenze del banco, che è una decisione della
16.7 e non sua. Quindi la 16.7 non è più bloccata: le manca il lavoro, non la
precondizione.

### 16.3 Un crate per bundle di feature

*ex §4.7 · presidi · **P1** — la precondizione (la 16.2) è **soddisfatta** · **in due tempi**, e il primo è piccolo*

- [ ] **`fubmd-features` è un crate solo**: tantivy è dipendenza dell'intero
      crate, quindi compilare il pannello outline compila un motore di ricerca.
      Con i moduli di 21.2 (FubTasks, FubDB, FubCanvas, FubCalendar, FubAI,
      FubMaps…) diventa un monolite con il grafo di dipendenze di venti feature,
      non disattivabile a compile time e senza confini contro l'accoppiamento
      feature↔feature — l'invariante "una feature ufficiale è ciò che scriverà un
      plugin" resterebbe vera nel documento e falsa nel `Cargo.toml`.
- [ ] **I due tempi, e vanno tenuti distinti perché comprano cose diverse.**
      *Primo*: una **cargo feature per bundle**, con tantivy dietro la sua. Costa
      un pomeriggio, si può fare **subito** e prende per intero il guadagno di
      compilazione — l'outline smette di tirarsi dietro un motore di ricerca.
      *Secondo*: lo **split in crate**, che è l'unica forma che compra il
      **confine contro l'accoppiamento feature↔feature**, perché dentro un crate
      solo `pub(crate)` lascia passare tutto. Il secondo tempo è quello che ha
      bisogno della 16.2 fatta prima, ed è giustificato dai venti moduli di 21.2
      — che oggi non esistono. Farlo adesso significa pagare venti `Cargo.toml`
      per tre feature; farlo mai significa scoprire l'accoppiamento quando
      districarlo costa venti volte tanto. Il primo tempo non ha nessuna di
      queste due condizioni, e per questo va scorporato: **è la parte che si può
      prendere senza decidere il resto.**

### 16.6 Dieta dell'IPC

*ex §4.2 · presidi · **P1** — dopo la 5.4*

- [ ] **Test che presidia la superficie**: l'elenco dei comandi Tauri
      (**38** oggi, in `generate_handler!`) è una **allowlist** in un test;
      aggiungerne uno richiede di dire perché non poteva essere un comando/una
      view/una query. È il modo meccanico di non tornare al bespoke.

      E questo numero è già l'argomento della voce, perché è **il secondo che ci
      sta scritto**: qui c'era «25 oggi, sei in meno dopo la
      [decisione 0013](../decisions/0013-elenco-delle-capacita.md)», e da allora
      le sedute hanno tolto (l'ultimo è `resolve_link`, con la
      [0043](../decisions/0043-il-path-e-la-chiave.md)) e aggiunto di più, senza
      che nessuna si accorgesse di dover tornare a correggere questa riga. Un
      conto scritto a mano in un documento non è un presidio: è una cosa che
      diventa falsa in silenzio, ed è esattamente ciò che l'allowlist esiste per
      non essere. Finché il test non c'è, chi legge questa riga la controlli.
- [ ] **Migrare i bespoke esistenti** dove il §1 lo rende possibile: versioning
      (3 comandi), ~~cestino (4)~~ e ~~organizzazione (2)~~ — fatti con la [decisione 0013](../decisions/0013-elenco-delle-capacita.md):
      crea, rinomina, cestina, ripristina, svuota e proponi-nome erano **sei**
      comandi Tauri e adesso sono cinque comandi del registro più **una**
      lettura (`propose_free_name`); resta `list_trash`, che è l'altra lettura.
      Grafo (1).
- [ ] **La riga che divide, trovata dalla [decisione 0013](../decisions/0013-elenco-delle-capacita.md) e da tenere**: un comando fa
      accadere qualcosa e risponde con un messaggio e un effetto; ciò che
      risponde con **dati** non può essere un comando (`CommandOutcome` non li
      porta) e resta sul canale di lettura. È il criterio con cui giudicare i
      bespoke che restano: `list_versions`/`read_version` sono letture,
      `restore_version` no.

### 16.7 Due presidi sono esaustivi **a memoria**, non per costruzione

*settimo giro · presidi · **P1** — un presidio che non nota è indistinguibile da uno che passa*

- [ ] **Il repo conosce già la tecnica giusta e l'ha applicata ai tipi.**
      `ts_mirror.rs` lo dice in un commento: *«l'esaustività la garantisce il
      `match` senza `_`: aggiungere una variante non compila finché non è qui»*
      (`features/tests/ts_mirror.rs`), e la [decisione 0003](../decisions/0003-modello-del-documento.md) dice lo stesso di
      `wit_conformance` («non compila su divergenza»). Sono presidi che il
      compilatore tiene completi. I due qui sotto sono elenchi scritti a mano, e
      la differenza si vede solo il giorno in cui qualcuno aggiunge la voce che
      non c'è.
- [ ] **`view_refresh_masks.rs` copre quattro view, per nome.**
      `ogni_view()` costruisce a mano `BacklinksView`, `OutlineView`,
      `TagPanelView`, `StatsView` (`features/tests/view_refresh_masks.rs`).
      La [decisione 0011](../decisions/0011-il-lotto.md) lo descrive come «un test su ogni view ufficiale», e la quinta
      view ufficiale entrerà senza che nessuno se ne accorga: il test resta verde
      perché guarda le quattro di prima. Il difetto che quel presidio esiste per
      fermare è, alla lettera, *«un pannello che smette di aggiornarsi soltanto
      dopo una rinomina con backlink»* — cioè un difetto silenzioso protetto da
      una rete con un buco silenzioso.
- [ ] **`TriesEverything` prova sette capacità, per nome — ed erano cinque
      quando questa voce è stata scritta.** Il test
      `every_structural_capability_is_refused_by_the_same_gate`
      (`kernel/tests/invoke_command.rs`) asserisce
      `quali == vec!["create", "rename", "trash", "restore", "empty", "setting",
      "view-state"]`, e il provider che le chiama le elenca a mano (stesso file).
      La [decisione 0013](../decisions/0013-elenco-delle-capacita.md) gli
      attribuisce un'altra proprietà: *«un test che le prova tutte in fila
      proprio per accorgersi di quella che un giorno qualcuno aggiungesse senza
      pensarci»*. Quella proprietà il test non ce l'ha: nota se una delle sette
      **smette** di essere rifiutata, non se ne compare un'ottava. **Le due che
      sono entrate lo dimostrano**: `setting` è arrivata con la
      [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) e `view-state`
      con la [0037](../decisions/0037-lo-stato-di-vista.md), e sono state
      aggiunte a mano da chi scriveva quelle decisioni — cioè per attenzione, che
      è precisamente ciò che questa voce dice di non voler più dover spendere.
      Nel frattempo questa riga ha continuato a dire «cinque»: il presidio non è
      diventato rosso, e **nemmeno la voce che lo accusa di non diventarlo**.
- [ ] **Il posto in cui la sesta sbaglierebbe era `ReadOnlyHost`, e non c'è
      più.** Era scritto metodo per metodo — dodici metodi delegavano a
      `ReadHost`, dieci negavano e due facevano da sé — e aggiungerne una copiando la riga sbagliata
      (la delega invece del rifiuto) avrebbe prodotto **un dry-run che scrive**,
      cioè il buco esatto che la [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md)
      ha chiuso, in un punto in cui il chiamante si sta fidando. Il §7.1
      argomentava il `Guard<H, P: Policy>` sul **costo**; questa voce gli ha
      dato la seconda ragione, che è più forte e che la
      [decisione 0021](../decisions/0021-il-confine.md) ha adottato: con un
      wrapper il default è *rifiuta*, con un'impl scritta a mano il default è
      *quello che hai battuto*. Resta la parte di questa voce che riguarda
      l'elenco delle cinque capacità provate in fila.
- [x] **E ce n'è un terzo che si spegne da solo, trovato facendolo girare.**
      `.github/scripts/check-doc-links.mjs` — il presidio che la [decisione 0014](../decisions/0014-i-verbali-fuori-da-todo.md) ha aggiunto
      perché «una promessa senza presidio meccanico decade» — salta ogni cartella
      che contenga un `.fubmd/`, per non trattare un vault come
      documentazione. La regola è giusta e la conseguenza no: basta aprire una
      volta `docs/` come vault (cioè fare dogfooding, che è la cosa che questo
      progetto chiede di fare) perché il controllo passi da **68 file e 718 link
      a 9 file e 17 link**, e stampi «0 rotti» in entrambi i casi. In CI non
      succede — la cartella è ignorata da git — quindi il degrado è locale, il
      che lo rende peggiore: è la macchina di chi sta scrivendo i documenti a
      smettere di controllarli. Il numero di file *è* il segnale, e nessuno lo
      legge; il minimo è che saltare un albero sia una **riga in uscita** e non
      una sottrazione dal totale.
      **Fatto**, e con la causa invece del solo sintomo: la regola del vault
      resta — le note di qualcuno non sono documentazione del repo — ma non si
      applica a una cartella in cui **git tiene dei `.md`**, che è la
      distinzione che il solo marcatore non sa fare (`docs/` è tracciata,
      `VaultProva/` è ignorata: non serviva indovinarlo). Ogni albero saltato è
      una riga in uscita, e **zero file controllati esce rosso** invece di
      stampare «0 rotti». Senza git — fuori da un checkout — si torna alla
      regola di prima e lo si dice in una riga, invece di saltare in silenzio.
      Oggi: **127 file, 2284 link**, e `VaultProva/` nominata mentre viene
      saltata. Questa riga diceva «81 file, 1105 link», poi «122 file, 2155
      link», poi «125 file, 2231 link», ed è la **sesta** volta in questa sola
      voce che un numero scritto a mano si è ritrovato falso — le ultime due a
      **un giorno** di distanza l'una dall'altra, perché un numero che conta i
      documenti cambia ogni volta che si scrive un verbale. Il presidio funziona,
      la **frase che lo descrive** no; e che la si sia dovuta correggere due giri
      di fila — con la [0053](../decisions/0053-il-contratto-ha-una-sorgente.md) e
      di nuovo con la [0055](../decisions/0055-il-banco-del-lato-host.md) — è la
      misura di quanto in fretta invecchia.
- [x] **Due prove sono arrivate dalla [0053](../decisions/0053-il-contratto-ha-una-sorgente.md), in un posto che era un elenco.**
      Chiudendo il §16.4 si è scoperto che il presidio del contratto era la
      famiglia più grande di elenchi scritti a mano di tutto il repo: 174 voci su
      203 di `wit_type!` riscrivevano una stringa ricavabile
      dall'identificatore, e tutte e 26 le `enumeration_src` scrivevano un elenco
      di casi che la funzione **ricalcolava da sola** per confrontarcelo. Adesso
      la copertura è una **regola**: `fieldless_enums()` scandisce
      `fubmd-abi/src/*.rs` e prende tutti gli enum senza payload, quindi un tipo
      nuovo entra senza che nessuno se ne ricordi; e di là dal confine
      un'asserzione di **tipo** in `mirror.test.ts` verifica che
      `KernelEvent["type"]` ed `EventKind` siano lo stesso insieme, con
      `npx tsc --noEmit` a farla rispettare in CI. Sono due presidi esaustivi per
      costruzione dove prima c'erano due elenchi. **Non chiudono questa voce**:
      quelli che la voce nomina — le view ufficiali, le capacità del
      `TriesEverything` — passano dal banco del §16.2 e restano.
- [ ] **Il minimo, e sta nel banco di prova del §16.2**, che adesso **esiste**
      (`crates/fubmd-testkit`, [decisione 0055](../decisions/0055-il-banco-del-lato-host.md)):
      un inventario dei
      provider ufficiali da cui i test iterino invece di elencarli (un
      `ogni_view_ufficiale()` nel testkit, che chi aggiunge una view aggiorna
      perché è anche il posto da cui la registra — la 0055 gli ha scelto il posto
      e **non** l'ha costruito, perché costruirlo vuol dire mettere
      `fubmd-features` fra le dipendenze del banco, che è una decisione di questa
      voce e non di quella), e per le capacità la stessa
      cosa che i tipi hanno già — un `match` esaustivo, o il `Policy` della
      [decisione 0021](../decisions/0021-il-confine.md)
      che rende il rifiuto la posizione di riposo. Il criterio da portare avanti,
      che vale per ogni presidio futuro: **un presidio la cui copertura è un
      elenco scritto a mano smette di coprire senza diventare rosso**, e va detto
      accanto al presidio, o si crederà che copra.
- [ ] **La famiglia più grande non sono i presidi: è la prosa che conta i
      sorgenti**, e va presidiata qui perché è lo stesso difetto. Un giro
      dedicato ha ricontato i numeri dei documenti contro il codice, e in
      **quattro famiglie** su quante ne ha aperte li ha trovati falsi — tutti
      silenziosi: `HostApi` dichiarata di
      «ventitré metodi» in [PIANO.md](../PIANO.md) e in
      [traits.md](../architecture/traits.md) e di «trentadue» **duecento righe
      più in là nello stesso file**, mentre `abi.wit` ne ha trentaquattro; due
      `SCHEMA_VERSION` su disco dichiarati in
      [versionamento.md](../versionamento.md) con una versione più bassa di
      quella nel codice (l'anagrafe a 1 invece di 2, l'indice di ricerca a 4
      invece di 5), cioè **il numero il cui errore non si annulla**, perché è la
      promessa fatta ai file dell'utente; i conteggi del §16.2 raddoppiati; le
      cinque capacità del `TriesEverything` diventate sette. Nessuno di questi
      ha rotto un test, e ognuno è dello stesso tipo: un'**affermazione sui
      sorgenti scritta in italiano**, che nessun compilatore legge.
- [ ] **E la famiglia ha una quinta specie, peggiore delle altre quattro: il
      *limite dichiarato* che non esiste più.** Trovata chiudendo il §16.4:
      [traits.md](../architecture/traits.md) scriveva «limite dichiarato:
      l'**ordine** dei casi di un variant è confrontato con l'ordine in cui il
      test li elenca, non con quello dell'enum Rust», ed era falsa da
      **settantacinque commit** — `rust_enum_order` è arrivata due giorni dopo
      quella frase, con la [0003](../decisions/0003-modello-del-documento.md), e
      nessuno è tornato a correggerla. Un conteggio invecchiato fa sopravvalutare
      una copertura; un limite invecchiato fa **sottovalutarla**, cioè invita a
      non fidarsi di una garanzia che c'è — o a ricostruirla altrove. È lo stesso
      difetto delle righe morte di [strozzature.md](strozzature.md), che non
      allungano il lavoro: lo **dirottano**.
- [ ] **Il presidio è a portata, e il repo ne ha già uno dello stesso genere.**
      `check-doc-links.mjs` esiste perché «una promessa senza presidio meccanico
      decade», e presidia i **link**; i **conteggi** sono la stessa promessa
      nella stessa prosa. La forma non è un linter di prosa — impossibile — ma
      un'**annotazione**: un numero che afferma qualcosa sui sorgenti si scrive
      accanto a come lo si ricava, e il presidio rifà il conto. Il conto
      meccanico esiste già per tutti e cinque i casi qui sopra: le funzioni
      delle interfacce `host-*` in `abi.wit`, i `const SCHEMA_VERSION` nei
      crate, i `fn vault(`/`fn workspace(` sotto `crates/*/tests/`, gli
      `annota(` del `TriesEverything`. **Ciò che manca non è il conto: è il
      posto in cui scriverlo una volta e leggerlo da due parti** — che è la
      stessa forma del `rules_mirror.rs` → `rules-samples.json` della
      [decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md), applicata
      alla prosa invece che alle regole.
- [ ] **E c'è una seconda metà che i conteggi non coprono: gli elenchi che
      rimandano.** [strozzature.md](strozzature.md) è l'indice inverso — si entra
      da un capitolo di FEATURES per sapere *cosa manca* — e una sua riga
      invecchia quando qualcosa si chiude **altrove**, cioè in un file che chi
      chiude non sta guardando. Lo stesso giro ne ha trovate **diciassette** che
      il codice smentiva — su ottantasette, cioè una riga su cinque: le barrate
      del file sono passate da ventinove a quarantasei in un pomeriggio, senza
      che si chiudesse niente. Non è nuovo: la [leva](leva.md) racconta già la riga
      «nessun `^block-id`» falsa da undici verbali, e un'altra ha detto «`views()`
      è un elenco statico» per trentaquattro. Qui il presidio meccanico è più
      difficile — la riga è un giudizio, non un conteggio — ma il **collegamento**
      no: una riga di strozzature che nomina un `§X.Y` chiuso, o un simbolo che
      non esiste più nei sorgenti, è verificabile esattamente come un link rotto.
      Che è precisamente ciò che questo presidio già fa, un livello più in giù.

*Sblocca:* 27.4 (plugin sandbox test, security test, upgrade migration test),
27.3 (plugin linting, test utilities), 20.3 (permission revocation, crash
isolation) — e rende vere due proprietà che oggi due verbali dichiarano già.
