# 0060 — Il modello dice il vero sui byte del file, e un corpus che nessuno confronta non cresce

|  |  |
|---|---|
| **Decisa** | 2026-07-30 |
| **Origine** | `todo.md` §17.1 ([seduta 17](../roadmap/17-presidi-che-restano.md)) — **prima metà**: il corpus e il fuzzing. Il banco delle prestazioni resta, e con lui la voce |
| **Commit** | il presidio in `71bddab`, i documenti in *questo commit* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/17-presidi-che-restano.md) ·
[il banco del lato provider, 0054](0054-il-banco-del-lato-provider.md) ·
[la sorgente di uno `Span`, 0058](0058-un-nome-che-nasce.md) ·
[la rete della 0059](0059-la-generazione-non-e-un-round-trip.md)

---

Il §17.1 chiede cinque cose: il fuzzing del parser, un corpus di conformità, i
benchmark su vault sintetici grandi con delle soglie, il presidio della §8.4 che
aspetta una macchina per poter girare, e il round-trip import/export rifatto sul
corpus. **Il criterio della seduta 17 le divide in due**, e non è una divisione
che questo verbale ha inventato per comodità: il cappello di quella seduta
giudica le sue voci su *se il costo cresce con l'attesa*, e dentro il §17.1 la
risposta è diversa per le prime due e per le altre. Per il corpus cresce — «ogni
sintassi nuova è un caso in più da scrivere a posteriori» — e per il banco delle
prestazioni no: quello aspetta **una macchina**, non una decisione, e lo dice la
voce stessa raccontando il proprio inquilino.

Quindi qui si chiude **mezza voce**, ed è la metà il cui costo cresceva.

## Cosa si prova, e cosa non si prova

Un corpus di conformità markdown sembra chiedere una cosa che non è quella
giusta: *comrak è conforme a CommonMark?* Non è una proprietà di Fub — è una
proprietà di una dipendenza, e asserirla renderebbe questa suite rossa il giorno
in cui comrak **corregge** un bug, cioè trasformerebbe un presidio in un
ostacolo all'aggiornamento.

La proprietà di Fub è l'altra, e finora nessuno la chiedeva:

> **Ciò che il modello dice del documento è vero rispetto ai byte del file.**

Vale più di tutto il resto di questa suite, e la ragione non è il pannello
disegnato male. Gli span sono **le coordinate con cui si riscrive un file**: una
modifica programmatica è una patch chirurgica guidata da uno span
([0008](0008-modifica-chirurgica.md)), e uno span che mente di un byte non
disegna male — **corrompe un documento.** Spunta la task sbagliata, rinomina
dentro la parola accanto, taglia un carattere a metà. E lo fa senza diventare
rosso, perché il file resta UTF-8 valido e l'unico che se ne accorge è chi tiene
il vault sotto git. È lo stesso danno della
[0059](0059-la-generazione-non-e-un-round-trip.md), preso dal lato di chi
*produce* le coordinate invece che dal lato di chi riscrive senza usarle.

## La sezione che c'era aveva due proprietà e nessun cliente

`fub_sdk::testing::conformita` nasce con la
[0054](0054-il-banco-del-lato-provider.md), e la sua sezione `FormatProvider`
era tre funzioni: un aggregatore e due proprietà — un provider testuale rifiuta
i byte grezzi, un descrittore dichiara almeno un'estensione. **Nessuna delle due
guardava un documento parsato.**

E nessuno le chiamava. Cercate in tutto il repo al commit precedente: una
compariva in un posto solo, **la tabella della 0054 che la elencava**; l'altra —
`il_descrittore_dichiara_almeno_una_estensione` — da nessuna parte fuori dal
proprio file, tabella compresa, e la sua riga in quella tabella l'ha aggiunta
questo lavoro. Il cliente vero della suite c'era, ed era
`fub-features/tests/conformita.rs`, ma passa le view — non un formato, perché in
`fub-features` non ce n'è nessuno.

Cioè la sezione `FormatProvider` del banco era esattamente ciò che la 0054
dichiara vietato, nel suo stesso verbale, una trentina di righe dopo averle
scritte:

> …una suite di conformità che nessuna implementazione vera passa non è una
> suite, è un'opinione.

Non era un'omissione da niente. Il markdown è **l'unico provider di formato di
produzione che esiste**, e il crate che lo implementa dipende dall'SDK già oggi
(`fub-sdk = { workspace = true }`): il cliente non mancava per un confine fra
crate, mancava perché nessuno lo aveva scritto. Un secondo candidato c'era e non
è un test — `TestoDiProva` in `fub-testkit/src/formato.rs`, che è codice di
libreria — e non chiamava la suite nemmeno lui.

## Fatto

- [x] **Sei proprietà nuove e due aggregatori**, in
      [`crates/fub-sdk/src/testing/conformita.rs`](../../crates/fub-sdk/src/testing/conformita.rs):
      l'id che il modello dichiara è quello che gli è stato dato; **gli span
      affettano la sorgente**, stanno dentro il padre e non si sovrappongono al
      fratello; le tabelle piatte sono la proiezione dell'albero; lo slug di un
      heading è quello del contratto; il BOM in testa non è contenuto; `parse` è
      deterministico. Stanno nell'SDK e non nel crate del markdown perché sono
      di un `FormatProvider` **qualunque** — un secondo provider (org-mode,
      AsciiDoc, il canvas di 21.2) le eredita senza riscriverle.
- [x] **Il corpus**, in
      [`crates/fub-format-markdown/tests/il_corpus.rs`](../../crates/fub-format-markdown/tests/il_corpus.rs):
      sessantadue casi, ognuno con un nome che si legge nel fallimento. Ogni
      variante di `Block` e di `Inline`, ogni `custom_kind` che il provider
      emette, le due forme di ancora più il caso che non è un'ancora
      (`2^10 = 1024`), il frontmatter con ogni specie di
      proprietà, le forme ostili del testo della [0058](0058-un-nome-che-nasce.md)
      (CRLF, `\r` nudo, terminatori misti, BOM, NFD, fuori dal BMP, vuoto), e un
      documento che ha tutto insieme.
- [x] **Tre direzioni di confronto**, perché un corpus è un elenco scritto a
  mano e il §16.7 ha stabilito cosa lo tiene sano
  ([0056](0056-un-elenco-che-e-la-sorgente.md)): non ci si itera sopra, si
  **confronta** con sorgenti che non sono lui. Le varianti di `Block` e `Inline`
  e i `custom_kind` del registro, estratti dal **testo** di `abi/src/model.rs`;
  le sintassi che il provider dichiara in `capabilities()`. Un costrutto che
  nessun caso esercita fa diventare rosso il file, e da lì il costo lo paga chi
  aggiunge la sintassi **nel giro in cui la aggiunge** — che è il modo in cui il
  costo di questa voce ha smesso di crescere con l'attesa.
- [x] **Tredici divergenze dichiarate**, una riga per divergenza, con la ragione
  in un `enum Perche` a quattro varianti. Ogni riga è un'affermazione su come le
  cose stanno **oggi**: il giorno in cui qualcuno la ripara la riga diventa
  rossa e va tolta.
- [x] **Il fuzzer**, nello stesso file: xorshift64\* scritto a mano, dodici
  righe, nessuna dipendenza nuova. Semenza il corpus, sette mutazioni con un
  nome, e a ogni push ventimila casi da un seme fisso.
- [x] **Cinque riparazioni di produzione**, in `offsets.rs` e `parse.rs`, tutte
  trovate dal presidio e nessuna cercata. Sotto.

## Le decisioni

*Le proprietà nell'SDK, l'ingresso nel crate del provider.* È la stessa domanda
che la [0059](0059-la-generazione-non-e-un-round-trip.md) ha posto al contrario
— *di chi è la garanzia?* — e qui la risposta divide un lavoro solo in due file.
«Uno span affetta la sorgente» è di ogni formato; `"# Titolo\n"` è markdown. Se
il corpus stesse nell'SDK, il banco del contratto conoscerebbe la sintassi di un
suo cliente; se le proprietà stessero nel crate del markdown, il secondo
provider le riscriverebbe — e due idee della stessa proprietà è il modo in cui
due presidi finiscono per non essere d'accordo
([0020](0020-le-regole-in-un-posto-solo.md)).

*Due pretese, e non una.* `Pretesa::CheAffettino` e `Pretesa::ELaCoerenza`. La
differenza **non è di severità, è di destinatario**: su un ingresso curato si
pretende tutto, su uno generato solo ciò la cui violazione produce un panico o
una scrittura alla cieca. La ragione è che su input costruiti per essere ostili
il provider eredita da comrak delle incoerenze di `sourcepos` che sono difetti
veri ma la cui riparazione è *una decisione su cosa sia lo span di un nodo* — e
pretenderla da un fuzzer avrebbe un effetto solo: il fuzzer resta rosso, e chi
lo trova rosso lo disattiva. Il caso che ha imposto la distinzione è nell'elenco
delle divergenze, ed è markdown perfettamente normale: nella forma **stretta**
della definition list (senza riga vuota fra il termine e la definizione) il
termine ha uno span di **un byte**. Finché non è deciso *cosa sia* quello span,
la coerenza non è una cosa che si possa pretendere su qualunque ingresso.

*Il corpus è codice, non file committati.* Un file con un BOM o con CRLF dentro
un repo è alla mercé di `.gitattributes`, degli editor e dei checkout su
Windows: è la ragione della [0058](0058-un-nome-che-nasce.md), e le forme ostili
del testo sono metà del valore di questo corpus. Come stringhe Rust i byte sono
quelli che si leggono.

*Una divergenza si dichiara, non si toglie dal corpus.* La regola che tiene
onesto il file è una: **un caso che non passa le proprietà non si toglie, si
sposta in `divergenze_dichiarate`.** Togliere un ingresso perché è rosso è il
solo modo di trasformare un presidio in un'opinione, e la lista esiste perché
quel gesto abbia un'alternativa che costa meno. La forma è quella dell'allowlist
della [0059](0059-la-generazione-non-e-un-round-trip.md), e la ragione per cui è
un predicato in un test invece di una riga di prosa in un documento è la
[§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md): **una prosa non diventa
rossa.**

*Un fuzzer scritto a mano, non `cargo-fuzz`.* È la scelta ovvia e non è questa.
libFuzzer vuole nightly, un crate fuori dal workspace e una macchina che lo
esegua a lungo: diventerebbe il gemello dell'inquilino di questa stessa voce —
il presidio della §8.4, che c'è e **non gira** — e un presidio che non gira è
peggio di uno che non c'è, perché qualcuno crede che ci sia. Ciò che si è
costruito è un'altra cosa e va chiamata col suo nome: una **rete di regressione
deterministica**. Seme fisso, conteggio fisso, la stessa corsa su tre sistemi
operativi, e un fallimento riproducibile da due variabili d'ambiente stampate
nel messaggio. L'esplorazione guidata dalla copertura resta **dichiarata
fuori**, e va con la macchina della seconda metà.

*Ventimila casi a ogni push.* Costa 2,5 secondi dei 2,6 che il file intero
prende in debug. La corsa lunga si chiede a mano (`FUB_FUZZ_CASI`), e cinque
milioni di casi in release stanno in un minuto e mezzo: il numero di default è
quello che tiene un presidio dentro un `cargo test --workspace` senza che
nessuno abbia ragione di volerlo saltare.

*L'ancoraggio al confine di carattere sta in `Offsets::byte`, non nei
chiamanti.* Quella funzione è l'imbuto: ogni `Span` che il provider produce
passa da lì — oggi per i due soli usi che `sourcepos_span` ne fa, l'inizio e la
fine. Metterlo là vorrebbe dire scriverlo due volte adesso e ricordarselo al
terzo uso, che è la forma di regola che si dimentica; nell'imbuto vale anche per
il chiamante che non c'è ancora.

## La prova che diventa rossa quando deve

Un presidio che non si è mai visto fallire è un presidio di cui non si sa
niente, e su una suite di **proprietà** la regola vale doppio: una proprietà
troppo debole passa su tutto e non lo dice. Ognuna è stata vista rossa, e la
terza colonna dice **l'osso** del messaggio che ha stampato — non il messaggio
alla lettera, che è lungo cinque righe e porta il perché.

| asserzione | come | cosa ha detto |
|---|---|---|
| lo span affetta | il fuzzer, caso 925 396, su `\| a \|\n\| - \|\n e #tag🎉\n` | lo span di una cella è `12..22` e non affetta la sorgente, che è di 24 byte |
| non è invertito | il fuzzer, caso 1 771 834, su `> > ---\na: 1\n---\n\n# Corpo\n` | `Span { start: 4, end: 3 }` |
| sta dentro il padre | il corpus, `- a\n\n***\n` | una voce di lista esce dallo span della sua lista |
| i fratelli sono disgiunti | il fuzzer, caso 348, su una mutazione di «tabella con allineamenti» che le infila un `\r` dentro la riga di dati | due celle si sovrappongono, e rivendicano lo stesso byte `47..48` |
| lo span non è vuoto | il fuzzer a un milione e mezzo, su `1. a\n2. ---\ntitolo: X\n---\n\n# Corpo\n` | un blocco ha span vuoto, `8..8` |
| la proiezione dell'albero | il corpus, `[[#Sezione]]` | la tabella `tags` non è la proiezione dell'albero |
| lo slug è del contratto | rotta: il provider si riscrive la regola | rossa sul caso fuori dal BMP |
| il BOM | il fuzzer, un `U+FEFF` in mezzo a un titolo — e la prima stesura della proprietà pretendeva troppo (sotto) | la proprietà rossa su un documento in cui il BOM **è** contenuto |
| l'id | rotta: il basename invece dell'id | `un provider che ne mette un altro non sbaglia il parse…` |
| il determinismo | rotta: un contatore che entra in un `Text` | `due parse della stessa sorgente hanno dato due modelli diversi` |
| la copertura, «manca» | rotta: `"Table"` → `"Tabella"` | `il corpus non esercita le varianti di Block: ["Table"]` |
| la copertura, «di troppo» | rotta: un nome inventato nell'osservazione | `il corpus produce … che la sorgente non conosce: ["Inventato"]` |
| la copertura, «una scusa che non serve» | rotta: `callout` fra gli scusati | `l'elenco degli scusati … nomina ["callout"], che o il corpus produce già…` |
| l'estrattore a vuoto | rotta: `pub enumm` | `l'elenco atteso di le varianti di Block è **vuoto**` |
| le divergenze dichiarate | **due volte per davvero**, mentre si scriveva il predicato della tabella col `\r` | `la divergenza dichiarata «…» non si presenta più su …` |

Tre righe di questa tabella meritano il commento che non stava nella colonna.

Sulla riga del BOM c'è un secondo esperimento, e il suo esito è più interessante
di quello che cercava: togliendo `strip_bom` da `parse_markdown` la suite
diventa rossa lo stesso, ma **su un'altra proprietà** — due blocchi fratelli che
si sovrappongono, sul caso `bom` del corpus. Vale la pena scriverlo perché
misura quanto è larga la proprietà degli span: un BOM che cola dentro il
contenuto sposta gli offset di tre byte, e chi se ne accorge non è il presidio
del BOM, è la disgiunzione dei fratelli. Due reti che pescano lo stesso difetto
da due lati sono la ragione per cui vale la pena tenerle entrambe.

La sesta ha trovato un buco **nel presidio stesso**: la prima stesura del
camminatore dell'albero non scendeva dentro l'etichetta di un link, e su
`[[#Sezione]]` la tabella `tags` dichiarava un tag che l'albero — letto male —
non conteneva. La proprietà era giusta, il modo di calcolarne un lato no. È il
tipo di errore che rende un confronto verde per sempre, e l'ha scoperto perché
l'altro lato del confronto era un dato vero e non un secondo elenco a mano.

L'ultima è la sola che nessuno ha provocato: scrivendo il predicato della
divergenza «un `\r` nudo dentro una riga di tabella la spezza in due» il
predicato era sbagliato **due volte di fila**, e l'elenco delle divergenze lo ha
detto entrambe. Una lista di difetti noti che sa dire «questo difetto non c'è
più» è la sola forma di lista di difetti noti che non diventi folklore.

## Le riparazioni, e perché due di loro non riparano niente

Cinque difetti di produzione, tutti trovati dal presidio, ognuno col commento
che spiega il grilletto accanto alla riga che lo chiude.

| dove | il difetto | il grilletto |
|---|---|---|
| `offsets.rs` | `Offsets` contava le righe **solo sui `\n`**. In CommonMark il `\r` nudo è un terminatore: dal primo in poi la tabella riga→byte è desincronizzata da quella di comrak, e **ogni span del documento è sbagliato di righe intere** | il fuzzer, un `\r` in mezzo a un file a `\n` |
| `offsets.rs` | `byte()` poteva restituire un offset **in mezzo a un carattere** | il fuzzer, una cella a metà dei quattro byte di `🎉` |
| `parse.rs` | `sourcepos_span` poteva produrre uno span **invertito** (`start > end`) | il fuzzer, una citazione annidata la cui prima riga è un delimitatore di frontmatter |
| `parse.rs` | l'ultima voce di una lista **usciva dalla lista**, portandosi dentro il separatore che la lista non ha (`- a\n\n***\n` → lista `0..3`, voce `0..4`) | il corpus |
| `parse.rs` | due celle di tabella potevano **rivendicare gli stessi byte** | il fuzzer, un `\r` dentro una riga di tabella |

Il primo è il difetto peggiore dei cinque, e la ragione è **come si
presentava**: non produceva un errore, produceva un numero. Su un file
interamente a `\r` le righe di comrak finivano oltre la fine della tabella, e
`byte()` — robusto ai valori fuori range — le riportava alla fine del file: span
vuoti in coda, affettabili e plausibili. Serviva un `\r` **in mezzo** a un file
a `\n`, dove lo scarto è di una riga sola e due blocchi finiscono per
sovrapporsi, perché il sintomo diventasse visibile. Una rinomina guidata dallo
span di un wikilink, su un file così, riscrive i byte di un'altra riga.

**E due di quelle righe non rendono giusto un numero sbagliato: rendono
impossibile che un numero sbagliato diventi un panico.** L'ancoraggio al confine
di carattere di `Offsets::byte` e il `max(start)` di `sourcepos_span` non sanno
dov'era lo span giusto e non provano a indovinarlo — garantiscono che nessuno
vada in panico ritagliando. È esattamente la distinzione con cui il §17.1 chiede
il fuzzing del parser — *«un parser che pania è un vault che non si apre»*, e la
casella che lo chiede è il capitolo 5.3 di [FEATURES.md](../FEATURES.md). Un
offset sbagliato è un difetto; `&source[a..b]` che pania all'apertura di una
nota è un vault che non si apre, e sono due gravità diverse anche quando la
causa è la stessa.

## Tre volte la proprietà aveva ragione sul metodo e torto sul merito

Vale la pena scriverlo perché è il rischio proprio di questo genere di presidio:
una proprietà è una frase in italiano prima di essere un `assert`, e una frase
plausibile può pretendere una cosa che il dominio non concede.

**Il marcatore di un'ancora doveva stare dentro il suo span.** Non è vero, e non
per un difetto: la forma «ancora su riga propria» (`Un paragrafo\n\n^abc123\n`),
che è quella di Obsidian, mette il marcatore **fuori** dal blocco che marca — ed
è giusto così, perché è ciò che fa sì che l'embed del blocco non si porti dietro
l'id. Ciò che si può pretendere è che il marcatore **nomini** l'ancora, e la
proprietà adesso chiede quello.

**I fratelli dovevano essere in ordine di sorgente.** Neanche: `body` è
documentato come «l'albero a blocchi (per il rendering)», e l'ordine della resa
non è quello del file. A smentirla sono le note a piè di pagina, che finiscono
in coda a `body` con lo span che punta in mezzo al documento — dove vanno rese.
Pretendere l'ordine avrebbe voluto dire chiedere a ogni provider di rinunciare a
quella libertà per far passare un presidio. Resta la disgiunzione, che è ciò che
serve davvero a chi scrive.

**Nessun `U+FEFF` doveva finire nel modello.** Falso al primo colpo del fuzzer,
che ne ha infilato uno in mezzo a un titolo: in mezzo a un documento un `U+FEFF`
è **contenuto** — uno spazio a larghezza zero che un utente può avere incollato
e che il file dichiara. Un presidio che ne avesse preteso la rimozione avrebbe
chiesto al provider di **modificare il documento dell'utente**, che è il
contrario della §2.4 di [FEATURES.md](../FEATURES.md). Ciò che è vero è più
stretto: il BOM **in testa** è sorgente e non contenuto, e la proprietà è
diventata un conteggio con una franchigia.

Le prime due le ha smentite il corpus curato, la terza il fuzzer. È l'argomento
più corto in favore di avere **due** sorgenti d'ingresso invece di una.

## I numeri e i nomi che erano sbagliati

Contati oggi, col criterio dichiarato perché il prossimo possa ricontarli — è la
disciplina della [0052](0052-cio-che-va-storto-e-un-evento.md).

| dove | diceva | è |
|---|---|---|
| [0054](0054-il-banco-del-lato-provider.md), «un terzo crate per **otto** funzioni» e la tabella che le elenca | 8 | **23** — `grep -c "^pub fn " crates/fub-sdk/src/testing/conformita.rs`; erano **14** già nel commit che scriveva «otto» |
| [todo.md](../todo.md), «i verbali delle decisioni chiuse — **cinquantasette**» | 57 | **60** con questo — `ls docs/decisions/0*.md \| wc -l` |
| [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md), «oggi: **129** file, **2336** link» | 129 / 2336 | vedi la [Verifica](#verifica) — ed è la **nona** volta che quel numero si ritrova falso |
| [0057](0057-la-dieta-dell-ipc.md) e il §16.6, «`i_debiti_dichiarati_sono_cinque` asserisce il conteggio» | un nome che non esiste | il test si chiama **`il_debito_dichiarato_e_un_numero_presidiato`** (`crates/fub-app/tests/dieta_ipc.rs`) — l'asserzione a cinque c'è, il nome no |

Il primo è il caso interessante, e non per la dimensione dello scarto: era
**falso il giorno in cui è stato scritto.** La 0054 elencava otto proprietà in
una tabella e ne contava otto nel paragrafo che scartava un terzo crate, mentre
il file che stava creando ne aveva già quattordici — tre aggregatori e tre
proprietà che la tabella non nominava. Non è un numero invecchiato: è un numero
che **nessuno ha mai ricavato dalla sua sorgente**, e la differenza conta perché
decide la riparazione. Un numero invecchiato si aggiorna; un numero senza
sorgente si aggiorna e torna falso al giro dopo — ed è precisamente il difetto
della [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md).

Quindi la tabella della 0054 è stata completata e la frase che contava le
funzioni **non conta più niente**: l'argomento che faceva — un terzo crate con
le stesse dipendenze dell'SDK non si giustifica — non ha mai avuto bisogno di un
numero. Le due correzioni sono consegnate alla §16.8, che è la voce che
quell'elenco tiene, per il criterio della [0058](0058-un-nome-che-nasce.md): una
riga va dove la cercherà chi la farà, e per questo **non entra fra le caselle
residue** di `todo.md`. Il conteggio dei verbali invece resta dov'è: `todo.md` e
`decisions/README.md` sono i due posti in cui
[CONTRIBUTING.md](../CONTRIBUTING.md) dichiara che i numeri che cambiano possono
stare, e lì un numero sbagliato si corregge senza cambiare indirizzo.

L'ultima riga è di un'altra specie e non è un numero: è la **sesta** — una frase
che dice «presidiato da X» con un X che non esiste. Il fatto sotto è vero (il
test c'è, e asserisce cinque), quindi non è una garanzia mai esistita come
quella della [0054](0054-il-banco-del-lato-provider.md): è il suo caso mite,
dove la rete è tesa e il nome col quale la si cerca è sbagliato. Vale la pena
distinguerlo perché il presidio è lo stesso e costa meno di tutti gli altri:
**un nome di test è una cosa che si cerca a macchina**, ed è ciò che la §16.8
chiede al penultimo capoverso. Corretta in due punti, `0057` e la §16.6.

E c'è un giro che è nato da qui e non finisce qui. Avendo in mano il criterio —
*ogni numero scritto in un documento si ricontrolla col comando che lo produce*
— sono stati ricontati anche i numeri che questo lavoro non toccava, e ne sono
usciti altri cinque falsi più una **famiglia nuova di bersagli**: i numeri di
riga dentro i link `[file.rs:N]`, che `check-doc-links.mjs` non guarda mentre
apre il file che li porta. Non sono riparati qui, perché ripararli è il lavoro
della §16.8: sono consegnati là, col comando accanto, che è l'unico posto in cui
chi li prenderà li cercherà. I sei di
[data-model.md](../architecture/data-model.md) sono l'eccezione, e per una
ragione minuscola: quel file era già aperto in questo giro.

## Le maglie che lasciano passare

Se una copertura ha un limite, il limite va detto accanto alla copertura o si
crederà che copra ([0056](0056-un-elenco-che-e-la-sorgente.md)).

- **Da questa porta passa solo UTF-8 valido**, perché `parse` prende testo. I
  byte non decodificabili non sono un buco: il provider li rifiuta per
  contratto, e la proprietà che lo dice è `un_provider_testuale_rifiuta_i_byte`.
- **Il seme è fisso**, quindi questa è una rete di regressione e non
  un'esplorazione. Cercare davvero è alzare `FUB_FUZZ_CASI` a mano, oppure è il
  lavoro di libFuzzer, che sta con la macchina della seconda metà.
- **L'estrattore delle varianti legge i sorgenti come testo.** Un `enum`
  generato da una macro, o una variante scritta sulla stessa riga della graffa,
  non li vedrebbe. Nessuna delle due forme esiste in `model.rs`, che
  `cargo fmt --all --check` tiene su una variante per riga — ed è la stessa
  maglia larga della [0059](0059-la-generazione-non-e-un-round-trip.md), messa
  dove il pesce passa.
- **Il fuzzer non pretende la coerenza degli span**, per la ragione di
  `Pretesa`. Su ingresso generato resta scoperto tutto ciò che produce un
  modello discutibile senza produrre un panico.
- **`ogni_voce_del_corpus_produce_un_modello_che_dice_il_vero` conta**, e il
  conteggio è un presidio suo: un corpus che si svuotasse passerebbe sempre,
  quindi il test rifiuta di essere verde con meno di cinquantuno casi
  verificati. Lo stesso vale per il fuzzer, che pretende che più di metà delle
  mutazioni produca un modello — un generatore che producesse solo sorgenti
  rifiutate starebbe verificando `Err`, non le proprietà.

## Perché la seconda metà resta aperta, e cosa la sblocca

Il §17.1 resta una voce aperta di `todo.md`, ed è il **terzo** caso di mezza
voce dopo la [0031](0031-chi-possiede-i-bundle.md) e la
[0037](0037-lo-stato-di-vista.md). La ragione è diversa da entrambe, e vale la
pena distinguerla: là mancava metà del ragionamento (0031) o il modello su cui
la seconda metà poggia (0037). Qui il ragionamento è intero e la metà che resta
non aspetta una decisione — **aspetta un posto dove girare**.

Lo dice la voce stessa, raccontando l'inquilino che ha già: il presidio della
§8.4 ([0026](0026-due-query-insieme.md)) è `#[ignore]` non perché la proprietà
sia falsa, ma perché «ogni colonna misura una trentina di millisecondi» e a
quella scala il tempo se lo prendono lo spawn dei thread e lo scheduling.
Servono un carico che domini l'overhead **e** una macchina che non divida i
core. Nessuna delle due è una firma, nessuna scade col freeze, e nessuna si
compra scrivendo codice: è la parte di questa voce il cui costo **non** cresce
con l'attesa, e per questo è quella che aspetta.

«Due metà» è una semplificazione, e va detta: delle cinque caselle, due sono
chiuse, due aspettano la macchina, e la quinta — il round-trip sul corpus — non
aspetta nessuna delle due cose. La sua precondizione era **il corpus**, e adesso
c'è: è lavoro, e la voce lo dice così. Il taglio di questo verbale è fra ciò il
cui costo cresceva e ciò che aspetta un posto dove girare; una casella che non
sta né di qua né di là si dichiara, invece di essere fatta rientrare nella metà
sbagliata per far tornare la simmetria.

## Cosa si è scartato

- **`cargo-fuzz` / libFuzzer.** Sopra, con la sua ragione: diventerebbe il
  secondo presidio di questa voce che non gira.
- **Un corpus di file committati** invece di stringhe Rust. Metà del valore del
  corpus sono i byte che `.gitattributes` e i checkout su Windows riscrivono.
- **Snapshot del modello parsato** (`insta` o un JSON committato per caso), che
  è la forma canonica di un corpus di conformità. Sarebbero sessantadue file che
  cambiano insieme ogni volta che comrak aggiusta un `sourcepos`, e una review
  in cui nessuno distingue la riga che conta dalle altre sessantuno. Una
  proprietà dice **perché** un modello è sbagliato; uno snapshot dice solo che è
  diverso. Il round-trip sul corpus che il §17.1 chiede è l'altra faccia di
  questo — «esce e rientra identico» invece di «il modello dice il vero» — e non
  è stato fatto qui: sotto, fra ciò che resta.
- **Pretendere la conformità a CommonMark.** È una proprietà di comrak, e
  asserirla legherebbe la suite ai suoi bug.
- **Togliere dal corpus i casi che non passano.** È il gesto che trasforma un
  presidio in un'opinione; l'alternativa che costa meno è
  `divergenze_dichiarate`.
- **Riparare le divergenze adesso.** Tredici righe, e almeno tre chiedono una
  decisione sul modello (dove va il barrato, cosa è lo span di un termine di
  definition list, se l'alt di un'immagine è testo indicizzato). Dichiararle è
  ciò che le rende visibili senza fermare il lavoro; ripararle è lavoro con un
  suo verbale.
- **Un puntatore al corpus in [traits.md](../architecture/traits.md)**, dove
  `FormatProvider` è documentato per chi ne scrive uno. Ci starebbe, e non è
  stato scritto per la ragione della
  [0059](0059-la-generazione-non-e-un-round-trip.md): quella prosa è vera com'è,
  e non diventa falsa senza il puntatore. Sta qui annotato, dove chi vorrà
  prenderlo lo trova.

## Cosa resta fuori, dichiarato

- **Il fuzzing dell'HTML in ingresso**, che il §17.1 chiede nella stessa riga
  del markdown. Non ha soggetto: nel repo non c'è nessun parser HTML — l'HTML è
  solo in **uscita**, dalla resa. Il giorno che l'import da HTML esiste, il
  fuzzer di quel provider si scrive come questo, e le proprietà dell'SDK sono
  già le sue.
- **Il banco delle prestazioni e l'inquilino della §8.4**: la seconda metà,
  sopra, ed è ciò che aspetta la macchina.
- **Il round-trip import/export sul corpus**, che invece non aspetta niente: la
  sua precondizione era il corpus, e adesso c'è. Non è nella metà che aspetta la
  macchina — è **lavoro**, e la riga della voce lo dice così. Chi la prende
  tenga conto che i sessantadue casi sono *sorgenti* e non vault, e che le
  tredici divergenze dichiarate sono l'elenco di ciò che un round-trip non può
  pretendere finché non sono riparate.
- **`bersagli` non ha un cliente**, e va detto qui invece di lasciarlo scoprire:
  è la nona `pub fn` che questo lavoro aggiunge all'SDK — l'insieme dei bersagli
  di link che un modello dichiara, nella forma in cui un corpus li confronta con
  ciò che si aspetta — e il corpus di questo giro non la chiama. È lo stesso
  difetto che questo verbale imputa alla 0054 tre paragrafi più su, in miniatura
  e dichiarato: o il primo corpus che verifica *cosa un documento nomina* le dà
  un cliente, o va tolta. Non è una proprietà, quindi non può passare per verde
  senza essere provata; resta una comodità offerta a chi scriverà il secondo
  corpus.
- **Le divergenze non sono state riparate.** Sono tredici, e stanno scritte.
- **La casella «Markdown parser fuzzing» del capitolo 5.3 di
  [FEATURES.md](../FEATURES.md) resta senza spunta**, come tutte le altre: in
  quel file non ce n'è nessuna spuntata, perché è il catalogo di cosa l'app farà
  e non un tracciato di avanzamento. Lo stato di cosa è aperto sta in `todo.md`,
  ed è l'unico posto in cui si aggiorna.
- **Il presidio non gira nel job `invarianti` della CI**, che chiama quattro
  test per nome. Gira in `build + test` con tutto il resto, sui tre sistemi
  operativi.

## Verifica

`cargo fmt --all --check`: pulito.
`cargo clippy --workspace --all-targets -- -D warnings`: pulito.
`cargo test --workspace`: **934 test verdi in 90 binari, 0 falliti, 3 ignorati**
— erano 926 in 89 alla [0059](0059-la-generazione-non-e-un-round-trip.md), e gli
otto nuovi sono il binario di `il_corpus.rs`: il corpus contro le proprietà, le
due proprietà del descrittore che finalmente qualcuno chiama, le tre direzioni
di copertura, l'estrattore col suo presidio, le divergenze e il fuzzer.

Il fuzzer con l'ingresso lungo, che è il modo di sapere quanto tiene la rete:
`FUB_FUZZ_CASI=5000000 cargo test --release -p fub-format-markdown --test il_corpus -- nessuna_mutazione`
→ **verde**, cinque milioni di mutazioni in **84,11 s** e in **88,17 s** su una
seconda corsa: la differenza è della macchina, e il numero da tenere è l'ordine
di grandezza — un minuto e mezzo. Ai ventimila del default il file intero gira
in **2,6 s** in debug, di cui 2,5 sono il fuzzer.

`node .github/scripts/check-doc-links.mjs`: **132 file, 2475 link, 0 rotti** —
erano 131 e 2402 prima di questo giro di documenti.

`wit_additivity` resta verde e non poteva non restarlo: non si è toccato il
contratto, né in Rust né nel WIT. Le cinque riparazioni stanno in due file di un
provider — `offsets.rs` e `parse.rs` — e nessuna sposta una firma: due rendono
impossibile un panico, una corregge una tabella riga→byte, due ritagliano lo
span di un figlio su quello del padre.
