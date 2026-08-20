//! Il corpus dei costrutti markdown e le sue mutazioni: **l'ingresso**, che da
//! oggi due presidi diversi guardano da due parti.
//!
//! Stava tutto dentro `il_corpus.rs` finché il cliente era uno solo. Adesso i
//! clienti sono due, e chiedono al corpus due cose che non si somigliano:
//!
//! - `il_corpus.rs` chiede **cosa il modello dice** di queste sorgenti — è la
//!   [0060](../../../../docs/decisions/0060-il-modello-dice-il-vero-sui-byte.md);
//! - `transfer_e2e.rs` chiede **cosa il trasferimento ne fa**: gli stessi byte
//!   escono da un vault e rientrano in un altro.
//!
//! Il corpus sta qui e non in [`fub_sdk::testing`] per il criterio della
//! [0059](../../../../docs/decisions/0059-la-generazione-non-e-un-round-trip.md):
//! le *proprietà* sono di un `FormatProvider` qualunque e stanno nell'SDK, ma
//! queste sorgenti sono markdown, e il markdown è di questo crate.
//!
//! # Perché è un modulo e non un terzo binario di test
//!
//! Un modulo sotto `tests/` non è un bersaglio di cargo: viene compilato *dentro*
//! ciascun binario che lo dichiara. La conseguenza che conta è che **le due
//! suite vedono lo stesso identico elenco**: aggiungere un caso qui lo fa entrare
//! in tutt'e due, e non c'è il modo di fallimento in cui il corpus del round-trip
//! e il corpus delle proprietà divergono senza che nessuno se ne accorga.

// Nessun `#![allow(dead_code)]`, e va detto perché la tentazione c'era: un modulo
// condiviso viene compilato dentro ciascun binario che lo dichiara, quindi ciò che
// un binario non usa è codice morto **per quel binario**, e zittire il lint qui
// sembra il prezzo del condividere. Non lo è: `cargo clippy --all-targets -D
// warnings` è il solo posto che si accorgerebbe di un caso del corpus che nessuno
// semina più, o del mutatore che un binario ha smesso di chiamare. Oggi tutto è
// usato da tutt'e due — verificato con `--force-warn dead_code` — e il giorno che
// non lo sarà, il rosso è l'informazione, non il fastidio.

/// Una voce del corpus: un nome per leggere il fallimento, e i byte esatti.
///
/// I byte stanno scritti qui come stringhe Rust e non come file committati, per
/// la ragione della [0058](../../../../docs/decisions/0058-un-nome-che-nasce.md):
/// un file con un BOM o con CRLF dentro un repo è alla mercé di
/// `.gitattributes`, degli editor e dei checkout su Windows.
pub struct Case {
    pub name: &'static str,
    pub source: &'static str,
}

pub const fn case(name: &'static str, source: &'static str) -> Case {
    Case { name, source }
}

/// Ogni costrutto che il provider markdown sa produrre, una volta.
///
/// L'ordine è quello del contratto: prima le varianti di `Block`, poi quelle di
/// `Inline`, poi i `custom_kind`, poi le forme ostili del testo. Non è un elenco
/// da cui si itera per **dedurre** la copertura: la copertura si misura
/// **parsando** queste sorgenti e guardando cosa ne esce.
pub fn corpus() -> Vec<Case> {
    vec![
        // --- Block ---
        case("heading atx", "# Titolo\n"),
        case("heading setext", "Titolo\n===\n"),
        case("heading di ogni livello", "# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f\n"),
        // Due titoli omonimi: lo stesso testo, e due `id` che devono restare
        // diversi. È il caso che rende il corpus un cliente della disambiguazione
        // — la conformità di un provider si misura sull'outline intero, e senza
        // un documento che ne abbia due uguali passerebbe senza aver provato
        // niente.
        case("due heading omonimi", "## Note\n\nprima\n\n## Note\n\nseconda\n"),
        // Un'ancora scritta in coda al titolo: era la divergenza
        // «l'ancora esplicita di un heading non è raggiungibile dall'albero»
        // (l'id finiva solo nella tabella piatta `anchors` e lo slug generato
        // occupava il blocco), riparata col campo `explicit_anchor` — l'id
        // scritto, com'è scritto, che `serialize` riscrive sul file. La
        // maiuscola non è un ornamento: è ciò che distingue «la forma
        // canonica» (la chiave di risoluzione) da «l'id esatto» (ciò che
        // l'utente ha scritto e che il giro deve riportare).
        case("heading con ancora esplicita", "## Titolo ^Mio-ID\n"),
        case("paragrafo", "Un paragrafo qualunque.\n"),
        case("lista non ordinata", "- a\n- b\n"),
        case("lista ordinata", "1. a\n2. b\n"),
        case("lista annidata", "- a\n  - b\n    - c\n"),
        case("code block recintato", "```\nx\n```\n"),
        case("code block con linguaggio", "```rust\nfn main() {}\n```\n"),
        case("code block indentato", "    quattro spazi\n"),
        case("code block non chiuso", "```rs\nsenza chiusura\n"),
        // Un recinto che CONTIENE ciò che fuori sarebbe sintassi. Nato dalla
        // §4.4 costruendo la zona cieca del corpus: senza questo caso, una
        // passata che smettesse di escludere il codice restava verde su tutte
        // e sessantatré le sorgenti.
        case(
            "code block con dentro ciò che fuori sarebbe sintassi",
            "```md\n[[Nota]] e #tag e - [ ] task e ==evidenziato==\n```\n",
        ),
        case(
            "codice inline con dentro ciò che fuori sarebbe sintassi",
            "prima `[[Nota]] #tag` dopo\n",
        ),
        case("citazione", "> citata\n"),
        case("citazione annidata", "> > due volte\n"),
        case("riga orizzontale", "***\n"),
        case("tabella con sola intestazione", "| a |\n| - |\n"),
        case(
            "tabella con allineamenti",
            "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n",
        ),
        case("tabella con inline nelle celle", "| a | b |\n| - | - |\n| [[N]] | `c` |\n"),
        // --- ListItem / TaskMarker ---
        case("task vuota", "- [ ] da fare\n"),
        case("task fatta", "- [x] fatta\n"),
        case("task a stato personalizzato", "- [/] in corso\n"),
        // --- Inline ---
        case("enfasi", "*enfasi*\n"),
        case("forte", "**forte**\n"),
        case("codice inline", "`codice`\n"),
        case("enfasi dentro forte", "**forte con *enfasi* dentro**\n"),
        case("link markdown a un path", "[etichetta](nota.md)\n"),
        case("link markdown a un url", "[etichetta](https://esempio.invalid/a)\n"),
        case("wikilink", "[[Nota]]\n"),
        case("wikilink completo", "[[Nota#Sezione^blocco|Alias]]\n"),
        case("wikilink al solo heading", "[[#Sezione]]\n"),
        // Le due forme in cui il `#` c'è e **non** introduce un heading. Non
        // c'erano, e il corpus era cieco per quello: l'unica forma con un
        // `block` era `[[Nota#Sezione^blocco|Alias]]`, che ha anche l'heading e
        // anche l'alias, cioè proprio il caso in cui chi scriveva il
        // riferimento non sbagliava. Senza heading il serializer scriveva
        // `[[Nota^blocco]]`, che in Obsidian è una pagina di nome `Nota^blocco`.
        case("wikilink al solo blocco", "[[Nota#^blocco]]\n"),
        case("wikilink a un heading e basta", "[[Nota#Sezione]]\n"),
        case("embed di wikilink", "![[Nota]]\n"),
        case("embed di un blocco", "![[Nota#^blocco]]\n"),
        // Un link **con dell'altro testo attorno**, fuori da un paragrafo. Sono
        // i due blocchi in cui il contesto dei backlink non arrivava, e senza
        // dell'altro testo nel blocco il conto che lo presidia non avrebbe
        // niente da pretendere: un link che sta da solo in una cella non ha un
        // contesto da perdere.
        case(
            "link con del testo attorno fuori da un paragrafo",
            "# Titolo con [[Nota]]\n\n| dove | cosa |\n| - | - |\n| vedi [[Altra]] qui | x |\n",
        ),
        case("embed di immagine", "![alt](figura.png)\n"),
        case("tag", "#tag\n"),
        case("tag annidato", "#genitore/figlio\n"),
        // I tre confini di `scan_tags`, sulla stessa riga: il `#` dopo un segno
        // di punteggiatura, l'accento decomposto, le cifre non ASCII. Sono i
        // punti su cui una seconda implementazione sbaglia per prima, ed è la
        // §4.4 che li ha portati qui: dentro un recinto o un codice inline non
        // devono diventare tag né di qua né di là.
        case(
            "tag ai confini della regola",
            "vedi.#dopo-punto, (#in-parentesi), #Cafe\u{301}, #\u{661}\u{662}, `#in-codice` e a#b\n",
        ),
        case("softbreak", "una riga\nun'altra\n"),
        case("linebreak", "una riga  \nun'altra\n"),
        // L'apice e il barrato erano fra le [`divergenti`] («non arrivano nel
        // modello»): il parser li accendeva (estensioni `superscript` e
        // `strikethrough`) e il modello non aveva dove metterli — finivano nel
        // catch-all e ne restava solo il testo. Adesso hanno una variante
        // loro, e stanno qui come ogni altro costrutto.
        case("barrato", "~~barrato~~\n"),
        case("apice", "testo ^apice^ qui\n"),
        case("link di riferimento", "[a][rif]\n\n[rif]: nota.md\n"),
        // Una reference definition non è un paragrafo: comrak la consuma senza
        // lasciare un nodo, e il parser la recupera dalla sorgente. Se non ci
        // fosse il recupero, la definizione sparirebbe dal documento alla
        // prima riscrittura (il serializer non ha nulla da riscrivere).
        case("reference definition isolata", "[rif]: nota.md\n"),
        case("reference definition con titolo", "[r]: nota.md \"titolo\"\n"),
        case(
            "reference definition e paragrafo misto",
            "[r]: nota.md\nparagrafo residuo sulla seconda riga\n",
        ),
        case("reference definition dentro una citazione", "> [r]: nota.md\n"),
        case(
            "reference definition adiacenti",
            "[uno]: a.md\n[due]: b.md \"due\"\n\nil testo che le segue\n",
        ),
        // --- custom_kind ---
        case("callout senza titolo", "> [!note]\n> corpo\n"),
        case("callout con titolo", "> [!warning] Attenzione\n> corpo\n"),
        case("callout di ogni tipo", "> [!note]\n> a\n\n> [!tip]\n> b\n\n> [!important]\n> c\n\n> [!warning]\n> d\n\n> [!caution]\n> e\n"),
        case("footnote", "una nota[^n]\n\n[^n]: il corpo\n"),
        case("definition list", "Termine\n\n: la definizione\n"),
        case("html a blocco", "<div>blocco</div>\n"),
        case("html inline", "un <b>grassetto</b> inline\n"),
        case("commento html", "<!-- un commento -->\n"),
        // --- frontmatter ---
        case("frontmatter", "---\ntitolo: X\n---\n\n# Corpo\n"),
        case(
            "frontmatter con ogni specie di proprietà",
            "---\ntesto: X\nnumero: 4\nvero: true\nvuota:\ndata: 2026-07-30\nquando: 2026-07-30T10:30:00+02:00\nelenco: [a, b]\nrelazione: \"[[Nota]]\"\nannidata:\n  a: 1\n---\n\nx\n",
        ),
        // Uno YAML che non si proietta su una mappa. Non è un caso di scuola: è
        // la virgola sbagliata di chi scrive le proprietà a mano, e fino alla
        // riparazione del difetto stava fra le [`divergenti`] col nome «un
        // frontmatter che non si parsa non lascia traccia» — spariva due volte,
        // dal modello che ricadeva su un frontmatter vuoto e poi dal file alla
        // prima riscrittura. Adesso la traccia c'è, ed è
        // `custom_kind::FRONTMATTER_UNPARSED`.
        case(
            "frontmatter illeggibile",
            "---\n--- non una chiave\nb: 2\n---\n\nx\n",
        ),
        // --- ancore ---
        case("ancora di paragrafo", "Un paragrafo ^abc123\n"),
        case("ancora su riga propria", "Un paragrafo\n\n^abc123\n"),
        case("ancora che non è un'ancora", "2^10 = 1024\n"),
        // --- le forme ostili del testo (§15.5) ---
        case("crlf", "# Titolo\r\n\r\nUn paragrafo con [[Link]].\r\n"),
        case("cr solo", "# Titolo\rUn paragrafo.\r"),
        // Il `\r` nudo su **più blocchi**, che è il caso in cui la tabella
        // riga→byte sballa e non si vede: `byte()` è robusto ai valori fuori
        // range, quindi una riga che non esiste torna la fine del file, e gli
        // span sono vuoti invece che sbagliati. Sta qui per il difetto che ha
        // scoperto, non per completezza.
        case(
            "cr solo su più blocchi",
            "# Titolo\r\rUn paragrafo con [[Nota]] e #tag.\r\r## Sezione\r\r- [x] fatta\r",
        ),
        case("un cr nudo in mezzo a un file a lf", "# Ti\rtolo\n\nvedi [[Nota]]\n\n## Poi\n"),
        case("terminatori misti", "# Titolo\r\n\nuna\r\n\naltra\n\nvedi [[Nota]]\r\n"),
        case("bom", "\u{feff}# Titolo\n\nUn paragrafo.\n"),
        case("bom e frontmatter", "\u{feff}---\na: 1\n---\n\n# Corpo\n"),
        case("senza newline finale", "Una riga sola senza a capo"),
        case("solo un bom", "\u{feff}"),
        case("vuoto", ""),
        case("solo spazi", "   \n\n  \t\n"),
        case("fuori dal bmp", "# 🎉 Titolo\n\nvedi [[Nota 🎉]] e #tag🎉\n"),
        case("nfd nel contenuto", "# Cafe\u{301}\n\nvedi [[Cafe\u{301}]]\n"),
        // --- un documento che ha tutto insieme, che è il caso vero ---
        case(
            "un documento intero",
            "---\ntitolo: Tutto\ntag: [a, b]\n---\n\n\
             # Titolo ^testa\n\n\
             Un paragrafo con *enfasi*, **forte**, `codice`, [[Nota]], \
             ![[Altra]], [md](x.md), ![img](f.png) e #tag.\n\n\
             ## Sezione\n\n\
             - [ ] una task con [[Link]]\n\
             - [x] fatta\n\
               - annidata\n\n\
             > [!tip] Suggerimento\n> con dentro un [[Wikilink]]\n\n\
             | a | b |\n| :-- | --: |\n| 1 | [[N]] |\n\n\
             ```rust\nfn main() {}\n```\n\n\
             > citazione con - [x] task [[A]] #t\n\n\
             una nota[^f]\n\n[^f]: il corpo della nota\n\n\
             ***\n\n\
             Termine\n\n: definizione\n",
        ),
    ]
}

/// Le sorgenti su cui il modello e il file **non sono d'accordo**.
///
/// Stanno separate dal corpus curato perché le due suite ne fanno due usi
/// opposti, e tenerle in un elenco solo li confonderebbe:
///
/// - `il_corpus.rs` ci appoggia un predicato per ciascuna — «la divergenza si
///   presenta ancora» — e il giorno in cui qualcuno la ripara la riga diventa
///   rossa e va tolta di lì **e** di qui;
/// - `transfer_e2e.rs` le tratta come note qualunque, ed è il punto: una
///   divergenza fra il modello e il file **non è** una perdita nel
///   trasferimento, perché il verso che copia i byte non passa dal modello. È
///   una cosa da provare, non da affermare.
///
/// Il legame fra i due usi è un confronto nei due versi in `il_corpus.rs`: un
/// nome qui senza predicato là, o un predicato là senza nome qui, è rosso.
pub fn divergent() -> Vec<Case> {
    vec![
        case(
            "uno slug vuoto è un'ancora che il contratto rifiuterebbe",
            "#\n",
        ),
        case(
            "l'alt di un'immagine non entra nel testo indicizzato",
            "![una didascalia](f.png)\n",
        ),
        case(
            "la sintassi grezza di un embed entra nel testo indicizzato",
            "![[Nota]]\n",
        ),
        case(
            "il termine di una definition list stretta ha uno span di un byte",
            "Termine\n: la definizione\n",
        ),
        case(
            "e la forma larga della stessa definition list ce l'ha giusto",
            "Termine\n\n: la definizione\n",
        ),
        case(
            "un cr nudo dentro una riga di tabella la spezza in due righe",
            "| a | b |\n| - | - |\n| 1 | 2 \r| 3 |\n",
        ),
    ]
}

// ---------------------------------------------------------------------------
// Il mutatore
// ---------------------------------------------------------------------------
//
// Scritto a mano perché un fallimento deve essere riproducibile da un seme
// stampato, che è la stessa ragione per cui questo repo si è scritto il parser
// di date invece di prendere `chrono`.

/// Un xorshift64*, dodici righe e nessuna dipendenza.
pub struct Case64(u64);

impl Case64 {
    pub fn new(seed_value: u64) -> Self {
        // Lo zero è il punto fisso di xorshift: un seme nullo darebbe sempre 0.
        Case64(if seed_value == 0 { 0x9E3779B97F4A7C15 } else { seed_value })
    }

    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }

    pub fn until_a(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next() % n as u64) as usize
        }
    }

    /// Un confine di carattere di `s`, scelto a caso. Serve perché una mutazione
    /// deve produrre UTF-8 valido: tagliare a metà di un carattere non prova il
    /// parser, prova `String::from_utf8`.
    pub fn boundary(&mut self, s: &str) -> usize {
        let mut the = self.until_a(s.len() + 1);
        while !s.is_char_boundary(the) {
            the -= 1;
        }
        the
    }
}

/// I byte ostili che si infilano dentro una sorgente. Sono quelli che nei vault
/// veri ci sono e che nessuno scrive di proposito.
pub const OSTILI: [&str; 10] = [
    "\u{feff}", // un BOM in mezzo, non in testa
    "\r",       // un ritorno a capo nudo
    "\0",       // un NUL, che è UTF-8 valido e non se lo aspetta nessuno
    "\u{301}",  // un accento combinante senza la lettera davanti
    "🎉",       // fuori dal BMP: quattro byte, un carattere
    "^",        // il marcatore d'ancora, fuori posto
    "]]",       // una chiusura senza apertura
    "![[",      // un'apertura senza chiusura
    "|",        // il separatore di tabella e di alias
    "\t",       // una tabulazione, che in markdown conta come indentazione
];

/// Le mutazioni, **con un nome**: un fallimento deve dire cosa è stato fatto
/// alla sorgente, non solo che è successo.
///
/// I semi non sono `&'static str`: l'uscita è una `String` sua, quindi non li
/// tiene, e chi fuzza il trasferimento semina anche sorgenti **composte** — il
/// corpus con un frontmatter davanti — che a compile time non esistono.
pub fn muta(rng: &mut Case64, semi: &[&str]) -> (&'static str, String) {
    let base = semi[rng.until_a(semi.len())];
    match rng.until_a(7) {
        0 => {
            let the = rng.boundary(base);
            ("troncato", base[..the].to_string())
        }
        1 => ("duplicato", format!("{base}{base}")),
        2 => {
            let other = semi[rng.until_a(semi.len())];
            let the = rng.boundary(base);
            let j = rng.boundary(other);
            ("intrecciato", format!("{}{}", &base[..the], &other[j..]))
        }
        3 => {
            let the = rng.boundary(base);
            let ostile = OSTILI[rng.until_a(OSTILI.len())];
            (
                "con un byte ostile in mezzo",
                format!("{}{}{}", &base[..the], ostile, &base[the..]),
            )
        }
        4 => {
            let the = rng.boundary(base);
            let j = rng.boundary(base);
            let (a, b) = if the <= j { (the, j) } else { (j, the) };
            (
                "con un pezzo tolto",
                format!("{}{}", &base[..a], &base[b..]),
            )
        }
        5 => {
            let ostile = OSTILI[rng.until_a(OSTILI.len())];
            (
                "annidato profondo",
                format!("{}{base}", ostile.repeat(1 + rng.until_a(64))),
            )
        }
        _ => {
            let the = rng.boundary(base);
            (
                "con una riga lunghissima",
                format!("{}{}\n{}", &base[..the], "a".repeat(4096), &base[the..]),
            )
        }
    }
}

/// Quanti casi, e da quale seme.
///
/// Il seme è **fisso** ed è il punto: la stessa corsa a ogni push, su tre
/// sistemi operativi, senza un rosso che dipende da quando lo si è lanciato. Il
/// conteggio ha un default per ciascun cliente — le due porte non costano
/// uguale, una parsa in memoria e l'altra scrive un vault — e si alza
/// dall'ambiente per la corsa lunga a mano, che è ciò che si fa quando si vuole
/// **cercare** invece di presidiare.
/// Un valore che non si parsa **pania**, invece di cadere sul default in
/// silenzio. Il caso vero che lo chiede: il seme di default sta scritto nel
/// codice come `0x4675_6D4D_4420_3031`, e `u64::from_str` non accetta né `0x` né
/// `_` — chi lo copiasse da lì per ripetere una corsa ne farebbe un'altra,
/// credendo di averla fissata.
pub fn how_many_cases(variable: &str, default: usize) -> usize {
    match std::env::var(variable) {
        Err(_) => default,
        Ok(v) => v
            .parse()
            .unwrap_or_else(|and| panic!("{variable}={v:?} non è un numero: {and}")),
    }
}

/// Il seme, condiviso dalle tre porte: `FUB_FUZZ_SEME`.
pub fn seme() -> u64 {
    match std::env::var("FUB_FUZZ_SEME") {
        Err(_) => 0x4675_6D4D_4420_3031,
        Ok(v) => v.parse().unwrap_or_else(|and| {
            panic!(
                "FUB_FUZZ_SEME={v:?} non è un numero decimale: {and}.\n\
                 Il default è 0x4675_6D4D_4420_3031, che in decimale fa \
                 5077084333552971825: è quella la forma da passare."
            )
        }),
    }
}
