# 0044 — Lo stato per-documento: un posto dichiarato, e chi ci passa dietro

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §13.2 (seduta 13) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/13-identita-del-documento.md)

---

Questa voce esiste **perché** la [0043](0043-il-path-e-la-chiave.md) ha deciso
come ha deciso. Il §13.2 lo diceva come condizionale — «se l'identità resta il
path, la migrazione della chiave è per sempre un problema del kernel; con un id
stabile diventa un non-problema» — e adesso la condizione è vera. Da
generalizzazione facoltativa la voce è diventata il pezzo che regge il peso.

Il difetto che descriveva era una cosa sola vista tre volte:

> **Il rename è un rito che ognuno celebra per conto proprio, e ognuno lo
> celebra col proprio buco — che è lo stesso buco.**

Il versioning migrava la sua chiave ascoltando `DocumentRenamed`. Il sidecar
dell'organizzazione la migrava in TypeScript (finché la
[0038](0038-il-kernel-possiede-il-sidecar.md) non gliel'ha tolta di mano). Le
prossime — annotazioni, task, commenti, database, flashcard — l'avrebbero
migrata una terza e una quarta volta. E ogni copia del rito ha lo stesso punto
cieco: **chi ascolta un evento non sente ciò che è successo mentre non c'era.**

## La decisione: un posto, non una porta

Ciò che mancava non era una capacità. `data_read`/`data_write` esistono, e un
plugin che tiene qualcosa attaccato a una nota ce lo mette già. Mancava che il
kernel sapesse **riconoscere** ciò che passa da lì: finché la chiave è una
convenzione privata di ognuno, il kernel non può migrarla perché non sa dove
guardare.

Quindi: una **regola del contratto**, non una firma.
[`fub_abi::rules::doc_data`](../../crates/fub-abi/src/rules/doc_data.rs).

```text
.fub-data/plugins/<plugin>/doc/<documento codificato>/<nome>
```

Tutto ciò che sta sotto `doc/` è per-documento, e il kernel lo migra e lo
raccoglie. Tutto ciò che non ci sta è del plugin, e il kernel non lo tocca. La
[0013](0013-elenco-delle-capacita.md) aveva chiuso l'elenco delle capacità, e
questa voce non lo riapre: è un posto dichiarato dentro una porta che c'era già.

## Le decisioni prese, da NON ridiscutere senza motivo

### Il verso che conta è l'inverso

`doc_of(path) -> Option<DocId>` — «di chi sono questi dati?» — è la metà che
porta il peso, ed è la ragione per cui la codifica è **reversibile** invece di
essere un'impronta.

Con un digest lo spazio sarebbe più corto, più uniforme, e la raccolta sarebbe
**impossibile**: nessuno potrebbe più dire *quale* nota nomina una cartella,
quindi nessuno potrebbe sapere che quella nota non c'è più. La domanda che il
§13.2 poneva — «cancellata una nota per sempre, chi cancella i dati che la
nominavano?» — non ha risposta senza questa funzione.

Da qui segue tutto il resto della forma: il documento è **un componente solo**
(uno `/` nudo renderebbe indecidibile dove finisce il documento e dove comincia
il nome), e il nome è **un componente solo** (se potesse annidarsi, la stessa
domanda tornerebbe dall'altro lato).

### La raccolta è un giro, non un evento

Gira all'apertura del vault, quando l'anagrafe è appena stata ricostruita ed è
al suo massimo di verità. **Non** sulla cancellazione definitiva, che pure
sarebbe il momento naturale.

La ragione è la stessa che ha fatto nascere la voce, letta al contrario: un
evento lo si perde. Il cestino svuotato ad app chiusa non lo annuncia nessuno, e
una raccolta che dipendesse dall'annuncio non raccoglierebbe mai quel caso —
cioè quello che succede quando l'utente fa pulizia dal Finder. Un giro sul disco
non ha questo problema, e costa una `read_dir` per plugin a ogni apertura.

### «Non esiste più» vuol dire né nel vault **né nel cestino**

È la riga che rende la raccolta sicura invece che aggressiva: una nota cestinata
è recuperabile, e ripristinarla senza i suoi dati sarebbe una perdita silenziosa
fatta da chi doveva impedirla. I dati se ne vanno un giro dopo che la nota è
uscita dal cestino, non quando ci entra.

### Sotto `doc/` sta ciò che non ha senso senza il documento

È la conseguenza della politica di raccolta, ed è la riga che un autore di
plugin deve leggere prima di scegliere dove mettere le sue cose. Un'annotazione,
una riga di database, lo stato di una flashcard: muoiono con la nota, e stanno
lì.

E il **controesempio è nel repo**, ed è quello che definisce la regola: la
storia delle versioni **non** sta lì, e non ci deve stare. Il versioning esiste
apposta per restare leggibile dopo la cancellazione — tiene un tombstone, e la
nota cancellata è precisamente ciò che si vuole poter recuperare. Un dato che
deve sopravvivere al documento tiene il proprio store fuori da `doc/`, ed è il
caso in cui la regola si vede meglio.

### Il kernel cammina il disco, non il registro dei montati

La migrazione e la raccolta guardano `.fub-data/plugins/*` sul filesystem,
**anche per i plugin spenti**. Non è generosità: è che un plugin spento oggi non
deve riaccendersi domani con le chiavi di ieri, ed è esattamente chi non può
accorgersene da solo. Il presidio di questa voce è scritto su un plugin che non
è mai stato montato — se funziona per lui, funziona per tutti, e il contrario
non è vero.

### Il ripristino su un altro path è una rinomina, e adesso lo è davvero

Quando il cestino restituisce una nota e il path d'origine è di nuovo occupato,
l'app ne sceglie un altro: la chiave è cambiata, e il §13.2 lo nominava già come
«un rename a tutti gli effetti, anche se il documento non era indicizzato».
Adesso `restore_from_trash` migra anche lo spazio per-documento, accanto
all'evento che già emetteva — e per la ragione della
[0038](0038-il-kernel-possiede-il-sidecar.md): la coda eventi ha un budget e può
troncare ([0034](0034-il-freno-e-il-raggruppamento.md)), quindi un dato
autorevole non può dipendere da una consegna dichiaratamente best-effort.

## Cosa si è scartato, e perché

- **Una famiglia di capacità nuova** (`doc_data_read`/`doc_data_write`/…).
  Sarebbe stata la lettura più ovvia della voce, e avrebbe riaperto l'elenco
  della [0013](0013-elenco-delle-capacita.md) per **quattro firme** che dicono
  ciò che `data_*` già dice con un prefisso in più. Il kernel ha bisogno di
  riconoscere il prefisso, non di possedere la porta.
- **Un'impronta al posto della codifica reversibile.** Vedi sopra: costa
  `doc_of`, cioè costa la raccolta, cioè costa la metà della voce.
- **Raccogliere su `DocumentRemoved`.** È l'evento sbagliato due volte: lo
  emette anche il watcher per un file *spostato fuori* — cioè una nota che
  potrebbe tornare — e non lo emette affatto per il cestino svuotato ad app
  chiusa.
- **Migrare i dati sull'evento `DocumentRenamed`, dentro il kernel.** Sarebbe
  stato più simmetrico, e sarebbe stato la stessa consegna best-effort che la
  0038 aveva già scartato per l'organizzazione.
- **Far fallire una rinomina riuscita** perché un plugin non ha potuto seguirla.
  Il file è già stato spostato: il verso giusto è che la rinomina valga, i dati
  restino indietro, e qualcuno lo dica (`doc_data_warnings`).

## Cosa resta scoperto (e dove è scritto)

- **Non ha ancora un cliente vero.** Il versioning non ci va (per la ragione di
  sopra, che è buona) e l'organizzazione è del kernel dalla
  [0038](0038-il-kernel-possiede-il-sidecar.md). I clienti sono i cinque che
  FEATURES elenca e che non esistono ancora. È un rischio dichiarato — la
  [0042](0042-il-catalogo-della-shell.md) ha appena scritto che una chiave senza
  cliente si cancella — e la differenza per cui questo caso regge è che qui non
  si è aggiunta una porta: si è dichiarato un posto dentro una porta che ha già
  clienti. Costa una regola e un giro all'apertura, non una firma congelata.
- **Un `DocId` molto lungo produce un nome di file molto lungo**, e i filesystem
  si fermano intorno ai 255 byte per componente. Un vault con una nota annidata
  dieci cartelle sotto può superarlo, e allora la scrittura fallisce con un
  errore di I/O. È **rumoroso e recuperabile**, mentre accorciare con
  un'impronta sarebbe silenzioso e irreversibile. Scritto accanto a `encode`.
- **La migrazione non copre la rinomina fatta ad app chiusa** che il watcher non
  può accoppiare: quella nota risulta sparita e ne nasce una nuova, quindi i
  dati vecchi li raccoglie il giro successivo. Non è una perdita che questa voce
  introduce — è quella che già c'era — ma adesso almeno smette di *accumularsi*
  in silenzio.
- **Gli avvisi finiscono su `stderr`**, che in un'app impacchettata non ha un
  lettore. È il §20.2/§20.4, e vale per loro come per gli altri.
