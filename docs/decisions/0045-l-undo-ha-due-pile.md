# 0045 — L'undo ha due pile, e non si fondono

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §13.3 (seduta 13) — **chiude la seduta** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/13-identita-del-documento.md)

---

Il §13.3 sta nella seduta dell'identità perché è la stessa domanda sul **tempo**
invece che sullo spazio: chi possiede la storia di un documento. E chiedeva
quattro cose che sembrano quattro: un bug da chiudere subito, il fatto che
nessuna mutazione del kernel sia annullabile, quali siano i due livelli e chi
vinca fra loro, e chi conservi la storia e per quanto.

Sono due, e la seconda risponde alle altre tre:

> **L'undo del testo e l'undo delle operazioni non sono due metà della stessa
> pila. Non hanno lo stesso soggetto, quindi non si fondono — e a decidere quale
> risponde è il fuoco, non la cronologia.**

L'uno annulla ciò che non è ancora sul disco; l'altro annulla ciò che ci è già
arrivato. Fonderli vorrebbe dire ordinare fra loro «ho scritto tre lettere» e
«ho rinominato quaranta note»: il primo gesto non è ancora successo per il
vault, il secondo non è mai successo per il buffer, e un ordine comune non
esiste.

## Il bug, che non aspettava nessuna decisione

La voce lo diceva già: *«va chiuso subito»*, ed era **una perdita di dati a
portata di scorciatoia**.

`setDoc` sostituiva il documento con un `dispatch` di `changes` normali, che
entravano nella history di `basicSetup` come qualunque battuta di tastiera.
Quindi: si scrive in una nota, si apre un'altra nota, si preme Ctrl-Z — e
CodeMirror riporta il contenuto della **nota precedente** dentro il documento
aperto. Il salvataggio automatico lo persiste 400 ms dopo.

La voce suggeriva due riparazioni, e una delle due non basta. Marcare quel
`dispatch` come non annullabile toglie di mezzo il testo che *abbiamo* messo, e
lascia in pila le modifiche **dell'altra nota**, ancora applicabili a questa. La
riparazione vera è azzerare la cronologia, e CodeMirror non ha un «svuota la
history»: la si azzera **ricostruendo lo stato**, che è anche la forma più
onesta, perché ciò che sta succedendo è appunto cominciare un altro documento.

Due conseguenze che il diff non mostra:

- i due compartment (resa inline, tema) devono ripartire da **ciò che vale
  adesso** e non dal default, o aprire una nota rimetterebbe la modalità
  Sorgente in Live Preview;
- `setState` non passa dai listener di aggiornamento — non è una transazione —
  quindi il cursore nuovo va annunciato a mano, o il contesto di sessione resta
  quello del documento di prima. Che è metà del difetto, riapparso da un'altra
  porta.

Il presidio è `frontend/src/editor/editor.test.ts`, ed è stato verificato
**rosso** sul codice di prima: tre asserzioni su quattro fallivano. Vale la pena
scriverlo perché è la classe di difetto che questo repo ha già incontrato tre
volte — un presidio che passa a vuoto — e la sola prova che non lo sia è
guardarlo fallire.

## La forma nel contratto: `CommandOutcome.undo`

Il §13.3 diceva che la parte P0 è di **forma**: «senza la decisione,
`CommandOutcome` e il lotto nascono privi del campo con cui un'operazione
dichiara di essere annullabile». Il campo c'è:

```rust
pub struct CommandOutcome { …, pub undo: Option<Undo> }
pub struct Undo { pub label: Text, pub steps: Vec<UndoStep> }
pub enum UndoStep { Edit(PlannedEdit), Command { command, args } }
```

### `None` è il default, e vuol dire «non annullabile»

Nessuno deduce l'inverso di un'operazione che non lo ha detto. La forma sta nel
contratto e non in un registro dell'host per una ragione che si vede solo
provando a scriverlo dall'altra parte: **l'host vede una scrittura, non quale
gesto l'ha prodotta.** Sa che `a.md` è cambiato; non sa se era una sostituzione
in blocco, una task spuntata o un template applicato, e quindi non sa cosa
dovrebbe dire il menu che la disfa.

### `UndoStep::Command`, e il vocabolario che non si è scritto

L'inverso di una modifica al testo il contratto lo conosceva già
([0008](0008-modifica-chirurgica.md): `EditReport::inverse()` è una
`EditRequest` come le altre). Ciò che non aveva è l'inverso di un cambiamento
**strutturale** — una nota creata, cestinata, rinominata — di cui non esiste un
inverso *testuale*, perché non c'è nessun testo che sia cambiato.

Le strade erano due, e la scartata è quella che sembra ovvia: un linguaggio di
operazioni inverse (`Restore { … }`, `Trash { … }`, `Rename { … }`). Sarebbe
stato un **secondo vocabolario accanto a quello dei comandi**, da tenere
allineato con esso a ogni capacità nuova.

Invece: un comando, col suo id e i suoi argomenti. Le operazioni un nome ce
l'hanno già ([0009](0009-registro-dei-comandi.md)) e chi annulla sa già
eseguirle. *Annullare una rinomina è una rinomina all'incontrario; annullare una
cancellazione è un ripristino dal cestino.*

Il guadagno si vede in un presidio, e non era previsto: annullare una rinomina
riporta indietro anche **i wikilink che la rinomina aveva riscritto nelle
sorgenti**, gratis, perché a farlo è la rinomina inversa. Un linguaggio di
operazioni inverse avrebbe dovuto rifare quel lavoro, e rifarlo *uguale*.

### I passi sono in ordine di esecuzione, e chi esegue non riordina

Cioè al contrario di come le cose sono successe. È la sola cosa che un comando
composto deve ricordarsi, ed è deliberato che sia sua: riordinare vorrebbe dire
capire cosa dipende da cosa, e non lo sa nessuno meglio di chi ha scritto
l'operazione.

## La pila: chi la tiene, per quanto, e cosa non ci entra

**Il kernel**, e dura quanto il vault aperto — la cronologia «per sessione» che
FEATURES 4.2 chiede. Non è una rinuncia al journal del §15.2: farla sopravvivere
a una chiusura non è tenerla su disco, è accorgersi di ciò che è cambiato mentre
l'app era spenta. Quello è un journal, ed è un'altra cosa; questa pila è il
pezzo che si può avere prima, e senza il quale il journal non saprebbe comunque
*cosa* registrare.

Tre regole, e ognuna chiude un modo di sbagliare:

- **Si riempie a profondità zero.** Una macro di tre rinomine è **una** voce e
  non tre — la stessa regola per cui è un `batch-ended` solo
  ([0011](0011-il-lotto.md)). Chi compone comandi compone anche il loro
  annullamento, ed è la terza cosa che si compone gratis passando da
  `run_command`, dopo il piano e il lotto. Se ogni passo entrasse in pila,
  annullare una volta disferebbe un terzo dell'operazione, e chi guarda non
  avrebbe modo di sapere che gliene mancano due.
- **Solo `Apply`.** Mettere in pila l'inverso di ciò che non è successo sarebbe
  la scala per uscire dalla simulazione, e ci si uscirebbe **scrivendo**.
- **Annullare non è annullabile.** I passi di un annullamento sono comandi come
  gli altri e dichiarano il proprio inverso: senza una bandiera che li tiene
  fuori, la seconda pressione rifarebbe ciò che la prima ha disfatto, per
  sempre. Il *redo* è un'altra pila e un'altra decisione, e oggi non c'è.

E non ci entra il **salvataggio dell'editor**. La riga che separa le due pile è
dove passa il gesto: un comando entra da qui, una battuta di tastiera no.

## `undo_last` è una capacità, e la 0013 letta al contrario

La [0013](0013-elenco-delle-capacita.md) aveva chiuso l'elenco delle capacità, e
questa voce ne aggiunge una. La ragione non è un'eccezione: è quella regola
letta al contrario. La pila è **privata del kernel**, e un `CommandProvider`
riceve solo l'`HostApi` — quindi «togli l'ultima voce e falla» non è scrivibile
senza una firma. Ogni comando che tocchi stato privato del kernel finisce in una
capacità; è successo per il vault, per le impostazioni, per lo stato di vista.

Il comando c'è lo stesso — `vault.undo` — ed è lui a comparire nella palette con
una scorciatoia e una descrizione per un umano, che sono le tre cose che la
[0009](0009-registro-dei-comandi.md) dà gratis a un comando e a nessuna
capacità.

Due dettagli del confine che valgono una riga:

- **Due controlli e non uno.** Annullare è invocare (i passi sono per metà
  comandi) *ed* è, sempre e per definizione, scrivere. Ciò che scrive non passa
  dal recinto del chiamante, perché a eseguirlo è il kernel: senza il secondo
  controllo, un host di sola lettura avrebbe una scala per riscrivere il vault.
- **La scorciatoia non è `Mod-z`.** Quella è dell'editor. Darla a entrambe le
  pile vorrebbe dire che Ctrl-Z fa due cose a seconda di chi vince la corsa —
  che è la stessa ragione per cui `note.task.toggle` non prende `Mod-Enter`.

## Dove le due pile si incontrano, e il contratto sapeva già cosa dire

In un punto solo: un'operazione che si annulla mentre l'editor tiene un buffer
sporco dello stesso documento. La `EditRequest::base` dell'inverso è la
revisione che l'operazione ha **prodotto**, quindi una scrittura arrivata dopo
la rende un `Conflict` ([0008](0008-modifica-chirurgica.md)) invece di una
sovrascrittura silenziosa.

Non è una guardia aggiunta per l'undo: è quella firma che vale anche qui, ed è
la prova che il §13.3 aveva ragione a dire che senza la 0008 questa decisione
sarebbe nata zoppa.

La voce resta **consumata** anche quando il conflitto la fa fallire: riproporla
vorrebbe dire riproporre di cancellare il lavoro di chi ha scritto dopo.

## Cosa si è scartato, e perché

- **Un linguaggio di operazioni inverse.** Vedi sopra: un secondo vocabolario
  accanto a quello dei comandi, e la riscrittura dei link da rifare uguale.
- **Fondere le due pile.** Non hanno un ordine comune. È la decisione, non un
  compromesso.
- **`Mod-z` per `vault.undo`.** Due gesti sulla stessa combinazione.
- **Una pila illimitata.** Una voce non è un puntatore: porta dentro il testo
  sostituito di ogni modifica che annulla, quindi una sostituzione su mille note
  è mille frammenti di documento in memoria. Il tetto è cento, e si perde la più
  vecchia — quella che nessuno raggiungerà mai andando all'indietro.
- **Registrare in pila ogni `write_document`.** Avrebbe reso annullabile il
  salvataggio dell'editor, cioè avrebbe messo la stessa modifica in due pile che
  rispondono a due scorciatoie con due risposte diverse.
- **Un piano onesto per il `dry-run` di `vault.undo`.** Dire *quali* documenti
  tornerebbero indietro vuol dire togliere la voce dalla pila, cioè fare metà
  dell'operazione per raccontarla. Il comando simulato dice la sola cosa vera
  che può dire senza toccare niente.
- **Cancellare per sempre come inverso di `note.create`.** L'inverso di un gesto
  reversibile deve restare reversibile, o annullare sarebbe più distruttivo di
  ciò che annulla. È il cestino.

## Cosa resta scoperto (e dove è scritto)

- **Il redo non esiste.** È una seconda pila e una regola su cosa la invalida, e
  nessun cliente l'ha chiesta: FEATURES 4.2 chiede «undo illimitato, cronologia
  per sessione».
- **La shell non mostra la pila.** Non c'è un «Annulla: rinomina di Nota.md» in
  un menu, e non c'è modo di chiedere *cosa* si annullerebbe senza annullarlo —
  la lettura della pila non passa dal canale dati. È lavoro di superficie e sta
  col §20.4 (la shell non ha una superficie dove dire niente); il campo `undo`
  arriva già alla shell nel `CommandOutcome`, quindi la mezza informazione
  «l'ultima operazione era annullabile» c'è.
- **La pila non sopravvive alla chiusura del vault.** Dichiarato: è il §15.2.
- **`vault.archive` compone gli inversi dei passi riusciti**, e i falliti li
  salta — che è giusto, perché su di loro non è successo niente. Ma la voce
  risultante non *dice* che è parziale, e chi la annulla non sa che stava
  disfacendo undici note su dodici. È la stessa lacuna che la
  [0041](0041-un-errore-e-testo-che-qualcuno-legge.md) ha nominato per il
  successo parziale del rename: il contratto non ha una variante che dica «è
  andata a metà».
- **Le mutazioni che non passano da un comando non entrano in pila.** Oggi sono
  quelle che la shell fa direttamente col kernel; il giorno che diventeranno
  comandi (§18.2) entreranno da sole, ed è la ragione per cui il punto in cui la
  pila si riempie è l'invocazione e non la scrittura.
