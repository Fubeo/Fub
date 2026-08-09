# 25. Sette scelte che il codice ha preso senza dirlo

Una **seduta** della [roadmap infrastrutturale](../todo.md): sette punti in cui una posizione è già presa — l'ha presa il codice, scrivendosi — e nessuno l'ha scelta. Non sono pezzi mancanti del piano di M4: sono scelte di prodotto e di contratto rimaste implicite dentro un'implementazione.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) · [i verbali delle decisioni chiuse](../decisions/README.md)

---

**Da dove viene questa seduta: dal giro del 2026-08-07.** La
[24](24-tre-firme-che-il-freeze-rende-definitive.md) l'aveva trovata un
consuntivo; questa l'ha trovata una **rilettura**. Cinque letture indipendenti
hanno ripreso le osservazioni che questo repo si portava avanti di giro in giro
— righe di difetto, premesse citate, affermazioni sull'architettura — e le hanno
rimisurate contro i sorgenti di oggi, a `bc1d27d`. L'esito è il fatto principale
del giro, e va scritto prima delle voci: **la rimisurazione ha smentito più
spesso di quanto abbia confermato.**

Delle venticinque righe di difetto riprese, **tre erano false** e **dieci
dicevano una cosa diversa** da quella che si osserva — non più piccola: diversa,
con un altro soggetto o un altro meccanismo — e due difetti veri sono stati
trovati **accanto** a una riga falsa, cercando la prova che la smentiva. Delle
cinque osservazioni sui link ne sono rimaste **due**, e tre premesse sono cadute
intere. Delle tre «decisioni portate avanti», **una non era una voce affatto**: era
prosa falsa in tre presidi, e il repo aveva già deciso per iscritto contro
l'unica forma che l'avrebbe resa una decisione. E la voce più grave di tutte,
la [§25.1](#251-una-rinomina-che-atterra-su-una-nota-viva), regge **per una
strada diversa** da quella con cui era stata scritta: tutte e quattro le sue
premesse originali sono false, e il danno c'è lo stesso, in un'altra funzione.

---

**Perché stanno insieme.** In tutte e sette il codice ha già preso una
posizione, e l'ha presa senza che nessuno la scegliesse: **schiacciare** ciò che
apparteneva a un'altra identità (§25.1), **lasciar nascere** una regola di
identità di un nome senza che nessuno la veda (§25.2), chiamare la prima
fotografia di un vault **dal posto in cui capita** invece che da quello deciso
(§25.3), **copiare il blocco intero** in ogni contesto di backlink (§25.4),
**tacere** quando lo stato dell'applicazione non si può più salvare (§25.5),
**tenere un lucchetto** di macchina per il tempo di un `fsync` (§25.6),
**campionare tre chiavi cablate** per trovare i byte di un blocco di terzi
(§25.7).

E c'è una seconda proprietà, che è la ragione per cui queste sette si decidono
insieme e non una per volta: **in sei casi su sette la risposta giusta è già
scritta nel repo, sullo stesso problema, e il codice non la applica.** Il
versioning fonde le storie invece di buttarne una (§25.1); la forma del conto che
pretende una dichiarazione esiste già per i lucchetti (§25.2); la
[0070](../decisions/0070-un-vault-si-apre-in-due-tempi.md) scrive il criterio di
cosa sta nell'apertura sincrona (§25.3); la ricerca ha un tetto di 220 caratteri
sull'estratto (§25.4); la
[0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md) dice che
il log è il pavimento e l'evento è la porta (§25.5); il commento di
`set_view_state` scrive parola per parola perché lì non si prende il prestito
esclusivo (§25.6). La settima, la §25.7, è l'eccezione che regge il conto: lì la
regola non è scritta **da nessuna parte**, e quello è precisamente il difetto.

---

### 25.1 Una rinomina che atterra su una nota viva

*chiusa dalla [0135](../decisions/0135-una-rinomina-che-atterra-su-una-nota-viva.md) · strato **kernel** · **P0***

**Com'è finita, e cosa lascia.** La voce chiedeva chi vince quando una rinomina
fatta da fuori atterra su un'identità che nel vault esiste già, e la risposta è
la **forma (a)**: se `to_id` è già in anagrafe non è un rename, è
`remove(from)` + `sync_path(to)`. La misura che l'ha decisa era che dei quattro
canali di stato attaccati a un'identità **tre la distruggevano e uno la
fondeva**, e che il canale distrutto più grave — la bozza — è per dichiarazione
del modulo che la tiene «l'unica copia di ciò che l'utente ha scritto»: `mv A.md
B.md` da un terminale, con Fub aperto e il buffer di `B` sporco, cancellava per
sempre quel testo senza dirlo. La guardia sta in una riga sola, nel punto che
tutte e tre le porte attraversano, e la degradazione esisteva già lì accanto.

Delle quattro premesse con cui la voce era stata scritta **nessuna reggeva**, e
il danno c'era lo stesso in un'altra funzione: è il caso di scuola di una voce
sbagliata sul meccanismo e giusta sul posto dove guardare. Il dettaglio sta nel
verbale.

Resta aperta la sola **forma (b)**, e resta perché non è urgente, non perché sia
stata scartata:

- [ ] **(b) Migrare senza mai schiacciare**, cioè la regola del versioning estesa
      agli altri tre canali: dove fondere ha senso si fonde, dove non ce l'ha
      vince la destinazione e ciò che resta indietro si **nomina**
      (`doc_data_warnings` c'è già, `organization.warn` pure). Il modello è già
      scritto — `VersionStore::rename` unisce le due storie in ordine di tempo,
      «buttarne una sarebbe perdere versioni senza dirlo» — ma le politiche da
      scrivere sono **tre**, una per canale, e non sono la stessa: due bozze non
      salvate non si fondono senza inventare un testo che nessuno ha scritto.
      Paga **chi manterrà il codice**, ed è l'unica forma in cui nessuno perde
      niente in silenzio.

---

### 25.2 Quante regole di identità di un nome vuole Fub

*aperta · strato **contratto** · **P1***

**1. La domanda.** Una regola nuova di «quando due nomi sono lo stesso nome» si
**dichiara**, o nasce in silenzio? E se si dichiara, dove — nel contratto, in un
conto, o in una porta?

**2. Che cosa si osserva oggi, misurato.** Censimento a `bc1d27d`, contato per
nome di simbolo e non per numero di riga:

- **44 funzioni-regola di produzione**, con **~95 siti di chiamata**.
- **13 regole distinte di piegatura del caso**, su **tre meccanismi
  incompatibili**: `str::to_lowercase` (full-Unicode, sensibile al contesto),
  `char::to_lowercase` (senza contesto), `eq_ignore_ascii_case` /
  `to_ascii_lowercase` (solo ASCII). **Una sola delle tredici fa anche la
  normalizzazione NFC**: `resolution_key`.
- **Tre risposte incompatibili** alla domanda «sta dentro questa cartella?», più
  una quarta nell'SDK: `query::within_folder` taglia gli slash finali e **ha** il
  ramo su sé stessa; `rules::events::folder_contains` li taglia e **non** ce
  l'ha; `transfer::in_folder` (`fub-abi/src/transfer.rs:675`) taglia **entrambi**
  i capi e non ha il ramo; `MemoryHost::data_list` usa
  `starts_with(prefix + "/")`.
- **Due duplicati verbatim in produzione**: `query::tag_matches` (seconda metà) ≡
  `rules::tag::is_sub_tag`; e `let case_only = from.as_str().to_lowercase() == …`
  copiato identico a `workspace.rs:3011` **e** `:3085`.
- **La famiglia a cui manca la NFC è di quattro siti, non di uno**:
  `canonical_tag` (`model.rs:757`), `canonical_anchor` (`:768`, che nessuna riga
  aveva mai nominato), `heading_slug` (`:791`), `prefix_len_ci`
  (`occurrences.rs:215`).
- **L'identità di un'estensione ha due risposte contraddittorie**: ASCII in
  `rules/media.rs:48,76` e `rules/health.rs:129`, full-Unicode in `registry.rs`,
  `documents.rs:314`, `transfer.rs:362`.

E un dato che sta accanto e non dentro il censimento: il banco di
`transfer.rs:968` asserisce che `in_folder("x/a.md", "/x/")` è **vero**, dove
`within_folder` sullo stesso ingresso dà **falso** — mentre la prosa di
`crates/fub-abi/src/traits.rs:287` scrive che la regola «*è una, e due copie
divergerebbero sul caso che nessuno prova*».

**3. Le forme, e chi paga.**

- [ ] **(a) Un conto delle regole**, come `un_lucchetto_solo.rs` fa per i
      lucchetti: un banco che legge i sorgenti e pretende che ogni funzione che
      piega il caso o normalizza stia in un elenco con la sua **famiglia** e la
      sua **ragione**. Costa un'allowlist di ~44 righe e non rompe niente. **Paga
      chi aggiunge la 45ª regola**, che è esattamente lo scopo.
- [ ] **(b) Una porta**: ogni regola di identità di nome vive in
      `fub_abi::rules` e non è raggiungibile altrove. Il precedente esiste —
      `fub-abi/tests/superficie_della_radice.rs:46` asserisce che
      `resolution_key` si raggiunge solo da `rules::path`. Costa il trasloco di
      `canonical_tag`, `canonical_anchor` e `heading_slug`, più il divieto al
      kernel di scrivere `to_lowercase()` a mano; e rompe le regole
      *volutamente* diverse — `prefix_len_ci`, la corsia ASCII di `tags.rs` — che
      dovrebbero salire con la loro ragione. **Paga chi mantiene il kernel.**
- [ ] **(c) Niente censimento**: si riparano le divergenze misurate una per una.
      **Paga chi troverà la prossima fra sei mesi**, rifacendo il lavoro di
      questo giro.

**4. Che cosa il repo ha già deciso qui vicino — ed è la parte che riscrive la
domanda.** **Quattro volte** il repo ha stabilito che le regole sono
legittimamente più d'una, quindi «una porta sola» risponde a una domanda già
chiusa con un no:

- la **decisione [0020](../decisions/0020-le-regole-in-un-posto-solo.md)**:
  «*Non sono due copie della stessa regola: sono due requisiti che **devono**
  divergere, e una fixture che li legasse nascerebbe rossa e resterebbe rossa.*»
- la **decisione [0107](../decisions/0107-il-caso-di-una-lettera.md)**: «*la
  domanda non era una: erano tre, e adesso hanno tre risposte diverse.*» E la
  riga che quel verbale ha **ripudiato** da `path_policy.rs` è precisamente la
  tesi «unifichiamo»: «*È il tipo di riga peggiore che un modulo possa contenere:
  dichiara **coperto** ciò che non lo è.*»
- la **decisione [0058](../decisions/0058-un-nome-che-nasce.md)**: «*Un nome che
  c'è e un nome che nasce non si giudicano con la stessa regola*», e fra le cose
  scartate «*una politica sola per leggere e per creare. È la voce letta a
  metà.*»
- la **decisione [0115](../decisions/0115-la-verita-e-la-dichiarazione.md)**:
  «*le tre specie di regola che ci convivono sono dichiarate: generata,
  rispecchiata, scritta una volta. L'ultima categoria non è un residuo da
  rimpicciolire a tutti i costi.*»

**E la zona cieca è già dichiarata, sempre dalla decisione 0115** — è la frase che
questa voce esiste per citare: «*Nessun attore vede una quattordicesima regex
scritta domani in un modulo nuovo della shell … il generato, la fixture e il
corpus prendono chi **cambia** una regola, non chi ne **aggiunge** una accanto.*»

**Il precedente esatto esiste, e ha già vinto una volta.** La **decisione
[0110](../decisions/0110-la-struttura-non-e-una-preferenza.md)**, nella sezione
aggiunta il 2026-08-06, è l'ammissione post-hoc che una regola era stata
riscritta e aveva divergito: «*`IgnorePolicy` confrontava i nomi per uguaglianza
di byte … mentre la 0107, decisa nello stesso giro e **tre commit prima**, aveva
appena stabilito quando due path sono lo stesso path … questa decisione ha
perfino modificato la prosa di `path_policy` senza usarne la funzione.*»

Chi possiede le regole è già deciso dalla decisione 0020 («*se una risposta del
contratto ha una parte che non dipende da chi la dà, quella parte è del
contratto*»), qualificata dalle decisioni
[0043](../decisions/0043-il-path-e-la-chiave.md) e
[0123](../decisions/0123-lo-slug-di-un-titolo-e-un-posto-non-una-parola.md). E
sono già decise, da non riaprire: la **decisione
[0047](../decisions/0047-la-cartella-esiste-nel-kernel.md)** (folder note per
path esatto, divergenza deliberata), la **decisione
[0086](../decisions/0086-una-cronologia-e-la-sua-porta.md)**
(`nome-cercato.ts` non normalizza, ed è prodotto: «*ripulirla in
`riunione-con-anna` è il momento in cui l'app decide di sapere meglio
dell'utente come si chiamano le sue cose*»), la **decisione
[0117](../decisions/0117-un-termine-non-si-sovrappone-a-se-stesso.md)** (la
deduplica sensibile al caso in `wanted` è dichiarata scoperta) e la **decisione
[0061](../decisions/0061-un-giro-che-non-passa-dal-modello.md)** (il round-trip
NFC/NFD dei nomi non è provato e servirebbe una macchina Apple in CI).

**5. Reversibile?** La (a) sì: un banco si cancella. La **(b) no** per la parte
che sale nel contratto — `fub_abi::rules` è WIT-adiacente, e ciò che ci entra ci
resta. La (c) è reversibile per definizione, e per definizione non decide niente.

**6. La raccomandazione: (a), e non (b) adesso.** La prova che decide è *il
secondo chiamante la eredita gratis?*. Il repo ha già stabilito quattro volte che
le regole **devono** essere più d'una: ciò che nessuno eredita non è la porta, è
**la dichiarazione**. Chi scrive oggi la 45ª regola non trova niente che gli
chieda a quale famiglia appartenga, e la decisione 0110 dimostra col proprio caso
che questo costa una divergenza **tre commit dopo** che una decisione l'aveva già
risolta. Un conto — la forma che questo repo usa già per i lucchetti, per l'IPC,
per le corse — dà quell'eredità al prezzo di un'allowlist. E l'allowlist ha già
il suo asse: le tre famiglie sono misurate, e il criterio per stare nell'una o
nell'altra è già scritto in `occurrences.rs:212-214` e `tags.rs:227-248`. Il conto
non deve inventare la tassonomia: deve **pretenderla**.

**7. Che cosa resta rotto se non si decide.** La 45ª regola nasce senza che
nessuno lo sappia, esattamente come è nata la 14ª — misurata **tre commit** dopo
la decisione che l'aveva già risolta. I difetti `0115`, `0140`, `0141` e `0142`
si riparano comunque; ciò che non si ripara è che il quinto arriva.

*Quello che si diceva e che non regge.* La domanda posta era «unifichiamo le
regole?», e il repo l'aveva già chiusa quattro volte. Il **difetto 0070**
(«`prefix_len_ci` sbaglia sulle espansioni, `İ`») è **falso come difetto**: `İ`/`i`
e `ẞ`/`ß` sono entrambe le risposte *giuste* sotto la conversione di caso di
default, è deliberato, `occurrences.rs:69,88-90,212-214` lo spiega, e
`fub-features/src/tags.rs:227-248` cita quel difetto come ragione per **non**
riusare quella regola; il difetto vero di `prefix_len_ci` è un altro, ed è la NFC
mancante. Il **difetto 0093** («due slug diversi ⇒ i link si rompono») è **falso**
sulla conseguenza: `heading_matches` (`model.rs:892`) è una **disgiunzione** —
`heading_slug(query) == heading.slug` **oppure**
`resolution_key(query) == resolution_key(heading.text)` — e il secondo ramo salva
la risoluzione nei due versi; ciò che si rompe è l'`id=` HTML. E su NFD
`heading_slug` non diverge soltanto: **cancella** l'accento (`Café` in NFD →
`cafe`), perché `U+0301` è una `Mn` e non è alfanumerica. Il **difetto 0018**
punta al posto sbagliato e morde più forte di come è scritto: nel ramo `Path` la
scansione è un ripiego su un link già dichiarato rotto, col commento accanto che
lo dice; nel ramo `Wiki` invece `resolve_entry_in` ritorna `named_entry_in`
**incondizionatamente** — ed è il difetto `0115`, misurato a **1,335 ms** su 1 000
voci, **7,285 ms** su 5 500 e **27,761 ms** su 20 000.

---

### 25.3 Dove sta la prima fotografia di un vault

*aperta · strato **kernel** · **P1***

**1. La domanda.** La prima fotografia di un vault mai visto deve stare dentro
l'apertura sincrona — garantendo che nessuna nota possa essere modificata prima
di avere il suo primo snapshot — o può essere differita, accettando una finestra
in cui una modifica cancella per sempre lo stato in cui l'utente ha trovato
quella nota?

**2. Che cosa si osserva oggi, misurato.** `scan_vault` (`workspace.rs:1692`)
emette `VaultOpened` e chiama `dispatch_pending()` a `workspace.rs:1760-1763`,
cioè **dentro la fase 1** — quella che `Host::open` aspetta
(`session.rs:581`) — **prima** di `begin_index_job`, **prima** del ponte eventi,
**prima** che il runner esista. Da lì: `versioning.rs:1276` →
`first_snapshot_of_the_vault` (`:1191`) → `sweep(Passata::SoloNuovi)` (`:1110`).
Non è «fuori dalla fase a fette»: è **prima che la fase a fette esista**. Non è
annullabile — la bandiera si guarda solo in `avanza_apertura`, `runner.rs:486` —
e non compare in nessuna barra, perché il `JobStarted` nasce dopo
(`session.rs:601`).

Vault sintetici, ~5,6 KB per nota, `.fub/` rimosso prima di ogni corsa, `mount()`
reale, cache di pagina calda:

| note | `scan_vault` versioning **spento** | **acceso** | **la passata** | fase a fette |
|---|---|---|---|---|
| 100 | 0,5 ms | 13,0 ms | **12,5 ms** | 28 ms |
| 1000 | 2,5 ms | 386,8 ms | **384 ms** | 240 ms |
| 5000 | 15,9 ms | 9253,9 ms | **9238 ms** | 1703 ms |

Quadratico netto: ×10 note → ×31 tempo. L'O(N²) è **triplo** — due
`inner.docs.clone()` (`versioning.rs:428`, `:507`), un `docs.clone()` dentro
`scrivi_index` (`:756`), più la serializzazione e la scrittura atomica
dell'intero `versions.json`. A 5000 note il `versions.json` finale è 714.514 B,
quindi il riscritto totale è ≈ 5000²/2 × 143 B ≈ **1,79 GB**.

Il **residuo lineare**, misurato direttamente (leggi il file, impronta FNV-1a
come `versioning.rs:1085`, scrittura atomica del blob, senza mai toccare
l'indice):

| note | residuo lineare | per nota |
|---|---|---|
| 100 | 3,3 ms | 0,033 ms |
| 1000 | 31,9 ms | 0,032 ms |
| 5000 | **167,0 ms** | 0,033 ms |

Cioè: **riparato l'O(N²), su 5000 note la passata passa da 9238 ms a ~167 ms** —
un decimo della fase a fette e dieci volte la scansione. Due fatti che accorciano
la decisione: una passata interrotta è **già gratis da riprendere**
(`Passata::SoloNuovi` salta chi ha già versioni, `versioning.rs:1112`), e **la
finestra scoperta di oggi è zero**.

**3. Le forme, e chi paga.**

- [ ] **(a) Com'è oggi, con l'O(N²) riparato.** Chi chiude a metà non vede niente
      e alla riapertura la passata riprende gratis; chi modifica nella finestra
      non esiste, perché finestra non ce n'è. Costo: 167 ms aggiunti
      all'apertura sincrona su 5000 note, invisibili nella barra e non
      annullabili. **Paga chi apre un vault grande**, e paga poco.
- [ ] **(b) La passata diventa una fase a fette.** Annullabile, visibile, dentro
      il `JobId` che esiste già. Ma chi modifica nella finestra **perde per
      sempre** lo stato di quella nota, e la finestra è lunga quanto
      l'indicizzazione — 1,7 s su 5000 note, e su disco freddo secondi. **Paga
      l'utente che comincia a scrivere subito**, che la decisione
      [0124](../decisions/0124-una-fetta-dell-apertura-e-un-piano-anche-lei.md)
      chiama «non una patologia ma il comportamento normale».
- [ ] **(c) In sottofondo dopo l'apertura, con «non ancora» nella cronologia.**
      Come la (b), più una superficie nuova da disegnare e tradurre e uno stato
      in più che ogni lettore della cronologia deve gestire. **Paga chi manterrà
      il codice**, in cambio di niente che la (b) non dia già.
- [ ] **(d) Lo snapshot viaggia con la fetta.** `plan_batch` legge già il
      sorgente di ogni nota: una lettura invece di due, e la passata eredita
      gratis annullamento e progresso. **Paga il contratto**: `ParsedBatch`
      (`workspace.rs:307-321`) porta `models`, non sorgenti, e il versioning è un
      `EventHandler` — servirebbe un evento per documento che porti il sorgente.
      E non chiude comunque la finestra: la accorcia.

**4. Che cosa il repo ha già deciso qui vicino.** La **decisione
[0070](../decisions/0070-un-vault-si-apre-in-due-tempi.md)** scrive il criterio,
e lo scrive **contro** il costo: «*La linea del taglio non è "quanto costa", è
"cosa il vault sa dire". La divisione ovvia sarebbe stata per costo … Sarebbe
stata una divisione che cambia col disco. … il confine è se il vault sappia
ancora dire **quali** documenti esistono. Da un lato la scansione …; dopo, tutto
ciò che serve a sapere **cosa dicono** i documenti, che è derivato e si
ricostruisce.*» La passata legge il **contenuto** di ogni nota: sta per
definizione dalla parte del *cosa dicono*, ed è oggi dalla parte sbagliata della
riga. Il criterio esiste, la passata lo viola, e nessuno l'ha notato perché è
arrivata da un evento invece che da una chiamata.

La **decisione [0068](../decisions/0068-un-vault-si-apre-per-quel-che-si-legge.md)**
è la riga da cui quel criterio deriva. La **decisione 0124** ha già affrontato lo
stesso pericolo un piano più in basso — «*senza il confronto delle impronte
questo commit avrebbe scambiato una lentezza con una **perdita silenziosa di
testo***» — e la sua risposta (impronta per documento, confrontata
all'applicazione) è il materiale già pronto se si sceglie di differire. La
**decisione
[0119](../decisions/0119-il-piano-si-fa-in-lettura-e-si-applica-in-scrittura.md)**
dà la forma piano/applicazione, e la **decisione 0034** è la ragione per cui la
passata è uno sweep e non un evento. Infine, la finestra scoperta è **già
nominata nel sorgente**, `versioning.rs:1186-1190`: «*senza questo passaggio, la
prima modifica a una nota mai versionata cancellerebbe per sempre lo stato in cui
l'utente l'ha trovata — l'handler gira dopo la scrittura e vede solo il testo
nuovo*».

**5. Reversibile?** Sì per (a), (b) e (c): nessun tipo pubblico, nessun formato
su disco — `versions.json` non cambia, e la (b) sposta soltanto *chi* chiama
`sweep`. **No per la (d)**: vuole un evento che porti il sorgente, cioè un campo
nel WIT — additivo, quindi non ritaglia il congelato, ma il nome e il tipo si
pagano per sempre, e porta un byte-per-byte dei documenti dentro la coda degli
eventi, che la decisione 0034 ha già dichiarato a budget.

**6. La raccomandazione: (a), e la sola cosa da spostare è *dove* sta la
chiamata, non *quando*.** L'argomento è il numero: 167 ms su 5000 note è il
prezzo di una finestra di lunghezza **zero** su un dato che, perso, non si
ricostruisce da niente. Differire per risparmiare 167 ms significa scambiare una
lentezza che l'utente non vede con la perdita che la funzione esiste per
impedire, cioè letteralmente il baratto che la decisione 0124 ha rifiutato tre
commit fa.

Ma la (a) **non è lo stato di oggi**: oggi quei 167 ms stanno dentro
`scan_vault`, cioè dentro la fase che la decisione 0070 riserva a *quali
documenti esistono*, e ci stanno **per caso**, perché `VaultOpened` esce di lì.
La forma giusta è chiamare la passata **subito dopo la fase 1 e prima delle
fette**, dallo stesso posto da cui il runner chiama `collect_doc_data`
(`runner.rs:544`): sincrona rispetto alla prima fetta, quindi finestra ancora
zero, ma **fuori dal `Result` che `Host::open` aspetta** e dentro il racconto del
job. Costa una riga di `runner.rs` e nessuna decisione di contratto. **E prima di
tutto questo va riparato l'O(N²)** — il difetto `0114`: finché c'è, ogni misura
di questa voce è una misura di quello.

**7. Che cosa resta rotto se non si decide.** Oggi, su un vault di 5000 note,
l'apertura si ferma **9,2 secondi** in una fase che non si può annullare e che
nessuna barra racconta: l'utente vede l'app appesa e non ha modo di sapere perché
né di fermarla. Riparato l'O(N²) restano 167 ms nello stesso punto cieco — e
nessuna riga scritta dice se quel punto sia il posto giusto, mentre la decisione
0070 dice che non lo è.

*Quello che si diceva e che non regge.* Si diceva che la passata girasse «fuori
dal ciclo a fette del `JobRunner`»: è più grave, gira **prima che il ciclo
esista**. E il numero che circolava — «1542 ms su 2358» — **non ha riscontro nel
repo**: era una stima, non una misura, e le misure vere sono quelle della tabella
qui sopra. La riga di difetto che diceva la stessa cosa è stata **tolta** invece
che scritta: *dove* debba stare quella chiamata è precisamente questa voce, e un
difetto la cui riparazione dipende da una decisione non è un difetto.

---

### 25.4 Quanto contesto porta un backlink

*aperta · strato **contratto** · **P1***

**1. La domanda.** Quanto testo porta un backlink, e chi lo produce: chi parsa o
chi disegna?

**2. Che cosa si osserva oggi, misurato.** Misure rifatte a `bc1d27d` su `docs/`,
cartelle nascoste escluse:

- 200 note, **3.258.845 byte** di sorgente, **4.367 link**, tutti col contesto.
- Somma dei contesti, una copia per link: **53.994.565 byte** — **16,6×** il
  vault.
- Distribuzione: min 4, **p50 341**, p90 1.367, p99 195.738, **max 195.738**.
- `decisions/README.md` da solo: **51.931.587 byte**, il **96,2%** del totale, da
  **462** link.
- `entries.json`: **54.934.932 B**. Leggerlo e parsarlo costa 53,5 + 47,8 ms,
  riserializzarlo 66,6 ms.
- Copie dello stesso testo in RAM: **tre** — `DocMeta.links` (`Link.context`,
  `model.rs:713`), `LinkRef.context` (`graph.rs:95`, clonata in `register_links`,
  `graph.rs:495`), `BacklinkRef.context` (`graph.rs:589`).

**La misura che decide, e che mancava fino a questo giro: il contesto viene
mostrato, ma su una riga sola troncata dal CSS.** A mostrarlo è
`fub-features/src/backlinks.rs:190` (`r.context.clone().map(Text::from)`), che lo
mette nel **sottotitolo** di un `list_item`; la shell lo disegna a
`frontend/src/ui/node.ts:543` e lo veste a `frontend/src/style.css:713`:

```css
.ui-list-item-subtitle { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

Tutto il resto attraversa l'IPC per essere buttato dal browser, e non è gratis:
`backlinks.rs:81` chiede `page: None`, cioè nessuna finestra. Byte consegnati al
pannello per apertura di nota, sul `LinkGraph` reale di `docs/`: **mediana
203.655 byte**, massimo **1.575.186** per 29 righe (`decisions/0077-…`), e 1.406.151
per le 200 righe di `todo.md`. Cioè **199 KB mediani per disegnare qualche riga
da ~80 caratteri visibili**.

**3. Le forme, e chi paga.**

- [ ] **(a) Tetto in byte con ellissi.** Costa una costante e un taglio a confine
      di carattere; a 220 byte il pannello disegna lo stesso identico pixel.
      **Non paga nessuno**, e il banco `il_corpus.rs:854`
      (`ogni_link_del_corpus_porta_il_contesto_del_suo_blocco`) resta verde:
      verifica che il contesto ci sia e non sia vuoto, non che sia il blocco
      intero.
- [ ] **(b) Finestra intorno al link.** Costa un `char_indices` e due numeri
      invece di uno, e rende di più: su un blocco lungo la (a) taglia in testa e
      **il link finisce fuori dall'ellissi**, cioè il frammento mostrato non
      contiene il riferimento di cui parla. **Paga chi manterrà il codice**, e chi
      scrive un provider di terzi, che deve implementarla uguale. È ciò che il
      repo già fa per la ricerca.
- [ ] **(c) Nessun contesto memorizzato, si rilegge quando serve.**
      `Link.context` resta `none` e il pannello ricava il frammento dallo `span`
      del link contro il documento. Rompe davvero: il banco `il_corpus.rs:854`
      cade e va riscritto contro il nuovo produttore, e `Link.context` è nel
      **WIT congelato** (`wit/frozen/0.1.0.wit:130`, `:1738`) — resta lecito
      riempirlo, quindi non è un ritaglio, ma diventa un campo che il provider
      nativo non riempie e uno di terzi sì. Guadagna: `entries.json` torna a
      ~3 MB su 3,2 MB di note, e la RAM perde tre copie su tre.
- [ ] **(d) Blocco intero condiviso (`Arc<str>`).** **Non ripara il disco.**
      `entries.json` è JSON: un `Arc` condiviso si serializza N volte lo stesso, e
      i 54,9 MB restano 54,9 MB. Ripara la RAM del grafo e basta.

**4. Che cosa il repo ha già deciso qui vicino — ed è la parte che cambia la
raccomandazione.** La stessa domanda, «quanto testo porta una riga di
risultato?», è già stata posta e risposta per la **ricerca**:

- `fub-features/src/search.rs:122` — `const SNIPPET_CHARS: usize = 220;`,
  «Lunghezza massima di uno snippet, in caratteri», applicata a `search.rs:1182`
  (`gen.set_max_num_chars`) e `:1205`. **L'estratto della ricerca è una finestra,
  ed è tappato a 220 caratteri.**
- `fub-abi/src/traits.rs:2199` — l'enum `Excerpts` esiste **per una misura**,
  scritta nel suo docstring: «*una ricerca testuale su duemila note ne costava
  ventitré millisecondi, e ventuno erano duemila estratti generati per mostrarne
  venti*». La conseguenza è che l'estratto **si chiede** (`excerpts: Excerpts`,
  `traits.rs:2586`) e non si presume.

Il contesto di un backlink fa **l'opposto su tutt'e due i punti**: senza tetto, e
prodotto sempre — a tempo di parsing, per ogni link, e scritto su disco. Vicino
c'è anche il criterio dei tetti, la **decisione
[0094](../decisions/0094-un-tetto-che-si-fa-sentire.md)**: il tetto resta una
costante Rust e non entra nel contratto, ma chi lo supera deve saperlo — e un
contesto tagliato con l'ellissi lo dice da sé. E dove la regola vada scritta lo
dice la **decisione [0020](../decisions/0020-le-regole-in-un-posto-solo.md)**:
`fub-abi::rules`, così il provider WASM di M5 la eredita invece di reinventarla.

**5. Reversibile?** **Il campo no, la politica sì.**
`Link.context: option<string>` è nel WIT congelato: non si toglie. Ma *quanto* ci
si mette non è nel contratto — nessuna riga del WIT lo dice — quindi la scelta
sta dentro `fub-abi::rules` più il provider, e si cambia domani. **Con
un'eccezione**: se la regola resta implicita, a M5 ogni provider di terzi ne
inventa una sua, e allora la politica diventa di fatto irreversibile perché sono
N. Scriverla nelle `rules` è ciò che la tiene reversibile.

**6. La raccomandazione: (b), col numero della ricerca, e la regola in
`fub-abi::rules`.** Una finestra di **220 caratteri** intorno al link — lo stesso
numero di `SNIPPET_CHARS`, e in un posto solo, non due. Tre argomenti. Primo, *il
secondo chiamante la eredita gratis*: la regola sta nelle `rules`, il provider
WASM di M5 la chiama come la chiama il markdown nativo, e la ricerca e i backlink
smettono di avere due idee di quanto sia un estratto. Secondo, **la (a) mostra la
cosa sbagliata**: su un blocco da 195 KB il tetto in testa taglia prima del link,
e la riga che l'utente legge non contiene il riferimento — è l'unica differenza
fra le due che l'utente vede. Terzo, **la (c) è più pulita e si scarta per una
ragione sola**: sposta il costo dall'indice alla lettura, e il pannello backlink
si ridisegna a ogni cambio di documento, cioè in un punto in cui oggi non c'è
I/O. La (b) lascia il costo dov'è e lo rende proporzionato: 4.367 link × ~220
byte ≈ **960 KB** invece di 54 MB, l'1,8% di oggi.

**7. Che cosa resta rotto se non si decide.** Un `entries.json` di 16,6× il
vault, riletto e riscritto per intero a ogni apertura; 203 KB mediani, fino a
1,5 MB, attraverso l'IPC a ogni cambio di nota per disegnare righe da 80
caratteri; e — la parte che non si vede — **a M5 la politica si moltiplica per il
numero dei provider**, perché non è scritta da nessuna parte.

*Quello che si diceva e che non regge.* Il contesto mediano non è 297 byte ma
**341**; il massimo non è 192.140 ma **195.738**; «il 93% dell'indice da un
documento» è **94,5%** di `entries.json` e **96,2%** dei byte di contesto. «Il
contesto potrebbe non essere mai usato» è falso: è mostrato, ma su una riga sola
troncata dal CSS. «Un `Arc<str>` condiviso ripara `entries.json`» è falso: è
JSON, si serializza N volte lo stesso. E il copia-per-link **non è il difetto
nuovo**: esisteva già prima di `53b7817` come `link.context = Some(ptext.clone())`
dentro il solo ramo `Paragraph`, e quel commit l'ha sollevato a tutti i blocchi.
Ciò che resta come difetto è la **tripla copia in RAM** lungo la catena
`DocMeta.links` → `LinkRef` → `BacklinkRef`, cioè il difetto `0110`; **quanto**
testo sia è questa voce.

---

### 25.5 Quando la cartella di configurazione non si può scrivere

*aperta · strato **kernel** · **P1***

**1. La domanda.** Quando la cartella di configurazione esiste ma non si può
scrivere, Fub parte in sola lettura dichiarandolo, si rifiuta di partire, o parte
e perde lo stato senza dirlo?

**2. Che cosa si osserva oggi, misurato.** La risposta è già scritta — e dice che
non è stata presa. `crates/fub-host/src/config.rs:172-184`, testualmente:

> *«Il marcatore dice dove, non dice che ci si possa scrivere … Cosa fare in quel
> caso — ripiegare sul profilo dell'utente, lavorare in memoria, o rifiutarsi di
> partire — è una **scelta di prodotto e non è stata presa** … Ciò che è deciso è
> che **non si tace**.»*

Binario di HEAD, `FUB_CONFIG_DIR=/usr/lib/fub-config-prova` (non scrivibile):
**parte, in memoria, senza panico**, ed emette **un solo** avviso, su `stderr`,
dal bootstrap del log:

```
WARN fub.host log: '…/logs/fub.log' non si apre: Permission denied (os error 13).
Il log di questa sessione va su stderr. Se '…' non è scrivibile non si salveranno
nemmeno le impostazioni della macchina, il registro dei vault e lo stato di vista …
```

`ls` conferma che non è stato creato niente. **Nessun test esiste** per una
cartella presente-ma-non-scrivibile: i due banchi vicini (`config.rs:256`,
`log.rs:681`) iniettano il guasto come *un file al posto di una cartella*, e
`config.rs:242-246` dice esplicitamente che il `chmod` non si usa.

**Il numero che decide: quattro file, undici specie di stato.** Impostazioni
macchina (`log.level`, `log.verbose`, `fub-host/src/settings.rs:416`); vault
conosciuti e recenti (tetto 20, `vaults.rs:48`, `session.rs:731`); preferiti
(`session.rs:799`); nome e icona per vault (`session.rs:809`); `keys_seen`
(`session.rs:1257`); layout finestra e pannelli
(`frontend/src/state/layout.ts:413,428`); cartelle espanse
(`frontend/src/state/store.ts:163`); spazio attivo (`store.ts:164`); cronologia
note e ricerche (`frontend/src/state/recenti.ts:66,187,198`); stato di vista dei
provider (`fub-features/src/tags.rs:170`); il log della sessione. **Undici
derivati, zero originali**: bozze, tema, scorciatoie, versioni, indice, journal,
cestino e sidecar dell'organizzazione stanno tutti **dentro il vault**. Ed è
questo che decide la forma. E c'è un secondo ramo che tace del tutto: se la
cartella è **assente**, `config.rs:147` non emette nemmeno quella riga, e si
perdono le stesse undici cose. Zero banchi.

**3. Le forme, e chi paga.**

- [ ] **(a) Sola lettura dichiarata.** Si parte, si scrive una volta sola nel
      canale visibile (`Event::Trouble`, `Severity::Warning`), e da lì in poi
      ogni scrittura fallisce in silenzio *perché è già stato detto*. **Paga
      l'utente**, con un avviso all'avvio e uno stato non ricordato. È l'unica
      forma che rende il difetto scopribile.
- [ ] **(b) Rifiutare di partire.** **Paga l'utente in ogni scenario**: un
      chiosco, una home di rete montata a metà, un disco pieno passeggero
      diventano tutti «Fub non si apre», per perdere il layout dei pannelli.
      Contraddice la riga scritta a `config.rs:40-45`: «*Perdere il tema è meglio
      di un'app che non parte*».
- [ ] **(c) Ripiegare** su `~/.config/fub` quando il marcatore portable punta a
      una cartella non scrivibile. **Paga chi ha voluto l'installazione
      portable**: lo stato finisce su una macchina invece che sulla chiavetta,
      che è il contrario di ciò che «portable» promette. È la forma nominata e
      non scelta a `config.rs:178-181`.

**4. Che cosa il repo ha già deciso qui vicino.** La **decisione
[0062](../decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md)** dà il
criterio esatto — *il log è il pavimento, l'evento è la porta* — e dice che
`StderrSink` vale quando manca il `config_dir`: oggi il **pavimento** c'è e la
**porta** manca. La **decisione
[0052](../decisions/0052-cio-che-va-storto-e-un-evento.md)** dice quale severità:
un derivato perso è `Warning`. Le **decisioni
[0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md)** e
[0037](../decisions/0037-lo-stato-di-vista.md) hanno già scritto la regola
gemella per il file *illeggibile* — «non lo si sovrascrive» — che è un altro
caso. La **decisione
[0076](../decisions/0076-le-impostazioni-vivono-nel-vault.md)** è il motivo per
cui tema e scorciatoie sono nel vault e quindi salvi, ed è ciò che fa «undici
derivati, zero originali». La **decisione
[0001](../decisions/0001-supply-chain-e-sbom.md)** è perché non c'è nessun crate
`dirs`/`directories` e il calcolo sta tutto in `config.rs:46`. In `docs/` non c'è
niente: i `read-only` di `FEATURES.md:197,291,2515` sono caselle future sul
*vault*, e `glossario.md:405` è la sandbox dei plugin.

**5. Reversibile?** Sì, tranne un pezzo: la scelta fra (a) e (c) cambia **dove
finiscono i byte** di un'installazione portable, e un utente che ha già dello
stato nella cartella accanto all'eseguibile lo vedrebbe smettere di essere letto.
Il resto — quale severità, quale canale — si cambia domani.

**6. La raccomandazione: (a), e non (c).** Il conto è undici derivati contro zero
originali: il danno è «Fub non si ricorda com'era», e nessun danno di quella
taglia giustifica né un'app che non parte né un ripiego che tradisce la promessa
di «portable». Ciò che manca non è un meccanismo, è **una porta**: la riga di
`stderr` esiste già e va duplicata in un `Event::Trouble` alla prima scrittura
fallita, una volta per sessione. E il ramo in cui `config_dir()` è `None` deve
dire la stessa cosa: perde le stesse undici, e oggi tace.

**7. Che cosa resta rotto se non si decide.** Tre incoerenze che nessuno può
risolvere senza la scelta: lo stesso guasto risale come `PluginError::Io` per il
registro vault, `PluginError::Internal` per le impostazioni macchina e `String`
nudo per lo stato di vista; arriva alla shell come `"guasto"` per le impostazioni
(`frontend/src/panels/settings.ts:433`) e come `"info"` per il layout
(`frontend/src/state/store.ts:210`); e chi lavora su un chiosco non ha modo di
sapere perché Fub dimentica tutto a ogni avvio.

*Quello che si diceva e che non regge.* Che il caso fosse coperto dalle decisioni
0036/0037: quelle riguardano il file **illeggibile**, non quello non scrivibile.
E il precedente storico va letto al contrario di come sembra: il commit `9a58184`
ha tolto da `docs/todo.md` la riga «`0077 | portable_dir` non verifica di essere
scrivibile» — il difetto è stato chiuso, e la domanda di prodotto è rimasta
aperta dentro un commento.

---

### 25.6 Chi paga la latenza di una scrittura fatta dentro un comando IPC

*aperta · strato **shell** · **P2***

**1. La domanda.** Un comando IPC che scrive su disco può tenere un lucchetto
condiviso da tutti i vault per il tempo di un `fsync`, o quella scrittura va
spostata — e se sì, accodata nella shell o tolta dal thread dell'IPC?

**2. Che cosa si osserva oggi, misurato.** `ViewStates::muta` prende
`self.vaults.write()` e lo tiene per tutto `update_atomic`: `flock`, rilettura,
fusione, riscrittura atomica con `sync_all()` sul file **e** sulla directory.
Costo di una `set`, su filesystem vero (`ext`, non tmpfs):

| vault / cartelle | taglia del file | tempo |
|---|---|---|
| 1 / — | 2,4 KB | **2,561 ms** |
| 5 / 30 | 20 KB | **2,792 ms** |
| 20 / 80 | 137 KB | **5,036 ms** |

Dominato dall'`fsync`, non dalla fusione: il file cresce di 57× e il tempo di 2×.
*Chi ripete la misura in `/tmp` sottostima di ~50×: è tmpfs, e `sync_all()` lì è
quasi gratis.*

Frequenza: `cambiato()` (`frontend/src/state/layout.ts:426`) ha **8 siti di
chiamata**, tutti gesti **discreti** — nessun gesto continuo. Due amplificazioni
vere: `fuocoSu` scrive **a ogni click su un riquadro**, e `togliDappertutto`
chiama `chiudiTab` in ciclo, cioè **una scrittura per tab**. E il caso peggiore
non è `set_view_state`: è `Host::set_setting_for_user` /
`reset_setting_for_user` (`session.rs:1082`, `:1100`), che prendono il prestito
**esclusivo** e ci attraversano una scrittura su disco, mentre i quattro fratelli
(`session.rs:1507`–`1565`) prendono `read()`.

**3. Le forme, e chi paga.**

- [ ] **(a) Accodare nella shell** — una `Coda` davanti a `scriviStato`, che
      coalesce per chiave. Una riga in `store.ts`, non rompe niente. **Paga chi
      mantiene la shell.** Ma non è una scelta libera:
      `frontend/src/ui/corsa.ts` scrive già che quando il lavoro *deve arrivare*
      — «**una scrittura su disco**, una mutazione del layout» — la risposta è
      **accodare**. Non riduce il tempo in cui il lucchetto è preso: riduce
      quante volte lo si prende.
- [ ] **(b) Togliere la scrittura dal thread IPC** — `spawn_blocking`, o comandi
      `async`. Costa una **seconda convenzione di chiamata** su una superficie
      tenuta deliberatamente a elenco chiuso e omogeneo; da quel giorno «il
      comando è sincrono o no?» è una domanda che ogni comando nuovo deve porsi,
      e `dieta_ipc.rs` non la vede. **Paga chi scriverà il 38° comando.**
- [ ] **(c) Restringere ciò che il lucchetto copre** — un file per vault. Costa
      un **cambio di formato su disco** con migrazione, e la proprietà che `muta`
      dichiara nella propria prosa («due finestre di Fub aperte insieme
      depositano scroll di esemplari diversi») resterebbe vera solo per vault.
      **Paga l'utente**, una volta, alla migrazione.

**4. Che cosa il repo ha già deciso qui vicino.** La **decisione
[0133](../decisions/0133-chi-ascolta-nomina-fino-a-quando.md)** e `corsa.ts`:
una scrittura su disco si **accoda**, non si scarta — e il presidio
`check-corse.mjs` esiste già. Vincola la (a). La **decisione
[0057](../decisions/0057-la-dieta-dell-ipc.md)** («La dieta dell'IPC»): elenco
chiuso, e ogni comando nuovo porta la ragione per cui non poteva essere altro. È
l'argomento contro la (b).

**E il codice ha già deciso metà della domanda**: `set_view_state`
(`crates/fub-app/src/lib.rs:680`) prende il prestito condiviso *di proposito*,
con la ragione scritta accanto — «*prendere qui quello esclusivo del workspace
bloccherebbe chi legge per il tempo di una scrittura su disco — per salvare uno
scroll*». Quella frase è la regola; `set_setting_for_user` non la applica, ed è
il difetto `0138`.

**5. Reversibile?** (a) e (b) sì, stanno dentro un modulo. **(c) no**: è un
formato su disco, e vuole una migrazione e un `SchemaVersion`.

**6. La raccomandazione: (a); non (b); non (c) adesso.** La (b) compra 2,5–5 ms
su una chiamata che nessuno aspetta e che l'utente non vede, e paga con una
seconda convenzione su una superficie che il repo tiene omogenea per decisione.
La prova che decide — *il secondo chiamante la eredita gratis?* — dà **no**: il
38° comando non eredita niente, deve scegliere. La (a) è già decisa dalla
decisione 0133 e costa una riga; il suo valore vero è su `togliDappertutto`. La
(c) risolve la cosa giusta al prezzo sbagliato, finché la misura è 5 ms su 137 KB
con 20 vault, che è già il caso limite. Ciò che il verbale deve fissare è **il
numero e la soglia**: si accetta il lucchetto di macchina finché il file resta
sotto una certa taglia, e quel giorno si riapre la (c).

**7. Che cosa resta rotto se non si decide.** Chi clicca fra riquadri paga 2,5–5
ms di lucchetto condiviso per click e non lo vede; `fuocoSu` fa un `fsync` per
ogni click; e chi scriverà il 38° comando non trova scritto da nessuna parte se
possa scrivere su disco dentro l'IPC.

*Quello che si diceva e che non regge.* Il **difetto 0073** è sbagliato due volte:
«a ogni scroll» è falso — `grep -rn "scrollTop" frontend/src` non trova niente,
la shell non persiste nessuno scroll — e «`set_view_state` prende il lock
esclusivo» è falso, prende `ws.read()`, con tre righe di commento sopra che
dicono perché; e il suo ancoraggio `lib.rs:645` è scaduto, la funzione sta a
`crates/fub-app/src/lib.rs:680`. «Il lucchetto è a livello di macchina invece che
per vault» è vera come fatto e falsa come diagnosi: il **file** è uno per config
dir (`session.rs:426`), quindi lucchetto e file hanno la stessa ampiezza, e
restringerlo è un cambio di formato e non una correzione di granularità.
«Qualcuno aspetta quel `Result`» è falso: `store.ts::scriviStato` è
`void … .catch()`. Regge invece il **difetto 0038**: 37 comandi registrati, 0
`async` — e il `grep` grezzo che ne dà 39 cade nella trappola già misurata dalla
decisione 0057, perché due sono prosa.

---

### 25.7 Dove stanno i byte di un `kind` di terzi

*aperta · strato **contratto** · **P2***

**1. La domanda.** Un `kind` di terzi può dichiarare **dove stanno i suoi byte**,
o deve indovinare la chiave che il provider di ripiego campiona?

**2. Che cosa si osserva oggi, misurato.** `CARICHI` (`fub-abi/src/model.rs:1003`)
è una tabella `pub const` di **12 righe**, tutte di core. `carico()` ha **tre**
lettori in tutto il workspace (`render.rs:292`, `serialize.rs:397`, `:495`). Il
ramo `None` della degradazione generica campiona **tre** chiavi cablate,
`fub-format-markdown/src/render.rs:290`:

```rust
None => ["html", "source", "text"].into_iter().filter_map(testo).find(|s| !s.is_empty()),
```

L'esempio preciso: un plugin registra `SyntaxTrigger::Fence { info: ["spoiler"] }`,
`produces: ["terzi:spoiler"]`, e la sua `apply` rende
`SyntaxProduct::Block { custom_kind: "terzi:spoiler", attrs: {"corpo": "…"} }` —
chiave `corpo`, scelta sua, perché **niente nel contratto gli dice quale usare**.
Se non registra un `CustomRenderer`, o se il suo renderer torna `Fallback` o va in
panico (`fub-kernel/src/renderer.rs:288`), `carico("terzi:spoiler")` è `None`, il
campione di tre chiavi non contiene `corpo`, e il blocco esce come **un `<div>`
vuoto**: il testo dell'utente non è a schermo. L'unico log è `mount.rs:413` («non
ha un renderer»), che non nomina la causa vera. Rinominare la chiave in `source`
lo fa funzionare.

Conseguenza viva: **una**, un `<div>` vuoto in un percorso di ripiego.
Conseguenze immaginate e cadute: **tre**. Esercizio del caso nel repo: **zero** —
`fub-sdk/src` non nomina mai `SyntaxRule`, e i due `examples/` nemmeno.

**3. Le forme, e chi paga.**

- [ ] **(a) Un campo in fondo a `syntax-rule-spec`** (`carichi: list<carico>` più
      un `variant carico`), consultato da `render.rs:290` prima del campione.
      **Paga chi scrive il contratto**: un tipo nuovo, additivo, per sempre.
      Compra: chi scrive un plugin dichiara la propria chiave invece di
      indovinarla.
- [ ] **(b) Dichiarare la convenzione invece del campo**: scrivere in
      `docs/architecture/plugin-boundary.md` e nel doc del WIT che la chiave del
      carico **è `source`**, e togliere `html` e `text` dal campione. **Paga chi
      ha già scritto un plugin** con un'altra chiave, cioè oggi nessuno. Costo
      zero nel contratto.
- [ ] **(c) Niente**, e il limite resta prosa in tre file. **Paga il primo terzo
      che ci sbatte**, con un sintomo muto.

**4. Che cosa il repo ha già deciso qui vicino.** La **decisione
[0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)** ha reso
`produces` un contratto e non una nota. La **decisione
[0021](../decisions/0021-il-confine.md)** (§7.1-7.6) elencava a `:222` proprio
`produces` fra i nomi «non guardati da niente». La **decisione
[0122](../decisions/0122-una-sorgente-non-degrada-si-rifiuta.md)** governa il ramo
`None` — «*una proiezione degrada, una sorgente si rifiuta*» — e ha **già
scartato** la soluzione ovvia, cioè gli `attrs` verbatim timbrati dal kernel. La
**decisione [0115](../decisions/0115-la-verita-e-la-dichiarazione.md)** (§4.4) è
il precedente della forma identica: `SyntaxForm` ha aggiunto una *forma
dichiarata* accanto ai *nomi dichiarati*. E la **decisione
[0002](../decisions/0002-additivita-del-contratto.md)** è quella che rende un
tipo nuovo caro per sempre. Nessun verbale copre `CARICHI`: è nato col commit
`159b7ca`, che ha chiuso un difetto senza verbale.

**5. Reversibile?** Non come si temeva. `CARICHI` **non è nel WIT**, e aggiungere
un campo **in fondo** a `syntax-rule-spec` è additivo per la regola scritta del
repo — `fub-abi/tests/wit_additivity.rs:31`: «record | un campo **in fondo** |
rinominare, ritipare, riordinare, togliere» — quindi la (a) **non ritaglia** il
congelato. Irreversibile è solo il **nome e la forma del `variant carico`**. La
(b) è interamente reversibile.

**6. La raccomandazione: (b) adesso, (a) quando il primo terzo lo chiede.**
L'asimmetria è reale ma il suo raggio è **un** `<div>` vuoto in un percorso di
ripiego, e nessun `kind` di terzi porta oggi carichi: spendere un tipo nel
contratto per un caso che nessuno esercita è esattamente ciò che la decisione
0002 rende caro per sempre. Ciò che costa zero e toglie il 100% della sorpresa è
**dichiarare la chiave**: il campione a tre chiavi è una regola non scritta, e la
regola di questo repo è che una regola non scritta è un difetto.

**7. Che cosa resta rotto se non si decide.** Un plugin che nomina il proprio
carico `corpo`, `body` o `content` rende un blocco vuoto senza nessun messaggio
che spieghi perché, e l'unico modo di scoprirlo è leggere `render.rs`. Il
presidio che manca è un banco `terzi:*` che passa dalla degradazione generica
invece che dal proprio renderer.

*Quello che si diceva e che non regge.* «C'è un'asimmetria fra `CARICHI` e
`SyntaxRuleSpec::produces`»: **mal detta** — `produces` (`fub-abi/src/custom.rs:115`)
è **simmetrico**, i terzi lo riempiono come il core
(`fub-features/tests/custom_blocks_e2e.rs:263` = `["terzi:gantt"]`); ciò che è
core-only è `CARICHI`, e le due cose dichiarano cose diverse: `produces` dichiara
**nomi**, `CARICHI` dichiara **posizione del carico**. «Qualcosa a valle — indice,
ricerca, backlink — lo indovina o lo ignora»: **falso, provato** —
`SyntaxRegistry::apply` (`fub-kernel/src/syntax.rs:281`) muta **solo `body`**, la
ricerca indicizza `DocumentModel::text` prodotto dal provider prima che una regola
giri, i backlink leggono la tabella piatta `links`, e nessuno cammina
`Block::Custom`. «Se la forma tocca il WIT la scelta non è reversibile»: **falso
per questo caso**, come sopra. E il rifiuto del serializzatore
(`serialize.rs:412`) **non** è la lacuna: `Some(Carico::Corpo(_))` e `None` stanno
nello **stesso braccio del match**, quindi ogni `kind` di core prodotto da una
regola sintattica è rifiutato identicamente a uno ignoto.
