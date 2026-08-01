# 0066 — Un aggiornamento non è una scrittura, e il lock costa una promessa

|  |  |
|---|---|
| **Decisa** | 2026-08-01 |
| **Origine** | `todo.md` §15.2 (seduta 15) — la casella che la [0065](0065-una-scrittura-o-c-e-o-non-c-e.md) ha **lasciata aperta di proposito** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/15-il-disco.md) · [il verbale che l'ha rimandata](0065-una-scrittura-o-c-e-o-non-c-e.md) · [la mappa del disco](../architecture/on-disk-layout.md)

---

La [0065](0065-una-scrittura-o-c-e-o-non-c-e.md) ha chiuso la metà *scrittura*
del §15.2 e ha lasciato dietro una riga che sapeva già di non poter chiudere:
`write_atomic` è l'atomicità di **un file**, non di un **aggiornamento**. Chi la
chiama ricompone il contenuto intero dalla propria copia in memoria, quindi la
seconda installazione di Fub che salva atterra un file integro **senza** le
chiavi che la prima aveva scritto dopo che lei aveva letto. È la *lost update*, e
riguarda i tre file della macchina: `settings.json`, `vaults.json`,
`view-state.json`.

Perché fosse rimandata sta scritto là: la primitiva che la chiude è
`std::fs::File::lock`, **stabilizzata in Rust 1.89**, e l'MSRV del workspace era
**1.88**. Chiuderla voleva dire alzare l'MSRV o prendere una dipendenza, cioè
decidere qualcosa — e ciò che decide qualcosa non è una casella residua.

## La decisione

**Un aggiornamento è un'altra funzione**, e si chiama
[`update_atomic`](../../crates/fub-kernel/src/storage.rs): *rileggi sotto lock →
fondi → scrivi*. Chi la chiama non le passa il contenuto da scrivere — le passa
**come si rilegge** ciò che c'è e **cosa cambia**, e si riprende indietro lo
stato fuso da adottare al posto del proprio.

E **l'MSRV sale a 1.89**, con la ragione scritta in
[versionamento.md](../versionamento.md): la dipendenza non si prende.

## Le decisioni prese, da NON ridiscutere senza motivo

### La rilettura è la riga che conta; il lock è quella che chiude la finestra

È la distinzione da tenere, perché è quella che si perde: **un lock, da solo, non
risolve niente.** Chi lo prende e poi ricompone il file dalla copia che aveva in
mano scrive esattamente il file sbagliato di prima, solo senza che nessun altro
guardi mentre lo fa. La riga che toglie la perdita è la **rilettura**: ciò che si
scrive va composto sullo stato che il disco ha *adesso*, non su quello letto
all'apertura.

Il lock fa l'altra metà, ed è più piccola di quanto sembri: fra la rilettura e la
scrittura resta un istante in cui un'altra installazione può infilarsi, e senza
lock quell'istante è una perdita rara — cioè la specie peggiore, quella che non
si riproduce quando la si va a cercare.

Da cui il verso della scelta quando il lock **non c'è**: sui filesystem che non
lo implementano, `update_atomic` procede lo stesso. Rifiutarsi di salvare le
impostazioni su una share di rete sarebbe un danno certo al posto di uno
improbabile, ed è lo stesso criterio con cui la 0065 sceglie di scrivere sul
posto sui symlink. La rilettura, che è la parte che conta, non ha bisogno di
niente.

### Non ci sono un `write_atomic` e un `update_atomic` fra cui il chiamante sceglie *per lo stesso file*

I due esistono entrambi, ma non come due modi di fare la stessa cosa: uno scrive
un contenuto, l'altro applica una modifica. La forma che si è scartata è quella
in cui il chiamante prende un lock, poi rilegge, poi fonde, poi chiama
`write_atomic` — cioè quattro righe giuste da ripetere in tre posti. È la ragione
della [0064](0064-il-supporto-sta-sotto.md) sul `create_dir_all` e della 0065
sull'atomicità: una riga ripetuta a ogni chiamante è la riga che il quarto
chiamante dimentica, e qui dimenticarla non produce un errore ma un file
plausibile con dentro meno di quello che dovrebbe.

Per questo `fondi` serializza ciò che ha appena mutato invece di lasciarlo fare a
chi chiama: fra la mutazione e i byte non ci deve poter stare una riga.

### Il lock sta su un file **accanto**, e non sul file che si scrive

Sembra un dettaglio di implementazione ed è invece la ragione per cui la cosa
funziona. `write_atomic` **sostituisce l'inode**: un lock preso sul file che si
sta per rimpiazzare è un lock su un inode che un istante dopo non è più a quel
nome, e il processo che arriva dopo la rename ne apre un altro e se lo prende
senza aspettare nessuno — cioè un lock che non esclude niente, con l'aria di
funzionare. Il compagno (`.settings.json.lock` accanto a `settings.json`) non si
rinomina mai, quindi è lo stesso oggetto per tutti quelli che lo aprono.

Il nome comincia per punto per la ragione del temporaneo della 0065: è un file di
servizio, e chi guarda la cartella non lo deve vedere.

### Ciò che si fonde entra anche **in memoria**, non solo nel file

Il chiamante adotta lo stato che `update_atomic` restituisce. Senza questa riga
il file sul disco sarebbe giusto e la finestra aperta mostrerebbe ancora lo stato
di prima fino al riavvio: cioè la «terza verità che torna al riavvio» che la 0036
aveva già nominato scegliendo l'ordine disco→memoria, arrivata per un'altra
strada. Ha un presidio suo
(`chi_fonde_adotta_ciò_che_ha_trovato`), perché è la metà che si dimentica: il
test che guarda solo il file resta verde lo stesso.

### I tre file non hanno lo stesso danno, e uno dei tre non perde una traccia ma una scelta

Vale la pena averlo guardato file per file invece di trattarli come tre istanze
dello stesso caso:

- `settings.json` perde delle **chiavi**: il tema tornato chiaro, un interruttore
  che si riaccende;
- `view-state.json` perde lo scroll di **esemplari di un'altra finestra**, ed è
  il più silenzioso dei tre — nessuno si accorge di aver perso uno scroll finché
  non riapre;
- `vaults.json` perde i **preferiti**, e quelli non sono una traccia che si
  rideposita da sé: sono una scelta che qualcuno ha fatto una volta. Ed è il file
  in cui la fusione fa una cosa in più che le altre due non chiedono — il tetto
  dei venti recenti si applica **dopo** la fusione, o l'elenco fuso potrebbe
  restare più lungo del tetto che dichiara.

### L'MSRV sale, e la dipendenza non si prende

È la decisione vera di questo verbale, perché è l'unica che costa qualcosa a
qualcuno che non siamo noi. Le opzioni erano due.

**Alzare l'MSRV a 1.89.** Non è una riga di metadato: la CI compila
all'MSRV (`build + test`, toolchain pinnata), quindi il numero è **osservabile**
e la promessa è vera. [versionamento.md](../versionamento.md) la chiama parte del
contratto e dice che alzarla è un cambio **minor** che si fa deliberatamente e
non perché è comparso un warning. Questo è il caso deliberato: 1.89 è di agosto
2025, nessuna versione di Fub è stata rilasciata, e la clausola dello zero dice
già che finché la major è `0` è la minor a portare le rotture.

**Prendere una dipendenza** (`fs4`, `fd-lock`) l'avrebbe evitata. Scartata: una
dipendenza in più su un workspace che presidia la propria supply chain
([0001](0001-supply-chain-e-sbom.md), `deny.toml`, l'SBOM) è una promessa a
qualcun altro comprata con una promessa a tutti — e per una funzione che la
libreria standard adesso ha. Il codice da scrivere è lo stesso; ciò che cambia è
chi lo mantiene.

Le due promesse non sono simmetriche, ed è la ragione per cui la scelta non è
stretta: l'MSRV parla a chi **ricompila oggi** e può aggiornare la toolchain, la
supply chain parla a chiunque installi, per sempre.

## Cosa NON è cambiato, e perché è la parte da guardare

**Il rifiuto di sovrascrivere un file che all'apertura non si è letto resta il
primo controllo**, prima del lock e prima della rilettura. Sarebbe stato facile
convincersi che la rilettura lo rende inutile — se si rilegge, cosa c'è da
proteggere? — e sarebbe stato l'errore: il file rotto lo si rilegge male
*adesso* come lo si è letto male all'apertura, e la fusione su un errore di
lettura è un rifiuto, non un file vuoto. I tre presidi che lo dicono
(`un_file_rotto_non_lo_riscrive_il_primo_vault_aperto` e i suoi due gemelli) non
sono stati toccati, ed è la ragione per cui li si guarda.

**`write_atomic` è rimasta dov'era e come era**: i tre file della macchina la
usano ancora, sotto `update_atomic`. Non è stata sostituita, le è stata messa
sopra una funzione che risponde a un'altra domanda.

**I presidi nuovi stanno in `crates/fub-kernel/tests/la_durabilita.rs`**, sotto
una riga che dichiara il cambio di argomento — la scrittura di un file, e poi la
fusione di un aggiornamento — e uno nel modulo del registro, che è dove stanno i
suoi. Il caso si presidia con **due istanze aperte sullo stesso path**, e non è
un'approssimazione di due processi: ognuna ha letto il file una volta e da lì
tiene la propria copia, che è esattamente ciò che distingue due processi da due
chiamate. Un test scritto con una sola istanza presidierebbe il caso che già non
esisteva, perché dentro un processo il livello macchina è uno
([0036](0036-le-impostazioni-e-i-tre-stati.md)).

E uno dei nuovi presidia **il lock e non la fusione**: otto scrittori concorrenti
con otto copie in memoria, e otto chiavi che devono esserci tutte. Tolto il lock
è rosso, ed è stato verificato togliendolo — un presidio che resta verde in
entrambi i casi non dice niente su ciò che dichiara di sorvegliare.

## Cosa resta scoperto

**La §15.2 resta aperta con tre caselle, e adesso sono tutte e tre recovery**: il
buffer di crash dell'editor, il journal delle mutazioni, i comandi di
manutenzione. La metà *durabilità* della voce è finita qui — la scrittura con la
0065, l'aggiornamento con questa —, e ciò che resta è cosa si fa **dopo** che è
andata storta. Il verbale che le chiuderà cita queste due.

**Il journal non è ancora nato**, quindi l'avvertenza della
[§15.3](../roadmap/15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito)
resta dove la 0065 l'aveva lasciata, e vale identica: quel formato nasce col
campo di versione, o la versione dopo dovrà indovinare che un file senza campo
viene da prima.

**Il lock è per processo, non per thread**, e lo dice `File::lock` — due handle
dello stesso processo si escludono a vicenda come due processi. Dentro Fub questo
non si vede perché la mutazione in memoria (il `RwLock` del livello macchina, il
`Mutex` del registro) si prende **prima**, e quindi un solo thread per volta
arriva al file. L'ordine fra i due lock è quello e non l'altro: preso al
contrario, due thread che si contendono lo stesso file si bloccherebbero a
vicenda. È una riga da leggere, non una casella.
