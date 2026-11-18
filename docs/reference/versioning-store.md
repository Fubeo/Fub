# Store del versioning

> **Ambito:** i file che `fub.versioning` scrive dentro un vault e le regole
> di scrittura, lettura, potatura, rinomina e ripristino.
> **Fonti autorevoli:** `crates/fub-features/src/versioning/` (`store.rs`,
> `persist.rs`) e i suoi test.

Il quadro di tutti i file su disco è in
[on-disk-layout.md](on-disk-layout.md#versioning); il comportamento per chi
scrive è in [versioni](../product/vault-recupero-e-versioni.md#versioning).

## Layout e regole

`fub.versioning` conserva:

```text
.fub/plugins/fub.versioning/
├── versions.json
└── <impronta>/
    ├── meta.json
    └── <timestamp>.<estensione>
```

`versions.json` è un indice ricostruibile. `meta.json` e gli snapshot sono
autorevoli: eliminarli perde la memoria delle versioni. `meta.json` dice di
chi è la cartella (`doc_id`, `deleted_at`) e registra dimensione e impronta di
ogni versione (`versions`), scritte quando la versione nasce: la ricostruzione
dell'indice le riprende da lì, quindi un blob alterato dopo la scrittura resta
rifiutato in lettura. Una cartella scritta prima di questo campo si ricostruisce
ancora, ricalcolando le impronte dai byte attuali. Per non lasciarla così
l'indice porta il campo facoltativo `registered`: assente (o `false`) in un
indice scritto prima, e alla prima apertura il versioning copia nel `meta.json`
di ogni cartella le impronte che l'indice ricorda — quelle della scrittura —
poi riscrive l'indice con `registered: true`. Si fa una volta sola e solo da un
indice che c'è: un indice ricostruito dai byte non registra le impronte che ha
appena ricalcolato. Il primo salvataggio le registra comunque. Ogni nuova versione
pota le altre per fasce: sotto le 24 ore tutte, o una per `versioning.interval`
minuti; una per ora fino a 7 giorni, una per giorno fino a `versioning.retention`
giorni (90 di serie, 0 nessun limite). Oltre resta solo la più recente. Le due
impostazioni non sono `program_writable`: abbassarle cancella versioni. Ogni `VersionRef`
nell'indice registra la dimensione in byte e l'impronta FNV-1a del contenuto.
Gli snapshot conservano i byte originali, anche per allegati binari, senza
convertire BOM o terminatori di riga. Nessuno snapshot supera 64 MiB
(`MAX_VERSION_BYTES`): la dimensione di un file si legge dall'anagrafe prima di
aprirlo, e oltre il tetto il file non si fotografa. Il nome riprende l'estensione del file;
se manca, contiene soltanto il timestamp.

Una versione può portare il campo facoltativo `note` (testo, al più 200
caratteri, senza caratteri di controllo), nel `VersionRef` dell'indice e nella
sua voce in `versions` del `meta.json`. C'è solo sui testi conservati a mano
con `version.keep` (`doc`, `text`, `note`, tutti obbligatori: lo usa «Usa la
versione su disco» per non perdere il testo scartato), mai sulle fotografie
del disco. È un'aggiunta compatibile: lo schema resta 1, il campo assente si
legge come nessuna nota e non si scrive, quindi una cronologia scritta prima
si legge e si riscrive byte per byte uguale. L'autorità è il `meta.json`, come
per dimensione e impronta: la ricostruzione dell'indice riprende la nota da
lì. Una versione di Fub precedente ignora il campo e lo perde alla prima
riscrittura del `meta.json`, ma la versione resta. Un testo conservato:

- non si pota mai e non occupa posto nelle fasce;
- non deduplica e non è deduplicato: la fotografia successiva si confronta con
  l'ultima versione senza nota, perché il disco non ha mai avuto quei byte;
- non è «l'ultima versione = il disco»: «Versione attuale» nel pannello, la
  preimmagine dichiarata dal ripristino inverso e il confronto delle
  variazioni guardano l'ultima versione senza nota.

`version.keep` scrive il blob, poi il `meta.json`, poi l'indice. Se il
`meta.json` non si scrive il blob si toglie e il comando restituisce l'errore:
non resta niente che una ricostruzione scambierebbe per una fotografia. Se
fallisce solo l'indice la versione c'è già, e la ricostruzione la ritrova con
la sua nota. Rispetta il tetto di 64 MiB (oltre rifiuta con un errore) e non
tocca il documento.

La lettura verifica che il `VersionRef` esista, che il blob sia leggibile e che
dimensione e impronta corrispondano ai byte dello snapshot. L'anteprima mostra
il testo quando è UTF-8, altrimenti indica la dimensione del contenuto binario.
`version.restore` usa sempre i byte originali, senza decodifica testuale.
Una verifica fallita non sovrascrive il documento corrente.

Una rinomina porta la storia sotto il nuovo path. Se il nuovo path aveva già
una storia, le due si uniscono in ordine di tempo: due snapshot diversi dello
stesso istante restano entrambi, e quello della storia preesistente slitta di
un millisecondo. Le copie non scrivono mai su un blob che l'indice in vigore
nomina ancora: se l'unione ci atterrerebbe, la storia unita va in una cartella
nuova e vuota. L'indice nuovo pubblica l'unione; se una copia fallisce, il
rename fallisce, le copie già scritte si tolgono e la storia precedente resta
leggibile.

Cestinare una nota porta la sua storia sotto l'identità che la voce ha nel
cestino (`doc_id` è l'id della voce, con `deleted_at`), perché il path torna
libero e chi lo riprende è un'altra nota: il ripristino la riunisce al path
d'arrivo, come una rinomina. Se la voce non si riconosce (una cancellazione che
il cestino non ha visto, un cestino che non si elenca) la storia resta sotto il
path col suo `deleted_at`, come prima.

`version.clear` svuota lo store di tutto il vault in quest'ordine: toglie
l'indice, toglie il `meta.json` di ogni cartella, riscrive l'indice con ciò che
resta e solo allora cancella i blob delle cartelle liberate, orfani compresi.
Un'interruzione lascia al più una cronologia svuotata a metà, che la
ricostruzione ritrova senza mescolare storie.

Se l'indice manca o non è leggibile, lo store lo ricostruisce dagli snapshot e
prova a ripubblicarlo. Un errore di scrittura del solo indice genera un avviso:
view e comandi possono ancora ricostruire e leggere la cronologia dai dati
autorevoli.

`version.restore` cattura la revisione del documento prima di leggere lo
snapshot e usa quella revisione per la scrittura condizionata. Il confronto e
scambio (CAS) impedisce agli writer cooperativi di sovrascrivere una modifica
intervenuta durante la lettura. Per gli writer esterni è best-effort: una
modifica già osservabile al confronto produce un conflitto. Il conflitto e gli
errori di lettura o confronto non sovrascrivono il documento corrente; una
preimmagine già fotografata resta conservata anche se il commit fallisce.
Sui file regolari sostituibili anche un errore di scrittura preserva i byte precedenti;
per symlink, hardlink o conteggio dei nomi non disponibile, la scrittura
in-place preserva l'identità ma un errore può lasciare i byte modificati.
Quando riesce, il ripristino è una scrittura normale: fotografa prima il
contenuto sostituito e, se il contenuto cambia, crea una nuova versione; quando
esiste una versione precedente, il comando dichiara anche il ripristino inverso.
