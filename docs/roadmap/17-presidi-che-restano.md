# 17. I presidi che restano

Una **seduta** della [roadmap infrastrutturale](../todo.md): senza precedenze e senza scadenza — il criterio è se il costo cresce con l'attesa.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

Tre voci senza precedenze e senza scadenza, che non bloccano nulla e per questo
rischiano di non essere fatte mai. Il criterio con cui giudicarle è quello che il
piano ha già applicato alla supply chain
([decisione 0001](../decisions/0001-supply-chain-e-sbom.md)): non «quanto sblocca»,
ma **se il costo cresce con l'attesa**. Per il corpus cresce (ogni sintassi nuova
è un caso in più da scrivere a posteriori); per gli e2e e per il tracing no.

E quel criterio ha **tagliato la prima voce**, che è la cosa più utile che un
criterio di seduta possa fare: dentro la §17.1 il corpus e il fuzzing sono la
parte il cui costo cresceva, il banco delle prestazioni quella che aspetta una
macchina e non una decisione.

Il criterio però ordina ciò che vede, e una riga della voce non stava né di qua né
di là: il round-trip rifatto sul corpus non aveva un costo che cresceva e non
aspettava una macchina — aspettava **il corpus**, che è dentro la voce stessa. Un
taglio fatto guardando le voci dall'esterno non poteva vederla, ed è la ragione per
cui la §17.1 si è chiusa a pezzi invece che a metà. Lo stato dei pezzi sta nella
riga in corsivo qui sotto, e non qui.

### 17.1 Corpus, fuzzing, prestazioni

*ex §4.3 · presidi · **P2** — **chiusa in tre parti** meno il banco delle prestazioni: il corpus e il fuzzing con la [decisione 0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md), il round-trip sul corpus con la [0061](../decisions/0061-un-giro-che-non-passa-dal-modello.md); restano le due caselle del banco, che aspetta una macchina e non una decisione*

- [x] **Fuzzing del parser** markdown: 5.3 lo chiede esplicitamente, e un parser
      che pania è un vault che non si apre. **Fatto** con la
      [0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md), e non con
      `cargo-fuzz`: una **rete di regressione deterministica** — xorshift scritto
      a mano, seme e conteggio fissi, ventimila mutazioni del corpus a ogni push
      in 2,5 secondi, cinque milioni in ottantaquattro quando si vuole cercare
      invece di presidiare. libFuzzer vuole nightly, un crate fuori dal workspace
      e una macchina che lo esegua a lungo: sarebbe diventato il secondo presidio
      di questa voce che non gira, e sta con la macchina di qui sotto.
      **L'HTML in ingresso resta fuori e non ha soggetto**: nel repo non c'è
      nessun parser HTML, l'HTML è solo in uscita dalla resa. Il giorno che
      l'import da HTML esiste, le proprietà dell'SDK sono già le sue.
- [x] **Corpus di conformità** CommonMark/GFM + snapshot Obsidian-flavored.
      **Fatto** con la [0060](../decisions/0060-il-modello-dice-il-vero-sui-byte.md),
      e con due differenze rispetto a come la riga lo chiedeva. La prima: non
      sono **snapshot** — sessantadue casi contro sei **proprietà**, perché uno
      snapshot dice che un modello è diverso e una proprietà dice *perché* è
      sbagliato. La seconda: ciò che si prova non è «comrak è conforme a
      CommonMark» (è una proprietà di una dipendenza, e asserirla renderebbe la
      suite rossa il giorno in cui comrak *corregge* un bug) ma **ciò che il
      modello dice del documento è vero rispetto ai byte del file** — che è la
      proprietà di Fub, ed è quella su cui poggia ogni patch chirurgica. Il
      costo ha smesso di crescere con l'attesa perché il corpus **si confronta**
      in tre direzioni con sorgenti che non sono lui (le varianti del contratto,
      i `custom_kind` del registro, le sintassi di `capabilities()`): un costrutto
      nuovo che nessun caso esercita è rosso subito. Cinque difetti di produzione
      trovati, tredici divergenze fra modello e file **dichiarate** una per riga.
- [ ] **Benchmark su vault sintetici grandi** (10k/100k note) in CI, con soglie:
      tempo di apertura, ricerca, memoria. Senza numeri, "supporto vault enormi"
      non è verificabile.
- [ ] **E questo banco ha già un abitante che aspetta**, che è il modo in cui la
      voce ha smesso di essere teorica: il presidio della §8.4
      ([0026](../decisions/0026-due-query-insieme.md)) — *due ricerche stanno
      nell'indice insieme* — è oggi `#[ignore]` in `features/src/search.rs`.
      Non perché la proprietà sia falsa: perché **ogni colonna misura una
      trentina di millisecondi**, e a quella scala il tempo se lo prendono lo
      spawn dei thread e lo scheduling, che non scalano coi core. Su un runner
      condiviso il rapporto è venuto 0,97 con la suite verde in locale, cioè il
      presidio ha smesso di misurare la propria proprietà e ha cominciato a
      misurare il vicino di banco. Serve un carico che domini l'overhead **e**
      una macchina che non divida i core: sono le due cose che questa voce
      chiede, ed è la ragione per cui un test di prestazioni non può stare in
      mezzo agli altri e girare a ogni push. Finché non c'è, si lancia a mano
      (`cargo test -p fub-features --lib due_ricerche -- --ignored`).
- [x] **Round-trip import/export**: il primo giro c'era con la
      [decisione 0006](../decisions/0006-import-export-come-trait.md)
      (`transfer_e2e.rs`: un vault esce in artefatti e rientra identico), ma su
      un vault scritto a mano. **Fatto sul corpus** con la
      [0061](../decisions/0061-un-giro-che-non-passa-dal-modello.md), che ha
      trovato la ragione per cui la riga valeva la pena: i due versi del
      trasferimento non sono uno solo. Quello che copia i byte non prende i suoi
      byte dal modello, e infatti le settantacinque sorgenti — i sessantadue casi
      curati *e* le tredici divergenze dichiarate, che stanno nel vault apposta —
      escono e rientrano identiche byte per byte. Quello che toglie il frontmatter
      dal modello ci passa, perché taglia il file sullo span del primo blocco: là
      la pretesa non è l'identità ma che **la struttura non cambi**, e su quella
      pretesa il corpus ha trovato un difetto vero — il taglio si mangiava
      l'indentazione di un code block, e il documento esportato non era più un code
      block. Il timore che questa riga dichiarava — «le divergenze sono l'elenco di
      ciò che un round-trip non può pretendere» — era invece mal riposto: una
      divergenza fra il modello e il file non tocca un giro che dal modello non
      passa.

### 17.2 Test della shell

*ex §4.4 · presidi · **P2** — gira contro l'host finto della 1.3*

**Una metà di questa voce è già stata presa, e da un'altra parte.** La
[§23.16](23-cosa-costano-le-decisioni-chiuse.md#2316-su-windows-un-hardlink-si-stacca-in-silenzio)
la nominava come *«la §17.2 vista da un lato che quella voce non nomina — non i
test della shell ma i test di ciò che cambia con la piattaforma»*, e la
[0109](../decisions/0109-un-conteggio-che-non-si-sa-non-e-un-nome-solo.md) l'ha
decisa misurando: un test sotto `#[cfg(unix)]` su Windows non fallisce, **non
viene compilato**, e una suite che si svuota in silenzio è indistinguibile da una
suite verde. La forma che ne è uscita — il ramo che dipende dall'OS si **passa**
invece di essere nominato, e quanti test restano fuori dal `cfg` è un **numero**
scritto accanto a come lo si ricava — sta in
[platforms-ci.md](../appendix/platforms-ci.md) e vale per chiunque scriva un
presidio di piattaforma, qui dentro compresi gli E2E: un E2E che gira su un OS
solo ha lo stesso difetto in un altro travestimento.

- [ ] **E2E** dell'app reale (tauri-driver/Playwright) sui flussi critici:
      apri vault, scrivi, rinomina, cerca, ripristina.
- [x] **Il check di accessibilità automatico è stato spostato al §12.4**, che
      possedeva già l'argomento («passata di accessibilità strutturale: ruoli
      ARIA, focus visibile, focus trap, navigazione da tastiera, skip link»). Due
      ragioni. La prima è che un presidio senza la passata che deve presidiare
      non ha niente da tenere fermo: si scrive **dopo**, e allora si scrive dove
      sta lei. La seconda è **il criterio di questa seduta applicato a se
      stesso**: qui si tiene ciò il cui costo *cresce* con l'attesa, e questo è
      l'unico caso in cui **cala**. I pannelli sono alberi `UiNode`, e la
      [decisione 0016](../decisions/0016-cosa-e-una-view.md) ci ha aggiunto
      venticinque specie di nodo, dieci superfici e i metadati di come una view
      si presenta: un check scritto prima avrebbe presidiato un DOM che quella
      seduta ha sostituito. Ora la resa è ferma, e la passata di accessibilità
      ha finalmente qualcosa di stabile su cui girare — resta il fatto che si
      scrive **dopo** la passata, dove sta lei.
      **Fatto**, insieme alla passata, dalla
      [decisione 0042](../decisions/0042-il-catalogo-della-shell.md):
      `frontend/src/ui/a11y-check.ts` e il suo presidio, che gira sulla scocca
      vera. La previsione era giusta — il costo è calato, e il check presidia
      una resa che nel frattempo si era fermata.

### 17.3 Osservabilità

*ex §4.5 · presidi · **P2** — **chiusa** con la [decisione 0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md): `tracing` al posto di `eprintln!`, collettore scritto in casa, log su file con rotazione, livelli e log per-plugin come impostazioni di macchina*

- [x] **`tracing` al posto di `eprintln!`** con log su file, livelli
      configurabili e log per-plugin. **Fatto** con la
      [0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md),
      che ha voltato la frase di partenza: una cosa sola erano **due**, perché
      un guasto ha due lettori e due destinazioni —
      *il log è il pavimento, l'evento è la porta*. Ogni guasto lascia una riga
      di `tracing` per chi sviluppa; solo quelli che raccontano una **perdita**
      aprono anche l'`Event::Trouble` della [0052](../decisions/0052-cio-che-va-storto-e-un-evento.md)
      per chi legge le note. I ventisette `eprintln!` di produzione che la 0052
      aveva contato sono scesi a zero, sette aprono la porta e il resto resta
      nel pavimento; e con loro si chiude la casella residua della §20.2. Il
      collettore è in casa (`fub-kernel/src/log.rs`, sessanta righe) e non
      `tracing-subscriber`: la [0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)
      ha tolto la configurazione dalle variabili d'ambiente, e `RUST_LOG` non
      rientra dalla finestra. Il diagnostic bundle (§15.2) lo raccoglie —
      quando il bundle esiste; il file di log c'è già, ruota a dieci mega e sta
      accanto alla configurazione e non nel vault.

- [ ] **`Event::Trouble` non dice da quale porta si è entrati.** La
      [0105](../decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md)
      ha fatto delle porte da cui si entra in codice di un plugin un **dato** —
      `Gate`, tredici varianti — e la frase che l'utente legge la compone quel
      dato; ma nell'evento arriva ancora solo la frase. Un `Trouble` che porti
      la porta permetterebbe al centro notifiche di **raggruppare** («questo
      plugin pania su ogni render», che è un'altra cosa da tre guasti sparsi) e
      a chi legge il registro di **contare**. Non è stato fatto lì perché è un
      campo in un tipo del **contratto**, cioè una decisione sulla firma, e la
      §23.15 non la chiedeva: si fa dove si guardano le firme, non dove si
      guarda un presidio.
