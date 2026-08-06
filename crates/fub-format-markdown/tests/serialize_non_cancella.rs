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
//! L'ancora esplicita di un **heading** (`# Titolo ^testa`) non torna indietro,
//! e non è un difetto di questo modulo: nell'albero `Block::Heading::anchor`
//! porta lo **slug generato** dal testo, non l'id che l'utente ha scritto, e
//! quell'id è raggiungibile solo dalla tabella piatta `anchors`. È una
//! divergenza già registrata, con la sua riga, in `il_corpus.rs` — «l'ancora
//! esplicita di un heading non è raggiungibile dall'albero» — e va riparata di
//! là, nel modello, non di qua. Le ancore che questo file controlla sono quindi
//! quelle **dell'albero**.

// L'`allow` sta **qui**, sulla dichiarazione, e non dentro `corpus/mod.rs` —
// che dichiara di non volerlo, con la sua ragione. La ragione regge ancora: un
// modulo condiviso viene compilato dentro ciascun binario che lo dichiara, e
// `dead_code` è ciò che si accorge di un caso del corpus che nessuno semina più.
// Questo terzo cliente però ne usa **una** funzione, `corpus()`, e senza l'attributo
// pagherebbe sette avvisi per ciò che gli altri due usano. Il presidio del corpus
// non si indebolisce: `il_corpus.rs` e `transfer_e2e.rs` continuano a compilarlo
// senza allow, e la prima voce che smette di essere seminata è rossa di là.
#[allow(dead_code)]
mod corpus;

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{custom_kind, Block, DocId, DocumentModel, Inline, Span};
use fub_format_markdown::MarkdownProvider;

fn parse(src: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), &ParseContext::obsidian("nota.md"))
        .expect("il markdown parsa")
}

fn serialize(model: &DocumentModel) -> String {
    MarkdownProvider::new()
        .serialize(model)
        .expect("il modello si serializza")
}

/// Un documento di un blocco solo, per le prove che non passano dal parser.
fn con(block: Block) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new("nota.md"));
    m.body = vec![block];
    m
}

fn paragrafo(inlines: Vec<Inline>) -> Block {
    Block::Paragraph {
        inlines,
        anchor: None,
        span: Span::new(0, 0),
    }
}

/// Le parole, senza la spaziatura: ciò che cambia qui è **contenuto sparito**,
/// non impaginazione.
fn parole(m: &DocumentModel) -> String {
    m.text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// La forma dell'albero: il nome di ogni blocco e i suoi figli. Non guarda il
/// testo — è l'altra metà, e si rompe da sola.
fn forma(b: &Block) -> String {
    let (nome, figli): (String, Vec<String>) = match b {
        Block::Heading { level, .. } => return format!("H{level}"),
        Block::Paragraph { .. } => return "P".into(),
        Block::CodeBlock { lang, .. } => {
            return format!("Code({})", lang.clone().unwrap_or_default())
        }
        Block::ThematicBreak { .. } => return "Hr".into(),
        Block::Table { .. } => return "Table".into(),
        Block::Quote { blocks, .. } => ("Q".into(), blocks.iter().map(forma).collect()),
        Block::Custom {
            custom_kind,
            blocks,
            ..
        } => (custom_kind.clone(), blocks.iter().map(forma).collect()),
        Block::List { items, .. } => (
            "L".into(),
            items
                .iter()
                .flat_map(|i| i.blocks.iter().map(forma))
                .collect(),
        ),
    };
    format!("{nome}[{}]", figli.join(","))
}

/// Le ancore **raggiungibili dall'albero**, in ordine. Gli heading restano
/// fuori: vedi il limite in testa al modulo.
fn ancore(blocchi: &[Block]) -> Vec<String> {
    let mut out = Vec::new();
    for b in blocchi {
        if !matches!(b, Block::Heading { .. }) {
            if let Some(id) = b.anchor() {
                out.push(id.to_string());
            }
        }
        match b {
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                out.extend(ancore(blocks))
            }
            Block::List { items, .. } => {
                for i in items {
                    out.extend(ancore(&i.blocks));
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
fn il_giro_completo_non_perde_il_testo() {
    for caso in corpus::corpus() {
        let m1 = parse(caso.source);
        let m2 = parse(&serialize(&m1));
        assert_eq!(
            parole(&m1),
            parole(&m2),
            "«{}»: il giro completo ha riscritto il documento senza una parte del\n\
             suo testo. La sorgente riscritta è il file dell'utente: ciò che non\n\
             ci arriva non è degradato, è cancellato.\n  sorgente: {:?}",
            caso.nome,
            caso.source,
        );
    }
}

/// **Il conto, seconda proprietà.** La struttura che entra esce.
///
/// Si rompe da sola, e per il testo è invisibile: un elenco annidato appiattito
/// ha le stesse parole del suo originale, e un `- a` figlio diventato fratello
/// non fa fallire niente. È il sito 9.
#[test]
fn il_giro_completo_non_perde_la_struttura() {
    for caso in corpus::corpus() {
        let m1 = parse(caso.source);
        let riscritto = serialize(&m1);
        let m2 = parse(&riscritto);
        let f1: Vec<String> = m1.body.iter().map(forma).collect();
        let f2: Vec<String> = m2.body.iter().map(forma).collect();
        assert_eq!(
            f1, f2,
            "«{}»: il giro completo ha cambiato la forma dell'albero.\n  \
             sorgente: {:?}\n  riscritto: {riscritto:?}",
            caso.nome, caso.source,
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
fn il_giro_completo_non_perde_le_ancore_di_blocco() {
    for caso in corpus::corpus() {
        let m1 = parse(caso.source);
        let riscritto = serialize(&m1);
        let m2 = parse(&riscritto);
        assert_eq!(
            ancore(&m1.body),
            ancore(&m2.body),
            "«{}»: il giro completo ha perso un'ancora di blocco.\n  \
             sorgente: {:?}\n  riscritto: {riscritto:?}",
            caso.nome,
            caso.source,
        );
    }
}

/// **Il comportamento.** Un inline di una sintassi che il provider non conosce
/// **risale**: non si scrive a metà e non si salta.
///
/// I delimitatori (`==`, `$`, quelli di un plugin di terzi) appartengono alla
/// `SyntaxRule` che li ha agganciati, e il provider markdown non li ha mai
/// visti. Scriverne il solo `attrs.text` toglierebbe una sintassi dal file
/// dell'utente; scrivere niente toglierebbe anche il testo. La terza strada è
/// dirlo.
#[test]
fn un_inline_che_non_si_sa_scrivere_risale() {
    for (nome, kind, attrs) in [
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
        let m = con(paragrafo(vec![
            Inline::Text("prima ".into()),
            Inline::Custom {
                custom_kind: kind.into(),
                attrs,
                span: Span::new(0, 0),
            },
            Inline::Text(" dopo".into()),
        ]));
        let esito = MarkdownProvider::new().serialize(&m);
        let Err(e) = esito else {
            panic!(
                "«{nome}»: `serialize` ha reso {:?} — l'inline è sparito dalla\n\
                 sorgente e nessuno l'ha detto.",
                esito.unwrap(),
            );
        };
        assert!(
            e.to_string().contains(kind),
            "«{nome}»: l'errore non nomina il kind, e chi lo legge non sa cosa\n\
             non si è scritto: {e}",
        );
    }
}

/// Lo stesso, sui blocchi: `math` e `diagram` portano il sorgente negli `attrs`
/// e **non hanno figli**, quindi il degrado «scrivi i figli» scriveva zero byte.
#[test]
fn un_blocco_che_non_si_sa_scrivere_risale() {
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
        let m = con(Block::Custom {
            custom_kind: kind.into(),
            attrs,
            blocks: Vec::new(),
            anchor: None,
            span: Span::new(0, 0),
        });
        let esito = MarkdownProvider::new().serialize(&m);
        let Err(e) = esito else {
            panic!(
                "`{kind}`: `serialize` ha reso {:?} — il blocco è sparito.",
                esito.unwrap()
            );
        };
        assert!(
            e.to_string().contains(kind),
            "l'errore non nomina il kind: {e}"
        );
    }
}

/// Un kind del registro che arriva **senza gli `attrs` che dichiara** è lo
/// stesso caso del frontmatter verbatim: il contenuto non è ricostruibile da
/// nient'altro, quindi il giro si ferma invece di scrivere un richiamo vuoto.
#[test]
fn gli_attrs_che_mancano_risalgono() {
    let m = con(paragrafo(vec![Inline::Custom {
        custom_kind: custom_kind::FOOTNOTE_REFERENCE.into(),
        attrs: serde_json::json!({}),
        span: Span::new(0, 0),
    }]));
    let esito = MarkdownProvider::new().serialize(&m);
    assert!(
        esito.is_err(),
        "un richiamo di nota senza etichetta è uscito come {:?}: il segno che\n\
         l'utente aveva scritto non c'è più.",
        esito.unwrap(),
    );

    // E un `html` senza il suo `html`, che è l'altra metà dello stesso patto.
    let m = con(Block::Custom {
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
fn il_codice_non_si_spezza_sui_propri_delimitatori() {
    for codice in ["a ` b", "``doppio``", "`in testa", "in coda`"] {
        let m = con(paragrafo(vec![Inline::Code(codice.into())]));
        let riscritto = serialize(&m);
        let riletto = parse(&riscritto);
        let Some(Block::Paragraph { inlines, .. }) = riletto.body.first() else {
            panic!("{codice:?}: non è tornato un paragrafo, ma {riscritto:?}");
        };
        assert_eq!(
            inlines.as_slice(),
            [Inline::Code(codice.into())],
            "{codice:?}: riscritto come {riscritto:?}, riletto come {inlines:?}",
        );
    }

    // La stessa regola sul recinto di un blocco di codice, che è lo stesso
    // difetto con tre backtick invece di uno.
    let m = con(Block::CodeBlock {
        lang: Some("md".into()),
        code: "```\nun recinto dentro un recinto\n```\n".into(),
        anchor: None,
        span: Span::new(0, 0),
    });
    let riscritto = serialize(&m);
    let riletto = parse(&riscritto);
    let Some(Block::CodeBlock { code, .. }) = riletto.body.first() else {
        panic!("il recinto si è chiuso a metà: {riscritto:?}");
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
fn nessun_ramo_muto() {
    const SORGENTE: &str = include_str!("../src/serialize.rs");

    for (n, riga) in SORGENTE.lines().enumerate() {
        let t = riga.trim_start();
        if t.starts_with("//") {
            continue;
        }
        assert!(
            !t.contains("=> {}"),
            "src/serialize.rs:{}: un ramo che non scrive niente. In un serializer\n\
             di **sorgente** «niente» non è un degrado, è una cancellazione: o si\n\
             sa scrivere il nodo, o si torna un `Err`.\n  {riga}",
            n + 1,
        );
        for salto in [".. }", "..}", ".. =>", "..,"] {
            assert!(
                !t.contains(salto),
                "src/serialize.rs:{}: `{salto}` salta dei campi del modello, e un\n\
                 campo saltato è un campo perso in silenzio — è così che `anchor`\n\
                 è rimasta fuori dal file per tutta la vita di questo modulo.\n  {riga}",
                n + 1,
            );
        }
    }
}
