# 0130 — Ogni tipo del contratto si vede dalla radice, e a dirlo non è chi si ricorda

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: la [§24.1](../roadmap/24-tre-firme-che-il-freeze-rende-definitive.md)
— *«sette tipi del contratto non si vedono dalla radice del crate»*. I tipi
erano **sessantuno**, non sette, e la premessa che li rendeva urgenti era falsa
**Commit**: *(questo commit)*

---

## La domanda, com'era posta

[`crates/fub-abi/src/lib.rs`](../../crates/fub-abi/src/lib.rs) dichiarava di
riesportare «i tipi più usati, per import ergonomici». La voce elencava sette
tipi di `traits.rs` che non c'erano — `DocPosition`, `ResolvedRef`, `JobSpec`,
`JobId`, `JobProgress`, `JobStatus`, `PluginPermissions` — e poneva bene la
domanda che conta: **non quali sette mancano, ma chi decide l'elenco.**

## La misura, prima di decidere

**«Sette» è falso, e il numero non era sbagliato di poco.** Contati leggendo
tutti i sorgenti invece di una schermata di `traits.rs`, i tipi `pub` del
contratto sono **duecentoquarantasei**, e quelli invisibili dalla radice erano
**sessantuno**: ventuno in `traits.rs` (i sette elencati più `EntryKind`,
`VaultEntry`, `VaultFolder`, `FolderScope`, `ViewInterests`, `Excerpts`,
`DraftInfo`, `VaultStatus`, `IndexingState`, `TagCount`, `TimerSpec`,
`TimerSchedule`, `WallClock`, `CivilTime`), **quattordici in `model.rs`** —
`PropertyValue`, `PropertyScalar`, `PropertyDate`, `PropertyTime`, `DateOrder`,
`DateFormats`, `ListItem`, `TaskMarker`, `TableRow`, `TableCell`, `ColumnAlign`,
`Anchor`, `ParsedWikilink`, `HeadingSlugs` —, dodici in `arena.rs`, sei in
`rules/`, e poi `Undo`/`UndoStep`, `DocChange`/`DocChanges`, `DocumentFormat`,
`TextTolerance`, `Organization`, `SchemaVersion`.

Sembrava sette perché la voce nasceva da un audit che aveva guardato **un file**,
e `traits.rs` è il file che si guarda quando si pensa «il contratto». Ma
`model.rs` è il modello di documento, cioè la parte del contratto che un plugin
di formato tocca **per prima**: quattordici tipi lì dentro sono un buco più
grande di ventuno in `traits.rs`, e nessuno li aveva contati perché nessuno
aveva pensato di guardare.

**Delle tre specie di invisibilità, era sempre la seconda.** Nessuno dei
sessantuno era `pub(crate)` — cioè irraggiungibile — e nessuno era soltanto non
documentato. Tutti e sessantuno erano **raggiungibili solo per path lungo**:
`fub_abi::traits::JobId`, `fub_abi::model::PropertyValue`. Una specie sola,
quindi una riparazione sola; la voce sospettava di averne fuse due e non le
aveva fuse.

**«È una firma, quindi scade» è falso, e va detto perché la voce stava in cima
per questo.** Un `pub use` in più è **additivo**: si può aggiungere il giorno
dopo il freeze esattamente come oggi, e non costa nessuna migrazione di
versione. Ciò che scade non è la firma — è il **frattempo**: ogni consumatore
che nel frattempo scrive `fub_abi::traits::X` lega il proprio sorgente a un
modulo di implementazione, e quel legame lo paga lui il giorno in cui
`traits.rs` si spezza (ed è la direzione in cui il crate si muove dalla
[0053](0053-il-contratto-ha-una-sorgente.md): misurati oggi, centocinque `use`
di altri crate passano da `fub_abi::traits::`). **La §24.1 era una P0 per la
ragione sbagliata** ed è comunque valsa il giro, perché la domanda che poneva —
chi decide l'elenco — non scade affatto.

## La decisione

Le tre forme erano già nominate nella voce, e la scelta fra le prime due è
facile: **l'elenco a mano** lascia il difetto in piedi (il prossimo tipo nasce
fuori esattamente come questi sessantuno), **`pub use traits::*`** rinuncia a
dire cosa è superficie e per `arena` non compila nemmeno, perché cinque dei suoi
dodici tipi si chiamano come i tipi di `model` e `ui`. Resta la terza: **il
contenuto a mano, la regola a un presidio.**

Quarantatré tipi entrano nel blocco `pub use` di `lib.rs`, e
[`crates/fub-abi/tests/superficie_della_radice.rs`](../../crates/fub-abi/tests/superficie_della_radice.rs)
legge `src/` per intero con `syn`, ne estrae ogni `pub struct`/`enum`/`trait`/`type`
e li confronta col blocco. **Un tipo nuovo che non ci sia messo è rosso, per
nome.** Il commento in testa al blocco non dice più «i tipi più usati»: dice che
ci sono tutti, e adesso è una frase che qualcuno verifica.

### La decisione vera: i moduli che non si possono appiattire

Detto «ci sono tutti», restano diciotto tipi per cui *tutti* è impossibile —
dodici di `arena`, sei di `rules` —, e lì c'erano **due forme fra cui scegliere,
che è la parte che questa voce aveva davvero dentro**:

- **un'eccezione per tipo**: diciotto nomi in un'allowlist, ognuno con la sua
  riga, come `dieta_ipc` fa coi comandi;
- **un'eccezione per modulo**: due righe — `arena`, `rules` — ognuna con la
  ragione per cui quel modulo **si usa qualificato**.

**Ha vinto la seconda, e il criterio è la prova del secondo chiamante.** Con
l'eccezione per tipo, il tredicesimo tipo di `arena` nascerebbe rosso, e chi lo
aggiunge farebbe tacere il test scrivendo il suo nome nell'allowlist — cioè
ripeterebbe, in un file diverso, esattamente il gesto per cui questo presidio
esiste. Con l'eccezione per modulo lo eredita gratis, perché la ragione
(«`arena` è la forma al confine e i suoi nomi collidono con l'albero nativo per
costruzione», «`rules` si chiama col soggetto davanti») è una proprietà del
**modulo**, non dei tipi che ci stanno dentro. Un'allowlist di nomi avrebbe
detto diciotto volte una cosa che è vera due volte.

L'eccezione per modulo ha un prezzo dichiarato — un tipo nuovo dentro `arena` o
`rules` resta invisibile senza che nessuno lo dica — e in cambio due pretese che
la forma per tipo non poteva avere: la ragione dev'essere **argomentata** (il
test rifiuta una ragione di meno di ottanta caratteri, che è il minimo per non
poterla scrivere «serve»), e un modulo qualificato **non può avere neanche un
tipo alla radice**, perché «si usa col nome davanti» e «metà è riesportato» sono
due affermazioni che insieme non vogliono dire niente.

## Il presidio che è stato tolto, e perché è la parte istruttiva

Il test era nato con **quattro** prove, e la quarta era il verso di ritorno —
*«alla radice c'è un nome che nel modulo non esiste più»* —, imitando la
disciplina di `dieta_ipc` e di `ALLOWED_TRANSITIVE_ABI`, dove un elenco che
resta lungo mentre il codice si accorcia smette di essere una fotografia e
diventa un ricordo. Messo alla prova del rosso, **non è diventato rosso: non ha
prodotto output affatto**, perché il crate non compilava. Un `pub use` non è una
stringa che *nomina* un simbolo, è un **riferimento** a quel simbolo — quel
verso ce l'ha già il compilatore, che è un presidio più forte e più veloce.
La prova è stata cancellata invece che abbassata: sarebbe stata verde per
sempre, e un presidio verde per sempre è indistinguibile da uno soddisfatto.
**La disciplina dei due versi vale per gli elenchi di stringhe**, e in questo
file ce n'è uno solo — `MODULI_QUALIFICATI` — che infatti i due versi ce li ha
entrambi.

## Il rosso, cinque volte

1. Tolto `JobId` dal `pub use` → *«1 tipi pubblici del contratto non si vedono
   da `fub_abi::`»*. È l'elenco «questi sono tutti» provato **togliendo** un
   elemento.
2. Tolto `arena` da `MODULI_QUALIFICATI` → dodici nomi rossi.
3. Riesportato `arena::ArenaError` lasciando `arena` fra i qualificati → rossa
   la contraddizione, con la frase che dice quale delle due togliere.
4. `pub use organization::*;` al posto del nome → il lettore **rifiuta** la
   forma invece di accettarla in silenzio: il glob non passa di qui.
5. Il camminatore fermato alle cartelle (`if v.is_dir() {}`) → rosso
   `il_camminatore_scende`, che nomina `rules::ids::Owner`. È il test del test:
   senza, tutto il resto potrebbe essere verde perché non guarda niente.

## Il difetto fuori dalla voce, che non ho riparato

**`src/rules/` è invisibile ai presidi che camminano il sorgente**, e non è un
caso isolato: `common::fieldless_enums()` — il lettore condiviso della
[0053](0053-il-contratto-ha-una-sorgente.md) — dichiara di raccogliere «tutti e
soli gli `enum` senza payload dichiarati `pub` in `fub-abi/src/*.rs`», e quel
`src/*.rs` non è un'abbreviazione: è una `read_dir` che non scende. I cinque
enum senza payload di `rules/` non entrano nel mirror TypeScript e nessuno lo
dice.

**Non l'ho allargato, ed è una decisione e non una svista.** Misurato: `Naming`,
`Newline`, `Owner` non derivano `Serialize` — non attraversano nessun confine
JSON —, e `fieldless_enums` pretende `#[serde(rename_all = "snake_case")]` da
tutto ciò che raccoglie. Farlo scendere in `rules/` lo farebbe **panicare** con
un'accusa falsa. Il che dice la cosa vera: quel lettore confonde «enum `pub`
senza payload» con «enum che attraversa l'IPC», e `src/*.rs` è il filtro che
tiene in piedi la confusione senza che nessuno l'abbia scritto. Sistemarlo vuol
dire scegliere il criterio giusto — `Serialize`, probabilmente — ed è una
decisione sul confine JSON, non un refuso da correggere di straforo dentro una
voce sulla radice del crate. Il presidio di qui **scende** in `rules/`, e
`il_camminatore_scende` nomina `rules::ids::Owner` apposta.

## Zone cieche dichiarate

- **Solo i tipi.** Funzioni libere e costanti non sono pretese alla radice: una
  funzione si raggiunge attraverso il modulo che la nomina, e
  `rules::path::resolution_key` senza `rules::path` perde il soggetto; un tipo
  invece compare nella **firma** di qualcun altro, e chi la legge deve poterlo
  nominare. `MAX_RANDOM_BYTES` è alla radice perché ce lo hanno messo, non
  perché una regola lo pretenda.
- **Un tipo nuovo dentro `arena` o `rules`** resta invisibile: è il prezzo
  dell'eccezione per modulo, scritto qui sopra.
- **Solo `fub-abi`.** Nessun altro crate del workspace è guardato: nessun altro
  ha un contratto da esporre.
- **La visibilità effettiva non è il `pub` scritto.** Un tipo `pub` dentro un
  `mod` privato risulterebbe *mancante* invece che irraggiungibile — cioè
  sbaglia diventando rosso, che è il verso giusto.

Nessuna firma di contratto cambiata (i quarantatré `pub use` sono additivi), WIT
intatto, nessuna dipendenza nuova (`syn` era già una dev-dependency). Un binario
di test in più: da centodiciannove a centoventi righe `test result: ok`.
