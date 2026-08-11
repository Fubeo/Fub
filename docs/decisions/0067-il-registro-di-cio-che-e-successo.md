# 0067 — Il registro di ciò che è successo, e l'inverso al posto del contenuto

|  |  |
|---|---|
| **Decisa** | 2026-08-01 |
| **Origine** | `todo.md` §15.2 (seduta 15) — la **prima delle tre caselle di recovery** che la [0065](0065-una-scrittura-o-c-e-o-non-c-e.md) e la [0066](0066-un-aggiornamento-non-e-una-scrittura.md) hanno lasciato |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/15-il-disco.md) ·
[la scrittura](0065-una-scrittura-o-c-e-o-non-c-e.md) ·
[l'aggiornamento](0066-un-aggiornamento-non-e-una-scrittura.md) ·
[l'undo](0045-l-undo-ha-due-pile.md) ·
[la mappa del disco](../architecture/on-disk-layout.md)

---

La metà *durabilità* del §15.2 è finita con le due decisioni precedenti: una
scrittura o c'è o non c'è (0065), un aggiornamento si rilegge sotto lock (0066).
Entrambe hanno chiuso scrivendo la stessa frase — *ciò che resta è recovery,
cioè cosa si fa dopo* — e delle tre caselle rimaste questa è quella su cui
pesano quattro promesse fatte altrove e oggi **inesprimibili**: il rollback
dell'import (17.3), l'undo delle automazioni (16.3), l'audit (23.3) e la riga
che vale più di tutte, la **transazione atomica per operazione batch** che il
22.4 promette al centro di comando LLM insieme al «rollback completo
dell'operazione».

Quella riga non è rimasta scoperta per svista. Il verbale del lotto la nomina e
spiega perché non poteva chiuderla: *«un annullamento che non sopravvive alla
morte del processo non è un annullamento, e prometterlo con un nome
significherebbe farlo credere a chi legge solo la firma»*
([0011](0011-il-lotto.md)). Il lotto coalizza gli **eventi**; il tutto-o-niente
è di questo strato, e nessun chiamante se lo può mantenere da sé.

## La decisione

**Nasce `.fub/journal.jsonl`**: un record per riga, in coda, per ogni mutazione
che il **kernel esegue** sul vault. Ogni riga dice quando, chi ha chiesto,
dentro quale lotto, e cosa
([`kernel/journal.rs`](../../crates/fub-kernel/src/journal.rs)).

E la riga che decide la forma di tutto il resto: **il registro non conserva il
contenuto di prima, conserva l'inverso.**

## Le decisioni prese, da NON ridiscutere senza motivo

### Una voce è la mutazione logica **più** il suo inverso, e i due formati non erano due

La voce chiedeva di scegliere fra due formati: la mutazione logica (chi, cosa,
quando, su quale documento) oppure abbastanza per tornare indietro — e diceva
che il secondo «deve portarsi dietro il contenuto precedente, o un puntatore a
qualcosa che ce l'ha».

Sono due formati solo finché si dà per scontato che *tornare indietro* voglia
dire *riavere il testo*. La [0045](0045-l-undo-ha-due-pile.md) aveva già deciso
che non è così, e questo verbale non fa che leggerla dal disco:

- l'inverso di una **modifica chirurgica** è una modifica chirurgica
  ([0008](0008-modifica-chirurgica.md): `EditReport::inverse()`), e porta con sé
  i soli byte sostituiti — non il documento. Una sostituzione su una parola
  costa una parola;
- l'inverso di un cambiamento **strutturale** — creata, cestinata, ripristinata,
  rinominata — non è un testo affatto: è un comando, e la 0045 ha scartato
  esplicitamente l'idea di un vocabolario di operazioni inverse. Il registro non
  ne scrive uno: scrive cosa è successo, e chi tornerà indietro **deduce**
  l'inverso da lì, perché l'inverso di una rinomina è la rinomina
  all'incontrario e quello di una cancellazione è un ripristino dal cestino.

Il costo di quel «puntatore a qualcosa che ce l'ha» è il resto dell'argomento,
ed è la ragione per cui il primo formato da solo non sarebbe bastato e il
secondo *nella sua versione letterale* sarebbe stato peggio: un file
**autorevole** — che per definizione nessuno può buttare — con dentro una copia
di ogni salvataggio è il vault scritto una seconda volta accanto a sé stesso, e
cresce col vault invece che col numero di operazioni. Il presidio
`il_registro_non_porta_dentro_il_documento` guarda esattamente questo: nel file
finisce l'**impronta** e non il testo.

### La variante senza inverso è dichiarata, ed è quella che la 0045 aveva già escluso

Resta un caso in cui l'inverso non c'è: la **riscrittura integrale** di un
documento che c'era già, cioè il salvataggio dell'editor. Per riportarlo
indietro servirebbe il testo di prima, che è precisamente ciò che si è deciso di
non tenere.

Non è una lacuna nuova ed è il modo giusto di guardarla: fra le cose che la 0045
ha scartato c'è *«registrare in pila ogni `write_document`»*, con la ragione che
avrebbe messo la stessa modifica in due pile che rispondono a due scorciatoie
con due risposte diverse. Il confine è quello, e i clienti che aspettano stanno
tutti dalla parte giusta — un import **crea**, un bulk fix e `vault.replace`
passano da `apply_edit`, una migrazione rinomina. Il salvataggio dell'editor è
dell'altra pila, e la sua rete di sicurezza è il buffer di crash, che è la
casella accanto.

Ciò che si è scelto è di dirlo invece di lasciarlo scoprire:
`JournalOp::Written` è la sola variante per cui `is_invertible()` risponde
`false`, e il presidio
`il_salvataggio_integrale_e_la_sola_riga_che_non_si_annulla` lo fissa. Una
capacità che manca e lo dichiara è un'altra cosa da una che manca e sembra
esserci — è la lezione della §21.10 in [leva.md](../roadmap/leva.md).

### Gli snapshot del versioning non bastano, e nemmeno si duplicano

La voce chiedeva di guardare cosa fa già il versioning
(`fub-features/src/versioning.rs`) e di dire perché, se non basta. Tre ragioni,
e ognuna basterebbe da sola:

- è un **componente**, e lo si spegne da un'impostazione (`versioning.enabled`).
  Un tutto-o-niente vero finché qualcuno non tocca un interruttore non è un
  tutto-o-niente;
- è alimentato dagli **eventi**, che hanno un budget e possono troncare. Il suo
  stesso modulo scrive che perdere uno snapshot intermedio per un *campionatore*
  è accettabile — e lo è —, ma la stessa perdita per una *base di rollback* è
  l'operazione che non si disfa;
- vive nello **spazio dati privato di un plugin** ([0021](0021-il-confine.md)),
  che il kernel non ha titolo di leggere.

E la conclusione **non** è duplicarli. Gli snapshot restano l'unico posto in cui
il contenuto di ieri è conservato, e il registro non ne tiene nemmeno una copia:
le due cose rispondono a due domande diverse — *com'era* e *cosa è successo* — e
la prima non è di questo file.

### Il registro sta sotto la 0045, non accanto

La voce chiedeva di scegliere. Sta **sotto**: stesso vocabolario, nessuna
decisione riaperta. Le due pile non si fondono qui più di quanto si fondessero
là — il registro registra la specie di mutazioni della pila delle *operazioni*,
e la riga che separa le due pile (*un comando entra da qui, una battuta di
tastiera no*) è la stessa che separa questo file dal buffer di crash.

Con una differenza che vale la pena, perché non è la stessa cosa scritta su
disco: **la pila si riempie all'invocazione, il registro alla mutazione.** La
0045 dice che la pila si riempie a *profondità zero* — una macro di tre rinomine
è una voce e non tre —, e per l'audit sarebbe la risposta sbagliata: chi
verifica vuole le tre. Sono due grane, e il lotto è ciò che permette al registro
di avere la grana fine senza perdere quella grossa: le tre righe portano la
stessa chiave di lotto, e chi le vuole come una cosa sola le raggruppa. È anche
la ragione per cui `Journal` non è «la pila persistita»: sarebbero due strutture
con due regole di riempimento diverse tenute uguali a mano.

E quindi il registro raccoglie anche ciò che la 0045 dichiarava scoperto — *«le
mutazioni che non passano da un comando non entrano in pila»* — perché il punto
in cui si scrive è la mutazione e non l'invocazione.

### Sta in `.fub/`, e la riga di `todo.md` che diceva `.fub/data/` era sbagliata

La voce si apriva con «append-only in `.fub/data/`», e quella riga sbaglia la
**classe**. Per la [0048](0048-una-radice-sola.md) la profondità la dichiara:
`.fub/` è autorevole, `.fub/data/` è derivato, «si butta e si rifà». Un registro
di ciò che è successo non si rifà da niente — ricostruirlo vorrebbe dire sapere
cosa è successo, che è ciò per cui esiste.

Vale la pena dire anche cosa **non** ha deciso la scelta, perché era la
tentazione: [on-disk-layout.md](../architecture/on-disk-layout.md) elenca già
gli snapshot del versioning come prima eccezione di questa specie — un dato che
non si rifà da niente sotto la radice dei derivati — e sarebbe stato facile
mettersi accanto a loro. Ma quella riga sta nell'elenco delle **eccezioni**,
cioè fra le cose che il §15.4 deve sistemare, e ci sta per una ragione che qui
non vale: lo spazio dati di un plugin è uno solo e vive là. Il registro non è di
un plugin. Imitare un'eccezione è il modo in cui una regola smette di essere una
regola, ed è esattamente ciò che quel documento chiede di non fare: *«nessuna di
queste sceglie il proprio posto per imitazione»*.

Il presidio è sul path e non su una frase
(`il_registro_e_autorevole_e_il_path_lo_dice`), e la ragione è che la riga
sbagliata era **prosa**: nessuno l'avrebbe vista diventare rossa.

### La versione di schema sta su **ogni riga**, e non in testa al file

È l'avvertenza della [§15.3](../roadmap/15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito),
che la 0065 e la 0066 hanno lasciato scritta apposta per questo turno. Applicarla
però non voleva dire copiare la forma che il repo ha già in quattro posti, e il
perché segue dalla classe:

**un formato derivato di una versione ignota si butta e si rifà**, quindi un
numero in testa al file basta — è quello che fanno `entries.json` e l'indice di
ricerca. Questo file non si può buttare: sopravvive agli aggiornamenti di Fub, e
la versione dopo ci appenderà le proprie righe **sotto le nostre**. Un numero in
testa diventerebbe una bugia al primo aggiornamento, e riscrivere la testa a
ogni cambio di versione vorrebbe dire riscrivere un file autorevole per un
motivo cosmetico.

Con la versione per riga, un lettore che incontra una riga che non conosce la
**salta e la conta**, come salta una riga rotta. Ed è la stessa disciplina
applicata alla potatura: quando il file si riscrive, le righe si tengono
**testuali** e non riserializzate dai record letti — riserializzarle
cancellerebbe le righe scritte da una Fub più nuova sullo stesso vault, che è il
caso da cui tutta questa sezione nasce.

### `append` è l'ottava operazione del supporto, e il modulo aveva ragione a fare resistenza

`VaultStorage::write` riscrive il file intero: usarla per un registro in coda
significa riscrivere tutto a ogni salvataggio. Le strade erano due, e in testa a
`storage.rs` c'è la frase contro cui argomentare: *«chi ne aggiunge un'ottava
sta chiedendo al supporto di sapere qualcosa sul contenuto»*.

`append` non lo chiede. Non domanda al supporto **cosa** c'è nel file: domanda
**dove finisce**, che è l'unica cosa che un supporto sa già di ogni file che
tiene. E il criterio con cui distinguere un'operazione da una comodità sta
scritto poche righe sotto, nel doc di `remove_dir_all`: ciò che si **compone**
dalle altre ha un default e non è una capacità in più. `append` non si compone —
leggi+riscrivi costa l'intero file a ogni riga — quindi è un'operazione. La
frase in testa al modulo non era un veto: era il metro, e va tenuta perché è il
metro che ha fatto scrivere questo paragrafo invece di aggiungere un metodo.

L'altra strada — il registro **fuori** dal supporto, con uno `std::fs` suo — è
stata scartata, e va scritta come la 0064 ha scritto il buco di
`plugin_data_dir`: un vault che vive su OPFS non avrebbe registro, e soprattutto
**la cifratura di domani si fermerebbe qui**. È il posto in cui quel prezzo si
sarebbe pagato peggio che altrove: un registro delle mutazioni nomina i path di
ogni nota toccata e quando lo è stata, cioè è più rivelatore in chiaro di quanto
lo sia una nota sola. Il buco dichiarato della 0064 resta uno; non ne nasce un
secondo.

Il prezzo di far scendere `append` nel trait è che `MemStorage` deve
implementarla, che è appunto ciò per cui `MemStorage` esiste — e il presidio di
conformità dei due supporti l'ha presa come le altre sette.

### La coda troncata: riconoscerla, scartarla, **e chiuderla**

Un crash a metà aggiunta lascia dei byte incompleti, e il supporto non li può
nascondere. Il formato li rende riconoscibili nel modo più semplice che ci sia:
**un record è una riga**, e una riga è finita quando è finita con `\n`. Ciò che
resta senza terminatore si scarta, come si scarta qualunque riga che non si
parsa, e ciò che viene prima si legge tutto. È il principio del §15.7 — la
verità non si rifiuta di aprire, si apre segnalando cosa non ha letto — e per
questo la lettura non restituisce dei record ma una `Lettura`, che porta il
**conto** di ciò che ha scartato.

C'è però una riga che scrivere il presidio ha trovato, e che il ragionamento a
tavolino non aveva: scartare in lettura **non basta**. Se il file resta com'è,
la prima aggiunta dopo la riapertura si attacca in fondo alla riga rotta, e le
due diventano una riga illeggibile sola — cioè un record perso dal crash e un
secondo perso da noi. Quindi all'apertura, se il file non finisce con un
terminatore, se ne appende uno: non si toglie niente e non si riscrive niente,
si **chiude** la riga rotta perché il danno resti quello che il crash ha già
fatto. Il presidio `una_coda_troncata_si_scarta_senza_far_rifiutare_il_resto`
verifica entrambe le metà, e la seconda è quella che sarebbe passata
inosservata: un test che si ferma a rileggere dopo il troncamento resta verde
anche senza la riparazione.

### Il tetto è dichiarato, e il taglio rispetta il confine di un lotto

Un file in coda che nessuno tronca sarebbe l'unico posto del progetto che cresce
e non cala mai — la frase è di `viewstate.rs`, che il problema ce l'aveva e l'ha
risolto dimenticando i vault dimenticati. Qui non c'è una chiave che sparisce, e
il precedente giusto è l'altro: il tetto dei **venti recenti** di
`host/vaults.rs`, che dice per iscritto chi cade fuori e cosa si perde.

Il tetto è **diecimila record**, si applica **all'apertura del vault**, e cade
fuori il più vecchio. Ciò che si perde con lui è la possibilità di annullare e
di verificare le operazioni di allora; il vault non perde niente, è sul disco
dov'era.

Due righe che non sono cosmesi:

- si pota **all'apertura** e non a ogni aggiunta, perché potare vuol dire
  riscrivere il file intero e l'apertura è il momento in cui quel costo è già in
  conto (il vault lo si sta scandendo comunque). Un tetto controllato a ogni
  riga avrebbe fatto pagare a un salvataggio, ogni tanto e senza preavviso, la
  riscrittura di un file da megabyte;
- il taglio **si sposta in avanti fino al primo record di un lotto**. Tagliare
  in mezzo a una rinomina con duecento sorgenti lascerebbe un'operazione
  annullabile per un pezzo, che è peggio di una non annullabile: la prima si
  prova e lascia il vault a metà, la seconda non si prova.

### Un lotto è una **coppia**, e questa riga non si vede finché non serve

Il contatore dei `BatchId` riparte da zero a ogni avvio, e sullo stesso file
scrivono anche due installazioni di Fub aperte sulla stessa cartella. Un lotto
identificato dal solo `batch` sarebbe quindi la stessa chiave per operazioni
diverse, e chi ripercorre il registro raggrupperebbe insieme mutazioni che non
c'entrano niente. Ogni riga porta perciò un `writer` — un'identità per
**apertura del vault** — e la chiave di un lotto è la coppia.

È il costo di un campo, e vale la pena averlo pagato subito: è precisamente il
genere di riga che, scoperta dopo, si paga con una versione di schema.

### Il costo per salvataggio, misurato

Un giro sul disco in più a ogni salvataggio è una decisione. Misurata su questa
macchina, duemila `write_document` su un vault nuovo:

| | tempo | per salvataggio |
|---|---|---|
| senza registro | 17,4 ms | 8,7 µs |
| col registro | 22,4 ms | 11,2 µs |

Cioè **+2,5 µs a salvataggio, +14%** sul percorso di scrittura del kernel. È il
costo di una `open`+`write` su un file già esistente, e si paga.

Ciò che quella misura **non** dice, e va detto perché il numero c'è ed è
fuorviante: il banco gira su `/tmp`, che su questa macchina è una tmpfs, dove un
`fsync` costa quasi zero — con un `fsync` per riga il totale è 21,9 ms, cioè
indistinguibile. Quel numero non si può usare per decidere, e infatti la scelta
di **non** sincronizzare non poggia su di lui ma sull'ordine delle due
scritture: il registro si appende **dopo** che la mutazione è riuscita, quindi
un crash può far perdere la coda — le ultime operazioni non si potranno
annullare — e mai il contrario, una riga che racconta qualcosa che non è
successo. Il verso è quello giusto, ed è lo stesso della 0065 fra un danno raro
e rumoroso e uno certo e muto.

## Cosa NON è cambiato, e perché è la parte da guardare

**`write_atomicity.rs` non è stato toccato**, come non lo è stato dalla 0065 né
dalla 0066: presidia l'ordine parse→scrittura, che è un'altra cosa. E i test di
durabilità sono rimasti dove stanno, su `FsStorage` soltanto: il registro ha un
file suo (`il_journal.rs`), perché la domanda che pone non è cosa promette una
scrittura ma cosa resta scritto dopo.

**`il_supporto.rs` si è toccato in aggiunta**: `append` entra nel giro che le
due implementazioni fanno uguale, accanto alle altre sette. È un caso in più,
non un caso cambiato — e il pezzo che vale è quello che asserisce che `write`
sullo stesso path **sostituisce**: un supporto che confondesse le due promesse
renderebbe verde un registro che perde tutto a ogni riga.

**Nessun evento nuovo, nessuna variante di contratto, nessun ponte IPC.** Il
registro è interno al kernel come lo è il supporto della 0064, e per la stessa
ragione: chi lo leggerà — i comandi di manutenzione, un rollback — passerà dal
canale dati o dal registro dei comandi, che ci sono già. Aggiungere adesso una
`IndexQuery::Journal` senza un cliente sarebbe una firma disegnata da un lato
solo, che è ciò che la [0063](0063-la-maschera-e-dell-esemplare.md) ha appena
rifiutato di fare due volte.

**I presidi si sono verificati rossi**, come la 0066 col lock: sei sabotaggi,
sei rossi. Togliere la riga di registro (sette test su nove); far registrare un
ripristino come una creazione; togliere la riparazione della coda; far scendere
il file sotto `.fub/data/`; togliere il terminatore al record; scrivere nel
campo `inverse` la richiesta invece del suo contrario. L'ultimo è quello che
conta di più, perché è il solo modo di sapere che il presidio dell'inverso
guarda il risultato e non la presenza del campo.

## Cosa resta scoperto

**La §15.2 resta aperta con due caselle**, e sono le altre due di recovery: il
buffer di crash dell'editor e i comandi di manutenzione. Quest'ultima è un
**cliente** di questo verbale — `vault_health` e `diagnostic_bundle` leggono il
registro — e va fatta come `CommandProvider`
([0009](0009-registro-dei-comandi.md)
+ [0010](0010-comando-descritto-a-una-macchina.md)), non qui.

**Il rollback vero non è scritto, ed è di chi lo userà.** Questa voce ha reso se
l'informazione basta perché quel rollback sia scrivibile: per una modifica
chirurgica l'inverso è nella riga, per le quattro mutazioni strutturali si
deduce, e i confini di un'operazione sono la chiave di lotto. Chi lo scriverà —
l'importer del 17.3, il centro di comando del 22.4 — comporrà `UndoStep` come la
0045 li ha definiti, e troverà in `is_invertible()` il posto in cui il registro
dice di no.

**Nessuno legge ancora il registro in produzione.** È il rovescio del pregio: un
formato che non ha clienti è un formato di cui non si conosce ancora il difetto.
Vale la pena averlo scritto perché è la stessa cosa che la 0011 diceva del lotto
— si prepara la forma senza prendere la decisione di chi la userà — ma con
l'avvertenza che qui la forma è **su disco**, cioè la si cambia con una versione
di schema e non con un `impl`. È la ragione per cui la versione per riga non era
una formalità.

**`empty_trash` non lascia una riga**, e non è una svista: svuotare il cestino è
l'unica mutazione del kernel che non si può disfare in nessun modo, quindi una
riga che la registrasse direbbe soltanto «è successo» a chi non può farci
niente. Per l'audit (23.3) invece servirebbe, ed è la prima cosa che quel
cliente chiederà: si aggiunge una variante, additiva, il giorno che qualcuno
legge il registro per quella domanda.

**Due installazioni sulla stessa cartella si intrecciano le righe**, e va bene
così: un `O_APPEND` non si corrompe a vicenda, e il `writer` fa sì che le loro
operazioni non si confondano. Quello che non c'è — e che nessuno ha chiesto — è
un ordine globale fra le due: ognuna vede le proprie righe in ordine, e le
altrui mescolate alle proprie per data. Un lock per riga costerebbe a ogni
salvataggio ciò che la 0066 paga a ogni cambio di impostazione, ed è un prezzo
sproporzionato alla domanda.
