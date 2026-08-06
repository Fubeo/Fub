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
      "prima di questo presidio lo stesso documento ne dichiarava due diversi.",
    comando:
      "awk '/^[[:space:]]*interface host-/{i=1} i&&/^}/{i=0} i&&/:[[:space:]]*func/{n++} END{print n+0}'" +
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
      "sei» e poi ne elencavano cinque.",
    comando:
      "sed -n '/^pub trait VaultStructure/,/^}/p' crates/fub-abi/src/traits.rs" +
      " | grep -cE '^[[:space:]]+fn '",
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
      "niente (§15.3).",
    comando:
      "grep -rhE '^ *(pub(\\([a-z]+\\))? )?const [A-Z_]+VERSION: u(8|16|32|64|size) = '" +
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
      "file; a vedere gli altri è un conto che cammina la cartella.",
    comando:
      "grep -rlE '#\\[(tauri::)?command\\]|generate_handler!' crates/fub-app/src | wc -l",
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
      "conto che guarda il sorgente da fuori.",
    comando: "grep -rcE '^pub fn catalog\\(\\)' crates/fub-kernel/src | grep -vc ':0'",
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
      "non ha dichiarato niente. Misurato togliendo la riga (§15.6).",
    comando: "grep -rlE '^pub fn [a-z_]*settings\\(\\)' crates/fub-kernel/src | wc -l",
  },
  {
    nome: "durabilita-su-ogni-piattaforma",
    ragione:
      "Quanti test di `crates/fub-kernel/tests/la_durabilita.rs` non hanno " +
      "**nessun** `#[cfg(…)]` davanti, cioè quanti ne restano dove la " +
      "piattaforma non regala inode né hardlink. È il presidio contro una specie " +
      "di difetto che nessun colore segnala: la CI gira `cargo test --workspace` " +
      "anche su windows-latest, e per anni quel job è passato verde perché i " +
      "presidi che avrebbero interrogato il caso là non erano compilati — **una " +
      "suite che si svuota in silenzio è indistinguibile da una suite verde** " +
      "(§23.16). Un test non può accorgersene, perché il test che se ne " +
      "accorgerebbe è proprio quello che non c'è: se ne accorge un conto che " +
      "legge il sorgente da fuori. Guarda `#[cfg`, non `#[cfg(unix)]`, e la " +
      "differenza è stata misurata: la prima forma di questo comando cercava la " +
      "stringa esatta, e mettendo `#[cfg(not(windows))]` davanti a tutti e " +
      "undici i test la suite su Windows si svuotava del tutto mentre il conto " +
      "restava undici — cioè il presidio era cieco proprio al gesto che esiste " +
      "per prendere.",
    comando:
      "awk '/^[[:space:]]*#\\[cfg/{g=1;next} /^[[:space:]]*#\\[test\\]/{if(g==1){g=0}else{n++}}" +
      " END{print n+0}' crates/fub-kernel/tests/la_durabilita.rs",
  },
  {
    nome: "crate-del-workspace",
    ragione: "I crate che ereditano la versione dal `Cargo.toml` della radice.",
    comando: "ls -d crates/*/ | wc -l",
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
      "presidio è ciò che lo fa notare quando risale.",
    comando: "grep -rEc 'console\\.(warn|error)' frontend/src | awk -F: '{n+=$2} END{print n+0}'",
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
      "smettono di parlare dello stesso insieme.",
    comando:
      "ls crates/fub-features/src/*.rs | grep -vE '/(lib|inventario)\\.rs$' | wc -l",
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
      "I posti da cui la coda degli eventi verso gli handler si svuota, cioè da " +
      "cui un evento può sparire senza arrivare a nessuno. Ognuno dei tre ha una " +
      "ragione scritta accanto in `dispatcher.rs`; il quarto — quello che " +
      "svuotava `pending` in blocco a budget esaurito, senza guardare " +
      "`is_recoverable` — era il difetto del §20.5, e nessun test lo vedeva " +
      "perché sul bus quegli eventi passavano lo stesso. Un quinto si aggiunge " +
      "con una riga: `self.pending.clear()` è la cosa più facile da scrivere per " +
      "uscire da una situazione difficile, e questo conto è l'attore che se ne " +
      "accorge — un test non può, perché il test che se ne accorgerebbe è " +
      "proprio quello che chi butta non ha scritto.",
    comando:
      "grep -cE '^[[:space:]]+self\\.pending\\.clear\\(\\);$'" +
      " crates/fub-kernel/src/dispatcher.rs",
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
