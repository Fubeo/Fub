# 0065 — Una scrittura o c'è o non c'è, e i due casi in cui il file non è nostro

|  |  |
|---|---|
| **Decisa** | 2026-08-01 |
| **Origine** | `todo.md` §15.2 (seduta 15) — **la metà della durabilità**, e la casella residua della [0064](0064-il-supporto-sta-sotto.md) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/15-il-disco.md) · [il verbale che l'ha preparata](0064-il-supporto-sta-sotto.md) · [la mappa del disco](../architecture/on-disk-layout.md)

---

La [0064](0064-il-supporto-sta-sotto.md) ha fatto il posto e ha lasciato scritto
cosa ci sarebbe sceso dentro: «l'atomicità è il §15.2, e scenderà *dentro* questa
funzione». Questo verbale la fa scendere, e paga il prezzo che quella aveva
nominato senza pagare.

Il prezzo è questo: `VaultStorage::write` era una `std::fs::write`, cioè una
`open(O_TRUNC)` seguita da una `write`. Fra le due c'è un istante in cui il file
dell'utente è **lungo zero**, e ogni istante successivo è un file lungo un pezzo.
Un crash lì dentro — la batteria che finisce, l'OOM killer, un `kill -9` — non
lascia la nota di prima: lascia mezza nota. La via d'uscita è nota da
cinquant'anni e si chiama temp+rename, e ha un costo che su una nota si vede:
**cambia l'inode a ogni salvataggio**.

## La decisione

**Una scrittura del supporto o c'è o non c'è**, e la promessa sta nella firma di
[`VaultStorage::write`](../../crates/fub-kernel/src/storage.rs): chi rilegge
trova questi byte o quelli di prima, mai una metà dei due. `FsStorage` la mantiene
con temporaneo accanto → `sync_all` → `rename` → `fsync` della cartella.

**Non ci sono due scritture fra cui scegliere.** Era la forma ovvia — un `write` e
un `write_atomic`, e ogni chiamante sceglie — ed è stata scartata per la ragione
con cui la 0064 ha messo `create_dir_all` dentro `write` invece che nei cinque
chiamanti: una riga ripetuta a ogni chiamante è una riga che il sesto chiamante
dimentica. Qui è peggio, perché non è una cartella che manca: è la nota
dell'utente, e chi la dimentica non se ne accorge mai — il difetto ha bisogno di
un crash per manifestarsi, e un crash arriva sulla macchina di qualcun altro.

## Le decisioni prese, da NON ridiscutere senza motivo

### I due casi in cui il file non è nostro, e la rename si ferma

Il prezzo dell'atomicità non è «un inode che cambia»: è **un inode che cambia
quando quell'inode ha altri titolari**. Sono due situazioni, e in tutte e due la
`write` scrive **sul posto** (`create` + `sync_all`) rinunciando all'atomicità:

- il path **è un symlink**. La rename sostituirebbe il collegamento con un file
  vero, e da quel salvataggio in poi la nota che sta dall'altra parte non
  riceverebbe più niente. È il modo in cui una nota tenuta fuori dal vault e
  collegata dentro smette di essere la stessa nota, in silenzio e al primo
  salvataggio;
- il file ha **più di un nome** (hardlink, `nlink > 1`). La rename ne staccherebbe
  uno solo, e l'altro resterebbe fermo al contenuto di prima.

La scelta ha un verso, e va detto quale: si perde l'atomicità dove il file è
condiviso, non la si perde ovunque per prudenza. I due danni non hanno la stessa
forma. Il troncamento richiede un crash **durante** la scrittura, capita di rado,
e quando capita si vede — il file è visibilmente mezzo. Lo scollegamento di un
symlink avviene **a ogni salvataggio**, non richiede niente, e non lo vede
nessuno finché qualcuno non va a cercare la nota dall'altra parte e la trova
vecchia di tre mesi. Fra un guasto raro e rumoroso e uno certo e muto, si sceglie
il primo — è lo stesso criterio della [seduta 20](../roadmap/20-quando-qualcosa-va-storto.md).

Il costo è una `symlink_metadata` per scrittura, cioè la stessa syscall che una
`std::fs::write` fa comunque aprendo il file. Su Windows il ramo dell'hardlink
resta scoperto — `std::fs::Metadata` non porta `nlink`, e chiederlo vorrebbe dire
una chiamata di sistema a mano per ogni scrittura — e questa riga è il posto in
cui quel buco si vede, invece di essere un `else` implicito.

### Il temporaneo è nascosto, e non è cosmesi

Un temporaneo chiamato `Nota.tmp1234-5` accanto a `Nota.md` esiste dentro il
vault per una frazione di secondo, e in quella frazione **è un documento nuovo**
per chiunque stia guardando: il nostro rilevatore, l'indice, e Obsidian aperto
sulla stessa cartella. Il nome comincia quindi per punto — `.Nota.md.tmp1234-5` —
perché la regola che rende invisibile un nome così **c'è già** ed è
`vault::is_ignored_name`, la stessa che salta `.obsidian` e `.trash`.

È l'incastro fra due moduli distanti, ed è per questo che ha un presidio suo
(`il_temporaneo_di_una_scrittura_non_e_un_documento`): chi un giorno cambierà il
nome del temporaneo non ha nessuna ragione di sapere che dall'altra parte del
kernel c'era una regola da rispettare.

Sta **accanto** al file e non in una cartella di temporanei, perché una rename
attraverso due filesystem non è una rename; e ha un nome **unico** per processo e
per scrittura, perché con un `.tmp` fisso due scritture contemporanee si
scrivono addosso sul temporaneo — e ciò che la rename fa atterrare è metà
dell'una e metà dell'altra, cioè il file troncato che l'atomicità esiste per non
produrre, prodotto dalla sua implementazione.

### I permessi seguono il file, non la umask di chi salva

La cosa che la voce non prevedeva. Un file nuovo nasce con i permessi che la
umask del processo gli dà; un file **sostituito** per rename è un file nuovo.
Senza una riga che glieli copi, il primo salvataggio di una nota che l'utente
aveva messo a `600` la riporta a `644` — cioè un cambio di permessi che nessuno
ha chiesto, fatto da un'operazione che si chiama «salva». È lo stesso genere di
cambiamento in silenzio che la 0064 ha trovato con `file_type()` contro
`metadata()`: **un'astrazione che uniforma sceglie per tutti**, e chi la scrive
vede l'uniformità e non la scelta.

La copia è best-effort: un filesystem che di permessi non sa niente — FAT su una
chiavetta, che è il caso 2.3 di FEATURES — non è una ragione per non salvare la
nota.

### `write_atomic` non si riscrive: cambia casa e cambia clienti

`settings::write_atomic` esisteva dalla [0036](0036-le-impostazioni-e-i-tre-stati.md)
e faceva già temp+`sync_all`+rename+fsync della cartella. Il suo commento diceva
dove sarebbe finita («la casa vera è il §15.3») e quella previsione era
**sbagliata**: il §15.3 è la versione di schema, che di questa funzione avrebbe
spostato la casa senza toccarne la semantica. La casa vera è il supporto, e la
ragione è che a chiederla non era un formato ma un **posto**: i byte di un vault.

Quindi l'implementazione adesso è **una** e sta in `FsStorage::write`, e
`write_atomic` è il guscio che la offre a chi un supporto non ce l'ha — i tre
file della **macchina** (`settings.json`, `vaults.json`, `view-state.json`), che
stanno nella cartella di configurazione dell'utente, cioè fuori da ogni vault. Non
è una svista che non passino dal trait: il giorno in cui un vault vive su OPFS o
dentro una share cifrata, la configurazione della macchina resta dov'è.

### Le tre righe di `.fub/` salgono adesso, e adesso è il momento giusto

È la casella residua che la 0064 ha aperto **già indirizzata a questa voce**.
`workspace.json` (`organization.rs`), `settings.json` del vault (`settings.rs`) ed
`entries.json` (`entries.rs`) scrivevano con `write_atomic`, cioè avevano già la
proprietà che il supporto non prometteva: portarle sopra il trait allora avrebbe
voluto dire **toglierla**. Adesso il trait la promette, e salgono senza perdere
niente — che è la differenza fra fare una cosa e farla al momento giusto.

Con loro sale un fatto che nessuno aveva scritto: dentro un workspace il supporto
è **uno**. Il `Vault` ne aveva uno suo e i tre store non ne avevano nessuno; ora
`Workspace::with_machine_settings` ne costruisce uno e lo presta a tutti e
quattro. Due supporti sulla stessa cartella sarebbero due idee di cosa c'è
dentro, e il giorno in cui uno dei due cifra, un dato su due resta in chiaro —
che è esattamente la ragione per cui il §15.1 esisteva.

### La *lost update* resta aperta, e non per stanchezza

La seconda casella della voce — due processi che ricompongono lo stesso file
della macchina dalla propria copia in memoria, e il secondo cancella le chiavi
del primo — **non** si chiude qui, e la distinzione è quella che il doc comment
di `write_atomic` porta scritta dalla 0036: questa è l'atomicità di *un file*,
non di un *aggiornamento*. Nessuna quantità di fsync la risolve; la risolve un
lock, cioè una primitiva diversa.

E ha un motivo tecnico che vale la pena mettere a verbale invece di riscoprirlo:
il lock di file portabile è `std::fs::File::lock`, **stabilizzato in Rust 1.89**,
e l'MSRV di questo workspace è **1.88** (`Cargo.toml`). Chiuderla oggi vuol dire
o alzare l'MSRV o prendere una dipendenza, e nessuna delle due è una decisione da
prendere di straforo dentro un verbale sulla durabilità. È lavoro che *decide
qualcosa*, quindi non è una casella residua: è la voce che resta aperta.

## Cosa NON è cambiato, e perché è la parte da guardare

**Nessun presidio esistente è stato indebolito**, e i due che si sono toccati si
sono toccati in aggiunta:

- `il_supporto.rs` porta in testa da sempre che i test di durabilità **non**
  stanno lì, perché un supporto in memoria non ha niente a cui sopravvivere. Quella
  riga è rimasta **identica** il giorno in cui la durabilità è arrivata, ed è il
  punto: la ragione per cui i test non stanno lì non è cambiata insieme a loro. Si
  è aggiunta una frase che dice dove sono andati;
- `write_atomicity` (`fub-kernel/tests/`) non è stato toccato affatto, ed è il
  test che il nome invitava a riusare. Presidia l'ordine parse→scrittura, cioè
  un'altra cosa: chiamarlo a testimone della durabilità avrebbe fatto dire a un
  presidio verde una cosa che non verifica.

I test nuovi stanno in `crates/fub-kernel/tests/la_durabilita.rs`, **su
`FsStorage` soltanto**, e il file dichiara in testa il proprio limite: che dopo un
crash vero il file sia intero non lo può presidiare nessuno senza un crash vero.
Si presidia ogni passo osservabile che compone la proprietà — il temporaneo che
non resta indietro, l'inode che cambia solo quando è lecito, il collegamento che
riceve i byte invece di essere rimpiazzato, i due nomi che restano due, i permessi
che sopravvivono — e la riga non osservabile (`sync_all`) resta letta in review.
Un limite scritto vale più di una copertura implicita: è la sesta specie del
[§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md).

## Cosa resta scoperto

**La §15.2 resta aperta con quattro caselle**, e sono quattro cose diverse dalla
scrittura: la *lost update* fra processi (sopra), il buffer di crash dell'editor,
il journal delle mutazioni, i comandi di manutenzione. Le ultime tre non sono
durabilità della scrittura: sono **recovery**, cioè cosa si fa dopo. Il verbale
che le chiuderà cita questo, come la [0032](0032-il-runner-dei-job.md) cita la
[0031](0031-chi-possiede-i-bundle.md).

**Il journal non è nato**, quindi l'avvertenza della
[§15.3](../roadmap/15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito)
— la versione di schema si anticipa a ogni formato che nasce — non aveva niente
da anticipare in questo turno. È scritta qui perché il turno che scriverà il
journal la trovi: quel formato nasce col campo, o la versione dopo dovrà
indovinare che un file senza campo viene da prima.

**Il buco dichiarato della 0064 non si è chiuso e non si chiude qui.**
`Workspace::plugin_data_dir` consegna a tantivy una vera cartella del filesystem:
quelle scritture non passano da `VaultStorage::write` e quindi non hanno né la
cifratura né questa atomicità. Per l'indice di ricerca è senza conseguenze — è un
derivato, e un derivato rotto si rifà — ma vale la pena che sia scritto due volte
invece di zero.
