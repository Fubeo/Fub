# 0108 — Una data la dichiara chi possiede il vault, e ciò che sembra una data si dice

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§23.7](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#237-una-data-scritta-come-la-scrive-lutente-non-è-una-data-e-non-cè-modo-di-dirlo)
**Commit**: *(questo commit)*

---

## La domanda

La [0003](0003-modello-del-documento.md) ha deciso che *«solo l'ISO-8601 a
larghezza fissa è una data»*, con l'argomento giusto: *«`2026-7-5` no: un parser
tollerante trasformerebbe in date le stringhe dell'utente»*. Chi ha visto un
foglio di calcolo convertire un codice prodotto in una data sa che è la regola
giusta, e va tenuta.

Il prezzo è dall'altra parte, ed è **il** caso d'uso: questa app si apre su
vault altrui, e un vault altrui porta le date come le ha scritte chi le ha
scritte — `2026-7-5`, `05/07/2026`, o il formato che un plugin Obsidian gli ha
messo per anni. Tutte restano `Text`, e la conseguenza non è un errore: è che il
filtro non trova, il raggruppamento non raggruppa, e **nessuno dice perché**.
Una proprietà che non è una data si comporta esattamente come una data che non
c'è.

## La nota di prodotto, che è il cuore della voce

Ciò che cambia **non è la tolleranza del parser**: è **chi dichiara il
formato**. Un formato dichiarato da chi possiede il vault non è un indovinello,
ed è la differenza esatta fra questa voce e la cosa che la 0003 ha giustamente
rifiutato. Il parser ISO non si tocca di una riga, si legge sempre e **per
primo**, e senza dichiarazione il comportamento di oggi resta identico byte per
byte: una dichiarazione **aggiunge** una lettura a stringhe che oggi cadono in
`Text`, e non ne cambia nessuna.

Le due risposte che la voce metteva in alternativa — impostazione del vault, o
schema per tipo nota — non si escludono, e la prima è il default della seconda:
questa decisione prende la prima e lascia la seconda dov'era, in `FEATURES 8.2`.

## Cosa la misura ha cambiato, prima di progettare

**La premessa che la voce dava per scontata è falsa, e non è un dettaglio di
collocazione.** La misura proponeva `locale.date-format` come **quinta riga** di
`locale_settings()`, «`SettingKind::Choice` come `hour-cycle`». La forma è
quella, la famiglia no. Le quattro chiavi `locale.*` hanno una proprietà che le
definisce tutte: **il sistema ha una risposta**, e il loro default è
[`AS_SYSTEM`](../../crates/fub-kernel/src/locale.rs). Qui la risposta del
sistema sarebbe **sbagliata per costruzione**: `05/07/2026` su una macchina
italiana è il cinque luglio e su una americana è il sette maggio, quindi lo
stesso vault, sincronizzato fra due computer, porterebbe **due date diverse per
lo stesso byte**. È precisamente il difetto che la
[0004](0004-il-grafo-e-i-link-non-wiki.md) ha rifiutato per i link — *il vault
sincronizzato fra macOS e Linux è lo stesso vault* — e la 0003 per il parser.

Il formato è un fatto **dei file**, non di chi guarda. Da qui tre conseguenze
che si tengono: la chiave è `properties.date-format` e non `locale.*`, il suo
default non è «come il sistema» ma **«solo ISO»**, e il livello è **vault** —
che qui non è l'inerzia della [0076](0076-le-impostazioni-vivono-nel-vault.md),
è l'unica scelta possibile, perché una chiave di macchina darebbe allo stesso
vault due significati su due computer. Non è `program_writable`: un componente
che potesse dichiarare il formato cambierebbe il valore di **ogni** proprietà
data di **ogni** nota, in silenzio e senza toccare un file.

**Il difetto peggiore stava fuori dalla voce per la nona volta di fila, e la
voce lo sottovalutava di una categoria.** La voce parla di filtro e
raggruppamento. Misurato, anche l'**ordinamento** degrada, e non «di più»: in
modo diverso. `compare` rende `None` per specie diverse e `order_of` lo mappa su
`Ordering::Equal`; su un vault misto — metà note ISO, metà no, cioè lo stato
normale di una migrazione — il comparatore che ne esce **non è un ordine**. Con
`2026-07-05`, `5/7/2026` e `1/1/2020`: la prima è `Equal` a entrambe le altre, e
le altre due si confrontano fra loro **come stringhe**, quindi `a == b`,
`a == c` e `b < c`. Un `sort_by` con un comparatore incoerente rende una
permutazione che nessuno ha deciso. Non è un ordine sbagliato riconoscibile: è
un ordine **plausibile**, ed è la forma peggiore in cui questa famiglia possa
rompersi. Stessa forma per `contains`, che su una `Text` fa sottostringa:
`contains("2026-07")` funziona su un vault non convertito e **non** su uno
convertito, cioè il comportamento si **inverte** a seconda del formato del
vault.

**La terza premessa era vera ma incompleta.** La voce dice che il segnale è caro
— `PropertyScalar::Text` non porta diagnosi, il canale verso la shell cancella
il tipo, un pannello proprietà non esiste. Vero, e per questo il segnale **non**
è un campo su un valore: è una **domanda che si fa**, e il posto dove si fa
esisteva già ed è lo stesso della [0107](0107-il-caso-di-una-lettera.md),
`IndexQuery::VaultHealth`.

## La decisione

**Uno.** `DateOrder` in `fub-abi::model` — `Dmy`, `Mdy`, `Ymd` — e
`DateFormats`, che è *ciò che questo vault dichiara*. Tre **ordini** e non un
formato con dei segnaposto (`%d/%m/%Y`): il separatore non è mai stato
l'ambiguità — `05/07/2026` e `05-07-2026` sono la stessa scrittura — mentre
`05/07/2026` e `07/05/2026` sono la **stessa stringa** letta da due parti del
mondo come due giorni diversi. È esattamente questo che nessun parser può
dedurre e che solo chi possiede il vault può dire, ed è il motivo per cui la
dichiarazione è una scelta fra tre righe e non una stringa di formato: una
stringa di formato chiederebbe all'utente di descrivere anche ciò che il parser
sa già.

`DateOrder::read` è rigido quanto `parse_iso_date`, su un insieme diverso: tre
campi numerici separati dallo **stesso** segno fra `/`, `-` e `.`, mese e giorno
a una o due cifre, e l'anno a **quattro** — `05/07/26` chiederebbe di indovinare
il secolo, e indovinare è la cosa rifiutata. `jiff` non entra: la
[0091](0091-un-orario-di-parete-non-e-un-intervallo.md) lo vincola a `fub-host`,
il parser sta in `fub-abi` che ha quattro dipendenze e un invariante scritto di
compilabilità a wasm32, e un parser di **formati dichiarati** è quattro righe di
confronto.

**Due.** `properties.date-format` (`SettingKind::Choice`, default `""` = solo
ISO), dichiarata in `fub-kernel/src/properties.rs` accanto a chi la legge — il
criterio del §11.1, la forma di `journal_settings()`. La parola che l'utente
sceglie e l'ordine che il parser applica sono **una tabella sola**
(`DateOrder::as_key`/`from_key`, e la serializzazione serde è la stessa parola,
provato): due copie sarebbero due tendine che promettono cose diverse.

**Tre — il pezzo di progetto vero: come il formato arriva al parser.** `fub-abi`
è puro e non legge impostazioni, quindi i formati **si passano**:
`Frontmatter::property` e `properties` prendono un `&DateFormats`, e con loro le
quattro funzioni di `rules::properties` (`test`, `facets`, `entries`, `finish`).
Non si è tenuta una versione senza parametro con l'ISO per default, ed è la
scelta che costa: un `property(key)` sopravvissuto sarebbe stato la strada che
ogni chiamante nuovo prende senza accorgersene, e un filtro che non trova non lo
segnala nessuno. **Qui il presidio è il compilatore**, che è l'unico dei tre
attori (0105) capace di prendere il chiamante che *non c'è ancora*. Il valore lo
legge `CoreIndex::date_formats` dalle impostazioni condivise, **a ogni domanda**
e non al montaggio: chi cambia la dichiarazione cambia il valore di ogni
proprietà data del vault, e un indice che rispondesse con com'era al montaggio
direbbe che il filtro non trova **anche dopo** che l'utente ha riparato la
causa.

**Quattro — il segnale.** `HealthCheck::UnrecognizedDates`, quarto caso in coda
a un enum di tre: additivo, `health-check` è nel frozen e un caso in fondo a un
enum passa `wit_additivity`; `HealthIssue` ha già la forma giusta e **nessun
record cambia**. Cammina i **documenti** e non l'anagrafe — è la simmetria
opposta a quella della 0107, perché una proprietà sta in una nota — ed emette
una issue **per documento** e non per proprietà, perché qui il gesto che ripara
è uno: una nota scritta con `5/7/2026` ha quasi sempre tutte le sue date in quel
formato.

Il rilevatore **non è una seconda regola**: è lo stesso parser con tutti gli
ordini insieme (`DateFormats::looks_like_a_date`). Ciò che due dichiarazioni
diverse leggerebbero in due modi è esattamente ciò su cui vale la pena chiedere
a chi possiede il vault — e siccome qui la risposta è una **domanda** e non un
valore, la larghezza è legittima dove nel parser non lo era. È la riga che tiene
insieme questa decisione con la 0003: *un parser largo che produce un valore
inventa; un parser largo che produce una domanda avvisa.* Chi ha dichiarato il
proprio formato non si sente ripetere niente di ciò che quel formato legge: una
data dichiarata **è** una data, e un controllo rumoroso è un controllo spento.

## Cosa non si è fatto, e perché

- **Nessuna riparazione automatica, e nessuna riscrittura dei file.** Il vault è
  di chi lo possiede; qui, a differenza della 0107, la conversione sarebbe anche
  *fattibile* — e proprio per questo va detto che non si fa: riscrivere il
  frontmatter di note altrui per far funzionare un filtro è il gesto che questo
  progetto promette di non fare.
- **I nomi dei mesi non entrano** (`5 luglio 2026`, che la voce nomina). Un nome
  di mese è una **parola di una lingua**, quindi il suo formato non sarebbe un
  ordine ma una tabella per locale, e la tabella non c'è; e il rilevatore
  saprebbe dire di sì solo nelle lingue che conosce, cioè tacerebbe di più
  proprio sui vault più lontani. Resta una **casella** di questa voce, non un
  buco dichiarato: si chiude quando ci sarà un secondo cliente per le tabelle di
  locale.
- **L'orario accanto a una data non-ISO non si legge.** Ciò che si dichiara è
  l'ordine dei campi di una **data**; un istante è ISO o non è. Un formato
  dichiarato che portasse anche l'ora vorrebbe dichiarare anche il fuso, che è
  della macchina (0091) e non del file.
- **Il mirror TS di questa regola non si scrive.** La shell non normalizza
  proprietà: le chiede. `DateOrder` compare in `enums.generated.ts` perché ogni
  enum senza payload del contratto ci compare, non perché serva a qualcuno.

## Cosa si rompe se qualcuno cambia idea

Il ritaglio era il punto delicato della voce, e la misura lo conferma:
`property-value`, `property-date`, `property-scalar`, `property-test`,
`property-filter`, `property-sort`, `property-entry`, `property-count` e
`index-query-property-values` sono **tutti** nel frozen. Questa decisione non ne
tocca nessuno: il formato è **dato** in un `SettingValue`, non firma, e l'unica
riga di WIT è un caso in coda a un enum. La voce non distingueva fra «una
variante in fondo a una variant» (additiva) e «un campo dentro un record
pubblicato» (major), e la differenza era tutta lì: se il formato fosse stato un
campo su `property-date` — la strada che sembra più diretta — sarebbe stato
**major**, e questa voce non si sarebbe potuta chiudere prima del freeze.

## La verifica del rosso

Ogni ramo di produzione tolto uno alla volta, con la suite intera dopo ognuno.
Le due che vale la pena scrivere:

- togliere `.or_else(|| formats.read(t))` dal parser rende rossi
  `a_declared_format_only_adds_readings` e
  `a_mixed_vault_answers_wrong_and_says_nothing_until_the_format_is_declared`;
- togliere il vincolo dell'anno a quattro cifre rende rosso
  `declaring_a_format_is_not_a_tolerant_parser` **e** il banco del rilevatore,
  che è la conferma che i due condividono davvero il parser invece di
  somigliarsi.

E un difetto **fuori dalla voce**, di una specie già nota a questo repo: il
banco che la misura dava per «copertura per costruzione» —
`le_impostazioni_del_core_parlano_anche_loro` — nomina `locale_settings()` **a
mano**, quindi una famiglia nuova dichiarata dal kernel gli passa accanto
restando verde. Il suo gemello in `fub-host`, `cataloghi_del_core()`, aveva già
perso `maintenance::catalog()` senza che nessuno se ne accorgesse: *esaustivo a
memoria, non per costruzione* (§16.7). Qui si sono allungati tutti e due invece
di allungare una bugia — e la forma vera della riparazione, un `match` esaustivo
più un conto, resta la voce che la
[0105](0105-una-porta-si-nomina-e-un-presupposto-si-compila.md) ha già descritto
e che non è di questo giro. Riparato nello stesso commit anche un difetto vero
dentro quel banco: pretendeva ogni chiave in **ogni** catalogo invece che in
ogni **lingua**, cioè non avrebbe mai permesso a due cataloghi della stessa
lingua di sommarsi — che è precisamente ciò che il montaggio fa.

## Cosa la verifica ha trovato dopo (aggiunto il 2026-08-06)

Questa riga si **aggiunge** e non riscrive niente di quanto sta sopra: un
verbale racconta cosa si è deciso quel giorno, non cosa si è scoperto poi.

Il collaudo del giro ha misurato che il formato dichiarato veniva letto da
**cinque** punti del kernel e che il presidio ne copriva **due** — il filtro e
`VaultHealth`, cioè i due che stanno nella «verifica del rosso» qui sopra.
Sostituendo il formato con `DateFormats::ISO` negli altri tre — la coda delle
`Documents` nell'indice, le faccette di `PropertyValues`, e la coda delle
`Documents` nel pianificatore — la suite intera restava **verde**. I due danni
scoperti erano esattamente i due che il doc di `HealthCheck::UnrecognizedDates`
elenca come ragione d'essere della decisione: *una faccetta per ogni scrittura
diversa dello stesso giorno*, e *un ordinamento plausibile e arbitrario*. Cioè
l'ordinamento che questo verbale ha già registrato come «difetto fuori dalla
voce» era stato **scritto e non presidiato**.

La riparazione sta nel commit che nomina questo verbale: i due punti che
montavano la coda delle `Documents` sono diventati **uno**
(`CoreIndex::finish_documents`), così i formati li passa un posto solo e il
chiamante successivo li eredita; il raggruppamento e l'ordinamento hanno il loro
banco end-to-end; e il fatto che quel punto resti uno lo guarda un conto
(`code-delle-documents-nel-kernel`), perché il compilatore non sa distinguere un
`&DateFormats` giusto da uno sbagliato e nessun test vede una rotta che non c'è
ancora.
