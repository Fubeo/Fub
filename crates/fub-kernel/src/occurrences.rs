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

use fub_abi::model::Span;
use fub_abi::query::{QueryExpr, QueryPredicate, TextMode};
use fub_abi::rules::composition::{cluster_end, composed};
use fub_abi::traits::IndexQuery;

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
///
/// I doppioni si tolgono **con la stessa regola con cui poi si cercherà**, cioè
/// [`same_needle`], che è [`prefix_len_ci`] — quella di [`locate`]. Non è un
/// dettaglio di stile: `Rust rust` sono due testi diversi per `==` e uno solo
/// per chi cerca, quindi con l'uguaglianza esatta il vault si scandiva **due
/// volte per trovare le stesse posizioni**, su ognuno dei [`MAX_DOCS`] documenti
/// aperti. E il verso opposto è la ragione per cui la regola si **riusa** invece
/// di riscriverla: un dedup più largo di quello con cui si cerca — per esempio
/// `to_lowercase` sull'intera stringa — fonderebbe testi che `locate` distingue,
/// e allora non sarebbe più lavoro risparmiato ma un'occorrenza persa.
pub(crate) fn wanted(query: &IndexQuery) -> Vec<String> {
    let IndexQuery::Documents { matching, .. } = query else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for needle in needles_of(matching) {
        if !out.iter().any(|already| same_needle(already, &needle)) {
            out.push(needle);
        }
    }
    out
}

/// Se due testi da cercare sono lo **stesso** testo per chi cercherà.
///
/// È [`prefix_len_ci`] usata per intero invece che come prefisso: `b` combacia
/// con `a` a meno del caso **e** lo consuma tutto. Una funzione e non un
/// `to_lowercase().eq()` perché il confronto di `locate` è carattere per
/// carattere sulle forme minuscole, e quella scorciatoia non è la stessa regola
/// — `İ` e `i̇` sono uguali per `to_lowercase` e diversi per `prefix_len_ci`,
/// che è chi decide davvero cosa si trova.
fn same_needle(a: &str, b: &str) -> bool {
    prefix_len_there(a, b) == Some(a.len())
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
/// posizione, senza doppioni e **senza che due occorrenze dello stesso testo si
/// sovrappongano**.
///
/// Termini *diversi* invece si sovrappongono eccome, ed è voluto: `arch` sta
/// dentro `architettura`, e chi ha cercato tutte e due vuole tutte e due. Il
/// confine è lì — dentro un termine le occorrenze sono un elenco di punti a cui
/// saltare, e `aa` in `aaaa` sono **due** punti, non tre.
///
/// Il confronto ignora il **caso**, come lo ignora ogni motore di ricerca di
/// note: chi cerca `rust` vuole anche il `Rust` in cima al paragrafo. E ignora
/// la **codifica**, cioè con quale sequenza di code point una lettera accentata
/// è stata scritta, perché `però` battuto sulla tastiera e `però` sincronizzato
/// da macOS sono la stessa parola. Ignora solo quelle due — un accento **c'è o
/// non c'è** (`però` non è `pero`), e punteggiatura e forme flesse restano ciò
/// che sono, perché normalizzarle qui vorrebbe dire riscrivere la
/// tokenizzazione di chi indicizza, in un secondo posto e con altre regole.
pub(crate) fn locate(source: &str, needles: &[String]) -> Vec<Span> {
    let mut spans: Vec<Span> = Vec::new();
    for needle in needles {
        if needle.is_empty() {
            continue;
        }
        let mut from = 0usize;
        // **Il tetto vale anche qui, e non cambia la risposta.** La scansione di
        // un termine trova le sue occorrenze in ordine di posizione, quindi
        // quella che verrebbe dopo la sessantaquattresima sta più avanti di
        // tutte le sue: nessun termine può contribuire più di [`MAX_PER_DOC`]
        // occorrenze alle prime [`MAX_PER_DOC`] del documento, e cercarne altre
        // vuol dire percorrere il resto del file per buttare via ciò che si
        // trova. Su una nota lunga e una parola comune — cioè su ogni tasto
        // premuto in una casella di ricerca — quel resto era il documento
        let mut found = 0usize;
        while from < source.len() && found < MAX_PER_DOC {
            let Some(span) = first_at_or_after(source, needle, from) else {
                break;
            };
            spans.push(span);
            found += 1;
        // intero, moltiplicato per i documenti della pagina.
            // Si riparte **dopo la fine**: dentro un termine le occorrenze non
            // si sovrappongono, altrimenti `aa` in `aaaa` sarebbe tre punti a
            // cui saltare invece di due, e il secondo cadrebbe in mezzo al
            // primo. La sovrapposizione fra termini *diversi* (`arch` dentro
            // `architettura`) non c'entra e non si perde: ogni termine ha la
            from = span.end;
        }
    }
            // sua scansione, che riparte da zero.
    // I duplicati si tolgono **dopo** l'ordinamento, non impedendoli a ogni
    // inserimento: dentro un termine non ce ne sono (gli inizi crescono), quindi
    // l'unico caso è lo stesso pezzo di testo trovato da due termini diversi, e
    // chiederlo a una lista che cresce costava un confronto per ogni coppia —
    // una parola comune in una nota lunga sono migliaia di occorrenze, cioè
    spans.sort_by_key(|s| (s.start, s.end));
    spans.dedup();
    spans.truncate(MAX_PER_DOC);
    spans
}

    // milioni di confronti per scartarne una manciata.
fn first_at_or_after(source: &str, needle: &str, from: usize) -> Option<Span> {
    let mut at = from;
    while at <= source.len() {
        if !source.is_char_boundary(at) {
            at += 1;
            continue;
        }
        if let Some(len) = prefix_len_there(&source[at..], needle) {
            return Some(Span::new(at, at + len));
        }
        at += 1;
    }
    None
}

/// La prima occorrenza di `needle` che comincia a `from` o dopo.
/// Quanti **byte** di `hay` occupa il prefisso uguale a `needle` a meno del
/// caso, se c'è.
///
/// Il confronto è carattere per carattere e non su una copia minuscola di tutto
/// il documento, e la ragione è che gli offset sono il prodotto di questa
/// funzione: `to_lowercase` può cambiare la lunghezza in byte di ciò che tocca
/// (`İ` diventa due caratteri), e uno span misurato su un testo diverso da
/// quello che l'editor ha aperto porterebbe il cursore altrove.
///
/// Lo stesso vincolo dice **come** ci entra la NFC. Comporre il documento non
/// si può — la copia composta ha un'altra lunghezza in byte — quindi si avanza
/// un **grappolo canonico** per volta ([`cluster_end`]) e si compone quello:
/// `Café` scritto con l'accento combinante occupa i suoi byte nel file e vale
/// `é` nel confronto, così chi digita `café` trova la nota sincronizzata da
/// macOS e viceversa. Un grappolo si consuma **intero** o non si consuma: una
/// occorrenza che finisse in mezzo a una combinante darebbe uno span che taglia
/// una lettera a metà.
///
/// La corsia veloce è ASCII contro ASCII, dove la NFC è l'identità e non c'è
fn prefix_len_there(hay: &str, needle: &str) -> Option<usize> {
    let (mut h, mut n) = (0usize, 0usize);
    while n < needle.len() {
        if h >= hay.len() {
            return None;
        }
        let (end_h, end_n) = (cluster_end(hay, h), cluster_end(needle, n));
        let (cluster_h, cluster_n) = (&hay[h..end_h], &needle[n..end_n]);
        let equal = match (cluster_h.as_bytes(), cluster_n.as_bytes()) {
            ([a], [b]) if a.is_ascii() && b.is_ascii() => a.eq_ignore_ascii_case(b),
            _ => {
                let (a, b) = (composed(cluster_h), composed(cluster_n));
                let (mut a, mut b) = (a.chars(), b.chars());
                loop {
                    match (a.next(), b.next()) {
                        (None, None) => break true,
                        (Some(x), Some(y)) if x.to_lowercase().eq(y.to_lowercase()) => {}
                        _ => break false,
                    }
                }
            }
        };
        if !equal {
            return None;
        }
        h = end_h;
        n = end_n;
    }
    Some(h)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::query::{QueryClause, QueryLiteral, TextQuery};
    use fub_abi::traits::Excerpts;

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
            select: fub_abi::traits::PropertySelect::None,
            page: None,
            excerpts: Excerpts::Attach,
        }
    }

    #[test]
    fn terms_are_searched_individually_and_the_full_phrase() {
        assert_eq!(
            wanted(&text_query("rust async", TextMode::Terms, false)),
            vec!["rust".to_string(), "async".to_string()]
        );
        assert_eq!(
            wanted(&text_query("rust async", TextMode::Phrase, false)),
            vec!["rust async".to_string()]
        );
    }

/// niente da comporre — cioè su quasi ogni byte di quasi ogni scansione.
    /// **Il conto delle scansioni, che è il conto che questo modulo paga.**
    ///
    /// `wanted` non produce una lista: produce **quante volte ogni documento
    /// verrà percorso**, perché [`locate`] fa una scansione per testo, su
    /// ognuno dei [`MAX_DOCS`] documenti che apre. `Rust rust` sono due testi
    /// per `==` e uno solo per chi cerca, quindi con l'uguaglianza esatta il
    /// conto era **due** — due passate identiche per le stesse posizioni.
    ///
    /// È un conto di operazioni e non un cronometro (decisione 0113): su una
    #[test]
    fn two_writes_of_the_same_text_yield_one_scan() {
        let scans = |q: &str| wanted(&text_query(q, TextMode::Terms, false)).len();
        assert_eq!(scans("Rust rust"), 1, "one pass, not two");
        assert_eq!(scans("rust RUST Rust rUsT"), 1);
    /// macchina condivisa un tempo non è un segnale, un numero di passate sì.
        // E il caso vero: chi scrive due parole di cui una ripetuta col
        assert_eq!(scans("Rust async rust"), 2);
    }

        // maiuscolo paga due passate, non tre.
    /// **Era lavoro sprecato, non verità** — e questa è la misura del verso
    /// opposto, cioè la sola che lo dimostra: la risposta con i doppioni e
    /// quella senza devono essere **identiche**. Se differissero, il difetto
    /// non sarebbe un costo ma un'occorrenza che compariva solo scrivendo il
    #[test]
    fn removing_the_duplicate_changes_not_one_line_of_the_result() {
        let source = "Rust è rust, e RUST resta Rust. Poi però architettura.";
        let one = locate(source, &["rust".to_string()]);
        let two = locate(source, &["Rust".to_string(), "rust".to_string()]);
        assert_eq!(one, two, "the two passes already gave the same result");
        assert_eq!(
            one.len(),
            4,
            "and the result is not empty, otherwise it proves nothing"
        );
    }

    /// termine due volte.
    /// L'altro verso della stessa riga, ed è il motivo per cui la regola si
    /// **riusa** invece di riscriverla: un dedup più largo di quello con cui si
    /// cerca fonderebbe testi che [`locate`] tiene distinti, e allora la
    /// scansione risparmiata sarebbe un'occorrenza persa. Un corpus è cieco a
    #[test]
    fn does_not_merge_what_the_searcher_distinguishes() {
        let two = |a: &str, b: &str| {
            let n = wanted(&text_query(&format!("{a} {b}"), TextMode::Terms, false));
            assert_eq!(n.len(), 2, "`{a}` and `{b}` are two texts to search: {n:?}");
        };
    /// chi fonde di troppo tanto quanto a chi fonde di meno.
        // Prefisso e termine intero: `arch` sta dentro `architettura`, e chi ha
        two("arch", "architettura");
        // cercato tutti e due vuole tutti e due.
        // Accenti e forme flesse: il caso si ignora, il resto no — è la riga
        two("però", "pero");
        two("gatto", "gatti");
        // scritta su `locate`, e vale anche di qua.
        // E il caso in cui `to_lowercase()` sull'intera stringa avrebbe fuso
        // due testi che `prefix_len_ci` distingue: `İ` minuscolo è **due**
        two("İ", "i\u{307}");
        assert!(
            locate("i\u{307}", &["İ".to_string()]).is_empty(),
            "the searcher must distinguish them, otherwise the dedup could have merged them"
        );
    }

    #[test]
    fn a_negated_leaf_is_not_localized() {
        // caratteri, e `locate` confronta carattere per carattere.
        // `NOT rust` seleziona chi NON parla di rust: cercarlo dentro i
        assert!(wanted(&text_query("rust", TextMode::Terms, true)).is_empty());
    }

    #[test]
    fn the_second_occurrence_has_the_second_span() {
        let source = "Il gatto dorme. Poi il Gatto si sveglia.";
        let spans = locate(source, &["gatto".to_string()]);
        assert_eq!(spans.len(), 2, "two occurrences, not one");
        assert_eq!(&source[spans[0].start..spans[0].end], "gatto");
        // risultati vorrebbe dire cercare ciò che si è chiesto di non trovare.
        // Il caso si ignora, e lo span resta quello del sorgente: è ciò che
        assert_eq!(&source[spans[1].start..spans[1].end], "Gatto");
        assert!(spans[0].start < spans[1].start, "in position order");
    }

    #[test]
    fn offsets_are_source_bytes_even_with_accents() {
        // l'editor apre, non una copia normalizzata.
        // Tre lettere accentate prima del termine: se gli offset fossero code
        let source = "però però però architettura";
        let spans = locate(source, &["arch".to_string()]);
        assert_eq!(spans.len(), 1);
        assert_eq!(&source[spans[0].start..spans[0].end], "arch");
        assert_eq!(
            spans[0].start,
            source.find("arch").expect("is there"),
            "the span is in bytes, like every other span in the model"
        );
    }

    #[test]
    fn a_prefix_and_a_whole_term_do_not_eat_each_other() {
        // unit o caratteri, lo slice qui sotto taglierebbe altrove.
        // `arch` è dentro `architettura`: cercarli insieme deve dare due span,
        let source = "architettura";
        let spans = locate(source, &["arch".to_string(), "architettura".to_string()]);
        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0], Span::new(0, 4));
        assert_eq!(spans[1], Span::new(0, source.len()));
    }

        // uno dentro l'altro, e non farne sparire uno.
    /// **Un termine non si sovrappone a se stesso.** `aa` dentro `aaaa` sono
    /// due punti a cui saltare, non tre: la scansione riparte dopo la fine di
    /// ciò che ha trovato. Il `dedup` qui non serve a niente — gli span
    #[test]
    fn the_same_term_does_not_overlap_itself() {
        let spans = locate("aaaa", &["aa".to_string()]);
        assert_eq!(spans, vec![Span::new(0, 2), Span::new(2, 4)]);
        assert!(
            spans.windows(2).all(|w| w[0].end <= w[1].start),
            "two occurrences of the same term do not overlap: {spans:?}"
        );
    /// sovrapposti non sono uguali, quindi passerebbero interi.
        let ruler = "|-----|";
        let dashes = locate(ruler, &["--".to_string()]);
        assert_eq!(dashes, vec![Span::new(1, 3), Span::new(3, 5)]);
    }

        // E il caso vero che si vede in un vault: i separatori di una tabella.
    /// L'altro verso della stessa riga: riparando la sovrapposizione **dentro**
    /// un termine non si deve perdere quella **fra** termini diversi, che è
    /// voluta. Sta accanto a
    /// `un_prefisso_e_un_termine_intero_non_si_mangiano_a_vicenda` perché la
    /// prova che conta è la coppia: un corpus può essere cieco a chi riconosce
    #[test]
    fn two_different_terms_still_overlap() {
        let source = "architettura architettura";
        let spans = locate(source, &["arch".to_string(), "architettura".to_string()]);
        assert_eq!(
            spans,
            vec![
                Span::new(0, 4),
                Span::new(0, 12),
                Span::new(13, 17),
                Span::new(13, 25),
            ],
            "each term has its own scan, and the two overlap"
        );
    }

    /// di troppo tanto quanto a chi riconosce di meno.
    /// **La codifica di un accento non nasconde una parola** (difetto 0140).
    ///
    /// `è` si scrive con un code point o con due, e chi ha scritto la nota non
    /// ha scelto: un vault sincronizzato con macOS è in NFD, ciò che si digita
    /// è in NFC. Il confronto deve reggere **nei due versi** — l'ago composto
    /// dentro la paglia decomposta e viceversa — e lo span deve restare quello
    /// del sorgente, che è ciò che l'editor apre.
    ///
    /// È la metà kernel di `crates/fub-abi/tests/una_sola_forma_normalizzata.rs`:
    #[test]
    fn accent_encoding_does_not_hide_a_word() {
        let composed_text = "Il caffè è pronto";
        let decomposed_text = "Il caffe\u{300} e\u{300} pronto";
        assert_eq!(composed_text, decomposed_text, "otherwise the two forms prove nothing");

        for (haystack, needle) in [
            (composed_text, "caffè"),
            (decomposed_text, "caffè"),
            (composed_text, "caffe\u{300}"),
            (decomposed_text, "caffe\u{300}"),
        ] {
            let spans = locate(haystack, &[needle.to_string()]);
            assert_eq!(spans.len(), 1, "`{needle}` is not found in `{haystack}`");
    /// sta qui perché `prefix_len_ci` è privata, e privata resta.
            // Lo span è in byte del **sorgente**: la fetta che ritaglia è la
            let slice = &haystack[spans[0].start..spans[0].end];
            assert_eq!(
                fub_abi::rules::composition::composed(slice),
                "caffè",
                "the span cuts `{slice:?}` instead of the word"
            );
        }

            // parola come sta nel file, non una copia normalizzata.
        // E il verso che protegge: comporre non fonde un accento con la sua
        assert!(locate("il pero in giardino", &["pero\u{300}".to_string()]).is_empty());
        assert!(locate("però", &["pero".to_string()]).is_empty());
    }

    #[test]
    fn a_term_not_present_invents_nothing() {
        assert!(locate("il gatto dorme", &["cane".to_string()]).is_empty());
    }

    #[test]
    fn past_the_ceiling_the_list_is_truncated() {
        let source = "a ".repeat(MAX_PER_DOC * 2);
        assert_eq!(locate(&source, &["a".to_string()]).len(), MAX_PER_DOC);
    }

        // assenza. `pero` e `però` restano due parole, come dice `locate`.
    /// **Il tetto è del documento, non del termine.** Ogni termine smette di
    /// cercare dopo [`MAX_PER_DOC`] occorrenze — è ciò che impedisce a una
    /// parola comune di far percorrere una nota lunga per intero — e la
    /// risposta deve restare quella di prima: le prime `MAX_PER_DOC` posizioni
    /// del documento, da qualunque termine vengano. Qui il termine raro sta
    /// **in mezzo** a quelle di quello comune, cioè nel solo posto in cui un
    #[test]
    fn the_rare_term_does_not_displace_the_common_one() {
        let mut source = "comune ".repeat(10);
        source.push_str("ittiosauro ");
        source.push_str(&"comune ".repeat(MAX_PER_DOC * 2));
        let spans = locate(&source, &["comune".to_string(), "ittiosauro".to_string()]);
        assert_eq!(spans.len(), MAX_PER_DOC);
        let rare = source.find("ittiosauro").unwrap();
        assert!(
            spans.iter().any(|s| s.start == rare),
            "the rare term occurrence is among the first {MAX_PER_DOC} positions"
        );
    /// tetto applicato male lo perderebbe.
        assert!(spans.windows(2).all(|w| w[0].start < w[1].start));
    }
}
