# 0109 — Un conteggio che non si sa non è «un nome solo», e una suite che si svuota è verde

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§23.16](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#2316-su-windows-un-hardlink-si-stacca-in-silenzio) — **e con lei la seduta 23**
**Commit**: *(questo commit)*

---

## La domanda

La [0065](0065-una-scrittura-o-c-e-o-non-c-e.md) ha deciso due volte, e bene:
una scrittura del supporto è temp+rename+fsync, e dove l'inode ha **altri
titolari** — un symlink, un hardlink — si scrive sul posto, perché la rename
farebbe un danno peggiore di una scrittura non atomica. L'argomento con cui
sceglie il verso è quello giusto, ed è quello che questa voce eredita: *i due
danni non sono uguali — il file troncato vuole un crash* durante *la scrittura
ed è visibile, il nome staccato avviene a ogni salvataggio e non lo vede
nessuno.*

Il **rilevamento** però non era portabile. `condiviso()` contava `nlink` sotto
`#[cfg(unix)]` e su tutto il resto rispondeva `false` **costante**, perché
`std::fs::Metadata` non espone il conteggio su Windows. Il commento accanto lo
ammetteva per esteso — *«il caso resta scoperto, e questa riga è il posto dove
si vede»* — e questo è il punto: **un commento non prende nessuna decisione.**
Su Windows un file con più nomi prendeva la strada della rename, la rename ne
staccava uno, e il secondo nome restava fermo al contenuto vecchio senza errore
e senza avviso. Il «danno certo e muto» che la 0065 diceva di voler evitare, non
evitato lì.

## Le due premesse della voce, e la seconda è falsa

**Vera, e più stretta di come era scritta.** Il codice era un punto solo: una
funzione di quindici righe con un chiamante. La voce diceva «nessuna firma» e
aveva ragione — il WIT non si tocca in nessun punto.

**Falsa, e la sua falsità è il difetto peggiore del giro.** La voce afferma
*«nessun test di questo repo gira su Windows, quindi il caso non è solo
scoperto: è inosservabile»*. Misurato: `.github/workflows/ci.yml` ha
`matrix.os: [ubuntu-latest, windows-latest, macos-latest]` e lancia
`cargo test --workspace` su tutti e tre da prima che questa voce fosse scritta;
[platforms-ci.md](../appendix/platforms-ci.md) lo dichiara in tabella. La realtà
è **peggiore** della diagnosi, non migliore: il job Windows esiste, gira, ed è
passato verde per tutta la vita del progetto **proprio perché** i quattro
presidi che avrebbero interrogato il caso sono `#[cfg(unix)]` e là non venivano
nemmeno compilati.

> **Una suite che si svuota in silenzio è indistinguibile da una suite verde.**

È una specie di difetto che nessuno dei tre attori di questo repo prendeva. Il
compilatore no, perché il codice che non c'è compila benissimo. Il test no,
perché il test che se ne accorgerebbe è **precisamente quello che manca**. E il
conto nemmeno, perché nessuno l'aveva scritto.

## La decisione, in una riga: i valori sono quattro

`fn condiviso(&Metadata) -> bool` chiedeva a un tipo a due valori di portarne
tre, e il terzo — *non lo so* — viaggiava travestito da *«ne ha uno solo»*.
Adesso c'è [`NomiDelFile`](../../crates/fub-kernel/src/storage.rs), e i casi
sono nominati: `Nessuno` (il file non c'è), `Uno`, `PiuDiUno`, **`Ignoto`**. È
la stessa forma della [0094](0094-un-tetto-che-si-fa-sentire.md) — *i
significati erano tre e non due* — su una funzione che nessuno guardava perché
sembrava un predicato.

Con i casi distinti, la regola diventa una funzione **pura** — `come_scrivere` —
e la riga che vale la voce è una sola:

> **`Ignoto` sceglie come `PiuDiUno`.** Davanti a un dubbio si paga il danno che
> si vede.

Non è una scelta nuova: è l'argomento della 0065 preso sul serio fino in fondo.
Finché il dubbio era travestito da certezza, quella decisione non si poteva
nemmeno porre.

## Il verso conservativo, scartato avendolo detto

La voce chiedeva di valutare *«scrivere sul posto sempre su Windows»* e di
scartarlo **avendolo detto**. È scartato, e la ragione è misurata invece che
stimata: **il conteggio su Windows si può avere.** `GetFileInformationByHandle`
restituisce `nNumberOfLinks`, quindi non c'è nessuna scelta fra atomicità e
correttezza da imporre a tutta una piattaforma — c'è una syscall da chiamare. Il
verso conservativo resta, ma ridotto al suo campo legittimo: si applica a
`Ignoto`, cioè alla syscall fallita e alla piattaforma che la domanda non la sa
proprio porre, non a una piattaforma su tre.

## La supply chain, con un numero invece di una stima

La [0001](0001-supply-chain-e-sbom.md) rende la domanda «vale una dipendenza?»
una domanda vera, e la voce la poneva senza poterla misurare. Misurata:

- `windows-sys 0.61` era **già nell'albero**, tirato da tauri, e dipende dal
  solo `windows-link`, che c'è pure lui. Dichiararlo sotto
  `[target.'cfg(windows)'.dependencies]` di `fub-kernel` muove **una riga** di
  `Cargo.lock`: zero crate nuovi, un solo fornitore, due feature per una syscall
  sola;
- l'alternativa era una `extern "system"` scritta a mano con la propria
  `BY_HANDLE_FILE_INFORMATION`: nessuna dipendenza, e una struct di dodici campi
  il cui layout sbagliato **non fa rumore** — restituisce un numero, e il numero
  è quello sbagliato. È la specie di difetto che questa voce esiste per
  togliere, reintrodotta dal rimedio.

Fra un crate che non aggiunge niente e un `unsafe` che non si può rileggere, la
risposta è il crate. La riga sta nel `Cargo.toml` del kernel, non solo qui.

## Ciò che ha cambiato il progetto a metà strada

La misura proponeva di rendere iniettabile *«un `fn(&Metadata) -> bool`»*.
**Quella firma non può esprimere il caso Windows**, e lo si scopre solo
scrivendolo: su unix il conteggio è già dentro i metadati, su Windows sta dietro
un **handle** e il file va aperto — cioè serve il **path**, che un `&Metadata`
non porta. La funzione ne prende due, e la differenza fra le due piattaforme non
è quanto costa la risposta: è a *quale oggetto* si pone la domanda.

Da lì la seconda conseguenza, che è il pezzo di codice vero:
`FsStorage::write_con(path, bytes, rilevatore)` è il corpo di
`VaultStorage::write`, e **restituisce la strada che ha preso**. Non è un gancio
di prova travestito da API: la strada presa è l'unica cosa osservabile di questa
scelta che non richieda di guardare un inode, cioè l'unica che si possa
presidiare **dove gli inode non ci sono**. Finché il rilevamento stava dentro il
corpo, tutto il corpo cambiava con la piattaforma.

## I presidi, e sono di due attori diversi

*(Il terzo, il compilatore, ce l'ha già: `come_scrivere` fa un `match` su
`NomiDelFile`, quindi un quinto caso non compila finché qualcuno non decide cosa
farne.)*

**Il test.** Cinque banchi nuovi in `la_durabilita.rs`, e nessuno è
`#[cfg(unix)]`: la tabella intera di `come_scrivere` (otto ingressi, otto
risposte, nessun filesystem), il file con più nomi che non si sostituisce,
`Ignoto` che sceglie come `PiuDiUno`, il nome solo che compra l'atomicità, e il
file che non c'è a cui il conteggio non si chiede. I quattro presidi
`#[cfg(unix)]` di prima **restano dov'erano**: provano una cosa che questi non
provano — che il conteggio vero sia giusto — e la coppia è deliberata.

**Il conto.** `durabilita-su-ogni-piattaforma` conta quanti test di quel file
non stanno sotto `#[cfg(unix)]`, ed è il presidio del presidio: se qualcuno
riportasse questa metà sotto la piattaforma, il conto scenderebbe e
`check-prosa` diventerebbe rosso — mentre `cargo test` su Windows resterebbe
verde, perché è esattamente ciò che non sa vedere. È la disciplina della
[0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) applicata a un job
di CI che passava senza esercitare niente.

**E il compilatore, da qui.** In CI, sul job Linux,
`cargo check -p fub-kernel --all-targets --target x86_64-pc-windows-msvc`: sei
secondi che portano il ramo `#[cfg(windows)]` sotto il compilatore senza
aspettare il job Windows, che compila ma non ha né `clippy` né `fmt`. **Una FFI
che non compila è una FFI che non è stata scritta**, e ce ne si accorgerebbe
solo dalla piattaforma su cui nessuno sviluppa.

## La verifica del rosso, e ha corretto il commit due volte

Ogni ramo tolto uno alla volta, con la suite intera dopo ognuno. Le due
correzioni valgono più dei sei rossi che hanno confermato ciò che ci si
aspettava:

**Il presidio nuovo era cieco al gesto che esiste per prendere.** La prima forma
del conto cercava la stringa esatta `#[cfg(unix)]`. Costruito il caso: mettendo
`#[cfg(not(windows))]` davanti a tutti e undici i test, la suite di durabilità
su Windows si **svuota del tutto** e `check-prosa` dice zero problemi, perché il
conto legge ancora undici. Ciechi anche `#[cfg(target_family = "unix")]`,
`#[cfg( unix )]` e `#[cfg(all(unix))]`. Il conto ora guarda `#[cfg`, non
`#[cfg(unix)]`: **il presidio contro una suite che si svuota si stava fidando di
come qualcuno avrebbe scritto la riga che la svuota.** Resta scoperto un
`if cfg!(windows) { return; }` dentro il corpo — un attributo lo si legge, una
riga in mezzo a un corpo no — e sta scritto nel file dei banchi invece che qui,
perché è là che ci si inciampa.

**Una trappola che si arma con due mosse.** Il ramo «su un collegamento il
conteggio non si chiede» non rendeva rosso **niente**, e da solo è
un'ottimizzazione innocua. Ma insieme al corto-circuito di `come_scrivere` forma
la semplificazione che chiunque scriverebbe rileggendo — *un ramo solo, si
chiede sempre* — e su unix `nlink` di un symlink vale `1`, quindi `Uno`, quindi
`Sostituendo`: **il collegamento verrebbe rimpiazzato**, cioè il difetto che la
0065 esiste per non fare, reintrodotto da una pulizia. Adesso quel rosso c'è
(`su_un_collegamento_il_conteggio_non_si_chiede`), ed è `#[cfg(unix)]` per una
ragione di attrezzo — un symlink vuole un filesystem che li faccia — mentre il
ramo che presidia non è di unix affatto.

E un fatto che va detto per non lasciarlo dedurre: `NomiDelFile::Nessuno` e
`NomiDelFile::Uno` producono lo stesso `ComeScrivere`, quindi scambiarli non
rende rosso niente. Non è un buco: è che `Nessuno` non è una risposta diversa, è
**una domanda che non si pone** — e ciò che lo presidia non è l'esito ma il
fatto che il rilevatore non venga interrogato.

## Il difetto trovato dai presidi, fuori dalla voce

`abi_and_kernel_stay_agnostic` (`crates/fub-abi/tests/dependency_invariant.rs`)
è diventato rosso alla prima compilazione, e ha fatto la cosa giusta: una
dipendenza nuova del kernel si approva a mano. Vale la pena scrivere **perché**
l'ha vista, perché non era scontato — `windows-sys` è dichiarato sotto
`[target.'cfg(windows)'.dependencies]`, cioè non entra mai nell'albero della
macchina che esegue il test. Lo vede lo stesso perché guarda **il manifesto e
non la macchina**, ed è il verso giusto: una dipendenza che entra solo su una
piattaforma è precisamente quella che nessuno rilegge. Provato costruendo il
caso: una dipendenza dichiarata sotto `cfg(target_os = "redox")` la vede uguale,
sia contro l'allowlist sia contro le famiglie proibite. **Ciò che non vede è la
porta dev**: `notify` e `tokio` messi nei `[dev-dependencies]` del kernel
passano verdi tutte e quattro le sue reti. È una scelta scritta in quel file e
non una svista — resta segnalata e non riparata qui, perché nulla impedisce a
una famiglia proibita di entrare da lì e poi migrare.

## Cosa resta non provato, e si dichiara invece di lasciarlo aperto

È un **buco dichiarato** nella forma della
[0064](0064-il-supporto-sta-sotto.md), il quarto (0064,
[0104](0104-la-superficie-di-scrittura-si-presta.md),
[0106](0106-un-formato-si-presenta.md)): un buco dichiarato **non è una
casella** e non entra in nessun totale, perché non è lavoro da fare — è una cosa
che da qui non si può sapere.

Nessuno in questo progetto ha una macchina Windows, e la CI compila ed esegue ma
non ha hardlink da mettere in un vault. Quindi restano **non provati**, e nessun
verde di questo repo dice il contrario:

- che `nNumberOfLinks` risponda giusto su un handle aperto **come lo apre Fub**;
- che la `MoveFileEx` sotto `std::fs::rename` si comporti come qui si presume
  quando l'inode ha più nomi;
- ReFS, le share SMB e i percorsi UNC, dove il conteggio può essere corretto e
  irrilevante — o assente, e allora la risposta è `Ignoto`, che è appunto perché
  quel caso ha un nome.

Ciò che **è** provato, e prima non lo era: che la regola sia quella scritta, su
qualunque piattaforma la si compili. Il rilevamento è l'altra metà, e quella la
piattaforma se la tiene.

## Cosa non si è fatto

Nessun segnale all'utente. La tentazione c'era — un `HealthCheck` come quello
che la [0107](0107-il-caso-di-una-lettera.md) ha appena scritto — ma qui non c'è
niente da dire: quando il conteggio si sa, la scrittura fa la cosa giusta e non
c'è nessun difetto da mostrare; quando non si sa, la scrittura fa **anche** la
cosa giusta, e avvisare l'utente che una sua nota è stata salvata in modo non
atomico su un filesystem esotico sarebbe rumore su una scelta che è già la sua
protezione. Un segnale si scrive quando all'utente resta qualcosa da decidere.

E non si è scritto «è raro, si lascia». La
[§23.8](0107-il-caso-di-una-lettera.md) usava la stessa parola e la stessa
risposta, ed è la ragione per cui le due voci si citavano: **raro finché il
vault sta su una macchina sola e non lo tocca nessun altro strumento** — e gli
hardlink dentro un vault li mettono precisamente gli strumenti che questo
progetto promette di non ostacolare.
