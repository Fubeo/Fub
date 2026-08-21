# 0061 — Un giro che non prende i byte dal modello, e uno che ci passa

**In breve:** il round-trip import/export Markdown è stato completato sul
corpus; un verso copia i byte direttamente senza passare dal modello, mentre
l'altro affetta i byte in base agli offset del modello.

|  |  |
|---|---|
| **Decisa** | 2026-07-30 |
| **Origine** | `todo.md` §17.1 ([seduta 17](../roadmap/17-presidi-che-restano.md)) — **una casella su cinque**: il round-trip import/export rifatto sul corpus. Restano le due del banco delle prestazioni, e con loro la voce |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/17-presidi-che-restano.md) ·
[import/export come trait, 0006](0006-import-export-come-trait.md) ·
[il corpus, 0060](0060-il-modello-dice-il-vero-sui-byte.md) ·
[la generazione non è un round-trip, 0059](0059-la-generazione-non-e-un-round-trip.md)

---

## Il contesto e il timore mal riposto

La [0060](0060-il-modello-dice-il-vero-sui-byte.md) ha chiuso due delle cinque
caselle del §17.1, e ha detto di due che aspettano una macchina. Questa voce si
occupa della quinta: il round-trip import/export rifatto sul corpus. Aspettava
il corpus per poter procedere.

Il timore originale era: *«le tredici divergenze dichiarate sono l'elenco di ciò
che un round-trip non può pretendere finché non sono riparate»*. **Era mal
riposto.** Bastava chiedersi da dove provengono i byte.
- Le divergenze dichiarate dalla 0060 sono disaccordi fra il modello e il file
  (es. tag inventato per `[[#Sezione]]`).
- Nel round-trip di export markdown, i byte non vengono dal modello. Si legge la
  sorgente con `ReadApi::read_document` (tramite il canale del vault, non
  `IndexQuery`) e la si copia intatta in un artefatto.
- Fra i due versi non c'è nessun `serialize` (sarebbe generazione, non
  round-trip, vedi [0059](0059-la-generazione-non-e-un-round-trip.md)) e nessuno
  span.

Pertanto, le sorgenti delle divergenze **stanno nel vault apposta**, assieme ai
sessantadue casi curati. Se un giorno il trasferimento dovesse generare byte dal
modello, quelle tredici note sarebbero le prime a fallire.

**Precisione:** l'import costruisce il modello. La sorgente viene parsata per
raccontare nel rapporto quanti link, tag e heading stanno entrando
(`transfer.rs`). Ma i byte che scrive non provengono dal modello. Inoltre,
`parse_markdown` non restituisce `Err`, e il `map_err` è codice morto; il
rifiuto avviene prima in `ImportSource::text`.

L'unico verso che passa dal modello è con `frontmatter: false`.
`strip_frontmatter` taglia il file su `first.span().start`, **affettando i byte
con un numero fornito dal modello**. Lì l'identità non si può pretendere.

## Una casella dichiarata lavoro, e perché ha aperto un verbale

Il criterio in `decisions/README.md` dice: *una casella residua è ciò che si può
fare senza aprire un verbale*. La 0060 l'ha chiamata «lavoro» ma il verbale c'è.

**La previsione era sbagliata.** La casella sembrava solo lavoro perché il
round-trip sembrava una cosa unica. In realtà i versi sono due e non pretendono
la stessa cosa (uno passa dal modello, l'altro no). Questa è una decisione di
design architetturale che va scritta.

## Fatto (Le implementazioni)

- [x] **Il corpus scende in un modulo condiviso**, in [`tests/corpus/mod.rs`](../../crates/fub-format-markdown/tests/corpus/mod.rs). Contiene i sessantadue casi, le tredici sorgenti divergenti e il mutatore. Essendo compilato *dentro* ciascun binario `tests/`, le due suite vedono lo stesso elenco.
- [x] **Il round-trip sul corpus che copia i byte** ([`transfer_e2e.rs`](../../crates/fub-format-markdown/tests/transfer_e2e.rs)). Include settantacinque note, export dell'intero vault e import in uno vuoto, confrontate byte per byte.
- [x] **Il verso che passa dal modello.** Non pretende l'identità ma che **la
  struttura non cambi**. È confrontata due volte: una proiezione senza offset, e
  il modello intero con gli span rimessi a posto.
- [x] **Il corpus attraversa quel verso.** Le settantacinque sorgenti vengono
  importate con un frontmatter davanti. Questo permette di testare attivamente
  il taglio del frontmatter (prima lo avevano solo quattro file su
  settantacinque).
- [x] **Due fuzzer nuovi.** Generano ventimila mutazioni e verificano che
  l'export senza metadati non generi panico. Inoltre duemila mutazioni sui nomi
  assicurano che non escano dal recinto.
- [x] **Un difetto di produzione trovato e riparato.** Il taglio eliminava
  l'indentazione di un code block indentato.
- [x] **`conformita::bersagli` resta.** La 0060 lo dichiarava senza cliente, ma
  ora il corpus lo utilizza (non come `cio_che_non_e_perduto_si_ritrova` della
  [0054](0054-il-banco-del-lato-provider.md)).
- [x] **Il legame fra le metà delle divergenze è una chiave.** I predicati in
  `il_corpus.rs` e le sorgenti sono confrontati nei due versi. Ogni predicato
  deve essere **falso** su cinque documenti di controllo.

## La riparazione: il taglio si mangiava l'indentazione

Lo span di un code block indentato inizia dopo i quattro spazi. Tagliando il
frontmatter su `first.span().start`, l'export produceva un documento dove quel
blocco non era più un code block.

- Il taglio ora si estende indietro fino all'inizio della riga, **ma solo
  attraverso spazi e tabulazioni**. Questo lo mantiene una patch basata su span
  (confine della [0008](0008-modifica-chirurgica.md)) e non una rilettura
  testuale, giustificando il perché `strip_frontmatter` non conti i `---` da sé.
- Il difetto era vecchio (nato con la [0006](0006-import-export-come-trait.md)),
  non rivelato dal test `metadata_can_be_left_behind` perché quello non usava
  indentazione a inizio file.

## Le tre sorgenti che il cappello non può prendere

Alcuni casi non passano la pretesa sulla struttura perché il significato dei
byte dipende dalla loro posizione, e togliendo il frontmatter tornano
all'inizio, cambiando significato.

| caso | cosa succede |
|---|---|
| `bom` | col cappello davanti il BOM è in mezzo al documento, quindi è testo, e l'heading che lo segue non è un heading. Tagliato il frontmatter il BOM è in testa, smette di essere contenuto, e l'heading torna un heading |
| `solo un bom` | la stessa cosa sul documento che *è* un BOM: col cappello ha un paragrafo, tagliato non ha niente |
| `un frontmatter che non si parsa non lascia traccia` | col cappello davanti diventa un doppio frontmatter, che è la maglia già dichiarata: il primo giro ne toglie uno e scopre l'altro |

Sono in un elenco chiuso `FUORI_DAL_CAPPELLO` con relativa ragione.

## Le decisioni

- **Le due porte del trasferimento non pretendono la stessa cosa.** Al verso che
  copia si chiede l'identità byte per byte sulle settantacinque sorgenti
  (inclusi BOM, CRLF, `\r` nudo). Al verso che taglia, si chiede solo che la
  struttura non cambi.
- **Un presidio che confronta proiezioni deve contare.** Il fuzzer conta i
  tagli: su settantacinque note senza cappello, prima se ne tagliavano solo
  quattro, lasciando `x == x` per le altre settantuno. Nel fuzzer era peggio: il
  2,8% delle mutazioni conservava un frontmatter, quindi il 97% delle corse non
  arrivava al codice.
- **Gli span si possono confrontare.** Se l'export toglie $N$ byte, allora
  `source.len() - fuori.len()` è lo scostamento noto. Rimettendo indietro gli
  span di quel valore, i modelli devono combaciare.
- **La proiezione leggibile resta.** Un `DocumentModel` non è leggibile per
  intero in output. La proiezione leggibile dice subito se un titolo è diventato
  un paragrafo (es. quando la riga `heading 1 "corpo" "Corpo"` sparisce), mentre
  quella severa dice solo *che* qualcosa è cambiato.
- **I tag stanno nella proiezione.** Un `tag: [a, b]` nel frontmatter non *è* un
  tag del documento, e `parse_markdown` popola `model.tags` solo dai `#tag` del
  corpo. Togliendo il frontmatter, i tag non cambiano.
- **Il corpus è un ingresso e sta dove viene letto.** È condiviso tra le due
  suite per non farle divergere. Non è andato nell'SDK o in un binario separato
  (sarebbero state sorgenti markdown in un crate che di markdown non sa niente,
  senza un vero `FormatProvider`).
- **Il modulo condiviso non porta `allow(dead_code)`.** I lint non vanno spenti
  (l'`allow` è stato tolto), se un caso non viene usato la CI deve avvisare
  tramite `--force-warn dead_code`.
- **Le note del vault si posano sul disco e non entrano dall'import.** Iniziano
  su `std::fs` e l'import entra in gioco solo nel verso di ritorno.
- **Il nome è la chiave.** Separando `divergenze_dichiarate` in due metà si è
  aperto un modo di fallire. Un predicato riceve anche la sorgente, ed è stato
  ristretto per non passare a vuoto.
- **Il fuzzer dell'export non è simmetrico a quello del parser.** Ha un
  bersaglio per impedire panici, proprietà verificata fin dalla 0060 (via
  `conformita::gli_span_affettano_la_sorgente`).
- **Budget del fuzzer.** Ventimila mutazioni dell'export costano 3,3 s e del
  parser 2,6 s (0,17 ms contro 0,13). Il fuzzer dei nomi ne fa solo duemila
  (0,24 s) perché `MarkdownImport::import` è quadratico (2000 → 0,24, 4000 →
  0,54, 8000 → 1,38, 16000 → 4,26).

## La prova che diventa rossa quando deve

| asserzione | come | cosa ha detto |
|---|---|---|
| i byte non si toccano | `MarkdownExport::export` normalizza `\r\n` in `\n` | `` `corpus/crlf.md` è uscita diversa da com'era nel vault `` |
| la struttura non cambia | il taglio a `first.span().start + 1` | `` `cappello/ancora che non è un'ancora.md`: togliendo il frontmatter è cambiato anche il corpo ``, e la differenza è `testo "^10 = 1024"` contro `testo "2^10 = 1024"` — un byte mangiato |
| il taglio prende un prefisso e nient'altro | lo span del `TaskMarker` non rimesso a posto, che è un difetto vero di questo giro | `` `cappello/cr solo su più blocchi.md`: il modello del documento tagliato, con gli span rimessi indietro di 14 byte, non è quello di prima `` |
| il taglio avviene davvero | `strip_frontmatter` restituisce sempre il sorgente | `il taglio è avvenuto su 0 note e 72 hanno un frontmatter: sono lo stesso insieme o non lo sono` |
| la proiezione non è vuota | `struttura` torna `Vec::new()` | ``in 72 note tagliate la proiezione non ha prodotto una sola riga `blocco …`: sta confrontando meno di quel che dice`` |
| l'export non pania | il taglio a `first.span().start + 3` | `start byte index 17 is not a char boundary; it is inside '\u{feff}'`, al caso 168 di 20 000, mutazione «con un byte ostile in mezzo» |
| il seme riproduce | lo stesso taglio, col comando che il messaggio stampa | rosso allo stesso caso 168, allo stesso conteggio |
| un fuzzer con zero casi non è un fuzzer | `FUB_FUZZ_TRASFERIMENTO=0`, `FUB_FUZZ_NOMI=0` | `0 mutazioni non sono un fuzzer: con zero il ciclo non gira nemmeno` |
| un seme illeggibile non cade sul default | `FUB_FUZZ_SEME=0x4675_6D4D_4420_3031`, cioè la forma in cui il default è scritto nel codice | `` FUB_FUZZ_SEME="0x4675_6D4D_4420_3031" non è un numero decimale `` |
| un nome non esce dal recinto | `MarkdownImport` smette di chiamare `ImportSource::stem` | `` caso 62 — mutazione «duplicato» — il nome "<div>blocco</div>\n<div>blocco</div>\n" è diventato `in/<div>blocco</div>…`: ha guadagnato dei componenti di path `` |
| il disco si guarda davvero | la camminata non scende nelle cartelle | `sotto la radice ci sono 0 file e ne sono nati 980: la camminata del disco non sta guardando dove si scrive` |
| il corpus non ha omonimi | un secondo `caso("enfasi", …)` | `` due casi si chiamano `corpus/enfasi.md` `` |
| le due metà si tengono | tolta da `divergenti()` la sorgente del barrato, lasciato il predicato | `` queste divergenze hanno un predicato e nessuna sorgente in `corpus::divergenti()`: ["il barrato non arriva nel modello"] `` |
| un predicato non descrive il vuoto | riportato «l'alt di un'immagine» alla sua forma di prima, `!d.text.contains("didascalia")` | `il predicato … è vero anche su un documento di controllo: ""` |

- **La prima versione della prova era debole:** il taglio a `+ 1` lasciava verde
  il punto fisso senza accorgersi dello scostamento di offset.
- **Trovati nove difetti totali, ma due erano nelle prove:** la proiezione
  originale includeva il `TaskMarker` intero alterando gli span.
- Guastare la prova scopre cosa effettivamente prova.

## Le maglie che lasciano passare

- **Il significato di certi byte dipende dalla posizione,** per questo ci sono
  eccezioni esplicite in `FUORI_DAL_CAPPELLO`.
- **Il punto fisso non è proprietà dell'export.**
- **Il fuzzer dell'export non pretende la struttura,** ma si accontenta che non
  vada in panico e restituisca una coda.
- **La proiezione leggibile non vede tutto,** non valuta offset e bersagli dei
  link.
- **Il round-trip dei nomi non passa da un filesystem che normalizza,** ma verrà
  testato in CI su Apple.
- **Il fuzzer dei nomi non distingue `BadArgs` da `ImportOutcome::Failed`:** un
  `Failed` non è verificato. Corretto dopo in CI Windows. Su 2000 nomi solo 310
  diventano documenti su Windows (contro i 980 su Linux), per via di caratteri
  vietati (`<`, `>`, `|`, `?`, `:`). La soglia conta ora 1645.
- **Settantacinque sorgenti non sono un vault.** Un vault vero ha allegati,
  cestino, `.fub/`.
- **Passa solo UTF-8 valido.** (ereditato dalla 0060 via
  `un_provider_testuale_rifiuta_i_byte`).
- **Aggiungere un caso rimescola la sequenza.**

## Cosa si è scartato

| Alternativa | Perché no |
|---|---|
| Un terzo binario di test | Trasferimento come soggetto impone la posizione in `transfer_e2e.rs`. Separarlo disperderebbe i clienti del corpus. |
| Il corpus nell'SDK | L'SDK non tratta markdown. |
| Entrare dall'import | Rende invisibili eventuali difetti simmetrici nei due versi. |
| Round-trip di `TARGET_SINGLE` | La concatenazione richiede uno splitter. Che usi `trim_end` e `# Titolo` resta senza corpus. |
| Riparare le divergenze | Le tredici divergenze aspettano decisioni su modello non pertinenti a questa casella. |
| Un secondo cappello | Costruirebbe doppi frontmatter falsificando le premesse del punto fisso. |

## Cosa resta fuori, dichiarato

- **Le due caselle del banco delle prestazioni:** le soglie (10k/100k) e
  `#[ignore]` della §8.4 aspettano macchina isolata. Non sono un residuo di
  lavoro.
- **Gli allegati e un vault vero.**
- **Il round-trip attraverso un filesystem che normalizza i nomi.**
- **Le tredici divergenze.**
- **Il ramo morto di `strip_frontmatter`.**
- **L'esplorazione guidata dalla copertura:** alzare manualmente
  `FUB_FUZZ_TRASFERIMENTO` e `FUB_FUZZ_NOMI` in
  [CONTRIBUTING.md](../CONTRIBUTING.md).
- **Le caselle di [FEATURES.md](../FEATURES.md) restano senza spunta,** perché
  non sono un tracciato di avanzamento (vedi 0060 e 0008).

## Verifica

- `cargo fmt --all --check` e
  `cargo clippy --workspace --all-targets -- -D warnings`: puliti.
- `cargo test --workspace`: 938 test verdi in 89 binari, 0 falliti, 3 ignorati.
  (Rispetto alla 0060: da 934, si sottrae 4 per la rimozione di
  `radice_unica.rs` in `d2e397a`, ottenendo 930. Si sommano otto test nuovi,
  sette in `transfer_e2e` (da 17 a 24 test), e uno in `il_corpus` (da 8 a 9
  test), totale 938). Nessun binario nuovo tra i 90 originali.
- Righe modificate: `il_corpus.rs` da 1069 a 942 (perse duecento righe di
  corpus, guadagnate settanta di presidio); `transfer_e2e.rs` da 477 a 1416;
  creato `tests/corpus/mod.rs` di 374 righe.
- 143 note totali nel vault del punto fisso (settantacinque + sessantotto
  cappelli), taglio su 72.
- Fuzzer a 20 000 in 3,3 s (export) e 2,6 s (parser); 2 000 nomi in 0,24 s;
  `transfer_e2e` passa da 0,00 s a 3,3 s. Variabili `FUB_FUZZ_CASI` e
  `FUB_FUZZ_SEME` in [CONTRIBUTING.md](../CONTRIBUTING.md).
- `node .github/scripts/check-doc-links.mjs`: 133 file, 2500 link, 0 rotti.
- Aggiornata la riga della [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md)
  per l'ottava volta: a HEAD dichiarava "132 file, 2475 link" ma lo script ne
  contava 2468 (sette link tolti). Inoltre, `git ls-files` non conterebbe un
  `.md` non tracciato che farebbe 134 invece di 133.
