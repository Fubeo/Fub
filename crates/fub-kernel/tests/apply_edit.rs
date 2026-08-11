//! La **modifica chirurgica** nel kernel (decisione 0008): cambiare un pezzo di
//! documento invece di riscriverlo tutto.
//!
//! Quattro invarianti, e nessuna è di comodo:
//!
//! 1. **Gli span sono un insieme in coordinate della base.** Chi calcola gli
//!    edit non tiene il conto di quanto il testo si sposta per via degli altri:
//!    li elenca e basta, in qualunque ordine.
//! 2. **La base non è decorativa.** Se il documento è cambiato da quando gli
//!    edit sono stati calcolati, la scrittura non avviene — né in parte né del
//!    tutto — e chi chiama lo sa. È la differenza fra due automazioni che
//!    convivono e due che si cancellano a vicenda.
//! 3. **Una modifica è una scrittura come le altre.** Parse prima del disco,
//!    indici, grafo, contesto ed eventi: la primitiva non è una porta di
//!    servizio che salta la coda di `write_document`.
//! 4. **L'inverso di un edit è un edit.** Il rapporto porta le coordinate nuove
//!    e ciò che c'era prima, e con quei due pezzi il documento torna com'era —
//!    passando dallo stesso confine, non da una scorciatoia.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::edit::WriteBase;
use fub_abi::edit::{EditRequest, Revision, TextEdit};
use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{Event, EventKind, EventMask, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fub_abi::options::syntax;
use fub_abi::traits::{EventHandler, HostApi};
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Workspace};

/// Il provider giocattolo degli altri test del kernel: una riga non vuota è un
/// wikilink. Serve perché una modifica chirurgica deve poter cambiare **un
/// link**, ed è lì che si vede se grafo e indici hanno seguito.
struct LinkListProvider;

impl FormatProvider for LinkListProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("linklist", "Lista di link (test)", &["lnk"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::of(&[syntax::WIKILINKS])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let source = source.text().unwrap_or_default();
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        let mut offset = 0usize;
        for line in source.lines() {
            let span = Span::new(offset, offset + line.len());
            offset += line.len() + 1;
            let page = line.trim();
            if page.is_empty() {
                continue;
            }
            model.links.push(Link {
                target: LinkTarget::wiki(page),
                embed: false,
                span,
                context: None,
            });
        }
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(format!("<pre>{}</pre>", model.text))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

struct TempDir(Utf8PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let base = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("temp dir non UTF-8")
            .join(format!("fub-edit-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("crea temp dir");
        TempDir(base)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn workspace(dir: &Utf8PathBuf) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(LinkListProvider))
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(dir, registry).expect("l'apertura del vault riesce");
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    for plugin in [CORRETTORE, "test.vicino", "test.plugin"] {
        ws.register_core_feature(plugin, plugin)
            .expect("dichiarato");
    }
    ws.reindex().expect("reindex vault vuoto");
    ws
}

/// Un vault con una nota sola, e la sua revisione corrente.
fn con_nota(dir: &Utf8PathBuf, source: &str) -> (Workspace, DocId, Revision) {
    let mut ws = workspace(dir);
    let id = DocId::new("nota.lnk");
    ws.write_document(&id, source, WriteBase::Dictated).unwrap();
    let base = ws.document_revision(&id).unwrap();
    (ws, id, base)
}

#[test]
fn the_edits_are_a_set_in_the_coordinates_of_the_base() {
    let dir = TempDir::new("insieme");
    let (mut ws, id, base) = con_nota(&dir.0, "Alfa\nBeta\nGamma");

    // Elencati al contrario, e con lunghezze diverse da ciò che sostituiscono:
    // se gli span fossero interpretati sul testo in corso di produzione, il
    // secondo cadrebbe nel posto sbagliato.
    let report = ws
        .apply_edit(
            &id,
            EditRequest::new(
                base,
                vec![
                    TextEdit::replace(Span::new(10, 15), "Gamma-di-coda"),
                    TextEdit::replace(Span::new(0, 4), "A"),
                ],
            ),
        )
        .unwrap();

    assert_eq!(
        ws.read_source(&id).unwrap(),
        "A\nBeta\nGamma-di-coda",
        "il resto del documento non è stato toccato"
    );
    assert_eq!(
        report
            .applied
            .iter()
            .map(|a| a.replaced.as_str())
            .collect::<Vec<_>>(),
        vec!["Alfa", "Gamma"],
        "il rapporto è in ordine di documento e dice cosa c'era prima"
    );
    assert_eq!(
        report.revision,
        ws.document_revision(&id).unwrap(),
        "la revisione del rapporto è quella del documento appena scritto: \
         con essa si concatena un secondo edit senza rileggere"
    );
}

#[test]
fn a_stale_base_writes_nothing() {
    let dir = TempDir::new("base-vecchia");
    let (mut ws, id, base) = con_nota(&dir.0, "Alfa\nBeta");

    // Qualcun altro scrive fra il calcolo e l'applicazione: è il caso vero —
    // l'utente che digita mentre un'automazione lavora.
    ws.write_document(&id, "Alfa\nBeta\nGamma", WriteBase::Dictated)
        .unwrap();

    let err = ws
        .apply_edit(
            &id,
            EditRequest::new(base, vec![TextEdit::replace(Span::new(0, 4), "Omega")]),
        )
        .unwrap_err();
    assert!(
        err.to_string().contains("cambiato"),
        "il conflitto deve nominarsi: {err}"
    );
    assert_eq!(
        ws.read_source(&id).unwrap(),
        "Alfa\nBeta\nGamma",
        "la scrittura dell'altro è intatta: il punto della base è proprio \
         non cancellarla in silenzio"
    );

    // Rileggere e ricalcolare è la risposta giusta, e funziona.
    let base = ws.document_revision(&id).unwrap();
    ws.apply_edit(
        &id,
        EditRequest::new(base, vec![TextEdit::replace(Span::new(0, 4), "Omega")]),
    )
    .unwrap();
    assert_eq!(ws.read_source(&id).unwrap(), "Omega\nBeta\nGamma");
}

#[test]
fn a_revision_is_content_so_a_round_trip_of_the_text_keeps_it_valid() {
    let dir = TempDir::new("impronta");
    let (mut ws, id, base) = con_nota(&dir.0, "Alfa");

    // Scritto e disfatto: il documento è di nuovo quello su cui l'edit è stato
    // calcolato, e l'edit vale ancora. Un contatore avrebbe fatto ricalcolare
    // per un cambiamento che non c'è.
    ws.write_document(&id, "Alfa modificata", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&id, "Alfa", WriteBase::Dictated).unwrap();

    ws.apply_edit(
        &id,
        EditRequest::new(base, vec![TextEdit::insert(4, " bis")]),
    )
    .unwrap();
    assert_eq!(ws.read_source(&id).unwrap(), "Alfa bis");
}

#[test]
fn edits_that_do_not_stand_up_are_refused_before_the_disk() {
    let dir = TempDir::new("disciplina");
    let (mut ws, id, base) = con_nota(&dir.0, "Alfa\nBeta");

    let casi: Vec<(&str, Vec<TextEdit>)> = vec![
        (
            "fuori dal sorgente",
            vec![TextEdit::replace(Span::new(5, 99), "x")],
        ),
        (
            "sovrapposti",
            vec![
                TextEdit::replace(Span::new(0, 6), "x"),
                TextEdit::replace(Span::new(4, 9), "y"),
            ],
        ),
        (
            "due nello stesso punto",
            vec![TextEdit::insert(0, "x"), TextEdit::insert(0, "y")],
        ),
    ];
    for (nome, edits) in casi {
        let err = ws
            .apply_edit(&id, EditRequest::new(base.clone(), edits))
            .unwrap_err();
        assert!(
            err.to_string().contains("non applicabile"),
            "{nome}: atteso un errore di modifica, ottenuto {err}"
        );
        assert_eq!(
            ws.read_source(&id).unwrap(),
            "Alfa\nBeta",
            "{nome}: niente di parziale sul disco"
        );
        assert_eq!(
            ws.document_revision(&id).unwrap(),
            base,
            "{nome}: e nemmeno una revisione nuova"
        );
    }
}

#[test]
fn a_request_without_edits_is_not_a_write() {
    let dir = TempDir::new("vuota");
    let (mut ws, id, base) = con_nota(&dir.0, "Alfa");
    let rx = ws.bus().subscribe();

    let report = ws
        .apply_edit(&id, EditRequest::new(base.clone(), vec![]))
        .unwrap();

    assert!(report.is_empty());
    assert_eq!(report.revision, base);
    assert!(
        rx.try_recv().is_err(),
        "nessun edit, nessuna scrittura, nessun evento: chi ascolta non deve \
         ridisegnare per una modifica che non c'è stata"
    );
}

#[test]
fn a_surgical_edit_goes_through_the_whole_write_path() {
    let dir = TempDir::new("coda");
    let mut ws = workspace(&dir.0);
    let a = DocId::new("a.lnk");
    ws.write_document(&DocId::new("Vecchia.lnk"), "", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&DocId::new("Nuova.lnk"), "", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&a, "Vecchia", WriteBase::Dictated)
        .unwrap();
    assert_eq!(ws.backlinks(&DocId::new("Vecchia.lnk")).len(), 1);

    let rx = ws.bus().subscribe();
    let base = ws.document_revision(&a).unwrap();
    ws.apply_edit(
        &a,
        EditRequest::new(base, vec![TextEdit::replace(Span::new(0, 7), "Nuova")]),
    )
    .unwrap();

    // Grafo: il backlink si è spostato, quindi il modello è stato riparsato e
    // il grafo aggiornato — non solo il file riscritto.
    assert!(ws.backlinks(&DocId::new("Vecchia.lnk")).is_empty());
    assert_eq!(
        ws.backlinks(&DocId::new("Nuova.lnk"))[0].source,
        DocId::new("a.lnk")
    );

    // Eventi: quelli di una scrittura, una volta sola.
    let mut cambiati = 0;
    while let Ok(e) = rx.try_recv() {
        if let Event::DocumentChanged { id, .. } = e.event {
            assert_eq!(id, a);
            cambiati += 1;
        }
    }
    assert_eq!(
        cambiati, 1,
        "una modifica chirurgica è UNA scrittura, non una per edit"
    );
}

#[test]
fn a_failing_parse_leaves_the_document_alone() {
    let dir = TempDir::new("parse");
    let (mut ws, id, base) = con_nota(&dir.0, "Alfa");

    // Un `DocId` senza provider non è parsabile: l'errore arriva prima del
    // disco, come per `write_document` (atomicità rispetto al parse).
    let orfano = DocId::new("nota.sconosciuto");
    std::fs::write(dir.0.join("nota.sconosciuto"), "Alfa").unwrap();
    assert!(ws
        .apply_edit(
            &orfano,
            EditRequest::new(Revision::of("Alfa"), vec![TextEdit::insert(4, " bis")],),
        )
        .is_err());
    assert_eq!(
        std::fs::read_to_string(dir.0.join("nota.sconosciuto")).unwrap(),
        "Alfa"
    );

    // E la nota vera è rimasta quella di prima.
    assert_eq!(ws.document_revision(&id).unwrap(), base);
}

#[test]
fn the_inverse_of_an_edit_puts_the_document_back_through_the_kernel() {
    let dir = TempDir::new("inverso");
    let (mut ws, id, base) = con_nota(&dir.0, "Alfa\nBeta\nGamma");

    let report = ws
        .apply_edit(
            &id,
            EditRequest::new(
                base,
                vec![
                    TextEdit::delete(Span::new(0, 5)),
                    TextEdit::insert(15, "\nDelta"),
                ],
            ),
        )
        .unwrap();
    assert_eq!(ws.read_source(&id).unwrap(), "Beta\nGamma\nDelta");

    ws.apply_edit(&id, report.inverse()).unwrap();
    assert_eq!(
        ws.read_source(&id).unwrap(),
        "Alfa\nBeta\nGamma",
        "andata e ritorno, byte per byte, passando due volte dal confine"
    );
}

#[test]
fn a_multibyte_document_is_edited_on_character_boundaries() {
    let dir = TempDir::new("utf8");
    let (mut ws, id, base) = con_nota(&dir.0, "città\nperò");

    // "città" sono 6 byte: la à ne occupa due. Tagliare a 4..5 sarebbe dentro
    // il carattere.
    let err = ws
        .apply_edit(
            &id,
            EditRequest::new(base.clone(), vec![TextEdit::replace(Span::new(4, 5), "a")]),
        )
        .unwrap_err();
    assert!(err.to_string().contains("non applicabile"), "{err}");

    ws.apply_edit(
        &id,
        EditRequest::new(base, vec![TextEdit::replace(Span::new(3, 6), "a")]),
    )
    .unwrap();
    assert_eq!(ws.read_source(&id).unwrap(), "cita\nperò");
}

// ---------------------------------------------------------------------------
// Dal posto in cui sta un plugin
// ---------------------------------------------------------------------------

/// Un handler che, alla prima modifica di una nota, la **corregge**: legge la
/// revisione, calcola un edit e lo applica — cioè fa dall'`HostApi` ciò che le
/// automazioni di 16.2 faranno, e che senza questa capacità sarebbe una
/// riscrittura totale della nota di qualcun altro.
///
/// Si difende dal richiamarsi da solo con l'**origine** (decisione 0012) e non col
/// contenuto: la propria correzione la riconosce perché la ha chiesta lui, non
/// perché il testo non contiene più `TOODO`. La differenza si vede appena
/// un'automazione fa una modifica che *non* cambia il proprio innesco — o che
/// lo cambia e lo rimette — e allora il guardiano di contenuto non guarda niente.
const CORRETTORE: &str = "test.correttore";

struct Correttore {
    fatto: Arc<Mutex<Vec<String>>>,
}

impl EventHandler for Correttore {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::DocumentChanged])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if notice.origin.actor.is_plugin(CORRETTORE) {
            // Questa l'ho scritta io.
            return Ok(());
        }
        let Event::DocumentChanged { id, .. } = &notice.event else {
            return Ok(());
        };
        let source = host.read_document(id)?;
        let Some(at) = source.find("TOODO") else {
            return Ok(());
        };
        let base = host.document_revision(id)?;
        let report = host.apply_edit(
            id,
            EditRequest::new(base, vec![TextEdit::replace(Span::new(at, at + 5), "TODO")]),
        )?;
        self.fatto
            .lock()
            .unwrap()
            .push(format!("{id}@{}", report.revision.as_str()));
        Ok(())
    }
}

#[test]
fn a_provider_patches_a_document_through_the_host_api() {
    let dir = TempDir::new("provider");
    let mut ws = workspace(&dir.0);
    let fatto = Arc::new(Mutex::new(Vec::new()));
    ws.register_event_handler(
        CORRETTORE,
        Box::new(Correttore {
            fatto: fatto.clone(),
        }),
    )
    .expect("registrato");

    let id = DocId::new("nota.lnk");
    ws.write_document(&id, "Alfa\nTOODO: sistemare\nBeta", WriteBase::Dictated)
        .unwrap();

    assert_eq!(
        ws.read_source(&id).unwrap(),
        "Alfa\nTODO: sistemare\nBeta",
        "il provider ha cambiato cinque byte, non ha riscritto la nota"
    );
    let fatto = fatto.lock().unwrap();
    assert_eq!(
        fatto.len(),
        1,
        "e la correzione non si è richiamata da sola"
    );
    assert!(
        fatto[0].ends_with(ws.document_revision(&id).unwrap().as_str()),
        "la revisione che il rapporto ha dato al provider è quella del \
         documento sul disco"
    );
}

/// Un handler che alla modifica di `a.lnk` scrive in `b.lnk`: è il vicino
/// rumoroso di una riscrittura in corso — un'automazione, un sync, un altro
/// plugin.
struct ScriveAltrove;

impl EventHandler for ScriveAltrove {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::DocumentChanged])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let Event::DocumentChanged { id, .. } = &notice.event else {
            return Ok(());
        };
        if id.as_str() != "a.lnk" {
            return Ok(());
        }
        let b = DocId::new("b.lnk");
        let source = host.read_document(&b)?;
        if source.contains("Aggiunta") {
            return Ok(());
        }
        host.write_document(&b, &format!("{source}\nAggiunta"), WriteBase::Dictated)
            .map(|_| ())
    }
}

/// Il vicino rumoroso **non entra più a metà di una rinomina**: dalla decisione 0011 la
/// rinomina è un lotto, e dentro un lotto il dispatch è rimandato alla chiusura.
///
/// Fino alla decisione 0011 questo test diceva l'opposto: l'handler scriveva in `b.lnk`
/// mentre il piano non l'aveva ancora riscritta, la `base` di quella sorgente
/// diventava stantia, e la rinomina falliva *per* `b.lnk`. Era il
/// comportamento giusto per il contratto di allora — con gli eventi consegnati
/// dentro l'operazione, quella corsa esisteva davvero e la decisione 0008 la rendeva
/// visibile invece di far sparire una riga in silenzio.
///
/// Il lotto la toglie di mezzo a monte: nessun handler vede il vault a metà di
/// una rinomina, quindi nessun handler può crearla. Ciò che resta provato qui è
/// che le due scritture **non si cancellano**, che era il punto — solo che
/// adesso riescono tutte e due invece di dover scegliere. La guardia della
/// `base` non è diventata inutile: continua a coprire chi scrive *fuori* dal
/// giro (un'altra app, un job che rientra), ed è provata da
/// `a_stale_base_writes_nothing` e dal lotto in `batch_and_origin.rs`.
#[test]
fn a_rename_and_a_neighbour_write_no_longer_race_because_the_batch_defers_the_dispatch() {
    let dir = TempDir::new("rename-vicino");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Vecchia.lnk"), "", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&DocId::new("a.lnk"), "Vecchia", WriteBase::Dictated)
        .unwrap();
    ws.write_document(&DocId::new("b.lnk"), "Vecchia", WriteBase::Dictated)
        .unwrap();
    ws.register_event_handler("test.vicino", Box::new(ScriveAltrove))
        .expect("registrato");

    ws.rename_document(&DocId::new("Vecchia.lnk"), &DocId::new("Nuova.lnk"))
        .unwrap();

    assert_eq!(
        ws.read_source(&DocId::new("a.lnk")).unwrap(),
        "Nuova",
        "il piano si è applicato per intero"
    );
    assert_eq!(
        ws.read_source(&DocId::new("b.lnk")).unwrap(),
        "Nuova\nAggiunta",
        "e la riga dell'handler, arrivata DOPO la chiusura del lotto, sta \
         sopra il link già riscritto: nessuna delle due scritture ha cancellato \
         l'altra, e nessuna delle due ha dovuto fallire per riuscirci"
    );
}

#[test]
fn a_stale_base_from_a_provider_is_a_conflict_not_an_internal_error() {
    let dir = TempDir::new("conflitto-plugin");
    let (mut ws, id, base) = con_nota(&dir.0, "Alfa");
    ws.write_document(&id, "Alfa cambiata", WriteBase::Dictated)
        .unwrap();

    let err = ws
        .with_host("test.plugin", |host| {
            host.apply_edit(
                &id,
                EditRequest::new(base, vec![TextEdit::insert(4, " bis")]),
            )
        })
        .unwrap_err();

    assert!(
        matches!(err, PluginError::Conflict(_)),
        "chi chiama deve poter distinguere «riprova» da «correggi»: {err:?}"
    );
}
