//! **Generare non è un round-trip, ma non è nemmeno cancellare.**
//!
//! `serialize` è dichiarata *lossy per costruzione*, e la frase è vera: lo stile
//! dell'enfasi, la spaziatura, l'indentazione scelta non tornano indietro. Sotto
//! quella frase si era però depositata una seconda cosa, che nessuno aveva
//! dichiarato e che non è la stessa: **del contenuto usciva come zero byte**.
//!
//! Il difetto segnalato ne nominava uno — `Inline::Custom { .. } => {}`, il
//! gemello inline del frontmatter perso. Misurandoli parsando il corpus e
//! riserializzandolo, i siti erano **nove**:
//!
//! | # | sito | cosa perdeva |
//! |---|---|---|
//! | 1 | `Inline::Custom { .. } => {}` | tutto l'inline (`==evidenziato==` → niente) — *il sito dichiarato* |
//! | 2 | lo stesso ramo, kind senza `attrs.text` | tutto l'inline, senza nemmeno il testo |
//! | 3 | `Inline::Custom` `footnote-reference` senza `attrs.label` | il richiamo |
//! | 4 | `Block::Custom` generico, `blocks` vuoto: `math` | la formula |
//! | 5 | idem: `diagram` | il diagramma |
//! | 6 | idem: `html` | **il blocco HTML dell'utente**, e questo lo misura il corpus |
//! | 7 | `anchor` in **sette** varianti di `Block` | l'`^id` con cui le *altre note* puntano qui |
//! | 8 | `Inline::Code` con un backtick dentro | il contenuto, riscritto in qualcos'altro |
//! | 9 | i figli di una voce d'elenco, senza rientro | l'annidamento: `- a\n  - b` usciva appiattito |
//!
//! Uno su nove era stato visto. Sette su nove non hanno niente a che vedere con
//! `Custom`.
//!
//! # Cosa presidia questo file, e con che attore
//!
//! - **il conto** — il giro completo sul corpus (`sorgente → modello → sorgente
//!   → modello`) su tre proprietà che si rompono separatamente: il **testo**
//!   (siti 1-6), la **struttura** (sito 9) e le **ancore di blocco** (sito 7);
//! - **il comportamento** — ciò che il provider non sa scrivere torna `Err` e
//!   dice quale kind era (siti 1-5), e il codice non si spezza sui propri
//!   delimitatori (sito 8);
//! - **il compilatore**, che non ha un test qui perché non ne ha bisogno: i
//!   `match` di `serialize.rs` nominano ogni campo e non hanno `..`, quindi un
//!   campo nuovo nel contratto non compila. [`nessun_ramo_muto`] tiene solo la
//!   *forma*, cioè impedisce che il `..` torni.
//!
//! # Il limite, detto qui
//!
//! L'ancora esplicita di un **heading** (`# Titolo ^testa`) ci passa da quando
//! `Block::Heading` porta `explicit_anchor` — l'id **com'è scritto**, che
//! `serialize` riscrive sul file. L'heading generato (senza id scritto) non
//! passa di qui per scelta: la sua `anchor` è lo **slug** derivato dal testo, e
//! riscriverlo creerebbe un'ancora esplicita che nel file non c'era — ed è
//! proprio ciò che `explicit_anchor` distingue: «un'ancora che l'utente ha
//! scritto» da «una chiave che il modello si è dato». Le ancore di blocco
//! (paragrafi, tabelle, …) passano dalla loro `anchor`, che per loro **è**
//! l'id scritto.

// L'`allow` sta **qui**, sulla dichiarazione, e non dentro `corpus/mod.rs` —
// che dichiara di non volerlo, con la sua ragione. La ragione regge ancora: un
// modulo condiviso viene compilato dentro ciascun binario che lo dichiara, e
// `dead_code` è ciò che si accorge di un caso del corpus che nessuno semina più.
// Questo terzo cliente però ne usa **una** funzione, `corpus()`, e senza l'attributo
// pagherebbe sette avvisi per ciò che gli altri due usano. Il presidio del corpus
// non si indebolisce: `the_corpus.rs` e `transfer_e2e.rs` continuano a compilarlo
// senza allow, e la prima voce che smette di essere seminata è rossa di là.
#[allow(dead_code)]
mod corpus;

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{custom_kind, Block, DocId, DocumentModel, Inline, LinkTarget, Span};
use fub_format_markdown::MarkdownProvider;

fn parse(src: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), &ParseContext::obsidian("nota.md"))
        .expect("il markdown parsa")
}

fn serialize(model: &DocumentModel) -> String {
    MarkdownProvider::new()
        .serialize(model)
        .expect("the model serializes")
}

/// Un documento di un blocco solo, per le prove che non passano dal parser.
fn with_block(block: Block) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new("nota.md"));
    m.body = vec![block];
    m
}

fn paragraph(inlines: Vec<Inline>) -> Block {
    Block::Paragraph {
        inlines,
        anchor: None,
        span: Span::new(0, 0),
    }
}

fn definition_description(model: &DocumentModel) -> &[Block] {
    match &model.body[..] {
        [Block::Custom {
            custom_kind: list_kind,
            blocks,
            ..
        }] if list_kind == custom_kind::DEFINITION_LIST => match &blocks[..] {
            [Block::Custom {
                custom_kind: term_kind,
                blocks: term,
                ..
            }, Block::Custom {
                custom_kind: description_kind,
                blocks: description,
                ..
            }] if term_kind == custom_kind::DEFINITION_TERM
                && description_kind == custom_kind::DEFINITION_DESCRIPTION
                && matches!(term.as_slice(), [Block::Paragraph { .. }]) =>
            {
                description
            }
            other => panic!("figli inattesi della definition list: {other:#?}"),
        },
        other => panic!("definition list attesa, trovata: {other:#?}"),
    }
}

fn sole_wikilink(model: &DocumentModel) -> (&LinkTarget, &[Inline]) {
    match &model.body[..] {
        [Block::Paragraph { inlines, .. }] => match &inlines[..] {
            [Inline::Link {
                target,
                label: Some(label),
                embed: false,
                ..
            }] => (target, label),
            other => panic!("wikilink con alias atteso, trovati: {other:#?}"),
        },
        other => panic!("paragrafo singolo atteso, trovati: {other:#?}"),
    }
}

/// Le parole, senza la spaziatura: ciò che cambia qui è **contenuto sparito**,
/// non impaginazione.
fn words(m: &DocumentModel) -> String {
    m.text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// La forma dell'albero: il nome di ogni blocco e i suoi figli. Non guarda il
/// testo — è l'altra metà, e si rompe da sola.
fn shape(b: &Block) -> String {
    let (name, children): (String, Vec<String>) = match b {
        Block::Heading { level, .. } => return format!("H{level}"),
        Block::Paragraph { .. } => return "P".into(),
        Block::CodeBlock { lang, .. } => {
            return format!("Code({})", lang.clone().unwrap_or_default())
        }
        Block::ThematicBreak { .. } => return "Hr".into(),
        Block::ReferenceDefinition { .. } => return "Def".into(),
        Block::Table { .. } => return "Table".into(),
        Block::Quote { blocks, .. } => ("Q".into(), blocks.iter().map(shape).collect()),
        Block::Custom {
            custom_kind,
            blocks,
            ..
        } => (custom_kind.clone(), blocks.iter().map(shape).collect()),
        Block::List { items, .. } => (
            "L".into(),
            items
                .iter()
                .flat_map(|the| the.blocks.iter().map(shape))
                .collect(),
        ),
    };
    format!("{name}[{}]", children.join(","))
}

/// Le ancore **raggiungibili dall'albero**, in ordine. Per un heading
/// `anchor()` è l'id esplicito **com'è scritto** (`^Mio-ID`) o, senza id
/// scritto, lo slug generato — una funzione del testo, che torna identica al
/// giro. La scrittura e la rilettura fanno lo stesso cammino all'indietro, e
/// l'ancora torna — e quindi non si cancella.
fn anchors(blocks: &[Block]) -> Vec<String> {
    let mut out = Vec::new();
    for b in blocks {
        if let Some(id) = b.anchor() {
            out.push(id.to_string());
        }
        match b {
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                out.extend(anchors(blocks))
            }
            Block::List { items, .. } => {
                for the in items {
                    out.extend(anchors(&the.blocks));
                }
            }
            _ => {}
        }
    }
    out
}

/// **Il conto, prima proprietà.** Le parole che entrano escono.
///
/// È la prova che rende rossi i sei siti di cancellazione: un blocco HTML, un
/// commento HTML, un inline custom, una formula. Guardare il solo modello
/// direbbe «c'è tutto», ed è esattamente la bugia — il modello ce l'ha, il file
/// riscritto no.
#[test]
fn the_round_complete_not_loses_the_text() {
    for case in corpus::corpus() {
        let m1 = parse(case.source);
        let m2 = parse(&serialize(&m1));
        assert_eq!(
            words(&m1),
            words(&m2),
            "«{}»: il giro completo ha riscritto il documento senza una parte del\n\
             suo testo. La sorgente riscritta è il file dell'utente: ciò che non\n\
             ci arriva non è degradato, è cancellato.\n  sorgente: {:?}",
            case.name,
            case.source,
        );
    }
}

/// **Il conto, seconda proprietà.** La struttura che entra esce.
///
/// Si rompe da sola, e per il testo è invisibile: un elenco annidato appiattito
/// ha le stesse parole del suo originale, e un `- a` figlio diventato fratello
/// non fa fallire niente. È il sito 9.
#[test]
fn the_round_complete_not_loses_the_structure() {
    for case in corpus::corpus() {
        let m1 = parse(case.source);
        let rewritten = serialize(&m1);
        let m2 = parse(&rewritten);
        let f1: Vec<String> = m1.body.iter().map(shape).collect();
        let f2: Vec<String> = m2.body.iter().map(shape).collect();
        assert_eq!(
            f1, f2,
            "«{}»: il giro completo ha cambiato la forma dell'albero.\n  \
             sorgente: {:?}\n  riscritto: {rewritten:?}",
            case.name, case.source,
        );
    }
}

/// **Il conto, terza proprietà.** Gli `^id` che entrano escono.
///
/// È la perdita che si vede da **fuori** del documento: un `^abc123` è
/// l'indirizzo con cui `[[Nota#^abc123]]` punta qui dentro, e riscrivere il
/// file senza toglie il bersaglio ai link degli altri — senza che questo
/// documento sembri cambiato.
#[test]
fn the_round_complete_not_loses_the_anchors_of_block() {
    for case in corpus::corpus() {
        let m1 = parse(case.source);
        let rewritten = serialize(&m1);
        let m2 = parse(&rewritten);
        assert_eq!(
            anchors(&m1.body),
            anchors(&m2.body),
            "«{}»: il giro completo ha perso un'ancora di blocco.\n  \
             sorgente: {:?}\n  riscritto: {rewritten:?}",
            case.name,
            case.source,
        );
    }
}

/// **Il conto, quarta proprietà.** Un riferimento si riscrive **com'era**, byte
/// per byte.
///
/// # Perché le tre proprietà qui sopra non lo vedono, e nemmeno il round-trip
///
/// Un wikilink riscritto male non perde né testo né struttura né ancore: perde
/// il **bersaglio**, e il bersaglio è una stringa dentro `[[…]]` che il giro
/// `sorgente → modello → sorgente → modello` non confronta mai con la sorgente.
/// Peggio: il nostro lettore è **indulgente di proposito** — `[[page^b]]` lo
/// riaccetta come riferimento a blocco — quindi il giro torna al punto fisso su
/// una scrittura che *fuori di qui* vuol dire un'altra cosa. In Obsidian
/// `[[page^b]]` è una pagina che si chiama `page^b`. Una coppia
/// scrittore/lettore che si accontenta della propria indulgenza è d'accordo con
/// sé stessa e in disaccordo con tutti gli altri, e nessun round-trip può
/// accorgersene: il confronto che serve è **col testo**, ed è questo.
///
/// Il difetto misurato era doppio, e il secondo l'ha scoperto il primo:
///
/// 1. il `#` che manca — `[[Nota#^blocco]]` usciva `[[Nota^blocco]]`, perché il
///    `#` si scriveva solo quando c'era un heading da scrivere. Il `#` non è
///    del heading: è ciò che rende quel `^` un `^` di ancora;
/// 2. l'alias che nessuno aveva scritto — l'etichetta si confrontava con la
///    sola `page`, quindi `[[Nota#Sezione]]` usciva `[[Nota#Sezione|Nota#Sezione]]`,
///    e il giro dopo lo allungava ancora. Un file che si allunga da solo a ogni
///    riscrittura.
#[test]
fn a_reference_is_rewrites_com_was() {
    for source in [
        "[[Nota]]\n",
        "[[Nota#Sezione]]\n",
        "[[Nota#^blocco]]\n",
        "[[Nota#Sezione^blocco]]\n",
        "[[Nota|Alias]]\n",
        "[[Nota#Sezione|Alias]]\n",
        "[[Nota#^blocco|Alias]]\n",
        "[[#Sezione]]\n",
        "![[Nota]]\n",
        "![[Nota#^blocco]]\n",
        "vedi [[Nota#^blocco]] e [[Altra#Sezione]] qui\n",
    ] {
        let rewritten = serialize(&parse(source));
        assert_eq!(
            rewritten, source,
            "un riferimento è rientrato diverso da com'era uscito.\n  \
             sorgente:  {source:?}\n  riscritto: {rewritten:?}"
        );
    }
    // L'altro verso, che è il motivo per cui il lettore può restare indulgente:
    // ciò che accetta per indulgenza torna **canonico nel bersaglio** quando lo
    // si riscrive, invece di restare un dialetto privato.
    //
    // Il testo mostrato, invece, resta quello che l'utente vedeva — `[[Nota^blocco]]`
    // a schermo diceva «Nota^blocco» — e diventa un alias esplicito: riparare
    // dove un riferimento *punta* non è titolo per cambiare ciò che si *legge*.
    let rewritten = serialize(&parse("[[Nota^blocco]]\n"));
    assert_eq!(rewritten, "[[Nota#^blocco|Nota^blocco]]\n");
    // E il giro dopo è fermo. Senza questa riga la riparazione dell'alias
    // sarebbe indistinguibile da un file che si allunga di un `|…` a ogni
    // riscrittura, che è com'era.
    assert_eq!(serialize(&parse(&rewritten)), rewritten);
}

#[test]
fn a_definition_description_preserves_continuations_and_block_separators() {
    let source = "Termine\n: primo\n    secondo\n\n    terzo\n";
    let first = parse(source);
    assert_eq!(
        definition_description(&first)
            .iter()
            .map(shape)
            .collect::<Vec<_>>(),
        ["P", "P"],
        "la continuazione appartiene al primo paragrafo e il blocco dopo la \
         riga vuota resta un secondo paragrafo"
    );

    let rewritten = serialize(&first);
    assert_eq!(rewritten, "Termine\n\n: primo\n    secondo\n\n    terzo\n");
    assert!(
        rewritten.lines().all(|line| !line.ends_with(' ')),
        "le righe vuote e non vuote non acquistano trailing whitespace: {rewritten:?}"
    );

    let second = parse(&rewritten);
    assert_eq!(
        definition_description(&second)
            .iter()
            .map(shape)
            .collect::<Vec<_>>(),
        ["P", "P"],
        "la descrizione riscritta deve rileggersi con gli stessi due blocchi"
    );
    assert_eq!(
        serialize(&second),
        rewritten,
        "il secondo giro deve essere fermo"
    );
}

#[test]
fn wikilink_alias_delimiters_are_reescaped_after_decoding() {
    for (source, alias) in [("[[Nota|a\\|b]]\n", "a|b"), ("[[Nota|a\\]\\]b]]\n", "a]]b")] {
        let first = parse(source);
        let (target, label) = sole_wikilink(&first);
        assert!(matches!(
            target,
            LinkTarget::Wiki {
                page,
                heading: None,
                block: None,
            } if page == "Nota"
        ));
        assert!(
            matches!(label, [Inline::Text(text)] if text == alias),
            "l'alias deve essere testo decodificato nel modello: {label:#?}"
        );

        let rewritten = serialize(&first);
        assert_eq!(
            rewritten, source,
            "il delimitatore decodificato deve essere ri-escapato"
        );

        let second = parse(&rewritten);
        let (second_target, second_label) = sole_wikilink(&second);
        assert_eq!(second_target, target);
        assert!(
            matches!(second_label, [Inline::Text(text)] if text == alias),
            "il secondo parse deve conservare alias e struttura: {second_label:#?}"
        );
        assert_eq!(
            serialize(&second),
            rewritten,
            "il secondo giro non deve degradare il wikilink in testo né cambiare alias"
        );
    }
}

/// **Il comportamento.** Un inline di una sintassi che il provider non conosce
/// **risale**: non si scrive a metà e non si salta.
///
/// **L'HTML dell'utente torna sul disco com'era, dai due lati.**
///
/// Il decimo sito, trovato dopo i nove dell'elenco in testa, e quello che
/// nessuno dei nove conti vedeva: la perdita non era in `serialize.rs`, era nel
/// **parser**. `convert_inlines` non aveva un ramo per `NodeValue::HtmlInline`,
/// quindi il nodo cadeva nel catch-all che ricorre sui figli — e un
/// `HtmlInline` figli non ne ha, perché porta tutto il markup nel proprio
/// `literal`. `un <b>grassetto</b> inline` arrivava al modello come `un
/// grassetto inline`, e da lì tornava sul file dell'utente senza i suoi tag.
///
/// **Perché `il_giro_completo_non_perde_il_testo` non lo vedeva**, pur avendo
/// adesso il caso nel corpus: quel conto confronta `parse(src)` con
/// `parse(serialize(parse(src)))`, e se i byte si perdono **prima**, alla prima
/// parsata, le due passate sono d'accordo fra loro e in disaccordo col file. È
/// la classe cieca di ogni round-trip — il lettore riaccetta ciò che lo
/// scrittore ha inventato — e l'unico modo di uscirne è **asserire contro la
/// sorgente**, che è ciò che questo banco fa.
///
/// I due lati stanno nello stesso banco perché sono la stessa regola —
/// `custom_kind::HTML` è `Payload::Source("html")`, cioè byte che si copiano —
/// e finché era scritta in un ramo solo su due nessuno vedeva che ne mancava
/// uno.
#[test]
fn the_html_of_the_user_returns_on_the_disk_com_was() {
    for (name, src) in [
        ("inline", "un <b>grassetto</b> inline\n"),
        (
            "inline con attributi",
            "prima <span class=\"x\">c</span> poi\n",
        ),
        ("a blocco", "<div class=\"y\">blocco</div>\n"),
        ("commento", "<!-- un commento -->\n"),
    ] {
        let rewritten = serialize(&parse(src));
        assert_eq!(
            rewritten, src,
            "«{name}»: la riscrittura ha cambiato i byte dell'utente.\n  \
             sorgente:  {src:?}\n  riscritto: {rewritten:?}",
        );
    }
}

/// I delimitatori (`==`, `$`, quelli di un plugin di terzi) appartengono alla
/// `SyntaxRule` che li ha agganciati, e il provider markdown non li ha mai
/// visti. Scriverne il solo `attrs.text` toglierebbe una sintassi dal file
/// dell'utente; scrivere niente toglierebbe anche il testo. La terza strada è
/// dirlo.
#[test]
fn a_inline_that_not_is_knows_write_goes_back() {
    for (name, kind, attrs) in [
        (
            "col testo, come vuole la convenzione",
            custom_kind::HIGHLIGHT,
            serde_json::json!({ "text": "evidenziato" }),
        ),
        (
            "senza nemmeno il testo",
            "terzi:spoiler",
            serde_json::json!({ "corpo": "segreto" }),
        ),
    ] {
        let m = with_block(paragraph(vec![
            Inline::Text("prima ".into()),
            Inline::Custom {
                custom_kind: kind.into(),
                attrs,
                span: Span::new(0, 0),
            },
            Inline::Text(" dopo".into()),
        ]));
        let outcome = MarkdownProvider::new().serialize(&m);
        let Err(and) = outcome else {
            panic!(
                "«{name}»: `serialize` ha reso {:?} — l'inline è sparito dalla\n\
                 sorgente e nessuno l'ha detto.",
                outcome.unwrap(),
            );
        };
        assert!(
            and.to_string().contains(kind),
            "«{name}»: l'errore non nomina il kind, e chi lo legge non sa cosa\n\
             non si è scritto: {and}",
        );
    }
}

/// Lo stesso, sui blocchi: `math` e `diagram` portano il sorgente negli `attrs`
/// e **non hanno figli**, quindi il degrado «scrivi i figli» scriveva zero byte.
#[test]
fn a_block_that_not_is_knows_write_goes_back() {
    for (kind, attrs) in [
        (
            custom_kind::MATH,
            serde_json::json!({ "source": "E=mc^2", "display": true }),
        ),
        (
            custom_kind::DIAGRAM,
            serde_json::json!({ "engine": "mermaid", "source": "graph TD;A-->B;" }),
        ),
    ] {
        let m = with_block(Block::Custom {
            custom_kind: kind.into(),
            attrs,
            blocks: Vec::new(),
            anchor: None,
            span: Span::new(0, 0),
        });
        let outcome = MarkdownProvider::new().serialize(&m);
        let Err(and) = outcome else {
            panic!(
                "`{kind}`: `serialize` ha reso {:?} — il blocco è sparito.",
                outcome.unwrap()
            );
        };
        assert!(
            and.to_string().contains(kind),
            "l'errore non nomina il kind: {and}"
        );
    }
}

/// Un kind del registro che arriva **senza gli `attrs` che dichiara** è lo
/// stesso caso del frontmatter verbatim: il contenuto non è ricostruibile da
/// nient'altro, quindi il giro si ferma invece di scrivere un richiamo vuoto.
#[test]
fn the_attrs_that_missing_rise() {
    let m = with_block(paragraph(vec![Inline::Custom {
        custom_kind: custom_kind::FOOTNOTE_REFERENCE.into(),
        attrs: serde_json::json!({}),
        span: Span::new(0, 0),
    }]));
    let outcome = MarkdownProvider::new().serialize(&m);
    assert!(
        outcome.is_err(),
        "un richiamo di nota senza etichetta è uscito come {:?}: il segno che\n\
         l'utente aveva scritto non c'è più.",
        outcome.unwrap(),
    );

    // E un `html` senza il suo `html`, che è l'altra metà dello stesso patto.
    let m = with_block(Block::Custom {
        custom_kind: custom_kind::HTML.into(),
        attrs: serde_json::json!({}),
        blocks: Vec::new(),
        anchor: None,
        span: Span::new(0, 0),
    });
    assert!(MarkdownProvider::new().serialize(&m).is_err());
}

/// Il delimitatore deve essere più lungo di ciò che delimita, o il contenuto
/// dell'utente torna indietro come qualcos'altro: `` `a ` b` `` si rileggeva
/// come il codice `a` seguito dal testo `` b` ``.
#[test]
fn the_code_not_is_splits_on_the_own_delimiters() {
    for code in ["a ` b", "``doppio``", "`in testa", "in coda`"] {
        let m = with_block(paragraph(vec![Inline::Code(code.into())]));
        let rewritten = serialize(&m);
        let reparsed = parse(&rewritten);
        let Some(Block::Paragraph { inlines, .. }) = reparsed.body.first() else {
            panic!("{code:?}: non è tornato un paragrafo, ma {rewritten:?}");
        };
        assert_eq!(
            inlines.as_slice(),
            [Inline::Code(code.into())],
            "{code:?}: riscritto come {rewritten:?}, reparsed come {inlines:?}",
        );
    }

    // La stessa regola sul recinto di un blocco di codice, che è lo stesso
    // difetto con tre backtick invece di uno.
    let m = with_block(Block::CodeBlock {
        lang: Some("md".into()),
        code: "```\nun recinto dentro un recinto\n```\n".into(),
        anchor: None,
        span: Span::new(0, 0),
    });
    let rewritten = serialize(&m);
    let reparsed = parse(&rewritten);
    let Some(Block::CodeBlock { code, .. }) = reparsed.body.first() else {
        panic!("il recinto si è chiuso a metà: {rewritten:?}");
    };
    assert_eq!(code, "```\nun recinto dentro un recinto\n```\n");
}

/// **La forma.** `serialize.rs` non ha rami muti e non salta campi.
///
/// Il `..` di un pattern è la ragione per cui `anchor` era nata persa: sette
/// varianti la ignoravano, e nessun compilatore poteva dirlo perché nessuna la
/// nominava. Toglierlo trasforma il campo nuovo del contratto in un errore di
/// compilazione **qui**, che è l'unico attore capace di prendere la variante
/// che nessuno ha ancora scritto. Questo test tiene solo che non torni.
#[test]
fn no_branch_silent() {
    const SOURCE: &str = include_str!("../src/serialize.rs");

    for (n, row) in SOURCE.lines().enumerate() {
        let t = row.trim_start();
        if t.starts_with("//") {
            continue;
        }
        assert!(
            !t.contains("=> {}"),
            "src/serialize.rs:{}: un ramo che non scrive niente. In un serializer\n\
             di **sorgente** «niente» non è un degrado, è una cancellazione: o si\n\
             sa scrivere il nodo, o si torna un `Err`.\n  {row}",
            n + 1,
        );
        for salto in [".. }", "..}", ".. =>", "..,"] {
            assert!(
                !t.contains(salto),
                "src/serialize.rs:{}: `{salto}` salta dei campi del modello, e un\n\
                 campo saltato è un campo perso in silenzio — è così che `anchor`\n\
                 è rimasta fuori dal file per tutta la vita di questo modulo.\n  {row}",
                n + 1,
            );
        }
    }
}

/// **L'ancora di un blocco che non è un paragrafo va su una riga sua.**
///
/// Il file scriveva l'`^id` in un modo solo — ` ^id` in coda all'ultima riga —
/// e per un paragrafo va bene, perché in coda a un paragrafo c'è del testo. Per
/// gli altri sei in coda c'è un **delimitatore**, e appenderci l'ancora lo
/// rompe. Misurato blocco per blocco, prima della riparazione:
///
/// - tabella: `| 1 | ^tab` — la cella in più la butta il lettore di GFM, e
///   l'ancora **sparisce dal file** al primo giro;
/// - codice: `` ``` ^cod `` — il recinto non chiude più, e `^cod` diventa una
///   riga **dentro il codice**, che al giro dopo si allunga ancora;
/// - riga orizzontale: `--- ^hr` non è più una riga orizzontale (H→P);
/// - elenco, citazione, callout: l'id resta ma si sposta sul **figlio**, cioè
///   `[[Nota#^lis]]` non indirizza più il contenitore ma la sua ultima voce.
///
/// Le prime tre sono perdita, le altre tre sono un indirizzo che cambia
/// bersaglio; nessuna delle sei la vedeva il conto sul corpus — che confronta
/// le ancore **appiattite**, quindi non distingue il contenitore dal figlio, e
/// che non ha un caso con la tabella o il codice ancorati.
///
/// La misura qui è la più stretta che ci sia: **byte per byte**. Queste sette
/// sorgenti sono già nella forma che il serializer produce, quindi il giro deve
/// tornare al punto fisso, e ogni carattere in più o in meno è un difetto.
#[test]
fn the_again_of_a_container_not_ends_in_queue_a_a_delimiter() {
    for (name, source) in [
        ("paragrafo", "testo ^par\n"),
        ("elenco", "- a\n- b\n\n^lis\n"),
        ("codice", "```rs\nx\n```\n\n^cod\n"),
        ("citazione", "> citata\n\n^cit\n"),
        ("riga orizzontale", "---\n\n^hr\n"),
        ("callout", "> [!note]\n> corpo\n\n^cal\n"),
        ("tabella", "| a |\n| --- |\n| 1 |\n\n^tab\n"),
    ] {
        let m1 = parse(source);
        let rewritten = serialize(&m1);
        assert_eq!(
            rewritten, source,
            "«{name}»: il giro non è tornato al punto fisso.",
        );
        // E l'ancora è **di quel blocco**, non di un suo figlio: il confronto
        // appiattito non lo direbbe.
        let m2 = parse(&rewritten);
        assert_eq!(
            m2.body.first().and_then(|b| b.anchor()),
            m1.body.first().and_then(|b| b.anchor()),
            "«{name}»: l'ancora ha cambiato blocco.\n  riscritto: {rewritten:?}",
        );
    }
}

/// **Il titolo di un callout è negli `attrs`, e va scritto.**
///
/// `> [!warning] Attenzione` dà `title: "Attenzione"` e un solo figlio, il
/// corpo: il titolo **non è nei blocchi**, quindi chi scriveva `> [!{ty}]` e i
/// figli non lo appiattiva nel corpo, lo cancellava dal file. Intanto
/// `render.rs` lo mostrava (`callout-title`) leggendolo dagli `attrs`: la stessa
/// nota aveva un titolo in anteprima e nessuno sul disco.
///
/// Il conto sul corpus non lo vedeva pur avendo il caso «callout con titolo»:
/// confronta le parole e la forma dei figli, e il titolo perso non toglie
/// parole al documento — restava come paragrafo dentro il corpo. Qui la misura
/// è di nuovo byte per byte, e c'è anche il caso senza titolo, perché la riga
/// non deve guadagnare uno spazio in coda.
#[test]
fn the_title_of_a_callout_returns_on_the_file() {
    for source in ["> [!warning] Attenzione\n> corpo\n", "> [!note]\n> corpo\n"] {
        let m = parse(source);
        assert_eq!(serialize(&m), source);
    }
}

/// **Un escape non si perde, e ciò che proteggeva non diventa una feature.**
///
/// `Inline::Text` porta il testo **come si legge**: il parser decodifica gli
/// escape di comrak, quindi `\#nontag` arriva al serializer come `#nontag`. Il
/// ramo era `Inline::Text(s) => out.push_str(s)`, e riscriverlo così non è
/// lossy — è cambiare il documento, in due modi che il conto sul corpus non
/// vedeva perché non toglie né parole né blocchi al **modello**:
///
/// - `\#nontag` esce `#nontag` e al giro dopo è un **tag vero**, nell'indice e
///   nel pannello; `\[[Nota]]` esce `[[Nota]]` ed è un **link vero**, con un
///   arco nel grafo che l'autore non ha scritto;
/// - `\# titolo` in testa a un paragrafo esce `# titolo`, e il paragrafo
///   **diventa un heading** — con la sua voce nell'indice del documento.
///
/// La misura è di nuovo byte per byte: queste sorgenti sono già nella forma che
/// il serializer produce, quindi il giro deve essere fermo. Il secondo giro c'è
/// perché il danno di questa specie si vede al giro **dopo**: un file che a
/// ogni riscrittura dice una cosa diversa non è un file che si è degradato una
/// volta.
#[test]
fn a_escape_not_is_loses_and_not_becomes_a_feature() {
    for source in [
        "\\#nontag non è un tag\n",
        "\\[\\[Nota\\]\\] non è un link\n",
        "\\*niente\\* enfasi e \\`niente\\` codice\n",
        "\\# non è un titolo\n",
        "\\## nemmeno questo\n",
        "\\> non è una citazione\n",
        "\\- non è un elenco\n",
        "1\\. nemmeno questo\n",
        "\\==niente\\== evidenziato\n",
        "a\\<b non è HTML\n",
        "| a \\| b | c |\n| --- | --- |\n| 1 | 2 |\n",
    ] {
        let m1 = parse(source);
        let one = serialize(&m1);
        assert_eq!(one, source, "il primo giro ha già cambiato il documento.");
        let m2 = parse(&one);
        assert_eq!(serialize(&m2), source, "il secondo giro diverge.");
        assert_eq!(
            m2.tags.len(),
            m1.tags.len(),
            "{source:?}: il giro ha inventato un tag."
        );
        assert_eq!(
            m2.links.len(),
            m1.links.len(),
            "{source:?}: il giro ha inventato un link."
        );
        let f1: Vec<String> = m1.body.iter().map(shape).collect();
        let f2: Vec<String> = m2.body.iter().map(shape).collect();
        assert_eq!(f1, f2, "{source:?}: il giro ha cambiato tipo di blocco.");
    }
    // E l'altro verso, che è ciò che rende la riparazione una riparazione e non
    // un escape a tappeto: un tag scritto **senza** barra resta un tag, e la
    // regola che lo dice è la stessa dalle due parti (`scan_tags`).
    let m = parse("#vero e \\#finto\n");
    assert_eq!(m.tags.len(), 1);
    assert_eq!(serialize(&m), "#vero e \\#finto\n");
}

/// **Una reference definition è un blocco a sé, e fa il giro intero.**
///
/// `[etichetta]: destinazione "titolo"` è metadata — declare il bersaglio di
/// un `[a][etichetta]` — e comrak la consuma durante il parsing senza lasciare
/// un nodo nell'AST: senza il recupero del parser la riga spariva dal modello,
/// e la prima riscrittura la cancellava dal file. Qui la misura è il giro
/// completo, e in tre punti:
///
/// - il primo parse produce **un blocco `ReferenceDefinition`**, non un
///   paragrafo: `label`, `url` e `title` sono gli scalari scritti, e il testo
///   piatto del documento non li contiene — una definizione è indirizzo, non
///   prosa, e se finisse in `text` sarebbe confusa col testo ordinario;
/// - la riscrittura esce nella forma che il parser rilegge, e il re-parse
///   produce lo **stesso** blocco con gli stessi scalari — niente
///   `Paragraph` al suo posto, niente definizione degradata a testo;
/// - la destinazione che nuda non sarebbe una destinazione (gli spazi) esce
///   fra `<…>` e rientra come la stessa destinazione.
#[test]
fn a_reference_definition_remains_a_block_a_if_for_all_the_round() {
    for (name, source, label, url, title) in [
        ("semplice", "[rif]: nota.md\n", "rif", "nota.md", None),
        (
            "con titolo",
            "[r]: nota.md \"titolo\"\n",
            "r",
            "nota.md",
            Some("titolo"),
        ),
        (
            "destinazione fra angolari",
            "[r]: <nota con spazi.md> \"due\"\n",
            "r",
            "nota con spazi.md",
            Some("due"),
        ),
        (
            "etichetta con spazi interni",
            "[nota di riferimento]: a.md\n",
            "nota di riferimento",
            "a.md",
            None,
        ),
        // Il titolo che comincia con un escape: l'inizio del suo contenuto è
        // la base con cui `decodifica_segmento` decide la priorità del primo
        // carattere. Una base sbagliata di un byte (`fine - t.len()` vale
        // `p + 2` e non `p + 1`) legge il carattere sbagliato e l'escape in
        // testa si scioglie o resta a seconda del vicino sbagliato.
        (
            "titolo che inizia con escape",
            "[r]: a.md \"\\\"inizio\"\n",
            "r",
            "a.md",
            Some("\"inizio"),
        ),
    ] {
        let m1 = parse(source);
        match &m1.body[..] {
            [Block::ReferenceDefinition {
                label: the,
                url: u,
                title: t,
                ..
            }] => {
                assert_eq!(the, label, "«{name}»: etichetta");
                assert_eq!(u, url, "«{name}»: destinazione");
                assert_eq!(t.as_deref(), title, "«{name}»: titolo");
            }
            other => panic!(
                "«{name}»: la definizione non è arrivata come blocco a sé, ma come {other:?}\n\
                 (un `Paragraph` qui è la definizione confusa con testo ordinario)"
            ),
        }
        assert!(
            !m1.body.iter().any(|b| matches!(b, Block::Paragraph { .. })),
            "«{name}»: accanto alla definizione c'è un paragrafo fantasma"
        );
        assert!(
            !m1.text.contains(label) && !m1.text.contains(url),
            "«{name}»: la definizione è entrata nel testo piatto: {:?}",
            m1.text,
        );

        // Il giro: riscrittura e rilettura conservano gli scalari, e al posto
        // della definizione non compare un paragrafo.
        let rewritten = serialize(&m1);
        // Queste sorgenti sono già nella forma che il serializer produce, e
        // per una definizione la forma È la riga: la riscrittura non cambia
        // un byte, o un titolo con un escape in testa (o una destinazione
        // fra angolari) sarebbe tornato con la priorità sbagliata.
        assert_eq!(
            rewritten, source,
            "«{name}»: la riscrittura ha cambiato la riga di definizione."
        );
        let m2 = parse(&rewritten);
        match &m2.body[..] {
            [Block::ReferenceDefinition {
                label: the,
                url: u,
                title: t,
                ..
            }] => {
                assert_eq!(the, label, "«{name}»: etichetta dopo il giro");
                assert_eq!(u, url, "«{name}»: destinazione dopo il giro");
                assert_eq!(t.as_deref(), title, "«{name}»: titolo dopo il giro");
            }
            other => panic!(
                "«{name}»: al giro la definizione è diventata {other:?}\n  \
                 riscritto: {rewritten:?}"
            ),
        }
        assert!(
            !m2.body.iter().any(|b| matches!(b, Block::Paragraph { .. })),
            "«{name}»: al giro è comparso un paragrafo al posto della definizione.\n  \
             riscritto: {rewritten:?}",
        );
    }
    // La riscrittura è nella forma che il parser rilegge identica: la riga che
    // l'utente ha scritto torna com'era, non come un paragrafo di testo.
    assert_eq!(
        serialize(&parse("[r]: nota.md \"titolo\"\n")),
        "[r]: nota.md \"titolo\"\n"
    );
}

#[test]
fn two_reference_definition_consecutive_not_exceed_the_slice() {
    let source = "[a]: uno.md\n[b]: due.md\nresto\n";
    let model = parse(source);

    assert!(matches!(
        model.body.as_slice(),
        [
            Block::ReferenceDefinition { label: a, .. },
            Block::ReferenceDefinition { label: b, .. },
            Block::Paragraph { .. }
        ] if a == "a" && b == "b"
    ));
    assert_eq!(serialize(&model), "[a]: uno.md\n\n[b]: due.md\n\nresto\n");
}
