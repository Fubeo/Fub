# 0058 — Un nome che nasce non è un nome che c'è, e la sorgente è il file

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §15.5 (seduta 15) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/15-il-disco.md) · [dove le regole stanno in un posto solo](0020-le-regole-in-un-posto-solo.md)

---

La voce chiedeva due moduli, `path_policy` e `text_policy`, per una quindicina di
righe della §2.3 di [FEATURES.md](../FEATURES.md) che non avevano un posto dove
stare. Ma il lavoro vero era **due frasi che nessuno aveva scritto**, e le due
sono la ragione per cui questo verbale è uno:

> **Un nome che c'è e un nome che nasce non si giudicano con la stessa regola.**
>
> **La sorgente di uno `Span` sono i byte del file, integralmente.**

La prima è la §2.3 letta fino in fondo; la seconda non era nemmeno nella voce —
è la metà **di contratto**, quella che scadeva col freeze, e la voce non la
nominava.

## La prima: due tolleranze, e una firma che obbliga a scegliere

Un vault è portabile per progetto: si copia su una chiavetta, si sincronizza fra
macOS e Windows, si tiene sotto git. Quindi **contiene già** nomi che qualche
filesystem non accetterebbe — un `CON.md` scritto su Linux, un nome in NFD scritto
da macOS, un `nota?.md` arrivato da un import. Le due letture possibili della
§2.3 portano a due difetti opposti:

- se la politica vale in lettura, Fub **si rifiuta di aprire** un vault per un
  file che c'è. Ma «il vault è la verità», e la verità non si rifiuta di aprire —
  è la stessa frase con cui il [§15.7](../roadmap/15-il-disco.md#157-lapertura-del-vault-è-tutto-o-niente-sincrona-e-senza-ritorno) esiste;
- se non vale affatto, Fub **crea** un file che il giorno in cui il vault
  attraversa un sistema operativo non si apre più. E lì il difetto è nostro,
  scoperto da chi sincronizza, quando il file c'è già e rinominarlo è un rename
  che riscrive i wikilink di tutti.

```rust
// crates/fub-abi/src/rules/path_policy.rs
pub enum Naming { Existing, New }
pub fn check(path: &str, naming: Naming) -> Result<(), NameFault>;
pub fn normalized(path: &str) -> String;   // trim per segmento + NFC
```

`Naming` **non ha un default**, e `check` non si può chiamare senza dirlo. È la
parte della firma che conta: due funzioni separate avrebbero permesso di chiamare
la tollerante dove serviva la stretta senza che niente, al punto di chiamata,
dicesse che si era scelto. Con l'enum la scelta è scritta dove la si fa, come
`ids::check(id, Owner::Plugin(..))`.

Nel kernel diventano due varchi con due nomi:

| | Chi ci passa | Cosa rifiuta |
|---|---|---|
| `valid_doc_id` | leggere, elencare, cestinare, **ripristinare**, il `from` di un rename, ogni capacità (`fenced_doc_id`) | solo ciò che non sta dentro il vault |
| `new_doc_id` | `create_note`, il **`to`** di un rename, `create_document` sul confine dei plugin | tutto il resto, e restituisce il nome in NFC |

Le tre asimmetrie sono deliberate e sono il contenuto della decisione:

- **`to` sì, `from` no.** Rinominare *verso* `CON.md` crea un file che su Windows
  non si apre; rinominare *via da* `CON.md` è precisamente il modo di sistemarlo.
  Validare `from` con la regola stretta renderebbe irreparabile ciò che la regola
  esiste per prevenire.
- **Il ripristino dal cestino usa la regola tollerante.** Ripristinare non fa
  nascere un nome, ne rimette uno che c'era: rifiutarsi di restituire una nota
  perché si chiamava `CON.md` sarebbe un modo curioso di perdere un file.
- **La NFC vale sui nomi nuovi e non su quelli che ci sono.** Quelli li ha
  scritti macOS, ed è il disco a dire come si chiama un file; uniformarli sarebbe
  una migrazione silenziosa di ciò che l'utente vede. Sceglierne una sola forma
  quando la si *scrive* serve invece perché
  [`resolution_key`](../../crates/fub-abi/src/rules/path.rs) fa collassare NFC e
  NFD: due file che per il filesystem di Linux sono due sono **uno** per il grafo,
  la ricerca e la sidebar, e quell'ambiguità il modello non ha modo di
  rappresentarla.

## La seconda: cosa sia «la sorgente», scritto dove un provider lo trova

`Span` era documentato come «un intervallo `[start, end)` in **byte** nella
sorgente originale», e `EditRequest` ripeteva «in byte UTF-8 del sorgente della
base». Cosa *fosse* quella sorgente non era scritto da nessuna parte.

**Sono i byte del file decodificati, integralmente**: il BOM se c'era, i
terminatori di riga come stanno sul disco, nessuna normalizzazione. La stessa
stringa che `read_document` restituisce, quella su cui `Revision::of` è calcolata,
quella che `write_document` scrive. Un `Span { start: 0, end: 0 }` su un file col
BOM inserisce **prima** del BOM.

Sta accanto alla definizione di `Span`
([`model.rs`](../../crates/fub-abi/src/model.rs)), in `edit.rs`, e nel **WIT** —
perché il WIT è la versione che legge un guest, e un commento non tocca
l'additività ([`wit_additivity`](../../crates/fub-abi/tests/wit_additivity.rs)
resta verde).

**Perché non «un testo normalizzato».** È l'altra lettura possibile, ed è
indistinguibile da questa fino al momento in cui un provider calcola gli offset su
una e l'host li applica sull'altra: allora gli edit atterrano spostati di quanto
misura ciò che è stato normalizzato, e **niente diventa rosso** — il documento
resta UTF-8 valido, con dei byte in meno da un punto e in più da un altro. Tre
ragioni, in ordine di gravità:

1. **La fedeltà diventa indimostrabile.** La §2.4 promette «nessuna modifica fuori
   dallo span dichiarato», che è un'affermazione sul *file*: se gli span vivono in
   un altro sistema di coordinate, la promessa ha bisogno di una traduzione che
   solo l'host conosce, e verificarla diventa impossibile per chiunque altro.
2. **La revisione mentirebbe.** Due file che differiscono per il solo BOM darebbero
   la stessa `Revision`, quindi un edit calcolato senza BOM verrebbe **accettato**
   su un file che ce l'ha, e cadrebbe tre byte più in là. La revisione esiste per
   impedire esattamente quello.
3. **Normalizzare in lettura obbliga a riscrivere.** O si riscrive il file
   normalizzato — e il primo salvataggio di una nota CRLF muove ogni riga, che è
   il `git diff` pieno di righe che l'utente non ha scritto — o si tiene da parte
   ciò che è stato tolto per rimetterlo dopo: la stessa informazione in un secondo
   posto, dove si disallinea.

## La casella invecchiata, letta con la direzione che è stata decisa

La voce diceva «`text_policy`: rilevamento encoding, BOM, CRLF/LF, **enforcement
UTF-8**». Presa alla lettera si scriverebbe un normalizzatore — e il commit
`d1bd999`, nello stesso repo, ha aggiunto alla §2.4 del catalogo «line ending
preservate per file, non normalizzate d'ufficio», «BOM preservato se c'era, mai
aggiunto se non c'era», «ogni normalizzazione è esplicita e disattivata di
default», e ha cambiato la riga 180 da `Normalizzazione CRLF/LF` a
`Normalizzazione CRLF/LF solo su richiesta esplicita`.

**Quindi `text_policy` rileva e dichiara, e non converte.** Non c'è una funzione
in quel modulo che restituisca un `String` diverso da quello che le è stato dato.

```rust
// crates/fub-abi/src/rules/text_policy.rs
pub const BOM: char = '\u{feff}';
pub fn bom_len(source: &str) -> usize;          // 3 o 0
pub fn strip_bom(source: &str) -> &str;         // una VISTA
pub enum Newline { Lf, Crlf, Cr, Mixed }
pub fn line_break(source: &str) -> &'static str;
pub fn splits_newline(source: &str, at: usize) -> bool;
pub fn decode(bytes: &[u8]) -> Result<&str, usize>;
```

- **`line_break` è la sola funzione operativa**, ed è la ragione per cui il
  rilevamento serve a qualcosa. Un template che inserisce `\n` in un file CRLF non
  ha convertito niente e ha comunque prodotto un file misto: il prossimo strumento
  che lo normalizza riscrive tutte le righe, e il diff che l'utente vede non è la
  modifica che ha chiesto. Chi genera una riga chiede al file com'è fatto.
- **«Rilevamento encoding» ha due letture, e si è scelta la seconda.** Annusare i
  byte e scommettere su un charset è ciò che fa un browser, e sbagliando corrompe
  in silenzio — un UTF-8 letto come Latin-1 *riesce*, e produce mojibake che poi si
  riscrive sul disco. Fub dice invece con certezza se i byte sono UTF-8 e **a
  quale byte** smettono di esserlo, perché quella è l'informazione con cui una
  persona ripara il file. La conversione, se servirà, è un `ImportProvider`: una
  cosa che l'utente chiede, che produce un file nuovo e non riscrive quello vecchio.

## Il confine che `is_char_boundary` non vede

`apply_to` verificava che gli span cadessero su confini di carattere. `\r` e `\n`
sono due caratteri ASCII, quindi **l'offset fra loro è un confine valido** e
passava: un edit che ci finiva sopra spezzava un terminatore di riga e lasciava un
`\r` orfano.

Non è lo stesso difetto di un carattere tagliato a metà, ed è peggiore. Tagliare
una `à` produce byte che non sono testo, e il documento non si riapre — te ne
accorgi. Spezzare un `\r\n` produce un file **valido**, con una riga cambiata che
nessuno aveva nominato: la §2.4 in due parole. Un `\r\n` è un terminatore solo, e i
suoi due byte non si separano più di quanto si separino i due byte di una `à`;
adesso è `BadArgs` come l'altro.

## Le regole nuove nascono con la fixture della 6.2, e una no

La voce lo chiedeva («nascano con la fixture della 6.2»), e la
[0020](0020-le-regole-in-un-posto-solo.md) pone la condizione: *la fixture ammette
solo regole che esistono in due lingue*, perché legarne una che ha
un'implementazione sola non presidia niente e obbligherebbe a scrivere una gemella
TypeScript senza clienti. Le due metà si applicano a metà per volta:

- **`path_policy` entra**, con 76 casi (`name_fault`) più 10 (`normalized_name`), e
  il cliente è vero: la **rinomina in posto** della sidebar
  (`explorer.ts::startRename`) oggi manda al kernel qualunque cosa l'utente
  digiti. Il no deve arrivare **prima** del giro IPC, perché dirlo dopo significa
  aver già chiuso il campo di testo, cioè far ridigitare il nome. È la stessa
  ragione per cui `mask_wants` è nella fixture «per necessità» e non per comodità.
- **`text_policy` non entra**, e non è una dimenticanza: la shell non vede mai i
  byte di un file — riceve una `String` dall'IPC — quindi non ha modo di decidere
  che forma abbia un sorgente, e una gemella TypeScript sarebbe la terza copia da
  tenere allineata, per finta. Il suo presidio è il corpus.

**Ciò che attraversa la fixture è l'etichetta del guasto, non il messaggio.** La
frase che una persona legge è del catalogo di chi la mostra
([0042](0042-il-catalogo-della-shell.md)); legare qui l'italiano di due file
vorrebbe dire legare due cose che devono restare libere di divergere. Il
*giudizio* è la regola, la sua formulazione no — ed è lo stesso taglio con cui la
0020 ha tenuto fuori l'ordine di presentazione.

I tre casi che rendono la fixture capace di distinguere due implementazioni, e che
il gemello vitest pretende esistano:

- **la coppia**: lo stesso nome con due esiti secondo la domanda. Chi collassasse
  le due tolleranze passerebbe metà dei casi con entrambe le risposte sbagliate;
- **la lunghezza in byte**: 64 emoji sono 64 caratteri, 128 code unit e 256 byte, e
  in JavaScript `s.length` risponde 128. Il limite è sui byte, quindi chi non lo sa
  lascia creare un file che il filesystem rifiuta. È l'inganno di `offsets.ts`
  applicato ai nomi;
- **il quasi-device**: `CONtratto` e `COM10` cominciano come `CON` e `COM1` e non
  lo sono, che è l'errore di chi scrive la regola con uno `startsWith`.

## Trovato per strada

### Un errore dichiarato che nessuno costruiva

`KernelError::BadName` esisteva, `From<KernelError> for PluginError` lo traduceva,
un test lo asseriva — e **nessuna riga di produzione lo costruiva**: la validazione
c'era, ma dentro `valid_doc_id`, che di quel nome non ne faceva mai uso. È la
**sesta specie** della famiglia del [§16.7](0056-un-elenco-che-e-la-sorgente.md),
quella che la [0054](0054-il-banco-del-lato-provider.md) ha inaugurato: una
garanzia che sembra esserci e non c'è. Qui era mezza — l'errore c'era, il caso che
lo produce no.

Ne ha guadagnato una forma: `BadName { name, why }` invece di `BadName(String)`.
Rifiutare un nome senza dire quale carattere è il problema è, su un titolo lungo,
un rifiuto su cui si indovina — cioè il §12.2 applicato ai nomi.

### La regola era già nel kernel, e nel kernel non serve a chi la userà

`valid_doc_id` faceva già metà del lavoro (separatori, trim, `.`, `..`) ed era una
funzione di `fub-kernel`. È esattamente il caso della
[0020](0020-le-regole-in-un-posto-solo.md): un indice di terzi non ha il kernel fra
le mani, e un guest WASM a M5 nemmeno. Il giudizio è salito nel contratto; nel
varco è rimasta la **tolleranza sua** — la conversione dei separatori Windows e il
trim — che è di quell'ingresso e non della regola.

### Il BOM: la premessa da verificare era falsa, e la conclusione resta

Il piano di lavoro diceva che comrak tollera il BOM «solo davanti al frontmatter»,
e che «un BOM a inizio file finisce dentro il contenuto del primo blocco».
**Controllato: non è così** — i sette test di
[`span_e_terminatori.rs`](../../crates/fub-format-markdown/tests/span_e_terminatori.rs)
passano anche con il parser intatto, e passare richiede che lo span dell'heading
cominci al byte 3. comrak 0.54 salta già il BOM di suo.

È il metodo della §21.10 applicato di nuovo (*un'affermazione plausibile va
verificata contro i sorgenti prima di diventare lavoro*), e questa volta con una
conclusione che **non cambia**: la proprietà reggeva, ma reggeva per un
comportamento non dichiarato di una dipendenza, cioè per una cosa che una `cargo
update` toglie in silenzio. Adesso a comrak si dà `strip_bom(source)` e
`Offsets::new` comincia la prima riga a `bom_len` — le due si annullano, il
risultato è identico, e la differenza è che la proprietà è **nostra** e c'è un test
che la nomina su tutte e quattro le forme dello stesso file.

Vale come precedente perché è il caso che sembra non valere la pena: il codice non
cambia comportamento, quindi il diff sembra rumore. Non lo è — la riga che cambia
è chi risponde della proprietà.

## Il corpus, e la prova di romperlo

[`kernel/tests/fedelta_del_testo.rs`](../../crates/fub-kernel/tests/fedelta_del_testo.rs):
quindici forme di file — LF, CRLF, CR, misti, con e senza BOM, BOM + frontmatter,
senza newline finale, con due, spazi in coda, NFD nel contenuto, fuori dal BMP, un
file vuoto e uno che è **solo** un BOM — e per ognuna `Vault::read` → `Vault::write`
deve ridare **i byte identici**. Il confronto è sui byte e non sulla stringa: è
l'unico modo di vedere un BOM aggiunto o un terminatore convertito.

Il corpus sta scritto come byte in un sorgente Rust e non come file committati:
un file con un BOM o con CRLF dentro un repo è alla mercé di `.gitattributes`,
degli editor e dei checkout su Windows.

**Provato rompendolo**, come la 0020: aggiunto un `.replace("\r\n", "\n")` sulla
via della lettura — una riga, il genere di cosa che si scrive per far passare un
test —, due test diventano rossi e uno dice `crlf: apri-e-salva ha cambiato i byte
del file`. Rotta la gemella TypeScript in due punti (`s.length` invece dei byte, e
la NFC tolta), il mirror dice
`expected 'Café.md' to deeply equal 'Café.md'`: due valori che a schermo sono
identici, che è precisamente il difetto che senza fixture nessuno vedrebbe.

## Cosa si è scartato, e perché

- **Una politica sola per leggere e per creare.** È la voce letta a metà, e i due
  modi di sbagliarla sono opposti: non aprire un vault che contiene `CON.md`,
  oppure crearne uno.
- **Due funzioni invece di un parametro `Naming`.** Permettono di chiamare la
  tollerante dove serve la stretta senza che il punto di chiamata dica che si è
  scelto.
- **«La sorgente è un testo normalizzato».** Rende indimostrabile la §2.4, fa
  mentire la revisione, e obbliga a riscrivere il file o a tenere altrove ciò che
  è stato tolto.
- **Un normalizzatore CRLF/LF e un `enforcement UTF-8` che converte.** Contraddicono
  quattro righe della §2.4 scritte nello stesso repo. Chi le volesse cambiare
  cambi prima il catalogo.
- **Indovinare l'encoding.** Un charset sbagliato corrompe *riuscendo*, ed è la
  forma peggiore: il file si riscrive con dentro il mojibake.
- **Un `sanitize` che ripara un nome invece di rifiutarlo.** Serve a un *import*,
  dove nessun umano sta guardando e un nome qualunque è meglio di un file
  scartato; serve male a chi digita un titolo, che va corretto e non corretto di
  nascosto. Nascerebbe come una seconda politica che decide le stesse cose in modo
  diverso, e va deciso col suo cliente vero (17.x).
- **Il limite del path assoluto.** Windows tronca a 260 caratteri il path *intero*,
  che dipende da dove sta il vault: non è una proprietà del nome, e `fub-abi` non
  sa dove sia la radice né deve saperlo. Quello che è del nome è il limite del
  segmento; l'altro è di chi conosce il filesystem, cioè il
  [§15.1](0064-il-supporto-sta-sotto.md).
- **Legare il *messaggio* di un guasto invece della sua etichetta.** Legherebbe
  l'italiano di due cataloghi che devono restare liberi di divergere.
- **Una gemella TypeScript di `text_policy`.** Sarebbe una copia senza clienti: la
  shell non vede mai i byte di un file.

## Cosa resta scoperto (e dove è scritto)

- **I symlink.** Erano nell'elenco della voce e non sono una domanda sul *nome*:
  sono «questa voce di directory partecipa, e la seguiamo?», cioè il lato *quali
  file*. La riga è stata **spostata** nel
  [§15.6](../roadmap/15-il-disco.md#156-la-politica-di-esclusione-è-una-costante-di-compilazione),
  che è la voce che li farà, invece di restare una casella residua di una voce
  chiusa: un elenco che perde una riga senza consegnarla a nessuno è il difetto
  del §16.7.
- **I file nascosti hanno due lati, e qui c'è solo il primo.** `NameFault::Hidden`
  impedisce di *creare* `.nota.md`; **mostrare** i dotfile che ci sono, su
  richiesta (3.2 del catalogo), è del §15.6. La regola è la stessa stringa letta
  per due domande diverse, e ognuna sta con la sua.
- **Il `/` digitato nella rinomina in posto sposta ancora la nota.** Il campo
  chiede un *nome pagina* — lo dice il suo commento — e un `a/b` diventa un path
  valido, quindi la politica dei nomi non ha niente da dire: la nota finisce in
  una sottocartella. Non è un difetto di questa voce ed è una decisione di
  prodotto (vietarlo, o dichiararlo un modo di spostare): sta con l'editor e la
  shell, [§18.1](../roadmap/18-editor-e-tastiera.md#181-editor).
- **`line_break` non ha ancora un chiamante di produzione**, perché oggi nessuno
  genera una riga dentro un documento esistente: gli edit arrivano dal di fuori
  con il testo già composto. Il primo cliente è il template col cursore (16.1), e
  la funzione c'è perché quella sia una riga e non una decisione da riprendere.
- **Il rifiuto di un nome arriva su `console.error`**, come ogni altro esito della
  shell: la superficie dove dirlo a una persona è il
  [§20.4](../roadmap/20-quando-qualcosa-va-storto.md#204-la-shell-non-ha-una-superficie-dove-dire-niente-e-il-salvataggio-non-ha-esito).
  Le otto chiavi di catalogo ci sono già, e la mappa `NameFault → Chiave` è un
  `Record` esaustivo: un guasto nuovo non compila finché non ha la sua frase.
- **Nessun `vault_health` dice quali nomi del vault non sono portabili.** La
  regola per rispondere adesso c'è (`check(path, Naming::New)` su ciò che il vault
  contiene), il comando no: è il
  [§15.2](../roadmap/15-il-disco.md#152-durabilità-e-recovery) e la 24.2 del
  catalogo, e adesso hanno una funzione da chiamare invece di una da scrivere.

## Verifica

`cargo test --workspace`: **920 test verdi in 88 binari, 0 falliti**. I nuovi sono
ventotto: nove di `path_policy` e sei di `text_policy` negli unit test del
contratto, due in `edit.rs` (lo span a metà di un terminatore, e l'edit su un file
CRLF che non ne normalizza le altre righe), sette in `span_e_terminatori.rs`,
quattro in `fedelta_del_testo.rs`, più i tre nomi ostili aggiunti a un test che
c'era già (`vault_e2e.rs`). `cargo fmt --all --check` e `cargo clippy --workspace
--all-targets -- -D warnings` puliti.

Frontend: `npx tsc --noEmit` pulito, **343 test vitest** in 22 file — dei quali
**dodici** nel mirror delle regole, erano dieci — e `vite build` ok.
`node .github/scripts/check-doc-links.mjs`: **130 file, 2376 link, 0 rotti**.

`wit_additivity` resta verde: al WIT si aggiunge un commento, e un commento non è
una firma.

**Non verificato visivamente nell'app Tauri.** Una cosa meriterebbe un occhio, ed
è l'unica che cambia comportamento a schermo: la **rinomina in posto** della
sidebar adesso rifiuta un nome invece di mandarlo al kernel, e scrive il motivo su
`console.error`. Su un nome normale non cambia nulla; il caso in cui cambia —
digitare `CON` o `nota?` sopra un titolo — è quello da guardare.
