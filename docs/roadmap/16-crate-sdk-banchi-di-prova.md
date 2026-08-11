# 16. I crate, l'SDK, i banchi di prova

Questa è una **seduta** della [roadmap infrastrutturale](../todo.md). L'argomento sono i banchi di prova e i confini fra i crate, **prima** dei moltiplicatori.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Stato delle sette voci iniziali:**
- Nessuna delle sette voci resta attiva.
- La voce 16.3 si è chiusa per ultima con la [decisione 0116](../decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md).
- Questa riga costituisce un **consuntivo**.

**Stato del secondo tempo della 16.3 (confine fra crate):**
- Il lavoro è in attesa.
- Una condizione valuta il confine tramite un banco di prova automatico invece di un testo in italiano ([decisione 0073](../decisions/0073-una-condizione-che-nessuno-valuta.md)).
- La casella resta attiva con il suo guardiano. La voce scompare.

**Stato della voce 16.8 (presidio sulla prosa):**
- È chiusa dalla [decisione 0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md).

**Stato delle precedenze dichiarate:**
Tutte le precedenze sono decadute. Due precedenze sono decadute insieme alla voce. Una precedenza si è rivelata falsa.

- **16.2 prima di 16.3 (sesto giro):** **Soddisfatta.** Evita venti copie del banco di prova per i venti bundle della 21.2. La 16.2 è chiusa dalla [decisione 0055](../decisions/0055-il-banco-del-lato-host.md).
- **16.4 prima delle P0 del terzo giro:** **Decaduta.** Decaduta insieme alla voce 16.4. La [0053](../decisions/0053-il-contratto-ha-una-sorgente.md) ha chiuso la 16.4 con la 16.5.
- **16.6 dopo la 5.4:** **Soddisfatta.** Già soddisfatta al momento della presa in carico.

**Separazione dei banchi 16.1 e 16.2:**
Il documento iniziale descriveva 16.1 e 16.2 come due banchi **diversi**. Vietava l'inclusione di entrambi nello stesso crate. La motivazione citata era la protezione dell'invariante in `dependency_invariant.rs` da parte di `fub-kernel` nel grafo dell'SDK.

La separazione è confermata. Le due voci sono chiuse da due verbali, la [0054](../decisions/0054-il-banco-del-lato-provider.md) e la [0055](../decisions/0055-il-banco-del-lato-host.md).
Tuttavia, **la ragione iniziale era falsa**. Il file non nominava `fub-sdk` da nessuna parte. L'invariante c'era nelle intenzioni. Oggi l'invariante è presente in tutti e due i file.

La **ragione vera** è la dipendenza **normale** di `fub-sdk` da `fub-format-markdown` **oggi**. L'inserimento del kernel in `fub-sdk` includerebbe il kernel nella libreria di un provider esistente, invece che nel grafo di un futuro guest.

Questo è il primo caso di una **separazione** dichiarata in anticipo nel cappello della seduta. La [0053](../decisions/0053-il-contratto-ha-una-sorgente.md) aveva introdotto la forma per un accorpamento. Queste due voci mostrano la stessa forma per il risultato opposto. Il criterio decisionale si trova nel [README delle decisioni](../decisions/README.md).

## Le due voci con la stessa domanda, e la risposta che le ha divise

Le voci 16.6 e 16.7 sono state gestite insieme. Il primo compito era valutarne l'uguaglianza.
- Il §16.7 criticava gli elenchi scritti a mano.
- Il §16.6 proponeva **un elenco scritto a mano** come soluzione.

Queste posizioni sono logiche e opposte.
- **Iterazione da elenco (test):** Il test itera (ripete) su un elenco. Le aggiunte sono ignorate. L'insieme reale vive altrove. Nessuno confronta le due cose. Questo è il difetto del §16.7.
- **Asserzione da elenco (test):** Il test usa un elenco per asserire un'uguaglianza. Le aggiunte sono rilevate. Costituisce un'allowlist (lista consentita) per una superficie sola. Questo risolve il difetto, nel §16.6.

Il criterio di scelta fra le forme è uno solo: **la produzione può leggere l'elenco?**
- **Se sì:** L'elenco diventa la **sorgente** della funzionalità.
- **Se no:** L'elenco resta una copia e va confrontata. Ad esempio, la macro `tauri::generate_handler!` richiede identificatori a compile time (tempo di compilazione) e non itera niente.

Questa tassonomia ha generato due risposte. Il confine ha prodotto due verbali, basati sul criterio della [0055](../decisions/0055-il-banco-del-lato-host.md).
Le due decisioni sono la [0056](../decisions/0056-un-elenco-che-e-la-sorgente.md) (l'inventario delle feature ufficiali, e le capacità) e la [0057](../decisions/0057-la-dieta-dell-ipc.md) (l'allowlist della superficie IPC). La 0056 lascia dietro di sé la voce **16.8** spiegata sotto. La separazione deriva dalla visione congiunta delle voci.

### 16.3 Un crate per bundle di feature

*ex §4.7 · presidi · **P1** · **chiusa** dalla [decisione 0116](../decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md) — il primo tempo era della [0071](../decisions/0071-una-feature-si-spegne-dove-si-dichiara.md); lo split in crate **resta come casella**, tenuto fuori da una condizione che un banco valuta ([0073](../decisions/0073-una-condizione-che-nessuno-valuta.md))*

- [x] **Situazione iniziale (crate singolo):** `fub-features` era un crate solo. Il motore di ricerca tantivy era una dipendenza dell'intero crate. Compilare il pannello outline compilava un motore di ricerca. I moduli della 21.2 (FubTasks, FubDB, FubCanvas, FubCalendar, FubAI, FubMaps) rendono il crate un monolite con il grafo di dipendenze di venti feature. Non è disattivabile a compile time. Manca di confini contro l'accoppiamento fra feature (feature↔feature). L'invariante "una feature ufficiale è ciò che scriverà un plugin" era falsa nel file `Cargo.toml`.
- [x] **Primo tempo: una cargo feature per bundle.** Realizzato tramite la [0071](../decisions/0071-una-feature-si-spegne-dove-si-dichiara.md). Create otto cargo feature omonime dei moduli. La feature `default` le accende tutte. La feature `tantivy` è `optional` dietro `search`.
  Il guadagno promesso è misurabile. Il grafo delle dipendenze di `fub-features` passa da **120 crate a 26** compilando la sola feature `outline`. `fub-host` le inoltra una per una. `fub-app` compila la build piena dell'app. CI (Continuous Integration) compila tre configurazioni parziali con il comando `build` e non con `test`. Il comando `cargo test --workspace` non rileverebbe problemi.
- [x] **Il cliente arrivato dalla [0056](../decisions/0056-un-elenco-che-e-la-sorgente.md):** L'inventario delle feature ufficiali gestisce la lettura della cargo feature. L'inventario è l'elenco di ciò che esiste. Una riga nascosta da `#[cfg]` sparisce dall'inventario.
  Il marcatore `#[cfg]` sta sulla **riga** dell'inventario e non solo sul `pub mod`. Nessuna build promette un bundle che nessuno ha compilato. Il test `tests/le_cargo_feature.rs` confronta i due elenchi **senza una tabella di corrispondenza**. Calcola l'identificatore `fub.<nome del modulo>` usando la cargo feature.
- [ ] **Secondo tempo: lo split in crate.** L'unica forma che assicura il **confine contro l'accoppiamento feature↔feature**. Dentro un crate singolo, il modificatore `pub(crate)` aggira le protezioni. La divisione è giustificata dai venti moduli della 21.2 (oggi inesistenti). Attualmente i moduli di feature sono dieci [conta: moduli-di-feature]. Non si citano fra loro. L'unico riferimento incrociato nei sorgenti è un link di documentazione a `backlinks::catalog`.
  La divisione immediata costa venti `Cargo.toml` per dieci moduli indipendenti. Non dividerli mai costa venti volte tanto in futuro. **La condizione per sbloccare la voce non è una data.** La condizione è il primo import fra due moduli di feature (esclusi link documentali). Il primo tempo prepara la struttura da cui lo split partirebbe comunque.
- [x] **La condizione è valutata meccanicamente.** Implementato dalla [decisione 0073](../decisions/0073-una-condizione-che-nessuno-valuta.md). Il test `crates/fub-features/tests/i_moduli_non_si_parlano.rs` controlla l'assenza di riferimenti `crate::` nei moduli di feature. Un test rosso (fallito) avvisa che **questa voce si è sbloccata** e consegna il testo da leggere. Una condizione scritta solo in italiano è ignorata.
  Il confine del compilatore (primo tempo) copriva metà del caso. Nella build di `outline`, il comando `use crate::search` non compila. L'aggiunta del marcatore `#[cfg(feature = "search")]` ripristina la compilazione e genera l'accoppiamento. Il test esamina i file sorgenti prima dei `cfg`, per questo mantiene forte la soglia. Un modulo condiviso legittimo entra in `RADICE` con la sua ragione.
- [x] **Un cliente in più dalla ~~§18.2~~ ([0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md)): la scorciatoia di un comando di shell non si riconfigura.** Il kernel fabbricava la chiave `keys.*` tramite la registrazione di un `CommandProvider` ([0077](../decisions/0077-una-scorciatoia-e-una-chiave.md)). Un comando nella webview non possiede un provider. Il pannello impostazioni mostrava queste chiavi in sola lettura. Il problema corrispondeva a: *la shell diventa un componente come gli altri*.

  **Fatto** dalla [0116](../decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md), e non dandole un provider.
  La 0090 aveva misurato una scorciatoia. La scorciatoia era un `CommandProvider` **di prossimità** registrato da `fub-host` per conto della shell, per far nascere le chiavi. Aveva scritto cinque ostacoli. Rimisurati, gli ostacoli **reggono tutti e cinque**.
  La conclusione cambia: **non sono cinque ostacoli, è uno visto da cinque lati.** Nascono dall'aver chiesto un *comando* dove serviva una *chiave*.
  I primi tre ostacoli (l'uso obbligatorio di `invoke`, nessun `PluginError` specifico per dichiarazioni remote, `allCommands()` che concatena senza deduplicare) esistono solo se il comando di shell entra nel registro del kernel. Il quarto ostacolo (la fixture `command-keys.json` cieca a un provider nuovo, cioè il buco della [0081](../decisions/0081-un-accordo-ha-un-proprietario.md)) si chiude **spostando la sorgente**. La tabella degli accordi della shell sta in Rust. Il quinto ostacolo (la 0090 la chiamava contraddizione fra i provider di scope `Vault` dalla [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md) e il comando `shell.vault.open` che precede ogni vault) non è una contraddizione. È **la regola mancante**. *Lo scope di una chiave segue la vita di ciò che la dichiara*. Di conseguenza, le chiavi `keys.shell.*` sono di macchina.

### 16.6 Dieta dell'IPC

*ex §4.2 · presidi · **chiusa** con la [0057](../decisions/0057-la-dieta-dell-ipc.md); resta una casella, ed è un numero che un test presidia*

- [x] **Test a presidio della superficie IPC (Inter-Process Communication):** Presente in `crates/fub-app/tests/dieta_ipc.rs`. Estrae due insiemi indipendenti dal sorgente: i comandi *definiti* e i comandi *registrati*. Confronta questi insiemi con un'allowlist. Ogni riga porta **la ragione** per cui il comando non poteva essere un comando del registro, una view o una query. L'aggiunta di un comando fa fallire il test (rosso). Il messaggio elenca le tre alternative.
  Il numero della voce era sbagliato per la **terza** volta. Il numero corretto è **37** invece di 38. Esistono quattro conti possibili (43 col grep sul workspace, 39 col grep su `lib.rs`, 37 attributi veri, 37 registrati). Le sei occorrenze in più sono **prosa** (l'uso di `#[tauri::command]` dentro un commento). Un presidio per contare la prosa fallirebbe al primo commento. L'estrattore salta i commenti tramite un test con un sorgente finto.
- [x] **La riga che divide (dalla [decisione 0013](../decisions/0013-elenco-delle-capacita.md)):** Un comando fa accadere qualcosa e risponde con un messaggio e un effetto. Una funzione che risponde con **dati** non può essere un comando.
  Applicata ai 37 comandi, ha prodotto **sei** categorie invece di tre. Fra cui *la porta è una credenziale*. Questa salva sei comandi da una migrazione sbagliata. I percorsi `set_setting` e `settings.set` sono due autorità e non due strade.
- [ ] **Migrare i bespoke che restano — adesso sono due.** Le voci ~~cestino (4)~~, ~~organizzazione (2)~~ e ~~grafo (1)~~ sono concluse. La migrazione del grafo è avvenuta **da prima** con la [0019](../decisions/0019-il-canale-dati.md) (non segnalata). La voce ~~versioning (3)~~ è migrata tramite la [0075](../decisions/0075-una-view-non-chiede-con-una-finestra.md), in modo diverso dal previsto. Il comando `restore_version` è diventato un comando del registro (`version.restore`). Le chiamate `list_versions` e `read_version` **non sono migrate a `IndexQuery`**. Sono state rimosse. Il pannello cronologia ora è un `ViewProvider` e legge dal proprio spazio dati.
  Prima di migrare un bespoke (canale su misura) si valuta **chi lo chiama, e da che parte del confine dovrebbe stare**.
  Restano i **due che nessuno nominava**: `render_preview` e `render_embed`. Entrambi rispondono con dati. Un `ViewProvider` non ha nessuna porta per i dati (HTML), mentre la shell la possiede. Il criterio di azione è deciso. L'esecuzione richiede una decisione sul confine di fiducia. Il sistema deve confermare l'esposizione sicura di output HTML su un canale per i plugin di comunità.
  **Il residuo si sposta in una variabile:** Il debito diventa la variabile `il_debito_dichiarato_e_un_numero_presidiato`. Migrare un elemento costringe all'aggiornamento del numero.

### 16.8 La prosa che conta i sorgenti non ha nessun presidio

*ottavo giro · presidi · **P1** — separata dalla 16.7 dalla [decisione 0056](../decisions/0056-un-elenco-che-e-la-sorgente.md) · **chiusa** dalla [decisione 0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md)*

La voce è la seconda metà del §16.7. La separazione avviene chiudendo il §16.7. La motivazione è la [0053](../decisions/0053-il-contratto-ha-una-sorgente.md) letta al contrario. Il **difetto** è identico (elenco falso senza avviso), ma il **presidio** è diverso. La 0056 gestisce insiemi estratti dai sorgenti. Questa voce affronta **affermazioni scritte in italiano** invisibili al compilatore. Decidere in blocco richiederebbe di applicare regole contrastanti.

- [x] **La famiglia più grande è la prosa che conta i sorgenti.** Un giro dedicato ha ricontato i numeri dei documenti contro il codice. Sono state individuate **quattro famiglie** con valori falsi e silenziosi.
  - L'interfaccia `HostApi` ha «ventitré metodi» in [PIANO.md](../PIANO.md) e in [traits.md](../architecture/traits.md), e «trentadue» a **duecento righe di distanza nello stesso file**. Il file `abi.wit` ne ha trentaquattro.
  - Due versioni `SCHEMA_VERSION` in [versionamento.md](../versionamento.md) presentano un numero inferiore rispetto al codice (1 invece di 2 per l'anagrafe, 4 invece di 5 per l'indice). Questo è il **numero il cui errore non si annulla** perché viola la promessa fatta ai file dell'utente.
  - I conteggi del §16.2 sono raddoppiati.
  - Le cinque capacità del `TriesEverything` sono diventate sette. Nessun test si è rotto.
- [x] **La chiusura della 16.7 ne ha trovate altre quattro in mezza giornata** ([0056](../decisions/0056-un-elenco-che-e-la-sorgente.md)). Questa è la misura della densità della famiglia.
  - `guard.rs` cita «**dieci** famiglie» in **tre** punti. Il codice ne conta quattordici. Un doc-comment a cinque righe di distanza indica correttamente «quattordici».
  - La [0013](../decisions/0013-elenco-delle-capacita.md) e [plugin-boundary.md](../architecture/plugin-boundary.md) citano «tutte e **sei** le strutturali». Elencano poi cinque famiglie basate sui metodi di `VaultStructure`.
  - Lo stesso documento sbaglia **la portata**: nega sette famiglie ma ne nomina una.
  La prima occorrenza si trova nello **stesso file** del codice descritto. L'invecchiamento non deriva dalla distanza fra testo e codice. Un'annotazione dedicata solo ai file `.md` salterebbe metà degli errori.
- [x] **La quinta specie: il numero di riga.** Il file [glossario.md](../glossario.md) punta al codice e a **una riga** specifica (`abi/event.rs:253`). Aggiungere codice sopra la riga invalida il riferimento senza toccare la riga stessa. La [0069](../decisions/0069-cosa-sa-dire-un-abbonamento.md) ha spostato cinque righe aggiungendo duecento righe a `event.rs`. Tre delle cinque righe erano **giuste** prima del commit. Una quarta era sbagliata in precedenza. Un presidio meccanico è semplice, manca solo la validazione del contenuto al numero di riga. Il file `check-doc-links.mjs` copre la casistica controllando solo l'esistenza del file, non del `:N`.
- [x] **La mezza voce del §17.1 ne ha trovate altre due** ([0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md)). Entrambe aggiungono difetti.
  - La prima è nella [0054](../decisions/0054-il-banco-del-lato-provider.md): «un terzo crate per **otto** funzioni». La tabella elencava otto funzioni. Il comando `grep -c "^pub fn " crates/fub-sdk/src/testing/conformita.rs` conta oggi **ventitré** funzioni. Il codice ne contava **quattordici già nel commit che scriveva «otto»**. Questo numero non è invecchiato, è un numero che **nessuno ha mai ricavato dalla sua sorgente**. La riparazione si differenzia.
  - La seconda è il numero di riga in fondo a questa voce, per la **nona** volta.
  La settima occorrenza mostra che la falsità al momento della scrittura è una costante. La scrittura manuale nel commit e la modifica del codice creano un disallineamento immediato. Un'annotazione risolta dopo in CI (Continuous Integration) arriverebbe prima del lettore. Nessuno dei due numeri è stato letto prima della verifica.
- [x] **Altre cinque discrepanze più un bersaglio nuovo durante il giro della mezza voce.** Registrate qui per la riparazione.
  - Il file `crates/fub-abi/wit/fub/abi.wit` ha **3400 righe di cui 1697 di commento**. La [0053](../decisions/0053-il-contratto-ha-una-sorgente.md) e la [M4](../milestones/M4-wit-hardening.md) indicavano 3386 e 1683. L'aumento corrisponde all'aggiunta di quattordici righe di commento (tramite `wc -l` e `grep -cE '^\s*//'`).
  - Il contratto in Rust conta **18 058** righe, contro le 17 150 dichiarate dalla 0053.
  - I messaggi `console.warn`/`console.error` della shell sono **quindici** e non quattordici ([0052](../decisions/0052-cio-che-va-storto-e-un-evento.md), [leva](leva.md)).
  - Il file [plugin-boundary.md](../architecture/plugin-boundary.md) nomina `safety::notifying` come se esistesse, e la descrive come «una riga su stderr». La funzione vera si chiama **`reporting`** e *restituisce* il panico invece di stamparlo. La 0052 ha effettuato questo cambiamento a due file di distanza. Questa è la **sesta specie**: smentita da un verbale vicino.
- [x] **Il bersaglio nuovo è meccanico e gestibile dal presidio attuale.** Trovati **quindici** link nella forma `[file.rs:N](…)` con un numero di riga stantio. Trovati sei in [data-model.md](../architecture/data-model.md) (sfalsati tutti di **+44**, cioè `model.rs` è cresciuto sopra quel punto). Trovati cinque in [traits.md](../architecture/traits.md) e quattro in plugin-boundary.md. Lo script `check-doc-links.mjs` valida **il file** e non il `:N`. Questa è la prima famiglia senza necessità di annotazione nuova. Serve leggere due caratteri in più. I sei link di `data-model.md` sono corretti (nel giro della mezza voce §17.1). Nove link rimangono da correggere. Il numero di riga **non** necessita della dichiarazione della sorgente.
- [x] **Due specie peggiori dei numeri.**
  La **quinta specie**: il *limite dichiarato* non esistente. Il file [traits.md](../architecture/traits.md) descriveva un controllo sull'ordine dei variant Rust nei test. L'informazione era falsa da **settantacinque commit**. Un limite invecchiato fa **sottovalutare** la copertura. Invita a non fidarsi di una garanzia reale.
  La **sesta specie** (la peggiore): la *garanzia dichiarata* inesistente. Il cappello iniziale della seduta sosteneva che `dependency_invariant.rs` presidiava un invariante. Quel file non nominava `fub-sdk` da nessuna parte ([0054](../decisions/0054-il-banco-del-lato-provider.md)). Non esiste invecchiamento descrittivo, la garanzia non è mai esistita. Nessuno verifica, perché **il motivo per cui si scrive una garanzia è smettere di doverci pensare**.
- [x] **Il presidio è a portata con risorse simili nel repo.** Lo script `check-doc-links.mjs` esiste contro la decadenza. I **conteggi** sono ugualmente vulnerabili. La soluzione è un'**annotazione**: il numero si scrive accanto al processo di estrazione per il calcolo meccanico.
  Il sistema per i calcoli è pronto. Le interfacce `host-*` in `abi.wit` (**34** funzioni verificate alla chiusura della 16.7 in [traits.md](../architecture/traits.md)). Le variabili `const SCHEMA_VERSION` nei crate. Le funzioni `fn vault(`/`fn workspace(` sotto `crates/*/tests/`.
  Ciò che manca è **il posto in cui scriverlo una volta e leggerlo da due parti**. La formula è identica alla gestione delle regole `rules_mirror.rs` → `rules-samples.json` della [decisione 0020](../decisions/0020-le-regole-in-un-posto-solo.md).
- [x] **Presidio inverso per la sesta specie:** Una frase del tipo *questo è presidiato da X* deve menzionare un test `X` che esiste. La stringa `X` è tracciabile meccanicamente. Il primo controllo gira nei cappelli delle sedute.
- [x] **Gli elenchi che rimandano (seconda metà esclusa dai conteggi).** L'indice inverso [strozzature.md](strozzature.md) invecchia in caso di chiusure in **altrove**. Un giro ha trovato **diciassette** chiusure false rispetto a ottantasette righe totali (una riga su cinque). Le voci sbarrate sono passate da ventinove a quarantasei in un pomeriggio, senza nuove chiusure. Il file [leva](leva.md) conferma questo invecchiamento: la riga «nessun `^block-id`» falsa da undici verbali, e un'altra ha detto «`views()` è un elenco statico» per trentaquattro.
  Il presidio meccanico è più difficile per via del giudizio umano, ma il **collegamento** è validabile come un link rotto (es. rimando a `§X.Y` chiuso o codice assente).
- [x] **Risoluzione del terzo presidio disattivato.** Il file `.github/scripts/check-doc-links.mjs` saltava ogni cartella contenente un `.fub/`. L'apertura della directory `docs/` come vault riduceva il controllo da **68 file e 718 link a 9 file e 17 link** stampando «0 rotti».
  **Fatto**. La regola ignora la cartella a meno che **git tiene dei `.md`**. Gli alberi saltati appaiono in output. L'esito su zero file controllati diventa rosso.
  Oggi controlla **145 file, 2965 link**, e 123 numeri di riga tramite la [0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md).
  Questa riga ha mostrato progressioni: «81 file, 1105 link», «122 file, 2155», «125 file, 2231», «127 file, 2284», «129 file, 2336», «132 file, 2464», «132 file, 2475», «134 file, 2553». La correzione di oggi è la **nona**. La causa principale è l'aggiunta di prosa dalla voce 16.8. Chiudere il presidio ha falsificato il conteggio che la voce non presidia. Il salvataggio includeva una riga 2964, resa falsa dall'inserzione (per la seconda volta colta in diretta).
  La correzione precedente era l'**ottava**. Lo script ricostruisce la storia tramite i log (`git log -- questo file`). L'ordinale sfalsato («nona», poi «decima») saltava l'elenco sesto («132 file, 2464 link»). Delle ultime quattro correzioni, tre cause sono diverse e una si ripete. La quinta era falsa durante la scrittura (da 2284 a 2285). La sesta e la settima erano provocate dai verbali (da 2285 a 2336 a 2475). L'ottava rivelava un invecchiamento intrinseco: dichiarati 2475, calcolati 2468 (sette link rimossi da due puliture `21c3562` e `0d85342`). I conteggi dei file dipendono dall'albero di lavoro (134 invece di 133 con appunti `.md` tramite `git ls-files`).
  I numeri dipendono dal clone pulito. Il presidio funziona, la frase descrittiva no. Un repository che documenta sé stesso non mantiene valori fissi a lungo. Questa è la giustificazione della voce (dimostrata quattro volte su otto).

**Chiusa dalla [0072](../decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md).**
Il formato è implementato. Lo script `.github/scripts/conteggi.mjs` memorizza **i comandi e non i valori** (un nome, un comando di calcolo, uno scopo).
Lo script `check-prosa.mjs` verifica ogni citazione nei `.md` **e nei commenti del codice**.
Tre controlli:
- Numeri o voci false generano errori (entrambe le direzioni).
- Regola inversa (sesta specie): il «presidiato da X» deve nominare un `fn` o un file di test che esiste — e `X` è tracciabile meccanicamente.
- Bersaglio meccanico: `check-doc-links.mjs` valida il numero `:N`.

Rilevamenti all'accensione:
- Valori `SCHEMA_VERSION` passati da sette a **otto** (il numero il cui errore non si annulla).
- Errori in console aumentati da quindici a **sedici** (numero che doveva calare).
- Commenti in `abi.wit` registrati come 1683 su 3386. I valori reali sono 1758 su 3502.
- `safety::notifying`, che non esiste e non è mai esistito sotto quel nome.
- Numeri di riga stantii: stimati a **quindici** ma registrati a **cinquantuno** (49 riparati dal presidio, due senza meccanismo automatico).

Tre decisioni consolidate per il verbale:
- Il registro gestisce i comandi, non i valori.
- Il numero richiede l'annotazione sulla **stessa riga** (previene tre annotazioni sfasate in diretta).
- **Un verbale non si presidia**. Protegge l'obsolescenza della 0053 e della 0060.

Elementi esclusi:
- La seconda metà: gli **elenchi che rimandano** (es. [strozzature.md](strozzature.md)). Definire "chiusa" esige l'intervento umano, non calcoli meccanici.
- Il numero del log del §16.7. Manca dal registro a causa della fluttuazione sui cloni (`.md` locali). Rimane l'unica prova autogenerata della decadenza della prosa. Il presidio quantifica quanti link hanno il numero di riga e quanti dei secondi possiedono l'ancoraggio.

*Sblocca:* 27.4 (plugin sandbox test, security test, upgrade migration test), 27.3 (plugin linting, test utilities), 20.3 (permission revocation, crash isolation).