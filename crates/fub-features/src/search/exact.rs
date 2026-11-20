//! Maiuscole esatte ed espressioni regolari: prima i candidati dall'indice,
//! poi la verifica sul testo memorizzato dei soli candidati.
//!
//! L'indice tokenizzato ha dimenticato maiuscole e punteggiatura, e la verità
//! per queste due domande resta il testo memorizzato. Rileggerlo tutto però
//! vuol dire un tetto sulle note del vault (2048), cioè niente maiuscole esatte
//! in un vault grande. Qui il testo si rilegge solo dove l'indice dice che
//! **può** combaciare, e la parola chiave è *può*: i candidati devono essere un
//! sovrainsieme esatto delle note giuste, o una nota giusta sparisce.
//!
//! # Perché è un sovrainsieme
//!
//! I campi di prosa usano il tokenizer `default` di tantivy: spezza dove
//! `char::is_alphanumeric` è falso, scarta i token da 40 byte in su e mette in
//! minuscolo carattere per carattere. Niente radici, niente accenti tolti.
//! Allora, se un letterale compare in un valore memorizzato, ogni suo token
//! **intero** (cioè con un carattere non alfanumerico ai due lati, dentro il
//! letterale o garantito dal confine) è un termine del campo di quel valore:
//! stesso testo, stessi tagli, stessa minuscola, stessa lunghezza. Un token che
//! tocca un bordo non garantito, invece, nel testo può continuare, e non dice
//! niente: si lascia fuori. Si lascia fuori anche l'ultimo token di una parola
//! ancora in corso di scrittura, e non diventa un prefisso: la parola intera del
//! testo può superare i 40 byte, e allora nell'indice non c'è.
//!
//! I tag non sono prosa: il campo è un termine unico per tag, uguale al valore
//! memorizzato. Lì si scorre il dizionario dei termini (sono pochi) con la
//! stessa espressione della verifica, e il risultato è esatto.
//!
//! Una parte senza token interi (un solo segno combinante, una parola da 40 byte
//! in su, una regex senza parole obbligatorie) non restringe niente; se non
//! restringe nessuna parte, si torna alla scansione intera, col suo tetto.
//! Un candidato in più costa una verifica, mai un risultato sbagliato: il
//! risultato è sempre quello della verifica, sul testo vero.

use std::collections::BTreeSet;

use regex_syntax::hir::{Class, Hir, HirKind, Look};
use tantivy::collector::{Count, DocSetCollector, TopDocs};
use tantivy::query::EmptyQuery;
use tantivy::{DocAddress, Searcher};

use super::*;

#[cfg(test)]
thread_local! {
    /// Solo nei test: la scansione intera di prima, senza candidati, per
    /// confrontarla con quella che li usa sullo stesso indice.
    pub(super) static FULL_SCAN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Ciò che una parte della domanda chiede di trovare tale e quale: il
/// letterale, e se ai due bordi il testo ha per forza un non-alfanumerico.
struct Literal {
    text: String,
    bounded_start: bool,
    bounded_end: bool,
}

impl SearchIndex {
    /// La foglia di testo con le maiuscole esatte, sui campi `stored`.
    ///
    /// Ogni parte è un letterale col suo confine ai lati, e il confine c'è solo
    /// dove la parte comincia o finisce con una lettera: attorno a un'emoji
    /// `\b` non c'è mai, e la frase non combaciava (vedi `words`). L'ultima
    /// parte, mentre si scrive, resta aperta in coda.
    pub(super) fn exact_text(
        &self,
        text: &TextQuery,
        stored: &[Field],
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        if text.text.len() > MAX_REGEX_BYTES {
            return Err(PluginError::BadArgs(
                "case-sensitive text exceeds 256 bytes".into(),
            ));
        }
        let parts: Vec<&str> = match text.mode {
            TextMode::Phrase => Some(text.text.trim())
                .filter(|phrase| !phrase.is_empty())
                .into_iter()
                .collect(),
            TextMode::Terms => words::words(&text.text),
        };
        if parts.is_empty() {
            return Ok(None);
        }
        let last = parts.len() - 1;
        let mut literals = Vec::with_capacity(parts.len());
        let mut expressions = Vec::with_capacity(parts.len());
        for (at, part) in parts.iter().enumerate() {
            let open = at == last && text.partial_last_term;
            let starts = part.chars().next().is_some_and(words::is_word_char);
            let ends = part.chars().next_back().is_some_and(words::is_word_char);
            let pattern = format!(
                "{}{}{}",
                if starts { words::BEFORE.as_str() } else { "" },
                regex::escape(part),
                if ends && !open {
                    words::AFTER.as_str()
                } else {
                    ""
                },
            );
            expressions.push(
                regex::Regex::new(&pattern)
                    .expect("escaped literal has a valid regular expression"),
            );
            // Il bordo è garantito quando c'è il confine, e quando la parte
            // comincia (o finisce) con un carattere che non è di parola, cioè
            // non alfanumerico: in entrambi i casi il token si taglia lì.
            literals.push(Literal {
                text: part.to_string(),
                bounded_start: true,
                bounded_end: !(open && ends),
            });
        }
        self.commit()?;
        let searcher = self.reader.searcher();
        let mut each: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        for (literal, check) in literals.iter().zip(&expressions) {
            if let Some(q) =
                self.candidates(&searcher, stored, std::slice::from_ref(literal), check)?
            {
                each.push((Occur::Must, q));
            }
        }
        let candidates = match each.len() {
            0 => None,
            1 => Some(each.pop().expect("ce n'è una").1),
            _ => Some(Box::new(BooleanQuery::new(each)) as Box<dyn Query>),
        };
        self.verify(&searcher, candidates, stored, |values| {
            expressions
                .iter()
                .all(|regex| values.iter().any(|value| regex.is_match(value)))
        })
    }

    /// La foglia regex: `regex` è già compilata da `pattern`, con le regole
    /// della ricerca; i candidati vengono dalle parole che **ogni** sua
    /// corrispondenza contiene (vedi [`required_literals`]).
    pub(super) fn exact_regex(
        &self,
        pattern: &str,
        regex: &regex::Regex,
        fields: &[TextField],
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        let stored = self.stored_fields(fields);
        let literals = required_literals(pattern);
        self.commit()?;
        let searcher = self.reader.searcher();
        let candidates = self.candidates(&searcher, &stored, &literals, regex)?;
        self.verify(&searcher, candidates, &stored, |values| {
            values.iter().any(|value| regex.is_match(value))
        })
    }

    /// I campi memorizzati che una foglia chiede; nessuno vuol dire tutti e
    /// quattro quelli di testo.
    fn stored_fields(&self, requested: &[TextField]) -> Vec<Field> {
        let fields = if requested.is_empty() {
            &ALL_TEXT_FIELDS[..]
        } else {
            requested
        };
        fields
            .iter()
            .map(|field| match field {
                TextField::Name => self.fields.page_name,
                TextField::Body => self.fields.body,
                TextField::Tags => self.fields.tags,
                TextField::Heading => self.fields.headings,
            })
            .collect()
    }

    /// Le note in cui un valore di `stored` può soddisfare `check`, che deve
    /// contenere tutti i `literals`. `None` se l'indice non sa restringere.
    ///
    /// Il valore che combacia sta in un campo solo: per un campo di prosa
    /// servono **tutti** i token interi nello stesso campo, per i tag uno dei
    /// termini che `check` accetta.
    fn candidates(
        &self,
        searcher: &Searcher,
        stored: &[Field],
        literals: &[Literal],
        check: &regex::Regex,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        #[cfg(test)]
        if FULL_SCAN.with(|it| it.get()) {
            return Ok(None);
        }
        let tags = self.fields.tags;
        let mut any: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        for &field in stored.iter().filter(|field| **field != tags) {
            let tokens = self.whole_tokens(field, literals)?;
            if tokens.is_empty() {
                return Ok(None);
            }
            let all: Vec<(Occur, Box<dyn Query>)> = tokens
                .iter()
                .map(|token| (Occur::Must, term_query(field, token)))
                .collect();
            any.push((Occur::Should, Box::new(BooleanQuery::new(all))));
        }
        if stored.contains(&tags) {
            for term in self.tag_terms(searcher, check)? {
                any.push((Occur::Should, term_query(tags, &term)));
            }
        }
        Ok(Some(match any.is_empty() {
            true => Box::new(EmptyQuery),
            false => Box::new(BooleanQuery::new(any)),
        }))
    }

    /// I token interi dei `literals` col tokenizer di `field` (vedi il modulo):
    /// quelli che nel testo, se il letterale c'è, sono per forza termini.
    fn whole_tokens(&self, field: Field, literals: &[Literal]) -> Result<Vec<String>, PluginError> {
        let mut analyzer = self
            .index
            .tokenizer_for_field(field)
            .map_err(|and| PluginError::Internal(reason(TOKENIZER, and)))?;
        let mut tokens: Vec<String> = Vec::new();
        for literal in literals {
            let mut stream = analyzer.token_stream(&literal.text);
            while let Some(token) = stream.next() {
                let open_start = !literal.bounded_start && token.offset_from == 0;
                let open_end = !literal.bounded_end && token.offset_to == literal.text.len();
                if !open_start && !open_end && !tokens.contains(&token.text) {
                    tokens.push(token.text.clone());
                }
            }
        }
        Ok(tokens)
    }

    /// I tag (termini esatti, uguali al valore memorizzato) che `check`
    /// accetta, da tutti i segmenti.
    fn tag_terms(
        &self,
        searcher: &Searcher,
        check: &regex::Regex,
    ) -> Result<BTreeSet<String>, PluginError> {
        let mut found = BTreeSet::new();
        for segment in searcher.segment_readers() {
            let inverted = segment
                .inverted_index(self.fields.tags)
                .map_err(|and| PluginError::Internal(reason(SEARCH, and)))?;
            let mut terms = inverted
                .terms()
                .stream()
                .map_err(|and| PluginError::Internal(reason(SEARCH, and)))?;
            while terms.advance() {
                if let Ok(term) = std::str::from_utf8(terms.key()) {
                    if check.is_match(term) {
                        found.insert(term.to_string());
                    }
                }
            }
        }
        Ok(found)
    }

    /// La verifica sul testo memorizzato, dei candidati o (senza) di tutto
    /// l'indice. Oltre ai tetti si rifiuta la domanda, mai una pagina parziale:
    /// il contratto di `Documents` non ha un modo di dire «questi e forse
    /// altri».
    ///
    /// Si legge una nota alla volta e si tiene solo il suo id: la memoria non
    /// cresce col testo letto.
    fn verify(
        &self,
        searcher: &Searcher,
        candidates: Option<Box<dyn Query>>,
        stored: &[Field],
        mut matches: impl FnMut(&[&str]) -> bool,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        let too_many = || PluginError::BadArgs(Text::key(SCAN_TOO_MANY));
        let addresses: Vec<DocAddress> = match candidates {
            None => {
                if searcher.num_docs() > MAX_SCAN_DOCS {
                    return Err(too_many());
                }
                searcher
                    .search(
                        &AllQuery,
                        &TopDocs::with_limit(MAX_SCAN_DOCS as usize).order_by_score(),
                    )
                    .map_err(|err| PluginError::Internal(reason(SEARCH, err)))?
                    .into_iter()
                    .map(|(_, address)| address)
                    .collect()
            }
            Some(candidates) => {
                let count = searcher
                    .search(&*candidates, &Count)
                    .map_err(|err| PluginError::Internal(reason(COUNT, err)))?;
                if count as u64 > MAX_SCAN_DOCS {
                    return Err(too_many());
                }
                let mut found: Vec<DocAddress> = searcher
                    .search(&*candidates, &DocSetCollector)
                    .map_err(|err| PluginError::Internal(reason(SEARCH, err)))?
                    .into_iter()
                    .collect();
                // Nell'ordine del deposito: i blocchi compressi si aprono una
                // volta sola.
                found.sort();
                found
            }
        };
        let mut docs = Vec::new();
        let mut scanned = 0usize;
        for address in addresses {
            let doc: TantivyDocument = searcher
                .doc(address)
                .map_err(|err| PluginError::Internal(reason(DOC_READ, err)))?;
            let Some(id) = doc.get_first(self.fields.doc_id).and_then(|v| v.as_str()) else {
                continue;
            };
            let mut values = Vec::new();
            for field in stored {
                values.extend(doc.get_all(*field).filter_map(|value| value.as_str()));
            }
            scanned = scanned.saturating_add(values.iter().map(|s| s.len()).sum::<usize>());
            if scanned > MAX_SCAN_BYTES {
                return Err(PluginError::BadArgs(Text::key(SCAN_TOO_LARGE)));
            }
            if matches(&values) {
                docs.push((Occur::Should, term_query(self.fields.doc_id, id)));
            }
        }
        Ok((!docs.is_empty()).then(|| Box::new(BooleanQuery::new(docs)) as Box<dyn Query>))
    }
}

/// Le stringhe che **ogni** corrispondenza di `pattern` contiene tali e
/// quali, lette dall'albero che il parser di `regex` ne fa con le stesse
/// regole della ricerca (righe multiple, Unicode, maiuscole esatte).
///
/// Si prende solo ciò che è certo: i letterali in sequenza, dentro un gruppo e
/// dentro una ripetizione che c'è almeno una volta. Un'alternativa, una classe
/// (anche `(?i)`, che fa di ogni lettera una classe), una ripetizione che può
/// mancare non danno niente. Poco o niente vuol dire più candidati, mai meno.
///
/// Il bordo di un letterale è garantito (il token lì si taglia) solo se gli
/// sta accanto un inizio o una fine di riga, o una classe che non ha nessun
/// carattere alfanumerico, come `\s` o `[ ,.]`. `\b` non basta: per `regex` un
/// numero come «²» non è un carattere di parola, per il tokenizer sì.
fn required_literals(pattern: &str) -> Vec<Literal> {
    let Ok(hir) = regex_syntax::ParserBuilder::new()
        .multi_line(true)
        .build()
        .parse(pattern)
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    collect_literals(&hir, &mut out);
    out
}

fn collect_literals(hir: &Hir, out: &mut Vec<Literal>) {
    match hir.kind() {
        HirKind::Literal(literal) => push_literal(out, &literal.0, false, false),
        HirKind::Capture(capture) => collect_literals(&capture.sub, out),
        HirKind::Repetition(repetition) if repetition.min >= 1 => {
            collect_literals(&repetition.sub, out)
        }
        HirKind::Concat(parts) => {
            // Due letterali vicini sono un letterale solo: `ab` contiene il
            // token intero che né `a` né `b` contengono da soli.
            let mut run: Vec<u8> = Vec::new();
            let mut run_bounded_start = false;
            for (at, part) in parts.iter().enumerate() {
                if let HirKind::Literal(literal) = part.kind() {
                    if run.is_empty() {
                        run_bounded_start = at > 0 && cuts_a_token(&parts[at - 1]);
                    }
                    run.extend_from_slice(&literal.0);
                    continue;
                }
                if !run.is_empty() {
                    let bounded_end = cuts_a_token(part);
                    push_literal(out, &run, run_bounded_start, bounded_end);
                    run.clear();
                }
                collect_literals(part, out);
            }
            if !run.is_empty() {
                push_literal(out, &run, run_bounded_start, false);
            }
        }
        _ => {}
    }
}

fn push_literal(out: &mut Vec<Literal>, bytes: &[u8], bounded_start: bool, bounded_end: bool) {
    if let Ok(text) = std::str::from_utf8(bytes) {
        out.push(Literal {
            text: text.to_string(),
            bounded_start,
            bounded_end,
        });
    }
}

/// Le classi più grandi di così non si controllano carattere per carattere:
/// vuol dire solo un bordo non garantito.
const MAX_CLASS_CHARS: u32 = 1 << 16;

/// `true` se ciò che `hir` legge (o l'ancora che segna) non è mai un carattere
/// alfanumerico, cioè il tokenizer lì taglia per forza.
fn cuts_a_token(hir: &Hir) -> bool {
    match hir.kind() {
        HirKind::Look(look) => matches!(
            look,
            Look::Start | Look::End | Look::StartLF | Look::EndLF | Look::StartCRLF | Look::EndCRLF
        ),
        HirKind::Class(Class::Unicode(class)) => {
            let size: u32 = class
                .ranges()
                .iter()
                .map(|range| u32::from(range.end()) - u32::from(range.start()) + 1)
                .sum();
            size <= MAX_CLASS_CHARS
                && class.ranges().iter().all(|range| {
                    (u32::from(range.start())..=u32::from(range.end()))
                        .filter_map(char::from_u32)
                        .all(|c| !c.is_alphanumeric())
                })
        }
        HirKind::Class(Class::Bytes(class)) => class.ranges().iter().all(|range| {
            (range.start()..=range.end()).all(|b| b.is_ascii() && !b.is_ascii_alphanumeric())
        }),
        HirKind::Repetition(repetition) => repetition.min >= 1 && cuts_a_token(&repetition.sub),
        HirKind::Capture(capture) => cuts_a_token(&capture.sub),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::required_literals;

    fn literals(pattern: &str) -> Vec<(String, bool, bool)> {
        required_literals(pattern)
            .into_iter()
            .map(|l| (l.text, l.bounded_start, l.bounded_end))
            .collect()
    }

    fn l(text: &str, start: bool, end: bool) -> (String, bool, bool) {
        (text.to_string(), start, end)
    }

    #[test]
    fn only_what_every_match_contains_is_required() {
        assert_eq!(
            literals(r"TASK\s+aperta"),
            [l("TASK", false, true), l("aperta", true, false)]
        );
        assert_eq!(
            literals(r"(foo)+ bar\.baz"),
            [l("foo", false, false), l(" bar.baz", false, false)]
        );
        assert!(literals(r"x?foo|bar").is_empty());
        assert!(literals(r"(?i)rust").is_empty());
        assert_eq!(literals(r"a*\bciao\b"), [l("ciao", false, false)]);
        assert_eq!(literals(r"[ab]c{2,}"), [l("c", false, false)]);
        assert_eq!(
            literals(r"^TASK[ \t]+aperta$"),
            [l("TASK", true, true), l("aperta", true, true)]
        );
        assert_eq!(literals(r"[^a]Rust"), [l("Rust", false, false)]);
        assert_eq!(literals(r"[²,]Rust"), [l("Rust", false, false)]);
    }
}
