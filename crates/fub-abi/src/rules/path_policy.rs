//! I nomi che un vault **contiene**, e i nomi che un vault può **far nascere**.
//!
//! Sono due domande diverse, e questo modulo è qui perché confonderle costa in
//! due modi opposti. Un vault è portabile per progetto — si copia su una chiavetta,
//! si sincronizza fra macOS e Windows, si tiene sotto git — quindi dentro può
//! esserci già un file che il filesystem di qualcun altro non accetterebbe: una
//! nota `CON.md` scritta su Linux, un nome in NFD scritto da macOS, un `nota?.md`
//! arrivato da un import. Rifiutarsi di **leggerli** vorrebbe dire rifiutarsi di
//! aprire il vault, e «il vault è la verità» (§15.7): la verità non si rifiuta di
//! aprire. Ma **crearne** uno nuovo così è un'altra cosa: è Fub che scrive un
//! nome che, il giorno in cui il vault attraversa un sistema operativo, non si
//! aprirà più — e allora il difetto è nostro.
//!
//! Da qui la firma: [`check`] non si può chiamare senza dire **quale delle due
//! domande** si sta ponendo ([`Naming`]). Due funzioni separate avrebbero
//! permesso di chiamare la tollerante dove serviva la stretta senza che niente,
//! al punto di chiamata, dicesse che si era scelto.
//!
//! # La regola che si applica è quella di tutti, non quella di chi scrive
//!
//! Per [`Naming::New`] valgono insieme i vincoli di **ogni** filesystem su cui il
//! vault potrebbe finire, non quelli di quello su cui gira il processo adesso.
//! Un nome creato su Linux e legale lì è un file che su Windows non si apre, e chi
//! lo scopre lo scopre dopo aver sincronizzato — cioè quando il file c'è già e
//! rinominarlo è un rename che riscrive i wikilink di tutti.
//!
//! # Cosa NON è duplicato qui
//!
//! - **La chiave con cui due nomi si scoprono lo stesso nome** è
//!   [`resolution_key`](super::path::resolution_key), e ci sta già: la
//!   *case-insensitivity* di 2.3 non è una regola nuova, è quella.
//!
//!   Fino alla 0107 questa riga proseguiva così: «*un vault che contiene
//!   `Nota.md` e `nota.md` è già ambiguo per il grafo prima di esserlo per il
//!   filesystem, e la risposta è una sola perché la domanda è una sola*». Era
//!   **falso**, e in un modo che dichiarava coperto ciò che non lo era:
//!   `resolution_key` non *rileva* l'ambiguità, la **collassa in silenzio** —
//!   due file diversi diventano una chiave sola e vince chi capita. La domanda
//!   non è una: *quali nomi sono candidati* la risponde `resolution_key`, *chi
//!   ha ragione fra i candidati* la risponde
//!   [`exact_key`](super::path::exact_key), e *quando nessuna delle due può
//!   rispondere* — due file nella radice del vault, dove nessun wikilink
//!   disambigua — la risposta non è una regola, è dirlo:
//!   `HealthCheck::CollidingPaths`.
//! - **La normalizzazione Unicode** è la stessa NFC di `resolution_key`, applicata
//!   ai nomi invece che alle chiavi: [`normalized`]. Non c'è una seconda
//!   implementazione, c'è un secondo cliente.
//! - **Se un file *partecipa*** — se la scansione lo guarda, se la ricerca lo
//!   indicizza, se il sync lo porta — non è una domanda sul nome, è la politica
//!   di esclusione del §15.6 (`fub_kernel::ignore`), il gemello di questa voce
//!   sul lato *quali file*. I due si toccano in due punti, e valgono entrambi la
//!   pena di essere detti.
//!
//!   Il primo è **lo spazio macchina** ([`MACHINE_DIRS`]), e lì non si toccano:
//!   è la stessa regola scritta due volte perché serve a due domande. Di là dice
//!   che la scansione non guarda `.fub/` e `.trash/`; di qua dice che nessuno li
//!   **nomina**. Tenerla solo di là voleva dire che il percorso di scrittura non
//!   la applicava affatto, e la protezione era accidentale — reggeva finché
//!   nessuno registrava un provider per `.json`.
//!
//!   Il secondo è il punto iniziale: `.nota.md` è
//!   **legale** su ogni filesystem, quindi non è un problema di portabilità; è
//!   un problema perché di norma la scansione la salterebbe, cioè Fub creerebbe
//!   una nota che Fub non vede. Per questo [`NameFault::Hidden`] c'è, ed è la
//!   sola regola del modulo che non è di un filesystem ma nostra.
//!
//!   **Resta vera anche in un vault che mostra i nascosti**, e l'asimmetria è
//!   voluta: quella politica dice cosa fare dei file che *ci sono già* — un
//!   `.gitignore`, una cartella che arriva da un altro strumento — e non
//!   autorizza Fub a **crearne** uno. Un nome che di default sparirebbe alla
//!   vista è un nome che l'utente non deve poter scegliere per una nota nuova:
//!   la preferenza si può ribaltare in un clic, e le note create mentre era
//!   accesa resterebbero invisibili senza che nessuno le nomini.
//! - **La lunghezza del path assoluto.** Windows tronca a 260 caratteri il path
//!   *intero*, che dipende da dove sta il vault: `C:\v\nota.md` e un vault dentro
//!   sette cartelle con nomi lunghi hanno lo stesso nome di file e due esiti
//!   diversi. Non è una proprietà del nome, quindi non è una regola del
//!   contratto — `fub-abi` non sa dove sia la radice e non deve saperlo. Il
//!   limite che **è** del nome è quello del singolo segmento
//!   ([`MAX_SEGMENT_BYTES`]); l'altro è di chi conosce il filesystem, cioè il
//!   §15.1.
//! - **Riparare un nome invece di rifiutarlo.** Un `sanitize` che sostituisse i
//!   caratteri illegali serve a un *import*, dove nessun umano sta guardando e un
//!   nome qualunque è meglio di un file scartato; serve *male* a chi sta digitando
//!   un titolo, che va corretto e non corretto di nascosto. Nascerebbe come una
//!   seconda politica che decide le stesse cose in modo diverso, e va deciso con
//!   il suo cliente vero (17.x) invece che in anticipo e a vuoto.

use crate::error::PluginError;
use crate::model::DocId;
use unicode_normalization::UnicodeNormalization;

/// Quanti byte può avere **un segmento** di path.
///
/// 255 è il limite di ext4, APFS, HFS+ e NTFS. NTFS conta code unit UTF-16 e non
/// byte, ma 255 byte UTF-8 sono sempre al massimo 255 code unit — l'ASCII pareggia
/// e tutto il resto costa più byte che unit — quindi contare i byte è il vincolo
/// **più stretto dei due** e non ne lascia passare uno.
pub const MAX_SEGMENT_BYTES: usize = 255;

/// I caratteri che un filesystem si riserva, uniti fra i tre sistemi.
///
/// `<>:"|?*` sono di Windows; `/` è il separatore in tutti e tre e `\` lo è su
/// Windows. Su Linux sarebbero legali quasi tutti, ed è precisamente il motivo
/// per cui stanno qui: il vault che li contiene è quello che poi non si apre
/// altrove.
pub const RESERVED_CHARS: &[char] = &['<', '>', ':', '"', '|', '?', '*', '\\', '/'];

/// I nomi di device DOS, che su Windows non sono nomi di file **a nessuna
/// estensione**: `CON.md` è ancora la console.
///
/// Sono vivi in ogni versione di Windows per compatibilità con MS-DOS, e la
/// verifica guarda il nome fino al primo punto, senza distinzione di caso.
pub const DOS_DEVICES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// I nomi di cartella che sono **lo spazio macchina** di un vault, non il suo
/// contenuto: `.fub` (impostazioni, registro, anagrafe, bozze, blob dei plugin)
/// e `.trash` (le note cestinate e i loro sidecar).
///
/// Stanno qui, nel contratto, e non solo in `fub_kernel::ignore`, perché sono la
/// **stessa** regola letta dalle due parti: la politica di esclusione dice che
/// la scansione non li guarda, e questa dice che nessuno li nomina. Finché la
/// regola viveva solo di là, un `write_document(".fub/data/plugins/altro/x.md")`
/// superava il recinto — `Naming::Existing` non guarda il punto in testa, per
/// scelta — e atterrava in un posto che l'anagrafe non elenca e che nessuna
/// fusione protegge: i metadati di un vault sovrascritti da byte arbitrari, o lo
/// spazio dati di un altro plugin scritto aggirando il recinto per-plugin di
/// `data_*`.
///
/// Il confronto è su **ogni** segmento, non solo sul primo, ed è il verso di
/// `is_ignored`: un `.fub` a metà path è invisibile alla scansione esattamente
/// quanto quello in radice, e ciò che non si vede non si scrive.
pub const MACHINE_DIRS: &[&str] = &[".fub", ".trash"];

/// Quale delle due domande si sta ponendo su un nome.
///
/// Non ha un valore di default **di proposito**: la tolleranza sbagliata è
/// invisibile a chi legge il codice, e questo è l'unico posto in cui la si può
/// rendere visibile.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Naming {
    /// Un nome che **c'è già**: aprirlo, leggerlo, elencarlo, rinominarlo *via*,
    /// cestinarlo. Passa tutto ciò che un filesystem qualunque può contenere;
    /// si rifiuta soltanto ciò che non nomina un posto **dentro** il vault.
    ///
    /// È il recinto, e vale in entrambi i versi: `../../.ssh/authorized_keys`
    /// non è un documento né da leggere né da scrivere. Con lui vale il recinto
    /// interno ([`MACHINE_DIRS`]): `.fub/settings.json` è dentro il vault e non
    /// è comunque un documento.
    Existing,
    /// Un nome che **sta nascendo**: creazione, destinazione di un rename,
    /// import, template. Il recinto più tutto il resto.
    New,
}

/// Perché un nome non va bene.
///
/// Ogni variante porta il **segmento** a cui si riferisce, non il path intero:
/// su `Progetti/CON.md` ciò che non va è `CON.md`, e un messaggio che nominasse
/// tutto il path lascerebbe a chi legge il lavoro di cercare dove.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NameFault {
    /// Il path non nomina niente: vuoto, o solo spazi.
    Empty,
    /// Un segmento vuoto (`a//b`), `.` oppure `..`. È il recinto: un `..` di
    /// troppo esce dal vault, e ciò che sta fuori dal vault non è un documento.
    Traversal { segment: String },
    /// Un segmento che nomina lo spazio macchina ([`MACHINE_DIRS`]). È l'altra
    /// metà del recinto: `.fub/` e `.trash/` stanno *dentro* il vault, ma non
    /// sono il vault — sono come è fatto, e non si nominano come si nomina una
    /// nota.
    Machine { segment: String },
    /// Un carattere di controllo (`\n`, `\t`, `\0`, U+0080–U+009F). Nessun
    /// filesystem li vuole, e un nome che ne contiene uno non si scrive né si
    /// stampa: si vede sparire.
    Control { segment: String, ch: char },
    /// Uno dei [`RESERVED_CHARS`].
    Reserved { segment: String, ch: char },
    /// Uno dei [`DOS_DEVICES`].
    Device { segment: String },
    /// Finisce con un punto. Windows lo **tronca in silenzio**: il file si crea
    /// con un nome diverso da quello chiesto, e chi lo cerca col nome chiesto
    /// non lo trova.
    ///
    /// Windows tronca anche lo spazio in coda, e qui non compare: quello lo
    /// toglie [`normalized`], che è la forma su cui [`check`] giudica un nome
    /// nuovo. Un punto no, perché togliere un punto cambia il nome e non lo
    /// pulisce — chi lo ha scritto va avvisato, non corretto di nascosto. È la
    /// ragione per cui questo guasto si chiama così e non «punto o spazio».
    TrailingDot { segment: String },
    /// Comincia con un punto. È l'unica regola del modulo che non è di un
    /// filesystem ma di Fub: la scansione salta ogni nome che comincia col
    /// punto, quindi una nota così nasce invisibile a chi l'ha creata.
    Hidden { segment: String },
    /// Più lungo di [`MAX_SEGMENT_BYTES`].
    TooLong { segment: String, bytes: usize },
}

impl NameFault {
    /// L'etichetta stabile di questo guasto.
    ///
    /// È ciò che attraversa la fixture del §6.2 e ciò su cui la shell mappa la
    /// propria chiave di catalogo. **Il messaggio no**: la frase che una persona
    /// legge è del catalogo di chi la mostra ([decisione 0042]), e legare qui la
    /// prosa italiana vorrebbe dire legare due cose che devono restare libere di
    /// divergere — il *giudizio* è la regola, la sua formulazione non lo è.
    ///
    /// [decisione 0042]: ../../../../docs/decisions/0042-il-catalogo-della-shell.md
    pub fn tag(&self) -> &'static str {
        match self {
            NameFault::Empty => "empty",
            NameFault::Traversal { .. } => "traversal",
            NameFault::Machine { .. } => "machine",
            NameFault::Control { .. } => "control",
            NameFault::Reserved { .. } => "reserved",
            NameFault::Device { .. } => "device",
            NameFault::TrailingDot { .. } => "trailing-dot",
            NameFault::Hidden { .. } => "hidden",
            NameFault::TooLong { .. } => "too-long",
        }
    }

    /// Il segmento a cui il guasto si riferisce, se ce n'è uno.
    pub fn segment(&self) -> Option<&str> {
        match self {
            NameFault::Empty => None,
            NameFault::Traversal { segment }
            | NameFault::Machine { segment }
            | NameFault::Control { segment, .. }
            | NameFault::Reserved { segment, .. }
            | NameFault::Device { segment }
            | NameFault::TrailingDot { segment }
            | NameFault::Hidden { segment }
            | NameFault::TooLong { segment, .. } => Some(segment),
        }
    }
}

impl std::fmt::Display for NameFault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NameFault::Empty => write!(f, "il nome è vuoto"),
            NameFault::Traversal { segment } => write!(
                f,
                "`{segment}` non nomina un posto dentro il vault: un documento si \
                 nomina con un path relativo, senza `.` né `..`"
            ),
            NameFault::Machine { segment } => write!(
                f,
                "`{segment}` è lo spazio macchina del vault, non il suo contenuto: \
                 non nomina un documento"
            ),
            NameFault::Control { segment, ch } => write!(
                f,
                "`{segment}` contiene un carattere di controllo (U+{:04X})",
                *ch as u32
            ),
            NameFault::Reserved { segment, ch } => write!(
                f,
                "`{segment}` contiene `{ch}`, che un filesystem si riserva"
            ),
            NameFault::Device { segment } => write!(
                f,
                "`{segment}` è un nome di device DOS: su Windows non è un nome di file"
            ),
            NameFault::TrailingDot { segment } => write!(
                f,
                "`{segment}` finisce con un punto, e Windows lo tronca in silenzio"
            ),
            NameFault::Hidden { segment } => write!(
                f,
                "`{segment}` comincia con un punto: la scansione del vault lo salterebbe"
            ),
            NameFault::TooLong { segment, bytes } => write!(
                f,
                "`{segment}` è lungo {bytes} byte, il massimo è {MAX_SEGMENT_BYTES}"
            ),
        }
    }
}

impl std::error::Error for NameFault {}

/// Questo path si può usare, per l'uso dichiarato da `naming`?
///
/// Il path è **relativo al vault** e i suoi separatori sono `/`: un `\` qui non
/// è un separatore ma un carattere riservato, che è la stessa lettura che
/// `data_*` fa dei propri path. Chi accetta la forma Windows la converte *prima*
/// di chiamare — non lo fa questa funzione, perché convertire un separatore è una
/// tolleranza di un varco specifico e non una regola del contratto.
///
/// # Un nome che nasce si giudica nella forma in cui verrà scritto
///
/// Per [`Naming::New`] la domanda non è «va bene ciò che è stato digitato», è
/// «va bene ciò che finirà sul disco» — e ciò che finisce sul disco è
/// [`normalized`], non `path`. Quindi il giudizio si dà **su quello**, e le due
/// funzioni non sono più due posti che si copiano: sono la stessa espressione.
///
/// Finché non lo erano divergevano nei due versi, ed è il difetto 0068. In un
/// verso `check` **accettava** ciò che poi non si poteva scrivere: `" .nota.md"`
/// passava — non comincia con un punto, comincia con uno spazio — e `normalized`
/// ne faceva `".nota.md"`, un file che la scansione salta, cioè una nota creata
/// e invisibile a chi l'ha creata. Non era il caso di un carattere ma di una
/// classe: `" CON.md"` passava allo stesso modo e diventava la console
/// (`is_dos_device` guarda il pezzo fino al primo punto, e quel pezzo era `" CON"`),
/// e un nome al limite dei byte può superarlo dopo la composizione NFC. Nell'altro
/// verso `check` **rifiutava** ciò che si poteva benissimo scrivere: `"nota.md "`
/// dava `TrailingDot` per un nome che sarebbe nato `"nota.md"`.
///
/// La difesa di prima era che ogni chiamante normalizzasse *prima* di chiedere —
/// cosa che i due chiamanti facevano entrambi, ed è la ragione per cui nessuno
/// se n'era accorto. Ma è una disciplina da ripetere a ogni sito nuovo, e questo
/// è un modulo del **contratto**: chi scrive un plugin chiama `check` e scrive
/// `normalized`, e nessuna firma glielo diceva.
///
/// Per [`Naming::Existing`] non si normalizza, e non è un'asimmetria: quel nome
/// non lo stiamo scrivendo noi: c'è già, e com'è scritto lo dice il disco.
///
/// # L'ordine dei controlli è dichiarato
///
/// Un nome può essere sbagliato in più modi insieme, e questa funzione risponde
/// col primo che trova. L'ordine è: il recinto — segmenti vuoti, `.`, `..` e lo
/// spazio macchina ([`MACHINE_DIRS`]) —, i caratteri di controllo, i
/// caratteri riservati, i device, il punto in coda, il punto in testa, la
/// lunghezza; e i segmenti si guardano da sinistra a destra. Non è
/// un'implementazione che si può cambiare senza guardare: è la risposta che la
/// fixture del §6.2 confronta con quella della gemella TypeScript, e due ordini
/// diversi darebbero due guasti diversi sullo stesso nome.
pub fn check(path: &str, naming: Naming) -> Result<(), NameFault> {
    // Dichiarato fuori dall'`if` perché il `&str` che segue ci vive dentro: è la
    // forma che dura quanto la funzione, senza chiedere una `Cow` a chi legge.
    let written;
    let path = if naming == Naming::New {
        written = normalized(path);
        written.as_str()
    } else {
        path
    };
    if path.trim().is_empty() {
        return Err(NameFault::Empty);
    }
    for (the, segment) in path.split('/').enumerate() {
        // Il recinto, sempre: un segmento vuoto, `.` o `..`. La riga sta in
        // [`risalita`] e non qui perché è la stessa domanda che [`fenced`] fa
        // da sola, e due copie divergono.
        if let Some(fault) = ascent(segment) {
            return Err(fault);
        }
        // E il recinto interno, sempre anche lui: lo spazio macchina non è
        // fuori dal vault, è **sotto** — e un documento non lo nomina. Vale per
        // entrambe le domande, e per una che nasce arriva prima di `Hidden`:
        // `.fub/nota.md` non è «un nome che la scansione salterebbe», è la
        // cartella di Fub, e chi lo legge merita la frase giusta.
        if MACHINE_DIRS.contains(&segment) {
            return Err(NameFault::Machine {
                segment: segment.to_string(),
            });
        }
        if naming == Naming::Existing {
            // E l'altra metà del recinto, quella che si vede solo sapendo cosa
            // succede a valle: un path che **comincia** con una lettera di drive
            // non nomina un posto dentro il vault, lo nomina al posto del vault.
            // Su Windows `Path::join` con un argomento così **butta via la
            // base** — `<radice>.join("C:/Users/x/segreto.md")` è
            // `C:/Users/x/segreto.md` — quindi non è un nome strano: è la fuga,
            // e vale per leggere, per scrivere e per cestinare.
            //
            // Sta qui dentro perché per un nome che **nasce** la porta è già
            // chiusa e meglio: `:` è fra i [`RESERVED_CHARS`], e chi digita
            // `a:b.md` come titolo va avvisato che quel carattere non si può
            // usare, non che sta uscendo dal vault. La falla era tutta di qua —
            // i caratteri riservati non si guardano su un nome che si dichiara
            // esistente, ed è da lì che la fuga passava.
            //
            // Solo il primo segmento, perché solo lì Windows legge un prefisso;
            // il prezzo è che su Linux un file chiamato davvero `C:` in radice
            // smette di essere apribile, e il verso è giusto — sul sistema per
            // cui la regola c'è un nome così non esiste, e la fuga sì.
            if let Some(fault) = unit_windows(the, segment) {
                return Err(fault);
            }
            continue;
        }
        if let Some(ch) = segment.chars().find(|c| c.is_control()) {
            return Err(NameFault::Control {
                segment: segment.to_string(),
                ch,
            });
        }
        if let Some(ch) = segment.chars().find(|c| RESERVED_CHARS.contains(c)) {
            return Err(NameFault::Reserved {
                segment: segment.to_string(),
                ch,
            });
        }
        if is_dos_device(segment) {
            return Err(NameFault::Device {
                segment: segment.to_string(),
            });
        }
        // Solo il punto: uno spazio in coda qui non arriva più — `normalized`
        // l'ha già tolto, ed è la stessa `normalized` da cui `segment` viene.
        // Tenere l'`ends_with(' ')` sarebbe un ramo che non si può percorrere,
        // cioè una regola che sembra viva e non lo è.
        if segment.ends_with('.') {
            return Err(NameFault::TrailingDot {
                segment: segment.to_string(),
            });
        }
        if segment.starts_with('.') {
            return Err(NameFault::Hidden {
                segment: segment.to_string(),
            });
        }
        if segment.len() > MAX_SEGMENT_BYTES {
            return Err(NameFault::TooLong {
                segment: segment.to_string(),
                bytes: segment.len(),
            });
        }
    }
    Ok(())
}

/// Un segmento che risale, o che non nomina niente: vuoto, `.`, `..`.
fn ascent(segment: &str) -> Option<NameFault> {
    (segment.is_empty() || segment == "." || segment == "..").then(|| NameFault::Traversal {
        segment: segment.to_string(),
    })
}

/// Un primo segmento che comincia con una lettera di unità Windows.
fn unit_windows(the: usize, segment: &str) -> Option<NameFault> {
    (the == 0 && drive_prefix(segment)).then(|| NameFault::Traversal {
        segment: segment.to_string(),
    })
}

/// **Il recinto, e solo il recinto**: questo path relativo, composto sulla
/// radice del vault, atterra ancora dentro il vault?
///
/// È la metà di [`check`] che non parla di documenti ma di **posti**. Un
/// segmento vuoto, un `.`, un `..` o una lettera di unità Windows in testa
/// nominano qualcosa che sta fuori dalla radice, e il fatto che stiano fuori non
/// dipende da cosa ci si voglia fare.
///
/// Esiste separata da [`check`] perché `check` dice **anche** che lo spazio
/// macchina ([`MACHINE_DIRS`]) non si nomina, e quella è vera per un documento e
/// falsa per il vault stesso, che `.trash/Nota.md` lo compone di mestiere: un
/// vault che chiamasse `check` per comporre i propri path non saprebbe più
/// cestinare. Le due domande sono una **dentro** l'altra — `check` fa questa
/// prima di tutte le sue —, quindi non sono due politiche che possono
/// divergere, sono una sola letta a due profondità, e quale delle due si stia
/// chiedendo si legge dal nome della funzione che si chiama.
///
/// # Perché il recinto non può stare solo a monte
///
/// Il recinto lessicale a valle — «il path composto comincia per la radice?» —
/// **non è un recinto**: `<radice>/.trash/../../fuori.txt` comincia per la
/// radice segmento per segmento, e il sistema operativo, che i `..` li risolve,
/// lo apre fuori. Chi confronta prefissi deve avere già scartato i `..`, e
/// l'unico posto in cui è garantito è il punto in cui il path si **compone**.
/// Era il difetto 0158.
pub fn fenced(path: &str) -> Result<(), NameFault> {
    if path.trim().is_empty() {
        return Err(NameFault::Empty);
    }
    for (the, segment) in path.split('/').enumerate() {
        if let Some(fault) = ascent(segment) {
            return Err(fault);
        }
        if let Some(fault) = unit_windows(the, segment) {
            return Err(fault);
        }
    }
    Ok(())
}

/// La **tolleranza del varco**: come si legge un path che arriva da fuori — da
/// un plugin, dall'IPC, da un file di configurazione scritto a mano.
///
/// I separatori Windows diventano `/`, e spazi e barre in testa se ne vanno. Non
/// è una regola sui nomi: è la conversione che ogni ingresso farebbe comunque, e
/// sta qui perché farla in ogni ingresso vuol dire farla in modo diverso in uno
/// di loro.
pub fn from_outside(name: &str) -> String {
    name.replace('\\', "/")
        .trim()
        .trim_start_matches('/')
        .to_string()
}

/// Il [`DocId`] con cui **chi sta fuori** può nominare un documento, o
/// `PermissionDenied`.
///
/// È [`from_outside`] più [`check`] con [`Naming::Existing`], cioè il recinto
/// esterno e quello interno insieme: un plugin non nomina un posto fuori dal
/// vault e non nomina lo spazio macchina. Sta nel **contratto** e non nel kernel
/// perché il kernel non è l'unico host: il doppio dell'SDK
/// (`fub_sdk::testing::MemoryHost`) risponde alle stesse firme, e finché il
/// recinto viveva solo di là il doppio non ne applicava nessuno — chi provava
/// una view contro il doppio vedeva passare i path che l'host vero rifiuta, e
/// non aveva modo di accorgersene. Era il difetto 0220.
///
/// L'errore è `PermissionDenied` e non `BadArgs` perché è la stessa risposta che
/// `data_*` dà a una risalita: per chi la riceve, i due recinti si comportano
/// allo stesso modo.
pub fn fenced_doc_id(id: &DocId) -> Result<DocId, PluginError> {
    let clean = from_outside(id.as_str());
    check(&clean, Naming::Existing).map_err(|_| {
        PluginError::PermissionDenied(
            format!("`{id}`: un documento si nomina con un path relativo dentro il vault").into(),
        )
    })?;
    Ok(DocId::new(clean))
}

/// La forma con cui un nome **nuovo** si scrive sul disco: ogni segmento senza
/// spazi ai bordi, tutto in NFC.
///
/// # Perché NFC, e perché solo sui nomi nuovi
///
/// [`resolution_key`](super::path::resolution_key) fa collassare NFC e NFD sulla
/// stessa chiave, quindi per Fub `Café` composto e `Café` decomposto sono lo
/// **stesso nome**; per il filesystem di Linux sono due file distinti. Se ne
/// creassimo uno in NFD accanto a uno in NFC il vault conterrebbe due documenti
/// che il grafo, la ricerca e la sidebar considerano uno — un'ambiguità che il
/// modello non ha modo di rappresentare. Scegliere una forma sola quando la si
/// scrive la rende impossibile.
///
/// Sui nomi che **ci sono già** non si applica, e non è un'asimmetria: quelli li
/// ha scritti macOS, ed è il disco a dire come si chiama un file. Rinominarli per
/// uniformarli sarebbe una migrazione silenziosa di ciò che l'utente vede, per
/// una proprietà che `resolution_key` già garantisce senza toccare niente.
///
/// Gli spazi ai bordi si toglono e il punto in coda no: uno spazio in coda non lo
/// ha voluto nessuno — è un dito sulla barra — mentre un punto è un carattere
/// scritto, e chi lo ha scritto va avvisato ([`NameFault::TrailingDot`]) invece
/// che corretto.
///
/// **È anche la forma su cui [`check`] giudica un nome nuovo**, e non per
/// comodità: le due funzioni rispondono alla stessa domanda su due stringhe
/// diverse solo se qualcuno si ricorda di comporle nell'ordine giusto. Composte
/// qui, non c'è più un ordine da ricordare.
pub fn normalized(path: &str) -> String {
    path.split('/')
        .map(|segment| segment.trim().nfc().collect::<String>())
        .collect::<Vec<_>>()
        .join("/")
}

/// Il segmento comincia con una lettera di drive (`C:`, `c:nota.md`)?
///
/// È la forma che su Windows fa di un path un **altro posto** invece di un
/// pezzo di questo: sia quella con la radice (`C:/x`, che qui arriva così perché
/// chi accetta la forma Windows converte i separatori prima di chiamare) sia
/// quella relativa al drive (`C:x`), che è il caso che si dimentica.
fn drive_prefix(segment: &str) -> bool {
    let mut chars = segment.chars();
    matches!((chars.next(), chars.next()), (Some(c), Some(':')) if c.is_ascii_alphabetic())
}

/// Il segmento è un device DOS? Si guarda il nome fino al primo punto, senza
/// distinzione di caso: `con`, `CON.md` e `Con.txt.md` sono tutti la console.
fn is_dos_device(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or(segment);
    DOS_DEVICES
        .iter()
        .any(|d| stem.len() == d.len() && stem.eq_ignore_ascii_case(d))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// L'etichetta del guasto, o `None`: gli assert si leggono meglio su una
    /// stringa che su un enum con i payload.
    fn faults(path: &str, naming: Naming) -> Option<&'static str> {
        check(path, naming).err().map(|f| f.tag())
    }

    #[test]
    fn the_fence_equals_in_the_two_directions() {
        for naming in [Naming::Existing, Naming::New] {
            assert_eq!(faults("../fuori.md", naming), Some("traversal"));
            assert_eq!(faults("a/../../fuori.md", naming), Some("traversal"));
            assert_eq!(faults("./nota.md", naming), Some("traversal"));
            assert_eq!(faults("a//b.md", naming), Some("traversal"));
            assert_eq!(faults("/assoluto.md", naming), Some("traversal"));
            // La fuga che il recinto non vedeva. Su un nome che **nasce** era
            // già chiusa dai caratteri riservati, e infatti il guasto è un
            // altro: qui si assertisce che sia rifiutata in entrambi i versi,
            // non che si chiami allo stesso modo.
            assert!(check("C:/Users/x/segreto.md", naming).is_err());
            assert!(check("c:nota.md", naming).is_err());
            assert!(check("C:", naming).is_err());
            assert_eq!(faults("", naming), Some("empty"));
            assert_eq!(faults("   ", naming), Some("empty"));
            assert_eq!(faults("Progetti/Alpha.md", naming), None);
        }
        // E il guasto per nome, che è la parte che una persona legge: chi apre
        // un path fuori dal vault sta uscendo dal recinto, chi *digita* `a:b.md`
        // ha usato un carattere che un filesystem si riserva.
        assert_eq!(
            faults("C:/Users/x/segreto.md", Naming::Existing),
            Some("traversal")
        );
        assert_eq!(
            faults("C:/Users/x/segreto.md", Naming::New),
            Some("reserved")
        );
        // E ciò che *non* è una lettera di drive resta leggibile: il due punti
        // da solo è un carattere come un altro su Linux, e un vault che lo
        // contiene si apre (vedi `un_nome_che_ce_gia_si_legge…`).
        for within in ["note/C:/dentro.md", "CC:/dentro.md", "domande: e r.md"] {
            assert_eq!(faults(within, Naming::Existing), None, "`{within}` esiste");
        }
    }

    #[test]
    fn a_name_that_exists_already_is_reads_also_if_not_and_portable() {
        // Il caso che dà senso alle due tolleranze: un vault sincronizzato da
        // Linux contiene questi file, e non aprirli vorrebbe dire non aprire il
        // vault.
        for existing in [
            "CON.md",
            "nota?.md",
            "domande: e risposte.md",
            "finisce con un punto.",
            ".nascosta.md",
            "Progetti/con|pipe.md",
        ] {
            assert_eq!(
                faults(existing, Naming::Existing),
                None,
                "`{existing}` esiste: leggerlo non è un errore"
            );
            assert!(
                check(existing, Naming::New).is_err(),
                "`{existing}` non va creato"
            );
        }
    }

    #[test]
    fn the_device_dos_the_are_a_every_extension() {
        assert_eq!(faults("CON.md", Naming::New), Some("device"));
        assert_eq!(faults("con", Naming::New), Some("device"));
        assert_eq!(faults("NUL.txt.md", Naming::New), Some("device"));
        assert_eq!(faults("Progetti/COM1.md", Naming::New), Some("device"));
        assert_eq!(faults("LPT9.md", Naming::New), Some("device"));
        // Il caso che una lettura con `starts_with` sbaglierebbe: un nome che
        // *comincia* come un device non è un device.
        assert_eq!(faults("CONtratto.md", Naming::New), None);
        assert_eq!(faults("Console.md", Naming::New), None);
        assert_eq!(faults("COM10.md", Naming::New), None);
        assert_eq!(faults("NULLO.md", Naming::New), None);
    }

    #[test]
    fn the_chars_that_a_filesystem_is_riserva() {
        assert_eq!(faults("nota?.md", Naming::New), Some("reserved"));
        assert_eq!(faults("a:b.md", Naming::New), Some("reserved"));
        assert_eq!(faults("a\\b.md", Naming::New), Some("reserved"));
        assert_eq!(faults("\"citata\".md", Naming::New), Some("reserved"));
        assert_eq!(faults("a*b.md", Naming::New), Some("reserved"));
        assert_eq!(faults("nota\u{0}.md", Naming::New), Some("control"));
        assert_eq!(faults("nota\n.md", Naming::New), Some("control"));
        // Il non-ASCII innocuo passa: la politica non è un'allowlist di ASCII.
        assert_eq!(faults("Città è però — «così».md", Naming::New), None);
        assert_eq!(faults("漢字のノート.md", Naming::New), None);
        assert_eq!(faults("nota (1).md", Naming::New), None);
    }

    #[test]
    fn the_point_in_queue_and_that_in_head_are_two_faults_different() {
        assert_eq!(faults("nota..md", Naming::New), None); // il punto è in mezzo
        assert_eq!(faults("nota.", Naming::New), Some("trailing-dot"));
        assert_eq!(
            faults("cartella./nota.md", Naming::New),
            Some("trailing-dot")
        );
        assert_eq!(faults(".gitignore", Naming::New), Some("hidden"));
        assert_eq!(faults("Progetti/.nascosta.md", Naming::New), Some("hidden"));
    }

    /// Lo spazio macchina non si nomina, **e nemmeno si legge**: il recinto che
    /// prima si applicava solo ai nomi nuovi lasciava passare da `Existing`
    /// `.fub/settings.json` e `.trash/Nota.md`, cioè i metadati del vault e le
    /// note cestinate, che nessuna anagrafe elenca e nessuna fusione protegge.
    #[test]
    fn the_space_machine_not_and_a_document() {
        for naming in [Naming::Existing, Naming::New] {
            for within in [
                ".fub",
                ".fub/settings.json",
                ".fub/data/plugins/altro/cache.md",
                ".trash",
                ".trash/Nota.2026-07-24T15-30-00.md",
                // A ogni profondità, come `is_ignored`: un `.fub` a metà strada
                // è invisibile alla scansione quanto quello in radice.
                "Progetti/.fub/nota.md",
                "a/b/.trash/nota.md",
            ] {
                assert_eq!(faults(within, naming), Some("machine"), "`{within}`");
            }
            // È il nome esatto, non un prefisso: una nota che *comincia* come lo
            // spazio macchina è una nota.
            assert_eq!(
                faults(".fubbo/nota.md", naming).is_some(),
                naming == Naming::New
            );
            assert_eq!(faults("fub/nota.md", naming), None);
            assert_eq!(faults("Progetti/trash/nota.md", naming), None);
        }
    }

    #[test]
    fn the_length_is_counts_in_byte_and_not_in_chars() {
        // 64 emoji: 64 caratteri, 128 code unit UTF-16, 256 byte. Chi contasse
        // i caratteri lo lascerebbe passare, e il file non si creerebbe.
        let emoji = "🌍".repeat(64);
        assert_eq!(emoji.chars().count(), 64);
        assert_eq!(emoji.len(), 256);
        assert_eq!(faults(&emoji, Naming::New), Some("too-long"));
        // Al limite esatto passa.
        let to_the_limit = "a".repeat(MAX_SEGMENT_BYTES);
        assert_eq!(faults(&to_the_limit, Naming::New), None);
        assert_eq!(
            faults(&"a".repeat(MAX_SEGMENT_BYTES + 1), Naming::New),
            Some("too-long")
        );
        // È un limite **per segmento**: un path lungo con segmenti corti va bene,
        // perché il limite del path intero non è una proprietà del nome.
        let deep = (0..40).map(|_| "cartella").collect::<Vec<_>>().join("/");
        assert!(deep.len() > MAX_SEGMENT_BYTES);
        assert_eq!(faults(&format!("{deep}/nota.md"), Naming::New), None);
    }

    #[test]
    fn a_name_new_is_writes_in_nfc() {
        // `Café` in NFD è come lo scrive macOS. Creandolo così accanto a uno in
        // NFC il vault avrebbe due file che per il grafo sono uno.
        let nfd = "Cafe\u{0301}.md";
        let nfc = "Café.md";
        assert_eq!(nfd, nfc);
        assert_eq!(normalized(nfd), nfc);
        assert_eq!(normalized(nfc), nfc);
        // E la chiave di risoluzione li vedeva già uguali: è la ragione per cui
        // sceglierne una sola quando si scrive è necessario.
        assert_eq!(
            super::super::path::resolution_key(nfd),
            super::super::path::resolution_key(nfc)
        );
    }

    #[test]
    fn normalized_removes_the_spaces_of_every_segment_and_not_the_points() {
        assert_eq!(normalized("  nota.md  "), "nota.md");
        // Per segmento, non solo ai due estremi del path: `cartella ` sarebbe un
        // nome di cartella che Windows tronca.
        assert_eq!(normalized("cartella / nota.md"), "cartella/nota.md");
        // Il punto in coda resta, e `check` lo segnala — senza che chi chiede
        // debba comporre le due funzioni a mano: fino alla 0068 questi due
        // `assert` dicevano `faults(&normalized(…))`, e quella composizione era
        // precisamente la disciplina che nessuna firma imponeva.
        assert_eq!(normalized("nota. "), "nota.");
        assert_eq!(faults("nota. ", Naming::New), Some("trailing-dot"));
        // Uno spazio in coda invece sparisce prima di arrivare al controllo, che
        // è il motivo per cui `TrailingDot` si chiama così e non «punto o
        // spazio».
        assert_eq!(faults("nota.md ", Naming::New), None);
    }

    /// **`check` e `normalized` non possono contraddirsi** (difetto 0068).
    ///
    /// La proprietà non è «gli spazi in testa si rifiutano»: è che il giudizio
    /// su un nome nuovo valga per il nome che verrebbe **scritto**. Un banco su
    /// un carattere solo l'avrebbe mancata — lo spazio in testa è un caso della
    /// classe, e i suoi fratelli sono almeno tre (il device che riemerge, il
    /// punto che riemerge, il nome che accorcia e diventa lecito).
    ///
    /// Rosso prima della riparazione su cinque di questi casi; verde dopo, e
    /// **per costruzione** — `check` normalizza da sé, quindi l'uguaglianza è
    /// vera per ogni stringa e non solo per la tabella. La tabella resta perché
    /// nomina i casi che si sono rotti davvero: se un giorno qualcuno rimettesse
    /// il giudizio sulla forma digitata, qui si vedrebbe *quali* nomi cambiano.
    #[test]
    fn the_judgment_on_a_name_new_and_that_on_the_form_that_is_writes() {
        let cases = [
            (" .nota.md", Some("hidden")),       // il caso che la 0068 nominava
            (" .gitignore", Some("hidden")),     //
            (" CON.md", Some("device")),         // `is_dos_device` vedeva `" CON"`
            ("Progetti/ .x.md", Some("hidden")), // per segmento, non solo il primo
            ("nota.md ", None),                  // e il verso opposto: rifiutava il lecito
            (" nota.md ", None),                 //
            (" / ", Some("traversal")),          // ciò che si scriverebbe è `/`
            ("   ", Some("empty")),              //
            ("nota. ", Some("trailing-dot")),    // il punto resta, e resta un guasto
        ];
        for (path, expected) in cases {
            assert_eq!(
                faults(path, Naming::New),
                expected,
                "`{path}` va giudicato come `{}`",
                normalized(path)
            );
            assert_eq!(
                faults(path, Naming::New),
                faults(&normalized(path), Naming::New),
                "`{path}`: le due funzioni si sono di nuovo separate"
            );
        }
    }

    #[test]
    fn the_order_of_the_checks_and_that_declared() {
        // Lo stesso nome peggiorato un guasto alla volta: ciascuno risponde col
        // primo dell'elenco, e la fixture del §6.2 confronta *quella* risposta.
        assert_eq!(faults("..", Naming::New), Some("traversal"));
        assert_eq!(faults("CON\u{0}?.", Naming::New), Some("control"));
        assert_eq!(faults("CON?.", Naming::New), Some("reserved"));
        assert_eq!(faults("CON.", Naming::New), Some("device"));
        assert_eq!(faults("nota.", Naming::New), Some("trailing-dot"));
        assert_eq!(
            faults(&format!(".{}", "a".repeat(300)), Naming::New),
            Some("hidden"),
            "il punto in testa si vede prima della lunghezza"
        );

        // E un caso che il device *non* è, benché ne contenga il nome: il pezzo
        // prima del primo punto è vuoto, quindi `.CON.` non è la console — è un
        // nome che finisce con un punto.
        assert_eq!(faults(".CON.", Naming::New), Some("trailing-dot"));
    }
}
