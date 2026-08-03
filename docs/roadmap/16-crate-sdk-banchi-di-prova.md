# 16. I crate, l'SDK, i banchi di prova

Una **seduta** della [roadmap infrastrutturale](../todo.md): i banchi e i confini fra crate, **prima** di ciò che li moltiplica.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Delle sette voci con cui questa seduta è nata ne resta **una**: il secondo tempo
della 16.3, cioè il confine fra crate, che è fuori con una condizione e non con
una scadenza — e da oggi quella condizione la **valuta un banco** invece di
starsene scritta in italiano ([decisione 0073](../decisions/0073-una-condizione-che-nessuno-valuta.md)),
che è l'ultima cosa successa in questa seduta e non chiude niente. La 16.8 — il
presidio sulla prosa, nata qui — è chiusa dalla
[decisione 0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md),
ed è l'ultima ad andarsene. Le precedenze che la seduta dichiarava sono tutte
**decadute**, e vale la pena dire come, perché due sono decadute insieme alla
voce e una si è rivelata falsa.

La precedenza dura del sesto giro — **16.2 prima di 16.3**, o i venti bundle di
21.2 si portano dietro venti copie del banco di prova — è **soddisfatta**: la
16.2 è chiusa dalla [decisione 0055](../decisions/0055-il-banco-del-lato-host.md).
La 16.4 prima delle P0 del terzo giro è decaduta con la voce
([0053](../decisions/0053-il-contratto-ha-una-sorgente.md), che ha chiuso la 16.4
con la 16.5 come la seduta chiedeva). E la 16.6 dopo la 5.4 era già soddisfatta
quando è stata presa.

Il cappello diceva anche che 16.1 e 16.2 erano due banchi **diversi**, e che non
potevano stare nello stesso crate perché «`fub-kernel` nel grafo dell'SDK
violerebbe l'invariante che `dependency_invariant.rs` presidia». La conclusione
regge — le due voci sono chiuse da due verbali, la
[0054](../decisions/0054-il-banco-del-lato-provider.md) e la
[0055](../decisions/0055-il-banco-del-lato-host.md) — ma **la ragione era
falsa**: quel file non nominava `fub-sdk` da nessuna parte. L'invariante c'era
nelle intenzioni e non nel test, e adesso c'è in tutti e due. La ragione vera è
più stretta di quella che il cappello dava: `fub-sdk` è dipendenza **normale**
di `fub-format-markdown` **oggi**, quindi il kernel là dentro non finirebbe nel
grafo di un futuro guest — finirebbe nella libreria di un provider che esiste.

Ed è il primo caso in cui un cappello di seduta ha dichiarato in anticipo una
**separazione** invece di un accorpamento: la 0053 aveva inaugurato la forma, e
queste due mostrano che la stessa forma può concludere all'opposto. Il criterio
sta nel [README delle decisioni](../decisions/README.md).

## Le due voci che si ponevano la stessa domanda, e la risposta che le ha divise

La 16.6 e la 16.7 sono state prese insieme, e il primo lavoro è stato stabilire
se fossero la stessa voce. Il §16.7 accusava gli elenchi scritti a mano; il §16.6
proponeva come soluzione **un elenco scritto a mano**. Non era una contraddizione:
sono la stessa frase in due posizioni logiche **opposte**.

- Un elenco da cui un test **itera** non nota le aggiunte: l'insieme vero vive
  altrove, e nessuno confronta le due cose. È il difetto del §16.7.
- Un elenco con cui un test **asserisce un'uguaglianza** non può che notarle. È
  l'allowlist del §16.6, cioè lo stesso difetto già risolto — per una superficie
  sola.

Il criterio che sceglie la forma è uno: **la produzione può leggere l'elenco?**
Se sì, l'elenco smette di essere una copia e diventa la **sorgente** da cui la
cosa esiste; se no — `tauri::generate_handler!` prende identificatori a compile
time e non itera niente — resta una copia, e va confrontata. Stessa tassonomia,
due risposte: un confine, quindi due verbali, per il criterio che la
[0055](../decisions/0055-il-banco-del-lato-host.md) ha fissato.

Le due decisioni sono la [0056](../decisions/0056-un-elenco-che-e-la-sorgente.md)
(l'inventario delle feature ufficiali, e le capacità) e la
[0057](../decisions/0057-la-dieta-dell-ipc.md) (l'allowlist della superficie
IPC). La 0056 lascia dietro di sé la **16.8**, qui sotto, ed è una separazione
dichiarata guardando le voci insieme, come la seduta chiede.

### 16.3 Un crate per bundle di feature

*ex §4.7 · presidi · **P1** · **in due tempi**: il primo è **chiuso** dalla [decisione 0071](../decisions/0071-una-feature-si-spegne-dove-si-dichiara.md), il secondo resta*

- [x] **`fub-features` era un crate solo**: tantivy era dipendenza dell'intero
      crate, quindi compilare il pannello outline compilava un motore di ricerca.
      Con i moduli di 21.2 (FubTasks, FubDB, FubCanvas, FubCalendar, FubAI,
      FubMaps…) diventa un monolite con il grafo di dipendenze di venti feature,
      non disattivabile a compile time e senza confini contro l'accoppiamento
      feature↔feature — l'invariante "una feature ufficiale è ciò che scriverà un
      plugin" resterebbe vera nel documento e falsa nel `Cargo.toml`.
- [x] **Primo tempo: una cargo feature per bundle, con tantivy dietro la sua.**
      Fatto ([0071](../decisions/0071-una-feature-si-spegne-dove-si-dichiara.md)):
      otto cargo feature omonime dei moduli, `default` che le accende tutte,
      `tantivy` `optional` dietro `search`. Il guadagno promesso è arrivato
      intero, e adesso è un numero: il grafo delle dipendenze di `fub-features`
      passa da **120 crate a 26** compilando la sola `outline`. `fub-host` le
      inoltra una per una; `fub-app` no, perché l'app che spediamo è la build
      piena. CI compila tre configurazioni parziali con `build` e non con `test`
      — la domanda è se compila, non se funziona, e il `cargo test --workspace`
      da solo non se ne accorgerebbe mai.
- [x] **Il cliente arrivato dalla
      [0056](../decisions/0056-un-elenco-che-e-la-sorgente.md)**: l'inventario
      delle feature ufficiali è il posto da cui la cargo feature si legge, perché
      è già l'elenco di *cosa esiste* — e una riga che sparisce dietro un
      `#[cfg]` sparisce da lì. È così: il `#[cfg]` sta sulla **riga**
      dell'inventario e non solo sul `pub mod`, quindi non esiste una build in
      cui l'elenco prometta un bundle che nessuno ha compilato.
      `tests/le_cargo_feature.rs` confronta i due elenchi **senza una tabella di
      corrispondenza**: l'id è `fub.<nome del modulo>` e la cargo feature ha il
      nome del modulo, quindi si calcola.
- [ ] **Secondo tempo: lo split in crate.** Resta, ed è l'unica forma che compra
      il **confine contro l'accoppiamento feature↔feature**, perché dentro un
      crate solo `pub(crate)` lascia passare tutto. È giustificato dai venti
      moduli di 21.2 — che oggi non esistono: i moduli di feature sono
      dieci [conta: moduli-di-feature], e non si citano fra loro: l'unico
      riferimento incrociato nei sorgenti è un link di documentazione a
      `backlinks::catalog`.
      Farlo adesso significa pagare venti `Cargo.toml` per dieci moduli che non si
      parlano; farlo mai significa scoprire l'accoppiamento quando districarlo
      costa venti volte tanto. **La condizione che lo sblocca è scritta e non è
      una data**: il primo import fra due moduli di feature che non sia un link
      di documentazione. Il primo tempo non anticipa niente di questo — la cargo
      feature per bundle è ciò da cui uno split partirebbe comunque.
- [x] **E la condizione la valuta qualcuno**, dalla
      [decisione 0073](../decisions/0073-una-condizione-che-nessuno-valuta.md):
      `crates/fub-features/tests/i_moduli_non_si_parlano.rs` chiede che nessun
      modulo di feature nomini `crate::`, e quando è rosso non accusa chi ha
      scritto — dice che **questa voce si è sbloccata** e la consegna da leggere.
      Serviva perché una condizione che vive solo in italiano è una scadenza che
      non arriva mai: il momento in cui scade è quello in cui nessuno la guarda.
      Il confine del compilatore, che il primo tempo aveva regalato, copre solo
      metà del caso — nella build della sola `outline` un `use crate::search`
      non compila, ma la riparazione che quell'errore suggerisce è mettergli
      davanti un `#[cfg(feature = "search")]`, e da lì l'accoppiamento c'è e
      tutto torna verde. La forma che evade il confine è quella attenta, ed è il
      confine stesso a insegnarla; per questo la domanda si pone ai sorgenti,
      cioè prima del `cfg`. Un modulo condiviso legittimo non indebolisce la
      soglia: entra in `RADICE` con la sua ragione.

### 16.6 Dieta dell'IPC

*ex §4.2 · presidi · **chiusa** con la [0057](../decisions/0057-la-dieta-dell-ipc.md); resta una casella, ed è un numero che un test presidia*

- [x] **Test che presidia la superficie.** C'è: `crates/fub-app/tests/dieta_ipc.rs`
      estrae dal sorgente due insiemi indipendenti — i comandi *definiti* e i
      comandi *registrati* — e li confronta con un'allowlist in cui ogni riga
      porta **la ragione** per cui quel comando non poteva essere un comando del
      registro, una view o una query. Aggiungerne uno è rosso, e il messaggio
      elenca le tre alternative.
      Il numero che questa voce faceva proprio era sbagliato per la **terza**
      volta: diceva «38», ed erano **37**. Sotto c'era una trappola che vale più
      dell'errore — i conti possibili sono quattro (43 col grep sul workspace, 39
      col grep su `lib.rs`, 37 attributi veri, 37 registrati) e le sei occorrenze
      di troppo sono **prosa**, cioè `#[tauri::command]` scritto dentro un
      commento per spiegare dove una cosa stava prima. Un presidio che contasse
      la prosa morirebbe alla prima riga di documentazione: l'estrattore salta i
      commenti, e un test gli dà in pasto un sorgente finto con la trappola
      dentro.
- [x] **La riga che divide**, dalla [decisione 0013](../decisions/0013-elenco-delle-capacita.md):
      un comando fa accadere qualcosa e risponde con un messaggio e un effetto;
      ciò che risponde con **dati** non può essere un comando. Applicata ai 37,
      ha prodotto **sei** categorie e non tre — fra cui *la porta è una
      credenziale*, che salva sei comandi da una migrazione sbagliata (`set_setting`
      non poteva essere `settings.set`: sono due autorità, non due strade).
- [ ] **Migrare i bespoke che restano — e adesso sono due.** ~~cestino (4)~~,
      ~~organizzazione (2)~~ e ~~grafo (1)~~ erano già fatti; il grafo lo era **da
      prima**, con la [0019](../decisions/0019-il-canale-dati.md), e questa riga
      non se n'era accorta. ~~Il versioning (3)~~ se n'è andato con la
      [0075](../decisions/0075-una-view-non-chiede-con-una-finestra.md), e non
      come questa riga si aspettava: `restore_version` è diventato davvero un
      comando del registro (`version.restore`), ma `list_versions` e
      `read_version` **non sono migrate a `IndexQuery`** — sono sparite, perché
      chi le chiamava era il pannello cronologia di questa shell, che adesso è un
      `ViewProvider` della feature versioning e legge dal proprio spazio dati.
      Davanti a un bespoke la prima domanda non è *su che canale lo sposto*: è
      **chi lo chiama, e da che parte del confine dovrebbe stare**.
      Restano i **due che nessuno nominava**: `render_preview` e
      `render_embed`, che rispondono con dati e per cui un `ViewProvider` non ha
      nessuna porta mentre la shell ce l'ha. Il criterio per farlo è deciso,
      quindi è lavoro; ma chi lo prende deve porre una domanda di firma che qui
      non si poteva porre — rendere passa dal confine di fiducia, e portarne
      l'HTML su un canale che anche un plugin di comunità può chiamare va deciso
      lì. **Il residuo non vive più in questa riga**: è
      `il_debito_dichiarato_e_un_numero_presidiato`, e migrarne uno costringe a toccare il
      numero.

### 16.8 La prosa che conta i sorgenti non ha nessun presidio

*ottavo giro · presidi · **P1** — separata dalla 16.7 dalla [decisione 0056](../decisions/0056-un-elenco-che-e-la-sorgente.md) · **chiusa** dalla [decisione 0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md)*

Questa voce era la seconda metà del §16.7, e ne è stata staccata chiudendolo. La
ragione è quella con cui la [0053](../decisions/0053-il-contratto-ha-una-sorgente.md)
ne aveva accorpate due, letta al contrario: è lo stesso **difetto** — un elenco
che smette di dire il vero senza diventare rosso — ma non lo stesso **presidio**.
Ciò che la 0056 ha chiuso sono insiemi che un test può estrarre dai sorgenti; ciò
che resta qui è un'**affermazione scritta in italiano dentro un documento**, che
nessun compilatore legge. Deciderle insieme avrebbe voluto dire decidere due volte
la forma dell'annotazione, la seconda contro la prima.

- [x] **La famiglia più grande non sono i presidi: è la prosa che conta i
      sorgenti.** Un giro dedicato ha ricontato i numeri dei documenti contro il
      codice, e in **quattro famiglie** li ha trovati falsi — tutti silenziosi:
      `HostApi` dichiarata di «ventitré metodi» in [PIANO.md](../PIANO.md) e in
      [traits.md](../architecture/traits.md) e di «trentadue» **duecento righe
      più in là nello stesso file**, mentre `abi.wit` ne ha trentaquattro; due
      `SCHEMA_VERSION` su disco dichiarati in
      [versionamento.md](../versionamento.md) con una versione più bassa di
      quella nel codice (l'anagrafe a 1 invece di 2, l'indice di ricerca a 4
      invece di 5), cioè **il numero il cui errore non si annulla**, perché è la
      promessa fatta ai file dell'utente; i conteggi del §16.2 raddoppiati; le
      cinque capacità del `TriesEverything` diventate sette. Nessuno di questi
      ha rotto un test, e ognuno è dello stesso tipo.
- [x] **E chiudere la 16.7 ne ha trovate altre quattro in mezza giornata**, che è
      la misura di quanto la famiglia sia fitta
      ([0056](../decisions/0056-un-elenco-che-e-la-sorgente.md)): `guard.rs` dice
      «**dieci** famiglie» in **tre** punti dove ne ha quattordici — e cinque
      righe sopra il primo c'è un doc-comment che dice «quattordici» giusto; la
      [0013](../decisions/0013-elenco-delle-capacita.md) e
      [plugin-boundary.md](../architecture/plugin-boundary.md) dicono «tutte e
      **sei** le strutturali» e poi ne elencano cinque, che è quanti metodi ha
      `VaultStructure`; e lo stesso documento sbaglia **la portata** più del
      numero, perché il varco nega sette famiglie e lui ne nomina una. Da tenere
      per disegnare il presidio: la prima sta nello **stesso file** del codice che
      descrive, quindi la distanza fra la frase e la cosa non è la ragione per cui
      invecchia — e un'annotazione che vale solo per i `.md` ne mancherebbe metà.
- [x] **E c'è una quinta specie, che non è un conteggio: il numero di riga.**
      [glossario.md](../glossario.md) ancora un file di codice **e una riga**
      (`abi/event.rs:253`), e quella riga invecchia a ogni commit che aggiunge
      qualcosa più in alto nel file — cioè senza che nessuno tocchi né la voce né
      la cosa che nomina. La [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md)
      ne ha spostate cinque in un colpo solo facendo crescere `event.rs` di
      duecento righe, e tre delle cinque erano **giuste** fino a quel commit; una
      quarta era sbagliata da prima e nessuno se n'era accorto. È la specie
      peggiore da presidiare a mano e la più facile da presidiare a macchina —
      il link c'è già, gli manca solo di verificare che a quella riga ci sia
      ancora ciò che la voce nomina — ed è l'unica di questa voce che
      `check-doc-links.mjs` **quasi** copre: controlla che il file esista, non
      che la riga dica ancora la stessa cosa.
- [x] **E la mezza voce del §17.1 ne ha trovate altre due**
      ([0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md)), che insieme
      dicono una cosa che le otto di sopra non dicevano. La prima è nella
      [0054](../decisions/0054-il-banco-del-lato-provider.md): «un terzo crate per
      **otto** funzioni», e una tabella che ne elencava otto, dove
      `grep -c "^pub fn " crates/fub-sdk/src/testing/conformita.rs` oggi ne
      conta **ventitré** — ma il punto non è lo scarto, è che ne contava
      **quattordici già nel commit che scriveva «otto»**. Non un numero
      invecchiato: un numero che **nessuno ha mai ricavato dalla sua sorgente**, e
      la differenza decide la riparazione, perché uno invecchiato si aggiorna e
      uno senza sorgente si aggiorna e torna falso al giro dopo. La seconda è il
      numero della riga in fondo a questa voce, per la **nona** volta — e le due
      insieme mostrano che il caso «falso il giorno in cui è stato scritto», che
      la settima occorrenza di quel numero aveva inaugurato, non era un incidente:
      è ciò che succede **ogni volta** che un conteggio si scrive a mano nello
      stesso commit che cambia ciò che conta. Da tenere per disegnare il presidio:
      un'annotazione che rifà il conto solo *dopo*, in CI, arriverebbe comunque
      prima di chi legge — nessuno di questi due numeri è stato letto da qualcuno
      prima che il presidio lo ricontasse a mano.
- [x] **E un giro di verifica fatto chiudendo quella mezza voce ne ha trovate
      altre cinque, più un bersaglio nuovo.** Non sono riparate lì — sono il
      lavoro di questa voce — e stanno scritte col comando accanto perché chi la
      prende le trovi. `crates/fub-abi/wit/fub/abi.wit` è **3400 righe di cui
      1697 di commento** dove la [0053](../decisions/0053-il-contratto-ha-una-sorgente.md)
      e [M4](../milestones/M4-wit-hardening.md) dicono 3386 e 1683 (`wc -l`,
      `grep -cE '^\s*//'`) — e lo stesso criterio dà i numeri vecchi *esatti* al
      commit della 0053, quindi il conto era giusto e la prosa è invecchiata di
      quattordici righe di commento; il contratto in Rust è **18 058** righe e la
      0053 dice 17 150; i `console.warn`/`console.error` della shell sono
      **quindici** e non quattordici ([0052](../decisions/0052-cio-che-va-storto-e-un-evento.md),
      [leva](leva.md)), col criterio che la 0052 stessa dichiara; e
      [plugin-boundary.md](../architecture/plugin-boundary.md) nomina
      `safety::notifying` come se esistesse, descrivendolo come «una riga su
      stderr» — si chiama **`reporting`** e *restituisce* il panico invece di
      stamparlo, che è precisamente ciò che la 0052 ha cambiato: **sesta specie**,
      smentita da un verbale a due file di distanza.
- [x] **Il bersaglio nuovo è meccanico, ed è a portata di un presidio che c'è
      già**: **quindici** link della forma `[file.rs:N](…)` portano un numero di
      riga stantio — sei in [data-model.md](../architecture/data-model.md)
      (sfalsati tutti di **+44**, cioè `model.rs` è cresciuto sopra quel punto),
      cinque in [traits.md](../architecture/traits.md), quattro in
      plugin-boundary.md. `check-doc-links.mjs` valida **il file** e non il `:N`,
      quindi questa è la prima famiglia di questa voce che non chiede
      un'annotazione nuova: chiede di leggere due caratteri in più in un link che
      il presidio già apre. I sei di `data-model.md` sono corretti nel giro della
      mezza voce del §17.1, perché quel file era già aperto; gli altri nove no, e
      sono qui. Da tenere per il disegno: un numero di riga è la sola specie di
      questo elenco che **non** ha bisogno che qualcuno dichiari come si ricava.
- [x] **E ci sono due specie peggiori dei numeri.** La **quinta**: il *limite
      dichiarato* che non esiste più — [traits.md](../architecture/traits.md)
      scriveva «limite dichiarato: l'**ordine** dei casi di un variant è
      confrontato con l'ordine in cui il test li elenca, non con quello dell'enum
      Rust», ed era falsa da **settantacinque commit**. Un conteggio invecchiato
      fa sopravvalutare una copertura; un limite invecchiato la fa
      **sottovalutare**, cioè invita a non fidarsi di una garanzia che c'è — o a
      ricostruirla altrove. La **sesta**, che le batte tutte: la *garanzia
      dichiarata* che non è mai esistita — il cappello di questa seduta diceva
      che il kernel dentro l'SDK «violerebbe l'invariante che
      `dependency_invariant.rs` presidia», e quel file non nominava `fub-sdk`
      da nessuna parte ([0054](../decisions/0054-il-banco-del-lato-provider.md),
      che l'ha scritto). Le prime cinque riguardano una **descrizione**
      invecchiata di qualcosa che esiste; questa no — non c'è niente da
      aggiornare, perché non c'è mai stato niente. E nessuno se ne accorge,
      perché **il motivo per cui si scrive una garanzia è smettere di doverci
      pensare**: un conteggio qualcuno prima o poi lo ricontrolla, una rete che
      si crede tesa non la guarda nessuno.
- [x] **Il presidio è a portata, e il repo ne ha già uno dello stesso genere.**
      `check-doc-links.mjs` esiste perché «una promessa senza presidio meccanico
      decade», e presidia i **link**; i **conteggi** sono la stessa promessa
      nella stessa prosa. La forma non è un linter di prosa — impossibile — ma
      un'**annotazione**: un numero che afferma qualcosa sui sorgenti si scrive
      accanto a come lo si ricava, e il presidio rifà il conto. Il conto
      meccanico esiste già per ognuno dei casi qui sopra: le funzioni delle
      quattordici interfacce `host-*` in `abi.wit` (**34**, ricontate chiudendo
      la 16.7 e giuste in [traits.md](../architecture/traits.md)), i
      `const SCHEMA_VERSION` nei crate, i `fn vault(`/`fn workspace(` sotto
      `crates/*/tests/`. **Ciò che manca non è il conto: è il posto in cui
      scriverlo una volta e leggerlo da due parti** — che è la stessa forma del
      `rules_mirror.rs` → `rules-samples.json` della
      [decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md),
      applicata alla prosa invece che alle regole.
- [x] **E per la sesta specie il presidio è lo stesso, letto al contrario**: non
      «rifai il conto», ma **una frase che dice *questo è presidiato da X* deve
      nominare un X che esiste** — e `X` è un nome di test, cioè una cosa che si
      può cercare meccanicamente. Il primo posto in cui girerebbe è il cappello di
      ogni seduta, che è dove la garanzia inesistente è stata trovata.
- [x] **E c'è una seconda metà che i conteggi non coprono: gli elenchi che
      rimandano.** [strozzature.md](strozzature.md) è l'indice inverso — si entra
      da un capitolo di FEATURES per sapere *cosa manca* — e una sua riga
      invecchia quando qualcosa si chiude **altrove**, cioè in un file che chi
      chiude non sta guardando. Un giro ne ha trovate **diciassette** che il
      codice smentiva — su ottantasette, cioè una riga su cinque: le barrate del
      file sono passate da ventinove a quarantasei in un pomeriggio, senza che si
      chiudesse niente. Non è nuovo: la [leva](leva.md) racconta già la riga
      «nessun `^block-id`» falsa da undici verbali, e un'altra ha detto «`views()`
      è un elenco statico» per trentaquattro. Qui il presidio meccanico è più
      difficile — la riga è un giudizio, non un conteggio — ma il **collegamento**
      no: una riga di strozzature che nomina un `§X.Y` chiuso, o un simbolo che
      non esiste più nei sorgenti, è verificabile esattamente come un link rotto.
      Che è precisamente ciò che questo presidio già fa, un livello più in giù.
- [x] **Il terzo presidio che si spegneva da solo è già chiuso.**
      `.github/scripts/check-doc-links.mjs` saltava ogni cartella con un
      `.fub/` dentro, e bastava aprire `docs/` come vault perché il controllo
      passasse da **68 file e 718 link a 9 file e 17 link** stampando «0 rotti»
      in entrambi i casi. **Fatto**, e con la causa invece del solo sintomo: la
      regola del vault resta ma non si applica a una cartella in cui **git tiene
      dei `.md`**; ogni albero saltato è una riga in uscita; **zero file
      controllati esce rosso**. Oggi: **145 file, 2965 link**, più 123 numeri
      di riga verificati dalla [0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md).
      Questa riga ha detto, in fila: «81 file, 1105 link», «122 file, 2155»,
      «125 file, 2231», «127 file, 2284», «129 file, 2336», «132 file, 2464»,
      «132 file, 2475», «134 file, 2553». La correzione di oggi è la **nona**,
      e ha la causa più semplice di tutte: **il commit che chiude la §16.8 aggiunge
      prosa**, cioè un verbale e le righe che lo linkano. Chiudere la voce che
      presidia i conteggi ha falsificato il conteggio che la voce non presidia —
      il che non è un'ironia, è il criterio funzionante: questo numero sta fuori
      dal registro *proprio perché* si muove così — e infatti la prima stesura di
      questa riga diceva 2964 ed era falsa di uno prima di essere salvata, perché
      il link alla 0072 due righe più su l'ha invecchiata mentre la si scriveva:
      la quinta specie, colta in diretta per la seconda volta —, e resta scritto a mano nel
      solo posto che tiene anche il conto delle sue falsificazioni.
      La correzione precedente era l'**ottava**, e stavolta il numero
      si ricostruisce: sono i valori che `git log -- questo file` restituisce, uno
      per riscrittura. L'ordinale che c'era prima diceva «nona» e poi «decima» e non
      si ricostruiva da niente — con cinque valori elencati e nove falsificazioni
      dichiarate, mancava un elenco all'appello, ed era il sesto: «132 file, 2464
      link». Che il presidio della prosa non presidiasse **il conteggio delle volte
      in cui questa prosa è stata falsa** è la cosa più circolare che questa voce
      abbia prodotto, ed è scritta qui perché non torni.
      Delle ultime quattro, tre cause diverse e una che si ripete. La quinta era
      falsa **nel commit stesso che la scriveva**: la riga diceva 2284 e il
      controllo ne contava già 2285, cioè il numero è invecchiato fra il momento in
      cui è stato misurato e quello in cui è stato scritto. La sesta e la settima
      hanno una causa esterna alla riga — dei verbali nuovi e i loro rimandi, che in
      un pomeriggio hanno portato 2285 a 2336 e poi a 2475. L'ottava, questa, ne
      aggiunge una specie nuova e peggiore: **la riga era già falsa senza che
      nessuno l'avesse toccata.** A HEAD dichiarava 2475 e il controllo ne contava
      **2468**: il rename di `21c3562` e la ripulitura di `0d85342` hanno tolto
      sette link, e nessuno dei due commit è passato da qui. Un numero che
      invecchia quando lo si scrive è un fastidio; uno che invecchia mentre nessuno
      lo guarda è la voce.
      E c'è una coda che vale la pena: il conteggio dei **file** dipende anche da
      cosa c'è nell'albero di lavoro. Lo script cammina il disco e non
      `git ls-files`, quindi un `.md` di appunti non tracciato in radice fa 134
      invece di 133. Il valore scritto qui è quello che vede un clone pulito, che è
      l'unico che possa valere qualcosa.
      Il presidio funziona, la **frase che lo descrive** no — e non perché nessuno
      la guardi, ma perché un numero che conta i documenti di un repo che documenta
      sé stesso non ha un valore fermo abbastanza a lungo da poter essere scritto a
      mano. È l'argomento più corto a favore di questa voce, ed è stato prodotto
      scrivendola — quattro volte su otto.

**Chiusa dalla [0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md).**
La forma è quella che questa voce chiedeva: `.github/scripts/conteggi.mjs` tiene
**i comandi e non i valori** — un nome, il comando che ricava il numero dai
sorgenti, la ragione per cui quel numero conta — e `check-prosa.mjs` rifà il
conto e lo confronta con ogni riga che lo cita per nome, nei `.md` **e nei
commenti del codice**, perché la prima falsità del censimento stava dentro
`guard.rs`. Le due direzioni tutte e due le volte: un numero che cambia nel
codice è rosso, e una voce che nessuno cita più è rossa anche lei. Il secondo
controllo è la sesta specie letta al contrario — una frase che dice «presidiato
da X» deve nominare un `fn` o un file di test che esiste — e il terzo è il
bersaglio meccanico: `check-doc-links.mjs` legge il `:N` e chiede che a quella
riga ci sia ancora il nome che la voce scrive lì accanto.

Cosa ha trovato accendendosi, che è la misura di quanto la famiglia fosse fitta:
gli `SCHEMA_VERSION` su disco dichiarati **sette** e sono otto — il numero il cui
errore non si annulla, di nuovo lui; i messaggi alla console della shell dati per
quattordici e risaliti a **sedici**, cioè un numero che deve scendere e che
nessuno guardava salire; le righe di commento di `abi.wit` ferme a 1683 su 3386
quando sono 1758 su 3502; `safety::notifying` che non esiste e non è mai esistito
sotto quel nome; e i numeri di riga stantii, stimati **quindici** e contati
**cinquantuno** — di cui 49 riparati leggendo il numero che il presidio stesso
stampava, e due che erano la specie senza riparazione meccanica.

Tre cose che il disegno ha deciso e che non vanno ridiscusse senza motivo stanno
nel verbale: il registro tiene i comandi perché un valore scritto a mano
tornerebbe falso al giro dopo; il numero sta sulla **stessa riga**
dell'annotazione, e il presidio l'ha subito dimostrato segnalando tre
annotazioni andate a capo mentre le si scriveva; e **un verbale non si
presidia**, perché è prosa datata — è la sola regola sotto cui la 0053 e la 0060
possono raccontare un nome che è cambiato.

Resta fuori, con la sua ragione, la seconda metà: gli **elenchi che rimandano**.
Una riga di [strozzature.md](strozzature.md) invecchia quando qualcosa si chiude
altrove, e il giudizio che porta non è un conteggio — il presidio giusto chiede
prima di decidere cosa significhi «chiusa» per una strozzatura. E resta fuori il
numero di questa riga qui sotto, che **non** è entrato nel registro: dipende
anche da cosa c'è nell'albero di lavoro, e un numero che cambia per un `.md` non
tracciato in radice non è una promessa che valga la pena presidiare. Quel numero
continua a vivere in una riga sola, la casella del §16.7 qui sopra, che lo tiene
insieme all'elenco delle volte in cui è stato falso — ed è l'unico posto del repo
in cui una famiglia di prosa falsa si racconta da sé. Il controllo dice anche
quanti dei suoi link portano un numero di riga e quanti di quelli non hanno un
nome accanto da cercare: quei secondi il presidio li **dice**, invece di far
finta di averli guardati.

*Sblocca:* 27.4 (plugin sandbox test, security test, upgrade migration test),
27.3 (plugin linting, test utilities), 20.3 (permission revocation, crash
isolation).
