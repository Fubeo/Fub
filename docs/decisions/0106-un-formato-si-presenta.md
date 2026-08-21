# 0106 — Un formato si presenta, e un elenco che nessuno riconta è un ricordo

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§15.3](../roadmap/15-il-disco.md#153-una-versione-di-schema-su-ogni-formato-persistito)
**Commit**: *(questo commit)*

---

## La domanda

Ogni file che Fub scrive dentro il vault dell'utente sopravvive alla versione di
Fub che l'ha scritto. La §15.3 chiede che ognuno porti il **suo** numero di
schema, e non come igiene: senza quel numero, la versione dopo dovrebbe
*indovinare* che un file senza campo viene da prima, e indovinare male sui file
di qualcun altro è l'unico errore di questo progetto che non si annulla.

La voce si dichiarava piccola, con due caselle: la disciplina esiste già ed è
applicata al caso difficile (uno store **autorevole**, il versioning), e ciò che
manca è chi scrive JSON nudo — il sidecar del cestino.

## Cosa la misura ha cambiato, prima di progettare

**La prima casella è vera e il buco è uno solo.** `TrashSidecar`
(`kernel/vault.rs`) era un record di un campo, serializzato e riletto senza che
niente dicesse di quale epoca fosse. Tutto il resto ce l'aveva.

**Ma i formati versionati non erano nove: erano dieci.** `DIAGNOSTICS_VERSION`
(`kernel/maintenance.rs:231`) è un decimo numero di schema, nato **con** il
campo `v` e con il commento «§15.3» già scritto accanto — cioè da qualcuno che
aveva letto questa voce e l'aveva applicata prima del suo turno, che è
esattamente ciò che la voce chiedeva. Non lo contava nessuno.

**E la tabella che li elenca era sbagliata in cinque righe su nove.** In
`docs/versionamento.md` ogni schema ha una riga con il sorgente e il numero di
riga in cui la costante è dichiarata. Misurate: `vaults.rs:39` era a 40,
`entries.rs:86` a 89, `settings.rs:51` a 82, `versioning.rs:147` a 253,
`journal.rs:112` a 156. Più della metà della tabella mandava a leggere un'altra
riga — e la riga sbagliata di un sorgente vivo non dà errore: dà una risposta.

Fuori dalla tabella, nello stesso documento, altri **due**: `ABI_VERSION` era
dato a `traits.rs:2912` ed è a 3650, `abi_compatible` a 3080 ed è a 4198. Sette
ancoraggi sbagliati in un documento solo, tutti riparabili con un `grep -n`, e
nessuno rosso da nessuna parte.

(Con una coda che vale la pena scrivere, perché è la prova che il verso opposto
esiste: riparandoli ne ho **rotto** uno che era giusto — il link che dice
`Cargo.toml:19` nomina `[workspace.package]`, e la riga 20 è quella di
`version`. `check-doc-links` l'ha preso subito, perché quello è un link con *un
nome accanto da cercare*. La differenza fra i sette che nessuno vedeva e questo
non è la difficoltà: è che il documento, lì, dice anche **cosa** si dovrebbe
trovare.)

**Il campo si chiama in tre modi diversi**: `v` (bozze, registro delle
mutazioni, bundle diagnostico), `version` (registro dei vault, organizzazione,
stato di vista, anagrafe, impostazioni), `schema_version` (indice di ricerca,
versioning). È un debito di forma, e si **tiene**: uniformarlo vorrebbe dire
riscrivere il nome di un campo dentro file che stanno già sui dischi delle
persone, cioè una migrazione vera per zero valore. Ciò che conta di un numero di
schema non è come si chiama il campo che lo porta — è che ci sia, e che qualcuno
lo confronti.

**Una previsione appesa a questa voce era già stata smentita, e va chiusa.** La
[0036](0036-le-impostazioni-e-i-tre-stati.md) prometteva che il §15.3 avrebbe
spostato `write_atomic`; la [0065](0065-una-scrittura-o-c-e-o-non-c-e.md) ha
misurato che quella previsione era sbagliata — *la casa vera è il supporto, non
questa voce, perché a chiederla non era un formato ma un posto* — e l'ha
spostata lei. La §15.3 si chiude senza quel lavoro perché quel lavoro è fatto, e
altrove.

## La decisione

**1. Il sidecar del cestino porta la sua versione.** `SCHEMA_VERSION` in
`kernel/vault.rs`, campo `v` nel record, l'undicesima riga nella tabella.

**2. E il rifiuto in avanti, qui, è muto — con una regola che lo dice.** Negli
altri formati una versione che non si conosce è un errore che si pronuncia: le
impostazioni non si leggono e non si riscrivono, il registro dei vault dice
«questa copia di Fub legge fino alla N». Qui no: un sidecar di una versione
ignota **vale come un sidecar che non c'è**, e la voce si ripristina in radice
col nome de-timbrato.

Non è pigrizia, ed è la sola parte di questa voce che sia una scelta e non una
constatazione. La differenza fra i due comportamenti non è l'importanza del
formato: è **cosa si perde tacendo**. Un file di impostazioni riscritto a metà
cancella ciò che l'utente aveva scritto, e allora il rumore è il minimo che gli
si deve. Il path d'origine di una voce cestinata, invece, ha già una risposta
prevista per la sua assenza — ogni voce cestinata da Obsidian il sidecar non ce
l'ha mai avuto — e la nota **torna comunque**. Dirlo costerebbe un campo su
`TrashEntry`, cioè sul contratto, per un caso che si dà solo aprendo il vault
con una copia di Fub più vecchia di quella che l'ha cestinato.

> **Il rifiuto in avanti si dice quando tacere farebbe perdere qualcosa, e si
> tace quando il degrado è già la risposta prevista del formato.**

Il giorno in cui il sidecar porterà qualcosa che il degrado non sa rifare, quel
campo sarà da scrivere: la regola dice anche quando cambiare idea.

**3. La tabella degli schemi diventa un elenco verificato.** Undici righe, e un
presidio che le legge.

## I presidi, e perché sono tre

`crates/fub-app/tests/schemi_su_disco.rs` legge la tabella di
`docs/versionamento.md` e i sorgenti che cita — con `include_str!`, come
`dieta_ipc.rs`, così se un file si sposta il test **non compila** — e li
confronta nei due versi: ogni riga della tabella deve puntare a una costante che
esiste, alla riga dichiarata e con il valore dichiarato; ogni costante trovata
nei sorgenti deve avere la sua riga. Il primo verso prende la riga vecchia e il
numero non aggiornato, il secondo prende il formato che c'è e non è documentato.

Restava la domanda che decide se un presidio è vero: *chi prende il formato che
nasce in un file che il test non include?* Nessuno dei due versi, per
costruzione — un file non incluso è un file di cui il test non sa niente. Perciò
`conteggi.mjs` ne guadagna il conto da fuori, e quello che c'era va corretto:

- **`schemi-su-disco` guardava il nome**, `const SCHEMA_VERSION`, ed è il motivo
  per cui `DIAGNOSTICS_VERSION` gli è passata accanto. Adesso guarda la
  **proprietà**: una costante intera che dichiara una versione, comunque si
  chiami. Chi l'aveva chiamata in un altro modo non aveva sbagliato niente — è
  il conto a essersi fatto eludere.
- **`schemi-in-tabella`** conta le righe del documento. I due numeri stanno
  nella stessa frase e devono essere lo stesso numero: se un formato nasce e si
  documenta, salgono insieme; se nasce e basta, divergono e `check-prosa`
  diventa rosso.

È la lezione della
[0105](0105-una-porta-si-nomina-e-un-presupposto-si-compila.md) su un terzo caso
— *il conto prende ciò che nessuno ha elencato, il test prende ciò che è
elencato male* — e stavolta il terzo attore, il compilatore, non può essere
chiamato in causa: si veda il buco qui in fondo.

## Il difetto peggiore stava fuori dalla voce, per la settima volta di fila

La voce parlava di un campo mancante in un record. Il difetto vero è che **il
conto che avrebbe dovuto accorgersene misurava la cosa sbagliata**, ed è la
famiglia della 0105 vista dal verso opposto: là un conto mancava, qui c'era, era
verde, e in CI passava. `docs/architecture/on-disk-layout.md` attribuiva già uno
schema al bundle diagnostico, `docs/versionamento.md` ne dichiarava nove: il
repo diceva dieci in un documento, nove in un altro e nove nel presidio, e i tre
non si guardavano.

Un conto che guarda un **nome** invece di una **proprietà** è un conto che si
può eludere senza volerlo. Non serve nascondere niente: basta chiamare una
costante in un altro modo, che è quello che si fa quando il nome generico è già
preso.

E la seconda metà del difetto è che quei numeri di riga sbagliati **erano
verificabili e nessuno li verificava**: `check-doc-links` li conta fra i link
«senza un nome accanto da cercare», perché il numero sta nel testo del link e
non nel frammento dell'URL. Il presidio nuovo li prende tutti e cinque, e li
prenderà la prossima volta che un `rustfmt` sposta una costante di tre righe.

## La verifica del rosso, e le tre cose che ha cambiato

I rami mordono tutti — togliendo il controllo della versione in lettura diventa
rosso `a_sidecar_from_a_newer_fub_is_worth_no_sidecar_at_all`, togliendo il
campo diventano rossi tutti e due i banchi nuovi, e togliendo **solo** il valore
alla scrittura non serve nemmeno un test: non compila. Ma la verifica ha
misurato altre tre cose, e nessuna era nel progetto.

**1. I due presidi nuovi erano un presidio solo travestito da due.** Il conto e
il test guardavano la stessa **sintassi** — `[pub ]const NOME_VERSION: u32` — e
la prova l'ha mostrato: `pub(crate) const PROVA_VERSION: u32 = 7`, che è la
visibilità più comune di questo codebase, passava **verde da entrambi**, e così
un `u16`. Due presidi che si eludono con lo stesso gesto non sono due. Adesso
tutti e due riconoscono qualunque visibilità e qualunque larghezza dell'intero,
e la zona cieca che resta è scritta qui sotto per quello che è, invece che per
come me l'ero immaginata.

**2. I due banchi da cui questa voce diceva di copiare non provano la cosa che
conta.** `the_fingerprints_live_in_the_plugin_storage` e
`a_bumped_schema_throws_the_fingerprints_away` (`features/search.rs`) sono la
coppia che la §15.3 indicava come **il modello**: uno prova che il numero
scritto è quello riletto, l'altro che un numero diverso butta l'indice.
Misurato: rinominando il campo `body` in `corpo` **senza toccare
`SCHEMA_VERSION`** la suite intera resta verde — 110 banchi su 110. Tutti e due
si esprimono *in termini di* `SCHEMA_VERSION` e nessuno dei due in termini della
**forma che quel numero versiona**: provano che il numero funziona, non che
salga quando deve.

È il difetto della voce nella sua forma più pura, e stava nel suo modello. Un
numero di schema che non sale quando lo schema cambia non è una protezione a
metà: è peggio dell'assenza, perché chi riapre un vault indicizzato ieri non
ottiene la ricostruzione ma un indice **incoerente**, e lo ottiene in silenzio.
Ora `IMPRONTA_DELLO_SCHEMA` scrive la forma — nome, tokenizer e memorizzazione
di ogni campo — accanto al numero che la versiona, e
`lo_schema_non_cambia_senza_che_il_numero_salga` la confronta: cambiare un campo
a numero fermo diventa rosso, e il messaggio dice cosa fare (alzare il numero,
aggiungere la riga di storia, riscrivere l'impronta).

**3. `dieta_ipc.rs`, il presidio da cui questa forma è copiata, ha la stessa
zona cieca — e lì costa di più.** Provato costruendo il caso: un secondo
`#[tauri::command]` in un altro file di `fub-app`, montato con un `.plugin()`
che porta il proprio `generate_handler!`, passa **verde** da tutti e otto i suoi
banchi ed è raggiungibile dal webview come `plugin:<nome>|<comando>`. Quel test
legge `src/lib.rs` con `include_str!`, quindi presidia *quel file*, non la
superficie IPC — e la superficie IPC è la porta che la shell ha e un plugin no.
La riparazione è nello stesso commit, ed è la stessa di qui perché il difetto è
lo stesso: `file-con-superficie-ipc` conta i file del crate in cui compare una
superficie, e deve essere **uno**.

> Un presidio che legge un file sa quel file. Ciò che sta in un altro file lo
> prende solo un conto che cammina la cartella.

È la terza volta in due giri che la verifica del rosso corregge il verbale
invece di confermarlo, e la seconda che trova un buco nel presidio da cui la
forma era stata **copiata** — la 0105 lo aveva scritto («provalo anche se
qualcuno l'ha già verificato»), e vale la pena ripeterlo perché stavolta il
presidio guasto era di un'altra famiglia.

## Cosa questa voce non prende, e va detto

**Un buco dichiarato, che non è una casella** — la forma della
[0064](0064-il-supporto-sta-sotto.md). Il conto e il test guardano la stessa
sintassi, e la verifica del rosso ha misurato quanto la cosa sia larga: **un
formato che dichiara la sua versione in un modo che non è una costante
nominata** — un letterale scritto dentro lo struct literal, un `fn default_v()`,
un newtype — non lo vede nessuno dei due, e nemmeno lo vede un formato che nasce
senza dichiararsi affatto: entrambi contano chi si è dichiarato. È il caso di
oggi — il sidecar del cestino è stato esattamente questo per due anni di repo —
e a prenderlo servirebbe il terzo attore, cioè un tipo che ogni scrittura
durevole attraversi e che pretenda una versione dal compilatore.

Quel tipo non c'è, e la ragione non è la fatica: **dalla stessa porta passano i
file di Fub e i file dell'utente**. `VaultStorage::write` scrive `settings.json`
e scrive il markdown di una nota, e il markdown di una nota un numero di schema
non ce l'ha e non deve averlo — è il motivo per cui si può smettere di usare
questo programma senza perdere niente. Un vincolo di compilazione su quella
porta chiederebbe una versione anche ai file che il progetto promette di
lasciare in pace. Separare le due strade è un progetto suo, e non è questa voce.

I buchi dichiarati diventano **tre** (la
[0067](0067-il-registro-di-cio-che-e-successo.md) ne voleva uno, la
[0104](0104-la-superficie-di-scrittura-si-presta.md) ne ha aperto il secondo).
Un buco dichiarato non entra in nessun totale e non è lavoro rimandato: è una
frase che impedisce a qualcuno di dedurre una copertura che non c'è — che è,
alla lettera, il difetto che questa voce ha appena riparato in `path_policy` di
un'altra seduta e in `conteggi.mjs` qui.

## Cosa questa voce non era, e va tolto da dove sta scritto

`docs/roadmap/strozzature.md` appendeva a questa voce la **corruption
detection**. Non è sua e non lo è mai stata: una versione di schema dice **quale
formato** sono quei byte, non **se** quei byte sono integri. Un file troncato a
metà porta la sua versione giusta in testa e resta troncato. La corruption
detection resta al §24.2, dove c'è già, e la riga lo dice adesso.

## Il ritaglio

**Nessuna riga di WIT.** Nel contratto congelato «versione di schema» compare
solo in prosa e `data-write` è `func(path, bytes)`: nessun tipo porta un numero.
Pretenderla **dai plugin** sarebbe stata la domanda grossa di questa voce, e la
risposta è no — un plugin scrive sotto `.fub/data/plugins/<id>/`, quello spazio
è suo, e imporgli un formato per un file che solo lui legge è una regola che non
protegge nessuno. La versione la deve avere chi la deve **rileggere dopo un
aggiornamento**, e per lo spazio di un plugin quel qualcuno è il plugin.
