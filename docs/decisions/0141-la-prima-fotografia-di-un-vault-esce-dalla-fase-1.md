# 0141 — La prima fotografia di un vault esce dalla fase 1

**Stato**: accolta
**Data**: 2026-08-09
**Chiude**: §25.3
**Commit**: *(questo commit)*

---

> **Questo verbale `0141` non è il difetto `0141`** (`docs/todo.md`, le tre
> risposte incompatibili a «sta dentro questa cartella?» — `query::within_folder`,
> `rules::events::folder_contains`, `transfer::in_folder`, in `fub-abi` ·
> `transfer.rs`). Condividono il numero e basta: crate diverso, file diverso,
> domanda diversa. La sovrapposizione è dichiarata a `docs/todo.md:569-573` —
> verbali e difetti occupano lo stesso spazio di numeri di proposito, e «chi ne
> cita uno dice quale delle due». È più mite della collisione del `0140`, che
> condivideva anche crate e file, ma si dice lo stesso: chi il numero lo **crea**
> è il primo citante, ed è l'unico momento in cui qualcuno ci pensa.

La §25.3 chiedeva se la prima fotografia di un vault mai visto debba stare dentro
l'apertura sincrona — nessuna nota modificabile prima di avere il suo primo
snapshot — o possa essere differita, accettando una finestra in cui una modifica
cancella per sempre lo stato in cui l'utente ha trovato quella nota.

## La risposta

**La forma (a): la finestra resta zero, e la sola cosa che si sposta è *dove*
sta la chiamata, non *quando*.** La passata esce dalla fase 1 e la chiama il
**runner**, una volta per apertura, **prima della prima fetta**.

Il *quando* non cambia di un'unità osservabile: la fotografia continua a
precedere qualunque scrittura dell'utente, perché precede la prima fetta e la
shell non ha ancora un documento aperto. Cambia il *chi*: non più un ramo
`Event::VaultOpened` dentro `VersioningHandler`, che ci finiva **per caso**
— l'evento usciva di lì —, ma una chiusura che il montaggio consegna alla
sessione e che `avanza_apertura` consuma. Il ramo `VaultOpened` e la sua maschera
si tolgono: `EventMask` non nomina più `VaultOpened`, e `first_snapshot_of_the_vault`
diventa `pub`, chiamabile dal wiring con la stessa firma di un `Plugin::activate`.

L'argomento è quello della voce, ed è un numero: riparato l'O(N²) restano ~167 ms
su 5000 note, il prezzo di una finestra di lunghezza **zero** su un dato che,
perso, non si ricostruisce da niente. Differire per risparmiare 167 ms è
letteralmente il baratto che la
[0124](0124-una-fetta-dell-apertura-e-un-piano-anche-lei.md) ha già rifiutato.
Ma il posto in cui quei millisecondi stavano era sbagliato per la
[0070](0070-un-vault-si-apre-in-due-tempi.md): la fase 1 è quella che dice
**quali** documenti esistono, la passata legge il **contenuto** di ogni nota e
sta per definizione dalla parte del *cosa dicono*. Il criterio esisteva, la
passata lo violava, e nessuno l'aveva notato perché la passata arrivava da un
evento invece che da una chiamata.

**La garanzia una-sola-volta è il tipo, non un flag.** `InCorso` porta un
`Option<PrimaFotografia>` e `avanza_apertura` lo consuma con `take()`: il secondo
chiamante ha `None` **per costruzione**, e non c'è nessuno stato da ricordarsi di
resettare. È la stessa risposta che la
[0139](0139-un-guasto-dell-avvio-si-tira-non-si-spinge.md) ha dato al suo avviso
di avvio, e per lo stesso motivo.

Un errore della passata non ferma il pool: si logga e si va avanti, perché una
passata interrotta **è già gratis da riprendere** (`Passata::SoloNuovi` salta chi
ha già versioni) e far cadere l'apertura per una nota non salvata sarebbe uno
scambio peggiore. È la riga che il banco
`una_passata_interrotta_non_perde_niente_perche_l_indice_si_ricostruisce`
teneva già ferma.

## La premessa caduta: la forma approvata è morta sul banco

La forma che il piano portava scritta **non era questa**. Era un `JobHost`
per-capacità: la passata avrebbe girato con un host intestato a `VERSIONING_ID`
preso *senza* il prestito esclusivo del workspace, così da non trattenere il lock
per la durata di una passata lunga. Sembrava giusta per una ragione buona, ed è
la ragione per cui va scritta: è la stessa mossa della
[0097](0097-un-recinto-che-vale-anche-quando-nessuno-guarda.md) — *chiediti sempre
se il lock che serve sia più debole* — e lì il prestito condiviso non era solo più
corto, era **sufficiente**.

Qui **chiude un ciclo di lock**. La passata tiene il mutex interno dello store
attraverso le proprie scritture; le scritture normali tengono il workspace
attraverso le chiamate alla feature. Prendere il workspace in condiviso mentre lo
store è preso significa chiudere il cerchio nell'altro verso, e sotto un `RwLock`
**un lettore nuovo si ferma dietro a chi aspetta di scrivere**. Il banco
`crates/fub-host/tests/concorrenza.rs` è rimasto appeso **oltre 60 secondi**: non
è andato in rosso, è andato in deadlock — che è precisamente il modo in cui un
presidio scritto coi thread smette di essere un presidio.

**La prova ha ridotto la forma.** La passata gira sotto l'**esclusivo**, come
girava in fase 1: dell'idea originale resta il taglio — fuori dalla fase 1, dentro
il racconto del job — e cade l'ambizione sul lock, che non era richiesta da
nessuna riga della voce. È il caso di scuola della distinzione fra un ostacolo di
attrezzo e uno di progetto: qui l'ostacolo ha detto qualcosa di vero sul disegno,
e la risposta giusta non era aggirarlo.

**Seconda premessa caduta, di fatto:** `first_snapshot_of_the_vault` sta in
**`fub-features`** (`versioning.rs`), non in `fub-kernel` come era stato scritto.
Non cambia la decisione — cambia dove si va a guardare, ed è il genere di riga
che fa perdere un giro a chi la crede.

## Che cosa si è scartato, e perché

- **(b) La passata diventa una fase a fette.** Annullabile e visibile, ma apre una
  finestra lunga quanto l'indicizzazione — 1,7 s su 5000 note, secondi su disco
  freddo — in cui chi comincia subito a scrivere **perde per sempre** lo stato in
  cui ha trovato la nota. È il comportamento che la 0124 chiama «non una patologia
  ma il comportamento normale», ed è esattamente ciò che questa funzione esiste
  per impedire.
- **(c) In sottofondo dopo l'apertura, con «non ancora» nella cronologia.** Come
  la (b), più una superficie nuova da disegnare e tradurre e uno stato in più che
  ogni lettore della cronologia deve gestire, in cambio di niente che la (b) non
  dia già.
- **(d) Lo snapshot viaggia con la fetta.** Una lettura invece di due, e la
  passata erediterebbe gratis annullamento e progresso — ma `ParsedBatch` porta
  `models`, non sorgenti: servirebbe un evento per documento che porti il sorgente,
  cioè un campo nel WIT, e un byte-per-byte dei documenti dentro la coda degli
  eventi che la [0034](0034-il-freno-e-il-raggruppamento.md) ha già dichiarato a
  budget. È l'unica delle quattro **non reversibile**, e non chiude comunque la
  finestra: la accorcia.

## Che cosa resta scoperto

**Il residuo O(N²) del versioning è vero, misurato, e non è una riga di difetto.**
Ogni scrittura dello store costruisce il proprio piano con
`let mut piano = inner.docs.clone()` — quattro siti: due in `VersionStore::snapshot`
(`versioning.rs:507`, `:528`, ed è quello che la passata paga una volta per nota),
i gemelli in `rename` (`:582`) e `tombstone` (`:607`). La copia **è** la forma
`Durevole`: `Inner::applica` sostituisce la mappa solo se il disco ha accettato,
e riscriverla come un delta con rollback significa abbandonare quella forma.

Non prende una riga in tabella perché la sua riparazione dipende da una decisione
già aperta — il difetto `0113`, cioè la domanda se la forma piano/installazione
valga anche qui e cosa faccia chi installa un piano invecchiato — e
`docs/todo.md:484-486` scrive che «un difetto la cui riparazione dipende da una
decisione non è un difetto». Sta qui come fatto misurato in attesa di decisione.

E resta la trappola, per il giorno in cui si farà: **il piano invecchiato si prova
senza thread, nel kernel, e con `try_read` non `read`**. Questo verbale ne è la
dimostrazione dal lato opposto.

## Chi se ne accorge se regredisce

Due banchi, rossi provati nei due versi, e sono **due** perché tengono ferme due
metà diverse dello stesso taglio.

- `crates/fub-host/tests/headless.rs` ·
  `la_prima_fotografia_precede_la_prima_fetta` — cinquanta note, e il testimone è
  il **primo `JobProgress`**: quando la barra si annuncia, ogni nota ha già la sua
  prima versione. Rosso se la chiamata manca o **tarda**: finisse accanto a
  `collect_doc_data`, al primo `JobProgress` le versioni sarebbero zero. È la metà
  «non più tardi della prima fetta».
- `crates/fub-features/tests/la_prima_fotografia_non_riscrive_l_indice.rs` ·
  `l_evento_vaultopened_non_fotografa_piu` — l'evento da solo non produce niente.
  Rosso se qualcuno rimette il ramo nell'handler. È la metà «non più dentro la
  fase 1», e senza di lui il taglio sarebbe reversibile in silenzio: un ramo
  rimesso avrebbe fotografato due volte e nessun banco l'avrebbe visto, perché
  fotografare due volte è idempotente.

Il primo banco ha anche corretto una riga di `versioning_is_mounted_and_its_two_halves_are_composed`,
che leggeva le versioni subito dopo `Host::open` credendo che la fotografia fosse
già dentro: adesso aspetta il job. È il segnale che il taglio ha morso — un banco
che continuasse a passare senza toccarlo avrebbe voluto dire che la fotografia non
si era mossa.
