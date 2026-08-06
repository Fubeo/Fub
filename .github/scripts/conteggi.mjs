// **I conteggi che la prosa afferma sui sorgenti** (§16.8).
//
// Ogni voce qui è un numero che qualche documento — o qualche commento dentro
// il codice — scrive in italiano, insieme al comando che lo ricava dai
// sorgenti. `check-prosa.mjs` rifà il conto e lo confronta con **ogni** posto
// che lo cita, in tutte e due le direzioni: un numero che cambia nel codice
// diventa rosso, e una voce che nessuno cita più diventa rossa anche lei —
// stessa disciplina dell'allowlist di `crates/fub-app/tests/dieta_ipc.rs`.
//
// La ragione per cui questo file è un modulo JS e non un JSON: **ogni riga
// porta la sua ragione**, e un formato senza commenti costringerebbe a
// scriverla da un'altra parte, cioè in un posto che invecchia.
//
// Come si aggiunge una voce:
//
//   1. si sceglie un `nome`, che è ciò che si scriverà nella prosa fra
//      `[conta: …]`;
//   2. `comando` deve stampare **un numero solo**, e girare da qualunque
//      cartella (si esegue dalla radice del repo);
//   3. `ragione` dice cosa quel numero afferma, non come lo si conta — il come
//      è il comando, e sta già lì.
//
// Cosa NON va qui: un numero che descrive lo stato di allora dentro un verbale.
// Un verbale è datato, e un conteggio dentro un verbale non promette di essere
// vero oggi — promette di essere stato vero quel giorno. Quelli si scrivono al
// passato («allora ne contava otto»), e questo presidio non li guarda.

export const CONTEGGI = [
  {
    nome: "hostapi-metodi",
    ragione:
      "Le funzioni che un plugin può chiamare sull'host: la superficie dell'`HostApi` " +
      "come la vede chi sta dall'altra parte del confine. È il numero della " +
      "decisione 0013 — l'elenco è chiuso alla sottrazione, non alla crescita — e " +
      "prima di questo presidio lo stesso documento ne dichiarava due diversi. " +
      "I commenti si saltano: in un contratto che è per metà prosa italiana, " +
      "una riga di documentazione che nomina una funzione con i due punti " +
      "conterebbe come una funzione.",
    comando:
      "awk '/^[[:space:]]*\\/\\//{next} /^[[:space:]]*interface host-/{i=1}" +
      " i&&/^}/{i=0} i&&/:[[:space:]]*func/{n++} END{print n+0}'" +
      " crates/fub-abi/wit/fub/abi.wit",
  },
  {
    nome: "wit-interfacce-host",
    ragione:
      "Le interfacce `host-*` del contratto, cioè in quante famiglie è divisa " +
      "quella superficie. Cresce solo quando nasce una famiglia di capacità, " +
      "quindi va di pari passo con `guard-famiglie`: se i due divergono, una " +
      "delle due liste ha smesso di essere l'altra.",
    comando: "grep -cE '^[[:space:]]*interface host-' crates/fub-abi/wit/fub/abi.wit",
  },
  {
    nome: "guard-famiglie",
    ragione:
      "Le famiglie di capacità su cui una politica risponde sì o no: i casi di " +
      "`Capability` in `guard.rs`. Il numero è scritto tre volte in quel file, e " +
      "tutte e tre le volte era `dieci` quando le famiglie erano quattordici.",
    comando:
      "sed -n '/^pub enum Capability {/,/^}/p' crates/fub-kernel/src/host/guard.rs" +
      " | grep -cE '^    [A-Z]'",
  },
  {
    nome: "capacita-strutturali",
    ragione:
      "I metodi di `VaultStructure`, cioè quante sono le operazioni strutturali " +
      "che il varco della decisione 0010 copre. Due documenti dicevano «tutte e " +
      "sei» e poi ne elencavano cinque. L'ancora pretendeva una firma **nuda**: " +
      "una `async fn`, una `unsafe fn` o una `fn c<T>() where …` sarebbe entrata " +
      "nel varco senza entrare nel conto.",
    comando:
      "sed -n '/^pub trait VaultStructure/,/^}/p' crates/fub-abi/src/traits.rs" +
      " | grep -cE '^[[:space:]]+(default |const |async |unsafe )*fn '",
  },
  {
    nome: "superfici-di-vista",
    ragione:
      "Le superfici su cui una view può stare: i casi di `ViewSurface`. La 0104 " +
      "ha dato all'elenco un presidio che vieta buchi e doppioni, e la verifica " +
      "del rosso della 0105 ha misurato che una variante aggiunta **in coda** " +
      "gli sfugge lo stesso, perché la sua ancora è una variante nominata a " +
      "mano. Nessun `assert` dentro Rust può prenderla: la prende un conto che " +
      "guarda il sorgente da fuori, ed è questo.",
    comando:
      "sed -n '/^pub enum ViewSurface {/,/^}/p' crates/fub-abi/src/traits.rs" +
      " | grep -cE '^    [A-Z]'",
  },
  {
    nome: "porte-verso-un-terzo",
    ragione:
      "Le porte da cui si entra in codice di un terzo: i casi di `Gate` in " +
      "`safety.rs`. La decisione 0032 le aveva dichiarate «otto, e sono tutte» " +
      "in un verbale immutabile, e quando la 0105 le ha contate erano tredici.",
    comando:
      "sed -n '/^pub enum Gate {/,/^}/p' crates/fub-kernel/src/safety.rs" +
      " | grep -cE '^    [A-Z]'",
  },
  {
    nome: "schemi-su-disco",
    ragione:
      "Le versioni di schema indipendenti: quanti formati su disco Fub versiona " +
      "separatamente. È il numero il cui errore non si annulla, perché la " +
      "promessa è fatta ai file dell'utente e non a chi compila. Conta la " +
      "**proprietà** — una costante intera che dichiara una versione — e non il " +
      "nome `SCHEMA_VERSION`: finché guardava il nome, `DIAGNOSTICS_VERSION` " +
      "gli passava accanto, e chi l'aveva chiamata così non aveva sbagliato " +
      "niente (§15.3). La forma di allora però guardava ancora mezza sillaba: " +
      "misurato su un file con sette versioni vere ne contava **una**, perché " +
      "pretendeva `pub(<una parola>)`, un tipo senza segno fino a 64 bit, il " +
      "rientro a spazi e almeno un `_` prima di `VERSION`. Adesso ammette " +
      "qualunque visibilità (`pub(in crate::x)`), qualunque intero (`u128`, " +
      "`i32`), il TAB e il nome nudo `const VERSION`. Resta **fuori** ciò che " +
      "una versione la dichiara senza dirlo nel nome (`const E_SCHEMA_REV`): il " +
      "buco è dichiarato dalla 0106 ed è il suo, non di questo comando — la " +
      "porta è che una versione di schema si chiama `VERSION`.",
    comando:
      "grep -rhE '^[[:space:]]*(pub([[:space:]]*\\([^)]*\\))?[[:space:]]+)?" +
      "const [A-Z_]*VERSION[A-Z_]*: [ui](8|16|32|64|128|size) = '" +
      " crates/*/src | wc -l",
  },
  {
    nome: "schemi-in-tabella",
    ragione:
      "Le righe della tabella degli schemi in `docs/versionamento.md`. Vive " +
      "accanto a `schemi-su-disco` e dice l'altra metà: quello conta i formati " +
      "che il codice versiona, questo i formati che il documento elenca. Che " +
      "siano gli **stessi** — riga per riga e numero per numero — lo verifica " +
      "`crates/fub-app/tests/schemi_su_disco.rs`; che siano **tanti quanti** lo " +
      "dicono questi due, ed è il verso che un test non può vedere, perché un " +
      "formato che nessuno ha incluso è un formato di cui nessun test sa.",
    comando:
      "grep -cE '^\\| [^|]+ \\| \\[`crates/[^`]+:[0-9]+`\\]' docs/versionamento.md",
  },
  {
    nome: "file-con-superficie-ipc",
    ragione:
      "In quanti file di `crates/fub-app/src` compare un `#[tauri::command]` o " +
      "un `generate_handler!`. Deve essere **uno**: `dieta_ipc.rs` giudica " +
      "`lib.rs` con un `include_str!`, quindi una seconda superficie montata da " +
      "un altro file dello stesso crate — un `.plugin()` col suo " +
      "`generate_handler!` — gli è invisibile e resta raggiungibile dal webview " +
      "come `plugin:<nome>|<comando>`. Un presidio che legge un file sa quel " +
      "file; a vedere gli altri è un conto che cammina la cartella. L'ancora " +
      "pretendeva la `]` **subito**: misurato, un file di soli comandi " +
      "parametrizzati — `#[tauri::command(rename_all = \"snake_case\")]`, " +
      "`#[tauri::command(async)]` — era invisibile a questo conto *e* a " +
      "`dieta_ipc.rs`, che legge `lib.rs`. Ora la parentesi vale quanto la " +
      "quadra.",
    comando:
      "grep -rlE '#\\[(tauri::)?command[](]|generate_handler!' crates/fub-app/src | wc -l",
  },
  {
    nome: "cataloghi-del-kernel",
    ragione:
      "Quante famiglie di `fub-kernel` dichiarano un catalogo di stringhe, cioè " +
      "quanti `pub fn catalog()` ci sono in `crates/fub-kernel/src`. Il bundle " +
      "del core li monta uno per uno e i due banchi dei cataloghi li elencano a " +
      "mano: un elenco a mano si accorge di una **chiave** che manca, mai di un " +
      "**catalogo** che manca — `maintenance` è stato fuori a lungo senza che " +
      "niente diventasse rosso. È la forma che la 0105 nomina per questa specie " +
      "di buco, e nessun `assert` dentro Rust la può prendere: la prende un " +
      "conto che guarda il sorgente da fuori. Conta **dichiarazioni**, non " +
      "file: la prima forma contava i file in cui ne compariva almeno una, e un " +
      "`pub mod calendar { pub fn catalog() }` dentro un file già contato " +
      "lasciava il numero fermo con la suite verde — misurato. Per la stessa " +
      "ragione l'ancora ammette il rientro.",
    comando: "grep -rhE '^[[:space:]]*pub fn catalog\\(\\)' crates/fub-kernel/src | wc -l",
  },
  {
    nome: "impostazioni-del-kernel",
    ragione:
      "Quante famiglie di `fub-kernel` dichiarano delle impostazioni, cioè " +
      "quanti `pub fn *_settings()` ci sono in `crates/fub-kernel/src`. Vive " +
      "accanto a `cataloghi-del-kernel` e presidia l'altra metà: una famiglia " +
      "che il bundle del core non monta non è rossa da nessuna parte — le sue " +
      "chiavi spariscono dal pannello e chi le legge prende il default in " +
      "silenzio, che è precisamente il comportamento giusto per un vault che " +
      "non ha dichiarato niente. Misurato togliendo la riga (§15.6). Conta " +
      "**dichiarazioni**, non file, e per la stessa ragione del gemello: una " +
      "`pub fn calendar_settings()` aggiunta dentro `locale.rs` — file già " +
      "contato — lasciava il numero a quattro con `cargo test --workspace` " +
      "verde, perché l'elenco del banco `i_cataloghi.rs` è scritto a mano e " +
      "vede una chiave che manca, mai una famiglia che nessuno ha montato.",
    comando:
      "grep -rhE '^[[:space:]]*pub fn [a-z_]*settings\\(\\)' crates/fub-kernel/src | wc -l",
  },
  {
    nome: "durabilita-su-ogni-piattaforma",
    ragione:
      "Quanti test di `crates/fub-kernel/tests/la_durabilita.rs` **girano " +
      "davvero su ogni piattaforma**, cioè quanti ne restano dove la " +
      "piattaforma non regala inode né hardlink. È il presidio contro una specie " +
      "di difetto che nessun colore segnala: la CI gira `cargo test --workspace` " +
      "anche su windows-latest, e per anni quel job è passato verde perché i " +
      "presidi che avrebbero interrogato il caso là non erano compilati — **una " +
      "suite che si svuota in silenzio è indistinguibile da una suite verde** " +
      "(§23.16). Un test non può accorgersene, perché il test che se ne " +
      "accorgerebbe è proprio quello che non c'è: se ne accorge un conto che " +
      "legge il sorgente da fuori. Guarda **quattro** modi di svuotare la " +
      "suite, tutti misurati uno per uno su questo file: un `#[cfg` davanti a " +
      "un test (la prima forma cercava la stringa esatta `#[cfg(unix)]` e a " +
      "`#[cfg(not(windows))]` restava undici); un `#[ignore]`, che lascia " +
      "`0 passed; 0 failed; 16 ignored` e la prosa verde; un `#![cfg(…)]` come " +
      "**attributo interno** in cima al file, che svuota tutto in una riga " +
      "senza toccare nessun test; e un `if cfg!(windows) { return; }` **dentro " +
      "un corpo** — la forma peggiore, perché lì il test si vede correre e passa " +
      "a vuoto. Gli ultimi tre azzerano il conto invece di scalarlo: in un file " +
      "che esiste per girare ovunque non c'è un uso legittimo di `cfg!`, e un " +
      "presidio che non sa scalare sa almeno spegnersi rumorosamente.",
    comando:
      "awk '/^[[:space:]]*\\/\\//{next} /^[[:space:]]*#!\\[cfg/{fuori=1}" +
      " /cfg!\\(/{fuori=1} /^[[:space:]]*#\\[/{a=a $0 \" \"; next}" +
      " /^[[:space:]]*(pub )?(async )?(unsafe )?fn /{if(a ~ /#\\[test\\]/ &&" +
      " a !~ /#\\[cfg/ && a !~ /#\\[ignore/) n++; a=\"\"; next} {a=\"\"}" +
      " END{print fuori?0:n+0}' crates/fub-kernel/tests/la_durabilita.rs",
  },
  {
    nome: "famiglie-paginate",
    ragione:
      "Le domande del canale dati che chiedono una finestra. Il banco del §17.1 " +
      "(decisione 0113) ha misurato che la finestra si può applicare in tre modi — " +
      "alla sorgente, con `Paged::from_source`, o ritagliando in memoria — e che " +
      "per anni tutte quelle del kernel usavano il terzo, costruendo l'insieme " +
      "intero per mostrarne venti. Il numero sta accanto alla prosa che descrive " +
      "le tre strade, così chi ne aggiunge una decima passa da lì e sceglie. " +
      "**Il conto si contava addosso**: cercava `page: Option<Page>,` in tutto " +
      "il file e trovava anche il *parametro* di `Paged::from_source`, cioè la " +
      "funzione nata con la 0113 per servirle — dieci dove le varianti erano " +
      "nove, e la prosa dell'architettura diceva «dieci» contraddicendo il " +
      "verbale che l'aveva scritta. Ora legge il corpo dell'enum, e ammette " +
      "l'ultimo campo senza virgola (rustfmt scrive in linea una variante a un " +
      "campo solo, e quella sfuggiva nell'altro verso).",
    comando:
      "sed -n '/^pub enum IndexQuery {/,/^}/p' crates/fub-abi/src/traits.rs" +
      " | grep -cE '^[[:space:]]+page: Option<Page>,?$'",
  },
  {
    nome: "crate-del-workspace",
    ragione:
      "I crate che ereditano la versione dal `Cargo.toml` della radice. " +
      "Dichiarava questo e contava le **cartelle** di `crates/`: un crate che " +
      "si scrivesse la versione a mano — cioè precisamente quello che la frase " +
      "esclude — sarebbe stato contato lo stesso.",
    comando: "grep -lE '^version\\.workspace *= *true' crates/*/Cargo.toml | wc -l",
  },
  {
    nome: "wit-righe",
    ragione:
      "Quanto è lungo il contratto in WIT. Serve alla misura che la decisione " +
      "0053 fa — quanta parte del contratto è prosa — e da solo non direbbe niente.",
    comando: "wc -l < crates/fub-abi/wit/fub/abi.wit",
  },
  {
    nome: "wit-commenti",
    ragione:
      "E quanta di quella lunghezza è commento: è l'altra metà della misura di " +
      "sopra, ed è la ragione per cui il contratto si legge.",
    comando: "grep -cE '^[[:space:]]*//' crates/fub-abi/wit/fub/abi.wit",
  },
  {
    nome: "conformita-funzioni",
    ragione:
      "Le funzioni del banco di conformità che `fub-sdk` offre a chi scrive un " +
      "provider. Il numero della decisione 0054 («un terzo crate per otto " +
      "funzioni») era falso **nel commit che lo scriveva**: ne contava già " +
      "quattordici. Non un numero invecchiato — un numero mai ricavato dalla " +
      "sua sorgente, che è la specie che questo file esiste per rendere impossibile.",
    comando: "grep -c '^pub fn ' crates/fub-sdk/src/testing/conformita.rs",
  },
  {
    nome: "diagnostica-shell",
    ragione:
      "I `console.warn`/`console.error` rimasti nella shell: ciò che va storto e " +
      "che la decisione 0052 vuole far diventare un evento invece che una riga " +
      "nella console di qualcuno. È un numero che deve **scendere**, e il " +
      "presidio è ciò che lo fa notare quando risale. Conta le **chiamate**, e " +
      "prima non lo faceva in due modi opposti: contava le *righe* (due " +
      "`console.warn` sulla stessa riga contavano uno, e in un numero che deve " +
      "scendere è il verso che perdona) e contava anche le volte in cui la " +
      "prosa li **nomina** — le tre che il conto dichiarava erano tutte e tre " +
      "dentro un commento, e di chiamate vere in `frontend/src` non ce n'è " +
      "nessuna. La `(` è ciò che distingue una chiamata da un nome.",
    comando:
      "find frontend/src -name '*.ts' -o -name '*.tsx' | xargs awk" +
      " '/^[[:space:]]*(\\/\\/|\\*|\\/\\*)/{next}" +
      " {n+=gsub(/console\\.(warn|error)[[:space:]]*\\(/,\"\")} END{print n+0}'",
  },
  {
    nome: "moduli-di-feature",
    ragione:
      "I moduli di feature di `fub-features`: i file di `src/` che non sono la " +
      "radice né l'aggregatore. È il numero su cui poggia la §16.3 quando dice " +
      "che pagare venti `Cargo.toml` per otto moduli che non si parlano è un " +
      "costo senza compratore — cioè il numero che rende **falsa** la premessa " +
      "il giorno in cui cresce, ed è la ragione per cui vale la pena contarlo " +
      "invece che ricordarlo. Le due esclusioni sono le stesse di `RADICE` in " +
      "`crates/fub-features/tests/i_moduli_non_si_parlano.rs`: se là si aggiunge " +
      "un modulo condiviso, qui va tolto anche lui, o il banco e il conto " +
      "smettono di parlare dello stesso insieme. Un modulo **a cartella** " +
      "(`canvas/mod.rs`) è un modulo quanto un file, e la prima forma non lo " +
      "vedeva: il nono si sarebbe aggiunto lasciando il conto a otto.",
    comando:
      "ls crates/fub-features/src/*.rs crates/fub-features/src/*/mod.rs 2>/dev/null" +
      " | grep -vE '/(lib|inventario)\\.rs$' | wc -l",
  },
  {
    nome: "permessi-dichiarabili",
    ragione:
      "I permessi che un manifest può dichiarare, cioè quante righe può avere al " +
      "massimo l'elenco che l'utente legge decidendo di cosa fidarsi (§23.17). " +
      "Cresce quando nasce una capacità che l'utente deve poter negare, ed è un " +
      "numero che sta in **tre** posti — il contratto, il catalogo della shell e " +
      "la prosa — di cui i primi due si presidiano a vicenda " +
      "(`i_permessi_sono_gli_stessi_di_qua_e_di_la`). Questo conto è il terzo " +
      "lato, e serve perché la frase «tredici permessi» è ciò che qualcuno legge " +
      "invece di andare a contare.",
    comando:
      "sed -n '/pub const ALL: \\[&str; /,/];/p' crates/fub-abi/src/options.rs" +
      " | grep -cE '^        [A-Z_]+,'",
  },
  {
    nome: "code-che-si-svuotano",
    ragione:
      "I posti da cui una coda di eventi del dispatcher si svuota in blocco, " +
      "cioè da cui un evento può sparire senza arrivare a nessuno. Ognuno dei " +
      "quattro ha una ragione scritta accanto in `dispatcher.rs`. La prima " +
      "forma di questo comando cercava la riga `self.pending.clear();`: " +
      "presidiava **una sillaba**, e il difetto mordeva già — il travaso verso " +
      "`salvaged` (`self.pending.drain(..)`) era un posto da cui la coda si " +
      "svuotava e il conto diceva tre. Restavano fuori anche `truncate`, un " +
      "`= VecDeque::new()`, un `clear()` con un commento in coda (l'ancora `$` " +
      "cade) e la **seconda coda**, `salvaged`, che nessuna riconciliazione " +
      "ripara. Ora le due code sono un tipo — `EventQueue`, col `VecDeque` " +
      "privato — che si svuota in blocco da due sole porte, `take_all` (travasa) " +
      "e `discard_all` (butta, e rende quanti): il conto conta quelle chiamate, " +
      "cioè la proprietà, e ogni altra forma non compila. Legge **un file solo** " +
      "e può permetterselo perché il tipo è privato al modulo: una coda in un " +
      "altro file non potrebbe nominarlo.",
    comando:
      "grep -oE '\\.(discard_all|take_all)\\(\\)'" +
      " crates/fub-kernel/src/dispatcher.rs | wc -l",
  },
  {
    nome: "gesti-della-shell",
    ragione:
      "I gesti che l'e2e della shell percorre da capo a fondo (§17.2): un `it` " +
      "per gesto in `frontend/src/shell.e2e.test.ts`. È la disciplina della " +
      "0109 applicata a una suite che non si svuota per un `cfg` ma per una " +
      "riga cancellata o un `.skip`. Serve un attore che guardi il file da " +
      "fuori: un gesto che sparisce lascia una suite verde e più piccola, e più " +
      "piccola non si vede. La prima forma leggeva `^  it(`, cioè **il rientro " +
      "di oggi**: misurato, un `.skip` sui sei `describe` — che stanno in " +
      "colonna zero — lasciava il conto a sette, `npm run test` a exit 0 con " +
      "`7 skipped` e la prosa verde, cioè tutti e sette i gesti spariti senza " +
      "un colore. Ora il rientro non conta, i gesti si riconoscono anche come " +
      "`it.each(`/`test(`, e uno `.skip`/`.only`/`.todo` su un `describe` o su " +
      "un `it` azzera il conto: una suite che si può *non eseguire* non si " +
      "scala, si spegne rumorosamente. Quel che il conto NON vede è un `it` che " +
      "non asserisce niente; per quello l'attore è la verifica del rosso, che " +
      "si fa a mano.",
    comando:
      "awk '/^[[:space:]]*\\/\\//{next} /(describe|it|test)\\.(skip|only|todo)/{fuori=1}" +
      " /^[[:space:]]*(it|test)[[:space:]]*(\\.each\\([^)]*\\))?\\(/{n++}" +
      " END{print fuori?0:n+0}' frontend/src/shell.e2e.test.ts",
  },
  {
    nome: "verbali",
    ragione:
      "I verbali delle decisioni chiuse. È il conteggio che `todo.md` scriveva " +
      "già col suo comando accanto — l'unico che avesse una sorgente prima di " +
      "questo registro, e diceva «cinquantasette» quando erano cinquantanove.",
    comando: "ls docs/decisions/0*.md | wc -l",
  },
  {
    nome: "voci-aperte",
    ragione:
      "Le voci ancora aperte del piano infrastrutturale: le righe della tabella " +
      "di `todo.md`. Il piano dichiara che «se una voce è in questa tabella è " +
      "aperta» e che una voce chiusa **sparisce** — quindi il numero non è una " +
      "cosa da ricordare, è una cosa da contare, e finora nessuno lo faceva.",
    comando: "grep -c '^| \\*\\*§' docs/todo.md",
  },
];
