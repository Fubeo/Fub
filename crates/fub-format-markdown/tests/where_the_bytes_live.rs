//! **Dove un `Custom` tiene i byte lo dice il contratto, e i due lati lo
//! chiedono invece di ricordarselo.**
//!
//! Era la stessa lista scritta tre volte, in tre linguaggi diversi: la prosa di
//! `model.rs`, tre stringhe a campione in `render.rs` (`html`, `source`,
//! `text`), una catena di `if` sui kind in `serialize.rs`. Tre copie che
//! nessuno teneva allineate — e allinearle a mano è esattamente ciò che nessuno
//! fa, perché il compilatore un `const` in più non lo vede.
//!
//! Adesso l'elenco è uno solo, [`custom_kind::CARICHI`], e questo file è il
//! banco che lega i due lati alla tabella. **Non nomina nessun kind**: li
//! attraversa tutti, e per ognuno chiede al contratto cosa porta prima di
//! guardare cosa i due lati ne fanno. Un kind nuovo entra qui da solo il giorno
//! in cui entra in `CARICHI`, e in `CARICHI` deve entrare perché
//! `model.rs::ogni_kind_dichiara_cosa_porta` lo conta.
//!
//! # Cosa presidia, e cosa no
//!
//! - **La resa**: un blocco che porta i byte sotto la chiave dichiarata li fa
//!   vedere. È la metà che sarebbe rossa sul codice di prima: `label` non è fra
//!   le tre stringhe a campione, e un `footnote-reference` degradato a blocco
//!   usciva come un `<div>` vuoto.
//! - **La scrittura di ciò che è già sorgente** (`Sorgente`): si ricopia.
//! - **Il rifiuto di ciò che è il corpo di una sintassi** (`Corpo`): il recinto
//!   che lo racchiudeva è della regola che l'ha agganciato, e riscriverlo a
//!   indovinare sarebbe inventare la sorgente dell'utente. Questa metà, sul
//!   codice di prima, era **verde per costruzione**: la catena di `if` cadeva
//!   nell'`else` e sbagliava per la ragione giusta. Sta qui perché adesso la
//!   risposta viene da una tabella, e una tabella si può cambiare per sbaglio.
//! - **Non** presidia la scrittura dei `Figli`: quella è la metà che *è* di
//!   markdown, e chiede a ogni kind i suoi `attrs` (l'etichetta di una nota, il
//!   tipo di un callout). Un banco che non nomina i kind non può fornirli, e
//!   fingere che possa vorrebbe dire scrivere qui l'elenco per la quarta volta.

use fub_abi::model::{custom_kind, Block, DocId, DocumentModel, Inline, Payload, Span};
use fub_abi::FormatProvider;
use fub_format_markdown::MarkdownProvider;

/// Byte riconoscibili e neutri all'escaping HTML.
const MARKER: &str = "BYTE-MARKER-42";

fn document(body: Vec<Block>) -> DocumentModel {
    let mut doc = DocumentModel::empty(DocId::new("nota.md"));
    doc.body = body;
    doc
}

fn block(kind: &str, attrs: serde_json::Value, blocks: Vec<Block>) -> Block {
    Block::Custom {
        custom_kind: kind.to_string(),
        attrs,
        blocks,
        anchor: None,
        span: Span::EMPTY,
    }
}

fn paragraph(text: &str) -> Block {
    Block::Paragraph {
        inlines: vec![Inline::Text(text.to_string())],
        anchor: None,
        span: Span::EMPTY,
    }
}

fn rendered(body: Vec<Block>) -> String {
    MarkdownProvider::new()
        .render_html(&document(body), &Default::default())
        .expect("la resa non fallisce mai")
}

/// I byte dichiarati si vedono nell'anteprima, **sotto la chiave che il
/// contratto dichiara** — non sotto una delle tre che il renderer ricordava.
///
/// Il confronto è su `>byte<`, cioè sui byte come *contenuto* fra due tag: un
/// `contains` nudo passerebbe anche per l'attributo `data-label`, che la resa
/// generica scrive per conto suo, e quel verde sarebbe di un altro.
#[test]
fn declared_bytes_are_visible_in_render() {
    let within = format!(">{MARKER}<");

    for (kind, payload) in custom_kind::PAYLOADS {
        let body = match payload.key() {
            Some(key) => vec![block(
                kind,
                serde_json::json!({ key: MARKER }),
                Vec::new(),
            )],
            // Chi tiene il contenuto nei figli non ha una chiave da sbagliare:
            // la domanda che gli si fa è la stessa, e la risposta sono i figli.
            None => vec![block(
                kind,
                serde_json::Value::Null,
                vec![paragraph(MARKER)],
            )],
        };
        let html = rendered(body);
        assert!(
            html.contains(&within),
            "`{kind}` dichiara {payload:?} e i suoi byte non compaiono nella resa:\n\
             {html}\n\n\
             Chi rende un `Custom` senza figli deve chiedere la chiave a\n\
             `custom_kind::payload`, do not keep a sample: a sample does not\n\
             risponde per il kind che non c'era quando è stato scritto."
        );
    }
}

/// Ciò che **è già sorgente** si ricopia; ciò che è il **corpo di una sintassi**
/// non si scrive, e lo si dice.
#[test]
fn writing_follows_the_contract() {
    let provider = MarkdownProvider::new();

    for (kind, payload) in custom_kind::PAYLOADS {
        let Some(key) = payload.key() else {
            continue; // i `Figli`: vedi il limite dichiarato in testa al file
        };
        let written = provider.serialize(&document(vec![block(
            kind,
            serde_json::json!({ key: MARKER }),
            Vec::new(),
        )]));

        match payload {
            Payload::Source(_) => {
                let text = written.unwrap_or_else(|and| {
                    panic!(
                        "`{kind}` dichiara di portare **sorgente** e la scrittura la\n\
                         rifiuta ({and:?}): dei byte che sono già sorgente si copiano,\n\
                         o il giro sorgente→modello→sorgente li perde."
                    )
                });
                assert!(
                    text.contains(MARKER),
                    "`{kind}` porta sorgente e la scrittura la salta:\n{text:?}"
                );
            }
            Payload::Body(_) => assert!(
                written.is_err(),
                "`{kind}` porta il **corpo** di una sintassi e la scrittura lo ha\n\
                 scritto lo stesso: senza il delimitatore che lo racchiudeva —\n\
                 che è della regola che l'ha agganciato, e che la regola può\n\
                 aver trasformato — riscriverlo è inventare la sorgente\n\
                 dell'utente. Il rifiuto è la sola risposta che non lo fa:\n\
                 {written:?}"
            ),
            Payload::Children => unreachable!("`Children` has no key"),
        }
    }
}
