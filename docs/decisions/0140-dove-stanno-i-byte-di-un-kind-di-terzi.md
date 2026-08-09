# 0140 — Dove stanno i byte di un `kind` di terzi

**Stato**: accolta
**Data**: 2026-08-09
**Chiude**: §25.7
**Commit**: *(questo commit)*

---

> **Questo verbale `0140` non è il difetto `0140`** (`docs/todo.md`, la
> normalizzazione NFC di `canonical_tag`, `canonical_anchor`, `heading_slug` e
> `prefix_len_ci`). Condividono numero, crate e file — `fub-abi`, `model.rs` —
> per la sovrapposizione dichiarata a `docs/todo.md:569-573`: verbali e difetti
> occupano lo stesso spazio di numeri di proposito, e «chi ne cita uno dice
> quale delle due». Non hanno niente in comune: il difetto riguarda quattro
> regole di identità di un nome e la loro NFC, questo verbale riguarda dove un
> `custom_kind` di terzi tiene i propri byte. La regola obbliga chi cita a
> disambiguare; chi il numero lo **crea** è il primo citante, e disambigua qui.

La §25.7 chiedeva se un `kind` di terzi può dichiarare **dove stanno i suoi
byte**, o deve indovinare la chiave che il provider di ripiego campiona. La
risposta è la **forma (b)** che la voce stessa raccomandava: una convenzione
dichiarata, non un campo nel contratto.

## La decisione

**La chiave del carico di un `custom_kind` di terzi è `source`.** Sta scritta
in un posto solo — `fub_abi::rules::carichi`, con `CHIAVE_DEL_CARICO` e
`carico_testuale` — e la resa generica del provider la chiede al contratto
invece di campionare: il ramo `None` di `render.rs` non ha più le tre chiavi
cabalate (`html`, `source`, `text`), chiama la regola come la chiamerà il
provider WASM di M5 (decisione 0020). La stessa riga è nel doc del WIT accanto
a `block-custom` (un commento: gli `attrs` sono `json` libero, quindi
l'additività non si tocca) e in `docs/architecture/plugin-boundary.md` — i tre
posti in cui chi scrive un plugin cerca la risposta.

**`CARICHI` non cresce, e non può crescere**: la tabella è *tutti e soli* i
kind del core, e il conto a due versi di `ogni_kind_dichiara_cosa_porta` (il
controllo dei fantasmi, `model.rs:1514-1524`) rifiuta la riga che non nomina
una `const`. La domanda che la voce poneva come scelta («la tabella cresce o la
regola sta altrove?») non era una scelta: il repo l'aveva già decisa, e il
presidio la decide da sé.

**Il campione a tre chiavi esce dal renderer.** L'ordine contava (con `html` e
`source` presenti vinceva `html`, per puro ordine alfabetico); adesso è una
non-domanda. `html` e `text` si tolgono: un campione che aggira la convenzione
la rende una preferenza, e «farne una quarta stringa non renderebbe il quinto
caso». Chi paga: un plugin scritto con un'altra chiave, cioè oggi nessuno — e
le due fixture del repo che usavano `text` su kind di terzi
(`lib.rs` e `parsed_model_e2e.rs`) sono migrate a `source` nello stesso
commit, perché altrimenti sarebbero diventate mute in silenzio.

**Il banco, nei due versi.** `un_kind_di_terzi_degradato_mostra_i_byte_della_chiave_convenzionale`
(`fub-features/tests/custom_blocks_e2e.rs`): un `terzi:*` senza renderer passa
dalla degradazione generica, e la resa deve mostrare i byte sotto `source` e
**non** sotto un'altra chiave. Provato rosso nei due versi: chiave rinominata
in produzione → `<div class="block-terzi:convenzione"></div>`; campione
riallargato a `["html","text","source"]` → `<div class="block-terzi:convenzione">TESTO-SBAGLIATO</div>`.
È il banco che la voce §7 dichiarava mancante — e che esisteva già a metà:
`da_un_renderer_non_fidato` faceva già passare un `terzi:*` dalla degradazione
generica, ma asseriva solo la classe. Manca era l'asserzione, non il percorso.

## Cosa si è scartato, e perché

- **La (a) — un campo `carichi` in `syntax-rule-spec`** — si rimanda, e resta
  come casella di questa voce. L'innesco è osservabile, non un'impressione:
  **il primo `custom_kind` di terzi che ha bisogno di dichiarare il proprio
  carico invece di seguire la convenzione** — cioè un plugin che deve dire
  *dove* tiene i byte (più di una chiave, una chiave che non è `source`,
  carichi in più punti) e per cui la convenzione è una limitazione, non una
  risposta. L'innesco è quello e non un altro perché la (a) è additiva ma si
  paga **per sempre** (decisione 0002: il nome e la forma del `variant carico`
  non si ritirano), quindi il prezzo si paga quando qualcuno lo chiede davvero,
  non prima: un tipo nuovo nel contratto per un caso che nessuno esercita è
  esattamente ciò che 0002 rende caro. La convenzione costa zero e toglie il
  100% della sorpresa di oggi; quando l'innesco scatta, il campo si aggiunge in
  coda (additivo per la regola di `wit_additivity.rs`) e la convenzione resta
  come degrado.
- **La (c) — niente** — non si fa: il campione era una regola non scritta, e la
  regola di questo repo è che una regola non scritta è un difetto.
- **Un `Event::Trouble` dal render** — non si fa, e il motivo è strutturale,
  nella forma della casella della 0052: il punto che vede il guasto
  (`fub-format-markdown`, dentro la resa) non ha il workspace né il bus degli
  eventi fra le mani, e darglielo vorrebbe dire dare un esito a
  `DocumentStore::parse` e ai suoi otto chiamanti. Una porta dal render sarebbe
  la seconda convenzione accanto a quella dell'avvio che la §25.5 sta scrivendo
  in questo stesso giro.
- **Una `tracing::warn!` nel ramo del degrado** — si rimanda: costa una
  dipendenza nuova a un crate che deliberatamente non ce l'ha (0062: la
  facciata del log sta nel kernel), e un `warn!` per render è un generatore di
  rumore senza freno. È una decisione strutturale che merita il suo verbale,
  non una coda di questa.
- **Il silenzio a runtime resta, e si dichiara**: un terzo che porta i byte
  sotto un'altra chiave si rende vuoto, e la resa generica è il degrado che la
  0122 sanziona — non una perdita (i byte stanno nel modello e su disco), e
  per la 0062 la porta è per le perdite.

## Le premesse cadute, col perché sembravano vere

1. **«Zero banchi rossi» non era una rassicurazione, era la diagnosi.** Nessun
   banco asseriva l'esito del ramo del campione: le due fixture che lo
   attraversavano (`lib.rs`, `parsed_model_e2e.rs`) asserivano classi e
   capacità, non contenuto, e dopo la (b) sarebbero diventate mute in
   silenzio. Provato: riportata la fixture a `text`, il banco resta verde
   mentre l'inline rende vuoto. Sembrava rassicurante perché «nessun banco
   diventa rosso» suona come «nessun comportamento cambia», e non lo è. È la
   lezione di metodo: **un presidio che resta verde mentre il comportamento
   cambia è peggio di un presidio assente, perché autorizza** — e la si vede
   solo rompendo, non leggendo.
2. **«`CARICHI` cresce di una riga o la regola sta altrove» sembrava una
   scelta** — la voce la poneva come tale. Non lo era: il controllo dei
   fantasmi di `ogni_kind_dichiara_cosa_porta` rende rossa la riga che non
   nomina una `const` del core. Sembrava una scelta perché il presidio non si
   legge nella voce, si legge nel test — e prima di scegliere la forma si
   chiede se un presidio l'ha già scelta.
3. **Il commento di `render.rs:287-289` argomentava contro la (b)** — «sostituirlo
   con "niente" toglierebbe la resa a `terzi:spoiler` che oggi funziona». Chi
   legge un commento che ragiona controlla il ragionamento e non il fatto: la
   (b) non è «niente», è la chiave dichiarata, e chi la segue rende come prima.
   Il commento è stato riscritto nella stessa passata.
4. **La premessa era in tre copie, non una** — il commento di `render.rs`, la
   voce, e `docs/architecture/data-model.md:506-508` («col `text` degli
   `attrs` per un inline»). Tre copie che nessuno teneva allineate: è la stessa
   diagnosi del difetto che `CARICHI` era nato per chiudere, riprodotta sulla
   convenzione che lo sostituisce.
5. **«`carico()` ha tre lettori» erano quattro** — il quarto è il test
   `ogni_kind_dichiara_cosa_porta` (`model.rs:1500`), che conta i kind e chiede
   a `carico()` la risposta. Sembrava vero perché il conteggio guardava i
   chiamanti di produzione e il test non sembra un chiamante.
6. **Il silenzio a runtime resta, e si dichiara** nella forma della 0052: chi
   vede il guasto non ha il bus fra le mani, e aprire una porta dal render
   sarebbe la seconda convenzione accanto a quella dell'avvio che un'altra
   unità sta scrivendo nello stesso giro. Sembrava un residuo riparabile
   perché «ciò che va storto è un evento» (0052) — ma la 0052 dichiara la
   casella dei punti che non hanno il workspace, e il render è uno di quelli.
7. **La sovrapposizione dei numeri produce collisioni di superficie, non solo
   contabili.** Questo verbale `0140` e il difetto `0140` (la NFC di
   `canonical_tag`/`canonical_anchor`/`heading_slug`/`prefix_len_ci`)
   condividono numero, crate e file — `fub-abi`, `model.rs` — e la regola
   dichiarata a `todo.md:569-573` («chi ne cita uno dice quale delle due»)
   prevede la sovrapposizione ma non l'attenua. Sembrava un inconveniente
   contabile già assorbito dal repo, perché l'esempio che la regola cita
   (`0115`) disambigua da solo: lì decisione e difetto stanno in posti
   diversi, e il contesto basta. Qui no: chi trova «0140» accanto a `model.rs`
   non ha modo di sapere quale dei due sta leggendo. Il fatto è dichiarato in
   testa a questo verbale; una riparazione non è di questa voce.

## Nota per chi verrà

`docs/todo.md:41-42` diceva «Centotrentanove sono chiuse» mentre
`[conta: verbali]` contava centotrentotto: la prosa era avanti di uno **già a
HEAD**, e la chiusura di questa voce la rende vera **per caso**. Un numero che
diventa giusto per coincidenza è più pericoloso di uno sbagliato: nasconde il
fatto che nessuno lo presidia. È detto qui, e non presidiato — un'altra unità
ha già scritto la riga di difetto su questo, e una seconda riga sarebbe una
duplicazione.

## Cosa resta scoperto

- **Il silenzio a runtime** di un plugin che non segue la convenzione: dichiarato
  (sopra), non riparato — la porta non arriva al render per struttura, e il
  pavimento (`tracing` in `fub-format-markdown`) è rimandato a un verbale suo.
- **La forma (a)** resta aperta come casella, con l'innesco osservabile scritto
  sopra (il primo `kind` di terzi che deve dichiarare il proprio carico).
- La **prosa del WIT** e di `plugin-boundary.md` dicono la convenzione; il WIT
  come contratto non la conosce (gli `attrs` sono `json`): è la scelta della
  forma (b), e resta vera finché la (a) non nasce.
