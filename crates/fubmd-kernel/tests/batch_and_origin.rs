//! Il **lotto** (decisione 0011) e l'**origine degli eventi** (decisione 0012) nel kernel.
//!
//! Le due voci sono una sola perché la decisione 0012 dice essa stessa che il campo è
//! «origin *e* l'id di lotto della decisione 0011»: deciderle separate significa deciderle
//! due volte, e la seconda volta con la prima già congelata.
//!
//! Cinque invarianti, e ognuna corrisponde a una decisione del verbale:
//!
//! 1. **Un lotto coalizza `index-updated` e nient'altro.** Gli eventi
//!    per-documento passano tutti: un handler che segue i documenti non deve
//!    cambiare una riga per sopravvivere a un lotto.
//! 2. **Il terminale nomina ciò che il lotto ha toccato**, in ordine di prima
//!    apparizione e senza ripetizioni: è l'insieme su cui chi ridisegna decide.
//! 3. **Un lotto non è una transazione.** Se una scrittura fallisce le altre
//!    restano fatte, e il lotto si chiude lo stesso dicendo cosa ha toccato.
//! 4. **L'origine è chi ha CHIESTO**, non chi ha eseguito — ed è ciò che
//!    permette a un'automazione di riconoscere le proprie scritture.
//! 5. **Il dispatch è rimandato alla chiusura**: dentro un lotto il vault è a
//!    metà di un'operazione, e un handler che vi reagisse vedrebbe uno stato che
//!    non è mai esistito per nessuno.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::edit::{EditRequest, TextEdit};
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Actor, BatchId, Event, EventKind, EventMask, Notice};
use fubmd_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fubmd_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fubmd_abi::options::syntax;
use fubmd_abi::traits::{EventHandler, HostApi};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// Lo stesso provider giocattolo degli altri test del kernel: una riga non
/// vuota è un wikilink. Serve perché il caso vero del lotto è la **rinomina con
/// backlink**, e senza link non c'è niente da riscrivere.
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
            .join(format!("fubmd-lotto-{tag}-{}", std::process::id()));
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
    let mut ws = Workspace::new(dir, registry);
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    for plugin in [AUTOMA, "test.spia"] {
        ws.register_core_feature(plugin, plugin)
            .expect("dichiarato");
    }
    ws.reindex().expect("reindex vault vuoto");
    ws
}

/// Un vault con `Vecchia.lnk` e `n` note che la linkano.
fn con_backlink(dir: &Utf8PathBuf, n: usize) -> Workspace {
    let mut ws = workspace(dir);
    ws.write_document(&DocId::new("Vecchia.lnk"), "").unwrap();
    for i in 0..n {
        ws.write_document(&DocId::new(format!("src{i}.lnk")), "Vecchia")
            .unwrap();
    }
    ws
}

// ---------------------------------------------------------------------------
// 1-2. Cosa il lotto coalizza, e cosa dice il terminale
// ---------------------------------------------------------------------------

#[test]
fn a_rename_with_backlinks_is_one_redraw_and_not_one_per_source() {
    let dir = TempDir::new("uno-non-n");
    let mut ws = con_backlink(&dir.0, 20);
    let rx = ws.bus().subscribe();

    ws.rename_document(&DocId::new("Vecchia.lnk"), &DocId::new("Nuova.lnk"))
        .unwrap();

    let notices: Vec<Notice> = rx.try_iter().collect();
    let per_specie = |k: EventKind| notices.iter().filter(|n| n.kind() == k).count();

    assert_eq!(
        per_specie(EventKind::IndexUpdated),
        0,
        "dentro un lotto `index-updated` non esce: è l'unico evento senza \
         payload, e N copie dicono quanto ne dice una"
    );
    assert_eq!(
        per_specie(EventKind::BatchEnded),
        1,
        "e al suo posto arriva UN terminale, non uno per sorgente"
    );
    assert_eq!(
        per_specie(EventKind::DocumentChanged),
        20,
        "gli eventi per-documento invece passano tutti: chi li segue non perde \
         niente, ed è la ragione per cui questa voce non chiede a nessuno di \
         migrare"
    );

    let Some(Event::BatchEnded { batch, changed }) = notices
        .iter()
        .find(|n| n.kind() == EventKind::BatchEnded)
        .map(|n| n.event.clone())
    else {
        panic!("il terminale del lotto")
    };
    assert_eq!(
        changed.len(),
        21,
        "le 20 sorgenti riscritte più la nota rinominata: `changed` è l'insieme \
         che chi ridisegna deve considerare stantio"
    );
    assert!(changed.contains(&DocId::new("Nuova.lnk")));
    assert!(
        notices
            .iter()
            .filter(|n| n.kind() != EventKind::BatchEnded)
            .all(|n| n.origin.batch == Some(batch)),
        "ogni evento del lotto porta il suo id: è così che si correla ciò che \
         è successo dentro col terminale che lo chiude"
    );
}

#[test]
fn the_touched_set_has_no_repetitions_and_keeps_the_order_of_what_happened() {
    let dir = TempDir::new("insieme");
    let mut ws = workspace(&dir.0);
    let rx = ws.bus().subscribe();

    ws.batch(|ws| {
        ws.write_document(&DocId::new("b.lnk"), "uno").unwrap();
        ws.write_document(&DocId::new("a.lnk"), "due").unwrap();
        // Scritta due volte: un documento toccato N volte resta un documento.
        ws.write_document(&DocId::new("b.lnk"), "tre").unwrap();
    });

    let Some(Event::BatchEnded { changed, .. }) = rx
        .try_iter()
        .map(|n| n.event)
        .find(|e| matches!(e, Event::BatchEnded { .. }))
    else {
        panic!("il terminale del lotto")
    };
    assert_eq!(
        changed,
        vec![DocId::new("b.lnk"), DocId::new("a.lnk")],
        "ordine di prima apparizione, non alfabetico: è l'ordine in cui le cose \
         sono successe, che è quello che si mostrerebbe a un umano"
    );
}

#[test]
fn a_batch_that_touched_nothing_says_nothing() {
    let dir = TempDir::new("vuoto");
    let mut ws = workspace(&dir.0);
    let rx = ws.bus().subscribe();

    ws.batch(|ws| {
        // Solo letture.
        let _ = ws.documents();
    });

    assert_eq!(
        rx.try_iter().count(),
        0,
        "un lotto senza scritture non emette il terminale: come una modifica \
         senza edit non è una scrittura, un lotto che non ha toccato niente non \
         è una notizia — e un ridisegno chiesto per niente è comunque un \
         ridisegno"
    );
}

#[test]
fn a_nested_batch_joins_the_one_that_is_open() {
    let dir = TempDir::new("annidato");
    let mut ws = con_backlink(&dir.0, 3);
    let rx = ws.bus().subscribe();

    // Una rinomina è già un lotto: dentro un lotto esterno non deve chiuderne
    // uno proprio, o il terminale arriverebbe mentre l'operazione esterna è
    // ancora in corso.
    ws.batch(|ws| {
        ws.rename_document(&DocId::new("Vecchia.lnk"), &DocId::new("Nuova.lnk"))
            .unwrap();
        ws.write_document(&DocId::new("dopo.lnk"), "coda").unwrap();
    });

    let terminali: Vec<Event> = rx
        .try_iter()
        .map(|n| n.event)
        .filter(|e| matches!(e, Event::BatchEnded { .. }))
        .collect();
    assert_eq!(terminali.len(), 1, "un terminale solo: {terminali:?}");
    let Event::BatchEnded { changed, .. } = &terminali[0] else {
        unreachable!()
    };
    assert!(
        changed.contains(&DocId::new("dopo.lnk")),
        "e copre anche ciò che è stato scritto DOPO la rinomina, dentro lo \
         stesso lotto: {changed:?}"
    );
}

// ---------------------------------------------------------------------------
// 3. Un lotto non è una transazione
// ---------------------------------------------------------------------------

#[test]
fn a_batch_does_not_roll_back_and_says_so_by_closing_anyway() {
    let dir = TempDir::new("niente-rollback");
    let mut ws = workspace(&dir.0);
    let a = DocId::new("a.lnk");
    let b = DocId::new("b.lnk");
    ws.write_document(&a, "prima").unwrap();
    ws.write_document(&b, "prima").unwrap();
    // Una base calcolata adesso e resa stantia da una scrittura che arriva
    // prima che il lotto la usi: è il caso di un'automazione lunga (decisione 0008).
    let base_vecchia = ws.document_revision(&b).unwrap();
    ws.write_document(&b, "qualcun altro").unwrap();
    let rx = ws.bus().subscribe();

    let esito = ws.batch(|ws| {
        ws.write_document(&a, "dopo").unwrap();
        ws.apply_edit(
            &b,
            EditRequest::new(base_vecchia, vec![TextEdit::insert(0, "x")]),
        )
    });

    let err = esito.unwrap_err();
    assert!(
        err.to_string().contains("b.lnk"),
        "chi ha aperto il lotto sa cosa non è andato, dal PROPRIO valore di \
         ritorno: il lotto lo passa intatto invece di inghiottirlo — {err}"
    );
    assert_eq!(
        ws.read_source(&a).unwrap(),
        "dopo",
        "e ciò che era riuscito resta fatto: un lotto non annulla niente. Il \
         tutto-o-niente vuole il journal del §15.2, e prometterlo con un nome \
         (`transaction`, `rollback`) sarebbe farlo credere a chi legge solo la \
         firma"
    );
    assert_eq!(
        ws.read_source(&b).unwrap(),
        "qualcun altro",
        "e la scrittura dell'altro non è stata cancellata: il conflitto del \
         decisione 0008 vale dentro un lotto come fuori"
    );

    let terminali: Vec<Event> = rx
        .try_iter()
        .map(|n| n.event)
        .filter(|e| matches!(e, Event::BatchEnded { .. }))
        .collect();
    assert_eq!(
        terminali.len(),
        1,
        "il lotto si chiude lo stesso: chi ridisegna deve ridisegnare proprio \
         quando qualcosa è andato storto a metà"
    );
    let Event::BatchEnded { changed, .. } = &terminali[0] else {
        unreachable!()
    };
    assert_eq!(
        changed,
        &vec![a],
        "e il terminale nomina ciò che è stato toccato DAVVERO, non ciò che il \
         lotto si proponeva di toccare: chi ridisegna su una nota che non è \
         cambiata paga un giro per niente"
    );
}

// ---------------------------------------------------------------------------
// 4. L'origine è chi ha chiesto
// ---------------------------------------------------------------------------

const AUTOMA: &str = "test.automa";

/// Un'automazione su-modifica **che scrive**: il caso di 16.2, e quello che
/// senza l'origine si richiama da sé finché il budget del dispatch non tronca.
///
/// Tiene conto di quante volte è stata chiamata su un evento non suo, e
/// `guardia` decide se difendersi con l'origine o no — così il test può
/// mostrare le due storie invece di raccontarne una.
struct Automa {
    guardia: bool,
    scritture: Arc<Mutex<usize>>,
}

impl EventHandler for Automa {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::DocumentChanged])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if self.guardia && notice.origin.actor.is_plugin(AUTOMA) {
            // Questa l'ho scritta io: non ci reagisco.
            return Ok(());
        }
        let Event::DocumentChanged { .. } = &notice.event else {
            return Ok(());
        };
        let diario = DocId::new("diario.lnk");
        let source = host.read_document(&diario).unwrap_or_default();
        *self.scritture.lock().unwrap() += 1;
        // Scrive SEMPRE qualcosa di nuovo: è il caso che una guardia di
        // contenuto non sa fermare, perché il documento è ogni volta diverso.
        host.write_document(&diario, &format!("{source}\nriga"))
    }
}

fn quante_scritture(tag: &str, guardia: bool) -> usize {
    let dir = TempDir::new(tag);
    let mut ws = workspace(&dir.0);
    let scritture = Arc::new(Mutex::new(0usize));
    ws.register_event_handler(
        AUTOMA,
        Box::new(Automa {
            guardia,
            scritture: scritture.clone(),
        }),
    )
    .expect("registrato");
    ws.write_document(&DocId::new("innesco.lnk"), "via")
        .unwrap();
    let n = *scritture.lock().unwrap();
    n
}

#[test]
fn an_on_change_automation_recognises_its_own_writes_by_the_origin() {
    // Con la guardia: reagisce all'innesco, scrive, e il proprio evento lo
    // riconosce. Due giri in tutto — l'innesco e il `document-changed` del
    // diario, che salta.
    let con = quante_scritture("automa-con", true);
    assert_eq!(
        con, 1,
        "una scrittura sola: l'automazione ha riconosciuto la propria dall'origine"
    );

    // Senza: ogni scrittura del diario è un `document-changed` che la richiama,
    // e l'unica cosa che la ferma è il budget del dispatch — cioè una rete di
    // sicurezza, non una semantica.
    let senza = quante_scritture("automa-senza", false);
    assert!(
        senza > 100,
        "senza la guardia dell'origine l'automazione si richiama da sola fino \
         al troncamento della coda ({senza} scritture): è esattamente il buco \
         che la decisione 0012 esiste per chiudere, e un guardiano di CONTENUTO qui non \
         funzionerebbe — il diario è ogni volta diverso"
    );
}

#[test]
fn the_actor_of_a_plugin_write_is_the_plugin_and_of_a_shell_write_is_the_user() {
    let dir = TempDir::new("attori");
    let mut ws = workspace(&dir.0);
    ws.register_event_handler(
        AUTOMA,
        Box::new(Automa {
            guardia: true,
            scritture: Arc::new(Mutex::new(0)),
        }),
    )
    .expect("registrato");
    let rx = ws.bus().subscribe();

    ws.write_document(&DocId::new("innesco.lnk"), "via")
        .unwrap();

    let mut per_doc: Vec<(String, Actor)> = rx
        .try_iter()
        .filter_map(|n| match n.event {
            Event::DocumentChanged { id } => Some((id.0, n.origin.actor)),
            _ => None,
        })
        .collect();
    per_doc.sort_by(|a, b| a.0.cmp(&b.0));

    assert_eq!(
        per_doc,
        vec![
            (
                "diario.lnk".to_string(),
                Actor::Plugin {
                    id: AUTOMA.to_string()
                }
            ),
            ("innesco.lnk".to_string(), Actor::User),
        ],
        "l'attore è chi ha CHIESTO: la nota l'ha scritta la shell, il diario \
         l'ha voluto il plugin di propria iniziativa"
    );
}

#[test]
fn the_watcher_is_a_distinct_actor_because_that_write_did_not_pass_from_us() {
    let dir = TempDir::new("watcher");
    let mut ws = workspace(&dir.0);
    let id = DocId::new("fuori.lnk");
    ws.write_document(&id, "nostra").unwrap();
    let rx = ws.bus().subscribe();

    // Un'altra app scrive il file, e il watcher ce lo riferisce.
    std::fs::write(dir.0.join("fuori.lnk"), "loro").unwrap();
    ws.sync_path(&dir.0.join("fuori.lnk")).unwrap();

    let attori: Vec<Actor> = rx
        .try_iter()
        .filter(|n| n.kind() == EventKind::DocumentChanged)
        .map(|n| n.origin.actor)
        .collect();
    assert_eq!(
        attori,
        vec![Actor::Watcher],
        "è l'unica origine che dice «il vault è cambiato senza passare da noi», \
         e senza di essa la shell non può distinguere il lavoro di un'altra \
         app dalla propria riscrittura dei link"
    );
}

#[test]
fn what_the_kernel_does_on_its_own_is_not_attributed_to_anyone_else() {
    let dir = TempDir::new("kernel");
    let mut ws = workspace(&dir.0);
    let rx = ws.bus().subscribe();
    ws.reindex().unwrap();

    let attori: Vec<Actor> = rx.try_iter().map(|n| n.origin.actor).collect();
    assert!(
        !attori.is_empty() && attori.iter().all(|a| *a == Actor::Kernel),
        "apertura del vault e indice sono del kernel: intestarli all'utente \
         direbbe a un'automazione «questa l'hai chiesta tu» all'avvio, cioè \
         nel momento in cui non ha chiesto niente ({attori:?})"
    );
}

// ---------------------------------------------------------------------------
// 5. Il dispatch è rimandato alla chiusura
// ---------------------------------------------------------------------------

/// Registra, per ogni evento che riceve, cosa vedeva il vault in quel momento.
struct Spia(Arc<Mutex<Vec<(String, usize)>>>);

impl EventHandler for Spia {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let quanti = host.list_documents(None)?.items.len();
        self.0
            .lock()
            .unwrap()
            .push((format!("{:?}", notice.kind()), quanti));
        Ok(())
    }
}

#[test]
fn inside_a_batch_no_handler_sees_the_vault_halfway_through() {
    let dir = TempDir::new("mai-a-meta");
    let mut ws = workspace(&dir.0);
    let visto = Arc::new(Mutex::new(Vec::new()));
    ws.register_event_handler("test.spia", Box::new(Spia(visto.clone())))
        .expect("registrato");

    ws.batch(|ws| {
        for i in 0..5 {
            ws.write_document(&DocId::new(format!("n{i}.lnk")), "x")
                .unwrap();
        }
    });

    let visto = visto.lock().unwrap();
    assert!(!visto.is_empty(), "gli eventi sono arrivati");
    assert!(
        visto.iter().all(|(_, quanti)| *quanti == 5),
        "ogni handler ha visto il vault COMPLETO: dentro il lotto il dispatch è \
         rimandato, perché uno stato a metà di un'operazione non è mai esistito \
         per nessuno — {visto:?}"
    );
    assert_eq!(
        visto.last().map(|(kind, _)| kind.as_str()),
        Some("BatchEnded"),
        "e il terminale arriva per ultimo, dopo ciò che il lotto ha fatto"
    );
}

#[test]
fn a_batch_id_is_new_every_time() {
    let dir = TempDir::new("id");
    let mut ws = workspace(&dir.0);
    let rx = ws.bus().subscribe();

    let mut ids = Vec::new();
    for i in 0..3 {
        ws.batch(|ws| {
            ws.write_document(&DocId::new(format!("n{i}.lnk")), "x")
                .unwrap();
        });
    }
    for n in rx.try_iter() {
        if let Event::BatchEnded { batch, .. } = n.event {
            ids.push(batch);
        }
    }
    assert_eq!(ids.len(), 3);
    let unici: std::collections::BTreeSet<u64> = ids.iter().map(|BatchId(n)| *n).collect();
    assert_eq!(
        unici.len(),
        3,
        "due lotti diversi hanno id diversi: è l'unica cosa che l'identità \
         promette, e basta a correlare gli eventi col loro terminale"
    );
}
