//! Modificare **un pezzo** di documento: l'edit come primitiva del contratto.
//!
//! Fino a qui l'unico modo di cambiare un documento era
//! [`VaultWrite::write_document`](crate::traits::VaultWrite::write_document), cioè
//! riscrivere il file intero. Funziona per chi il file intero ce l'ha in mano —
//! l'editor che salva il proprio buffer, un importer che crea una nota — e non
//! funziona per nessun altro: spuntare un task (10.1), scrivere una proprietà
//! (8.2), correggere un link rotto (7.2), inserire un template col cursore dove
//! serve (16.1), riscrivere la selezione (22.2), accettare una modifica
//! suggerita (19.2). Tutte queste, senza una primitiva, fanno la stessa cosa:
//! leggono tutto, ricompongono tutto, riscrivono tutto. E **non si compongono**
//! — due automazioni che riscrivono lo stesso documento si sovrascrivono a
//! vicenda, e chi perde non lo sa.
//!
//! # La firma dice su cosa si applica
//!
//! Un edit è una coppia (dove, cosa): [`TextEdit`]. Ma una lista di edit senza
//! altro non è una modifica applicabile, è un'ipotesi: gli offset valgono per
//! **un** testo, e fra il momento in cui sono stati calcolati e quello in cui si
//! applicano il documento può essere cambiato. Per questo l'unità che attraversa
//! il confine è [`EditRequest`], che porta la [`Revision`] su cui gli edit sono
//! stati calcolati, e **non è opzionale**: un edit senza base è esattamente la
//! corsa che questa primitiva esiste per rendere visibile. Se la base non è più
//! quella, l'host risponde [`PluginError::Conflict`] e non scrive niente — chi
//! ha calcolato ricalcola.
//!
//! # La revisione è opaca
//!
//! Di una [`Revision`] è contratto **solo l'uguaglianza**. Non è un numero
//! d'ordine (non si confronta con `<`), non è un contenuto (non ci si legge
//! dentro), e come l'host la deriva non è promesso a nessuno: un host che
//! usasse un digest, un contatore o `mtime+size` sarebbe conforme uguale. Chi
//! deve prepararla la **chiede**
//! ([`VaultRead::document_revision`](crate::traits::VaultRead::document_revision));
//! [`Revision::of`] è come la deriva *questo* host — sta qui perché il kernel e
//! i doppi dei test ne abbiano una sola implementazione, non perché un provider
//! debba ricalcolarla per conto proprio.
//!
//! # Coordinate, e la disciplina che l'host applica
//!
//! Ogni [`Span`] della richiesta è in byte UTF-8 **del sorgente della base**, e
//! non nel testo che si sta via via producendo: gli edit sono un insieme, non
//! una sequenza di passi, e chi li calcola non deve tenere il conto degli
//! spostamenti. L'host li ordina, ne verifica la disciplina — dentro il
//! sorgente, su confini di carattere e di terminatore di riga, senza
//! sovrapposizioni e senza due edit nello stesso punto — e li applica in un
//! colpo solo. Ciò che non rispetta la disciplina è [`PluginError::BadArgs`],
//! non un edit applicato a metà.
//!
//! Cosa *sia* quel sorgente è scritto accanto a [`Span`]: i byte del file
//! decodificati, integralmente, BOM e terminatori compresi. Non è un dettaglio
//! di implementazione dell'host — è la premessa senza la quale un offset
//! calcolato da un provider e un offset applicato dall'host non sono lo stesso
//! numero.
//!
//! # Il confine di un `\r\n`
//!
//! `\r` e `\n` sono due caratteri ASCII, quindi l'offset che sta **fra** loro è
//! un confine di carattere valido e `is_char_boundary` lo accetta. Un edit che
//! ci finisce sopra spezza un terminatore di riga in due e lascia un `\r`
//! orfano: il file resta UTF-8 valido, e una riga che nessuno aveva nominato è
//! cambiata — che è esattamente ciò che «nessuna modifica fuori dallo span
//! dichiarato» (§2.4) vieta. Un `\r\n` è un terminatore solo, e i suoi due byte
//! non si separano più di quanto si separino i due byte di una `à`: la regola è
//! [`text_policy::splits_newline`](crate::rules::text_policy::splits_newline) e
//! il rifiuto è `BadArgs` come per il carattere tagliato a metà.
//!
//! # Il rapporto è nelle coordinate nuove, e l'inverso di un edit è un edit
//!
//! [`EditReport`] dice dov'è finito ciò che è stato scritto (le coordinate
//! servono a chi deve poi mettere il cursore: 16.1) e **cosa c'era prima**.
//! Sono i due pezzi con cui [`EditReport::inverse`] costruisce la modifica che
//! riporta il documento com'era: una [`EditRequest`] come le altre. Non è l'undo
//! (di chi sia la proprietà dell'undo è il §13.3 del piano, e non lo decide
//! questa firma): è la *forma* senza la quale quella decisione nascerebbe già
//! zoppa.
//!
//! # Cosa resta deliberatamente fuori
//!
//! - **Il lotto su più documenti** (decisione 0011): una richiesta nomina un documento
//!   solo, e N documenti sono N scritture con N eventi. Il lotto è una lista di
//!   edit *sopra* questa firma, non una firma diversa.
//! - **L'edit sull'evento** (decisione 0012): chi riceve `DocumentChanged` sa che il
//!   documento è cambiato, non *come*. Finché è così, una shell che ha il
//!   documento aperto non può applicare al proprio buffer la modifica che il
//!   kernel ha appena fatto — deve ricaricare, e ricaricare costa il cursore.
//! - **La fusione di due edit concorrenti** (18.1): qui il conflitto si
//!   **dichiara**, non si risolve. Un CRDT, se arriverà, avrà bisogno di questa
//!   forma per esprimersi; il contrario non è vero.

use serde::{Deserialize, Serialize};

use crate::error::PluginError;
use crate::model::Span;
use crate::rules::text_policy;

/// L'identità del sorgente su cui un edit è stato calcolato.
///
/// Opaca: solo l'uguaglianza è contratto (vedi il doc del modulo). La si ottiene
/// dall'host ([`VaultRead::document_revision`](crate::traits::VaultRead::document_revision));
/// [`Revision::of`] è la derivazione di *questo* host, non una promessa del
/// confine.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Revision(pub String);

impl Revision {
    pub fn new(raw: impl Into<String>) -> Self {
        Revision(raw.into())
    }

    /// L'impronta di un sorgente, come la deriva questo host: FNV-1a a 64 bit
    /// in esadecimale, la stessa famiglia di impronte stabili fra piattaforme
    /// che usano l'indice di ricerca e il versioning.
    ///
    /// È **contenuto**, non tempo né ordine, e la differenza si vede in un caso
    /// vero: chi scrive un carattere e lo cancella riporta il documento al testo
    /// di prima, e un edit calcolato allora è ancora valido adesso — un
    /// contatore direbbe di no e farebbe ricalcolare per niente.
    ///
    /// La forma della stringa non è contratto: chi la confronta con una sua
    /// dipende da questo host, e ciò che il confine promette è solo che due
    /// revisioni uguali sono lo stesso sorgente.
    pub fn of(source: &str) -> Self {
        Revision::of_bytes(source.as_bytes())
    }

    /// La stessa impronta, presa sui byte.
    ///
    /// Serve a chi ha una sorgente che **non è testo**: un documento che il suo
    /// provider vuole a byte ([`SourceKind::Bytes`](crate::format::SourceKind))
    /// non si può decodificare per prenderne l'impronta, e non deve — chi
    /// indicizza confronta impronte, non testi. Per una sorgente UTF-8 le due
    /// funzioni danno lo stesso valore, che è la ragione per cui è la stessa
    /// famiglia e non una seconda: un documento non cambia impronta il giorno
    /// che qualcuno lo rivendica a byte.
    pub fn of_bytes(source: &[u8]) -> Self {
        const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
        const PRIME: u64 = 0x0000_0100_0000_01b3;
        let mut h = OFFSET;
        for b in source {
            h ^= *b as u64;
            h = h.wrapping_mul(PRIME);
        }
        Revision(format!("{h:016x}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for Revision {
    /// La revisione del documento vuoto: è la base con cui si scrive dentro una
    /// nota appena creata, non un segnaposto da riempire.
    fn default() -> Self {
        Revision::of("")
    }
}

/// Una sostituzione: i byte dentro `span` diventano `text`.
///
/// Le tre operazioni sono la stessa cosa vista da tre parti: inserire è uno span
/// vuoto, cancellare è un testo vuoto, sostituire è nessuno dei due. Un enum a
/// tre casi avrebbe costretto ogni consumatore a distinguerle per poi trattarle
/// uguali.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextEdit {
    /// Dove, in **byte UTF-8 del sorgente della base** — mai del testo in corso
    /// di produzione.
    pub span: Span,
    pub text: String,
}

impl TextEdit {
    pub fn replace(span: Span, text: impl Into<String>) -> Self {
        TextEdit {
            span,
            text: text.into(),
        }
    }

    /// Inserisce a `at` senza togliere niente.
    pub fn insert(at: usize, text: impl Into<String>) -> Self {
        TextEdit {
            span: Span::new(at, at),
            text: text.into(),
        }
    }

    /// Toglie i byte di `span` senza metterci niente.
    pub fn delete(span: Span) -> Self {
        TextEdit {
            span,
            text: String::new(),
        }
    }
}

/// Una modifica chirurgica a un documento: gli edit, e il sorgente su cui sono
/// stati calcolati.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditRequest {
    /// La revisione del sorgente in cui gli `span` degli edit sono veri. Non è
    /// opzionale: vedi il doc del modulo.
    pub base: Revision,
    /// Un insieme, non una sequenza: l'ordine in cui li si elenca non conta, e
    /// due edit non possono contendersi lo stesso punto.
    pub edits: Vec<TextEdit>,
}

impl EditRequest {
    pub fn new(base: Revision, edits: Vec<TextEdit>) -> Self {
        EditRequest { base, edits }
    }

    /// Applica la richiesta a `source`, restituendo il testo nuovo e il rapporto.
    ///
    /// È qui, e non nei chiamanti, che la base viene verificata: un host che
    /// dovesse ricordarsi di controllarla prima di chiamare, prima o poi non se
    /// lo ricorderebbe. Non scrive niente e non conosce il vault — è la parte
    /// pura dell'operazione, condivisa fra il kernel e i doppi dei test.
    ///
    /// `Err(Conflict)` = il sorgente non è più quello su cui gli edit sono stati
    /// calcolati; `Err(BadArgs)` = gli edit non rispettano la disciplina (fuori
    /// dal sorgente, a metà di un carattere, sovrapposti, o due nello stesso
    /// punto). In entrambi i casi non c'è un risultato parziale.
    pub fn apply_to(&self, source: &str) -> Result<(String, EditReport), PluginError> {
        let current = Revision::of(source);
        if current != self.base {
            return Err(PluginError::Conflict(
                format!(
                    "il sorgente è cambiato: l'edit è stato calcolato su {}, ora è {}",
                    self.base.as_str(),
                    current.as_str()
                )
                .into(),
            ));
        }

        let mut ordered: Vec<&TextEdit> = self.edits.iter().collect();
        ordered.sort_by_key(|e| e.span.start);
        let mut previous: Option<Span> = None;
        for edit in &ordered {
            let span = edit.span;
            if span.start > span.end {
                return Err(PluginError::BadArgs(
                    format!("span rovesciato: {}..{}", span.start, span.end).into(),
                ));
            }
            if span.end > source.len() {
                return Err(PluginError::BadArgs(
                    format!(
                        "span fuori dal sorgente: {}..{} su {} byte",
                        span.start,
                        span.end,
                        source.len()
                    )
                    .into(),
                ));
            }
            if !source.is_char_boundary(span.start) || !source.is_char_boundary(span.end) {
                // Tagliare un carattere UTF-8 a metà non produce un documento
                // sbagliato: produce byte che non sono testo, e il documento
                // non si riapre più.
                return Err(PluginError::BadArgs(
                    format!("span a metà di un carattere: {}..{}", span.start, span.end).into(),
                ));
            }
            if text_policy::splits_newline(source, span.start)
                || text_policy::splits_newline(source, span.end)
            {
                // L'altro confine, quello che `is_char_boundary` non vede: fra
                // il `\r` e il `\n` di una coppia. Qui non si perde la validità
                // del testo, si perde una riga che nessuno aveva nominato — e
                // in silenzio, perché il file resta perfettamente leggibile.
                return Err(PluginError::BadArgs(
                    format!(
                        "span a metà di un terminatore di riga: {}..{}",
                        span.start, span.end
                    )
                    .into(),
                ));
            }
            if let Some(prev) = previous {
                if span.start < prev.end {
                    return Err(PluginError::BadArgs(
                        format!(
                            "edit sovrapposti: {}..{} e {}..{}",
                            prev.start, prev.end, span.start, span.end
                        )
                        .into(),
                    ));
                }
                if span.start == prev.start {
                    // Due edit che cominciano nello stesso punto (tipicamente
                    // due inserimenti) hanno un esito che dipende dall'ordine, e
                    // l'ordine qui non è dato: chi vuole due cose in un punto
                    // solo scrive un edit solo.
                    return Err(PluginError::BadArgs(
                        format!("due edit nello stesso punto: {}", span.start).into(),
                    ));
                }
            }
            previous = Some(span);
        }

        let mut out = String::with_capacity(source.len());
        let mut applied = Vec::with_capacity(ordered.len());
        let mut pos = 0usize;
        for edit in ordered {
            out.push_str(&source[pos..edit.span.start]);
            let start = out.len();
            out.push_str(&edit.text);
            applied.push(AppliedEdit {
                span: Span::new(start, out.len()),
                replaced: source[edit.span.start..edit.span.end].to_string(),
            });
            pos = edit.span.end;
        }
        out.push_str(&source[pos..]);

        let report = EditReport {
            revision: Revision::of(&out),
            applied,
        };
        Ok((out, report))
    }
}

/// Un edit applicato: dov'è finito nel testo **nuovo**, e cosa c'era prima.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppliedEdit {
    /// Il testo inserito, nelle coordinate del sorgente **dopo** la modifica.
    /// Vuoto (`start == end`) quando l'edit ha solo cancellato.
    pub span: Span,
    /// I byte che c'erano al suo posto. Vuoto quando l'edit ha solo inserito.
    pub replaced: String,
}

/// L'esito di una modifica chirurgica: la revisione nuova e cosa è stato fatto.
///
/// La revisione nuova non è un di più: è ciò che permette di concatenare un
/// secondo edit senza rileggere il documento — e senza rileggerlo *sperando*
/// che nel frattempo non sia cambiato.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditReport {
    pub revision: Revision,
    /// In ordine di documento, qualunque fosse l'ordine della richiesta.
    pub applied: Vec<AppliedEdit>,
}

impl EditReport {
    /// La modifica che riporta il documento com'era prima.
    ///
    /// Gli edit tornano già nelle coordinate del testo nuovo e restano
    /// disgiunti, quindi sono una richiesta come le altre: `base` è la revisione
    /// prodotta da questo rapporto, ed è il modo in cui un annullamento si
    /// accorge che qualcuno ha scritto nel frattempo, invece di cancellargli il
    /// lavoro.
    pub fn inverse(&self) -> EditRequest {
        let mut edits: Vec<TextEdit> = Vec::with_capacity(self.applied.len());
        for a in &self.applied {
            match edits.last_mut() {
                // Due edit applicati possono condividere il punto di partenza, e
                // succede appena uno di essi ha solo cancellato: nel testo nuovo
                // ciò che ha tolto non occupa spazio. I loro inversi quel punto
                // non possono condividerlo (sarebbero due edit nello stesso
                // punto) e non devono: là il documento ha una cosa sola da
                // riavere, ed è la somma delle due nell'ordine in cui stavano.
                Some(last) if last.span.start == a.span.start => {
                    last.span.end = last.span.end.max(a.span.end);
                    last.text.push_str(&a.replaced);
                }
                _ => edits.push(TextEdit {
                    span: a.span,
                    text: a.replaced.clone(),
                }),
            }
        }
        EditRequest {
            base: self.revision.clone(),
            edits,
        }
    }

    /// La modifica non ha toccato niente (nessun edit)?
    pub fn is_empty(&self) -> bool {
        self.applied.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(source: &str, edits: Vec<TextEdit>) -> EditRequest {
        EditRequest::new(Revision::of(source), edits)
    }

    #[test]
    fn the_edits_are_a_set_and_the_result_does_not_depend_on_their_order() {
        let source = "uno due tre";
        // Elencati al contrario: gli span sono nelle coordinate della base, e
        // chi li calcola non deve tenere il conto di quanto si è spostato il
        // testo per via degli altri.
        let req = request(
            source,
            vec![
                TextEdit::replace(Span::new(8, 11), "TRE"),
                TextEdit::replace(Span::new(0, 3), "UNO"),
            ],
        );
        let (out, report) = req.apply_to(source).unwrap();
        assert_eq!(out, "UNO due TRE");
        assert_eq!(
            report
                .applied
                .iter()
                .map(|a| (a.span.start, a.span.end, a.replaced.as_str()))
                .collect::<Vec<_>>(),
            vec![(0, 3, "uno"), (8, 11, "tre")],
            "il rapporto è in ordine di documento, non di richiesta"
        );
    }

    #[test]
    fn insert_and_delete_are_replace_seen_from_two_sides() {
        let source = "ab";
        let (out, report) = request(source, vec![TextEdit::insert(1, "-X-")])
            .apply_to(source)
            .unwrap();
        assert_eq!(out, "a-X-b");
        assert_eq!(report.applied[0].span, Span::new(1, 4));
        assert!(
            report.applied[0].replaced.is_empty(),
            "un inserimento non ha tolto niente"
        );

        let (out, report) = request(source, vec![TextEdit::delete(Span::new(0, 1))])
            .apply_to(source)
            .unwrap();
        assert_eq!(out, "b");
        assert_eq!(
            (report.applied[0].span, report.applied[0].replaced.as_str()),
            (Span::new(0, 0), "a"),
            "una cancellazione lascia uno span vuoto là dove il testo non c'è più"
        );
    }

    #[test]
    fn a_stale_base_is_a_conflict_and_produces_nothing() {
        let req = request("prima", vec![TextEdit::insert(0, "x")]);
        let err = req.apply_to("prima, poi altro").unwrap_err();
        assert!(
            matches!(err, PluginError::Conflict(_)),
            "una base che non combacia è un conflitto, non un `BadArgs`: {err:?}"
        );
    }

    #[test]
    fn the_discipline_of_the_spans_is_checked_before_anything_is_produced() {
        let source = "0123456789";
        let casi: Vec<(&str, Vec<TextEdit>)> = vec![
            (
                "fuori dal sorgente",
                vec![TextEdit::replace(Span::new(8, 12), "x")],
            ),
            ("rovesciato", vec![TextEdit::replace(Span::new(6, 3), "x")]),
            (
                "sovrapposti",
                vec![
                    TextEdit::replace(Span::new(0, 5), "a"),
                    TextEdit::replace(Span::new(3, 7), "b"),
                ],
            ),
            (
                "due nello stesso punto",
                vec![TextEdit::insert(2, "a"), TextEdit::insert(2, "b")],
            ),
        ];
        for (nome, edits) in casi {
            let err = request(source, edits).apply_to(source).unwrap_err();
            assert!(
                matches!(err, PluginError::BadArgs(_)),
                "{nome}: atteso BadArgs, ottenuto {err:?}"
            );
        }
    }

    #[test]
    fn a_span_in_the_middle_of_a_character_is_refused() {
        // "è" sono due byte: 1..2 è dentro il carattere.
        let source = "è vero";
        let err = request(source, vec![TextEdit::replace(Span::new(1, 2), "x")])
            .apply_to(source)
            .unwrap_err();
        assert!(
            matches!(err, PluginError::BadArgs(_)),
            "tagliare un carattere a metà non produce testo: {err:?}"
        );

        // Sul confine giusto, invece, si applica: gli span del modello sono in
        // byte, e i byte di un accento sono due.
        let (out, _) = request(source, vec![TextEdit::replace(Span::new(0, 2), "e")])
            .apply_to(source)
            .unwrap();
        assert_eq!(out, "e vero");
    }

    #[test]
    fn a_span_in_the_middle_of_a_line_ending_is_refused() {
        // Il caso ostile del §15.5: `\r` e `\n` sono due caratteri ASCII, quindi
        // l'offset fra loro passa `is_char_boundary` e il testo che ne uscirebbe
        // è UTF-8 valido. Ciò che si perde è una riga che nessuno ha nominato.
        let source = "prima\r\ndopo\r\n";
        let fra = source.find('\n').expect("c'è un \\n");
        assert!(
            source.is_char_boundary(fra),
            "per `str` è un confine valido"
        );

        for span in [Span::new(fra, source.len()), Span::new(0, fra)] {
            let err = request(source, vec![TextEdit::replace(span, "x")])
                .apply_to(source)
                .unwrap_err();
            assert!(
                matches!(err, PluginError::BadArgs(_)),
                "{span:?}: spezzare un `\\r\\n` non è un edit: {err:?}"
            );
        }

        // Il terminatore intero, invece, si sostituisce: è un edit che dichiara
        // di toccare la fine della riga, e la tocca tutta.
        let (out, _) = request(source, vec![TextEdit::replace(Span::new(5, 7), "\n")])
            .apply_to(source)
            .unwrap();
        assert_eq!(out, "prima\ndopo\r\n");
    }

    #[test]
    fn un_edit_su_un_file_crlf_non_ne_normalizza_le_altre_righe() {
        // La fedeltà del §2.4 vista dalla primitiva: chi modifica una parola in
        // un file CRLF lascia i terminatori dove sono, tutti.
        let source = "una\r\ndue\r\ntre\r\n";
        let inizio = source.find("due").expect("c'è `due`");
        let (out, report) = request(
            source,
            vec![TextEdit::replace(Span::new(inizio, inizio + 3), "seconda")],
        )
        .apply_to(source)
        .unwrap();
        assert_eq!(out, "una\r\nseconda\r\ntre\r\n");
        assert_eq!(
            text_policy::Newline::of(&out),
            text_policy::Newline::Crlf,
            "il file era CRLF e resta CRLF: nessuna riga fuori dallo span"
        );
        // E l'inverso riporta ai byte esatti di prima, terminatori compresi.
        let (tornato, _) = report.inverse().apply_to(&out).unwrap();
        assert_eq!(tornato, source);
    }

    #[test]
    fn no_edits_is_not_an_error_and_changes_nothing() {
        let source = "intatto";
        let (out, report) = request(source, vec![]).apply_to(source).unwrap();
        assert_eq!(out, source);
        assert!(report.is_empty());
        assert_eq!(
            report.revision,
            Revision::of(source),
            "senza edit la revisione resta quella di prima"
        );
    }

    #[test]
    fn the_inverse_of_an_edit_is_an_edit_that_puts_it_back() {
        let source = "# Titolo\n\nnota su [[Vecchia]] e altro.\n";
        let req = request(
            source,
            vec![
                TextEdit::replace(Span::new(20, 27), "Nuova"),
                TextEdit::insert(source.len(), "coda\n"),
            ],
        );
        let (nuovo, report) = req.apply_to(source).unwrap();
        assert!(nuovo.contains("[[Nuova]]") && nuovo.ends_with("coda\n"));

        let indietro = report.inverse();
        assert_eq!(
            indietro.base, report.revision,
            "l'inverso si applica al testo che il rapporto descrive"
        );
        let (tornato, _) = indietro.apply_to(&nuovo).unwrap();
        assert_eq!(tornato, source, "andata e ritorno, byte per byte");
    }

    #[test]
    fn the_inverse_survives_edits_that_collapse_onto_the_same_point() {
        // Due edit adiacenti di cui il primo cancella finiscono nel testo nuovo
        // **nello stesso punto**: ciò che è stato tolto lì non occupa spazio. I
        // loro inversi non possono stare tutti e due lì, e devono comunque
        // riportare il documento intero.
        let source = "abcdefghi";
        for edits in [
            vec![
                TextEdit::delete(Span::new(0, 5)),
                TextEdit::delete(Span::new(5, 8)),
            ],
            vec![TextEdit::delete(Span::new(0, 5)), TextEdit::insert(5, "X")],
        ] {
            let (nuovo, report) = request(source, edits).apply_to(source).unwrap();
            let (tornato, _) = report.inverse().apply_to(&nuovo).unwrap();
            assert_eq!(tornato, source, "da «{nuovo}» si deve tornare indietro");
        }
    }

    #[test]
    fn a_revision_is_content_not_time() {
        assert_eq!(Revision::of("uguale"), Revision::of("uguale"));
        assert_ne!(Revision::of("uguale"), Revision::of("diverso"));
        // Scrivere una lettera e cancellarla riporta il documento a com'era: un
        // edit calcolato allora vale ancora adesso.
        let req = request("testo", vec![TextEdit::insert(0, "x")]);
        assert!(req.apply_to("testo").is_ok());
    }

    #[test]
    fn a_request_survives_the_json_boundary() {
        let req = EditRequest::new(
            Revision::of("sorgente"),
            vec![TextEdit::replace(Span::new(1, 3), "ab")],
        );
        let json = serde_json::to_string(&req).unwrap();
        assert_eq!(serde_json::from_str::<EditRequest>(&json).unwrap(), req);

        let report = EditReport {
            revision: Revision::of("nuovo"),
            applied: vec![AppliedEdit {
                span: Span::new(1, 3),
                replaced: "xy".into(),
            }],
        };
        let json = serde_json::to_string(&report).unwrap();
        assert_eq!(serde_json::from_str::<EditReport>(&json).unwrap(), report);
    }
}
