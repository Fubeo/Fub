# 0086 — Una cronologia sta dove il recinto la mette, e il recinto decide anche chi la cancella

|  |  |
|---|---|
| **Decisa** | 2026-08-04 |
| **Origine** | `todo.md` §21.7 ([seduta 21](../roadmap/21-la-ricerca-predefinita.md)) — **chiude la voce** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/21-la-ricerca-predefinita.md) ·
[lo stato di vista, 0037](0037-lo-stato-di-vista.md) ·
[le impostazioni e i tre stati, 0036](0036-le-impostazioni-e-i-tre-stati.md) ·
[le impostazioni vivono nel vault, 0076](0076-le-impostazioni-vivono-nel-vault.md)
· [un peso è una preferenza, 0084](0084-un-peso-e-una-preferenza.md) ·
[le due superfici che restavano, 0083](0083-le-due-superfici-che-restavano.md) ·
[un accordo ha un proprietario, 0081](0081-un-accordo-ha-un-proprietario.md)

---

La voce chiedeva due cose di taglia molto diversa. Una era quasi gratis — dal
risultato vuoto si crea la nota cercata — e l'altra era la sola vera domanda:
**dove vive una cronologia di ricerche, e come si spegne**. La voce stessa
diceva di che materia è fatta la seconda: *«è materia del capitolo 23 (privacy),
non un dettaglio di comodo: cosa si è cercato dice di una persona più di cosa ha
scritto»*.

C'era anche una frase da onorare o da smentire, scritta mesi fa in
`state/recenti.ts` e ripresa dalla
[0083](0083-le-due-superfici-che-restavano.md): *«il giorno in cui la §21.7
deciderà dove si scrive una cronologia, questo modulo è il posto che diventa il
suo lettore — non un secondo posto da riconciliare»*. È onorata alla lettera:
non è nato un modulo accanto a quello. Le ricerche recenti stanno **dentro**
`recenti.ts`, con lo stesso tetto, la stessa regola di risalita, lo stesso
interruttore e lo stesso gesto che le cancella.

E una correzione di testo, perché la voce era invecchiata: diceva che le recenti
«sono uno dei tre stati senza contenitore del §11.2». Il §11.2 è chiuso — stato
di vista con la [0037](0037-lo-stato-di-vista.md), layout con la
[0078](0078-i-riquadri-sono-un-fatto-della-shell.md) — e il cappello di quella
seduta lo aveva già scritto: **il terzo stato senza contenitore non era terzo**.
Il contenitore c'era. La domanda vera non era *dove metterlo* per mancanza di
posti: era se il posto che c'è sia quello **giusto** per un dato di questa
specie.

## Il contenitore, e ciò che stona (dichiarato invece che nascosto)

La cronologia vive nello **stato di vista della shell**, sotto la chiave
`history`, accanto a `layout`. Tre proprietà, e nessun altro posto le ha
insieme:

- **Non viaggia col vault.** Sta nella cartella di configurazione della
  macchina, quindi non entra in un sync né in un repo git. Per un dato di
  privacy è la proprietà che decide: l'alternativa vera — lo spazio `data_*`
  della feature di ricerca — è **dentro** il vault, cioè si sincronizza. Un
  archivio condiviso, o una cartella in Dropbox, porterebbe con sé l'elenco di
  cosa hai cercato. È l'opposto esatto di ciò che questa voce chiede.
- **È recintata per proprietario**, e il proprietario non è un parametro: lo
  timbra la porta di Rust (`SHELL_OWNER`, `fub-app/src/lib.rs`), non il webview.
  Nessun altro componente la può leggere.
- **`forget_vault` la dimentica già**, insieme al resto. È metà «cancellazione
  dati locali» di FEATURES 23.2 (privacy) senza scrivere una riga.

Ciò che stona, e che si scrive invece di lasciarlo passare: il doc di
`ViewStateRead` descrive quello spazio come *scroll, sezioni collassate, filtro
corrente, tab attiva* — «dove eri rimasto». Una cronologia è un'altra specie di
dato: ha un peso di privacy, vuole un interruttore, vuole un gesto che la
cancelli. Metterla lì **per comodità** e non dirlo sarebbe stato il modo di
scoprirlo fra sei mesi, quando qualcun altro ci mette dentro la seconda cosa che
non c'entra. Quindi la descrizione si allarga apposta, e il prezzo è dichiarato
nel paragrafo qui sotto — perché un prezzo c'è, e non è piccolo.

La terza uscita — una forma nuova, uno spazio dichiaratamente «sensibile» —
costava firma a ridosso del freeze di M4, per un cliente solo. Resta la mossa
giusta il giorno in cui i clienti saranno due, e quel giorno il criterio è già
scritto: *questo* dato, e non un altro, è quello che l'ha resa necessaria.

## Il prezzo: il recinto decide anche chi può cancellare

Questa è la decisione per cui la voce aveva bisogno di un verbale, ed è una
conseguenza che non si può aggirare scrivendo meglio.

Lo stato di vista è recintato per proprietario, e l'id di chi scrive **non è un
parametro**. Ne segue che un `search.history.clear` scritto in `fub-features` —
che sarebbe il posto naturale per «cancella la cronologia», e la renderebbe
invocabile da palette, CLI e automazioni come ogni altro comando del registro —
**non può toccarla**. Non è una scelta di stile: non ci arriva.

Quindi il gesto è un **comando di shell**: `shell.history.clear`, dichiarato in
`SHELL_KEYS` come tutti gli altri (0081) e visto dal presidio delle scorciatoie.
Senza accordo, ed è a sua volta una scelta: è un gesto distruttivo che non si
annulla, e un tasto premuto per sbaglio è esattamente il modo in cui
succederebbe. Si trova nella palette, dove per arrivarci bisogna averlo scritto.

Il prezzo, in chiaro: **non è invocabile da CLI né da un'automazione**. Chi
scriverà la CLI (27.1) non troverà un verbo per questo, e FEATURES 23.2 resta
scoperto da quel lato. Si accetta perché l'alternativa era peggio in modo
peggiore: per rendere il comando del registro possibile, la cronologia avrebbe
dovuto vivere nel vault — cioè sincronizzarsi — e una funzione di privacy che si
compra mettendo il dato dove viaggia non è una funzione di privacy.

## L'interruttore: di chi è la chiave, e da che parte sta di default

La chiave è `history.enabled`, e il proprietario è il bundle di core
(`fub.core`). È l'**inverso** del precedente fresco della
[0084](0084-un-peso-e-una-preferenza.md), e la differenza è chi legge: un peso
lo legge il provider di ricerca, e sta nel suo manifest; questo lo legge **la
shell**, che non è una feature e non porta un manifest. Appenderlo al bundle
della ricerca avrebbe voluto dire che spegnendo la ricerca sparisce
l'interruttore della privacy — la stessa forma d'errore che `plugins.disabled`
evita — e per di più la chiave governa anche le note **aperte** di recente, che
con la ricerca non c'entrano.

**Non `program_writable`**, ed è la riga non negoziabile della
[0036](0036-le-impostazioni-e-i-tre-stati.md): *le impostazioni di privacy e
dell'AI non stanno fra quelle, e un componente che può allargarsi i permessi da
sé non ha permessi*. La differenza con `versioning.enabled`, che invece lo è,
non è la reversibilità: un versioning riacceso fa una cosa **in più e
visibile**, una memoria riaccesa comincia a raccogliere e la si scopre quando è
già lunga.

**Accesa di default**, e non per inerzia — per un dato di privacy il default non
è mai neutro, e va argomentato in un verso o nell'altro. L'argomento è che il
dato non esce: sta sulla macchina, non entra nel vault, non attraversa nessuna
rete (FEATURES 23.2, «nessun invio search query»), c'è un interruttore e c'è un
gesto che cancella. L'opt-in è la forma giusta quando un dato **esce**; qui non
esce, e una memoria spenta di default sarebbe una funzione che nessuno trova —
cioè tanto valeva non scriverla.

**Di vault e non di macchina**, come ogni preferenza dopo la
[0076](0076-le-impostazioni-vivono-nel-vault.md). Chi dice «di questo archivio
non tenere traccia» lo dice dell'archivio, non del computer: una scelta di
privacy che vale su un portatile e non sull'altro è una scelta che non protegge.
L'asimmetria è voluta e va letta insieme: **l'interruttore viaggia, ciò che
governa no**.

E spegnere non è solo smettere di scrivere: **cancella**. Un interruttore che
lascia sul disco la traccia di prima è una casella che non ha fatto quello che
diceva — e chi la spegne la spegne *perché* c'è qualcosa che non vuole lasciare
lì. Vale anche all'avvio: memoria spenta e qualcosa ancora sul disco, si
cancella; spenta e disco già pulito, non si scrive nulla.

## Cosa si ricorda, e per quanto

Dieci per elenco, lo stesso numero delle note aperte. Non è pigrizia: il tetto
qui non misura quanto dato si può tenere — il disco non è il vincolo — misura
**quanto se ne legge in un colpo d'occhio**, e quella è una proprietà
dell'occhio e non dell'elenco.

Una ricerca ripetuta **risale**, esattamente come una nota riaperta, e la regola
è la stessa funzione (`conInCima`): chi cerca due volte «riunione» non vuole
«riunione» due volte, e *quante volte* si è cercato qualcosa è precisamente il
dato in più che una memoria corta non ha ragione di tenere.

Si ricorda una ricerca **conclusa** — un risultato aperto, la nota creata — e
non ciò che si digita. È la differenza fra una cronologia e un registro di
battute: la casella interroga a ogni tasto, e ricordare lì dentro riempirebbe la
lista di «r», «ri», «riu». Il testo si tiene com'è stato scritto, meno gli spazi
ai bordi: una query normalizzata non è la query di chi l'ha scritta, e
riproporgliela riscritta è il modo di fargli dubitare che sia sua.

**E sì, anche le note aperte diventano persistenti.** La voce non lo chiedeva e
il codice sì. Sono due domande diverse — *dov'ero* e *cosa cercavo* — e restano
due elenchi, perché mescolarli darebbe una lista che non si sa leggere. Ma hanno
lo stesso peso di privacy, e per questo l'interruttore è **uno**: due
interruttori per una sola preoccupazione sono un menu che nessuno capisce, e chi
dice «non tenere traccia» non intende metà traccia.

## La nota che la ricerca non ha trovato

La voce diceva che manca «solo il chiamante», ed era vero più di quanto sapesse:
`note.create` esiste, la shell lo invoca già come lo invocherebbe una CLI, e
l'`Origin` che la voce chiede c'è già — `invoke_command` timbra `Actor::User`
dalla porta, e non è un parametro che arrivi da JS.

Il costo vero era la domanda che la voce non fa: **cosa si passa come `name`**.
Non la query così com'è. `name` non è un'etichetta, è l'id del documento con
l'estensione appesa: `progetti/2026` creerebbe una nota dentro una cartella che
nessuno ha chiesto, e `a:b` sbatterebbe contro la convalida — o, peggio, contro
quella di un filesystem, con un errore che parla di caratteri illegali a chi
stava soltanto cercando. Quindi c'è una regola pura, `rules/nome-cercato.ts`,
che toglie i caratteri vietati dall'**unione** dei tre sistemi (un vault sta in
una cartella sincronizzata più spesso di no), i caratteri di controllo che
arrivano incollando da un PDF, e i punti in coda che darebbero `nota..md`. Non
normalizza maiuscole e accenti: chi ha cercato «Riunione con Anna» vuole una
nota che si chiami così, e ripulirla in `riunione-con-anna` è il momento in cui
l'app decide di sapere meglio dell'utente come si chiamano le sue cose. Risponde
`null` — cioè *il gesto non si offre* — quando dalla query non esce un nome.

Non controlla se il nome sia **libero**, e non deve: lo sa solo il vault, e
`note.create` glielo chiede già con `create_document`, che su un path occupato
fallisce invece di sovrascrivere. È un caso possibile anche a risultati vuoti —
la ricerca combacia sul **contenuto**, quindi una nota che si chiama come la
query può esistere senza contenerla — e la risposta giusta è mostrare l'errore
del kernel. Inventare un `nome (2)` sarebbe creare una seconda nota a chi ne
stava cercando una.

## Dove il gesto atterra

In **due** superfici, che sono i due posti in cui qualcuno cerca una nota e non
la trova: lo stato vuoto della ricerca del vault (`panels/search.ts`) e il quick
switcher a risultati vuoti. La stessa regola pura in tutti e due, e le stesse
condizioni — solo a mani davvero vuote, mai mentre il vault indicizza (dove la
risposta è *non lo so ancora*, §15.7) e mai su un errore, dove non si è cercato
affatto.

Una superficie che invece **non** deve offrirlo, e vale la pena scriverlo perché
sembra la stessa: `panels/doc-search.ts`, che usa la stessa chiave
`search.empty`. Cercare dentro la nota aperta e non trovare non vuol dire che
manchi una nota.

## Il presidio che era facile non scrivere

Due, e sono di due specie.

Dal lato shell: **a interruttore spento non si scrive niente**, provato
guardando le chiamate al canale e non leggendo il codice. La differenza fra «nel
modulo c'è un `if`» e «sul disco non finisce niente» è tutta la differenza che
conta per un dato di privacy, e la seconda si dimostra solo contando le
scritture.

Dal lato Rust: la chiave è nominata **da due parti** —
`fub-host/src/settings.rs` e `state/recenti.ts` — e una shell in TypeScript non
può importare una costante Rust. È la stessa condizione del tema, e prende lo
stesso presidio (`interruttori.rs`, che legge il file della shell e chiede al
core se conosce la chiave che ci trova), ma per una posta più alta: un tema che
non cambia lo si vede e si riprova, una memoria che continua a scrivere dopo che
qualcuno l'ha spenta non dà **nessun** segnale. Un interruttore di privacy che
non comanda niente è peggio di un interruttore che non c'è, perché è una
promessa.

## Cosa questa decisione non ha fatto

Non ha aggiunto i **suggerimenti**, che FEATURES §9.1 elenca accanto alla
cronologia: un suggerimento è una proposta *prima* che ci sia una storia, e
questa voce chiedeva la storia. Adesso che la storia c'è, i suggerimenti hanno
da cosa nascere — ma sono un'altra voce.

Non ha toccato la porta unica della [0082](0082-una-porta-per-chi-cerca.md) e
della [0083](0083-le-due-superfici-che-restavano.md). Le ricerche recenti sono
un elenco che la shell mostra, non una query nuova: nessuna superficie è nata
con un giro suo verso l'indice.

Zero firma. È la sesta voce di fila di questa seduta a chiudersi senza spendere
contratto.
