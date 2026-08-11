# 0074 — Selezionare non è raccontare

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | `todo.md` §21.9 (seduta 21) — la voce nata da una **misura**, come la ~~§8.4~~ |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/21-la-ricerca-predefinita.md) ·
[chi legge non aspetta chi legge](0024-chi-legge-non-aspetta-chi-legge.md) ·
[due query insieme](0026-due-query-insieme.md) ·
[il canale dati](0019-il-canale-dati.md)

---

I due numeri che il repo aveva sulla velocità della ricerca stavano a **due
ordini di grandezza** di distanza. [M2](../milestones/M2-search-graph.md) aveva
misurato la query peggiore a **108 µs** su 2000 note e ci aveva spuntato sopra
un criterio di accettazione; il banco della
[0024](0024-chi-legge-non-aspetta-chi-legge.md) aveva misurato **~23 ms** per
query sullo stesso ordine di vault, e la sua ultima riga aveva lasciato il buco
per iscritto: «*perché* una query costi 23 ms su 2000 note è un'altra domanda
ancora, e non è di concorrenza».

Nessuno dei due numeri era sbagliato, ed è questa la parte che rendeva la voce
necessaria: due banchi che misurano cose diverse non si contraddicono, si
ignorano. Finché non si sapeva **quale** delle due cose fosse la ricerca vera,
«la ricerca è veloce» non era una frase verificata — era una spunta su una
misura che non copre il caso da cui passa l'utente.

## La risposta, in una frase

**Una query non costava: costava *raccontare* duemila righe per mostrarne
venti.** Il pianificatore chiede a un indice **senza finestra** — e deve, perché
l'ordine di una risposta paginata è del contratto e non del motore — ma il
contratto non aveva nessun modo di dire *«per adesso mi bastano gli id»*. Chi
indicizza doveva presumere che l'estratto servisse sempre, e generava un
estratto per ogni documento che combaciava: duemila, di cui 1980 buttati dalla
finestra un istante dopo.

| sullo stesso vault sintetico, 2000 note, release | prima | adesso |
|---|---|---|
| `query_index` `Text("concorrenza")`, page 20, dalla porta del workspace | **22,3 ms** | **3,4 ms** |
| criterio M2 (`query_latency_on_a_large_vault`, query peggiore) | **11,2 ms** | **2,6 ms** |
| banco della contesa, `query_index` testo a 8 thread, prestito esclusivo | 47 op/s (~21 ms) | **308 op/s (~3,2 ms)** |
| il primo tempo del pianificatore (`page: None`) con e senza estratti | **31,3 ms** | **4,9 ms** |
| il lavoro di tantivy per la pagina che si vede davvero (20 righe) | \-- | **0,20 ms** |

L'ultima riga è la misura che spiega tutte le altre: conteggio, raccolta dei
primi venti, rilettura dei venti documenti e generazione dei venti estratti
costano insieme **due decimi di millisecondo**. Il motore non c'entrava niente.

Il banco è [`crates/fub-features/examples/una_ricerca.rs`](../../crates/fub-features/examples/una_ricerca.rs),
si rilancia con `cargo run --release -p fub-features --example una_ricerca`, e
semina lo **stesso** vault sintetico del banco della contesa, riga per riga: non
per comodità, ma perché è la condizione perché i suoi numeri e quelli della 0024
parlino della stessa cosa.

## La decisione

**Una domanda testuale si fa in due tempi: si seleziona senza estratti, e gli
estratti si chiedono a chi ha selezionato per le sole righe rimaste. Che li si
voglia o no è nel contratto — `Excerpts`, accanto a `select` — e il default è
volerli.**

- `IndexQuery::Documents` guadagna `excerpts: Excerpts` (`Attach` | `Omit`), in
  fondo al record: additivo, quindi `wit/frozen/0.1.0.wit` non si tocca.
- Il pianificatore chiede `Omit` quando seleziona (`Router::ask`), annota **a
  chi** ha chiesto un'espressione che portava una foglia di testo, e dopo la
  finestra torna da quello stesso indice con la stessa espressione ristretta ai
  documenti sopravvissuti (`rehydrate`).
- `SearchIndex` non costruisce nemmeno il generatore quando nessuno ha chiesto
  gli estratti; il **punteggio** invece lo produce comunque, perché serve a
  ordinare.
- I due tempi sono presidiati da
  `a_provider_that_declared_nothing_is_never_asked` (la spia registra *cosa* le
  è stato chiesto: `Omit` prima, `Attach` poi) e da
  `excerpts_survive_the_planner`, che è il rosso che comparirebbe se il secondo
  tempo sparisse.

## Le decisioni prese, da NON ridiscutere senza motivo

### La finestra non si spinge dentro il motore, e la misura lo conferma invece di rimetterlo in discussione

La strada più corta sarebbe stata consegnare a tantivy anche la **finestra**:
top-20 dentro il motore, e nessun estratto di troppo da generare. Il commento
che lo vieta era già in `plan.rs` prima di questa voce, e regge parola per
parola: a pari rilevanza il contratto rompe la parità per `DocId`
([0020](0020-le-regole-in-un-posto-solo.md)), tantivy la rompe per indirizzo di
segmento — che non è un ordine stabile e **cambia quando i segmenti si
fondono**. Lasciargli scegliere quali righe stanno in pagina vorrebbe dire una
paginazione che ripete e salta righe, e la divergenza sarebbe muta.

Quindi il costo di **selezione** resta: duemila righe si materializzano davvero,
e sono i ~2,3 ms che restano. Quello che non resta è il costo di **racconto**,
che è la parte che nessuno guarderà mai. La distinzione fra le due è tutta
questa voce.

### Un campo nel contratto, e non un'euristica del kernel

L'alternativa senza contratto c'era ed è tentante: `page: None` → non generare
estratti. Sarebbe stata una regola **muta** che cambia la risposta a una domanda
legittima — «dammi tutti i risultati, con gli estratti» è ciò che vuole chi
esporta un elenco di risultati o chi ne fa un report — e l'avrebbe cambiata per
tutti i provider, compresi quelli di terzi, senza che nessuna firma lo dicesse.
Un provider che continuasse a produrli sarebbe stato «lento» per una regola che
non poteva leggere da nessuna parte.

E c'è la ragione di scadenza: la forma scade col **freeze di M4**, il
comportamento no. Un campo oggi costa un campo; fra un mese costa una migrazione
di versione. È lo stesso criterio con cui la
[0050](0050-cosa-si-chiede-a-una-ricerca.md) ha messo la tolleranza nel record
prima che il motore la onorasse.

### Il campo sta accanto a `select`, non dentro `TextQuery`

`TextQuery` sembrava il posto naturale — gli estratti li produce solo una foglia
di testo — ed è il posto sbagliato, per la regola che `abi/query.rs` scrive in
testa a sé stesso: **un predicato è un fatto sul vault, non un servizio**. «Le
note che parlano di memoria» è un fatto; «e raccontamele» non lo è: è la stessa
specie di richiesta di `select`, cioè *cosa torna indietro*, e sta dove sta
quella.

La prova che la distinzione non è teorica: una query salvata (una collezione, un
template) è fatta di predicati, e si serializza. Con il campo dentro
`TextQuery`, ogni collezione salvata si porterebbe dietro per sempre la
preferenza sugli estratti di chi l'ha creata — che è il difetto che
`partial_last_term` documenta al proprio posto, ed è già costato un paragrafo
là.

### Il default è `Attach`, e il verso in cui si sbaglia è scelto

Serde e WIT danno il primo caso a chi non nomina il campo. Con `Omit` per primo,
un chiamante vecchio — o un plugin compilato contro una minor precedente —
riceverebbe risposte **mute**: risultati giusti, senza estratti, senza nessun
errore e senza nessun modo di capire perché. Con `Attach` per primo, chi non sa
del campo paga come pagava prima. Costa un giro che si poteva risparmiare, e in
cambio non c'è nessuno stato in cui una risposta si impoverisce in silenzio.

### Il secondo tempo non riparte dal routing: torna da chi ha selezionato

`rehydrate` non ricomincia da capo. Il `Router` annota
`(bersaglio, espressione)` per le espressioni che portavano una foglia di testo,
e il secondo giro va esattamente lì. Ricominciare dal routing avrebbe voluto
dire fare una domanda **diversa** da quella che ha prodotto le righe, e sperare
che il pianificatore la smistasse allo stesso modo — cioè far dipendere
l'estratto di una riga da una seconda decisione che nessuno confronta con la
prima.

La mossa non è nuova ed è per questo che è sicura: sostituire un'espressione con
i documenti che ne escono (`QueryPredicate::Docs`) è ciò che `resolve_for` fa
già, per le foglie che il destinatario non saprebbe valutare. Qui la stessa
mossa è applicata **dopo** invece che prima. Ed è anche la stessa disciplina con
cui il kernel aggiunge le occorrenze (`Workspace::localize`, §21.3): si
arricchisce la **pagina**, non il vault — e quella funzione, che tocca il disco
una volta per documento, era già scritta dopo la finestra da prima di questa
voce. La ricerca faceva la cosa giusta un livello sopra e quella sbagliata un
livello sotto.

### Il punteggio non è un estratto, e il codice diceva il contrario

Trovato scrivendo la modifica, e vale come trappola: in `SearchIndex::search` il
`hit.score` veniva assegnato **dentro** il ramo che genera lo snippet. Le due
cose nascono dalla stessa condizione — c'è una foglia di testo — ma non sono la
stessa cosa: la rilevanza serve a **ordinare**, e ordinare è precisamente ciò
che si fa *prima* di sapere quale pagina resta. Omettere gli estratti avrebbe
portato via anche il punteggio, e il risultato sarebbe stato una ricerca che
rimette tutto in ordine di `DocId` senza dirlo — cioè il difetto che questa voce
voleva misurare, sostituito da uno peggiore.

Il presidio è `omitting_excerpts_keeps_relevance`, e non si accontenta di
guardare il campo: chiede che la nota **intitolata** «Memoria» resti prima delle
altre, cioè che il boost del titolo si veda ancora. Un `score: Some(0.0)` per
tutti passerebbe il primo controllo e non il secondo.

## Cosa resta fuori, e perché

**I ~2,3 ms della selezione restano.** Sono duemila `DocumentMatch`
materializzati, con una lettura del campo `doc_id` STORED per ciascuno. Si
potrebbero togliere quasi tutti — un campo FAST per il `doc_id`, o un collector
che non ricostruisce i documenti — ma è un cambio di **schema** dell'indice,
cioè una reindicizzazione per chi aggiorna, e comprerebbe un fattore piccolo su
un costo che già non si vede. La riga di questa voce che valeva era il fattore
100, non il fattore 2.

**Il costo cresce ancora con la larghezza della finestra**, e più di quanto
costino gli estratti da soli: page 100 costa 6,4 ms contro i 3,4 di page 20,
perché il secondo tempo rifà una query con cento termini `Docs` dentro. È
lineare, è sulla pagina e non sul vault, e nessuna superficie chiede cento
risultati in una volta — quando qualcuna lo chiederà, il posto da guardare è
questo.

**Nessun presidio automatico sul tempo.** La soglia di M2 («< 50 ms») è rimasta
dov'era: continua a dire ciò che diceva, e questa voce ha appena mostrato cosa
non dice. Un presidio che asserisse «meno di N ms» sulla CI misurerebbe la
macchina di CI; il banco resta un `example` che si lancia a mano, come la
contesa, e il numero si scrive nel verbale che lo ha prodotto.

**La §21.5 non è stata toccata.** L'autocompletamento dei wikilink continua a
chiedere l'elenco intero del vault a ogni apertura di `[[`, e adesso lo paga
meno — ma il difetto di quella voce non era il costo per giro, era il giro.

## I precedenti

**Un criterio di accettazione si misura dalla porta da cui passa chi lo userà.**
I 108 µs di M2 erano veri e misuravano `SearchIndex` **nudo**; l'utente non
passa mai di lì — passa dal workspace, cioè dal pianificatore. Il criterio non
era sbagliato di numero: era sbagliato di **soggetto**, e un criterio con il
soggetto sbagliato resta verde per sempre. È la stessa specie di difetto della
[0068](0068-un-vault-si-apre-per-quel-che-si-legge.md), dove un presidio
attraversava una promessa senza asserirla.

**Una soglia larga non è un presidio di prestazione.** Il test
`query_latency_on_a_large_vault` misurava 11,2 ms contro una soglia di 50 ed era
verde con un margine di 4,5×, mentre il lavoro utile era 0,2 ms — cioè un
fattore **cinquanta** di spreco, dentro il margine. Una soglia dice se qualcosa
è tollerabile; solo il rapporto con il lavoro utile dice se è **giusto**. Da qui
in avanti, davanti a un tempo che sembra accettabile, la domanda da fare non è
«sta sotto la soglia» ma «quanto di questo è il lavoro che serviva».

**Un totale non si sa dove tagliare.** La 0024 aveva lasciato scritto un numero
totale e una domanda; la risposta è arrivata solo quando lo stesso costo è stato
misurato **per fase** e **per variabile** — quante note combaciano, quante se ne
chiedono, se ci sono estratti da fare. Il banco è costruito così di proposito:
varia una cosa alla volta, e la riga «termine selettivo: 0,01 ms» accanto alla
riga «termine comune: 22 ms» dice da sola che il costo non era della query ma di
quante ne combaciava. Un profiler avrebbe dato la stessa risposta e non sarebbe
rimasto nel repo.

**Chi non sa cosa succederà del proprio lavoro lo fa tutto.** È la forma
generale del difetto, e non ha niente a che vedere con la ricerca: `SearchIndex`
si comportava benissimo: gli era stata fatta una domanda («tutti i documenti che
combaciano, con gli estratti») e rispondeva esattamente a quella. Il difetto
stava nel **linguaggio**, che non aveva la parola per dire che quel lavoro
sarebbe stato buttato. Dove il kernel chiede a un provider più di quanto userà,
la domanda da porsi è se il contratto sappia dire *quanto ne userà* — e questa è
la prima volta che la risposta era no.
