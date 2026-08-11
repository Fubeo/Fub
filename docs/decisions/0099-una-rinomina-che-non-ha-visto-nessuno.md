# 0099 — Una rinomina che non ha visto nessuno

**Data:** 2026-08-05
**Voce:** [§23.1](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#231-una-rinomina-fatta-ad-app-chiusa-scollega-tutto-ciò-che-è-indicizzato-per-path)
**Commit:** *(questo commit)*

## Il fatto

Il path è la chiave, e lo è per sempre ([0043](0043-il-path-e-la-chiave.md)).
Chi rinomina una nota **mentre Fub è aperto** la fa seguire da tutto ciò che le
sta attaccato: dalla shell, dal Finder o da un client di sync fa lo stesso, il
rilevatore accoppia i due path e si finisce in `migrate_identity`. Chi la
rinomina **mentre Fub è chiuso** non ha nessuno che accoppi: alla riapertura una
nota risulta sparita e ne risulta nata un'altra, e lo spazio per-documento, le
versioni, l'icona e — l'unica copia di un testo mai salvato — la **bozza**
restano attaccati a un nome che non esiste più.

Non è il caso di frontiera. Chi tiene il vault su due macchine ha un programma
che rinomina ad app chiusa **per mestiere**, e chi sposta le proprie note con un
altro strumento sta esercitando precisamente la libertà che il patto di questo
progetto promette. Il prezzo lo dichiarano tre verbali separati — la
[0044](0044-lo-stato-per-documento.md) per prima, la
[0088](0088-cio-che-non-e-ancora-successo.md) per le bozze — e nessuno l'aveva
sommato.

Adesso l'apertura del vault **riconosce dal contenuto** ciò che il rilevatore
non ha potuto vedere: un documento sparito e uno comparso con la stessa impronta
sono la stessa nota con un nome nuovo, e ciò che le stava attaccato la segue.
Nessuna firma cambia, nessun tipo nuovo, nessuna riga di WIT: **nessun
ritaglio**. Ciò che si aggiunge è una funzione dentro `finish_index` e un
accessore sull'anagrafe.

## La terza strada, che la 0043 non aveva guardato

Il verbale che ha deciso «il path è la chiave» ha scartato **una**
implementazione dell'id stabile — la tabella `path → id` tenuta dal kernel — e
ne ha concluso, giustamente, che è «il path con un costume addosso»: se l'id
vive fuori dal file non sopravvive a ciò per cui esiste. Questa decisione non
riapre quella, e non introduce nessun id.

La riassociazione non deve passare da un id: passa dal **contenuto**. E il
materiale era già tutto su disco, messo lì da due decisioni che non si nominano
a vicenda:

- l'**anagrafe è durevole** fra un avvio e l'altro
  ([0046](0046-l-anagrafe-del-vault.md)) e porta l'impronta di ogni documento
  che qualcuno ha letto;
- l'impronta di ciò che è comparso **oggi** l'ha appena calcolata `index_batch`
  leggendolo, con `Revision::of_bytes` — la stessa funzione di `Revision::of`
  ([0087](0087-il-testo-che-sta-dentro-gli-allegati.md)).

Quindi il costo di questa voce, in letture di disco, è **zero**: le due metà del
confronto sono in memoria per altre ragioni, ed è ciò che ha reso possibile
farlo all'apertura invece che dietro un comando.

## Le tre regole, e perché nessuna si poteva scrivere senza deciderla

Il §23.1 diceva di sé: *«è una decisione e non una casella, perché le domande da
rispondere non si rispondono scrivendo il codice»*. Sono queste.

### 1. Uno a uno, o niente

Due impronte uguali sono una rinomina **solo se una nota è sparita**: due file
identici comparsi senza che sparisse niente sono una copia, e trattarli come una
rinomina sposterebbe la bozza dell'uno sull'altro. E quando ne spariscono N e ne
compaiono N con la stessa impronta, l'accoppiamento non è unico — un vault con
dieci note da riunione vuote di contenuto e riscritte in blocco è il caso in cui
un'euristica «prendi la prima» consegnerebbe il testo a caso.

### 2. Nel dubbio non si accoppia, ed è il verso **opposto** alla 0085

La [0085](0085-leggere-non-e-cambiare.md) ha deciso che nel dubbio si conta come
cambiamento, perché una rilettura di troppo costa un file aperto. Qui la stessa
frase con lo stesso tono darebbe il risultato opposto a quello che si vuole: un
accoppiamento sbagliato **consegna il testo non salvato di una nota a
un'altra**, e non esiste nessun «di troppo» che costi così poco. La regola del
dubbio non è una costante del repo: è una funzione di cosa costa sbagliare, e va
riderivata ogni volta.

### 3. Nel dubbio non si **raccoglie** nemmeno

Questa è la regola che la voce non aveva previsto, ed è emersa misurando. Se il
dubbio si limitasse a non accoppiare, il documento sparito e ambiguo finirebbe
**tre righe dopo** sotto la raccolta dello stato per-documento
([0044](0044-lo-stato-per-documento.md)), cioè sotto un `remove_dir_all`: non
accoppiare avrebbe voluto dire *cancellare*, che è la peggiore delle tre uscite.

Quindi il dubbio sospende **entrambe** le mosse, e la ragione si dice in una
riga: delle due, una è irreversibile e l'altra costa qualche byte fermo. Se
domani l'ambiguità si scioglie — l'utente cancella la copia di troppo — il giro
dopo accoppia. L'elenco dei sospesi vive sul workspace e non in un parametro
perché la raccolta ha **due** chiamanti, e il secondo (`vault.repair`) gira a
vault aperto da un pezzo, quando quel dubbio non è più in vista di nessuno.

## Il difetto che la misura ha trovato accanto, e che era peggio della voce

La disciplina — *misurare sul codice ogni prezzo che la voce dichiara* — qui ha
trovato qualcosa che la voce non nominava affatto, in una riga adiacente a
quella da cambiare.

`finish_index` fa due cose di seguito. Prima **non riconcilia** se
l'indicizzazione si è interrotta, e la ragione è scritta lì: *«un insieme
incompleto non si dichiara completo»* — dire a ogni indice di dimenticare ciò
che l'annullamento non ha fatto in tempo a nominare significherebbe trasformare
«ho smesso di indicizzare» in «cancella». Poi, tre righe sotto, **raccoglieva
comunque**.

La raccolta chiede all'anagrafe *questo documento esiste ancora?*, e da
un'anagrafe parziale «sparito» e «non ancora guardato» sono la stessa cosa. Ci
si arrivava premendo «annulla» sulla prima indicizzazione di un vault grande, o
chiudendo l'app mentre girava: a quel punto lo spazio per-documento di ogni nota
non ancora indicizzata — annotazioni, righe di database, stato delle flashcard —
usciva dal disco. La stessa cautela mancava anche a `vault.repair` chiamato
mentre l'indicizzazione cammina.

Le due righe erano difendibili separatamente, e il loro prodotto non l'aveva
guardato nessuno: è la forma della §23.3, la *coppia*, ritrovata dentro una
funzione sola. E il rapporto fra i due costi è quello che rende scomoda
l'asimmetria di prima: **chi riconcilia su un insieme parziale svuota un
derivato, che si rifà riaprendo; chi raccoglie su un insieme parziale cancella
dal disco dati che nessuno rifà.** La guardia più severa mancava proprio dove
serviva di più.

La guardia sta adesso **dentro** la raccolta e non nel suo chiamante, per la
ragione per cui la 0098 ha messo il ricalcolo in `announce_setting`: una regola
che vale per tutti i chiamanti si scrive una volta sola nel posto che tutti
attraversano. `IndexingState::Ready` è il **default**, quindi la guardia non
chiude la porta a chi raccoglie senza aver aperto niente — chiude a chi ha
aperto a metà, che è l'unico caso in cui l'anagrafe mente.

## L'ordine delle due righe è la decisione

**Prima si riconosce, poi si raccoglie.** Per la raccolta, ciò che una rinomina
ad app chiusa ha lasciato sotto il nome vecchio è indistinguibile da ciò che è
rimasto di una nota cancellata: invertire le due righe vorrebbe dire cancellare
i dati un istante prima di sapere di chi sono. È la stessa ragione per cui la
0044 mette la raccolta all'apertura *dopo* la ricostruzione dell'anagrafe —
«quando è al suo massimo di verità» — portata un gradino più in là: adesso il
massimo di verità comprende anche il sapere che due nomi sono la stessa nota.

## Cosa resta fuori dall'accoppiamento, e non per dimenticanza

- **Il file vuoto.** Due file vuoti hanno per forza la stessa impronta: zero
  byte non sono una prova di identità, sono l'assenza di una prova. È l'unico
  caso in cui la regola «uno a uno» sarebbe soddisfatta e la conclusione falsa,
  e vale la pena dirlo perché il file vuoto non è un caso di laboratorio — è la
  nota appena creata e mai scritta, cioè esattamente quella su cui una bozza è
  l'unica copia.
- **Il cestino.** Una nota cestinata non è sparita: è recuperabile, e spostarne
  i dati su un omonimo li toglierebbe a chi la ripristina. È la stessa riga con
  cui la 0044 rende la raccolta sicura invece che aggressiva, riusata qui perché
  la domanda è la stessa.
- **Gli allegati**, che un'impronta non ce l'hanno **affatto**: la calcola solo
  chi legge, e nessuno legge un PNG. È la casella residua del
  [§14.1](../roadmap/14-entry-cartelle-lista.md) — *l'impronta degli allegati* —
  ed è la prima volta che quella casella ha un **cliente** invece di una
  giustificazione: il giorno che l'impronta c'è, un allegato rinominato ad app
  chiusa si ricongiunge di qui senza una riga in più. La casella resta là, con
  scritto adesso a cosa serve.
- **Un'anagrafe che non si è potuta leggere** (versione ignota, file rotto):
  niente ieri, niente spariti, nessuna rinomina da vedere. Il ricongiungimento è
  una capacità di un **derivato**, e perso il derivato si perde anche lei — per
  un giro, e in silenzio. Non è un difetto da riparare con un dato autorevole in
  più: sarebbe la tabella `path → id` della 0043 rientrata dalla finestra.

## Fin dove arriva la migrazione, e chi la fa

La voce chiedeva di decidere se il ricongiungimento valga per tutto ciò che è
per-path o per i soli dati **autorevoli** della [0048](0048-una-radice-sola.md).
La risposta è che la domanda si è sciolta da sé: ciò che il kernel sposta è
esattamente ciò che sapeva già spostare per una rinomina vista —
l'organizzazione (§11.3), lo spazio per-documento di chiunque altro (§13.2), la
bozza (§15.2) — perché il codice è **lo stesso codice**, estratto in
`migrate_side_data` e chiamato da due mondi.

Tenerlo in due copie sarebbe stato il difetto che la 0044 ha appena finito di
togliere, rifatto **dentro** il kernel invece che fuori: *il rename è un rito
che ognuno celebra per conto proprio, e ognuno lo celebra col proprio buco*. Il
modo in cui si sarebbe visto è preciso — un quarto posto per-documento aggiunto
di qua e non di là, e la rinomina ad app chiusa che ne perde uno solo, in
silenzio, per sempre.

I derivati non hanno bisogno di essere nominati: un indice per path si rifà
riaprendo, e riaprendo è precisamente quello che sta succedendo.

## E poi si dice, con l'evento della rinomina

Chi tiene stato per-documento **fuori** dallo spazio dichiarato lo fa per una
ragione legittima e scritta: il versioning ha uno store suo perché deve
sopravvivere alla cancellazione della nota
([0044](0044-lo-stato-per-documento.md) lo chiama «il controesempio nel repo»).
Il kernel non può migrarlo, e l'unico modo di dirglielo è l'evento — lo
**stesso** `DocumentRenamed` della rinomina vista, così chi lo ascolta non ha un
secondo caso da gestire.

Che la coda possa troncare ([0034](0034-il-freno-e-il-raggruppamento.md)) è
precisamente la ragione per cui i tre dati autorevoli che il kernel sa spostare
li ha spostati **prima**, invece di aspettare che qualcuno ascoltasse. È la
gerarchia della 0038 applicata qui: ciò che si perde senza rimedio non passa da
un canale dichiaratamente best-effort; ciò che ha un padrone di là dal confine
non ha altra strada, e la si prende sapendo cosa vale.

Il pavimento accanto alla porta
([0062](0062-il-log-e-il-pavimento-l-evento-e-la-porta.md)): ogni accoppiamento
lascia una riga di log che nomina i due path. Non c'è nessuna notifica, e la
scelta è deliberata — l'esito riuscito di questa funzione è che **niente sembra
storto**: l'utente apre la nota che si aspetta e ci trova la sua bozza e la sua
storia. Un avviso racconterebbe un non-evento, e la specie di avviso che si
impara a chiudere senza leggere. Quando invece l'accoppiamento *non* si fa, la
superficie c'è già ed è quella giusta: una bozza orfana la mostra
`vault.repair`, che la conta e la dice.

## Cosa NON è questa decisione

- **Non è un id stabile**, né mezzo. Non nasce nessuna tabella, niente viene
  scritto su disco per rendere possibile il riconoscimento, e cancellando
  l'anagrafe non si perde nient'altro che una riapertura lenta. Il path resta la
  chiave, e il ricongiungimento è una **lettura** di due cose che c'erano già.
- **Non è un rilevatore di rinomine.** Non guarda i nomi, non calcola distanze
  fra stringhe, non indovina che `nota.md` e `nota (1).md` siano parenti. Il
  solo criterio è l'uguaglianza di un'impronta, che è un fatto.
- **Non promette di riconoscere una rinomina fatta insieme a una modifica.** Chi
  rinomina *e* riscrive la nota ad app chiusa ha cambiato entrambe le cose che
  la identificano, e nessuna delle due metà lo sa più. La voce non chiedeva
  questo, e prometterlo vorrebbe dire euristiche sui nomi — cioè indovinare, in
  un posto dove sbagliare consegna un testo a un'altra nota.

## Il presidio

Otto banchi in `crates/fub-kernel/tests/ricongiungimento.rs`, che vogliono tutti
**due aperture con un disco che cambia in mezzo** — la ragione per cui nessuno
di loro poteva stare dentro un modulo.

- `una_rinomina_fatta_ad_app_chiusa_si_riconosce_dallimpronta` — il caso intero,
  con le tre cose insieme: la bozza, lo spazio per-documento di un plugin **mai
  montato**, l'icona.
- `il_ricongiungimento_lo_dice_con_levento_della_rinomina` — chi vive di là dal
  confine lo viene a sapere.
- `una_nota_cancellata_resta_una_cancellazione` — il verso opposto: la raccolta
  non si è spenta.
- `due_file_identici_senza_niente_di_sparito_sono_una_copia` e
  `un_file_vuoto_non_e_una_prova_di_identita` — le due conclusioni false che la
  regola «uno a uno» da sola non escluderebbe.
- `n_spariti_e_n_comparsi_non_si_accoppiano_e_non_si_raccolgono` e
  `il_dubbio_sospende_anche_la_raccolta_a_comando` — il dubbio, dai due
  chiamanti della raccolta.
- `unindicizzazione_interrotta_non_raccoglie_niente` — il difetto trovato
  accanto, che non ha niente a che fare con una rinomina.

Tre degli otto restano **verdi** anche togliendo il codice di questo commit, ed
è voluto: sono i controlli negativi, e un presidio che diventasse rosso solo per
la strada nuova non direbbe che quella vecchia è ancora al suo posto.

## Cosa resta fuori

- **La rinomina di una cartella fatta ad app chiusa**, che è N rinomine insieme
  e si ricongiunge N volte per lo stesso meccanismo — a patto che gli N
  contenuti siano distinguibili l'uno dall'altro. Non è una casella: è il
  comportamento che segue dalle regole scritte qui, ed è quello giusto.
- **L'impronta degli allegati**, che è e resta la casella del §14.1, adesso con
  un indirizzo scritto sopra.
- **Ciò che il ricongiungimento non ha saputo decidere** non ha una superficie
  sua: resta in memoria per la sessione, e alla riapertura si ricalcola.
  Mostrare un elenco di «forse queste due note sono la stessa» vorrebbe dire
  chiedere all'utente di arbitrare un caso che non ha modo di ricostruire — e il
  posto in cui quella domanda ha senso è il recupero di una bozza orfana, dove
  esiste già.
