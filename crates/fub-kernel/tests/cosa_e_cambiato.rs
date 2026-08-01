//! **Un evento dice quale documento, e adesso anche cosa è cambiato** (§22.2,
//! [decisione 0069](../../../docs/decisions/0069-cosa-sa-dire-un-abbonamento.md)).
//!
//! `DocumentChanged { id }` diceva che *quella* nota era cambiata e non cosa: chi
//! voleva sapere se era cambiato un tag doveva rileggere il modello e
//! confrontarlo con la copia che si era tenuto. È il conto più alto del capitolo
//! 16 di FEATURES — un'automazione su «la scadenza è cambiata» si svegliava a
//! ogni scrittura di ogni nota del suo soggetto — e si paga sull'evento più caldo
//! del contratto.
//!
//! Le prove sono scritte **in coppia** come quelle della
//! [0033](../../../docs/decisions/0033-la-grana-di-un-abbonamento.md), e per la
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
/// loro questa voce non si può provare: `TestoDiProva` mette tutto in `text`, e
/// contro di lui ogni scrittura sarebbe un solo `Body`.
///
/// Sintassi: `@chiave valore` è una proprietà, una parola che comincia per `#`
/// è un tag, il resto è corpo.
struct FormatoConMetadati;

impl FormatProvider for FormatoConMetadati {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("test.meta", "Con metadati", &["txt"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let testo = source.text().unwrap_or_default().to_string();
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        let mut fm = serde_json::Map::new();
        for riga in testo.lines() {
            if let Some(resto) = riga.strip_prefix('@') {
                let (chiave, valore) = resto.split_once(' ').unwrap_or((resto, ""));
                fm.insert(chiave.to_string(), serde_json::json!(valore));
            }
            for parola in riga.split_whitespace() {
                if let Some(nome) = parola.strip_prefix('#') {
                    model.tags.push(Tag {
                        name: nome.to_string(),
                        span: Span::EMPTY,
                    });
                }
            }
        }
        model.frontmatter = Frontmatter(fm);
        model.text = testo;
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
struct Spia {
    mask: EventMask,
    log: Log,
}

impl EventHandler for Spia {
    fn subscribed(&self) -> EventMask {
        self.mask.clone()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        if let Event::DocumentChanged { id, changes } = &notice.event {
            let dettaglio = match changes {
                None => "?".to_string(),
                Some(c) => {
                    let mut parti: Vec<String> =
                        c.aspects.iter().map(|a| format!("{a:?}")).collect();
                    if !c.properties.is_empty() {
                        parti.push(format!("prop={}", c.properties.join("+")));
                    }
                    if !c.tags_added.is_empty() {
                        parti.push(format!("tag+={}", c.tags_added.join("+")));
                    }
                    if !c.tags_removed.is_empty() {
                        parti.push(format!("tag-={}", c.tags_removed.join("+")));
                    }
                    parti.join(",")
                }
            };
            self.log.lock().unwrap().push(format!("{id} {dettaglio}"));
        }
        Ok(())
    }
}

const SPIA: &str = "test.spia";

fn vault(mask: EventMask) -> (tempfile::TempDir, Workspace, Log) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(FormatoConMetadati))
        .expect("formato");
    let mut ws = Workspace::new(&root, registry);
    ws.register_core_feature(SPIA, SPIA).expect("dichiarato");
    let log: Log = Arc::default();
    ws.register_event_handler(
        SPIA,
        Box::new(Spia {
            mask,
            log: log.clone(),
        }),
    )
    .expect("registrato");
    (dir, ws, log)
}

fn righe(log: &Log) -> Vec<String> {
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
    ws.write_document(&DocId::new("a.txt"), "@scadenza domani\n#urgente\ncorpo")
        .unwrap();
    let r = righe(&log);
    assert_eq!(r.len(), 1);
    for aspetto in ["Body", "Frontmatter", "Tags", "Links", "Outline", "Anchors"] {
        assert!(
            r[0].contains(aspetto),
            "una nota che nasce ha cambiato tutto, e {aspetto} manca da: {r:?}"
        );
    }
}

/// Il **racconto**: quali chiavi e quali tag, senza rileggere niente.
///
/// È la metà della voce che non passa dalla maschera, ed è quella che toglie il
/// conto vero: chi si sveglia sa già se lo riguardava.
#[test]
fn the_event_names_which_properties_and_which_tags() {
    let (_dir, mut ws, log) = vault(EventMask::of([EventKind::DocumentChanged]));
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@scadenza lunedì\n@stato aperto\n#urgente\ncorpo")
        .unwrap();
    // Cambia UNA proprietà, toglie un tag, ne aggiunge un altro. Il corpo
    // cambia per forza, perché è lo stesso file.
    ws.write_document(&id, "@scadenza martedì\n@stato aperto\n#casa\ncorpo")
        .unwrap();

    let r = righe(&log);
    assert_eq!(r.len(), 2);
    assert!(
        r[1].contains("prop=scadenza"),
        "solo la chiave cambiata, non tutte quelle che ci sono: `stato` non si \
         è mossa. Ricevuto: {r:?}"
    );
    assert!(
        r[1].contains("tag+=casa") && r[1].contains("tag-=urgente"),
        "un tag aggiunto e uno tolto sono due trigger diversi della 16.2, e il \
         diff che li separa è lo stesso che li trova. Ricevuto: {r:?}"
    );
    assert!(
        !r[1].contains("Outline") && !r[1].contains("Links"),
        "ciò che non è cambiato non si dichiara cambiato, o l'aspetto non \
         filtrerebbe più niente. Ricevuto: {r:?}"
    );
}

/// Il **filtro**, in coppia: la maschera stretta non riceve la scrittura che non
/// la riguarda, e la larga sì.
///
/// È il caso della voce alla lettera: «un'automazione su *la scadenza è
/// cambiata* si sveglia a ogni scrittura di ogni nota del suo soggetto».
#[test]
fn a_mask_on_an_aspect_does_not_wake_up_for_the_others() {
    let stretta = EventMask::of([EventKind::DocumentChanged]).on_changes([DocChange::Frontmatter]);
    let (_dir, mut ws, log) = vault(stretta);
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@scadenza lunedì\ncorpo").unwrap();
    // Solo il corpo: chi guarda le proprietà non ha niente da fare.
    ws.write_document(&id, "@scadenza lunedì\ncorpo diverso")
        .unwrap();
    // E adesso la proprietà.
    ws.write_document(&id, "@scadenza martedì\ncorpo diverso")
        .unwrap();

    let r = righe(&log);
    assert_eq!(
        r.len(),
        2,
        "la scrittura di mezzo ha toccato il solo corpo e non doveva svegliare \
         chi guarda le proprietà. Ricevute: {r:?}"
    );

    // La stessa storia senza il quarto asse: la prova che il silenzio di sopra
    // è il filtro e non un handler mai chiamato.
    let (_dir, mut ws, largo) = vault(EventMask::of([EventKind::DocumentChanged]));
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@scadenza lunedì\ncorpo").unwrap();
    ws.write_document(&id, "@scadenza lunedì\ncorpo diverso")
        .unwrap();
    ws.write_document(&id, "@scadenza martedì\ncorpo diverso")
        .unwrap();
    assert_eq!(righe(&largo).len(), 3);
}

/// Una **riscrittura identica** è un fatto, ed è *niente è cambiato*: chi filtra
/// per aspetto non la riceve.
///
/// È il caso che distingue `Some(vuoto)` da `None`. Il secondo è *non lo so* e
/// passa qualunque filtro; confonderli vorrebbe dire o far passare tutto (e il
/// filtro non toglierebbe niente proprio dove ha la risposta più precisa) o
/// filtrare via ciò di cui non si sa niente, che è perdere in silenzio.
#[test]
fn rewriting_the_same_bytes_changes_nothing_and_that_is_a_fact() {
    let (_dir, mut ws, log) =
        vault(EventMask::of([EventKind::DocumentChanged]).on_changes([DocChange::Body]));
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@scadenza lunedì\ncorpo").unwrap();
    ws.write_document(&id, "@scadenza lunedì\ncorpo").unwrap();
    assert_eq!(
        righe(&log).len(),
        1,
        "la seconda scrittura non ha cambiato niente di ciò che il contratto sa \
         nominare, e chi filtra per aspetto ha ragione a non riceverla"
    );

    // Senza filtro l'evento arriva lo stesso, e con un diff vuoto: la scrittura
    // è successa, e dirlo resta compito dell'evento.
    let (_dir, mut ws, largo) = vault(EventMask::of([EventKind::DocumentChanged]));
    let id = DocId::new("a.txt");
    ws.write_document(&id, "@scadenza lunedì\ncorpo").unwrap();
    ws.write_document(&id, "@scadenza lunedì\ncorpo").unwrap();
    let r = righe(&largo);
    assert_eq!(r.len(), 2, "ricevute: {r:?}");
    assert_eq!(
        r[1], "a.txt ",
        "il secondo evento c'è e non nomina nessun aspetto: {r:?}"
    );
}
