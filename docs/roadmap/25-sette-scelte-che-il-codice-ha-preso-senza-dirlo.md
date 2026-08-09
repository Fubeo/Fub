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

*chiusa dalla [0136](../decisions/0136-una-regola-di-identita-di-un-nome-si-dichiara.md) · strato **contratto** · **P1***

**Com'è finita, e cosa lascia.** La voce chiedeva se una regola nuova di «quando
due nomi sono lo stesso nome» si dichiara o nasce in silenzio, e la risposta è la
**forma (a)** che la voce stessa raccomandava: un **conto sulle sorgenti** —
`crates/fub-abi/tests/una_regola_di_nome_si_dichiara.rs` — che pretende
**famiglia e ragione** per ognuna delle regole in produzione, e diventa rosso
sotto `cargo test` a chi ne aggiunge una senza dichiararla. La **(b)**, una porta
`fub_abi::rules` esclusiva, **non si fa**: risponde a una domanda che quattro
verbali hanno già chiuso con un no, ed è irreversibile perché WIT-adiacente.

Il numero misurato dal censimento — 44 regole per la stessa domanda — *sembrava*
una duplicazione da unificare e **non lo era**: la duplicazione vera stava nella
**dichiarazione mancante**, non nelle regole. Il presidio è nato verde su
**quaranta** righe, ed è stato acceso rosso nei due versi (una regola non
dichiarata, una famiglia mentita). Il difetto `0142` — la piegatura scritta a
mano due volte nel rename — è stato riparato qui: adesso è `solo_il_caso`, che
chiama `resolution_key`. E tre righe di difetto che questa voce nominava sono
risultate **false**: `0070` (`İ` e `ẞ` sono le risposte giuste e deliberate),
`0093` sulla conseguenza (`heading_matches` è una disgiunzione: si rompe l'`id=`
HTML, non la risoluzione), `0018` sul posto (la scansione che si paga sempre è
nel ramo `Wiki`, ed è il difetto `0115`). Il dettaglio sta nel verbale.

Ciò che la (a) **non** fa è riparare una divergenza: restano aperti, come
difetti misurati e non come caselle, il `0115` (risolvere un wikilink scandisce
l'anagrafe), il `0140` (quattro regole senza NFC) e il `0141` (tre risposte
incompatibili a «sta dentro questa cartella?»). Le loro righe di allowlist li
nominano per numero invece di travestirli da ragione: una divergenza dichiarata
è più visibile di una taciuta, e resta una divergenza.

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

*chiusa dalla [0138](../decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md) · strato **contratto** · **P1***

**Com'è finita, e cosa lascia.** La risposta è la forma **(b)** che la voce
stessa raccomandava: il contesto di un backlink è una **finestra di 220
caratteri attorno al link**, ritagliata sul testo renderizzato del blocco che
lo contiene, con l'ellissi ai bordi dove taglia — e il link non si taglia mai,
perché è il riferimento di cui la riga parla. La regola sta in
`fub-abi::rules::snippet` (`window(testo, intervallo) -> String`), così il
provider WASM di M5 la eredita invece di reinventarla (0020), e il tetto resta
una costante Rust fuori dal contratto, visibile quando morde e mai
interrogabile (0094): il WIT continua a dire `context: option<string>`, e la
(b) ci mette meno byte dentro. Il numero è lo stesso dello snippet di ricerca:
`SNIPPET_CHARS` è migrata da `fub-features/src/search.rs` (oggi
`search.rs:1195` per tantivy, `:1218` per `head_of`) in un posto solo, e la
ricerca e i backlink smettono di avere due idee di quanto sia un estratto. Il
parser registra la posizione di ogni link nel testo renderizzato del blocco —
che non esisteva da nessuna parte, ed è il costo che la voce non contava — in
un contenitore unico che non può disallinearsi, e il trim passa dopo il
ritaglio. Con la voce si chiude il difetto `0110`, come «vera e trascurabile,
detta coi numeri» e non come «riparata con la fetta condivisa»: le copie della
catena restano strutturalmente — sono **due copie e una move**, non tre, e la
riga non contava né il clone del render né il disco — ma ognuna scende da una
mediana di 341 byte (massimo 195.738) a ≤222 caratteri: 4.367 link × ≤222 ≈
**969 KB** invece di **53.994.565 byte**, l'1,8%. Le forme scartate: la (a)
taglia in testa e il link finisce fuori dall'ellissi; la (c) sposta il costo
dall'indice alla lettura e il pannello si ridisegna a ogni cambio di documento;
la (d) non ripara `entries.json`, che è JSON e si serializza N volte lo stesso.
Restano i fatti, non i difetti: `entries.json` è ancora riletto e riscritto per
intero a ogni apertura (0112 è un'altra riga), e il pannello attraversa ancora
l'IPC con `page: None` — ma con ≤222 caratteri per riga. Le premesse cadute
sono nel [verbale](../decisions/0138-una-finestra-di-220-caratteri-attorno-al-link.md),
con la più grossa che vale ripetere: il difetto non era la duplicazione, era la
dimensione.

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

*chiusa dalla [0137](../decisions/0137-una-scrittura-su-disco-dentro-un-comando-ipc-si-accoda-nella-shell.md) · strato **shell** · **P2***

**Com'è finita, e cosa lascia.** La risposta è la **forma (a)** che la voce
stessa raccomandava: una scrittura su disco dentro un comando IPC **si accoda
nella shell** — coalescendo per chiave, così due scritture della stessa chiave
accavallate diventano una scrittura sola con l'ultimo valore — e non si rende
`async` nel thread dell'IPC. La coda sta in `frontend/src/ui/corsa.ts`, accanto
a `Coda`, perché la erediti gratis chiunque: i chiamanti di `scriviStato` sono
**cinque** in tre moduli, e la premessa della voce che ne contava due era falsa.
La (b) si scarta per la [0057](../decisions/0057-la-dieta-dell-ipc.md) — una
seconda convenzione di chiamata rompe l'elenco chiuso — e la (c) resta chiusa
**fino alla soglia**: si accetta il lucchetto di macchina finché il file di
stato resta sotto la taglia misurata — 5,036 ms su 137 KB con 20 vault contro
2,561 ms su 2,4 KB, dominato dall'`fsync` e non dalla fusione — e quel giorno
si riapre la (c), che è l'unica forma irreversibile. Il «caso peggiore» che la
voce nominava — `set_setting_for_user` e `reset_setting_for_user` con il
prestito esclusivo del workspace — **non è un difetto aperto**: la ritrattazione
(`53972d4`) l'aveva già tolto come falso prima che questa voce si chiudesse,
perché il prestito esclusivo di `set_setting_for_user` non è lì per la scrittura
su disco ma perché scrivere un'impostazione rifà i recinti, pota il registro ed
emette, e i quattro fratelli che prendono il condiviso non fanno niente di tutto
questo. La voce originale lo citava ancora perché la ritrattazione aveva ripulito
la tabella senza toccare la voce che la nominava.

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
