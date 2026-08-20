//! **Il bersaglio di un clic non entra nel contesto di sessione** (§26.5,
//! decisione 0152).
//!
//! `view-context` porta quattro campi — pannello, documento, selezioni,
//! modalità — e la [0007](../../../docs/decisions/0007-contesto-di-sessione.md)
//! li ha messi *tutti* lì con la sua ragione scritta: «un campo in più a un
//! record è una migrazione di ogni provider che lo riceve. I quattro campi sono
//! perciò tutti qui, e non un sottoinsieme da completare dopo».
//!
//! La §26.5 ha proposto di completarlo lo stesso, con un bersaglio del clic
//! destro, perché il contratto ne prometteva uno: il doc di `context-menu`
//! diceva che «cosa fosse il bersaglio del clic lo dice il contesto di
//! sessione», e il record quel campo non l'ha mai avuto. La 0152 ha risposto di
//! no e ha corretto la promessa — un bersaglio è vero per un istante, mentre
//! questo record si legge quando capita.
//!
//! Una decisione del genere si scrive in un doc, e un doc non diventa rosso.
//! Questo banco è la metà che lo diventa: legge il **sorgente** di `session.rs`
//! e pretende che i campi siano quei quattro e in quell'ordine. Chi ne aggiunge
//! un quinto non trova un commento da leggere — trova un banco che nomina la
//! decisione che sta scavalcando, e se la decisione è cambiata questo è il file
//! da cambiare per primo.
//!
//! *Perché sul sorgente e non su un valore serializzato.* `ViewContext` non ha
//! un `Default`, e costruirne uno vorrebbe dire nominare un `PaneId` e un
//! `PaneMode` — cioè far dipendere il conto dei campi da due tipi che con la
//! domanda non c'entrano. Il sorgente li nomina e basta.

use std::path::Path;

/// I quattro, nell'ordine in cui il record li dichiara — che è anche l'ordine
/// del WIT, e lì l'ordine è il confine.
const FIELDS: &[&str] = &["pane", "doc", "selections", "mode"];

#[test]
fn the_context_of_session_has_four_fields_and_no_target() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/session.rs");
    let src = std::fs::read_to_string(&path).expect("src/session.rs si legge");
    let file = syn::parse_file(&src).expect("src/session.rs parsa");

    let mut found: Option<Vec<String>> = None;
    for item in &file.items {
        let syn::Item::Struct(s) = item else { continue };
        if s.ident != "ViewContext" {
            continue;
        }
        found = Some(
            s.fields
                .iter()
                .map(|f| {
                    f.ident
                        .as_ref()
                        .expect("ViewContext è un record")
                        .to_string()
                })
                .collect(),
        );
    }

    let found = found.expect("`struct ViewContext` sta in src/session.rs");
    assert_eq!(
        found, FIELDS,
        "i campi di `ViewContext` non sono più i quattro della decisione 0007. \
         Un campo in più è una migrazione di ogni provider che lo riceve, e se \
         il campo nuovo è il bersaglio di un clic la decisione 0152 dice di no \
         con la sua ragione: un bersaglio è vero per un istante, questo record \
         si legge quando capita. Cambiare questo elenco vuol dire scrivere \
         prima il verbale che lo consente."
    );
}
