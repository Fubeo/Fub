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

use fub_abi::model::{custom_kind, Block, Carico, DocId, DocumentModel, Inline, Span};
use fub_abi::FormatProvider;
use fub_format_markdown::MarkdownProvider;

/// Byte riconoscibili e neutri all'escaping HTML.
const MARCA: &str = "MARCA-DEI-BYTE-42";

fn documento(body: Vec<Block>) -> DocumentModel {
    let mut doc = DocumentModel::empty(DocId::new("nota.md"));
    doc.body = body;
    doc
}

fn blocco(kind: &str, attrs: serde_json::Value, blocks: Vec<Block>) -> Block {
    Block::Custom {
        custom_kind: kind.to_string(),
        attrs,
        blocks,
        anchor: None,
        span: Span::EMPTY,
    }
}

fn paragrafo(testo: &str) -> Block {
    Block::Paragraph {
        inlines: vec![Inline::Text(testo.to_string())],
        anchor: None,
        span: Span::EMPTY,
    }
}

fn reso(body: Vec<Block>) -> String {
    MarkdownProvider::new()
        .render_html(&documento(body), &Default::default())
        .expect("la resa non fallisce mai")
}

/// I byte dichiarati si vedono nell'anteprima, **sotto la chiave che il
/// contratto dichiara** — non sotto una delle tre che il renderer ricordava.
///
/// Il confronto è su `>byte<`, cioè sui byte come *contenuto* fra due tag: un
/// `contains` nudo passerebbe anche per l'attributo `data-label`, che la resa
/// generica scrive per conto suo, e quel verde sarebbe di un altro.
#[test]
fn i_byte_dichiarati_si_vedono_nella_resa() {
    let dentro = format!(">{MARCA}<");

    for (kind, carico) in custom_kind::CARICHI {
        let body = match carico.chiave() {
            Some(chiave) => vec![blocco(
                kind,
                serde_json::json!({ chiave: MARCA }),
                Vec::new(),
            )],
            // Chi tiene il contenuto nei figli non ha una chiave da sbagliare:
            // la domanda che gli si fa è la stessa, e la risposta sono i figli.
            None => vec![blocco(
                kind,
                serde_json::Value::Null,
                vec![paragrafo(MARCA)],
            )],
        };
        let html = reso(body);
        assert!(
            html.contains(&dentro),
            "`{kind}` dichiara {carico:?} e i suoi byte non compaiono nella resa:\n\
             {html}\n\n\
             Chi rende un `Custom` senza figli deve chiedere la chiave a\n\
             `custom_kind::carico`, non tenerne un campione: un campione non\n\
             risponde per il kind che non c'era quando è stato scritto."
        );
    }
}

/// Ciò che **è già sorgente** si ricopia; ciò che è il **corpo di una sintassi**
/// non si scrive, e lo si dice.
#[test]
fn la_scrittura_segue_il_contratto() {
    let provider = MarkdownProvider::new();

    for (kind, carico) in custom_kind::CARICHI {
        let Some(chiave) = carico.chiave() else {
            continue; // i `Figli`: vedi il limite dichiarato in testa al file
        };
        let scritto = provider.serialize(&documento(vec![blocco(
            kind,
            serde_json::json!({ chiave: MARCA }),
            Vec::new(),
        )]));

        match carico {
            Carico::Sorgente(_) => {
                let testo = scritto.unwrap_or_else(|e| {
                    panic!(
                        "`{kind}` dichiara di portare **sorgente** e la scrittura la\n\
                         rifiuta ({e:?}): dei byte che sono già sorgente si copiano,\n\
                         o il giro sorgente→modello→sorgente li perde."
                    )
                });
                assert!(
                    testo.contains(MARCA),
                    "`{kind}` porta sorgente e la scrittura la salta:\n{testo:?}"
                );
            }
            Carico::Corpo(_) => assert!(
                scritto.is_err(),
                "`{kind}` porta il **corpo** di una sintassi e la scrittura lo ha\n\
                 scritto lo stesso: senza il delimitatore che lo racchiudeva —\n\
                 che è della regola che l'ha agganciato, e che la regola può\n\
                 aver trasformato — riscriverlo è inventare la sorgente\n\
                 dell'utente. Il rifiuto è la sola risposta che non lo fa:\n\
                 {scritto:?}"
            ),
            Carico::Figli => unreachable!("`Figli` non ha chiave"),
        }
    }
}
