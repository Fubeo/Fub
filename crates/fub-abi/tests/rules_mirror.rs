//! Il mirror delle **regole** TS↔Rust, legato da una fixture generata.
//!
//! `ts_mirror.rs` presidia i **tipi** al confine: nessuno dei due lati può
//! aggiungere una variante da solo restando verde. Le **regole** non avevano
//! niente — e sono già scritte due volte, perché ogni cosa che la UI deve
//! sapere *prima* di un giro IPC (che nome mostrare per una nota, se una casella
//! è spuntata, se due nomi sono lo stesso nome, dove cade un byte dentro una
//! stringa JavaScript) nasce in due copie. L'unica che avesse un legame lo
//! aveva scritto a mano — «è la stessa regola, riga per riga» — cioè dichiarava
//! la duplicazione invece di presidiarla.
//!
//! Il giro è quello di `mirror-samples.json`, applicato a coppie
//! **input → output** invece che a campioni di tipo: qui si genera
//! `frontend/src/__fixtures__/rules-samples.json` con la risposta **di Rust**
//! per ogni caso, e il gemello vitest (`frontend/src/rules/rules-mirror.test.ts`)
//! passa gli stessi input all'implementazione TypeScript e pretende la stessa
//! risposta. Cambiare la regola da un lato solo è rosso: se cambia Rust la
//! fixture è stantia (questo test), e rigenerandola (`UPDATE_MIRROR=1`) il rosso
//! si sposta di là.
//!
//! **Le due metà si nominano a vicenda.** Il gemello TS pretende che ogni chiave
//! della fixture abbia un suo handler *e* che ogni handler abbia una chiave: una
//! regola nuova non può entrare qui e restare non rispecchiata, né restare di là
//! senza casi.
//!
//! # Cosa NON sta qui
//!
//! - **La grammatica delle decorazioni** (wikilink, tag, evidenziato, checkbox
//!   dentro una riga): i due parser sono una scelta dichiarata del §4.4 — la
//!   live preview deve decorare mentre si digita, senza un giro IPC per tasto.
//!   Il *significato* di ciò che il parser trova sta qui (`task_checked`); dove
//!   comincia e dove finisce il token no.
//! - **L'ordinamento.** Il kernel ordina per `DocId` (ordine di byte: totale,
//!   stabile, senza locale — è ciò che tiene onesta la paginazione), la sidebar
//!   con un collatore italiano. Non sono due copie della stessa regola ma due
//!   requisiti che devono divergere, e una fixture che li legasse nascerebbe
//!   rossa e resterebbe rossa. Vedi `fub_abi::rules`.

use fub_abi::event::{BatchId, DocChange, DocChanges, Event, EventKind, EventMask, Subject};
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, TaskMarker};
use fub_abi::rules::events::{folder_contains, topic_matches};
use fub_abi::rules::path::resolution_key;
use fub_abi::rules::path_policy::{check, normalized, Naming};
use fub_abi::rules::keys;
use fub_abi::text::{ArgValue, Message, StringCatalog, Strings, Text};
use fub_abi::Span;
use serde_json::{json, Value};

/// Il nome da mostrare per un documento: basename senza l'ultima estensione.
///
/// I casi sono quelli ostili, gli unici su cui due implementazioni possono
/// dissentire: `note.backup` (un'estensione che nessuno gestisce è comunque
/// un'estensione), i dotfile (il punto iniziale è parte del nome), il doppio
/// punto, la cartella col punto dentro.
fn page_name_cases() -> Vec<Value> {
    [
        "note.md",
        "note.backup",
        "a.b.md",
        ".foo",
        "dir/.hidden.md",
        "dir/.gitignore",
        "no-ext",
        "dir.with.dots/note.md",
        "ends-with-dot.",
        "Long Note.md",
    ]
    .into_iter()
    .map(|id| json!({"id": id, "out": DocId::new(id).page_name()}))
    .collect()
}

/// La chiave con cui due nomi si scoprono lo stesso nome.
///
/// I casi che contano sono la composizione Unicode e il caso: `Café` scritto in
/// NFC (un code point) e in NFD (`e` + accento combinante, che è come macOS
/// scrive i nomi file) devono dare la stessa chiave, o su un vault sincronizzato
/// fra macOS e Linux la sidebar non trova la folder note e il grafo vede due
/// nodi. Il lato TS non faceva NFC affatto: questa è la riga che glielo impone.
fn resolution_key_cases() -> Vec<Value> {
    [
        "Café",              // NFC
        "Cafe\u{0301}",      // NFD — la stessa parola per un umano
        "  spaces around  ", // il trim
        "UPPERCASE",
        "Projects/Alpha.md",
        "ÅNGSTRÖM",     // il caso su lettere non ASCII
        "\u{212B}ngen", // il segno angstrom (NFC → Å)
        "già",
        "GIÀ",
        "",
    ]
    .into_iter()
    .map(|s| json!({"s": s, "out": resolution_key(s)}))
    .collect()
}

// ---------------------------------------------------------------------------
// La politica dei nomi (§15.5)
// ---------------------------------------------------------------------------
//
// È una regola con **due applicatori veri**, come la maschera: il kernel, che
// rifiuta un nome quando una nota nasce (`workspace::new_doc_id`), e la shell,
// che deve rifiutarlo *prima* del giro IPC — la rinomina in posto della sidebar
// scrive dentro un `<input>`, e dire «no» dopo aver perso il campo di testo
// significa far ridigitare il nome. Le due letture devono coincidere, o la shell
// manda al kernel nomi che il kernel rifiuta (rumore) oppure ne rifiuta di
// legittimi (un no che non ha nessuno che lo giustifichi).
//
// Ciò che attraversa la fixture è l'**etichetta** del guasto, non il messaggio:
// la frase che una persona legge è del catalogo della shell (decisione 0042), e
// legarla qui vorrebbe dire legare l'italiano di due file che devono restare
// liberi di divergere. Il giudizio è la regola; la sua formulazione no.

/// I nomi ostili, letti con le due tolleranze.
///
/// I casi che contano sono tre specie. **La coppia**: lo stesso nome che va bene
/// come nome che c'è e non come nome che nasce — è tutta la voce, e un lato che
/// non distinguesse le due domande passerebbe metà dei casi. **La lunghezza in
/// byte**: 64 emoji sono 64 caratteri, 128 code unit e 256 byte, e in JavaScript
/// `s.length` risponde 128 — il limite è sui byte, quindi chi non lo sa lascia
/// creare un file che il filesystem rifiuta. **I quasi-device**: `CONtratto` e
/// `COM10` cominciano come `CON` e `COM1` e non lo sono, che è l'errore di chi
/// implementa la regola con uno `startsWith`.
fn name_fault_cases() -> Vec<Value> {
    let names = [
        // Il recinto: vale per entrambe le tolleranze.
        "../outside.md",
        "a/../b.md",
        "./note.md",
        "a//b.md",
        "/absolute.md",
        "",
        "   ",
        // La lettera di drive: su Windows `join` butta via la base, quindi il
        // recinto la rifiuta in entrambe le tolleranze. E i due casi che *non*
        // lo sono, o la regola diventerebbe «niente due punti».
        "C:/Users/x/secret.md",
        "c:note.md",
        "C:",
        "note/C:/inside.md",
        "CC:/inside.md",
        // Legittimi in entrambe.
        "Projects/Alpha.md",
        "note (1).md",
        "City is though — \"like\".md",
        "漢字のノート.md",
        "note..md",
        // Portabili no, esistenti sì: la coppia che dà senso alla voce.
        "CON.md",
        "con",
        "NUL.txt.md",
        "Projects/COM1.md",
        "LPT9.md",
        "note?.md",
        "a:b.md",
        "a\\b.md",
        "\"quoted\".md",
        "a*b.md",
        "a|b.md",
        "a<b>.md",
        "note\u{0}.md",
        "note\n.md",
        "note.",
        "folder./note.md",
        ".gitignore",
        "Projects/.hidden.md",
        // Lo spazio macchina, che il recinto guarda in entrambe le domande: è
        // il caso in cui le due gemelle divergerebbero in silenzio scrivendo
        // dentro `.fub/` da una parte e rifiutando dall'altra.
        ".fub/stuff.md",
        ".fub",
        ".fub/settings.json",
        ".trash/Note.2026-07-24T15-30-00.md",
        "Projects/.fub/note.md",
        // E i quasi-spazio-macchina: cominciano come lui e non lo sono.
        ".fubbo/note.md",
        "fub/note.md",
        "Projects/trash/note.md",
        // I quasi-device: cominciano come un device e non lo sono.
        "CONtract.md",
        "Console.md",
        "COM10.md",
        "NULL.md",
        // La lunghezza, in byte e non in caratteri né in code unit.
        &"🌍".repeat(64),
        &"a".repeat(255),
        &"a".repeat(256),
        // Gli spazi ai bordi di un segmento (difetto 0068): per un nome **nuovo**
        // il giudizio è su ciò che si scriverebbe, cioè sulla forma
        // normalizzata. Ci sono per la ragione per cui la NFC ci è entrata alla
        // 0020 — è la coppia di regole che una gemella può implementare
        // separatamente senza che nulla lo dica, e qui il costo non sarebbe un
        // nome che non si risolve ma un file scritto sul disco con un nome che
        // chi lo ha chiesto non ha chiesto.
        " .note.md",
        " .gitignore",
        " CON.md",
        "Projects/ .hidden.md",
        "note.md ",
        " note.md ",
        "note. ",
        " / ",
    ];
    let mut out = Vec::new();
    for path in names {
        for (label, naming) in [("existing", Naming::Existing), ("new", Naming::New)] {
            out.push(json!({
                "path": path,
                "naming": label,
                "out": check(path, naming).err().map(|f| f.tag()),
            }));
        }
    }
    out
}

/// La forma con cui un nome nuovo si scrive sul disco: NFC, e senza spazi ai
/// bordi di ogni segmento.
///
/// È la stessa NFC di `resolution_key` con un secondo cliente, ed è nella fixture
/// per la ragione per cui la prima ci è entrata: il lato TypeScript **non faceva
/// NFC affatto** prima della 0020, e il caso che lo scopre richiede un Mac, un
/// accento e un occhio. Qui il difetto sarebbe peggiore che allora — non un nome
/// che non si risolve, ma un file scritto sul disco in una forma che il grafo
/// considera identica a un altro.
fn normalized_name_cases() -> Vec<Value> {
    [
        "Café.md",            // NFC
        "Cafe\u{0301}.md",    // NFD, come lo scrive macOS
        "  note.md  ",        // il trim
        "folder / note.md",   // per segmento, non solo ai due estremi
        "note. ",             // lo spazio va, il punto resta
        "ÅNGSTRÖM.md",
        "\u{212B}ngen.md", // il segno angstrom, che in NFC diventa Å
        "Projects/City.md",
        "già.md",
        "",
    ]
    .into_iter()
    .map(|path| json!({"path": path, "out": normalized(path)}))
    .collect()
}

/// La lettura binaria di una casella: `[x]`/`[X]` è fatta, ogni altro simbolo
/// no. Gli stati personalizzati (`[/]`, `[-]`, `[>]`) esistono e **non** sono
/// completati: è la regola di Obsidian, ed è l'unica che non inventa semantica
/// sui simboli che il prodotto non ha ancora definito.
fn task_checked_cases() -> Vec<Value> {
    [Some('x'), Some('X'), Some(' '), Some('/'), Some('-'), None]
        .into_iter()
        .map(|symbol| {
            let marker = TaskMarker {
                symbol,
                span: Span::EMPTY,
            };
            json!({
                "symbol": symbol.map(String::from),
                "out": marker.checked(),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// La maschera di un abbonamento (§10.1)
// ---------------------------------------------------------------------------
//
// È la regola con **due applicatori veri**: il kernel, che consegna a un
// `EventHandler`, e la shell, che decide quando ridisegnare una view dichiarata
// (`ui/panel-host.ts`). Le altre regole di questo file sono duplicate per
// comodità — la UI le vuole prima di un giro IPC — questa lo è per necessità, e
// due letture diverse della stessa maschera vorrebbero dire un pannello che si
// ridisegna meno di quanto il contratto promette, in silenzio.

/// I due prefissi, e i casi in cui `starts_with` sbaglierebbe.
fn topic_matches_cases() -> Vec<Value> {
    [
        ("com.acme", "com.acme:done"),
        ("com.acme", "com.acme.tasks:done"),
        ("com.acme", "com.acmecorp:done"),
        ("com.acme.tasks:board", "com.acme.tasks:board.moved"),
        ("com.acme.tasks:board", "com.acme.tasks:boards"),
        ("com.acme.tasks:done", "com.acme.tasks:done"),
        ("", "anyone:anything"),
        ("fub", "fub:index.rebuilt"),
        ("fub:index", "fub:index.rebuilt"),
        ("fub:index", "fub:indexer.done"),
    ]
    .into_iter()
    .map(|(prefix, topic)| {
        json!({"prefix": prefix, "topic": topic, "out": topic_matches(prefix, topic)})
    })
    .collect()
}

fn folder_contains_cases() -> Vec<Value> {
    [
        ("Projects", "Projects/Alpha.md"),
        ("Projects", "Projects/2026/Alpha.md"),
        ("Projects/", "Projects/Alpha.md"),
        // Gli slash di cortesia ai due capi: la stessa cartella scritta come la
        // scrive chi la incolla da un file manager e chi la pensa come un path
        // assoluto (difetto 0141).
        ("/Projects", "Projects/Alpha.md"),
        ("/Projects/", "Projects/Alpha.md"),
        ("/Projects/2026/", "Projects/2027/Alpha.md"),
        ("Projects", "Projects-old/Alpha.md"),
        ("Projects", "Projects"),
        ("Projects", "Alpha.md"),
        ("", "Alpha.md"),
        ("/", "Projects/Alpha.md"),
        ("Projects/2026", "Projects/2026/Alpha.md"),
        ("Projects/2026", "Projects/2027/Alpha.md"),
    ]
    .into_iter()
    .map(|(folder, id)| json!({"folder": folder, "id": id, "out": folder_contains(folder, id)}))
    .collect()
}

/// La regola per intero: la specie, il topic, il soggetto, **cosa è cambiato** —
/// e i casi che distinguono una lettura giusta da una plausibile (il rename che
/// esce dalla cartella, il lotto che la interseca, ciò che non nomina nessun
/// documento e deve passare comunque, e il diff che non si sa contro quello che
/// si sa vuoto).
fn mask_wants_cases() -> Vec<Value> {
    let narrow = EventMask::of([
        EventKind::DocumentChanged,
        EventKind::DocumentRenamed,
        EventKind::BatchEnded,
        EventKind::Custom,
        EventKind::Overflow,
        EventKind::VaultClosed,
    ])
    .on_topics(["com.acme.tasks"])
    .about([
        Subject::document("Diary/today.md"),
        Subject::folder("Projects"),
    ]);
    let wide = EventMask::of([EventKind::DocumentChanged, EventKind::Custom]);
    // Il quarto asse (§22.2, decisione 0069). Senza una maschera che lo
    // dichiari, `changes` sarebbe una lista vuota in ogni campione e il gemello
    // TS resterebbe verde senza aver mai filtrato su un aspetto.
    let on_tags = EventMask::of([EventKind::DocumentChanged, EventKind::Overflow])
        .on_changes([DocChange::Tags]);
    let events = [
        Event::DocumentChanged {
            id: DocId::new("Projects/Alpha.md"),
            changes: None,
        },
        Event::DocumentChanged {
            id: DocId::new("Other/Beta.md"),
            changes: None,
        },
        Event::DocumentChanged {
            id: DocId::new("Diary/today.md"),
            changes: None,
        },
        // Il rename è del soggetto di partenza E di quello d'arrivo.
        Event::DocumentRenamed {
            from: DocId::new("Projects/Alpha.md"),
            to: DocId::new("Other/Alpha.md"),
        },
        Event::DocumentRenamed {
            from: DocId::new("Other/Alpha.md"),
            to: DocId::new("Other/Gamma.md"),
        },
        Event::BatchEnded {
            batch: BatchId(1),
            changed: vec![DocId::new("Other/a.md"), DocId::new("Projects/b.md")],
        },
        Event::BatchEnded {
            batch: BatchId(2),
            changed: vec![DocId::new("Other/a.md")],
        },
        // Un lotto che ha toccato il solo indice non nomina niente: passa.
        Event::BatchEnded {
            batch: BatchId(3),
            changed: vec![],
        },
        Event::Custom {
            topic: "com.acme.tasks:done".into(),
            payload: json!({}),
        },
        Event::Custom {
            topic: "com.other.notes:done".into(),
            payload: json!({}),
        },
        // Ciò che non si riscopre riguardando il vault passa qualunque
        // soggetto: perderlo sarebbe perdere l'unica copia di un fatto.
        Event::Overflow { dropped: 7 },
        Event::VaultClosed {
            root: "/vault".into(),
        },
        // La specie non dichiarata non arriva, e viene prima di tutto il resto.
        Event::IndexUpdated,
        // I tre stati del quarto asse, che è tutto ciò che lo distingue da un
        // filtro qualunque: un diff che tocca l'aspetto dichiarato, uno che non
        // lo tocca, e uno **vuoto** — che è un fatto («niente è cambiato») e non
        // passa, mentre `None` più sopra è *non lo so* e passa.
        Event::DocumentChanged {
            id: DocId::new("Projects/Alpha.md"),
            changes: Some(DocChanges {
                aspects: vec![DocChange::Tags, DocChange::Body],
                tags_added: vec!["urgent".into()],
                ..DocChanges::default()
            }),
        },
        Event::DocumentChanged {
            id: DocId::new("Projects/Alpha.md"),
            changes: Some(DocChanges {
                aspects: vec![DocChange::Frontmatter],
                properties: vec!["deadline".into()],
                ..DocChanges::default()
            }),
        },
        Event::DocumentChanged {
            id: DocId::new("Projects/Alpha.md"),
            changes: Some(DocChanges::default()),
        },
    ];
    let mut out = Vec::new();
    for (name, mask) in [
        ("narrow", &narrow),
        ("wide", &wide),
        ("on_tags", &on_tags),
    ] {
        for event in &events {
            out.push(json!({
                "mask_name": name,
                "mask": mask,
                "event": event,
                "out": mask.wants(event),
            }));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Gli offset: byte UTF-8 ↔ code unit UTF-16
// ---------------------------------------------------------------------------
//
// Questa è l'unica regola della fixture che in Rust non ha una funzione: uno
// `Span` è in byte perché è così che Rust indicizza le stringhe, e un `usize`
// non ha bisogno di essere convertito in sé stesso. Ce l'ha però un **oracolo**,
// ed è `str` — la definizione di «byte» e «code unit» sta lì, non in una
// libreria che potremmo scrivere male. Il lato TS ha invece l'implementazione
// vera, perché CodeMirror (come ogni stringa JavaScript) indicizza in UTF-16, e
// senza questa conversione uno `Span` che arriva dal core cade righe più in là.

/// L'oracolo dell'andata. Un offset che cadesse *dentro* un carattere
/// multibyte si arrotonda al confine successivo, e oltre la fine si ottiene la
/// lunghezza del documento: uno scroll non deve mai lanciare.
fn byte_to_utf16(text: &str, byte: usize) -> usize {
    let mut bytes = 0;
    let mut units = 0;
    for ch in text.chars() {
        if bytes >= byte {
            return units;
        }
        bytes += ch.len_utf8();
        units += ch.len_utf16();
    }
    units
}

/// L'oracolo del ritorno, con le stesse regole lette al contrario.
fn utf16_to_byte(text: &str, unit: usize) -> usize {
    let mut bytes = 0;
    let mut units = 0;
    for ch in text.chars() {
        if units >= unit {
            return bytes;
        }
        bytes += ch.len_utf8();
        units += ch.len_utf16();
    }
    bytes
}

/// I testi su cui la conversione non è l'identità: un accento (2 byte, 1 code
/// unit), un'emoji (4 byte, 2 code unit — una coppia surrogata), un ideogramma
/// (3 byte, 1 code unit).
const OFFSET_TEXTS: &[&str] = &[
    "pure ascii",
    "city is though",
    "hello 🌍 world",
    "漢字とかな",
    "🌍🌎🌏",
    "",
];

fn offset_cases(forward: bool) -> Vec<Value> {
    let mut out = Vec::new();
    for text in OFFSET_TEXTS {
        // Ogni indice, confini di carattere compresi e non: i casi interessanti
        // sono proprio quelli che cadono in mezzo a un carattere.
        let limit = if forward {
            text.len()
        } else {
            text.chars().count() * 2
        };
        for the in 0..=limit + 2 {
            out.push(if forward {
                json!({"text": text, "byte": the, "out": byte_to_utf16(text, the)})
            } else {
                json!({"text": text, "unit": the, "out": utf16_to_byte(text, the)})
            });
        }
    }
    out
}

/// I testi su cui la grammatica di un `#tag` si decide, e su cui la live
/// preview della shell rispondeva **un'altra cosa** prima della §4.4.
///
/// Non è un campione di tag: è un campione dei tre confini che
/// [`fub_abi::rules::tag::scan_tags`] dichiara, più le forme che una seconda
/// implementazione scrive per prime e sbagliate — il `#` dopo un segno di
/// punteggiatura, l'accento decomposto, le cifre non ASCII.
const TAG_TEXTS: &[&str] = &[
    "hello #project and #area/work",
    "issue #123 and color #fff ok",
    "a#b is not a tag",
    "see.#tag and (#other) and \"#third\"",
    "_#after-an-underscore",
    "##double",
    "#Caf\u{e9} vs #Cafe\u{301}",
    "#\u{661}\u{662}\u{663} is not #123",
    "trailing #",
    "emoji 🌍 then #after-emoji",
    "",
];

/// I tag di un testo, con gli span in **code unit UTF-16**.
///
/// La regola risponde in byte, che è la valuta del modello; la gemella
/// TypeScript vive dove la valuta è la code unit, e non esiste un `String` JS
/// indicizzabile a byte. La conversione è quella già rispecchiata qui sopra
/// (`byte_to_utf16`), quindi la fixture non introduce una terza regola: compone
/// due che ci sono già.
fn scan_tags_cases() -> Vec<Value> {
    TAG_TEXTS
        .iter()
        .map(|text| {
            let tags: Vec<Value> = fub_abi::rules::tag::scan_tags(text)
                .into_iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "from": byte_to_utf16(text, t.span.start),
                        "to": byte_to_utf16(text, t.span.end),
                    })
                })
                .collect();
            json!({"text": text, "out": tags})
        })
        .collect()
}

/// La fixture attesa, costruita dalle regole Rust.
///
/// Una chiave qui è una regola che **esiste in due lingue**: aggiungerne una
/// vuol dire scriverne la gemella TypeScript, o il gemello vitest resta rosso.
/// La forma canonica di una scorciatoia (§1.36).
///
/// I casi che contano sono le tre specie su cui due implementazioni possono
/// dissentire senza accorgersene. **L'ordine dei modificatori**, che è il motivo
/// per cui una forma canonica esiste: `Shift-Mod-g` e `Mod-Shift-g` sono un
/// gesto solo. **La sequenza**: `Mod-k d` è due accordi separati da uno spazio,
/// e la copia che spezzasse solo sul `-` la leggerebbe come un accordo con un
/// tasto che si chiama `k d` — è precisamente ciò che le due copie Rust facevano
/// (difetto 0148). E **ciò che non si sa premere**, che non è una forma diversa
/// ma un rifiuto: un modificatore che non esiste, un primo tasto nudo, un
/// accordo senza tasto. Su queste la risposta è `null` dai due lati, o la shell
/// rifiuta una riga che il resto dell'app ha già accettato.
fn canonical_chord_cases() -> Vec<Value> {
    [
        "Mod-Shift-g",
        "Shift-Mod-g",
        "Mod-k d",
        "Mod-k  d",
        "Mod-K",
        "  Mod-g  ",
        "Mod-ArrowUp",
        "Alt-Mod-Shift-p",
        // Ciò che questa app non sa premere.
        "Ctrl-k",    // il modificatore che non esiste
        "d",         // il primo tasto nudo, che ruberebbe una lettera a chi scrive
        "Mod-",      // l'accordo senza tasto
        "Mod-Mod-k", // il modificatore ripetuto
        "",
        "   ",
    ]
    .into_iter()
    .map(|binding| json!({"binding": binding, "out": keys::canonical(binding)}))
    .collect()
}

/// La sostituzione dei `{nome}` di un template (§7.4).
///
/// I due motori — `fub_abi::text::expand` e `espandi` in `i18n/strings.ts` —
/// sono la sola coppia che il repo **dichiarava** gemella senza che niente la
/// tenesse tale (difetto 0224), e i casi qui sotto sono i punti in cui due
/// motori scritti a mano si separano senza che nessuno lo veda: **cosa può
/// chiamarsi un nome** (una copia leggeva fino alla prima `}`, l'altra soltanto
/// `\w+`, quindi `{foo-bar}` era un argomento per l'una e testo per l'altra),
/// **le graffe letterali e quelle spaiate**, e **il nome che non c'è**, che
/// deve restare a vista invece di sparire.
///
/// Gli argomenti sono testo e basta: come si scrive un numero o un istante è
/// un'altra regola, che di là non esiste affatto — `ArgValue::render` col suo
/// locale — e infilarla qui vorrebbe dire pretendere dalla shell una risposta
/// che non le è mai stata chiesta.
fn expansion_cases() -> Vec<Value> {
    let locale = Locale::default();
    let cases: Vec<(&str, Vec<(&str, &str)>)> = vec![
        ("hello {name}", vec![("name", "world")]),
        ("{n} and again {n}", vec![("n", "one")]),
        // Le graffe letterali, e la letterale attaccata a un nome.
        ("{{a}}", vec![]),
        ("{{{a}}}", vec![("a", "A")]),
        // Il nome che non c'è: resta scritto com'è, graffe comprese.
        ("<{unknown}>", vec![]),
        // Le spaiate.
        ("open { and that's it", vec![]),
        ("close } and that's it", vec![]),
        ("{}", vec![]),
        // Cosa può chiamarsi un nome.
        ("{foo-bar}", vec![("foo-bar", "x")]),
        ("{città}", vec![("città", "Roma")]),
        ("{a.b}", vec![("a.b", "1")]),
        ("{ spaced }", vec![("spaced", "no")]),
        // Un'aperta dentro un nome: il nome è ciò che precede la prima chiusa.
        // Un nome che in JavaScript è un membro di ogni oggetto.
        ("{a{b}", vec![("b", "B")]),
    // Rigenerazione esplicita: `UPDATE_MIRROR=1 cargo test -p fub-abi --test
        ("{constructor}", vec![]),
        ("nothing", vec![]),
    ];
    cases
        .into_iter()
        .map(|(template, args)| {
            let catalog = StringCatalog::new("en").with("t", template);
            let catalogs = [catalog];
            let strings = Strings::new(&catalogs, "en", &locale);
            let mut message = Message::new("t");
            let mut map = serde_json::Map::new();
            for (name, value) in &args {
                message = message.with(*name, ArgValue::Text((*value).to_string()));
                map.insert((*name).to_string(), json!(value));
            }
            json!({
                "template": template,
                "args": Value::Object(map),
                "out": strings.render(&Text::Message(message)),
            })
        })
        .collect()
}

fn expected() -> Value {
    json!({
        "page_name": page_name_cases(),
        "name_fault": name_fault_cases(),
        "normalized_name": normalized_name_cases(),
        "resolution_key": resolution_key_cases(),
        "task_checked": task_checked_cases(),
        "topic_matches": topic_matches_cases(),
        "folder_contains": folder_contains_cases(),
        "mask_wants": mask_wants_cases(),
        "scan_tags": scan_tags_cases(),
        "canonical_chord": canonical_chord_cases(),
        "byte_to_utf16": offset_cases(true),
        "expansion": expansion_cases(),
        "utf16_to_byte": offset_cases(false),
    })
}

fn fixture_path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/__fixtures__/rules-samples.json"
    ))
}

#[test]
fn rules_fixture_is_in_sync_with_the_rust_rules() {
    let expected = expected();
    let path = fixture_path();

    // rules_mirror`. Fuori da quel caso il test non scrive mai nulla.
// Il test del test: una fixture di casi che non distinguono niente non
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("creates the fixture folder");
        }
        let mut json = serde_json::to_string_pretty(&expected).expect("pretty");
        json.push('\n');
        std::fs::write(&path, json).expect("writes the fixture");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|and| {
        panic!(
            "rules fixture missing ({}): {and}. Regenerate with \
             `UPDATE_MIRROR=1 cargo test -p fub-abi --test rules_mirror`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("valid JSON fixture");

    assert_eq!(
        committed, expected,
        "the rules fixture is stale: a Rust rule changed without regenerating it. \
         Regenerate with `UPDATE_MIRROR=1 cargo test -p fub-abi --test \
         rules_mirror`, then update the TypeScript twin until \
         `rules-mirror.test.ts` turns green."
    );
}

/// presidierebbe niente.
///
/// Per ogni regola con esito booleano servono entrambi gli esiti, e per le
/// altre almeno due risposte diverse: se domani qualcuno potasse i casi ostili
/// lasciando solo quelli facili, la fixture resterebbe verde mentre le due
/// implementazioni divergono sul resto.
/// implementazioni divergono sul resto.
#[test]
fn every_rule_has_cases_that_disagree_with_each_other() {
    let fixture = expected();
    for (rule, cases) in fixture.as_object().expect("object") {
        let cases = cases.as_array().expect("array of cases");
        assert!(cases.len() >= 2, "`{rule}` has fewer than two cases");
        let distinct: std::collections::BTreeSet<String> =
            cases.iter().map(|c| c["out"].to_string()).collect();
        assert!(
            distinct.len() >= 2,
            "`{rule}`: all cases yield the same response ({distinct:?}), \
             so the fixture does not distinguish two different implementations"
        );
    }
}
