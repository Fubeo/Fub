# Piano: i motori Craft dentro Fub, a partire da WordCraft

Questo piano descrive come Fub usa i motori della suite Craft (WordCraft oggi;
GridCraft, PdfCraft ed eventualmente parti di VectorCraft in futuro) senza
perdere il controllo dell'esperienza, dei dati dell'utente e degli
aggiornamenti.

## Stato, perimetro e metodo

- **Data della ricognizione:** 21 ottobre 2026.
- **Stato:** proposta da approvare. Nessuna parte è implementata. Non è
  un'attestazione di comportamento entrato in `main`.
- **Revisione:** integra una revisione esterna dello stesso giorno; cosa è
  cambiato, e perché, sta nell'appendice E.
- **Baseline:**
  - Fub `main` al commit `73fae94`;
  - WordCraft vendorizzato al commit `eae242176108d328c5dd81fbc10370c51ab90706`
    (15 ottobre 2026, fra i tag `v0.7.0` e `v0.8.0`);
  - WordCraft upstream al commit `e3bb06a298c24f96678c3c513fa19dbf630ccab6`
    (20 ottobre 2026).
- **Prova disponibile:** ricognizione del codice e prove eseguite in una copia
  separata, elencate nell'appendice A. I test nominati nelle fasi sono **da
  scrivere**: non sono risultati.
- **Gestione del lavoro:** ogni fase diventa una GitHub Issue, coordinata da
  una issue madre. Nessuna issue è stata ancora aperta.
- **Collocazione:** come `piano_feature.md` e `piano_impostazioni.md`,
  questo file sta alla radice. Non sostituisce le
  pagine canoniche in `docs/` e non è un secondo tracker.

## In breve

- Fub tiene WordCraft dentro il repository, a una versione fissa. Resta così:
  la versione cambia soltanto quando decidi tu di aggiornarla.
- Prima di tutto si chiude un bug che esiste già: alcuni file Word, salvati da
  Fub, perdono dei pezzi senza avvisare. Fub avrà controlli suoi, che non si
  fidano di WordCraft, all'apertura **e a ogni salvataggio**.
- Poi si costruisce una raccolta di file veri, per vedere subito cosa cambia a
  ogni aggiornamento del motore.
- La proiezione, che finisce nelle bozze e contiene dati nel formato interno di
  WordCraft, passa alla versione 2 e dichiara la versione di quei dati, così un
  aggiornamento non rende illeggibili le bozze.
- La copia di WordCraft non si fa più a mano: la rigenera uno script, e un
  controllo automatico verifica che nessuno la modifichi di nascosto.
- Le modifiche di cui Fub ha bisogno si propongono agli autori di WordCraft.
- Una fork su Git si valuta più avanti, con criteri misurabili.
- Per i fogli di calcolo, GridCraft diventa il motore del dominio (modello,
  formule, calcolo, XLSX), e `.fubsheet` passa gradualmente a formato da
  importare. PdfCraft entra per singole capacità.

## Decisione

Il principio diventa:

> **Fub possiede l'esperienza e la garanzia; Craft possiede il codec e il
> dominio.**

- **L'esperienza** è ciò che Fub possedeva già: vault, identità, sessione,
  salvataggio, bozze, conflitti, recupero, indice, link, interfaccia, comandi,
  accessibilità, policy e sicurezza.
- **La garanzia** è la parte nuova: il controllo che nessun contenuto vada
  perso e la decisione di aprire un documento in sola lettura, o di non
  scrivere un salvataggio, appartengono a Fub e non dipendono dal motore che
  sorvegliano.
- **Il codec e il dominio** sono ciò che si delega: leggere e scrivere il
  formato, il modello del documento, gli algoritmi del dominio (per il foglio di
  calcolo anche formule e ricalcolo). Non si delegano le facciate applicative
  dei motori (sessioni, comandi, cronologia, selezione).

Il piano originale («Fub owns the experience; Craft owns the domain», fork
sottile, dipendenze Git pinnate, eliminazione del vendor) è adottato **con
modifiche importanti**:

| Punto del piano originale | Esito |
|---|---|
| Soltanto `fub-format-rich` dipende da WordCraft | Corretto: anche il correttore in `fub-features` (feature `proof`); `fub-host` soltanto nei test |
| Guard CI contro gli import diretti | Adottato, con l'elenco reale dei proprietari (F4) |
| Fork `Fubeo/wordcraft` come sorgente della build | Rinviato a una decisione con criteri misurabili (F8) |
| Dipendenze Git pinnate | Rinviate; se un giorno si useranno, SHA completo, mirror e build offline |
| Togliere i crate WordCraft da `workspace.members` | Adottato (F3) |
| Allentare `cargo-deny` sulle sorgenti | Non serve con il vendor derivato |
| Eliminare `vendor/wordcraft` dopo l'equivalenza | Non ora: la copia locale resta, ma generata e verificata |
| Corpus e confronto prima/dopo | Adottato, con file reali e con controlli indipendenti dal motore, all'apertura e a ogni salvataggio (F0a, F0b, F1) |
| Pin per SHA, nessun tracking di `main` | Adottato: è già vero oggi |
| Proporre le patch upstream | Adottato e ordinato per priorità (F5) |
| Modello per GridCraft e PdfCraft | Adottato come metodo; GridCraft possiede il dominio del foglio senza la sua facciata `engine`; PdfCraft per capacità (F9) |

## Stato attuale verificato

### 1. WordCraft ha due consumatori, non uno

| Crate di Fub | Crate WordCraft | Tipo |
|---|---|---|
| `fub-format-rich` | `wordcraft-doc`, `-docx`, `-formats`, `-docbin` | normale |
| `fub-format-rich` | `wordcraft-geom` | soltanto test |
| `fub-features` | `wordcraft-proof` | opzionale, feature `proof` (`crates/fub-features/Cargo.toml`) |
| `fub-host` | `wordcraft-formats` | soltanto test (`crates/fub-host/tests/rich_documents.rs`) |

`fub-abi` e `fub-kernel` hanno già un elenco chiuso di dipendenze dirette in
`crates/fub-abi/tests/dependency_invariant.rs`, quindi oggi non possono
dipendere da WordCraft. L'adattatore del correttore
(`crates/fub-features/src/proof.rs`) non espone tipi WordCraft: la sua API
pubblica usa tipi di Fub (`ProofIssueKind`, `CheckOptions`).

### 2. La perdita silenziosa esiste già su `main`

Una sonda (appendice B) costruisce un `.docx` con:

- un run con `<w:eastAsianLayout>` (impaginazione dell'Asia orientale);
- un `<w:altChunk>` che rimanda a una parte `word/chunk.html` (contenuto
  importato, frequente nei file generati da strumenti HTML→DOCX);
- un intervallo di permessi `<w:permStart>`/`<w:permEnd>`.

Poi lo apre con `fub_format_rich::open`, modifica un altro paragrafo come
farebbe la shell e salva con `fub_format_rich::save`.

| Risultato | WordCraft vendorizzato (`eae2421`) | WordCraft upstream (`e3bb06a`) |
|---|---|---|
| Sola lettura all'apertura | no | no |
| `eastAsianLayout` dopo il salvataggio | **perso** | conservato |
| `altChunk` dopo il salvataggio | **perso** | **perso** |
| `word/chunk.html` nel pacchetto | **persa** | **persa** |
| `permStart`/`permEnd` | conservati | conservati |
| Avviso all'utente | nessuno | nessuno |

Il principio di Fub («ciò che non si sa riscrivere si conserva o si rifiuta»)
oggi non vale per questi casi.

### 3. Il controllo di fedeltà è correlato al motore che sorveglia

- `session::fidelity` (`crates/fub-format-rich/src/session.rs`) e
  `fidelity::reads_back` (`crates/fub-format-rich/src/fidelity.rs`)
  confrontano un `wordcraft_doc::Document` con un altro `Document`. Dimostrano
  che il **modello** è stabile rispetto a scrittura e rilettura, non che il
  modello descrive il **file**.
- L'unico confronto con i byte originali riguarda `settings.xml`
  (`settings_kept_unowned`).
- Il lettore DOCX di WordCraft dichiara di saltare il markup sconosciuto
  («unknown markup is skipped», `vendor/wordcraft/crates/docx/src/lib.rs`).
- `Codec::lossless()` restituisce `true` per DOCX per costruzione
  (`crates/fub-format-rich/src/lib.rs`).
- I test di Fub usano `wordcraft_docx::read` come oracolo: non possono vedere
  ciò che quel lettore non legge.
- Il writer ha rami che dipendono dallo stato del modello, quindi dalla
  modifica: un budget sul markup degli oggetti incorporati, oltre il quale
  «the rest is left out»; parti proprie oppure condivise per la copia di un
  oggetto; relazioni tolte quando una parte non è stata tenuta
  (`vendor/wordcraft/crates/docx/src/write/embed.rs`). Molti di questi casi li
  vede già `reads_back`, perché l'oggetto sparisce dal modello riletto. Non vede
  ciò che il modello non rappresenta, né le differenze che `fidelity.rs`
  tollera per costruzione.
- Per contrasto, l'OpenDocument ha un codec di Fub che conserva l'XML che non
  conosce byte per byte (ADR 0210). Il DOCX ha lo standard di preservazione più
  debole dei due.

### 4. Non c'è nessun file reale di prova

`git ls-files` non trova nessun `.docx`, `.odt`, `.rtf`, `.doc` o `.dot`. Tutti
i documenti dei test sono costruiti nel codice. Anche i test del codec DOCX
dell'upstream che ho letto (`fixtures.rs`, `passthrough.rs`) dichiarano fixture
scritte a mano dalle specifiche («no files produced by Word»).

### 5. Aggiornare a HEAD passa i test e cambia il comportamento

Con WordCraft upstream al posto della copia vendorizzata:

- `fub-format-rich` non compila soltanto perché manca la patch di Fub
  (`settings_kept_unowned`). Riportata a mano la patch (la parte su `lib.rs` non
  si applica più da sola), il crate compila **senza modifiche** e passa
  **113 test su 113**;
- `fub-features --features proof` non compila: `check_text_with` ha un
  parametro nuovo (`list_item`) e la variante nuova `ProofLang::Id` non è
  coperta da un `match` esaustivo;
- la sonda dà un risultato diverso (punto 2): `eastAsianLayout` adesso si
  conserva.

I test di Fub non vedono il cambiamento in nessuna delle due direzioni: né
quando il motore migliora, né quando peggiorerebbe.

### 6. La patch semantica si sta già disallineando

`kept_unowned` (aggiunta da Fub in `docx/src/write/settings_merge.rs`) replica
la policy privata di `merge` (`OWNED` e `KEEP_ORIGINAL`). In cinque giorni
l'upstream ha:

- aggiunto `w:doNotTrackMoves` a `OWNED`;
- reso `merge_compat` capace di espandere un `<w:compat/>` vuoto.

Su HEAD, con un `settings.xml` che contiene `<w:compat/>`, il merge conserva
tutto ma `kept_unowned` risponde `false`: il documento resterebbe in sola
lettura. Fallisce chiuso, quindi senza perdita, ma nessun test di Fub vede il
disallineamento.

### 7. Lo schema serde di WordCraft è già un formato persistente di Fub

- I dati opachi `k` della proiezione sono «JSON del modello di WordCraft in
  base64» (`crates/fub-format-rich/src/blob.rs`): `CharProps`, `ParaKeep`,
  `AtomKeep` (con `InlineObject` e le parti), `CommentKeep`, `SectKeep`.
- La proiezione è la sorgente della DocumentSession e passa per le bozze
  (`.fub/drafts/`). Le bozze sono **autorevoli**
  (`docs/reference/on-disk-layout.md`) e **viaggiano con il vault**
  (`crates/fub-kernel/src/drafts.rs`): due computer con versioni diverse di
  Fub possono leggere la stessa bozza.
- I tipi di `wordcraft-doc` non usano `deny_unknown_fields`: un campo che il
  motore non conosce si scarta in silenzio.
- La versione della proiezione (`fub-rich` 1) non cambia quando cambia la forma
  dei dati opachi.
- La shell valida da sola `format`, `version` e l'elenco chiuso delle chiavi
  della proiezione, e la riscrive con la propria costante `PROJECTION_VERSION`
  (`apps/client/src/editors/rich/projection.ts`).
- `SectKeep` ha già un ripiego verso il vecchio `SectionProps`
  (`crates/fub-format-rich/src/projection.rs`): la forma è già cambiata una
  volta.

### 8. Il motore cambia molto in fretta

| Misura | Valore |
|---|---|
| Primo commit del repository | 5 ottobre 2026 |
| Commit totali | 1.023 |
| Tag | 7 in 10 giorni (`v0.1.0` → `v0.8.0`); il workspace dichiara già `0.9.0` |
| Commit dal pin vendorizzato a HEAD | 288, in circa 5 giorni |
| Righe cambiate nei sei crate dal pin | +9.203 / −735 |
| `doc` / `docx` / `formats` | +1.583/−108 · +3.737/−251 · +2.811/−307 |
| `docbin` / `geom` / `proof` | +188/−15 · +138/−0 · +746/−54 |

Configurazione dell'upstream:

- edition 2024; `rust-version = "1.95"` nel `[workspace.package]` radice. I sei
  crate **non** ereditano `rust-version`, quindi Cargo non li rifiuta con Rust
  1.89. Il rischio è un altro: l'upstream prova soltanto la 1.95 e può usare in
  qualunque momento funzioni del linguaggio che la 1.89 non compila;
- `zip` 3, con tre avvisi di sicurezza (RUSTSEC-2026-0367, -0368, -0369),
  ancora su HEAD;
- `serde_json` con `float_roundtrip` e `image` con i decoder jpeg, webp, gif,
  bmp e tiff nel `[workspace.dependencies]` radice;
- una dipendenza Git (`craft-pdf` da `storytold/craft-libs`), usata dal crate
  `pdf` e non dai sei crate che Fub prende;
- il ROADMAP mette la fedeltà sui DOCX reali fra le prime lacune, e
  `docs/file-format-parity.md` elenca cose che non si conservano al salvataggio
  (`w:beforeLines`/`w:afterLines`, alcune eccezioni di riga delle tabelle).

### 9. La copia vendorizzata è sottile e fedele

Confrontata con l'upstream al pin, `vendor/wordcraft/crates/` differisce
esattamente nei file elencati in `vendor/wordcraft/UPSTREAM.md`: 118 righe di
diff fuori dai manifest. La documentazione di provenienza è corretta. Il costo
vero è la procedura manuale: copiare, riapplicare le modifiche, riscrivere i
manifest e ricalcolare le impronte a mano.

### 10. Nessun aggiornamento arriva da solo

- La versione di WordCraft è scritta nel repository e cambia soltanto con un
  commit.
- Nel repository non c'è configurazione di Dependabot o Renovate.
- La CI fissa Rust 1.89 e, ogni lunedì alle 06:00 UTC, esegue anche il job
  `supply-chain` (`cargo deny check`).

### 11. Piccole fughe del motore oltre l'adattatore

- La shell conosce i caratteri con cui WordCraft codifica le interruzioni nel
  testo (`\u000c`, `\u000e`, in `apps/client/src/editors/rich/schema.ts`) e i
  formati carta di `wordcraft_geom::PAPER_SIZES`, con i nomi inglesi
  (`paper.generated.ts`, generato da un test).
- Il codec ODT di Fub usa `wordcraft_doc::para::OBJ` e
  `wordcraft_doc::table::MAX_COLS`, e crea un `.odt` vuoto con l'esportatore di
  WordCraft.
- `RichError::Codec(String)` porta gli errori del motore come testo; l'host li
  traduce in `host.rich.codec` senza la loro specie.
- 14 dei 18 file sorgente di `fub-format-rich` nominano `wordcraft_*`, e i test
  costruiscono `wordcraft_doc::Document`: l'adattatore è l'intero crate, non
  una facciata.

## Chi possiede cosa

| Fub possiede sempre | Il motore Craft possiede |
|---|---|
| Identità dei documenti e vault | Lettura e scrittura del formato |
| DocumentSession, CAS, salvataggio, bozze, conflitti | Modello del documento |
| Watcher e modifiche esterne | Normalizzazioni proprie del formato |
| Versioni e recupero | Crittografia del formato (documenti protetti) |
| Modello comune per indice e ricerca, link, backlink, grafo | Algoritmi del dominio: ortografia, grammatica, formule, ricalcolo, impaginazione |
| Coordinate stabili di celle e intervalli, per link e per il contratto `grid` | Esportatori verso altri formati |
| Proiezioni verso la shell, anche a finestre | |
| Superficie di modifica, undo, comandi, accessibilità | |
| Stringhe visibili all'utente, compresi i nomi dei formati carta | |
| Limiti di risorse e policy di sicurezza | |
| **Controlli di preservazione, sola lettura, rifiuto di un salvataggio** | |
| **Schema persistente della proiezione, dati opachi compresi** | |
| Tassonomia degli errori | |
| Quale revisione del motore si rilascia, e quando | |

Una responsabilità resta condivisa: **saper conservare** ciò che il modello non
rappresenta è del motore, perché soltanto chi scrive il file può conservarlo;
**verificare** che sia stato conservato è di Fub.

## Le fasi

| Fase | Obiettivo | Dipende da | Dimensione | Ordine |
|---|---|---|---|---|
| F4 | Confini delle dipendenze in CI | — | S | 1 |
| F0a | Rilevatore all'apertura e a ogni salvataggio; regressione `altChunk` | — | M | 2 |
| F1 | Corpus di file reali: un primo nucleo, poi la matrice completa | F0a | M, poi L | 3 |
| F0b | Garanzia di preservazione: valori, destinazioni, contenuto non toccato | F0a, primo nucleo di F1 | L | 4 |
| F2 | Proiezione v2 e dati opachi verificati | — | M | 5 |
| F3 | Vendor derivato: copia rigenerata da script | — | M | 6 |
| F7 | Aggiornare WordCraft quando lo decidi tu | F0b, F1, F2, F3 | M al primo giro | 7 |
| F9 | GridCraft, poi PdfCraft e VectorCraft | F7 provata una volta | L per motore | 8 |
| F5 | Contributi a WordCraft | F0a per i casi concreti | S per proposta | continua; `zip` 9 subito |
| F6 | Documentazione e ADR | ogni fase | S | con ogni fase |
| F8 | Quando rivalutare fork e sorgente Git | almeno due giri di F7 | S | più avanti |

Le dimensioni sono stime relative, non misure: **S** è un lavoro breve e
locale, **M** tocca più file e richiede prove nuove, **L** richiede materiale o
persone fuori dal codice (per esempio installazioni di Word) oppure un disegno
nuovo.

Percorso critico:

```text
F4 → F0a → primo nucleo di F1 → F0b → F2 → F3 → primo giro di F7 → GridCraft (F9)
```

F0a non dipende da F1, e F0b si progetta sui primi file reali: così sparisce la
dipendenza circolare fra controlli e corpus. F2 e F3 non dipendono da F0b: con
più persone possono procedere in parallelo. F5 parte subito con `zip` 9; F6
accompagna ogni fase.

---

### F0 — Fermare la perdita silenziosa nei DOCX

**Obiettivo.** Un `.docx` che Fub non sa riscrivere senza perdere qualcosa si
apre in sola lettura, e un salvataggio che perderebbe qualcosa non scrive,
qualunque sia la versione del motore.

**Perché.** È un bug di correttezza attuale (punto 2), e rende inaffidabile
qualunque confronto prima/dopo un aggiornamento (punto 3).

**Due livelli.**

| Livello | Cosa controlla | Quando |
|---|---|---|
| **Rilevatore** (F0a) | che nessun elemento, attributo, relazione o parte sparisca, o compaia in più dove non deve | all'apertura e a ogni salvataggio |
| **Garanzia** (F0b) | che ciò che Fub non possiede resti identico: valori, destinazioni delle relazioni, contenuto che la modifica non tocca | all'apertura e a ogni salvataggio |

Il rilevatore è una prima cintura di sicurezza: veloce, ma cieco ai valori. Un
`<x foo="A">contenuto A</x>` che diventa `<x foo="B">contenuto B</x>` ha gli
stessi conteggi. La frase «nessun contenuto si perde» la regge soltanto la
garanzia.

**Perché anche al salvataggio.** La prova all'apertura dimostra che il writer
conserva il documento *così com'è*. Una modifica cambia il modello, e il writer
ha rami che dipendono dal modello (punto 3). Una prova a vuoto all'apertura non
dimostra niente sul file che un salvataggio scrive dopo una modifica.
`reads_back` vede ciò che sparisce dal modello riletto, non ciò che il modello
non rappresenta né le differenze che `fidelity.rs` tollera per costruzione.

#### F0a — Il rilevatore

**L'inventario del pacchetto**, calcolato da Fub con `zip` e `quick-xml` (già
dipendenze di `fub-format-rich`), senza passare dal modello di WordCraft:

| Chiave | Cosa conta | Perché |
|---|---|---|
| `Elemento(classe, spazio dei nomi, nome)` | occorrenze di ogni elemento, per nome espanso (URI dello spazio dei nomi più nome locale) | il prefisso (`w:`) può cambiare senza perdita |
| `Attributo(classe, elemento, spazio dei nomi, nome)` | occorrenze di ogni attributo | molte proprietà sono attributi |
| `Relazione(classe della sorgente, tipo, destinazione)` | relazioni per tipo (`aFChunk`, `image`, `hyperlink`, `oleObject`…) con la destinazione: l'URL se esterna, l'impronta del contenuto se la parte puntata va copiata così com'è, la classe se è una parte che il writer rigenera | una relazione che punta alla parte sbagliata cambia chiave |
| `Binario(tipo di contenuto, sha256)` | parti non XML: immagini, oggetti incorporati, font, macro | i byte devono restare quelli |

La **classe** di una parte viene dal suo tipo di contenuto:

- *rigenerate dal writer*: le storie (documento, intestazioni, piè di pagina,
  note, commenti, glossario), gli stili, la numerazione, le impostazioni;
- *da copiare così come sono*: tutte le altre (custom XML, oggetti incorporati,
  macro, parti che WordCraft tiene in `passthrough`).

Raggruppare per classe, e non per nome di parte, evita falsi allarmi quando il
codec rinumera le parti (`header1.xml` che diventa `header3.xml`).

**Regola all'apertura** (prova a vuoto: originale → `write(read(originale))`):

- nessuna chiave può diminuire, salvo le normalizzazioni dichiarate;
- nelle classi rigenerate un aumento è ammesso: il writer aggiunge valori
  predefiniti, e un duplicato di contenuto modellato lo vede già `reads_back`
  nel modello riletto;
- nelle classi da copiare anche un aumento è una differenza;
- una differenza → `ReadOnly::Codec`.

**Regola a ogni salvataggio** (byte attuali → byte nuovi):

- le chiavi che la proiezione v1 **possiede** possono cambiare liberamente. È un
  elenco di Fub: ciò che `unproject` sa creare, cambiare o togliere, cioè
  paragrafi, run, testo, tabelle con righe e celle, link, note, commenti,
  immagini nuove, le proprietà di `Look` e `Layout`, inserimenti ed
  eliminazioni tracciati;
- per tutte le altre chiavi, il conteggio dopo deve essere uguale al conteggio
  prima, meno ciò che portavano gli oggetti che l'utente ha tolto. Un oggetto
  opaco cancellato porta via il suo markup, e Fub lo conosce perché sta nel
  modello di partenza (`InlineObject::Opaque`, oggetti incorporati, parti in
  `passthrough`);
- una differenza non spiegata → il salvataggio non scrive
  (`RichError::Fidelity`), e la shell tiene il proprio buffer.

**Normalizzazioni dichiarate.** Sono un elenco nel codice, una voce per riga,
ciascuna con la sua ragione e il suo test, come quelle che `fidelity.rs`
documenta già per il modello. Una voce entra soltanto se:

1. Word stesso la rigenera;
2. perderla non cambia contenuto, aspetto o comportamento del documento;
3. un test lo dimostra.

Candidati da verificare sul corpus, non da accettare in anticipo: `w:proofErr`,
`w:lastRenderedPageBreak`, gli attributi `w:rsid*`, il segnalibro `_GoBack`.
`mc:AlternateContent` con le sue `mc:Choice`/`mc:Fallback` **non** è un
candidato: se il codec ne perde una, il documento deve restare in sola lettura
finché il motore non le conserva.

**Limiti propri.** L'inventario legge lo ZIP per conto suo, quindi ha limiti
suoi, dello stesso ordine di `MAX_SOURCE_BYTES`: numero di voci, dimensione
decompressa per parte e totale, profondità XML, numero di elementi. Un limite
superato, uno ZIP illeggibile o un XML malformato producono sola lettura
all'apertura e rifiuto al salvataggio: fallisce chiuso.

**Dove.** Un modulo nuovo, `crates/fub-format-rich/src/inventory.rs`:

- all'apertura lo chiama `session::fidelity`, che calcola già
  `codec.write(document)`: si riusano quei byte; `open` passa anche i byte
  originali;
- al salvataggio lo chiama `session::save`, sui byte attuali e su quelli nuovi,
  dopo `reads_back`.

**Passi.**

1. **Test di regressione che oggi fallisce**, in
   `crates/fub-format-rich/tests/preservation.rs`:
   - un `.docx` con `w:altChunk` e la sua parte: `open` deve restituire
     `readonly: Some(ReadOnly::Codec)`;
   - un `.docx` con `w:eastAsianLayout`, scritto come proprietà indipendente
     dalla versione del motore: *se* si apre modificabile, *allora* dopo una
     modifica e un salvataggio l'inventario si conserva. Così il test vale sia
     con il pin attuale (dove deve aprirsi in sola lettura) sia con HEAD (dove
     si conserva).
2. **Test del salvataggio:**
   - un documento con un oggetto opaco: si modifica un altro paragrafo, e
     l'oggetto resta;
   - si cancella l'oggetto: il salvataggio scrive e l'oggetto non c'è più;
   - il confronto, chiamato direttamente su coppie di byte costruite apposta
     (un elemento non posseduto in meno, una relazione che punta alla parte
     sbagliata, una parte da copiare duplicata), rifiuta.
3. **`inventory.rs` con i suoi test unitari:** prefissi diversi per lo stesso
   spazio dei nomi non sono una perdita; ZIP troncato, XML malformato e limiti
   superati sono errori.
4. **Attivazione** all'apertura e al salvataggio.
5. **Test dell'host** in `crates/fub-host/tests/rich_documents.rs`: il
   documento con `altChunk` letto con `read_document` ha il motivo `codec`, e
   la scrittura è rifiutata con `host.rich.readonly.codec`.
6. **Un aiuto di misura** che stampa le differenze trovate sui documenti di
   esempio e sul primo nucleo del corpus: serve a F0b e alle normalizzazioni.
7. **Commenti e documentazione:** il commento di `Codec::lossless` e quello di
   `ReadOnly::Codec`; `docs/product/word-documents.md` (quando un documento si
   apre in sola lettura) e `docs/architecture/rich-surface-and-proofing.md`.
8. **Segnalare all'upstream** gli elementi persi trovati (F5).

**Criterio di uscita.**

- Il caso della sonda si apre in sola lettura.
- Il controllo gira anche a ogni salvataggio.
- Nessun test esistente regredisce.

#### F0b — La garanzia

**Tre meccanismi**, tutti posseduti da Fub:

1. **Valori.** Per l'inventario, un attributo diventa la coppia nome e valore
   **canonico**, e un elemento porta l'impronta del suo testo. I valori si
   canonizzano per tipo OOXML, in un modulo di Fub con i suoi test: booleani
   (`true`, `1`, `on`), colori esadecimali (maiuscole e minuscole), numeri
   (`12.0` uguale a `12`), misure. All'apertura i valori devono coincidere a
   meno delle normalizzazioni dichiarate (per esempio i valori degli `rsid`).
   Il confronto si fa per **blocco allineato**: i blocchi di primo livello
   (paragrafo, tabella, fine sezione, blocco opaco) dell'originale e della
   prova a vuoto si corrispondono uno a uno, perché senza modifiche il modello
   li tiene nello stesso ordine. Dentro un paragrafo si confronta a livello di
   paragrafo, non di run, perché il codec unisce i run uguali
   (`normalize_runs`). Una differenza dice quale blocco perderebbe cosa.
2. **Contenuto non toccato, blocco per blocco.** Al salvataggio, l'XML di ogni
   blocco e di ogni storia che l'utente non ha toccato dev'essere canonicamente
   **identico** allo stesso blocco nella **prova a vuoto della base**
   (`write(read(byte attuali))`): stesso writer, stessi nodi del modello.
   - I blocchi non toccati si riconoscono dalla proiezione: sono i blocchi della
     proiezione salvata identici, per contenuto e `k`, a quelli della
     proiezione della base, nell'ordine (un diff delle due liste). `save`
     proietta già la base e può calcolarlo da solo.
   - Le storie si riconoscono come fa già `stories.rs`, che riusa l'id di una
     storia quando è identica.
   - La prova a vuoto della base si calcola all'apertura. Si conserva legata
     alla revisione dei byte (CAS), e si ricalcola soltanto se la revisione è
     cambiata.
   - Prerequisito, da provare con un test: il writer è deterministico (lo stesso
     modello dà gli stessi byte, anche dopo un `clone`). Se non lo è, il
     confronto ricade sull'inventario con i valori per blocco, e il determinismo
     diventa una richiesta all'upstream (F5).
3. **Parti non possedute e relazioni.** Ogni parte da copiare così com'è resta
   identica byte per byte. Si ritrova per impronta del contenuto, qualunque nome
   abbia, e le relazioni verso di essa portano allo stesso contenuto. Il numero
   di copie è quello che il modello voluto chiede: nessuna duplicazione
   inattesa.

**Passi.**

1. Test di determinismo del writer.
2. Canonizzazione dei valori per tipo OOXML, con i suoi test.
3. Allineamento per blocchi e confronto, all'apertura (originale contro prova a
   vuoto) e al salvataggio (risultato contro prova a vuoto della base).
4. Conservazione della prova a vuoto per revisione.
5. Misura sul corpus (F1): normalizzazioni, falsi allarmi, documenti che
   passano in sola lettura.
6. Tempi di apertura e salvataggio sui documenti più grandi, prima e dopo: il
   limite accettabile si fissa dopo la prima misura.
7. Documentazione e ADR (F6).

**Criterio di uscita.**

- Test sintetici: un valore cambiato (`foo="A"` → `foo="B"`), una relazione
  che punta alla parte sbagliata e una parte da copiare duplicata sono rifiutati.
- Su ogni file modificabile del corpus, le modifiche standard di F1 passano con
  i blocchi non toccati identici.
- Le normalizzazioni dichiarate sono elencate, motivate e provate.
- I tempi stanno nel limite misurato.

#### Contratti, altri formati e rischi di F0

**Contratti.** Nessuno nuovo: si riusano `ReadOnly::Codec`, con il messaggio
esistente («Sola lettura: il documento non si rileggerebbe identico dopo un
salvataggio da qui.»), e `RichError::Fidelity` per il salvataggio rifiutato.
Più avanti si può aggiungere, in modo additivo, l'elenco di ciò che si
perderebbe; quel passo toccherebbe il mirror TypeScript, le fixture, l'host
finto e i messaggi localizzati.

**Altri formati.** Il codec ODT di Fub riscrive soltanto i blocchi cambiati:
gli stessi controlli possono pretendere che i blocchi non toccati restino byte
per byte, a basso costo. RTF e Word 97-2003 restano importatori in sola
lettura.

**Rischi.**

- **Più documenti reali si apriranno in sola lettura.** È la conseguenza onesta
  della regola, va misurata sul corpus e ridotta conservando di più nel motore
  (F5), non allentando i controlli.
- **F0b è un disegno vero**, non un controllo da poche righe: allineamento,
  canonizzazione, determinismo del writer. Per questo arriva dopo il primo
  nucleo del corpus.
- **Fub possiede un po' di conoscenza di OOXML** (classi delle parti, elenco
  posseduto dalla proiezione, normalizzazioni, tipi da canonizzare). La
  specifica è stabile e ogni voce ha un test.
- **Falsi allarmi** producono sola lettura o un salvataggio rifiutato, non
  perdite: sbagliano dal lato sicuro.

---

### F1 — Corpus di file reali e banco differenziale

**Obiettivo.** A ogni aggiornamento del motore, sapere esattamente cosa cambia
su documenti veri, prima di rilasciarlo.

**Perché.** Oggi non c'è nessun file reale (punto 4), e la suite attuale passa
identica con due versioni del motore che si comportano in modo diverso
(punto 5).

**In due tempi.**

1. **Primo nucleo**, subito dopo F0a: 10–15 file sulle righe più a rischio
   della matrice (Word moderno, oggetti con ripiego VML, `altChunk`, CJK,
   revisioni, commenti, DOCX scritti da LibreOffice e Google Docs). Serve a
   misurare F0a e a progettare F0b.
2. **Matrice completa**, in parallelo con F0b e F2.

#### Il corpus

**Dove:** `crates/fub-format-rich/tests/corpus/`, con una cartella per formato
(`docx/`, `odt/`, `rtf/`, `doc/`), un `MANIFEST.toml` e una cartella
`expected/` per i risultati attesi.

**Regole:**

- ogni file è creato apposta per il corpus, senza dati personali (autori di
  prova, testi di prova);
- licenza dichiarata: CC0, oppure `MIT OR Apache-2.0` come Fub; nessun file
  scaricato dal web con licenza ignota;
- file piccoli (indicativamente fino a 256 KB) e corpus contenuto
  (indicativamente fino a 15 MB);
- niente Git LFS, per non complicare clone e build offline;
- ogni voce del `MANIFEST.toml` dichiara origine, programma e versione che
  l'ha prodotto, licenza, cosa esercita e cosa ci si aspetta (modificabile, o
  sola lettura con quale motivo).

**Matrice di copertura** (almeno un file per riga):

| Gruppo | Contenuto | Prodotto con |
|---|---|---|
| Word moderno | stili, elenchi, tabelle con celle unite, intestazioni con campi, note, sezioni con pagine diverse | Word 365 Windows e Mac |
| Revisioni | inserimenti, eliminazioni, spostamenti, modifiche di formato, registrazione attiva | Word |
| Commenti | risposte, commenti risolti (`commentsExtended`, `commentsIds`) | Word |
| Oggetti | immagini in linea e ancorate, caselle di testo, forme DrawingML con ripiego VML, gruppi, SmartArt, grafici, equazioni, oggetti OLE | Word |
| Controlli | content control, moduli legacy, protezione per moduli | Word |
| Scritture | CJK (`eastAsianLayout`, ruby, testo verticale), RTL (ebraico, arabo), font incorporati | Word |
| Altri generatori | pandoc, python-docx, docx4j, LibreOffice, Google Docs, Pages | i rispettivi strumenti |
| Contenuto importato | `altChunk` HTML e RTF | docx4j o generatore equivalente |
| Pacchetto | parti custom XML, glossario, proprietà estese, relazioni esterne | Word, o a mano dalla specifica |
| Protezione | documento con password, documento protetto contro le modifiche | Word |
| Ostili | ZIP troncato, XML malformato, profondità eccessiva, voci duplicate, bomba di decompressione | script |
| OpenDocument | stili, note, tabelle, sezioni, revisioni | LibreOffice |
| RTF | documenti semplici e con tabelle | Word, WordPad, TextEdit |
| Word 97-2003 | documento normale e cifrato | Word |

#### Il banco: `crates/fub-format-rich/tests/corpus.rs`

Per ogni file:

1. `open`: motivo di sola lettura, impronta della proiezione, inventario e
   differenze trovate dai controlli di F0, riassunto del `DocumentModel` che
   vede l'indice (titoli, link, impronta del testo).
2. Per ogni formato di esportazione, l'elenco di ciò che la copia non porta
   (ADR 0211).
3. Se il documento è modificabile, le **modifiche standard** sulla proiezione:
   - E0: nessuna modifica → `Saved::Unchanged`;
   - E1: cambiare la prima parola del primo paragrafo di testo;
   - E2: spezzare un paragrafo;
   - E3: aggiungere un paragrafo in fondo;
   - E4: aggiungere un commento a una parola;
   - E5: togliere l'ultima riga di una tabella, se c'è.

   Dopo ognuna: salvataggio, riapertura, controlli di F0 verdi, proiezione
   riaperta uguale a quella voluta (a meno dei numeri delle parti).
4. Il risultato si confronta con `expected/<file>.json`. Una differenza fa
   fallire il test con un diff leggibile. `UPDATE_CORPUS=1` riscrive i
   risultati attesi, come già fanno `UPDATE_MIRROR=1` per `ts_projection` e
   `ts_paper`.

**Il confronto differenziale non richiede due motori.** I risultati attesi
committati *sono* il comportamento del motore precedente. In una PR di
aggiornamento si rigenerano con `UPDATE_CORPUS=1`, e il diff di `expected/` è
il report di cosa è cambiato: chi rivede la PR deve spiegare ogni riga
(«`eastAsianLayout` ora si conserva: il file X diventa modificabile»).

#### Prove di robustezza

- **Mutazioni deterministiche** dei file del corpus (troncamenti in punti fissi,
  byte cambiati con un seme noto, voci ZIP duplicate): `open` restituisce un
  esito o un errore, senza panic, entro un tempo limite. Poche mutazioni in
  `cargo test`, molte in un job settimanale.
- **Fuzzing** a ogni aggiornamento del motore, non a ogni CI: un crate
  `cargo fuzz` escluso dal workspace (richiede nightly), qualche decina di
  minuti su `open`.
- **Verifica esterna**, manuale, a ogni aggiornamento: alcuni file salvati da
  Fub si aprono in Word (Windows e Mac) e in LibreOffice senza richieste di
  riparazione. Un job facoltativo e non bloccante può convertirli con
  LibreOffice headless.
- **Tempi** di apertura e salvataggio in un test separato (`--ignored`) o in un
  benchmark, con un report; non dentro i risultati attesi, che devono restare
  deterministici.

#### Criterio di uscita

- Ogni riga della matrice ha almeno un file.
- Il banco gira dentro `cargo test --workspace`.
- I risultati attesi sono committati e il loro aggiornamento è documentato.

#### Rischi

- Servono persone con Word su Windows e Mac per produrre i file.
- I risultati attesi possono diventare rumorosi: devono restare piccoli e
  semantici (impronte e riassunti, non byte interi).

---

### F2 — Proiezione v2 e dati opachi verificati

**Obiettivo.** Un aggiornamento del motore non può rendere illeggibile una
bozza, né applicarla perdendo in silenzio parte della formattazione.

**Perché.** I dati opachi sono JSON del modello di WordCraft dentro bozze
autorevoli che viaggiano con il vault (punto 7). Un Fub più vecchio che legge
una bozza scritta da un Fub più nuovo scarterebbe in silenzio i campi che non
conosce. La proiezione è «JSON chiuso e versionato» (ADR 0209), e la shell ne
valida da sola versione e chiavi: se la grammatica dei dati opachi cambia, deve
cambiare la versione della proiezione.

#### Formato

```json
{ "format": "fub-rich", "version": 2, "opaque_schema": 1, "blocks": [] }
```

Le altre chiavi della proiezione restano quelle di oggi; `k` resta base64 del
JSON del modello.

| Proiezione | Schema dei dati opachi |
|---|---|
| `version: 1` (tutte le bozze e le proiezioni di oggi) | 0, implicito |
| `version: 2` | quello dichiarato in `opaque_schema` |

- `OPAQUE_SCHEMA` è una costante di Fub in `crates/fub-format-rich/src/blob.rs`
  e parte da 1. Si incrementa quando cambia la forma serializzata di uno dei
  tipi dentro i dati opachi.
- Ogni lettura dall'host (`open`, `blank`) produce sempre la versione 2 con lo
  schema corrente.

#### Lettura in Rust

| Caso | Comportamento |
|---|---|
| `version` maggiore di 2 | `RichError::Version(version)`, come oggi |
| `opaque_schema` uguale a `OPAQUE_SCHEMA` | si legge |
| `opaque_schema` maggiore (scritto da un Fub più nuovo) | errore tipizzato: `RichError::Version`, oppure una variante dedicata se il messaggio deve distinguere i due numeri; mai una lettura parziale |
| `opaque_schema` minore | migrazione esplicita, come il ripiego `SectKeep` → `SectionProps` di oggi, oppure il rifiuto |
| `version: 1` | schema 0: si legge con il controllo qui sotto |

`RichError::Version` arriva all'utente con il messaggio esistente
`host.rich.version`: «Il contenuto da salvare in «{doc}» è di una versione
({version}) che questo Fub non legge.» Il salvataggio rifiutato lascia la bozza
dov'è, come chiede la politica delle bozze («migra o rifiuta»; una bozza non
interpretabile «non si offre al recupero e non si perde»).

#### Il controllo a ogni lettura di un dato opaco

Per ogni `k`:

1. il testo JSON del dato diventa un `serde_json::Value` **A**;
2. il dato si decodifica nel tipo di WordCraft, che si serializza di nuovo **in
   testo** con `serde_json::to_vec`, e quel testo diventa un `Value` **B**;
3. **A deve essere contenuto in B**: ogni chiave di A c'è in B con un valore
   uguale, ricorsivamente; gli array hanno la stessa lunghezza e si confrontano
   elemento per elemento;
4. altrimenti → errore tipizzato (`RichError::Malformed`, «opaque data»).

Perché così:

- un campo che serde ha ignorato perché sconosciuto manca in B: il dato si
  rifiuta invece di perdere quel campo in silenzio;
- vale anche per lo schema 0, che così non si legge più alla cieca;
- si confrontano `Value`, non byte: l'ordine delle chiavi e le forme
  equivalenti non producono falsi allarmi;
- entrambi i lati passano dal testo: un `f32` convertito direttamente in
  `Value` diventerebbe un `f64` diverso dal numero scritto (`0.1` contro
  `0.10000000149011612`);
- «contenuto», non «uguale»: un campo nuovo con il suo valore predefinito, che
  compare in B ma non in A, non è una perdita.

Il costo è una serializzazione in più per dato opaco; si misura sul corpus.

#### La shell

- Il parser di `apps/client/src/editors/rich/projection.ts` accetta la versione
  1 e la 2, ciascuna con il suo elenco chiuso di chiavi (`opaque_schema` nella
  2).
- La shell **ricopia** `version` e `opaque_schema` così come li ha ricevuti e
  non li cambia mai da sola. Una bozza di versione 1 ripristinata si salva come
  versione 1; un documento aperto oggi si salva come versione 2. Così la shell
  non può dichiarare uno schema per dati opachi scritti con un altro.
- Il filtro dell'incolla (`apps/client/src/editors/rich/paste.ts`) toglie già i
  `k` che il documento non ha: dati opachi di un altro documento non si
  mescolano a quelli di questo.
- Un Fub vecchio, che conosce soltanto la versione 1, rifiuta una bozza di
  versione 2 con un errore chiaro: fallisce chiuso.

È un cambio del contratto IPC: si aggiornano insieme la forma serializzata in
Rust, il mirror TypeScript, le fixture
(`apps/client/src/__fixtures__/rich-projection.json` e `rich-edited.json`),
l'host finto e il test di conformità `crates/fub-format-rich/tests/ts_projection.rs`.
Nessuna porta IPC nuova.

#### Accorgersi che la forma è cambiata

- **Test golden** `crates/fub-format-rich/tests/opaque_schema.rs`, con
  `tests/opaque_schema.golden.json` che contiene lo schema e la
  serializzazione di un campionario di valori (`CharProps`, `ParaProps`,
  `SectionProps` con molti campi valorizzati, le varianti costruibili di
  `InlineObject`, un `Comment`):
  - se `OPAQUE_SCHEMA` è uguale a quello del file, la serializzazione deve
    coincidere;
  - se è maggiore, il file si rigenera con `UPDATE_MIRROR=1` e devono esistere
    le fixture dello schema precedente.
- **Sul corpus** (F1): ogni `k` di ogni proiezione passa il controllo di
  contenimento.
- **Fixture delle bozze vecchie**: a ogni aumento di schema si committano in
  `tests/fixtures/opaque/schema-<N-1>/` alcune proiezioni scritte dal motore
  precedente, con un test che le migra o le rifiuta, per scelta esplicita. La
  prima fixture è una proiezione di versione 1.

#### Da aggiornare

- `docs/reference/ipc-contract.md`: proiezione v2 e `opaque_schema`.
- `docs/reference/on-disk-layout.md`: le bozze con dati opachi di uno schema
  che questo Fub non legge.
- `docs/architecture/rich-surface-and-proofing.md`.

Facoltativo: controllare i dati opachi già quando si offre una bozza al
recupero, attraverso una porta esistente. Nessuna porta IPC dedicata, a meno
che nessuna esistente ne esprima la semantica.

#### Criterio di uscita

- Le letture dall'host producono la versione 2 con lo schema corrente.
- La shell accetta 1 e 2 e ricopia versione e schema.
- I test coprono: versione e schema futuri rifiutati, versione 1 letta con il
  controllo, un campo sconosciuto rifiutato, migrazione da una fixture, test
  golden.
- Test dell'host: una bozza con schema futuro non si salva e resta intatta.

#### Rischi

- Un Fub vecchio non legge le bozze nuove. È voluto: fallisce chiuso.
- La disciplina di incrementare `OPAQUE_SCHEMA` la impone il test golden, ma
  il campionario può non coprire ogni campo; il controllo di contenimento e il
  corpus coprono il resto.

---

### F3 — Vendor derivato: la copia rigenerata da uno script

**Obiettivo.** La copia di WordCraft dentro Fub è sempre esattamente
«upstream a uno SHA preciso più le patch di Fub», e si aggiorna con un comando.

**Perché.** Oggi la procedura di `vendor/wordcraft/UPSTREAM.md` è manuale.
Inoltre metà delle patch (quelle per clippy) esiste soltanto perché i sei crate
sono membri del workspace di Fub.

#### Struttura di arrivo

```text
vendor/wordcraft/
  UPSTREAM.md        per le persone: provenienza, politica, procedura
  upstream.lock      per lo script: repository, SHA, file e impronte
  Cargo.toml         di Fub: il workspace dei sei crate
  Cargo.lock         del workspace di vendor/, per i test del motore
  patches/           le modifiche di Fub, una per file .patch, in ordine
  crates/            geom, doc, docx, docbin, formats, proof: upstream + patch
  assets/            hyphenation, spelling: copiati senza modifiche
  LICENSE-MIT, LICENSE-APACHE, NOTICE, rustfmt.toml
```

#### Scelte

1. **Un piccolo workspace dentro `vendor/wordcraft/`.** Il suo `Cargo.toml` è
   di Fub e contiene:
   - `[workspace] members` con i sei crate;
   - `[workspace.package]`: `version` dell'upstream, `edition = "2024"`,
     `license`;
   - `[workspace.dependencies]` con le versioni e le feature scelte da Fub:
     `zip` 9.0.5, `serde_json` senza `float_roundtrip`, `image` con i soli
     decoder voluti, le stesse versioni del `[workspace.dependencies]` di Fub
     per le dipendenze in comune;
   - `[workspace.lints]` permissivi: è codice di terzi.

   I manifest dei sei crate restano **quelli dell'upstream, senza modifiche**:
   ereditano dal workspace `version`, `edition`, `license` e, dove lo
   dichiarano, `lints`; nessuno dichiara `rust-version`. Le decisioni di Fub
   stanno in un file solo, invece che riscritte in sei manifest.
2. **Fuori dal workspace di Fub.** Nel `Cargo.toml` radice si tolgono i sei
   crate da `members` e si aggiunge `"vendor/wordcraft"` a `exclude`. Le righe
   `wordcraft-* = { path = …, version = … }` di `[workspace.dependencies]`
   restano; la `version` la aggiorna lo script.

   Provato in una copia separata, con Rust 1.97: una dipendenza a percorso che
   appartiene a un altro workspace eredita i campi da quel workspace, e
   `cargo clippy … -- -D warnings` di Fub mostra un avviso introdotto apposta
   nel crate esterno come avviso, senza fallire. Da riverificare con Rust 1.89.
3. **Patch che spariscono:** le sei condizioni `cfg_attr` sui `deny` di clippy,
   la variabile rinominata in `proof/src/ru/mod.rs`, il `let` irrefutabile di
   `docbin/src/fmt.rs`, i manifest riscritti a mano. Da confermare durante
   l'implementazione con l'intero ciclo di `CONTRIBUTING.md` su Rust 1.89.
4. **Patch che restano:**
   - `zip` 9: `docx/src/package.rs`, i sei test di `docx/tests/` e il test di
     `formats/src/odt.rs`;
   - `settings_kept_unowned`, con la correzione per `<w:compat/>` (punto 6),
     finché l'upstream non la accetta (F5).
5. **Decisione da misurare: le dipendenze soltanto per `wasm32`** (`js-sys` in
   `formats`, la dipendenza di `getrandom` per `wasm32` in `docx`):
   - (a) definirle nel workspace di `vendor/` (zero patch; `Cargo.lock` cresce
     con crate che sul desktop non si compilano e che `cargo deny` ignora per
     via di `[graph] targets`);
   - (b) una piccola patch che toglie quelle sezioni (`Cargo.lock` uguale a
     oggi).

   Si misura il diff di `Cargo.lock`: se (a) aggiunge crate nuovi, si sceglie
   (b).
6. **Due risoluzioni distinte, provate entrambe.**
   - La build reale di Fub usa il `Cargo.lock` di Fub, perché i sei crate sono
     dipendenze a percorso nel suo grafo: lì si prova il codice che si
     rilascia, con i test di Fub.
   - I test dell'upstream girano nel workspace di `vendor/`, con il suo
     `Cargo.lock` committato:
     `cargo test --manifest-path vendor/wordcraft/Cargo.toml --workspace --locked`.
   - I due lock risolvono contesti diversi (dipendenze dei test, feature), e non
     si cerca di renderli identici. Lo script controlla soltanto che le
     dipendenze dirette in comune abbiano la stessa versione, e mostra il diff
     di `cargo tree` del grafo di Fub prima e dopo un aggiornamento.
7. **`cargo fmt --all` formatta anche le dipendenze a percorso:** il
   `rustfmt.toml` dell'upstream resta in `vendor/wordcraft/`, come oggi.

#### Lo script: `tools/vendor-wordcraft/vendor.mjs`

Node 22, come i guard in `.github/scripts/`, senza dipendenze nuove.

**`update --rev <SHA di 40 caratteri> [--source <percorso o URL>]`**

1. Recupera quella revisione (da un clone locale o dall'URL: upstream o
   mirror).
2. Estrae con `git archive` soltanto i percorsi gestiti: i sei crate,
   `assets/hyphenation`, `assets/spelling`, licenze, `NOTICE`, `rustfmt.toml`.
3. Applica le patch in ordine (`git apply --check`, poi `git apply`). Se una non
   si applica, si ferma, dice quale e mostra il punto: non scrive niente.
4. Confronta le dipendenze dei manifest dell'upstream con quelle della
   revisione precedente e stampa aggiunte e rimozioni (per esempio
   `wordcraft-docx: + unicode-bidi`): ognuna va rivista per licenza e avvisi.
5. Verifica che ogni dipendenza ereditata con `workspace = true` sia definita
   nel `Cargo.toml` di `vendor/`, e che le dipendenze dirette in comune con Fub
   abbiano la stessa versione.
6. Calcola lo sha256 di ogni file, originale e risultato, e scrive
   `upstream.lock`.
7. Aggiorna la `version` delle righe `wordcraft-*` nel `Cargo.toml` radice di
   Fub.
8. Sostituisce i percorsi gestiti soltanto alla fine, quando tutti i passi sono
   riusciti.
9. Stampa un riassunto e i passi successivi (test, corpus, F7).

**`check`** (senza rete, veloce, in CI):

- ogni file gestito esiste e ha l'impronta del risultato;
- in una cartella temporanea, l'**intera pila** di patch si toglie in **ordine
  inverso** (dall'ultima alla prima), e il risultato deve avere le impronte
  degli originali. Togliere una patch da sola sul risultato finale non basta:
  due patch possono toccare la stessa zona;
- nei percorsi gestiti non ci sono file in più;
- le versioni `wordcraft-*` di Fub coincidono con quella del workspace di
  `vendor/`;
- le dipendenze dirette in comune sono allineate.

Una modifica a mano dentro `vendor/` che non sta in una patch fa fallire
`check`.

**`verify-upstream`** (con rete, facoltativo o settimanale): scarica la
revisione dall'upstream e dal mirror, se esiste; verifica che le impronte degli
originali coincidano con `upstream.lock` e che applicare la pila in ordine dia
le impronte dei risultati.

#### Formato di `upstream.lock`

```toml
repository = "https://github.com/storytold/wordcraft"
rev = "eae242176108d328c5dd81fbc10370c51ab90706"
tag = ""            # informativo: un tag si può spostare, lo SHA no
date = "2026-10-15"

[[file]]
path = "crates/docx/src/package.rs"
upstream = "sha256:…"
result = "sha256:…"          # assente se il file non ha patch

[[patch]]
path = "patches/0001-zip-9.patch"
sha256 = "sha256:…"
```

#### Migrazione, un commit per passo

1. Estrarre le patch dal diff attuale fra la copia e l'upstream al pin.
2. Scrivere lo script. Provare che `update --rev eae242176108…` riproduce
   **byte per byte** la copia di oggi, prima di qualunque ristrutturazione:
   dimostra che lo strumento è equivalente alla procedura manuale.
3. Introdurre il workspace di `vendor/`, `exclude` nella radice, togliere le
   patch per clippy; eseguire l'intero ciclo di `CONTRIBUTING.md`.
4. CI: `check` nel job `invariants`, i test del motore nel job `test`.
5. Riscrivere `UPSTREAM.md` e aggiornare il commento del `Cargo.toml` radice
   sulla copia vendorizzata; ADR (F6).

#### Criterio di uscita

- `check` verde in CI.
- `update` con lo stesso SHA non cambia niente.
- Il ciclo completo di `CONTRIBUTING.md` è verde.
- I test del motore girano in CI.
- Il diff di `Cargo.lock` di Fub è stato rivisto: nessun crate nuovo inatteso.

#### Rischi

- I lint di Fub non guardano più il codice del motore: è voluto, è codice di
  terzi.
- Se l'upstream committa codice non formattato, `cargo fmt --all --check`
  fallisce come oggi; lo script può segnalarlo in anticipo.

---

### F4 — Confini delle dipendenze in CI

**Obiettivo.** Nessun crate di Fub può iniziare a usare WordCraft senza una
decisione esplicita.

#### Un test nuovo in `crates/fub-abi/tests/dependency_invariant.rs`

È il posto che `deny.toml` indica già per gli invarianti del grafo; il file ha
già gli aiuti per leggere `cargo metadata`.

- **Proprietari di WordCraft**: per ogni membro del workspace, le dipendenze
  dirette `wordcraft-*`, con il loro tipo, devono stare in questo elenco:

  | Membro | Crate WordCraft ammessi | Tipo |
  |---|---|---|
  | `fub-format-rich` | `doc`, `docx`, `formats`, `docbin` | normale |
  | `fub-format-rich` | `geom` | test |
  | `fub-features` | `proof` | normale e opzionale |
  | `fub-host` | `formats` | test |

- **Chiusure pulite**: le dipendenze, anche indirette, di `fub-abi`,
  `fub-kernel` e `fub-sdk` non contengono `wordcraft-*`.
- **Correttore opzionale**: `wordcraft-proof` è opzionale in `fub-features`,
  quindi una build senza la feature `proof` non contiene WordCraft.

Il test continua a funzionare dopo F3: le dipendenze a percorso compaiono in
`cargo metadata` come pacchetti. Ogni motore nuovo (F9) aggiunge le sue righe.

#### Regole che il test non vede

- Nel codice di libreria, soltanto `crates/fub-format-rich/src/**` e
  `crates/fub-features/src/proof.rs` importano `wordcraft_*`. Un guard leggero
  (uno script in `.github/scripts/` che cerca `wordcraft_` nei sorgenti) può
  imporlo; è facoltativo.
- La shell non decodifica mai `k`. Gli unici file della shell derivati da
  WordCraft sono quelli generati dai test di `fub-format-rich`
  (`paper.generated.ts`).
- Il correttore resta un secondo adattatore, con le sue regole: nessun tipo
  WordCraft nell'API pubblica (vero oggi), e ogni lingua nuova del motore entra
  in Fub per decisione (dizionari, licenze, localizzazione), non per
  aggiornamento.

#### Criterio di uscita

Il test è in CI. Un `wordcraft-*` aggiunto a un altro crate lo fa fallire con un
messaggio che spiega a chi chiedere.

---

### F5 — Contributi a WordCraft

**Obiettivo.** Ridurre le patch di Fub a zero portando le correzioni dove
appartengono.

| Priorità | Proposta | Beneficio per l'upstream | Patch di Fub che elimina |
|---|---|---|---|
| 1 | Aggiornare `zip` da 3 a 9 | chiude tre avvisi di sicurezza | `zip` 9 |
| 2 | Un lettore che resta tollerante ma **riporta** ciò che ha scartato (per esempio `read_with_report`) | WordCraft può avvisare i suoi utenti | rende più precisa la sola lettura di F0 |
| 3 | Conservare gli elementi persi trovati da F0 (prima `altChunk` con la sua parte e la sua relazione) | fedeltà sui file reali, lacuna dichiarata nel loro ROADMAP | meno documenti in sola lettura in Fub |
| 4 | Un writer deterministico (stesso modello, stessi byte), dichiarato e provato | salvataggi riproducibili, diff leggibili | il ripiego di F0b sull'inventario per blocco |
| 5 | `settings_kept_unowned`, con la correzione per `<w:compat/>`, accanto a `merge` e con i suoi test; oppure `merge` che restituisce ciò che ha tolto | lo stesso controllo per il loro salvataggio | `settings_kept_unowned` |
| 6 | Manifest adatti a chi incorpora: `float_roundtrip` tolto se serve soltanto a leggere un colore; decoder di `image` dietro feature | meno dipendenze per chi incorpora | le scelte del `Cargo.toml` di `vendor/` diventano opzionali |
| 7 | `#[non_exhaustive]` sugli enum pubblici usati da chi incorpora (`ProofLang`, `IssueKind`…) e un registro dei cambiamenti dell'API dei crate del motore | aggiornamenti meno fragili per chi incorpora | correzioni come quella di `ProofLang::Id` |
| 8 | Una politica di MSRV per i crate del motore (una CI con la versione minima) | chiarezza per chi incorpora | il rischio di funzioni troppo nuove per Rust 1.89 |
| 9 | A lungo termine, pubblicare i crate del motore su crates.io | dipendenza normale con checksum | il vendor, se mai (F8) |

**Metodo:**

- prima una issue per discutere, poi la PR;
- le PR partono da una fork personale o `Fubeo`: la fork serve a ospitare i
  branch delle PR, non come sorgente della build;
- ogni proposta ha una issue in Fub con il link;
- quando la modifica entra upstream e Fub aggiorna oltre quel commit, la patch
  corrispondente si cancella da `vendor/wordcraft/patches/`.

**Decisione di Fub collegata:** allineare l'MSRV di Fub a 1.95 (rilasciata ad
aprile 2026) eliminerebbe la classe di rischio della riga 8. Tocca la CI, i
pin del toolchain, `CONTRIBUTING.md` e `check-locale-loop.mjs`, che verifica la
1.89. È una scelta a sé, da valutare con le altre ragioni che tengono Fub su
1.89.

---

### F6 — Documentazione e decisioni

**ADR nuovi**, numerati dopo la 0211:

- **0212 — Preservazione misurata sul pacchetto** (F0 e F2): rilevatore e
  garanzia all'apertura e a ogni salvataggio, sola lettura e rifiuto, proiezione
  v2 con i dati opachi verificati. Alternative da riportare: fidarsi del
  motore; un codec DOCX di Fub come per l'ODT (molto più costoso).
- **0213 — Provenienza e aggiornamento dei motori esterni** (F3, F4, F7, F8): il
  vendor derivato, i proprietari, la cadenza, i criteri per rivalutare fork e
  Git.
- **0214 — GridCraft motore del foglio di calcolo, `.fubsheet` legacy** (F9),
  quando la decisione si formalizza.

I primi due integrano la 0209 (che dice «vendorizzati» e ha una sezione
«Verifica») senza riscriverla; il terzo integra la 0201.

**Pagine canoniche da aggiornare**, ciascuna quando la sua fase entra in
`main`:

- `vendor/wordcraft/UPSTREAM.md` (F3);
- `docs/architecture/components-and-boundaries.md`: i proprietari di WordCraft
  (F4);
- `docs/architecture/rich-surface-and-proofing.md` (F0, F2);
- `docs/product/word-documents.md`: quando un documento si apre in sola lettura
  e quando un salvataggio si rifiuta (F0);
- `docs/reference/ipc-contract.md`: la proiezione v2 (F2);
- `docs/reference/on-disk-layout.md`: le bozze con dati opachi illeggibili (F2).

Si eseguono tutti i guard documentali elencati in `CONTRIBUTING.md`.

Questo piano e l'avanzamento **non** entrano nelle pagine canoniche:
l'avanzamento vive nelle issue.

---

### F7 — Aggiornare WordCraft quando lo decidi tu

**Nessun aggiornamento automatico.** La versione è scritta in
`vendor/wordcraft/upstream.lock` e cambia soltanto con una PR che la cambia. Non
si aggiungono bot di aggiornamento per WordCraft.

**Cadenza.** La decide il proprietario del progetto; come riferimento, una volta
ogni uno o due mesi, oppure prima di una release di Fub. Più è lungo
l'intervallo, più è grande il salto da controllare: l'upstream ha fatto 288
commit in cinque giorni.

**Eccezioni di sicurezza.**

- Il job `supply-chain` (`cargo deny check`) gira ogni lunedì e a ogni push:
  segnala gli avvisi noti delle librerie di crates.io, comprese quelle che usa
  WordCraft (per esempio `zip`). Quelle librerie Fub le aggiorna anche da sola,
  come ha già fatto con `zip` 9.
- Per i difetti nel codice di WordCraft stesso non esiste un avviso automatico,
  perché i crate non sono su crates.io. Si leggono le note di versione a ogni
  aggiornamento; il proprietario può attivare su GitHub «Watch → Releases» per
  il repository upstream.

**Scegliere la revisione.** Meglio un tag dell'upstream (`v0.x.0`) che un commit
qualsiasi, perché marca un punto di rilascio. Nel file si scrive comunque lo
SHA completo: un tag si può spostare.

#### Lista di controllo di un aggiornamento

1. Branch dedicato, per esempio `chore/wordcraft-v0.9.0`.
2. Leggere cosa è cambiato:
   `git log <vecchio>..<nuovo> -- crates/{doc,docx,docbin,formats,geom,proof}`
   e il registro in fondo a `docs/file-format-parity.md` dell'upstream.
3. `node tools/vendor-wordcraft/vendor.mjs update --rev <SHA>`. Se una patch
   non si applica: aggiornarla, oppure cancellarla se l'upstream la contiene
   già, in un commit separato.
4. Rivedere le dipendenze nuove o tolte che lo script riporta; eseguire
   `cargo deny check` e `cargo tree -d` per i duplicati.
5. Compilare. Gli errori si correggono **soltanto** negli adattatori
   (`fub-format-rich`, `fub-features/src/proof.rs`).
6. Rileggere ogni patch rimasta contro il file dell'upstream che rispecchia (per
   esempio `kept_unowned` contro `merge`).
7. Eseguire i test del motore da soli, poi l'intero ciclo di `CONTRIBUTING.md`,
   comprese le fixture TypeScript della superficie ricca.
8. `UPDATE_CORPUS=1`: leggere il diff di `expected/`. Ogni cambiamento si spiega
   nella PR come miglioramento, peggioramento o neutro. Un peggioramento blocca,
   oppure si accetta con una ragione scritta. Una perdita silenziosa la fermano
   i controlli di F0, nei limiti di ciò che misurano; il corpus serve anche a
   scoprire quei limiti. Un documento che passa da modificabile a sola lettura
   è una regressione da pesare.
9. Se il test golden dei dati opachi cambia: incrementare `OPAQUE_SCHEMA`,
   scrivere la migrazione, aggiungere le fixture dello schema precedente.
10. Verifica manuale: alcuni file salvati si aprono in Word e LibreOffice.
11. Fuzzing breve su `open`.
12. `UPSTREAM.md` e `upstream.lock` aggiornati dallo script; una voce in
    `CHANGELOG.md` con i cambiamenti visibili all'utente.
13. PR che contiene soltanto l'aggiornamento e le correzioni necessarie, con le
    sezioni di `CONTRIBUTING.md`: problema e risultato, confini toccati, test
    eseguiti, compatibilità (bozze comprese).

#### Il primo giro, come prova generale

Dopo F0b, F1, F2 e F3, il primo aggiornamento (verso `v0.8.0` o un tag
successivo) mette alla prova la procedura. Dalle prove di questo piano si sa già
cosa troverà:

- la patch di `settings_kept_unowned` va aggiornata (l'esportazione in
  `lib.rs` non si applica più) e corretta per `<w:compat/>`;
- `proof.rs` va adattato: il parametro `list_item` di `check_text_with` e una
  decisione su `ProofLang::Id`;
- il corpus mostrerà cambiamenti di comportamento, per esempio `eastAsianLayout`
  conservato;
- `docx` porta una dipendenza nuova, `unicode-bidi`, da rivedere.

---

### F8 — Quando rivalutare fork e sorgente Git

Da rivalutare dopo almeno due aggiornamenti fatti con F7. Una dipendenza Git,
dall'upstream o da una fork `Fubeo/wordcraft`, diventa sensata soltanto se
valgono **tutte** queste condizioni:

1. nessuna patch di sorgente specifica di Fub: soltanto modifiche accettate
   upstream;
2. i manifest dell'upstream vanno bene così come sono. Con una dipendenza Git,
   le feature e le dipendenze le decide il workspace dell'upstream, non il
   `Cargo.toml` di `vendor/`. Si verifica con il diff di `cargo tree` e con
   `cargo deny check`;
3. l'MSRV è compatibile: l'upstream prova la versione minima di Fub, oppure Fub
   è salito alla sua;
4. esiste un mirror sotto `Fubeo` con branch e tag protetti (niente force-push,
   niente cancellazioni);
5. la build offline delle release è provata (`cargo vendor` e archivio
   sorgente);
6. `cargo-deny` ammette soltanto quell'URL (`allow-git` ristretto,
   `unknown-git = "deny"`);
7. due aggiornamenti consecutivi sono passati senza modifiche a mano.

Se l'upstream pubblica i crate del motore su crates.io con un versionamento
semantico, l'opzione migliore diventa la dipendenza normale da crates.io, con i
checksum in `Cargo.lock`, e la copia locale si può togliere.

In ogni caso restano: rilevatore e garanzia (F0), corpus e banco (F1),
proiezione versionata e dati opachi verificati (F2), guard (F4), procedura
(F7).

**Gate prima di togliere la copia locale** (se F8 lo decide):

1. rilevatore e garanzia di F0 attivi e verdi su tutto il corpus, all'apertura
   e al salvataggio;
2. corpus completo secondo la matrice di F1;
3. banco differenziale senza differenze fra copia locale e nuova sorgente allo
   stesso SHA;
4. modifiche standard verdi su ogni file modificabile;
5. bozze della proiezione e dello schema precedenti lette o rifiutate per scelta
   esplicita;
6. test del correttore e dell'esportazione con perdita misurata (ADR 0211)
   verdi;
7. supply chain: `cargo deny check` con `allow-git` ristretto,
   `cargo build --locked --offline` dopo un `cargo fetch`, SBOM con sorgente e
   SHA;
8. tempi di apertura e salvataggio entro i limiti misurati;
9. fuzzing breve senza panic.

---

### F9 — GridCraft, PdfCraft, VectorCraft

#### Il metodo comune

Ogni motore nuovo entra con lo stesso contratto:

1. **Un adattatore per motore** (`fub-format-<x>`), unico proprietario delle sue
   dipendenze, con le sue righe nel test di F4.
2. **I crate del dominio, non la facciata.** I motori Craft hanno una facciata
   applicativa (`engine`, con comandi, sessione, cronologia, selezione) sopra i
   crate del dominio. Fub prende il dominio e tiene per sé sessione, comandi e
   cronologia. Quando una logica di dominio vive soltanto nella facciata, si
   chiede all'upstream di spostarla (come in F5) oppure la funzione resta in
   sola lettura.
3. **Controlli di preservazione di Fub**, indipendenti dal motore e adatti al
   formato, all'apertura e a ogni salvataggio.
4. **Dati opachi versionati**, se attraversano bozze o altri dati persistenti.
5. **Corpus e banco differenziale** dal primo giorno.
6. **Vendor derivato** con lo stesso script, reso parametrico (per esempio
   `tools/vendor-craft/` con una configurazione per motore).
7. **Revisione di sicurezza:** input non fidato, limiti di risorse di Fub
   attorno a ogni chiamata, politica sul codice `unsafe`, peso delle
   dipendenze.
8. **Regole di ciclo di vita di `AGENTS.md`:** nessun lock del workspace durante
   una chiamata al motore; il lavoro lungo passa da un job con stato,
   cancellazione e risultato.

#### GridCraft (fogli di calcolo)

**Direzione indicata dal proprietario del progetto:** GridCraft diventa il
motore del dominio del foglio di calcolo, e `.fubsheet` passa gradualmente a
formato legacy da importare.

Questa direzione sostituisce la proposta della prima stesura («GridCraft
soltanto codec XLSX; modello e calcolo restano di Fub»). Quella proposta avrebbe
tenuto accanto due modelli e due motori di calcolo, e con il motore attuale di
Fub avrebbe valutato le formule di un `.xlsx` con una semantica che non è quella
di Excel.

**Struttura di GridCraft** (dipendenze verificate dai manifest):

| Crate | Dipende da (crate GridCraft) |
|---|---|
| `core` | — |
| `formula` | `core` |
| `functions` | `core` |
| `numfmt` | `core` |
| `model` | `core`, `formula` |
| `calc` | `core`, `formula`, `functions`, `numfmt`, `model` |
| `xlsx` | `core`, `formula`, `model` |
| `engine` | tutti i precedenti, più `chart` e `pdf` |

`engine` è la facciata: ogni azione è un comando con un id stabile e passa da
`Session::execute`, che la registra nel journal; contiene anche la selezione.
Il repository dichiara edition 2024 e `rust-version = "1.90"`.

**Il confine.**

- **GridCraft possiede** `core`, `formula`, `functions`, `numfmt`, `model`,
  `calc` e `xlsx`: il modello del workbook, le formule con la semantica di
  Excel, il grafo delle dipendenze e il ricalcolo, il codec XLSX.
- **Fub non prende** `engine` (la sua sessione, i comandi, la cronologia e la
  selezione sono il lavoro della DocumentSession e della shell di Fub),
  `ui-egui` e `mcp`. `chart` e `pdf` si valutano dopo.
- **Fub possiede** DocumentSession, identità del file, CAS, recupero e
  conflitti, link e grafo, la proiezione a finestre, l'interfaccia e i controlli
  di preservazione. La proiezione a finestre è già un contratto di Fub: il
  contratto `grid` di `crates/fub-abi/src/grid.rs` e l'ADR 0201, in cui il
  provider risponde per finestre e applica patch a coordinate stabili. GridCraft
  ne diventa un provider, accanto a `.fubsheet`.
- **Uno strato di indirizzi di Fub** sopra le coordinate posizionali di
  GridCraft: identità stabili di celle e intervalli, aggiornate a ogni
  operazione strutturale (inserire o togliere righe e colonne, ordinare,
  spostare). Serve ai link e al contratto `grid`, che chiede coordinate stabili.

**Da verificare prima di impegnarsi** (il gate di GridCraft):

1. **Logica di dominio nella facciata.** `engine` contiene i moduli `pivot`,
   `pivot_calc`, `cf` (formattazione condizionale), `tables`, `fill` e `links`
   (verificato dall'elenco dei moduli). Finché restano lì, le tabelle pivot, la
   formattazione condizionale, le tabelle strutturate e il riempimento si
   conservano senza modificarli; si chiede all'upstream di spostare quella
   logica in crate senza facciata.
2. **Operazioni strutturali** disponibili da `model` o `calc` senza passare da
   `Session::execute`: altrimenti lo strato di indirizzi non le vede.
3. **Ricalcolo** incrementale e deterministico, e una politica esplicita per i
   valori in cache e per le funzioni volatili (`NOW`, `RAND`). Un salvataggio
   che cambia valori che l'utente non ha toccato deve essere dichiarato, non
   implicito.
4. **Prestazioni** delle finestre su fogli grandi.
5. **Preservazione dell'XLSX** con i due livelli di F0: cache delle tabelle
   pivot, collegamenti esterni, convalida dei dati, formattazione condizionale,
   grafici, nomi definiti, formule condivise e matrici dinamiche, sistemi di
   data 1900 e 1904, macro.
6. **Sicurezza e dipendenze** dei crate del dominio, come per WordCraft: codice
   `unsafe` (`engine` dichiara `forbid(unsafe_code)`; gli altri crate sono da
   verificare), avvisi delle dipendenze, MSRV.

**`.fubsheet` verso legacy.**

- I file esistenti degli utenti restano leggibili: nessuna cancellazione o
  riscrittura per tentativi, secondo le regole di persistenza di `AGENTS.md`.
- Una conversione esplicita verso `.xlsx`, con l'elenco di ciò che la copia non
  porta, come le copie esportate dell'ADR 0211.
- Il provider `.fubsheet` e il suo `formula.rs` restano congelati per leggere,
  ed eventualmente modificare durante la transizione. Vale sempre un solo
  motore di calcolo per tipo di documento: `.xlsx` → GridCraft, `.fubsheet` →
  il motore attuale, finché esiste.
- Il contratto `grid` di `fub-abi` e l'esempio WASM `esempi/grid-wasm` sono
  generici e restano.
- La decisione si formalizza in un ADR (F6), perché è costosa da invertire.

**Sequenza.**

1. XLSX in sola lettura attraverso la famiglia `grid`, con GridCraft come
   provider.
2. Modifica di un sottoinsieme, con i controlli di preservazione.
3. Strato di indirizzi e link alle celle.
4. Conversione da `.fubsheet` a `.xlsx`.
5. Pivot, formattazione condizionale e tabelle quando la loro logica esce dalla
   facciata.

#### PdfCraft

Situazione: PdfCraft ha 34 crate (`a11y`, `annot`, `audit`, `automation`,
`compare`, `content`, `cos`, `create`, `crypt`, `edit`, `engine`, `export`,
`filters`, `fonts`, `forms`, `geom`, `js`, `measure`, `model`, `ocr`,
`optimize`, `oracle`, `organize`, `platform`, `preflight`, `print`, `redact`,
`render`, `sign`, `testkit`, `ui-egui`, `xfa`, `xfdf`); edition 2024;
`rust-version = "1.95"`. Il suo `engine` salva come **aggiornamento
incrementale** del file aperto, e i suoi test verificano che i byte originali
restino un prefisso del file salvato (`crates/engine/src/lib.rs`,
`crates/engine/src/tests.rs` di PdfCraft). Fub usa già `hayro`, `lopdf` e
`svg2pdf` (feature `draw` di `fub-features`, PDF annotati).

Un PDF non si proietta e si riscrive. **Il controllo di preservazione di Fub ha
quattro parti:**

1. **Prefisso originale invariato.** Necessario, non sufficiente.
2. **Validazione della sezione incrementale.** La catena di xref e trailer è
   valida, e un nuovo catalogo o albero delle pagine non rende irraggiungibile
   contenuto precedente senza che l'operazione lo dichiari.
3. **Invarianti dell'operazione.** Per un'annotazione cambiano soltanto gli
   oggetti dell'annotazione e l'array `/Annots` delle pagine toccate: niente
   modifiche inattese all'albero delle pagine, ai contenuti di pagina o
   all'AcroForm. Ogni operazione dichiara ciò che può toccare.
4. **Policy delle firme.** Conservare i byte firmati non basta a conservare la
   validità di una firma né il permesso di un documento certificato. Prima di
   salvare si controllano i permessi (DocMDP per i documenti certificati,
   FieldMDP per i campi) e si rifiuta una modifica non permessa, oppure la si
   dichiara.

Una riscrittura completa invalida le firme e si fa soltanto su richiesta
esplicita («ottimizza», «salva come»).

Proposta:

1. adozione per capacità, non in blocco: per esempio `annot` e `xfdf` per le
   annotazioni, `forms` per i moduli;
2. il salvataggio incrementale sta nella facciata `engine`: vale il punto 2 del
   metodo comune (prenderne la logica senza la sessione, o chiederne lo
   spostamento);
3. niente `js` (esecuzione di JavaScript dei PDF) e niente `xfa` all'inizio;
4. un solo motore di resa: `hayro` o `render`, non entrambi;
5. i parser PDF sono fra le superfici d'attacco più esposte: limiti di risorse,
   fuzzing, e una valutazione dell'isolamento in `fub-wasm-host` o in un
   processo separato.

#### VectorCraft e FubDraw

FubDraw ha già semantiche sue (`fub-scene`, `fub-ink`, `fub-format-svg`, ADR
0203). VectorCraft si usa per algoritmi specifici (per esempio operazioni sui
tracciati), dietro il modello di scena di Fub, mai come modello del documento.
La struttura di VectorCraft non è stata ispezionata per questo piano.

---

## Supply chain e riproducibilità

| Aspetto | Oggi | Con il vendor derivato | Con una dipendenza Git (se F8) |
|---|---|---|---|
| Sorgente del motore | nel repository | nel repository, con `upstream.lock` | rete, al momento della build |
| Integrità | revisione umana | impronte sha256 verificate da `check` | SHA del commit in `Cargo.lock`, senza checksum aggiuntivo |
| Disponibilità | totale | totale | legata a un repository che si può riscrivere o cancellare |
| Revisione di un aggiornamento | diff del codice nella PR | diff del codice nella PR, più report del corpus | una riga di SHA nella PR |
| `cargo-deny`, sorgenti | soltanto crates.io | soltanto crates.io | `allow-git` ristretto |
| Build offline | sì | sì | soltanto con `cargo vendor` o una cache |
| Modifiche a mano non dichiarate | possibili | impossibili (`check`) | impossibili |

Per una dipendenza Git, se un giorno ci sarà:

- `rev` con lo SHA completo, mai un tag o un branch, verificato da uno script
  sul modello di `check-cargo-versions.mjs`;
- un mirror protetto sotto `Fubeo`;
- `--locked --offline` per le release;
- l'archivio sorgente del motore allegato alla release.

## Rischi residui e decisioni aperte

| Tema | Proposta | Chi decide |
|---|---|---|
| Molti DOCX reali potrebbero aprirsi in sola lettura dopo F0 | misurarlo sul corpus; ridurlo con F5, non allentando i controlli | proprietario del progetto |
| Salvataggi rifiutati per falsi allarmi di F0b | misurarli sul corpus prima di attivare la garanzia in una release | chi implementa F0b |
| Il writer di WordCraft potrebbe non essere deterministico | test di determinismo; altrimenti ripiego sull'inventario per blocco e richiesta upstream | chi implementa F0b |
| Un Fub vecchio non legge le bozze in proiezione v2 | voluto: fallisce chiuso | — |
| GridCraft come motore del dominio, `.fubsheet` legacy | formalizzarlo in un ADR dopo il gate di GridCraft (F9) | proprietario del progetto |
| Logica di pivot, formattazione condizionale e tabelle nella facciata `engine` di GridCraft | chiedere all'upstream di spostarla; fino ad allora conservare senza modificare | proprietario del progetto |
| Chi produce i file del corpus (Word su Windows e Mac, LibreOffice, Pages) | assegnarlo nella issue di F1 | proprietario del progetto |
| MSRV: restare su 1.89 o salire a 1.95 | valutarlo a parte (F5) | proprietario del progetto |
| Dipendenze `wasm32` nel workspace di `vendor/` | misurare il diff di `Cargo.lock` (F3, scelta 5) | chi implementa F3 |
| Il comportamento di clippy sulle dipendenze a percorso esterne è stato provato soltanto con Rust 1.97 | riverificarlo con 1.89 in F3 | chi implementa F3 |
| L'upstream potrebbe non accettare le proposte | il vendor derivato funziona anche senza; F8 resta chiusa | — |
| La conoscenza di OOXML in Fub (classi, elenco posseduto, normalizzazioni, tipi) va mantenuta | elenchi piccoli, ogni voce con test | chi implementa F0 |
| `cargo fmt --all --check` dipende dalla formattazione dell'upstream | come oggi; lo script può segnalarlo in anticipo | chi implementa F3 |

## Appendice A — Prove eseguite

Tutte in una copia separata; nel repository di Fub non è stato modificato
niente durante la ricognizione.

| Prova | Risultato |
|---|---|
| Diff fra `vendor/wordcraft/crates/` e l'upstream al pin, esclusi i manifest | soltanto i file dichiarati in `UPSTREAM.md`; 118 righe di diff |
| `cargo check -p fub-format-rich --tests` contro l'upstream a HEAD | un solo errore: mancano `settings_kept_unowned` e `SETTINGS_ORIG` |
| Patch di Fub riportata su HEAD | le parti su `settings_merge.rs` e `write/mod.rs` si applicano con uno scostamento; quella delle esportazioni in `lib.rs` va riscritta a mano |
| Test di `fub-format-rich` contro HEAD, con la patch | 113 su 113 verdi |
| `cargo check -p fub-features --features proof` contro HEAD | due errori: parametro nuovo di `check_text_with`, `ProofLang::Id` non coperto |
| Sonda di salvataggio (appendice B) sul pin e su HEAD | tabella al punto 2 dello stato attuale |
| `kept_unowned` contro il nuovo `merge` su HEAD con `<w:compat/>` | il merge conserva tutto; `kept_unowned` risponde `false` |
| `cargo clippy -- -D warnings` di Fub con WordCraft come dipendenza a percorso in un altro workspace e un avviso introdotto apposta | l'avviso compare come avviso; nessun errore dal crate esterno (Rust 1.97) |
| Lettura di `docx/src/write/embed.rs` | budget sul markup degli oggetti incorporati («the rest is left out»), parti proprie o condivise per le copie, relazioni tolte verso parti non tenute |
| Lettura di `apps/client/src/editors/rich/projection.ts` | la shell rifiuta una `version` diversa dalla sua e riscrive la proiezione con la propria costante |
| Manifest e moduli di GridCraft (HEAD del 20 ottobre 2026) | dipendenze fra crate come nella tabella di F9; `engine` con `Session::execute`, journal, selezione e i moduli `pivot`, `pivot_calc`, `cf`, `tables`, `fill`, `links` |
| Contratto `grid` di Fub | `crates/fub-abi/src/grid.rs`: il provider risponde per finestre e applica patch a coordinate stabili (ADR 0201) |
| `engine` di PdfCraft | salvataggio incrementale; i test verificano il prefisso dei byte originali |
| File reali nel repository (`git ls-files`) | nessuno |
| Configurazione di bot di aggiornamento | nessuna |
| Pianificazione della CI | ogni lunedì alle 06:00 UTC, anche il job `supply-chain` |

Strumenti: Rust 1.97 (l'unico disponibile nell'ambiente della ricognizione). La
compilazione dei sei crate di HEAD con Rust 1.89 **non** è stata provata.

## Appendice B — La sonda

Il programma usato per il punto 2 dello stato attuale. Il passo 1 di F0a lo
trasforma in test. Usa soltanto l'API pubblica di `fub-format-rich` e `zip` 9.

```rust
use std::io::{Read, Write};
use fub_format_rich::projection::{Block, Inline, Projection};
use fub_format_rich::{open, save, Codec, Saved};

const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;

fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zw.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        zw.write_all(bytes).unwrap();
    }
    zw.finish().unwrap().into_inner()
}

fn part(bytes: &[u8], name: &str) -> Option<String> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut f = z.by_name(name).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).unwrap();
    Some(s)
}

fn main() {
    let ct = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="html" ContentType="text/html"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let root = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let rels = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/></Relationships>"#;
    let body = format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body><w:p><w:r><w:rPr><w:eastAsianLayout w:id="1" w:combine="1"/></w:rPr><w:t>Primo paragrafo</w:t></w:r></w:p><w:altChunk r:id="rIdChunk"/><w:p><w:permStart w:id="7" w:edGrp="everyone"/><w:r><w:t>Secondo paragrafo</w:t></w:r><w:permEnd w:id="7"/></w:p><w:sectPr/></w:body></w:document>"#);
    let chunk = b"<html><body><p>CONTENUTO DEL CHUNK IMPORTATO</p></body></html>";
    let file = zip(&[
        ("[Content_Types].xml", ct.as_bytes()),
        ("_rels/.rels", root.as_bytes()),
        ("word/document.xml", body.as_bytes()),
        ("word/_rels/document.xml.rels", rels.as_bytes()),
        ("word/chunk.html", chunk),
    ]);

    let opened = open(Codec::Docx, &file).unwrap();
    println!("readonly all'apertura: {:?}", opened.readonly);
    let mut p = Projection::from_json(&opened.projection).unwrap();
    // Modifica l'ultimo paragrafo come farebbe la shell.
    let last = p.blocks.len() - 1;
    let Block::Para(para) = &mut p.blocks[last] else { panic!("non un paragrafo") };
    let Some(Inline::Text { x, .. }) = para.c.iter_mut().find(|i| matches!(i, Inline::Text { .. })) else {
        panic!("niente testo")
    };
    *x = "Secondo paragrafo modificato".into();
    let out = match save(Codec::Docx, &file, &p.to_json().unwrap()) {
        Ok(Saved::Bytes(b)) => b,
        other => {
            println!("salvataggio: {other:?}");
            return;
        }
    };
    let doc = part(&out, "word/document.xml").unwrap();
    for needle in ["eastAsianLayout", "altChunk", "permStart", "permEnd", "modificato"] {
        println!("{needle:16} nel document.xml salvato: {}", doc.contains(needle));
    }
    println!("word/chunk.html nel pacchetto salvato: {}", part(&out, "word/chunk.html").is_some());
}
```

Manifest usato: un crate fuori dal workspace di Fub (`[workspace]` vuoto) con
`fub-format-rich = { path = "…/crates/fub-format-rich" }` e
`zip = { version = "9.0.5", default-features = false, features = ["deflate"] }`.

## Appendice C — Correzione rispetto all'analisi precedente

L'analisi che ha preceduto questo piano diceva che Cargo avrebbe rifiutato i
crate dell'upstream con Rust 1.89 per via di `rust-version = "1.95"`. Non è
così: `rust-version` sta soltanto nel `[workspace.package]` radice dell'upstream,
e i sei crate non lo ereditano. Il rischio reale è un altro: l'upstream prova
soltanto la 1.95 e può usare in qualunque momento funzioni del linguaggio che
Rust 1.89 non compila. La conclusione non cambia: una dipendenza diretta
dall'upstream oggi non è praticabile, per `zip` 3 con i suoi avvisi di
sicurezza, per le feature che si unificherebbero nel grafo di Fub
(`float_roundtrip`, i decoder di `image`) e per la patch di preservazione che
manca.

## Appendice D — Numeri di WordCraft upstream

| Misura | Valore |
|---|---|
| Commit fra il pin (`eae2421`) e HEAD (`e3bb06a`) | 288 |
| Commit che toccano `doc`, `docx`, `formats`, `docbin`, `geom` | 79 |
| File cambiati nei sei crate | 91 |
| Righe aggiunte / tolte nei sei crate | 9.203 / 735 |
| Tag | `v0.1.0` (7 ottobre), `v0.3.0`, `v0.4.0`, `v0.5.0`, `v0.6.1`, `v0.7.0` (14 ottobre), `v0.8.0` (17 ottobre) |

## Appendice E — Revisione esterna e cosa è cambiato

Una revisione indipendente della prima stesura ha proposto le modifiche qui
sotto. Ognuna è stata verificata sul codice prima di accoglierla.

| Critica | Esito | Nota |
|---|---|---|
| F0 deve controllare anche il salvataggio, non soltanto l'apertura | accolta | il writer ha rami che dipendono dal modello (`embed.rs`). Molti li vede già `reads_back`, perché l'oggetto sparisce dal modello riletto; non vede ciò che il modello non rappresenta né le differenze tollerate da `fidelity.rs`. La deduzione della prima stesura («basta la prova all'apertura») non era una prova |
| Un inventario a conteggi non è una garanzia: valori cambiati, relazioni verso la parte sbagliata, duplicati | accolta | due livelli: rilevatore (F0a) e garanzia (F0b). Le relazioni portano la loro destinazione; gli aumenti si ammettono soltanto dove il modello li controlla già |
| Versionare la proiezione invece di cambiare soltanto la grammatica di `k` | accolta | la shell valida e riscrive `version` da sola. Diventa un cambio di contratto IPC, con la regola che la shell ricopia versione e schema |
| Controllo di round-trip dei dati opachi a ogni lettura, su `serde_json::Value` e non sui byte | accolta, con due precisazioni | entrambi i lati passano dal testo (per i numeri `f32`); contenimento invece di uguaglianza, per non rifiutare campi nuovi con il loro valore predefinito |
| Il secondo `Cargo.lock` non deve imitare quello di Fub | accolta | conta che la build reale si provi con il lock di Fub e che i test del motore girino nel loro workspace |
| `check` deve togliere l'intera pila di patch in ordine inverso | accolta | due patch possono toccare la stessa zona |
| GridCraft come motore del dominio (`model`, `calc`, `formula`, `functions`, `xlsx`), senza `engine`; `.fubsheet` verso legacy | accolta come direzione del proprietario | con un gate: logica di pivot, formattazione condizionale e tabelle dentro `engine`, operazioni strutturali, strato di indirizzi, migrazione dei file esistenti |
| Gate PDF: il prefisso dei byte originali non basta | accolta | quattro controlli: prefisso, sezione incrementale, invarianti dell'operazione, policy delle firme |
| Ordine F4 → F0a → corpus → F0b → F2 → F3 → F7 → GridCraft | accolto | toglie la dipendenza circolare fra controlli e corpus |

## Glossario

- **Vendor, vendorizzare:** tenere una copia del codice di un altro progetto
  dentro il proprio repository.
- **Vendor derivato:** una copia che non si modifica a mano, ma che uno script
  ricostruisce da una versione precisa dell'originale più un elenco di
  modifiche.
- **Upstream:** il progetto originale (qui `storytold/wordcraft`).
- **Fork:** una copia del repository dell'upstream sotto un altro proprietario.
- **Patch:** un file che descrive una modifica al codice dell'upstream.
- **SHA, pin:** l'identificativo esatto di una versione del codice; «pinnare»
  significa fissarsi a quell'identificativo.
- **Codec:** la parte di un motore che legge e scrive i byte di un formato.
- **Facciata:** lo strato applicativo di un motore (sessione, comandi,
  cronologia, selezione), sopra i crate del dominio.
- **Oracolo:** il controllo che decide se un risultato è giusto. Un oracolo
  «correlato» condivide gli errori di ciò che controlla.
- **Inventario:** l'elenco, con i conteggi, di ciò che un file contiene (F0a).
- **Rilevatore e garanzia:** i due livelli di controllo di F0; il primo conta,
  il secondo confronta valori, destinazioni e contenuto non toccato.
- **Prova a vuoto:** scrivere un documento senza modificarlo
  (`write(read(file))`) per vedere cosa il codec cambierebbe da solo.
- **Proiezione:** la forma JSON del documento che la shell modifica.
- **Dati opachi (`k`):** la parte della proiezione che la shell copia senza
  leggerla.
- **Corpus:** la raccolta di file veri usati per le prove.
- **MSRV:** la versione minima di Rust con cui il codice compila.
- **`cargo deny`:** lo strumento che controlla licenze, avvisi di sicurezza e
  provenienza delle dipendenze.
- **Workspace:** l'insieme dei crate che Cargo compila insieme, con un
  `Cargo.lock` comune.
