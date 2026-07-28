# 0047 — La cartella esiste nel kernel, e la lista si chiede per cartella

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §14.3 + §14.4 (seduta 14) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/14-entry-cartelle-lista.md)

---

L'altra coppia della seduta, e il piano diceva che sono **lo stesso lavoro visto
da due lati**: dare un modello alle cartelle e chiedere la lista per cartella
sono la stessa domanda dal lato del kernel e dal lato di chi disegna.

> **Una cartella era un prefisso, e la lista era tutto il vault.**

Le cartelle non esistevano: nascevano dai path delle note dentro
`organizer.ts::buildTree`, quindi una cartella vuota non c'era, una rimasta
vuota spariva da sola, e la [0013](0013-elenco-delle-capacita.md) aveva tenuto
`create_folder` **fuori** dalle capacità perché avrebbe prodotto qualcosa che
nessuna query vede. Dall'altro lato la lista si chiedeva intera: `list_documents`
restituiva un `Vec<String>` con l'intero vault, e `VaultInfo` se lo portava
dietro all'apertura — diecimila righe per disegnarne venti.

## La decisione: una cartella è ciò che il disco ha, e si chiede un livello per volta

```rust
pub struct VaultFolder { pub path: String, pub folders: u32, pub entries: u32 }
pub struct FolderScope { pub path: String, pub descendants: bool }

IndexQuery::Folders { under: Option<FolderScope>, page: Option<Page> }
IndexQuery::Entries { of_kind, within: Option<FolderScope>, page }
```

La camminata del vault raccoglie **anche le directory** (`Vault::scan` risponde
con `Scan { files, folders }`), e il kernel le tiene in un insieme accanto
all'anagrafe.

## Le decisioni prese, da NON ridiscutere senza motivo

### Una cartella esiste perché il disco ce l'ha, non perché un path la nomini

È la differenza fra una cartella e un prefisso, e si vede in due casi che prima
non erano nemmeno rappresentabili: una cartella **vuota** c'è, e una cartella
resta quando la sua ultima nota va nel cestino — perché `trash` sposta un file,
non rimuove una directory. Il vecchio albero la faceva sparire, cioè raccontava
qualcosa che sul disco non era successo.

Il contrario non vale in modo simmetrico, ed è deliberato: un file che nasce
**aggiunge** le cartelle che attraversa (`ensure_folders_of`), un file che muore
non ne toglie nessuna. Una directory rimossa da fuori si scopre alla riapertura;
inventare un evento di cartella per un caso che il rilevatore non nomina sarebbe
stato aggiungere un canale per non guardarlo.

### Le cartelle sono una famiglia a sé, non una quarta specie di `EntryKind`

Una cartella non ha dimensione, non ha un contenuto da datare, non ha
un'impronta. Metterla dentro un [`VaultEntry`] avrebbe voluto dire tre campi che
mentono e un filtro da ricordarsi in **ogni** cliente dell'anagrafe. Due
famiglie separate hanno anche la proprietà che serve a M5: un indice che sappia
elencare i file di un supporto remoto può rivendicare `Entries` senza doversi
inventare `Folders`.

Per la stessa ragione una cartella **non è un `DocId`**: quel tipo nomina un
file, «estensione inclusa» ([0043](0043-il-path-e-la-chiave.md)). È una
`String`, come già lo sono le chiavi di `QueryPredicate::Folder` e quelle
dell'organizzazione.

### I conti si contano, non si tengono

`folders` ed `entries` sono in `VaultFolder` perché sono ciò che decide se
disegnare la freccetta che apre — cioè si devono sapere *prima* di chiedere cosa
c'è dentro, o l'albero pigro farebbe una domanda per cartella solo per sapere
quali sono espandibili. Ma non stanno **scritti** da nessuna parte: si contano
al momento della risposta dalle due mappe ordinate, e l'ordine lessicografico
rende il sottoalbero di una cartella contiguo, quindi il conto costa il
sottoalbero e non il vault. Un conto mantenuto a mano a ogni file che nasce o
muore sarebbe stato un secondo conto che può divergere dal primo.

Nome e cartella genitore non sono campi per la ragione per cui il MIME di un
allegato non lo è ([0046](0046-l-anagrafe-del-vault.md)): sono funzioni pure del
path.

### La regola di «ci sta dentro» resta **una**

`within_folder(own, path, descendants)` è la regola sotto `in_folder`, scritta
su ciò che contiene invece che su ciò che è contenuto: per un file `own` è la
cartella che lo ospita, per una cartella è la sua genitrice, e da lì in poi le
regole sono le stesse — radice compresa. Due funzioni sarebbero divergute sul
caso che nessuno prova.

### Il filtro sta prima della finestra

Una pagina tagliata sull'anagrafe intera e poi filtrata sarebbe una pagina con
dentro un numero di righe che dipende da cosa c'è nel *resto* del vault. `total`
è il conto **di quella cartella**, che è ciò che un «1-20 di 43» deve dire.

### `list_documents` non è più un comando IPC, e `VaultInfo` non porta l'elenco

Erano i due posti in cui la shell chiedeva l'intero vault, e nessuno dei due
poteva chiedere una finestra: il primo perché il comando la `Page` non la
prendeva, il secondo perché era un **record**, e dentro un record una finestra
non si può nemmeno chiedere. Chi vuole l'elenco passa dal canale dati, che è la
stessa porta da cui lo chiederebbe un plugin. La **capacità** omonima
(`VaultRead::list_documents`) resta dov'è: quella la `Page` la prende, ed è
l'elenco dei plugin, non quello della shell.

Chi doveva aprire «una nota qualsiasi» — l'apertura del vault, il cestino che ha
appena cancellato ciò che si stava guardando — la chiede con una finestra da
**uno** invece di prendere il primo elemento di un elenco intero.

### L'albero della shell chiede ciò che si vede

`buildTree` non c'è più, e con lei `FolderNode`, `allFolders`, `findFolder`: in
`rules/organizer.ts` resta ciò che il kernel non sa — in che ordine l'utente
vuole vedere i fratelli, e qual è la nota che una cartella apre. Il pannello
carica **un livello per volta**, in parallelo per livello, e ridisegna solo se
l'impronta della risposta è cambiata (un `index_updated` arriva a ogni
salvataggio, e ricostruire l'albero distrugge gli `<li>` sotto il mouse).

Due domande che restavano da fare sull'elenco intero — «quali appuntate esistono
ancora» e «quali di queste cartelle hanno una folder note» — sono diventate
**una sola**, con la foglia `Docs`: un pugno di path noti, e il kernel dice
quali esistono. Verificarne cinque non è una ragione per chiedere diecimila
righe.

## Cosa si è scartato, e perché

- **Dedurre le cartelle dai path dei file.** È ciò che faceva la shell, ed è
  esattamente la ragione per cui una cartella vuota non poteva esistere.
- **Un quarto `EntryKind::Folder`.** Tre campi che mentono, e un filtro in ogni
  cliente dell'anagrafe.
- **Un `DocId` per le cartelle.** Quel tipo nomina un file, e ogni firma che lo
  accetta si troverebbe a ricevere anche una cartella senza saperlo.
- **Tenere scritti i conteggi.** Un secondo conto da mantenere a ogni scrittura,
  che diverge dal primo il giorno che qualcuno dimentica una riga.
- **Aggiungere `create_folder` alle capacità.** Questa voce la rende *additiva*
  — la ragione per cui la 0013 la teneva fuori non c'è più — ma l'elenco delle
  capacità è una decisione chiusa, e una capacità il cui unico cliente sono i
  gesti su cartella (FEATURES 3.2) la porta chi quei gesti li scrive.
- **Un evento `FolderRemoved`.** Cancellare un file non cancella la sua
  directory, e la sparizione di una cartella non ha oggi nessuno che la annunci:
  un evento che nessuno emette è peggio del silenzio.
- **Far portare a `Entries` anche le cartelle.** Sarebbe stata una risposta
  eterogenea da filtrare, cioè il contrario di «la specie la sceglie la
  domanda».
- **Togliere la `Page` dalla capacità `list_documents`.** Il difetto era il
  comando IPC, non il contratto: là la finestra c'è dal §5.5.

## Cosa resta scoperto (e dove è scritto)

- **Creare, rinominare e spostare una cartella** restano di FEATURES 3.2: adesso
  hanno un modello su cui poggiare, e una rinomina resta N rename senza
  atomicità finché non passa dal lotto ([0011](0011-il-lotto.md)).
- **L'organizzazione di una cartella non la migra nessuno** quando la cartella
  cambia nome: `migrate_identity` sposta le chiavi di un documento, non quelle
  di una cartella. Non serve finché rinominare una cartella non si può.
- **Una cartella creata da fuori mentre il vault è aperto** si vede alla
  riapertura, o quando ci nasce dentro un file: il rilevatore nomina file, e
  questa voce non gli ha aggiunto un canale.
- **L'albero mostra ancora i soli documenti.** `within` vale per ogni specie —
  un pannello degli allegati si scrive con la stessa domanda — ma cosa succeda
  cliccando un PNG resta da decidere a chi lo disegnerà.
- **La folder note di una cartella non aperta** si riconosce per confronto
  esatto dei path, non con la chiave di risoluzione: `X/x.md` non conta come
  folder note di `X` finché la cartella non è aperta. Dentro una cartella
  caricata vale la regola di sempre.
