# 0105 — Una porta si nomina, e un presupposto si fa verificare dal compilatore

**Stato**: accolta
**Data**: 2026-08-05
**Chiude**: [§23.15](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#2315-la-rete-che-regge-i-panici-non-ha-un-presidio-ha-una-nota)
**Commit**: *(questo commit)*

---

## La domanda

La [0032](0032-il-runner-dei-job.md) ha messo un `catch_unwind` intorno a ciò che
i componenti eseguono, e nel farlo ha scritto la riga esatta del rischio:
*«`catch_unwind` presuppone che il panico srotoli. Un profilo con
`panic = "abort"` farebbe sparire questa rete in silenzio; il workspace non lo
imposta, e se un giorno lo facesse questa è la riga da rileggere»*.

La §23.15 osserva che quella riga è una **casella indirizzata a nessuno**. Chiede
a un lettore futuro di ricordarsi di rileggere una frase in un verbale
immutabile nel momento esatto in cui aggiunge un `[profile.release]` — cioè nel
momento in cui non la sta leggendo. E chiede il presidio corrispondente: *«un
test che legga il profilo effettivo e fallisca se `panic` è `abort`»*.

## Cosa la misura ha cambiato, prima di progettare

Tre cose. La prima falsifica il nesso della voce, la seconda rende
**impossibile** il presidio che chiede, e la terza sposta il difetto fuori dalla
voce per la sesta volta di fila.

### Il nesso è falso, e il fatto vero è peggiore

La voce scrive: *«`il_panico.rs` verifica che la rete tenga, ma sotto
`panic = "abort"` quel test **abortirebbe il processo** invece di fallire con un
messaggio. Non è un presidio, è la prima vittima»*.

Non è così. Cargo **ignora** `panic` per i profili `test` e `bench`: il suo
harness ha bisogno dello srotolamento per raccogliere i fallimenti, e lo impone.
Un `[profile.release] panic = "abort"` non arriva a `cargo test`, nemmeno a
`cargo test --release`.

Quindi `il_panico.rs` non sarebbe la prima vittima. Resterebbe **verde** — e un
banco verde che attesta una rete che nel binario spedito non esiste più è
peggio di un banco che muore rumorosamente. Un test che abortisce si nota; un
test che passa a vuoto è la classe di difetto che questo repo ha già incontrato
nove volte, e la sola che nessun altro presidio trova.

È la stessa specie della [0054](0054-il-banco-del-lato-provider.md), vista da un
verso nuovo: là un banco provava il lato sbagliato, qui proverebbe il **profilo**
sbagliato. E vale la pena tenerla come regola: *un banco non prova le condizioni
sotto cui non gira*.

### Il presidio che la voce chiede non è scrivibile

Dal fatto precedente discende che *«un test che legga il profilo effettivo»* non
esiste. Un test gira sempre sotto `unwind`, quindi non c'è profilo effettivo da
leggere: quello che vede è il proprio, che è sempre quello giusto.

Restava la strada di leggere il `Cargo.toml` **come testo** — c'è il precedente
di `crates/fub-features/tests/le_cargo_feature.rs` e di
`crates/fub-abi/tests/dependency_invariant.rs`, che fanno esattamente così — ed è
stata scartata: vedrebbe il file e non il flag. `RUSTFLAGS=-Cpanic=abort` e un
`.cargo/config.toml` passano sopra la sua testa, e sono il modo *normale* in cui
un packager di distribuzione impone un profilo a un progetto che non è suo.

La strada presa è un `#[cfg(panic = "abort")] compile_error!` dentro
`fub-kernel`. È del **crate che si compila**, quindi vede tutti e tre i canali; è
del compilatore e non della suite, quindi non ha bisogno che qualcuno esegua i
test; e tace nei test, dove il profilo è sempre `unwind`, quindi non è rumore.

È la lezione della [0104](0104-la-superficie-di-scrittura-si-presta.md), scritta
allora per un `match` e valida qui per un `cfg`: **un presidio il cui solo
mestiere è non compilare vale più di un `assert` che qualcuno deve eseguire.**

E c'è la metà che la voce aveva già visto e che vale la pena ripetere: il
presidio **non è un divieto per sempre**. È un divieto finché la risposta a un
componente che pania è *catturarlo*. Il giorno che il profilo lo si vuole
davvero — ed è la prima cosa che si aggiunge guardando la dimensione del binario
— la risposta non è togliere la riga, è isolare i componenti fuori dal processo
(§24.2, o il guest WASM di M5, che quella proprietà ce l'ha per costruzione). Sta
scritto nel messaggio dell'errore, che è il solo posto dove chi inciampa lo
leggerà.

### Il difetto peggiore stava fuori dalla voce, per la sesta volta

La 0032 non ha scritto solo la riga sul `panic = "abort"`. Ne ha scritta
un'altra, molto più impegnativa, e nessuno l'ha riletta:

> **Otto porte, e sono tutte quelle da cui si entra in codice di un plugin.**

È un criterio dichiarato **esaustivo**, tenuto a mano, in un documento
immutabile. Misurato: le porte sono **tredici**. Una di loro —
`IndexProvider::up_to_date`, la domanda che la [0046](0046-l-anagrafe-del-vault.md)
ha aggiunto per il §14.2 — è **nata dopo** quel conto, l'ha passato accanto senza
toccarlo, ed è oggi in produzione dentro ogni riapertura di vault. Altre erano
semplicemente sfuggite al censimento del suo tempo.

Nessuno se n'era accorto, e la ragione è precisa: **niente confrontava l'elenco
col codice**. Il presidio dei numeri in prosa della
[0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) non lo prende perché
«otto porte» non ha un `[conta: …]` accanto — e non poteva averlo, perché non
esisteva niente da cui contarle. È la forma che il §16.7 chiama col suo nome:
*esaustivo a memoria, non per costruzione*.

E il banco aveva lo stesso vizio, un piano più sotto: l'intestazione di
`il_panico.rs` dichiarava di provare «una per specie», e le specie provate erano
**cinque**. Cioè il presidio che sotto `abort` avrebbe dovuto morire non copriva
nemmeno l'insieme di cui il verbale parlava.

Questo è il difetto che vale il giro. Un `compile_error!` è dieci righe; un
elenco esaustivo che ha smesso di esserlo senza che nessuno lo sappia è la cosa
che rende inaffidabile ogni frase costruita sopra di lui.

## La decisione

### Le porte diventano un dato

`fub_kernel::safety::Gate`: un enum con una variante per specie di porta, e
`Gate::ALL`.

```rust
pub enum Gate {
    Command, ViewRender, ViewAction, Service, Event,
    IndexFeed, IndexForget, IndexUpToDate, IndexReconcile,
    FormatParse, SyntaxRule, CustomRender, Job,
}
```

`calling`, `caught` e `reporting` prendevano `what: &str` — la frase, scritta a
mano al sito. Adesso prendono `gate: Gate` e `detail: &str`: **la porta dice il
verbo, il sito dice il soggetto.** Le tredici frasi che stavano in tredici
`format!` sparsi vivono in un `match` esaustivo, che è anche il posto dove si
vede in una schermata cosa l'utente legge quando un componente esplode.

Da qui in poi una porta nuova non si apre in silenzio, e non perché qualcuno se
ne ricordi:

- `Gate::what` è un `match` senza `_`: chi aggiunge una variante **non compila**
  finché non le dà una frase;
- `ogni_porta_dichiara_dove_e_provata`, in `il_panico.rs`, è un secondo `match`
  senza `_`: **non compila** finché non si dichiara dove quella porta è provata,
  o perché non lo è.

Il secondo è la forma di `il_dogfooding_dichiara_fin_dove_arriva` della 0104,
applicata a un insieme diverso. La proprietà che le accomuna, e che è la ragione
per cui questa forma si ripete: **un conto non sa quante cose esistano fuori di
lui; il compilatore sì.**

### Cinque porte che nessuno provava, adesso provate

Il censimento non è servito a dichiarare cinque buchi: è servito a chiuderli. Le
porte scoperte erano `Service`, `SyntaxRule`, `IndexUpToDate`, `IndexForget` e
`IndexReconcile`, e hanno adesso un banco ciascuna. Due meritano una riga.

**Il servizio** (§7.5) aveva la porta in rete e nessuna prova, e la prova ha una
seconda metà che non era ovvia: un panico **non deve** diventare `Unserved`.
`Unserved` significa «nessuno offre questo servizio», ed è ciò su cui chi disegna
costruisce il consiglio *«installa il plugin»* — darlo a chi il plugin ce l'ha
già installato e funzionante è mandarlo a cercare una cosa che ha. La
distinzione è la stessa del canale dati ([0019](0019-il-canale-dati.md)) e adesso
è presidiata.

**`up_to_date`** è la porta nata dopo il conto, ed è quella dove chi chiama non
ha nemmeno un errore da restituire: l'esito è un `unwrap_or_default()`, cioè «non
ha detto niente». La conseguenza giusta di un panico lì è che il documento venga
**riletto**, non saltato — un indice che pania non può dichiarare di essere
aggiornato — ed è ciò che il codice già faceva e che adesso qualcuno verifica.

### Una porta che riceve un dettaglio lo nomina

`una_porta_che_riceve_un_dettaglio_lo_nomina` verifica, per ognuna delle tredici,
che `Gate::what` nomini il `detail` se ne prende uno.

È la riga con cui la 0032 aveva motivato il `who` — *«un "qualcosa è andato
storto" che non dice quale plugin è la stessa cosa di non dirlo»* — applicata al
**cosa**. Una porta che accetta un dettaglio e lo butta via produce «un plugin è
andato in panico eseguendo un comando» senza dire quale comando: è il difetto
che la 0032 aveva già rifiutato una volta, in un punto dove non lo aveva
cercato.

## Cosa la verifica del rosso ha cambiato

I banchi nuovi sono stati provati **rossi uno per uno** (trappola 9), e come le
ultime due volte la verifica ha trovato più di quanto cercava. Tre cose, e le
prime due sono affermazioni **di questo verbale** che erano false.

### Il censimento dichiarava provata una porta che non lo era

`ogni_porta_dichiara_dove_e_provata` distingue fra una porta provata *qui* e una
provata *altrove*, e per quelle altrove verifica che il file dichiarato esista.
`Gate::CustomRender` era dichiarata provata in
`crates/fub-format-markdown/tests/il_corpus.rs`: il file esiste, il test passava,
e **dentro non c'è nessun `CustomRenderer` che pania**. Cercato in tutto il
workspace: nessuno dei tre `impl CustomRenderer` panica. Togliendo la rete intorno
al renderer, la suite intera resta verde.

È il difetto della §23.15 ripetuto un piano più sotto, e la sua forma è precisa:
**il presidio guardava il nome del file invece del suo corpo.** È la stessa
domanda che questo giro ha imparato a fare ai documenti — *leggi il corpo del
criterio, non il suo nome* — applicata a sé stesso e fallita.

La porta ha adesso un banco vero (`un_renderer_che_pania_degrada_invece_di_portarsi_via_la_pagina`),
e con lui il censimento non dichiara più nessun buco: dodici porte provate qui,
una in `il_runner.rs` e una in `concorrenza.rs`, tutte e due verificate rosse
togliendo la rete.

### Il conto e il compilatore prendono cose diverse, e nessuno dei due basta

`l_elenco_delle_porte_e_quello_dell_enum` diceva di coprire *«una variante
aggiunta e mai messa nell'elenco»*. Misurato: **non la copre**. Aggiungendo una
`Gate` in coda e scrivendo solo gli arm che il compilatore pretende, tutti i
banchi restano verdi.

E la stessa prova, fatta sui due presidi **da cui questa forma è stata copiata**
— `ViewSurface::ALL` e `Capability::ALL` —, dà lo stesso esito. La causa è
comune: l'ancora della lunghezza è sempre una variante **nominata a mano**
(`ViewSurface::SettingsTab`, `Capability::Transfer`), e una variante nuova sta
*dopo* quella nominata, quindi i due numeri restano uguali fra loro e sbagliati
entrambi. In Rust stabile non c'è modo di contare le varianti di un enum: non è
una svista, è un limite.

Il pezzo che mancava non era in Rust. Sta in
`.github/scripts/conteggi.mjs`: un conto che legge le varianti **dal sorgente**,
confrontato da `check-prosa` col numero scritto nei documenti — la macchina della
[0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md). Questo commit vi
registra `porte-verso-un-terzo` e, per la stessa ragione, `superfici-di-vista`,
che non c'era: la 0104 aveva scritto «dieci superfici» in due documenti senza
nessuno che lo verificasse, che è esattamente il difetto che quel verbale stava
riparando.

La divisione del lavoro è netta, e vale la pena tenerla come regola:

> **Il compilatore prende la variante che non vuol dire niente; il conto prende
> la variante che nessuno ha elencato.** Un `match` esaustivo non sa quante cose
> esistano fuori di lui più di quanto lo sappia un `assert`: lo sa solo chi
> guarda il sorgente da fuori.

Corregge in parte la 0104, che aveva scritto *«un `match` esaustivo vale più di
un `assert` sulla lunghezza»*. Vale più, ma non al posto: sono due presidi con
due zone cieche diverse, e servono tutti e due.

### Il presidio copiato aveva una seconda zona cieca, ed è riparata qui

Provando rosso `Capability::ALL` — quello da cui la 0104 aveva copiato la forma
per le superfici — si è visto che **due righe scambiate gli sfuggono**:
l'aritmetica ordina prima di confrontare, quindi un riordino la lascia
identica. Il presidio gemello delle superfici il ciclo posizionale ce l'aveva;
l'originale no. Su diciannove famiglie di permessi, un riordino cambia
l'ordine con cui i permessi si leggono e nessuno se ne accorge.

Riparato nello stesso commit, che è il precedente della 0104. E la regola che
quel verbale aveva scritto — *verifica il rosso anche sui banchi da cui copi* —
si estende di un grado: **verificalo di nuovo anche se qualcuno l'ha già fatto
una volta.** La 0104 aveva guardato quell'originale e ne aveva trovato un buco;
il secondo era lì accanto.

## Cosa NON è stato fatto

- **Nessun profilo di release è stato aggiunto.** Questa decisione non dice cosa
  ci vada dentro: dice che se ci va `panic = "abort"` il progetto se ne accorge
  al `cargo build`. `lto` e `strip` restano liberi.
- **Nessuna riga di WIT.** `Gate` è un tipo Rust interno a `fub-kernel`: il
  contratto non lo vede, e la superficie congelata non è stata toccata. Un
  panico resta ciò che era al confine — l'errore di casa che lo nomina — perché
  un panico è un **difetto**, non una condizione, e nel contratto non ci va.
- **Le porte non si spengono.** Un componente che pania costa la chiamata e
  resta registrato, come dalla 0032: le due voci che servirebbero per decidere
  altrimenti (dirlo, §20.2, e riaccendere, §11.1) esistono adesso tutt'e due, ma
  la politica è una decisione di prodotto che questa voce non pone.
- **`Gate` non arriva nell'evento.** Sarebbe la cosa naturale da fare — un
  `Event::Trouble` che porta *da quale porta* si è entrati permetterebbe al
  centro notifiche di raggruppare, e a chi legge il registro di contare. Non è
  stato fatto perché è un campo in un tipo del contratto, cioè una decisione
  sulla firma, e questa voce non la chiedeva. Resta una casella nella
  [seduta 17](../roadmap/17-presidi-che-restano.md).

## Il prezzo, dichiarato

- **Tre parametri prima della chiusura.** `caught(who, gate, detail, wrap, f)` ha
  un argomento in più di prima. È il prezzo di aver tolto il `format!` dal sito:
  la frase non si compone più dove si chiama, e chi legge il sito deve fare un
  salto per vederla. Il guadagno che lo paga è che le tredici frasi sono adesso
  in un posto solo e censite; il costo lo paga chi legge un sito alla volta.
- **`carries_detail` è una prova, non un dato.** Chiede a `Gate::what` una frase
  con un sentinella dentro e guarda se esce. Funziona, ma è una domanda posta
  attraverso il risultato invece che attraverso la dichiarazione. L'alternativa
  — un campo che ogni variante dichiara — sarebbe un secondo elenco da tenere
  allineato al primo, cioè esattamente il difetto che questo verbale ripara.
- **`ogni_porta_dichiara_dove_e_provata` verifica che il file esista, non che il
  test dentro ci sia.** È il limite che ha lasciato passare `CustomRender`, e
  resta: adesso i due file dichiarati contengono davvero un componente che
  pania — verificato togliendo la rete e guardandoli rossi — ma il presidio non
  lo sa, sa solo che i file ci sono. Cercare il nome del test dentro il file
  legherebbe questo banco al nome di una funzione in un altro crate, che è un
  vincolo più stretto di quanto la cosa valga; la difesa vera è che le porte
  *altrove* sono due, e stanno scritte.
- **Che la `Gate` di un sito sia quella giusta non lo verifica nessuno.**
  Misurato: passando `Gate::IndexForget` dove va `Gate::IndexFeed`, la suite
  intera resta verde, e lo stesso vale cambiando il testo di una frase (l'unica
  asserita è quella del servizio). I banchi provano che *una* rete c'è, non che
  è la porta giusta col nome giusto. Chiuderlo vorrebbe dire asserire la frase
  in ognuno dei tredici, e per le cinque porte che passano da `reporting` la
  frase non è nemmeno osservabile da chi chiama.
- **Il `compile_error!` scatta su `cargo build` e `cargo clippy`, non su
  `cargo test`.** Discende dallo stesso fatto per cui esiste, e va detto perché
  riguarda la CI: una pipeline che eseguisse *solo* i test non lo vedrebbe.
  Quella di questo repo fa build e clippy, quindi oggi è presidiato.
