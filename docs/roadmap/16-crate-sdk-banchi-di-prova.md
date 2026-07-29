# 16. I crate, l'SDK, i banchi di prova

Una **seduta** della [roadmap infrastrutturale](../todo.md): i banchi e i confini fra crate, **prima** di ciò che li moltiplica.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Precedenza dura dal sesto giro: **16.2 prima di 16.3**, o i venti bundle di
21.2 si portano dietro venti copie del banco di prova. E 16.1 e 16.2 sono due
banchi **diversi** — l'SDK è il lato *provider* (provare un provider contro il
contratto), il testkit è il lato *host* (costruire un vault, registrare un
provider minimo, asserire su cosa è stato emesso) — che non possono stare nello
stesso crate: `fubmd-kernel` nel grafo dell'SDK violerebbe l'invariante che
`dependency_invariant.rs` presidia.

La 16.4 va **prima** delle P0 del terzo giro, o quelle si scrivono quattro volte;
la 16.6 va **dopo** la 5.4, o l'allowlist si trova a dire di no a feature che non
hanno altra strada.

E la **16.5 non è una voce autonoma**: è la gamba TS della domanda che pone la
16.4. Decidere «da cosa si genera il mirror» separatamente da «da cosa si
generano WIT e arena» significa decidere due volte la stessa cosa, e la seconda
volta contro la prima. Sta ancora sotto il suo numero perché i numeri non si
ritirano finché una decisione non li chiude, ma si legge **dentro** la 16.4.

Il settimo giro ha aggiunto la 16.7, che sta qui e non fra i presidi della
[seduta 17](17-presidi-che-restano.md) perché ciò che le manca è esattamente il
banco della 16.2: un elenco dei provider ufficiali da cui un test possa
**iterare** invece di ricopiarlo.

### 16.1 L'SDK come superficie di riuso — oggi è quasi vuoto

*ex §4.6 · presidi · **P1** — il lato **provider***

- [ ] **`fubmd-sdk` contiene un re-export e `scan`**, e il pezzo che conta sta
      altrove: il `MemoryHost` — l'unico modo di provare un provider **contro il
      contratto** invece che contro il kernel — è `#[cfg(test)] mod testing`
      dentro `fubmd-features` (`features/src/lib.rs`). Nessun autore di
      plugin, e nemmeno un futuro modulo FubSuite in un crate a parte, può
      usarlo.
- [ ] **Promuoverlo a `fubmd-sdk::testing`** insieme a ciò che ogni provider
      riscriverebbe: costruttori di `UiNode`, parsing degli `ActionId`, e una
      **conformance suite** che verifichi le proprietà che il contratto promette
      (un `IndexProvider` che non perde documenti fra `on_document_*` e `flush`;
      un `ViewProvider` che non muta durante `render_view`). È la differenza fra
      "il contratto è documentato" e "il contratto è verificabile da chi lo
      implementa".
- [ ] **Questo è il banco del lato *provider*; il lato *host* è un'altra cosa e
      sta nel §16.2** — costruire un vault, registrare un provider minimo, far
      girare un giro di eventi. Non può stare qui: l'SDK è ciò che un guest WASM
      importa, e `fubmd-kernel` nel suo grafo violerebbe l'invariante che
      `dependency_invariant.rs` presidia. Sono due crate, non due moduli.
- [ ] La duplicazione non è ipotetica: **le feature ufficiali costruiscono già
      lo stesso albero tre volte** — una lista di voci con azione, e un
      segnaposto per il vuoto (`features/src/backlinks.rs`, `outline.rs`,
      `tags.rs`). Su tre provider è una convenzione; su venti moduli Suite è un
      dialetto per modulo. Una delle tre copie è già stata tolta di mezzo dal
      contratto e non dall'SDK: la codifica dei dati dentro l'`ActionId` — che
      ognuna aveva reinventato — non esiste più, perché ora l'azione porta un
      payload ([decisione 0016](../decisions/0016-cosa-e-una-view.md)). È un
      esempio della regola di questa voce letta al contrario: ciò che il
      contratto **non** offre viene riscritto da tutti, ed è più economico
      offrirlo che raccogliere le copie.

*Sblocca:* 27.3 (unit/e2e test utilities, template progetto plugin, type
definitions, plugin linting), 21.1 (moduli Suite con API condivise).

### 16.2 Il banco di prova del kernel è copiato diciotto volte

*ex §4.12 · presidi · **P1** — il lato **host** — va **prima** della 16.3*

- [ ] **34 helper `vault()`/`workspace()`** negli integration test e **24
      `impl FormatProvider` giocattolo**, di cui **otto** chiamati letteralmente
      `PlainProvider` in otto file diversi (`trash.rs`, `invoke_command.rs`,
      `structural_host.rs`, `provider_reentrancy.rs`, `index_feeding.rs`,
      `transfer_dispatch.rs`, `disattivazione.rs`, `la_maschera.rs`). Ogni test
      che tocca il kernel si costruisce da capo vault temporaneo, registry,
      provider minimo e asserzioni sugli eventi.
- [ ] **I numeri di questa voce sono stati ricontati due volte, e le due volte
      si sono mossi nella direzione che la peggiora.** Al primo giro erano «18
      helper, 14 provider giocattolo, di cui **tre** `PlainProvider`»; al secondo
      «16, 15, sei»; oggi sono **34, 24 e otto**. Gli helper sono **raddoppiati**
      da quando la voce è stata aperta, e i `PlainProvider` quasi triplicati — la
      duplicazione più letterale è, ogni volta, quella cresciuta di più. Il
      titolo dice ancora «diciotto» e resta com'è di proposito: l'ancora è citata
      dall'[indice](../todo.md) e altrove, e i rimandi ciechi costano più di un
      numero vecchio in un titolo. È il [§16.7](#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
      applicato a questo file — **un conteggio tenuto a mano smette di essere
      vero senza diventare rosso** — e la dimostrazione è che l'unico modo per
      cui questo se n'è accorto, due volte su due, è che qualcuno l'ha rifatto a
      mano. Fra il primo ricalcolo e il secondo il conteggio è stato falso per
      l'intera vita della voce, e in quel tempo la voce è rimasta **P1**: se il
      moltiplicatore è il criterio (la domanda 4 dell'[indice](../todo.md)), un
      moltiplicatore raddoppiato in silenzio è una priorità decisa su un numero
      che non c'è più.
- [ ] **Il §16.1 promuove `MemoryHost` e la conformance suite: è il lato
      *provider*.** Manca il lato *host* — costruire un vault, registrare un
      provider minimo, far girare un giro di eventi e asserire su cosa è stato
      emesso. Sono due banchi diversi e il §16.1 ne nomina uno solo.
- [ ] **E non può stare in `fubmd-sdk`**: l'SDK è ciò che un guest WASM importa,
      e metterci `fubmd-kernel` — foss'anche dietro una cargo feature — mette il
      kernel nel grafo delle dipendenze di chi per definizione non deve averlo
      (`dependency_invariant.rs` presidia proprio quello). Serve un crate a sé,
      `crates/fubmd-testkit`, che dipende da abi **e** kernel ed è
      dev-dependency di tutti.
- [ ] **Il moltiplicatore è il §16.3**: un crate per bundle di feature significa
      che ognuno dei venti moduli di 21.2 si porta dietro la propria copia del
      banco. Va fatto **prima** di quella divisione, non dopo.

*Sblocca:* 27.3 (unit ed e2e test utilities, template di progetto plugin), 27.4
(stress test su vault grandi, crash recovery test, upgrade migration test — che
oggi nessuno scrive perché ognuno costerebbe un banco nuovo), 4.3 (il corpus ha
bisogno di un posto da cui essere montato).

### 16.3 Un crate per bundle di feature

*ex §4.7 · presidi · **P1** — dopo la 16.2 · **in due tempi**, e il primo è piccolo*

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

### 16.4 Il contratto si scrive quattro volte a mano

*ex §4.8 · presidi · **P1** — va **prima** delle P0 del terzo giro*

- [ ] **Ogni tipo nuovo tocca quattro posti**: Rust (`fubmd-abi`), WIT
      (`crates/fubmd-abi/wit/fubmd/abi.wit`), arena (`abi/src/arena.rs`, per i tipi ricorsivi) e
      mirror TS (`frontend/src/host/contract.ts` + la fixture). Che non divergano è
      presidiato — `wit_conformance.rs` parsa il WIT e confronta nomi e tipi
      nelle due direzioni, ed è uno dei test migliori del repo — ma il presidio
      verifica il costo, non lo riduce.
- [ ] **Il conto delle P0 lo rende un collo di bottiglia, e la seduta 2 lo ha
      misurato**: venticinque specie di `UiNode` nuove (in gran parte ricorsive,
      quindi con l'arena da estendere) hanno toccato tutti e quattro i posti,
      più il campione per specie in due fixture — ed è il costo *di una sola*
      delle voci che restano, accanto a [decisione 0003](../decisions/0003-modello-del-documento.md), [decisione 0005](../decisions/0005-canale-dati-verso-le-view.md) e [decisione 0006](../decisions/0006-import-export-come-trait.md). Il §16.5 chiede
      di generare il mirror TS; la stessa domanda va posta **ora** per WIT e
      arena — generare l'uno dall'altro, o almeno gli scheletri — o la
      generazione arriverà dopo il lavoro che doveva alleggerire.
- [ ] **E la domanda è una sola, quindi la risposta va data una volta: da quale
      dei quattro si generano gli altri tre.** Il §16.5 la pone per il mirror TS
      e propone `ts-rs`/`schemars`, cioè **dai tipi Rust**. Ma la sorgente
      autorevole del contratto non è Rust: è il **WIT**, ed è già il repo a
      trattarlo così — `wit_conformance.rs` parsa il WIT e ci confronta i tipi
      Rust, non il contrario, e il WIT è ciò che a M5 un guest vede davvero. Chi
      generasse il TS da Rust mentre WIT e arena si generano dal WIT si
      ritroverebbe con **due sorgenti di verità** e un mirror che diverge dal
      contratto restando fedele all'implementazione — cioè il difetto che il
      presidio esiste per fermare, spostato di un anello. La scelta va fatta qui,
      per tutti e quattro; il §16.5 ne è la conseguenza, non una decisione
      parallela.
- [ ] **Quattro posti è il conto di un *tipo*; per una *capacità* il conto è
      un altro, ed era il §7.1**: ventiquattro metodi × quattro implementazioni
      di `HostApi` scritte a mano, cinque a M5, N con le politiche dei permessi.
      **Chiuso** con la [decisione 0021](../decisions/0021-il-confine.md): il
      rifiuto è un wrapper generico e il percorso di lettura è un tipo che le
      capacità di scrittura non le ha. E per
      una *regola* era un terzo conto ancora, il §6.2 — **chiuso** con la
      [decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md), e vale
      la pena leggerne la forma: il conto non è stato azzerato ma **presidiato**,
      con una fixture generata che tiene uguali le copie. Le tre voci sono lo
      stesso difetto misurato su tre unità diverse.

### 16.5 Mirror TS↔Rust generati, non scritti

*ex §4.1 · presidi · **P1** — **la gamba TS della 16.4**, non una decisione a parte*

- [ ] **Il problema è vero e resta**: oggi il legame fra `frontend/src/host/contract.ts` e
      i tipi del contratto è un test che confronta **campioni**, e copre i tipi
      che qualcuno si è ricordato di aggiungere alla fixture. Con 30 tipi nuovi
      in arrivo (task, proprietà, asset, comandi) non scala — ed è la stessa
      forma di difetto del [§16.7](#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione):
      una copertura che è un elenco scritto a mano.
- [ ] **Ciò che è cambiato è chi decide.** Questa voce diceva «generare il
      mirror TS del contratto (allora `api.ts`, oggi `host/contract.ts`)
      **dai tipi Rust** (`ts-rs` o `schemars`)», e quella è una risposta alla
      domanda del [§16.4](#164-il-contratto-si-scrive-quattro-volte-a-mano) —
      *da quale dei quattro posti si generano gli altri* — data guardando un
      posto solo. Il §16.4 la deve dare per tutti e quattro insieme, e la
      candidata forte è il **WIT**, che è già la sorgente che
      `wit_conformance.rs` tratta come autorevole. Se vince il WIT, `ts-rs` è lo
      strumento sbagliato: genererebbe il mirror dall'implementazione invece che
      dal contratto.
- [ ] **Quindi: nessun lavoro da avviare qui prima del §16.4.** Il numero resta
      (i numeri non si ritirano finché una decisione non li chiude) ma la
      decisione non è sua, e prendere questa voce da sola significa scegliere la
      sorgente di verità del contratto senza accorgersi di averlo fatto.

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
      Oggi: **122 file, 2155 link**, e `VaultProva/` nominata mentre viene
      saltata. Questa riga diceva «81 file, 1105 link», ed è la quarta volta in
      questa sola voce che un numero scritto a mano si è ritrovato falso: il
      presidio funziona, la **frase che lo descrive** no.
- [ ] **Il minimo, e sta nel banco di prova del §16.2**: un inventario dei
      provider ufficiali da cui i test iterino invece di elencarli (un
      `ogni_view_ufficiale()` nel testkit, che chi aggiunge una view aggiorna
      perché è anche il posto da cui la registra), e per le capacità la stessa
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
