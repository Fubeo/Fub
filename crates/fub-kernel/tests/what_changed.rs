//! **Un evento dice quale documento, e adesso anche cosa è cambiato** (§22.2,
//! [decisione 0069](../../../docs/decisions/README.md)).
//!
//! `DocumentChanged { id }` diceva che *quella* nota era cambiata e non cosa: chi
//! voleva sapere se era cambiato un tag doveva rileggere il modello e
//! confrontarlo con la copia che si era tenuto. È il conto più alto del capitolo
//! 16 di FEATURES — un'automazione su «la scadenza è cambiata» si svegliava a
//! ogni scrittura di ogni nota del suo soggetto — e si paga sull'evento più caldo
//! del contratto.
//!
//! Le prove sono scritte **in coppia** come quelle della
//! [0033](../../../docs/decisions/0184-eventi-accodati-e-job.md), e per la
//! stessa ragione: una che mostra il solo silenzio non distingue un filtro che
//! funziona da un handler mai chiamato.
//!
//! I due assi sono deliberatamente diversi e le prove li separano:
//!
//! 1. il **filtro** è per aspetto — chiuso dal contratto, e vive nella maschera;
//! 2. il **racconto** è per nome — quali chiavi, quali tag — e vive nell'evento,
//!    perché il diff che lo produce è già in mano a chi lo emette.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{DocChange, Event, EventKind, EventMask, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel, Frontmatter, Span, Tag};
use fub_abi::traits::{EventHandler, HostApi};
use fub_kernel::{FormatRegistry, Workspace};

/// Un formato minimo che produce **davvero** frontmatter e tag, perché senza di
/// loro questa voce non si può provare: `SampleText` mette tutto in `text`, e
/// contro di lui ogni scrittura sarebbe un solo `Body`.
///
/// Sintassi: `@key value` è una proprietà, una parola che comincia per `#`
/// è un tag, il resto è corpo.
struct MetadataFormat;

impl FormatProvider for MetadataFormat {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("test.meta", "With metadata", &["txt"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let text = source.text().unwrap_or_default().to_string();
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        let mut fm = serde_json::Map::new();
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix('@') {
                let (key, value) = rest.split_once(' ').unwrap_or((rest, ""));
                fm.insert(key.to_string(), serde_json::json!(value));
            }
            for word in line.split_whitespace() {
                if let Some(name) = word.strip_prefix('#') {
                    model.tags.push(Tag {
                        name: name.to_string(),
                        span: Span::EMPTY,
                    });
                }
            }
        }
        model.frontmatter = Frontmatter(fm);
        model.text = text;
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

type Log = Arc<Mutex<Vec<String>>>;

/// Scrive **cosa** è arrivato, non solo che è arrivato: è la differenza che
/// questa voce introduce, e una spia che registrasse il solo id non la vedrebbe.
struct Spy {
    mask: EventMask,
    log: Log,
}

impl EventHandler for Spy {
    fn subscribed(&self) -> EventMask {
        self.mask.clone()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        if let Event::DocumentChanged { id, changes } = &notice.event {
            let detail = match changes {
                None => "?".to_string(),
                Some(c) => {
                    let mut parts: Vec<String> =
                        c.aspects.iter().map(|a| format!("{a:?}")).collect();
                    if !c.properties.is_empty() {
                        parts.push(format!("prop={}", c.properties.join("+")));
                    }
                    if !c.tags_added.is_empty() {
                        parts.push(format!("tag+={}", c.tags_added.join("+")));
                    }
                    if !c.tags_removed.is_empty() {
                        parts.push(format!("tag-={}", c.tags_removed.join("+")));
                    }
                    parts.join(",")
                }
            };
            self.log.lock().unwrap().push(format!("{id} {detail}"));
        }
        Ok(())
    }
}

const SPY: &str = "test.spy";

fn vault(mask: EventMask) -> (tempfile::TempDir, Workspace, Log) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(MetadataFormat)).expect("format");
    let mut ws = Workspace::new(&root, registry).expect("the vault opens");
    ws.register_core_feature(SPY, SPY).expect("declared");
    let log: Log = Arc::default();
    ws.register_event_handler(
        SPY,
        Box::new(Spy {
            mask,
            log: log.clone(),
        }),
    )
    .expect("registered");
    (dir, ws, log)
}

fn lines(log: &Log) -> Vec<String> {
    log.lock().unwrap().clone()
}

/// Un documento che **nasce** non ha un prima, e per lui tutto è nuovo.
///
/// Non è una comodità: chi si è abbonato ai cambi di tag vuole sapere della nota
/// che nasce già con un tag, e la risposta opposta — «niente è cambiato, non
/// c'era niente prima» — gliela farebbe perdere.
#[test]
fn a_document_that_is_born_has_changed_in_every_way() {
    let (_dir, mut ws, log) = vault(EventMask::of([EventKind::DocumentChanged]));
    ws.write_document(
        &DocId::new("a.txt"),
        "@deadline tomorrow\n#urgent\ncorpus",
        WriteBase::Dictated,
    )
    .unwrap();
    let r = lines(&log);
    assert_eq!(r.len(), 1);
    for aspect in ["Body", "Frontmatter", "Tags", "Links", "Outline", "Anchors"] {
        assert!(
            r[0].contains(aspect),
            "a note that is born changed everything, and {aspect} is missing from: {r:?}"
        );
    }
}

/// Il **racconto**: quali chiavi e quali tag, senza rileggere niente.
///
/// È la metà della voce che non passa dalla maschera, ed è quella che toglie il
/// conto vero: chi si sveglia sa già se lo riguardava.
/// conto vero: chi si sveglia sa già se lo riguardava.
/// conto vero: chi si sveglia sa già se lo riguardava.
#[test]
fn the_event_names_which_properties_and_which_tags() {
    let (_dir, mut ws, log) = vault(EventMask::of([EventKind::DocumentChanged]));
    let id = DocId::new("a.txt");
    ws.write_document(
        &id,
        "@deadline monday\n@state open\n#urgent\ncorpus",
        WriteBase::Dictated,
    )
    .unwrap();
    // Cambia UNA proprietà, toglie un tag, ne aggiunge un altro. Il corpo
    // cambia per forza, perché è lo stesso file.
    ws.write_document(
        &id,
        "@deadline tuesday\n@state open\n#home\ncorpus",
        WriteBase::Dictated,
    )
    .unwrap();

    let r = lines(&log);
    assert_eq!(r.len(), 2);
    assert!(
        r[1].contains("prop=deadline"),
        "only the key that changed, not all those present: `state` did not move. \
         Received: {r:?}"
    );
    assert!(
        r[1].contains("tag+=home") && r[1].contains("tag-=urgent"),
        "an added tag and a removed tag are two different triggers of 16.2, and \
         the diff that separates them is the same one that finds them. Received: {r:?}"
    );
    assert!(
        !r[1].contains("Outline") && !r[1].contains("Links"),
        "what did not change is not declared changed, or the aspect would no \
         longer filter anything. Received: {r:?}"
    );
}

/// Il **filtro**, in coppia: la maschera stretta non riceve la scrittura che non
/// la riguarda, e la larga sì.
///
/// È il caso della voce alla lettera: «un'automazione su *la scadenza è
/// cambiata* si sveglia a ogni scrittura di ogni nota del suo soggetto».
#[test]
fn a_mask_on_an_aspect_does_not_wake_up_for_the_others() {
    let narrow = EventMask::of([EventKind::DocumentChanged]).on_changes([DocChange::Frontmatter]);
    let (_dir, mut ws, log) = vault(narrow);
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@deadline monday\ncorpus", WriteBase::Dictated)
        .unwrap();
    // Solo il corpo: chi guarda le proprietà non ha niente da fare.
    ws.write_document(
        &id,
        "@deadline monday\ncorpus different",
        WriteBase::Dictated,
    )
    .unwrap();
    // E adesso la proprietà.
    ws.write_document(
        &id,
        "@deadline tuesday\ncorpus different",
        WriteBase::Dictated,
    )
    .unwrap();

    let r = lines(&log);
    assert_eq!(
        r.len(),
        2,
        "the middle write touched only the body and was not supposed to wake \
         whoever watches properties. Received: {r:?}"
    );

    // La stessa storia senza il quarto asse: la prova che il silenzio di sopra
    // è il filtro e non un handler mai chiamato.
    let (_dir, mut ws, wide) = vault(EventMask::of([EventKind::DocumentChanged]));
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@deadline monday\ncorpus", WriteBase::Dictated)
        .unwrap();
    ws.write_document(
        &id,
        "@deadline monday\ncorpus different",
        WriteBase::Dictated,
    )
    .unwrap();
    ws.write_document(
        &id,
        "@deadline tuesday\ncorpus different",
        WriteBase::Dictated,
    )
    .unwrap();
    assert_eq!(lines(&wide).len(), 3);
}

/// Una **riscrittura identica** è un fatto, ed è *niente è cambiato*: chi filtra
/// per aspetto non la riceve.
///
/// È il caso che distingue `Some(vuoto)` da `None`. Il secondo è *non lo so* e
/// passa qualunque filtro; confonderli vorrebbe dire o far passare tutto (e il
/// filtro non toglierebbe niente proprio dove ha la risposta più precisa) o
/// filtrare via ciò di cui non si sa niente, che è perdere in silenzio.
/// filtrare via ciò di cui non si sa niente, che è perdere in silenzio.
#[test]
fn rewriting_the_same_bytes_changes_nothing_and_that_is_a_fact() {
    let (_dir, mut ws, log) =
        vault(EventMask::of([EventKind::DocumentChanged]).on_changes([DocChange::Body]));
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@deadline monday\ncorpus", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&id, "@deadline monday\ncorpus", WriteBase::Dictated)
        .unwrap();
    assert_eq!(
        lines(&log).len(),
        1,
        "the second write changed nothing that the contract knows how to name, \
         and whoever filters by aspect is right not to receive it"
    );

    // Senza filtro l'evento arriva lo stesso, e con un diff vuoto: la scrittura
    // è successa, e dirlo resta compito dell'evento.
    let (_dir, mut ws, wide) = vault(EventMask::of([EventKind::DocumentChanged]));
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@deadline monday\ncorpus", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&id, "@deadline monday\ncorpus", WriteBase::Dictated)
        .unwrap();
    let r = lines(&wide);
    assert_eq!(r.len(), 2, "received: {r:?}");
    assert_eq!(
        r[1], "a.txt ",
        "the second event is there and names no aspect: {r:?}"
    );
}
