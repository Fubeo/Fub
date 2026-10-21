# Piano: i motori Craft dentro Fub, a partire da WordCraft

Questo piano descrive come Fub usa i motori della suite Craft (WordCraft oggi;
GridCraft, PdfCraft ed eventualmente parti di VectorCraft in futuro) senza
perdere il controllo dell'esperienza, dei dati dell'utente e degli
aggiornamenti.

## Stato, perimetro e metodo

- **Data della ricognizione:** 21 ottobre 2026.
- **Stato:** proposta da approvare. Nessuna parte è implementata. Non è
  un'attestazione di comportamento entrato in `main`.
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
- **Collocazione:** come `piano_feature.md`, `piano_grafica.md` e
  `piano_impostazioni.md`, questo file sta alla radice. Non sostituisce le
  pagine canoniche in `docs/` e non è un secondo tracker.

## In breve

- Fub tiene WordCraft dentro il repository, a una versione fissa. Resta così:
  la versione cambia soltanto quando decidi tu di aggiornarla.
- Prima di tutto si chiude un bug che esiste già: alcuni file Word, salvati da
  Fub, perdono dei pezzi senza avvisare. Fub avrà un controllo suo, che non si
  fida di WordCraft.
- Poi si costruisce una raccolta di file veri, per vedere subito cosa cambia a
  ogni aggiornamento del motore.
- Le bozze contengono dati nel formato interno di WordCraft: prendono un numero
  di versione, così un aggiornamento non le rende illeggibili.
- La copia di WordCraft non si fa più a mano: la rigenera uno script, e un
  controllo automatico verifica che nessuno la modifichi di nascosto.
- Le modifiche di cui Fub ha bisogno si propongono agli autori di WordCraft.
- Una fork su Git si valuta più avanti, con criteri misurabili.
- GridCraft e PdfCraft entreranno con lo stesso metodo, ma non con lo stesso
  meccanismo del DOCX.

## Decisione

Il principio diventa:

> **Fub possiede l'esperienza e la garanzia; Craft possiede il codec.**

- **L'esperienza** è ciò che Fub possedeva già: vault, identità, sessione,
  salvataggio, bozze, conflitti, recupero, indice, link, interfaccia, comandi,
  accessibilità, policy e sicurezza.
- **La garanzia** è la parte nuova: il controllo che nessun contenuto vada
  perso e la decisione di aprire un documento in sola lettura appartengono a
  Fub, e non dipendono dal motore che sorvegliano.
- **Il codec** è ciò che si delega: leggere e scrivere il formato, il modello
  interno del documento, gli algoritmi del dominio.

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
| Corpus e confronto prima/dopo | Adottato, con file reali e con un controllo indipendente dal motore (F0, F1) |
| Pin per SHA, nessun tracking di `main` | Adottato: è già vero oggi |
| Proporre le patch upstream | Adottato e ordinato per priorità (F5) |
| Modello per GridCraft e PdfCraft | Adottato come metodo, non come meccanismo (F9) |

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
| DocumentSession, CAS, salvataggio, bozze, conflitti | Modello interno del documento |
| Watcher e modifiche esterne | Normalizzazioni proprie del formato |
| Versioni e recupero | Crittografia del formato (documenti protetti) |
| Modello comune per indice e ricerca, link, backlink, grafo | Algoritmi del dominio: ortografia, grammatica, calcolo, impaginazione |
| Superficie di modifica, undo, comandi, accessibilità | Esportatori verso altri formati |
| Stringhe visibili all'utente, compresi i nomi dei formati carta | |
| Limiti di risorse e policy di sicurezza | |
| **Controllo di preservazione e decisione di sola lettura** | |
| **Schema persistente della proiezione, dati opachi compresi** | |
| Tassonomia degli errori | |
| Quale revisione del motore si rilascia, e quando | |

Una responsabilità resta condivisa: **saper conservare** ciò che il modello non
rappresenta è del motore, perché soltanto chi scrive il file può conservarlo;
**verificare** che sia stato conservato è di Fub.

## Le fasi

| Fase | Obiettivo | Dipende da | Dimensione | Priorità |
|---|---|---|---|---|
| F0 | Fermare la perdita silenziosa nei DOCX | — | M | subito |
| F1 | Corpus di file reali e banco differenziale | F0 per i controlli | L | subito, in parallelo |
| F2 | Dati opachi versionati e bozze sicure | — | M | alta |
| F3 | Vendor derivato: copia rigenerata da script | — | M | alta |
| F4 | Confini delle dipendenze in CI | — | S | subito |
| F5 | Contributi a WordCraft | F0 per i casi concreti | S per patch | continua |
| F6 | Documentazione e ADR | ogni fase | S | con ogni fase |
| F7 | Aggiornare WordCraft quando lo decidi tu | F0, F1, F2, F3 | M al primo giro | dopo F3 |
| F8 | Quando rivalutare fork e sorgente Git | almeno due giri di F7 | S | più avanti |
| F9 | GridCraft, PdfCraft, VectorCraft | F7 provata una volta | L per motore | più avanti |

Le dimensioni sono stime relative, non misure: **S** è un lavoro breve e
locale, **M** tocca più file e richiede prove nuove, **L** richiede materiale o
persone fuori dal codice (per esempio installazioni di Word).

Ordine consigliato: F4 → F0 → (F1 e F2 in parallelo, F5 per `zip` 9) → F3 →
primo giro di F7 → F6 lungo tutto il percorso → F8 e F9 più avanti.

---

### F0 — Fermare la perdita silenziosa nei DOCX

**Obiettivo.** Un `.docx` che Fub non sa riscrivere senza perdere qualcosa si
apre in sola lettura, sempre, qualunque sia la versione del motore.

**Perché.** È un bug di correttezza attuale (punto 2), e rende inaffidabile
qualunque confronto prima/dopo un aggiornamento (punto 3).

#### Idea: un inventario del pacchetto, posseduto da Fub

All'apertura, Fub calcola un **inventario** del file originale e un inventario
del file che il codec scriverebbe senza modifiche (`write(read(originale))`).
Se qualcosa diminuisce, e non è una normalizzazione dichiarata, il documento si
apre con `ReadOnly::Codec`. L'inventario si calcola con `zip` e `quick-xml`,
già dipendenze di `fub-format-rich`, senza passare dal modello di WordCraft.

Chiavi dell'inventario:

| Chiave | Cosa conta | Perché |
|---|---|---|
| `Elemento(classe, spazio dei nomi, nome)` | occorrenze di ogni elemento, per nome espanso (URI dello spazio dei nomi più nome locale) | il prefisso (`w:`) può cambiare senza perdita |
| `Attributo(classe, elemento, spazio dei nomi, nome)` | occorrenze di ogni attributo | molte proprietà sono attributi |
| `Relazione(classe, tipo, modo)` | relazioni per tipo (`aFChunk`, `image`, `hyperlink`, `oleObject`…) e modo (interno o esterno) | il contenuto collegato non deve sparire |
| `Destinazione(tipo, valore)` | destinazioni esterne (URL) | un link non deve cambiare indirizzo |
| `Binario(tipo di contenuto, sha256)` | parti non XML: immagini, oggetti incorporati, font, macro | i byte devono restare quelli |

La **classe** di una parte viene dal suo tipo di contenuto:

- *storia*: documento, intestazioni, piè di pagina, note, commenti, glossario;
- *stili*, *numerazione*, *impostazioni*, *tema*, *proprietà*;
- *altro*, con il tipo di contenuto.

Raggruppare per classe, e non per nome di parte, evita falsi allarmi quando il
codec rinumera le parti (`header1.xml` che diventa `header3.xml`).

Regola:

```text
perdite = { chiave | conteggio_dopo(chiave) < conteggio_prima(chiave) }
          meno le normalizzazioni dichiarate
perdite non vuote  →  ReadOnly::Codec
```

Un conteggio che **aumenta** è ammesso: il writer aggiunge valori predefiniti.

**Normalizzazioni dichiarate.** Sono un elenco nel codice, una voce per riga,
ciascuna con la sua ragione e il suo test, come quelle che
`fidelity.rs` documenta già per il modello. Una voce entra soltanto se:

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
superato, uno ZIP illeggibile o un XML malformato producono sola lettura:
fallisce chiuso.

**Dove.** Un modulo nuovo, `crates/fub-format-rich/src/inventory.rs`, chiamato
da `session::fidelity`, che calcola già `codec.write(document)`: si riusano
quei byte, senza una scrittura in più. `open` passa a `fidelity` anche i byte
originali.

**Salvataggio.** In F0 non cambia. Se all'apertura `write(read(file))` conserva
l'inventario, tutto ciò che il file contiene sta nel modello; una perdita al
salvataggio può allora venire soltanto da un cambiamento del modello, che
`reads_back` controlla già. Un secondo controllo al salvataggio, sulle chiavi
che la proiezione v1 non sa modificare, resta un'opzione di difesa in
profondità (F0.7), da valutare dopo le misure.

**Altri formati.** L'ODT ha già un codec di Fub che conserva l'XML; applicargli
lo stesso inventario come secondo controllo costa poco ed è facoltativo. RTF e
Word 97-2003 restano importatori in sola lettura.

#### Passi

1. **Test di regressione che oggi fallisce**, in
   `crates/fub-format-rich/tests/preservation.rs`:
   - un `.docx` con `w:altChunk` e la sua parte: `open` deve restituire
     `readonly: Some(ReadOnly::Codec)`;
   - un `.docx` con `w:eastAsianLayout`, scritto come proprietà indipendente
     dalla versione del motore: *se* si apre modificabile, *allora* dopo una
     modifica e un salvataggio l'inventario si conserva. Così il test vale sia
     con il pin attuale (dove deve aprirsi in sola lettura) sia con HEAD (dove
     si conserva).
2. **`inventory.rs` con i suoi test unitari:** prefissi diversi per lo stesso
   spazio dei nomi non sono una perdita; un elemento in meno lo è; una
   relazione o una destinazione esterna persa lo è; un binario con byte
   diversi lo è; ZIP troncato, XML malformato e limiti superati sono errori.
3. **Misura prima di attivare:** un aiuto di test che stampa le perdite
   trovate su tutti i documenti di esempio esistenti e sui primi file del
   corpus (F1). Da qui nascono le normalizzazioni dichiarate, ciascuna con il
   suo test.
4. **Attivazione** in `session::fidelity`: perdite non vuote → `ReadOnly::Codec`.
5. **Test dell'host** in `crates/fub-host/tests/rich_documents.rs`: il
   documento con `altChunk` letto con `read_document` ha il motivo `codec`, e
   la scrittura è rifiutata con `host.rich.readonly.codec`.
6. **Commenti e documentazione:** il commento di `Codec::lossless` (la prova
   ora comprende il pacchetto) e quello di `ReadOnly::Codec`;
   `docs/product/word-documents.md` (quando un documento si apre in sola
   lettura) e `docs/architecture/rich-surface-and-proofing.md`; un ADR (F6).
7. **Segnalare all'upstream** gli elementi persi trovati (F5).

#### Contratti toccati

Nessuno nuovo. Si riusa `ReadOnly::Codec`, e il messaggio esistente si adatta
già: «Sola lettura: il documento non si rileggerebbe identico dopo un
salvataggio da qui.» Più avanti si può aggiungere, in modo additivo, l'elenco
di ciò che si perderebbe; quel passo toccherebbe il mirror TypeScript, le
fixture, l'host finto e i messaggi localizzati.

#### Prove

- Test unitari di `inventory.rs`.
- `tests/preservation.rs`, che fallisce prima della modifica e passa dopo.
- I 113 test esistenti di `fub-format-rich`, senza regressioni.
- Test dell'host.
- Tempo di apertura sui documenti più grandi, prima e dopo: il limite
  accettabile si fissa dopo la prima misura.

#### Criterio di uscita

- Il caso della sonda si apre in sola lettura.
- Nessun test esistente regredisce.
- Ogni file del corpus, quando esisterà, si apre in sola lettura con il suo
  motivo oppure conserva l'inventario dopo le modifiche standard di F1.
- Le normalizzazioni dichiarate sono elencate, motivate e provate.

#### Rischi

- **Più documenti reali si apriranno in sola lettura.** È la conseguenza onesta
  della regola, va misurata sul corpus e ridotta conservando di più nel motore
  (F5), non allentando il controllo.
- **Fub possiede un po' di conoscenza di OOXML** (classi delle parti,
  normalizzazioni). La specifica è stabile e l'elenco è piccolo.
- **Falsi allarmi** producono sola lettura, non perdite: sbagliano dal lato
  sicuro.

---

### F1 — Corpus di file reali e banco differenziale

**Obiettivo.** A ogni aggiornamento del motore, sapere esattamente cosa cambia
su documenti veri, prima di rilasciarlo.

**Perché.** Oggi non c'è nessun file reale (punto 4), e la suite attuale passa
identica con due versioni del motore che si comportano in modo diverso
(punto 5).

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

**Matrice di copertura iniziale** (almeno un file per riga):

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

1. `open`: motivo di sola lettura, impronta della proiezione, inventario (F0),
   riassunto del `DocumentModel` che vede l'indice (titoli, link, impronta del
   testo).
2. Per ogni formato di esportazione, l'elenco di ciò che la copia non porta
   (ADR 0211).
3. Se il documento è modificabile, le **modifiche standard** sulla proiezione:
   - E0: nessuna modifica → `Saved::Unchanged`;
   - E1: cambiare la prima parola del primo paragrafo di testo;
   - E2: spezzare un paragrafo;
   - E3: aggiungere un paragrafo in fondo;
   - E4: aggiungere un commento a una parola;
   - E5: togliere l'ultima riga di una tabella, se c'è.

   Dopo ognuna: salvataggio, riapertura, inventario che non diminuisce fuori da
   ciò che la modifica toglie, proiezione riaperta uguale a quella voluta (a
   meno dei numeri delle parti).
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

### F2 — Dati opachi versionati e bozze sicure

**Obiettivo.** Un aggiornamento del motore non può rendere illeggibile una
bozza, né applicarla perdendo in silenzio parte della formattazione.

**Perché.** I dati opachi sono JSON del modello di WordCraft dentro bozze
autorevoli che viaggiano con il vault (punto 7). Un Fub più vecchio che legge
una bozza scritta da un Fub più nuovo scarterebbe in silenzio i campi che non
conosce.

#### Formato

- Nuovo formato di `k`: `<schema>~<base64>`. Il carattere `~` non appartiene
  all'alfabeto base64, quindi un `k` senza `~` è riconoscibile come dato del
  formato attuale, che vale come **schema 0**.
- `OPAQUE_SCHEMA` è una costante di Fub in `crates/fub-format-rich/src/blob.rs`
  e parte da 1. Si incrementa quando cambia la forma serializzata di uno dei
  tipi dentro i dati opachi.

#### Lettura

| Schema del dato | Comportamento |
|---|---|
| uguale a `OPAQUE_SCHEMA` | si legge |
| maggiore (scritto da un Fub più nuovo) | `RichError::Version(schema)`: si rifiuta, mai una lettura parziale |
| minore | migrazione esplicita, come il ripiego `SectKeep` → `SectionProps` di oggi, oppure `RichError::Version` |
| 0 (senza `~`, scritto prima di F2) | si legge come oggi; è l'unico modo per leggere le bozze esistenti |

`RichError::Version` arriva all'utente con il messaggio esistente
`host.rich.version`: «Il contenuto da salvare in «{doc}» è di una versione
({version}) che questo Fub non legge.» Il salvataggio rifiutato lascia la bozza
dov'è, come chiede la politica delle bozze («migra o rifiuta»; una bozza non
interpretabile «non si offre al recupero e non si perde»).

#### Accorgersi che la forma è cambiata

- **Test golden** `crates/fub-format-rich/tests/opaque_schema.rs`, con
  `tests/opaque_schema.golden.json` che contiene `schema` e la serializzazione
  di un campionario di valori (`CharProps`, `ParaProps`, `SectionProps` con
  molti campi valorizzati, le varianti costruibili di `InlineObject`, un
  `Comment`):
  - se `OPAQUE_SCHEMA` è uguale a quello del file, la serializzazione deve
    coincidere;
  - se è maggiore, il file si rigenera con `UPDATE_MIRROR=1` e devono esistere
    le fixture dello schema precedente.
- **Sul corpus** (F1): ogni `k` deve ritornare identico dopo lettura e nuova
  serializzazione (`to_vec(from_slice(x)) == x`). Verifica che la
  serializzazione sia deterministica: per esempio una `HashMap` o una
  conversione dei numeri con la virgola la romperebbe.
- **Fixture delle bozze vecchie**: a ogni aumento di schema si committano in
  `tests/fixtures/opaque/schema-<N-1>/` alcune proiezioni scritte dal motore
  precedente, con un test che le migra o le rifiuta, per scelta esplicita.

#### Cosa non cambia

- La shell non legge `k` e lo copia così com'è; il filtro dell'incolla
  (`apps/client/src/editors/rich/paste.ts`) confronta stringhe e continua a
  funzionare.
- La forma della proiezione resta `fub-rich` versione 1: non serve una nuova
  porta IPC.

#### Da aggiornare

- Le fixture `apps/client/src/__fixtures__/rich-projection.json` e
  `rich-edited.json`, rigenerate perché i valori di `k` cambiano.
- `docs/reference/ipc-contract.md`, sulla forma di `k`.
- `docs/reference/on-disk-layout.md`, sulle bozze con dati opachi di uno schema
  che questo Fub non legge.
- `docs/architecture/rich-surface-and-proofing.md`.

Facoltativo: controllare i dati opachi già quando si offre una bozza al
recupero, attraverso una porta esistente. Nessuna porta IPC dedicata, a meno
che nessuna esistente ne esprima la semantica.

#### Criterio di uscita

- Ogni `k` nuovo ha lo schema.
- I test coprono: schema futuro rifiutato, schema 0 letto, migrazione da una
  fixture, test golden.
- Test dell'host: una bozza con schema futuro non si salva e resta intatta.

#### Rischi

- I dati di schema 0 non si possono verificare. Il rischio resta limitato alle
  bozze scritte prima di F2.
- La disciplina di incrementare `OPAQUE_SCHEMA` la impone il test golden, ma
  il campionario può non coprire ogni campo; il corpus copre il resto.

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
  Cargo.lock         per eseguire da soli i test del motore
  patches/           le modifiche di Fub, una per file .patch
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
   dichiarano, `lints`; nessuno dichiara `rust-version`. Le decisioni di Fub stanno in un file solo, invece
   che riscritte in sei manifest.
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
6. **I test del motore.** Fuori dal workspace di Fub, `cargo test --workspace`
   non li esegue più. Un passo di CI li esegue con
   `cargo test --manifest-path vendor/wordcraft/Cargo.toml --workspace --locked`.
   Il `Cargo.lock` di `vendor/` deriva da quello di Fub (copiato, poi
   completato da Cargo), così le versioni condivise coincidono. Questa
   procedura va verificata durante l'implementazione.
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
   nel `Cargo.toml` di `vendor/`, e che le dipendenze in comune con Fub abbiano
   la stessa versione.
6. Calcola lo sha256 di ogni file, originale e risultato, e scrive
   `upstream.lock`.
7. Aggiorna la `version` delle righe `wordcraft-*` nel `Cargo.toml` radice di
   Fub.
8. Sostituisce i percorsi gestiti soltanto alla fine, quando tutti i passi sono
   riusciti.
9. Stampa un riassunto e i passi successivi (test, corpus, F7).

**`check`** (senza rete, veloce, in CI):

- ogni file gestito esiste e ha l'impronta del risultato;
- per i file con patch, applicare le patch al contrario (in una cartella
  temporanea) dà l'impronta dell'originale;
- nei percorsi gestiti non ci sono file in più;
- le versioni `wordcraft-*` di Fub coincidono con quella del workspace di
  `vendor/`;
- le dipendenze in comune sono allineate.

Una modifica a mano dentro `vendor/` che non sta in una patch fa fallire
`check`.

**`verify-upstream`** (con rete, facoltativo o settimanale): scarica la
revisione dall'upstream e dal mirror, se esiste, e verifica che le impronte
degli originali coincidano con `upstream.lock`.

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
- Il diff di `Cargo.lock` è stato rivisto: nessun crate nuovo inatteso.

#### Rischi

- Due `Cargo.lock` da tenere allineati: lo script li confronta.
- I lint di Fub non guardano più il codice del motore: è voluto, è codice di
  terzi.
- Se l'upstream committa codice non formattato, `cargo fmt --all --check`
  fallisce come oggi.

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
`cargo metadata` come pacchetti.

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
| 4 | `settings_kept_unowned`, con la correzione per `<w:compat/>`, accanto a `merge` e con i suoi test; oppure `merge` che restituisce ciò che ha tolto | lo stesso controllo per il loro salvataggio | `settings_kept_unowned` |
| 5 | Manifest adatti a chi incorpora: `float_roundtrip` tolto se serve soltanto a leggere un colore; decoder di `image` dietro feature | meno dipendenze per chi incorpora | le scelte del `Cargo.toml` di `vendor/` diventano opzionali |
| 6 | `#[non_exhaustive]` sugli enum pubblici usati da chi incorpora (`ProofLang`, `IssueKind`…) e un registro dei cambiamenti dell'API dei crate del motore | aggiornamenti meno fragili per chi incorpora | correzioni come quella di `ProofLang::Id` |
| 7 | Una politica di MSRV per i crate del motore (una CI con la versione minima) | chiarezza per chi incorpora | il rischio di funzioni troppo nuove per Rust 1.89 |
| 8 | A lungo termine, pubblicare i crate del motore su crates.io | dipendenza normale con checksum | il vendor, se mai (F8) |

**Metodo:**

- prima una issue per discutere, poi la PR;
- le PR partono da una fork personale o `Fubeo`: la fork serve a ospitare i
  branch delle PR, non come sorgente della build;
- ogni proposta ha una issue in Fub con il link;
- quando la modifica entra upstream e Fub aggiorna oltre quel commit, la patch
  corrispondente si cancella da `vendor/wordcraft/patches/`.

**Decisione di Fub collegata:** allineare l'MSRV di Fub a 1.95 (rilasciata ad
aprile 2026) eliminerebbe la classe di rischio del punto 7. Tocca la CI, i
pin del toolchain, `CONTRIBUTING.md` e `check-locale-loop.mjs`, che verifica la
1.89. È una scelta a sé, da valutare con le altre ragioni che tengono Fub su
1.89.

---

### F6 — Documentazione e decisioni

**ADR nuovi**, numerati dopo la 0211:

- **0212 — Preservazione misurata sul pacchetto** (F0 e F2): l'inventario di
  Fub, la sola lettura quando qualcosa si perderebbe, i dati opachi versionati.
  Alternative da riportare: fidarsi del motore; un codec DOCX di Fub come per
  l'ODT (molto più costoso).
- **0213 — Provenienza e aggiornamento dei motori esterni** (F3, F4, F7, F8): il
  vendor derivato, i proprietari, la cadenza, i criteri per rivalutare fork e
  Git.

Entrambi integrano la 0209 (che dice «vendorizzati» e ha una sezione
«Verifica») senza riscriverla.

**Pagine canoniche da aggiornare**, ciascuna quando la sua fase entra in
`main`:

- `vendor/wordcraft/UPSTREAM.md` (F3);
- `docs/architecture/components-and-boundaries.md`: i proprietari di WordCraft
  (F4);
- `docs/architecture/rich-surface-and-proofing.md` (F0, F2);
- `docs/product/word-documents.md`: quando un documento si apre in sola lettura
  (F0);
- `docs/reference/ipc-contract.md`: la forma di `k` (F2);
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
   oppure si accetta con una ragione scritta. Una perdita silenziosa non può
   comparire: la impedisce F0. Un documento che passa da modificabile a sola
   lettura è una regressione da pesare.
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

Dopo F0–F3, il primo aggiornamento (verso `v0.8.0` o un tag successivo) mette
alla prova la procedura. Dalle prove di questo piano si sa già cosa troverà:

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

In ogni caso restano: inventario e sola lettura (F0), corpus e banco (F1), dati
opachi versionati (F2), guard (F4), procedura (F7).

**Gate prima di togliere la copia locale** (se F8 lo decide):

1. inventario indipendente attivo e verde su tutto il corpus;
2. corpus completo secondo la matrice di F1;
3. banco differenziale senza differenze fra copia locale e nuova sorgente allo
   stesso SHA;
4. modifiche standard verdi su ogni file modificabile;
5. bozze dello schema precedente lette o rifiutate per scelta esplicita;
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
   dipendenze, con la sua riga nel test di F4.
2. **Un controllo di preservazione di Fub**, indipendente dal motore e adatto al
   formato.
3. **Dati opachi versionati**, se attraversano bozze o altri dati persistenti.
4. **Corpus e banco differenziale** dal primo giorno.
5. **Vendor derivato** con lo stesso script, reso parametrico (per esempio
   `tools/vendor-craft/` con una configurazione per motore).
6. **Revisione di sicurezza:** input non fidato, limiti di risorse di Fub
   attorno a ogni chiamata, politica sul codice `unsafe`, peso delle
   dipendenze.
7. **Regole di ciclo di vita di `AGENTS.md`:** nessun lock del workspace durante
   una chiamata al motore; il lavoro lungo passa da un job con stato,
   cancellazione e risultato.

#### GridCraft (fogli di calcolo)

Situazione: GridCraft ha i crate `calc`, `chart`, `core`, `engine`, `formula`,
`functions`, `mcp`, `model`, `numfmt`, `pdf`, `ui-egui`, `xlsx`; edition 2024;
`rust-version = "1.90"`. Fub possiede già un formato di foglio: `.fubsheet`,
testuale e versionato, con identità stabili di righe e colonne
(`crates/fub-format-sheet`, con `formula.rs` e sessioni a finestre, ADR 0201).

Il DOCX è un caso ingannevolmente semplice; un foglio di calcolo è diverso:

- **due motori di calcolo danno risultati diversi**: per ogni documento deve
  esserci un solo valutatore, scelto da Fub;
- **il ricalcolo cambia i valori in cache**: salvare un file non modificato può
  cambiarne i numeri, e questo deve essere esplicito;
- **le identità delle celle** per link, backlink e grafo sono di Fub; l'XLSX ha
  riferimenti posizionali;
- **la preservazione** è più ampia: cache delle tabelle pivot, collegamenti
  esterni, convalida dei dati, formattazione condizionale, grafici, nomi
  definiti, formule condivise e matrici dinamiche, sistemi di data 1900 e 1904,
  macro;
- **le dimensioni**: una proiezione intera via IPC non scala; servono le
  sessioni a finestre.

Proposta:

1. XLSX prima in sola lettura (come RTF e `.doc` oggi), verso il modello di Fub
   o una proiezione;
2. modifica di un sottoinsieme, soltanto con il controllo di preservazione;
3. l'adozione di `formula`/`functions` come libreria di funzioni, sotto un
   contratto di valutazione di Fub, è una decisione separata con il suo ADR.

GridCraft codec XLSX sì; GridCraft proprietario del dominio del foglio no.

#### PdfCraft

Situazione: PdfCraft ha 34 crate (`a11y`, `annot`, `audit`, `automation`,
`compare`, `content`, `cos`, `create`, `crypt`, `edit`, `engine`, `export`,
`filters`, `fonts`, `forms`, `geom`, `js`, `measure`, `model`, `ocr`,
`optimize`, `oracle`, `organize`, `platform`, `preflight`, `print`, `redact`,
`render`, `sign`, `testkit`, `ui-egui`, `xfa`, `xfdf`); edition 2024;
`rust-version = "1.95"`. Fub usa già `hayro`, `lopdf` e `svg2pdf` (feature
`draw` di `fub-features`, PDF annotati).

Un PDF non si proietta e si riscrive. La preservazione naturale è
l'**aggiornamento incrementale**: i byte originali restano un prefisso esatto
del file salvato. Il controllo di Fub è semplice e indipendente: «il file nuovo
comincia con il file vecchio». Una riscrittura completa invalida le firme e va
fatta soltanto su richiesta esplicita («ottimizza», «salva come»).

Proposta:

1. adozione per capacità, non in blocco: per esempio `annot` e `xfdf` per le
   annotazioni, `forms` per i moduli;
2. niente `js` (esecuzione di JavaScript dei PDF) e niente `xfa` all'inizio;
3. un solo motore di resa: `hayro` o `render`, non entrambi;
4. i parser PDF sono fra le superfici d'attacco più esposte: limiti di risorse,
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
| Molti DOCX reali potrebbero aprirsi in sola lettura dopo F0 | misurarlo sul corpus; ridurlo con F5, non allentando il controllo | proprietario del progetto |
| Chi produce i file del corpus (Word su Windows e Mac, LibreOffice, Pages) | assegnarlo nella issue di F1 | proprietario del progetto |
| MSRV: restare su 1.89 o salire a 1.95 | valutarlo a parte (F5) | proprietario del progetto |
| Dipendenze `wasm32` nel workspace di `vendor/` | misurare il diff di `Cargo.lock` (F3, scelta 5) | chi implementa F3 |
| Serializzazione non deterministica dei dati opachi | verificarla sul corpus (F2) | chi implementa F2 |
| Il comportamento di clippy sulle dipendenze a percorso esterne è stato provato soltanto con Rust 1.97 | riverificarlo con 1.89 in F3 | chi implementa F3 |
| L'upstream potrebbe non accettare le proposte | il vendor derivato funziona anche senza; F8 resta chiusa | — |
| La classificazione delle parti OOXML e le normalizzazioni sono conoscenza di Fub da mantenere | elenco piccolo, ogni voce con test | chi implementa F0 |
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
| File reali nel repository (`git ls-files`) | nessuno |
| Configurazione di bot di aggiornamento | nessuna |
| Pianificazione della CI | ogni lunedì alle 06:00 UTC, anche il job `supply-chain` |

Strumenti: Rust 1.97 (l'unico disponibile nell'ambiente della ricognizione). La
compilazione dei sei crate di HEAD con Rust 1.89 **non** è stata provata.

## Appendice B — La sonda

Il programma usato per il punto 2 dello stato attuale. Il passo 1 di F0 lo
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
- **Oracolo:** il controllo che decide se un risultato è giusto. Un oracolo
  «correlato» condivide gli errori di ciò che controlla.
- **Inventario:** l'elenco, con i conteggi, di ciò che un file contiene (F0).
- **Proiezione:** la forma JSON del documento che la shell modifica.
- **Dati opachi (`k`):** la parte della proiezione che la shell copia senza
  leggerla.
- **Corpus:** la raccolta di file veri usati per le prove.
- **MSRV:** la versione minima di Rust con cui il codice compila.
- **`cargo deny`:** lo strumento che controlla licenze, avvisi di sicurezza e
  provenienza delle dipendenze.
- **Workspace:** l'insieme dei crate che Cargo compila insieme, con un
  `Cargo.lock` comune.
