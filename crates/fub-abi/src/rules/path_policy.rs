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
//!   indicizza, se il sync lo porta — non è una domanda sul nome ed è il §15.6,
//!   il gemello di questa voce sul lato *quali file*. L'unico punto in cui i due
//!   si toccano è il punto iniziale, e si toccano in un modo che vale la pena
//!   dire: `.nota.md` è **legale** su ogni filesystem, quindi non è un problema
//!   di portabilità; è un problema perché `is_ignored_name` la salterebbe, cioè
//!   Fub creerebbe una nota che Fub non vede. Per questo
//!   [`NameFault::Hidden`] c'è, ed è la sola regola del modulo che non è di un
//!   filesystem ma nostra.
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
    /// non è un documento né da leggere né da scrivere.
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
    /// Un carattere di controllo (`\n`, `\t`, `\0`, U+0080–U+009F). Nessun
    /// filesystem li vuole, e un nome che ne contiene uno non si scrive né si
    /// stampa: si vede sparire.
    Control { segment: String, ch: char },
    /// Uno dei [`RESERVED_CHARS`].
    Reserved { segment: String, ch: char },
    /// Uno dei [`DOS_DEVICES`].
    Device { segment: String },
    /// Finisce con un punto o uno spazio. Windows li **tronca in silenzio**: il
    /// file si crea con un nome diverso da quello chiesto, e chi lo cerca col
    /// nome chiesto non lo trova. Gli spazi in coda li toglie [`normalized`];
    /// un punto no, perché togliere un punto cambia il nome e non lo pulisce.
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
/// # L'ordine dei controlli è dichiarato
///
/// Un nome può essere sbagliato in più modi insieme, e questa funzione risponde
/// col primo che trova. L'ordine è: il recinto, i caratteri di controllo, i
/// caratteri riservati, i device, il punto in coda, il punto in testa, la
/// lunghezza; e i segmenti si guardano da sinistra a destra. Non è
/// un'implementazione che si può cambiare senza guardare: è la risposta che la
/// fixture del §6.2 confronta con quella della gemella TypeScript, e due ordini
/// diversi darebbero due guasti diversi sullo stesso nome.
pub fn check(path: &str, naming: Naming) -> Result<(), NameFault> {
    if path.trim().is_empty() {
        return Err(NameFault::Empty);
    }
    for segment in path.split('/') {
        // Il recinto, sempre: un segmento vuoto, `.` o `..`.
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(NameFault::Traversal {
                segment: segment.to_string(),
            });
        }
        if naming == Naming::Existing {
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
        if segment.ends_with('.') || segment.ends_with(' ') {
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
pub fn normalized(path: &str) -> String {
    path.split('/')
        .map(|segment| segment.trim().nfc().collect::<String>())
        .collect::<Vec<_>>()
        .join("/")
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
    fn il_recinto_vale_nei_due_versi() {
        for naming in [Naming::Existing, Naming::New] {
            assert_eq!(faults("../fuori.md", naming), Some("traversal"));
            assert_eq!(faults("a/../../fuori.md", naming), Some("traversal"));
            assert_eq!(faults("./nota.md", naming), Some("traversal"));
            assert_eq!(faults("a//b.md", naming), Some("traversal"));
            assert_eq!(faults("/assoluto.md", naming), Some("traversal"));
            assert_eq!(faults("", naming), Some("empty"));
            assert_eq!(faults("   ", naming), Some("empty"));
            assert_eq!(faults("Progetti/Alpha.md", naming), None);
        }
    }

    #[test]
    fn un_nome_che_ce_gia_si_legge_anche_se_non_e_portabile() {
        // Il caso che dà senso alle due tolleranze: un vault sincronizzato da
        // Linux contiene questi file, e non aprirli vorrebbe dire non aprire il
        // vault.
        for esistente in [
            "CON.md",
            "nota?.md",
            "domande: e risposte.md",
            "finisce con un punto.",
            ".nascosta.md",
            "Progetti/con|pipe.md",
        ] {
            assert_eq!(
                faults(esistente, Naming::Existing),
                None,
                "`{esistente}` esiste: leggerlo non è un errore"
            );
            assert!(
                check(esistente, Naming::New).is_err(),
                "`{esistente}` non va creato"
            );
        }
    }

    #[test]
    fn i_device_dos_lo_sono_a_ogni_estensione() {
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
    fn i_caratteri_che_un_filesystem_si_riserva() {
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
    fn il_punto_in_coda_e_quello_in_testa_sono_due_guasti_diversi() {
        assert_eq!(faults("nota..md", Naming::New), None); // il punto è in mezzo
        assert_eq!(faults("nota.", Naming::New), Some("trailing-dot"));
        assert_eq!(
            faults("cartella./nota.md", Naming::New),
            Some("trailing-dot")
        );
        assert_eq!(faults(".gitignore", Naming::New), Some("hidden"));
        assert_eq!(faults(".fub/roba.md", Naming::New), Some("hidden"));
        assert_eq!(faults("Progetti/.nascosta.md", Naming::New), Some("hidden"));
    }

    #[test]
    fn la_lunghezza_si_conta_in_byte_e_non_in_caratteri() {
        // 64 emoji: 64 caratteri, 128 code unit UTF-16, 256 byte. Chi contasse
        // i caratteri lo lascerebbe passare, e il file non si creerebbe.
        let emoji = "🌍".repeat(64);
        assert_eq!(emoji.chars().count(), 64);
        assert_eq!(emoji.len(), 256);
        assert_eq!(faults(&emoji, Naming::New), Some("too-long"));
        // Al limite esatto passa.
        let al_limite = "a".repeat(MAX_SEGMENT_BYTES);
        assert_eq!(faults(&al_limite, Naming::New), None);
        assert_eq!(
            faults(&"a".repeat(MAX_SEGMENT_BYTES + 1), Naming::New),
            Some("too-long")
        );
        // È un limite **per segmento**: un path lungo con segmenti corti va bene,
        // perché il limite del path intero non è una proprietà del nome.
        let profondo = (0..40).map(|_| "cartella").collect::<Vec<_>>().join("/");
        assert!(profondo.len() > MAX_SEGMENT_BYTES);
        assert_eq!(faults(&format!("{profondo}/nota.md"), Naming::New), None);
    }

    #[test]
    fn un_nome_nuovo_si_scrive_in_nfc() {
        // `Café` in NFD è come lo scrive macOS. Creandolo così accanto a uno in
        // NFC il vault avrebbe due file che per il grafo sono uno.
        let nfd = "Cafe\u{0301}.md";
        let nfc = "Café.md";
        assert_ne!(nfd, nfc);
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
    fn normalized_toglie_gli_spazi_di_ogni_segmento_e_non_i_punti() {
        assert_eq!(normalized("  nota.md  "), "nota.md");
        // Per segmento, non solo ai due estremi del path: `cartella ` sarebbe un
        // nome di cartella che Windows tronca.
        assert_eq!(normalized("cartella / nota.md"), "cartella/nota.md");
        // Il punto in coda resta, e `check` lo segnala.
        assert_eq!(normalized("nota. "), "nota.");
        assert_eq!(
            faults(&normalized("nota. "), Naming::New),
            Some("trailing-dot")
        );
        // Uno spazio in coda invece sparisce prima di arrivare a `check`, che è
        // il motivo per cui `TrailingDot` si chiama così e non «punto o spazio».
        assert_eq!(faults(&normalized("nota.md "), Naming::New), None);
    }

    #[test]
    fn l_ordine_dei_controlli_e_quello_dichiarato() {
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
