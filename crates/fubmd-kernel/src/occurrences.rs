//! **Dove**, nel sorgente, sta ciò che una ricerca ha trovato (§21.3).
//!
//! # Perché non lo fa chi indicizza
//!
//! Perché non può. `SearchIndex` riceve un [`DocumentModel`] e ne indicizza la
//! **proiezione a testo piano** (`DocumentModel::text`): niente frontmatter,
//! niente marcatori, i wikilink ridotti alla loro etichetta, tutto rifilato.
//! Gli offset che quel motore sa produrre — ed è ciò che sono gli
//! `highlights` — sono offset *dentro l'estratto* di quella proiezione, e fra
//! la proiezione e il sorgente non esiste nessuna mappa: ricostruirla vorrebbe
//! dire far portare a ogni indice una seconda copia del documento, o un
//! dizionario di corrispondenze per ogni nota del vault.
//!
//! Il sorgente ce l'ha il **vault**, cioè il kernel. Quindi la coordinata la
//! produce chi ha la coordinata, e chi indicizza continua a rispondere *quali
//! documenti* e *cosa evidenziare in una riga* — che è ciò che sa.
//!
//! # Cosa questa localizzazione è, e cosa non è
//!
//! Non è una seconda ricerca e non decide **se** un documento combacia: quello
//! l'ha già deciso chi indicizza, con la propria tokenizzazione, i propri
//! sinonimi e (un giorno) la propria tolleranza ai refusi. Qui si risponde a una
//! domanda più piccola e puramente testuale: *dove compare, nei byte di questo
//! file, ciò che è stato scritto nella query*.
//!
//! Le due possono non combaciare, e il verso in cui non combaciano è quello
//! innocuo: un documento trovato per stemming o per un refuso corretto dal
//! motore non contiene la stringa digitata, quindi non produce nessuna
//! occorrenza — e `occurrences` vuoto significa già, da contratto, «nessuno le
//! ha calcolate». Il contrario — un'occorrenza inventata dove non c'è testo —
//! non può succedere: si cercano byte in un file.

use fubmd_abi::model::Span;
use fubmd_abi::query::{QueryExpr, QueryPredicate, TextMode};
use fubmd_abi::traits::IndexQuery;

/// Quante occorrenze al massimo si riportano per documento.
///
/// Una parola comune compare centinaia di volte in una nota lunga, e nessuno le
/// salta una per una: oltre questa soglia la lista si tronca, ed è la sola cosa
/// che questo modulo nasconde a chi chiede. Il tetto sta qui e non nella firma
/// perché non è una proprietà del contratto — è quanto vale la pena trasportare.
const MAX_PER_DOC: usize = 64;

/// Quanti documenti al massimo si aprono per localizzare.
///
/// Localizzare costa **una lettura per documento**, e non ogni chiamante di una
/// ricerca è una casella di ricerca: `vault.replace`, una collezione e
/// un'automazione chiedono documenti a centinaia e delle coordinate non sanno
/// che farsene. Chi ha chiesto una finestra riceve la sua finestra localizzata —
/// venti, cinquanta righe — e chi ha chiesto il vault intero riceve le prime
/// [`MAX_DOCS`] e per il resto un `occurrences` vuoto, che è esattamente ciò che
/// quel campo significa quando nessuno lo ha riempito.
const MAX_DOCS: usize = 64;

/// I testi da localizzare, presi dalla domanda.
///
/// Solo le foglie di testo **non negate**: una clausola `NOT text` seleziona i
/// documenti che *non* la contengono, e cercarla dentro di loro sarebbe cercare
/// ciò che si è chiesto di non trovare.
pub(crate) fn wanted(query: &IndexQuery) -> Vec<String> {
    let IndexQuery::Documents { matching, .. } = query else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for needle in needles_of(matching) {
        if !out.contains(&needle) {
            out.push(needle);
        }
    }
    out
}

fn needles_of(expr: &QueryExpr) -> Vec<String> {
    let mut out = Vec::new();
    for clause in &expr.any {
        for literal in &clause.all {
            if literal.negated {
                continue;
            }
            let QueryPredicate::Text(text) = &literal.predicate else {
                continue;
            };
            match text.mode {
                // La sequenza esatta è **una** cosa da trovare: spezzarla in
                // termini darebbe le posizioni delle parole prese da sole, che
                // è il contrario di ciò che una frase chiede.
                TextMode::Phrase => {
                    let phrase = text.text.trim();
                    if !phrase.is_empty() {
                        out.push(phrase.to_string());
                    }
                }
                // Ogni termine è una cosa da trovare: chi cerca due parole vuole
                // saltare all'una o all'altra, non al punto in cui compaiono di
                // fila (che potrebbe non esistere).
                TextMode::Terms => {
                    out.extend(text.text.split_whitespace().map(str::to_string));
                }
            }
        }
    }
    out
}

/// Il tetto sui documenti da aprire.
pub(crate) fn max_docs() -> usize {
    MAX_DOCS
}

/// Dove compaiono, nei byte di `source`, i testi cercati — in ordine di
/// posizione e senza sovrapposizioni fra occorrenze uguali.
///
/// Il confronto ignora il **caso**, come lo ignora ogni motore di ricerca di
/// note: chi cerca `rust` vuole anche il `Rust` in cima al paragrafo. Ignora
/// solo quello — accenti, punteggiatura e forme flesse restano ciò che sono,
/// perché normalizzarli qui vorrebbe dire riscrivere la tokenizzazione di chi
/// indicizza, in un secondo posto e con altre regole.
pub(crate) fn locate(source: &str, needles: &[String]) -> Vec<Span> {
    let mut spans: Vec<Span> = Vec::new();
    for needle in needles {
        if needle.is_empty() {
            continue;
        }
        let mut from = 0usize;
        while from < source.len() {
            let Some(span) = first_at_or_after(source, needle, from) else {
                break;
            };
            if !spans.contains(&span) {
                spans.push(span);
            }
            // Si riparte **dopo l'inizio** e non dopo la fine: due termini
            // diversi possono cadere sullo stesso pezzo di testo (`arch` dentro
            // `architettura`), e saltare la coda ne perderebbe uno.
            from = next_boundary(source, span.start);
        }
    }
    spans.sort_by_key(|s| (s.start, s.end));
    spans.truncate(MAX_PER_DOC);
    spans
}

/// La prima occorrenza di `needle` che comincia a `from` o dopo.
fn first_at_or_after(source: &str, needle: &str, from: usize) -> Option<Span> {
    let mut at = from;
    while at <= source.len() {
        if !source.is_char_boundary(at) {
            at += 1;
            continue;
        }
        if let Some(len) = prefix_len_ci(&source[at..], needle) {
            return Some(Span::new(at, at + len));
        }
        at += 1;
    }
    None
}

fn next_boundary(source: &str, from: usize) -> usize {
    let mut at = from + 1;
    while at < source.len() && !source.is_char_boundary(at) {
        at += 1;
    }
    at
}

/// Quanti **byte** di `hay` occupa il prefisso uguale a `needle` a meno del
/// caso, se c'è.
///
/// Il confronto è carattere per carattere e non su una copia minuscola di tutto
/// il documento, e la ragione è che gli offset sono il prodotto di questa
/// funzione: `to_lowercase` può cambiare la lunghezza in byte di ciò che tocca
/// (`İ` diventa due caratteri), e uno span misurato su un testo diverso da
/// quello che l'editor ha aperto porterebbe il cursore altrove.
fn prefix_len_ci(hay: &str, needle: &str) -> Option<usize> {
    let mut chars = hay.char_indices();
    let mut len = 0usize;
    for wanted in needle.chars() {
        let (at, found) = chars.next()?;
        if !found.to_lowercase().eq(wanted.to_lowercase()) {
            return None;
        }
        len = at + found.len_utf8();
    }
    Some(len)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fubmd_abi::query::{QueryClause, QueryLiteral, TextQuery};

    fn text_query(text: &str, mode: TextMode, negated: bool) -> IndexQuery {
        IndexQuery::Documents {
            matching: QueryExpr {
                any: vec![QueryClause {
                    all: vec![QueryLiteral {
                        negated,
                        predicate: QueryPredicate::Text(TextQuery {
                            mode,
                            ..TextQuery::terms(text)
                        }),
                    }],
                }],
            },
            sort: None,
            select: fubmd_abi::traits::PropertySelect::None,
            page: None,
        }
    }

    #[test]
    fn i_termini_si_cercano_uno_per_uno_e_la_frase_intera() {
        assert_eq!(
            wanted(&text_query("rust async", TextMode::Terms, false)),
            vec!["rust".to_string(), "async".to_string()]
        );
        assert_eq!(
            wanted(&text_query("rust async", TextMode::Phrase, false)),
            vec!["rust async".to_string()]
        );
    }

    #[test]
    fn una_foglia_negata_non_si_localizza() {
        // `NOT rust` seleziona chi NON parla di rust: cercarlo dentro i
        // risultati vorrebbe dire cercare ciò che si è chiesto di non trovare.
        assert!(wanted(&text_query("rust", TextMode::Terms, true)).is_empty());
    }

    #[test]
    fn la_seconda_occorrenza_ha_lo_span_della_seconda() {
        let source = "Il gatto dorme. Poi il Gatto si sveglia.";
        let spans = locate(source, &["gatto".to_string()]);
        assert_eq!(spans.len(), 2, "due occorrenze, non una");
        assert_eq!(&source[spans[0].start..spans[0].end], "gatto");
        // Il caso si ignora, e lo span resta quello del sorgente: è ciò che
        // l'editor apre, non una copia normalizzata.
        assert_eq!(&source[spans[1].start..spans[1].end], "Gatto");
        assert!(spans[0].start < spans[1].start, "in ordine di posizione");
    }

    #[test]
    fn gli_offset_sono_byte_del_sorgente_anche_con_gli_accenti() {
        // Tre lettere accentate prima del termine: se gli offset fossero code
        // unit o caratteri, lo slice qui sotto taglierebbe altrove.
        let source = "però però però architettura";
        let spans = locate(source, &["arch".to_string()]);
        assert_eq!(spans.len(), 1);
        assert_eq!(&source[spans[0].start..spans[0].end], "arch");
        assert_eq!(
            spans[0].start,
            source.find("arch").expect("c'è"),
            "lo span è in byte, come ogni altro span del modello"
        );
    }

    #[test]
    fn un_prefisso_e_un_termine_intero_non_si_mangiano_a_vicenda() {
        // `arch` è dentro `architettura`: cercarli insieme deve dare due span,
        // uno dentro l'altro, e non farne sparire uno.
        let source = "architettura";
        let spans = locate(source, &["arch".to_string(), "architettura".to_string()]);
        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0], Span::new(0, 4));
        assert_eq!(spans[1], Span::new(0, source.len()));
    }

    #[test]
    fn un_termine_che_non_ce_non_inventa_niente() {
        assert!(locate("il gatto dorme", &["cane".to_string()]).is_empty());
    }

    #[test]
    fn oltre_il_tetto_la_lista_si_tronca() {
        let source = "a ".repeat(MAX_PER_DOC * 2);
        assert_eq!(locate(&source, &["a".to_string()]).len(), MAX_PER_DOC);
    }
}
