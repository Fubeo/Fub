# Recupero e versioni

> **Ambito:** cestino, rinomine recuperabili, versioning e snapshot globale:
> il comportamento visibile. Parte di [Vault e file](vault-and-files.md).
> Meccanismo in [storage-and-identity.md](../architecture/storage-and-identity.md),
> formato su disco in [on-disk-layout.md](../reference/on-disk-layout.md).

## Rinomine e archiviazione recuperabili

Prima di una rinomina Fub fotografa la revisione del file e le modifiche
necessarie ai backlink. Pubblica quindi un intent schema 1 sotto `.fub/` prima
di spostare dati per-documento o contenuto. Se il processo si interrompe, la
riapertura attende l'indice completo e confronta i byte osservati con la
preimmagine: riprende la rinomina in avanti, completa i backlink già preparati
oppure termina un rollback già dichiarato. Il formato dell'intent e le sue
regole di recupero sono in [on-disk-layout.md](../reference/on-disk-layout.md#stato-del-vault);
le regole che una rinomina deve rispettare sono in
[storage-and-identity.md](../architecture/storage-and-identity.md#rename).

La posizione dei file non basta a giustificare una sovrascrittura. Se compare
una destinazione, cambia la sorgente o entrambe le posizioni sono ambigue, Fub
lascia l'intent ispezionabile e segnala un conflitto. Un record illeggibile o
prodotto da uno schema futuro non blocca il recupero degli altri record. Lo
spazio per-documento rimasto a metà di una migrazione (`*.in-progress`) è
l'unica copia di quei dati: la raccolta degli spazi orfani non lo cancella.

Se la destinazione ha già uno spazio per-documento, per esempio il residuo di
una nota cancellata, i dati della nota rinominata la seguono comunque. Ciò che
occupava la destinazione si sposta accanto, sotto `<nome>~displaced` (poi
`~displaced-2` e così via), con i byte intatti, e l'avviso della rinomina dice
dove. La raccolta non tocca quei nomi. Se uno spazio non si lascia spostare per
un guasto del disco, una rinomina fatta da Fub si ferma prima di muovere il
file e riporta indietro ciò che aveva già spostato. Una rinomina fatta da
un'altra applicazione arriva a file già spostato: i dati restano sotto il nome
vecchio e l'avviso lo segnala, ma finché restano lì la raccolta li tratta come
lo spazio di una nota che non c'è più.

`vault.archive` applica la stessa regola a un insieme di file. Verifica tutte le
sorgenti, le revisioni e le destinazioni prima della prima mossa e pubblica un
record durevole dell'intero batch. Dopo ogni file registra l'avanzamento. Una
riapertura può quindi riconciliare sia una mossa già registrata sia una mossa
conclusa appena prima dell'interruzione, senza ripeterla e senza toccare una
destinazione estranea. I file completati formano un'unica operazione annullabile
nell'esito del comando.


## Cestino

La cancellazione sposta la voce nel cestino del vault. Un sidecar può ricordare
la posizione originale e consentire il ripristino.

Il sidecar è un aiuto, non l'unica copia della nota. Se manca o non è
compatibile, il comportamento di degrado deve preservare il contenuto e usare
una destinazione sicura. Un sidecar presente che il disco non sa leggere non
vale come assente: l'elenco del cestino e il ripristino si fermano con l'errore
invece di rimettere la nota nella radice.

Il cestino è piatto, quindi per una nota di una cartella il sidecar è l'unico
posto che ricorda da dove veniva. Se non si scrive, la nota torna dov'era e la
cancellazione fallisce con l'errore. Una nota della radice si cestina lo stesso,
perché il nome basta a riportarla.

Finché una nota sta nel cestino, i suoi dati per-documento restano, ma non sotto
il suo path: il path è l'identità di una nota viva, e una nota cestinata lo
lascia libero. La cestinatura li parcheggia sotto l'identità che la voce ha nel
cestino e mette nel sidecar l'organizzazione della nota (icona, posto fra le
appuntate, posto nell'ordine della sua cartella); la storia delle versioni
segue la stessa regola. Una nota nuova che riprende quel path parte quindi da
zero, senza ereditare niente da quella cestinata, e un ripristino altrove non
porta via ciò che appartiene alla nota che ha preso il path. Il ripristino
riporta tutto sotto il path d'arrivo, anche se non è quello d'origine; se lì
c'è già uno spazio per-documento vale la regola delle rinomine
(`~displaced`), e un'icona già scelta per la nota che occupa quel path non si
sovrascrive. L'ordine a mano torna soltanto se la nota rientra nella stessa
cartella.

La raccolta degli spazi orfani conserva lo stato parcheggiato di ogni voce che
è ancora nel cestino e toglie quello delle altre. Una voce cestinata da una
versione precedente di Fub, o senza sidecar come quelle cestinate da Obsidian,
non ha parcheggiato niente e non dice la sua cartella: la raccolta conserva i
dati di ogni nota con quel nome, in qualunque cartella. Al ripristino di una voce
così i dati seguono la nota solo se il path d'origine è libero; se lo occupa una
nota viva Fub non indovina di chi siano, li lascia dove stanno e lo dice con un
avviso. Lo stesso vale per la cancellazione fatta con `trash.os`: lo stato resta
sotto il path d'origine. Se il disco non sa dire se il cestino c'è, se il cestino
non si elenca, o se un sidecar presente non si legge o viene da una versione più
nuova di Fub, la raccolta si ferma invece di indovinare da quale cartella
venisse la nota. Anche l'elenco del cestino risponde con l'errore invece di
mostrarsi vuoto.

L'impostazione di vault `files.trash` sceglie dove finisce una nota cancellata
dalla shell. `vault` (default) usa il cestino interno. `system` usa il comando
`trash.os`, che prova il cestino del sistema operativo e, se non è disponibile,
sposta la nota nel cestino interno; l'esito del comando segnala il ripiego con
un messaggio, lo stesso dalla shell e dalla palette. Col cestino
del vault la cancellazione non chiede conferma e offre «Annulla» nell'avviso;
col cestino di sistema, da cui Fub non può ripristinare, chiede conferma.
Svuotare il cestino interno resta un comando irreversibile separato.

Il meccanismo (coda, journal, lock) è in
[storage-and-identity.md](../architecture/storage-and-identity.md#cancellazione);
i byte del sidecar e di `.trash/` sono in
[on-disk-layout.md](../reference/on-disk-layout.md#cestino).

## Versioning

Il versioning conserva snapshot del contenuto. L'impostazione del vault
`versioning.enabled` (accesa di serie) decide se ne nascono di nuovi, e vale
dalla scrittura successiva, senza riaprire il vault. Spenta, la storia già
registrata resta leggibile e segue le note rinominate o cancellate, mentre
`version.restore` rifiuta finché non si riaccende: nessuno fotograferebbe il
contenuto che il ripristino sostituisce. `version.restore` cattura la revisione
del documento, quindi verifica che il riferimento alla versione esista e che il
blob sia leggibile e integro (dimensione e impronta FNV-1a). La scrittura
condizionata usa quella revisione come confronto e scambio (CAS). Per gli writer
cooperativi, una modifica intervenuta durante la lettura viene rifiutata come
conflitto. Per gli writer esterni il controllo è best-effort: una modifica già
osservabile al confronto produce lo stesso conflitto. Un riferimento o un blob
non valido e gli errori di lettura o confronto non modificano né il documento né
l'indice delle versioni. Le garanzie di un errore di scrittura dipendono dal
supporto: per i file regolari sostituibili il valore precedente resta intatto;
symlink, hardlink e filesystem senza conteggio dei nomi richiedono invece la
scrittura in-place descritta nel riferimento tecnico.

Il pannello cronologia mostra il testo di una versione oppure il suo confronto
riga per riga con la nota attuale. Il testo di una versione si può anche
copiare negli appunti, senza scrivere nel vault. Il confronto riassume le righe uguali
lontane dai cambiamenti e dichiara quante righe non mostra oltre il limite del
pannello. Se una delle due versioni non è testo, o la parte diversa è troppo
grande, il pannello lo dice invece di calcolarlo.

Quando riesce, il ripristino è una scrittura normale: fotografa prima il
contenuto sostituito e, se il contenuto cambia, crea una nuova versione; quando
esiste una versione precedente, il comando dichiara anche il ripristino inverso.

Le versioni si diradano a ogni nuova versione della nota: nelle ultime 24 ore
tutte, o una per `versioning.interval` (minuti, 0 di serie); fino a 7 giorni una
per ora, poi una al giorno fino a `versioning.retention` (giorni: 90 di serie, 0
per sempre); oltre, solo la più recente. `version.clear` svuota la cronologia
del vault anche a versioning spento, con conferma rafforzata e senza ritorno.

Un file oltre 64 MiB non ha versioni: il versioning non lo apre e non lo
copia, e una scrittura su di lui passa senza fotografia, come a versioning
spento. Per la stessa ragione il ripristino rifiuta di sostituire una nota
cresciuta oltre quel limite, e il pannello non la legge per confrontarla.


## Snapshot globale e backup

Lo snapshot globale offline comprende l'intero stato autorevole del vault:
documenti, allegati, file sconosciuti, `.trash/`, stato autorevole sotto
`.fub/` e storage autorevole dei plugin. La configurazione macchina è esclusa.
Le cache dichiarate ricostruibili vengono invalidate e ricostruite alla
riapertura, non copiate come se fossero autorità. In particolare,
`.fub/data/plugins/<id>/` è cache soltanto se contiene `.fub-cache-root`; senza
quel marker resta storage autorevole legacy.

Il meccanismo dello snapshot (manifest schema 1, preflight, staging, recovery
al crash e lock sibling) è in
[storage-and-identity.md](../architecture/storage-and-identity.md#snapshot-globale);
il formato su disco del contenitore è in
[on-disk-layout.md](../reference/on-disk-layout.md#snapshot-globale-offline).

Questo flusso è distinto da `fub.versioning`:
`version.restore` ripristina un solo documento con CAS per-file e non è una
transazione dell'intero vault. È distinto anche dal drill backup/restore offline
dell'issue [#7](https://github.com/Fubeo/Fub/issues/7), che conserva il proprio
fixture e manifesto indipendente. La feature `fub.backup` resta invece uno
snapshot namespaced delle sole note nello stesso vault. Gli snapshot prendono il
nome dal giorno, e un secondo backup nello stesso giorno sostituisce il
precedente soltanto a copia finita. La copia nuova si scrive nell'altra cartella
del giorno (`<data>.1/`), il manifest `snapshots.json` passa a lei e solo allora
la vecchia si cancella: un guasto a metà lascia intero lo snapshot precedente.
Accanto alla cartella di ogni snapshot sta il suo inventario
(`<data>.files.json`, o `<data>.1.files.json`): path, dimensione e impronta di
ogni nota copiata. Il ripristino lo confronta con le copie prima di creare
qualsiasi nota: una copia mancante, troncata o alterata ferma il ripristino con
un errore che la nomina, invece di riportare meno note dichiarando di esserci
riuscito. Gli snapshot scritti prima dell'inventario si controllano sul numero
di note che il manifest ricorda. Dopo ogni backup riuscito restano gli snapshot più recenti indicati da
`backup.keep` (10 di serie; 0 li tiene tutti). Un manifest scritto da una
versione più recente di Fub non si usa e non si riscrive; i campi che questa
versione non conosce tornano su disco come erano.
