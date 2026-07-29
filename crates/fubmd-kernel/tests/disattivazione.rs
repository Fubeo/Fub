//! **Come un componente smette, e come si chiude il vault** (§9.2 + §9.4,
//! decisione 0028; §9.5, decisione 0029).
//!
//! Prima di questa seduta il kernel sapeva solo aggiungere: `register_*` faceva
//! `push`, `IndexProvider` non aveva un `close`, e "spento" poteva voler dire
//! una cosa sola — non registrato all'avvio, deciso da una variabile
//! d'ambiente. Qui si prova l'inverso: che `deactivate_plugin` **toglie
//! davvero**, che l'ultima cosa che un indice riceve sono `flush` e poi `close`,
//! e che ciò che resta non eredita ciò che se n'è andato.
//!
//! L'ultimo punto è quello che si sarebbe scoperto tardi: le rotte del canale
//! dati puntano a una **posizione** nell'elenco degli indici, e togliere il
//! primo di due, senza rimappare, manderebbe le domande del primo al secondo —
//! che risponderebbe, e nessuno avrebbe modo di accorgersi che sta rispondendo
//! per conto di un altro.
//!
//! In coda ci sono le due prove della **chiusura del vault**, che è la stessa
//! cosa fatta a tutti in una volta: l'ordine — l'evento mentre si può ancora
//! scrivere, poi il flush, poi chi smette — e l'idempotenza.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Event, EventKind, EventMask, Notice};
use fubmd_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::traits::{
    EventHandler, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, JobSpec,
    PluginManifest, PluginPermissions, QueryKind, QueryRoute, ReadApi, ViewInstance, ViewProvider,
    ViewSpec, ViewSurface,
};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_kernel::{FormatRegistry, RegistryError, Trust, Workspace};

// --- il minimo indispensabile per avere un vault ----------------------------

struct PlainProvider;

impl FormatProvider for PlainProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("plain", "Testo semplice (test)", &["txt"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
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

// --- una spia che registra la propria vita ----------------------------------

/// Cosa un indice ha ricevuto, in ordine.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Vita {
    Attivato,
    Indicizzato(String),
    Flush,
    Chiuso,
    Interrogato,
}

/// Un indice che serve **una** famiglia custom e scrive la propria vita su un
/// registro condiviso.
struct Spia {
    ns: &'static str,
    vita: Arc<Mutex<Vec<Vita>>>,
}

impl Spia {
    fn nuova(ns: &'static str) -> (Self, Arc<Mutex<Vec<Vita>>>) {
        let vita = Arc::new(Mutex::new(Vec::new()));
        (
            Spia {
                ns,
                vita: vita.clone(),
            },
            vita,
        )
    }

    fn segna(&self, v: Vita) {
        self.vita.lock().unwrap().push(v);
    }
}

impl IndexProvider for Spia {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(self.ns.to_string()))]
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.segna(Vita::Attivato);
        Ok(())
    }

    /// Una voce **per documento** anche se l'alimentazione è a lotti: la spia
    /// serve a dire *quali* documenti sono arrivati, e contare i lotti non lo
    /// direbbe.
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        for doc in docs {
            self.segna(Vita::Indicizzato(doc.id.to_string()));
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.segna(Vita::Flush);
        Ok(())
    }

    /// La chiusura ha l'host, e la spia lo usa: è il punto in cui un indice
    /// persistente lascia scritto di essersi chiuso bene.
    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.segna(Vita::Chiuso);
        host.data_write("chiuso", b"si")?;
        Ok(())
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        self.segna(Vita::Interrogato);
        Ok(IndexResult::Custom(serde_json::json!({ "da": self.ns })))
    }
}

// --- gli altri quattro modi di registrarsi ----------------------------------

struct Pannello(&'static str);

impl ViewProvider for Pannello {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(self.0, "Pannello", ViewSurface::RightSidebar)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("ciao"))
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        _action: UiAction,
        _host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::None)
    }
}

struct Ascoltatore(Arc<Mutex<u32>>);

impl EventHandler for Ascoltatore {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, _notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        *self.0.lock().unwrap() += 1;
        Ok(())
    }
}

struct Regola(&'static str);

impl SyntaxRule for Regola {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: self.0.to_string(),
            format: "plain".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["prova".into()],
            },
            order: 0,
            option: None,
            produces: vec![format!("{}:blocco", ns_of(self.0))],
        }
    }

    fn apply(
        &self,
        _m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(None)
    }
}

struct Disegnatore(&'static str);

impl CustomRenderer for Disegnatore {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: self.0.to_string(),
            kinds: vec![format!("{}:blocco", ns_of(self.0))],
        }
    }

    fn render(
        &self,
        _block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        Ok(CustomRendering::Fallback)
    }
}

/// Il namespace di un id `ns:nome`.
fn ns_of(id: &str) -> &str {
    id.split_once(':').map(|(ns, _)| ns).unwrap_or(id)
}

// --- il banco ---------------------------------------------------------------

struct Banco {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Banco {
    fn nuovo() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("a.txt"), "ciao").unwrap();
        Banco { _dir: dir, root }
    }

    fn workspace(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry.register(Box::new(PlainProvider)).expect("formato");
        let mut ws = Workspace::new(&self.root, registry);
        for id in ["prova.uno", "prova.due"] {
            dichiara(&mut ws, id);
        }
        ws
    }
}

/// Dichiara un plugin **non** del core: i suoi nomi vivono sotto il proprio id
/// (§7.4), che è ciò che serve a una regola sintattica e a un renderer — i loro
/// id vogliono un namespace, e per il core quel namespace sarebbe `fubmd`.
///
/// I permessi sono quelli di una feature ufficiale perché qui si prova il ciclo
/// di vita, non il §7.3: senza `write_vault` un handler che scrive riceverebbe
/// un rifiuto, e il test parlerebbe della politica invece che della chiusura.
fn dichiara(ws: &mut Workspace, id: &str) {
    ws.register_plugin(
        PluginManifest::new(id, id).granting(PluginPermissions::core()),
        Trust::Community,
    )
    .expect("dichiarato");
}

fn vita(log: &Arc<Mutex<Vec<Vita>>>) -> Vec<Vita> {
    log.lock().unwrap().clone()
}

fn custom(ns: &str) -> IndexQuery {
    IndexQuery::Custom {
        ns: ns.to_string(),
        query: serde_json::Value::Null,
    }
}

// --- le prove ---------------------------------------------------------------

/// L'ultima cosa che un indice riceve sono `flush` e **poi** `close`, in
/// quest'ordine — e dopo non riceve più niente, nemmeno l'alimentazione.
#[test]
fn un_indice_disattivato_riceve_flush_poi_close_e_poi_nientaltro() {
    let banco = Banco::nuovo();
    let mut ws = banco.workspace();
    let (spia, log) = Spia::nuova("prova.uno:dati");
    ws.register_index_provider("prova.uno", Box::new(spia))
        .expect("registrato");
    ws.reindex().expect("scansione");

    let errori = ws.deactivate_plugin("prova.uno").expect("disattivato");
    assert!(
        errori.is_empty(),
        "nessuno dei due passi è fallito: {errori:?}"
    );

    let coda: Vec<Vita> = vita(&log).into_iter().rev().take(2).rev().collect();
    assert_eq!(
        coda,
        vec![Vita::Flush, Vita::Chiuso],
        "il contratto dice flush e poi close: chi arriva alla chiusura ha già \
         avuto il proprio punto di persistenza"
    );

    // E la chiusura ha davvero avuto un host: ha scritto nel proprio spazio
    // dati, che è ciò che un `Drop` non avrebbe potuto fare.
    let dati = ws.plugin_data_dir("prova.uno").expect("spazio dati");
    assert!(
        dati.join("chiuso").exists(),
        "`close` riceve l'HostApi, e ciò che ci scrive resta"
    );

    let prima = vita(&log).len();
    std::fs::write(banco.root.join("b.txt"), "nuovo").unwrap();
    ws.write_document(&DocId::new("b.txt"), "nuovo")
        .expect("scrittura");
    assert_eq!(
        vita(&log).len(),
        prima,
        "un indice chiuso non viene più alimentato: se lo fosse, terrebbe uno \
         stato che nessuno flusherà mai"
    );
}

/// Le rotte di chi se ne va **spariscono**, e quelle di chi resta restano sue.
///
/// È il caso che si sarebbe scoperto in silenzio: un bersaglio è una posizione
/// nell'elenco, e senza rimappatura la domanda del primo finirebbe al secondo.
#[test]
fn le_rotte_di_chi_se_ne_va_non_passano_a_chi_gli_stava_dietro() {
    let banco = Banco::nuovo();
    let mut ws = banco.workspace();
    let (uno, _log_uno) = Spia::nuova("prova.uno:dati");
    let (due, log_due) = Spia::nuova("prova.due:dati");
    ws.register_index_provider("prova.uno", Box::new(uno))
        .expect("primo");
    ws.register_index_provider("prova.due", Box::new(due))
        .expect("secondo");

    ws.deactivate_plugin("prova.uno").expect("disattivato");

    let orfana = ws.query_index(custom("prova.uno:dati"));
    assert!(
        matches!(orfana, Err(PluginError::Unserved(_))),
        "chi serviva questa famiglia non c'è più, e la risposta giusta è \
         «nessuno la serve»: {orfana:?}"
    );

    let risposta = ws
        .query_index(custom("prova.due:dati"))
        .expect("il secondo c'è");
    assert_eq!(
        risposta,
        IndexResult::Custom(serde_json::json!({ "da": "prova.due:dati" })),
        "e risponde per sé, non per il posto che ha ereditato"
    );
    assert!(
        vita(&log_due).contains(&Vita::Interrogato),
        "la domanda è arrivata davvero a lui"
    );
}

/// Disattivare toglie **tutto** ciò che un plugin aveva registrato, ritira la
/// sua dichiarazione, e libera i nomi che teneva: riaccendere passa dalla porta
/// da cui si era entrati.
#[test]
fn disattivare_toglie_tutto_e_lascia_liberi_i_nomi() {
    let banco = Banco::nuovo();
    let mut ws = banco.workspace();
    let colpi = Arc::new(Mutex::new(0));

    ws.register_view_provider("prova.uno", Box::new(Pannello("prova.uno:pannello")))
        .expect("view");
    ws.register_event_handler("prova.uno", Box::new(Ascoltatore(colpi.clone())))
        .expect("handler");
    ws.register_syntax_rule("prova.uno", Box::new(Regola("prova.uno:regola")))
        .expect("sintassi");
    ws.register_custom_renderer("prova.uno", Box::new(Disegnatore("prova.uno:disegno")))
        .expect("renderer");

    ws.deactivate_plugin("prova.uno").expect("disattivato");

    assert!(ws.views().is_empty(), "la view non è più offerta");
    assert!(
        !ws.plugins().iter().any(|p| p.id == "prova.uno"),
        "e l'inventario del §7.6 non lo elenca più: «dichiarato con zero \
         registrazioni» vuol dire un'altra cosa"
    );

    // L'handler non riceve più: la prova è una scrittura, che di eventi ne
    // produce sempre.
    let prima = *colpi.lock().unwrap();
    std::fs::write(banco.root.join("c.txt"), "x").unwrap();
    ws.write_document(&DocId::new("c.txt"), "x")
        .expect("scrittura");
    assert_eq!(*colpi.lock().unwrap(), prima, "l'handler è staccato");

    // E i nomi sono liberi: chi rientra li riprende, con la stessa strada della
    // prima volta. Se le rivendicazioni di sintassi e renderer fossero rimaste
    // appese, questa riga fallirebbe con un conflitto contro un fantasma.
    dichiara(&mut ws, "prova.uno");
    ws.register_view_provider("prova.uno", Box::new(Pannello("prova.uno:pannello")))
        .expect("l'id della view era libero");
    ws.register_syntax_rule("prova.uno", Box::new(Regola("prova.uno:regola")))
        .expect("la rivendicazione sulla sintassi era libera");
    ws.register_custom_renderer("prova.uno", Box::new(Disegnatore("prova.uno:disegno")))
        .expect("il custom_kind era libero");
}

/// I job che un plugin aveva in coda non partono, e **non spariscono in
/// silenzio**: ognuno riceve il proprio esito.
///
/// È la terza faccia del momento in cui un componente smette — quella che la
/// decisione 0027 aveva lasciato aperta. Il corpo di un job è
/// `Plugin::run_job`: spento il plugin, quel corpo non esiste più, e un job che
/// sparisse senza dirlo lascerebbe chi lo aspetta ad aspettare per sempre.
#[test]
fn i_job_in_coda_di_chi_si_spegne_ricevono_un_esito() {
    let banco = Banco::nuovo();
    let mut ws = banco.workspace();
    let eventi = ws.bus().subscribe();

    let id = ws
        .with_host("prova.uno", |host| {
            host.spawn_job(JobSpec {
                job: "lungo".into(),
                payload: serde_json::Value::Null,
            })
        })
        .expect("il job si accoda");

    ws.deactivate_plugin("prova.uno").expect("disattivato");

    assert!(
        ws.take_pending_jobs().is_empty(),
        "la coda non tiene il lavoro di chi non c'è più"
    );
    let esito = eventi
        .try_iter()
        .find_map(|notice| match notice.event {
            Event::JobDone {
                id: finito,
                ref result,
                ..
            } if finito == id => Some(result.clone()),
            _ => None,
        })
        .expect("il job ha avuto il suo `JobDone`");
    assert!(
        matches!(esito, Err(PluginError::Internal(ref msg)) if msg.to_string().contains("prova.uno")),
        "e l'esito dice cosa è successo, nominando chi si è spento: {esito:?}"
    );
}

/// Un id che nessuno ha dichiarato non si disattiva: è la stessa risposta che
/// riceve chi prova a registrare qualcosa a suo nome.
#[test]
fn un_plugin_che_non_esiste_non_si_disattiva() {
    let banco = Banco::nuovo();
    let mut ws = banco.workspace();
    let esito = ws.deactivate_plugin("prova.mai-vista");
    assert!(
        matches!(esito, Err(RegistryError::UnknownPlugin(id)) if id == "prova.mai-vista"),
        "spegnere ciò che non è acceso non è un no-op: è una domanda su qualcosa \
         che non c'è"
    );
}

// --- la chiusura del vault (§9.5) -------------------------------------------

/// Un handler che, quando il vault sta per chiudersi, scrive ciò che aveva in
/// memoria: è il caso per cui `VaultClosed` esiste.
struct Ultimo;

impl EventHandler for Ultimo {
    fn subscribed(&self) -> EventMask {
        EventMask::of([EventKind::VaultClosed])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        if matches!(notice.event, Event::VaultClosed { .. }) {
            host.write_document(&DocId::new("ultimo.txt"), "detto all'ultimo")?;
        }
        Ok(())
    }
}

/// Chiudere è: **l'ultimo giro sincrono**, poi il punto di consistenza, poi chi
/// smette — e in quest'ordine, o l'ultima scrittura non sarebbe indicizzata da
/// nessuno.
#[test]
fn chiudere_e_lultimo_giro_poi_il_flush_poi_chi_smette() {
    let banco = Banco::nuovo();
    let mut ws = banco.workspace();
    let (spia, log) = Spia::nuova("prova.uno:dati");
    ws.register_index_provider("prova.uno", Box::new(spia))
        .expect("indice");
    ws.register_event_handler("prova.due", Box::new(Ultimo))
        .expect("handler");
    ws.reindex().expect("scansione");

    let errori = ws.close();
    assert!(errori.is_empty(), "niente è andato storto: {errori:?}");

    assert!(
        ws.read_source(&DocId::new("ultimo.txt")).is_ok(),
        "chi riceve `VaultClosed` è ancora registrato e può ancora scrivere"
    );

    let vita = vita(&log);
    let ultimo_indicizzato = vita
        .iter()
        .rposition(|v| matches!(v, Vita::Indicizzato(id) if id == "ultimo.txt"))
        .expect("l'indice ha visto l'ultima scrittura");
    let flush = vita
        .iter()
        .rposition(|v| *v == Vita::Flush)
        .expect("c'è stato un flush");
    let chiuso = vita
        .iter()
        .position(|v| *v == Vita::Chiuso)
        .expect("l'indice è stato chiuso");
    assert!(
        ultimo_indicizzato < flush && flush < chiuso,
        "l'ordine è: l'evento (che fa scrivere), il flush, la chiusura — {vita:?}"
    );
    assert!(
        ws.plugins().is_empty(),
        "e alla fine non è registrato più nessuno"
    );
}

/// Chiudere due volte non è chiudere due volte: la seconda non fa niente e non
/// annuncia una seconda chiusura a nessuno.
#[test]
fn chiudere_due_volte_non_chiude_due_volte() {
    let banco = Banco::nuovo();
    let mut ws = banco.workspace();
    let eventi = ws.bus().subscribe();
    ws.close();
    ws.close();

    let chiusure = eventi
        .try_iter()
        .filter(|n| matches!(n.event, Event::VaultClosed { .. }))
        .count();
    assert_eq!(chiusure, 1, "un vault si chiude una volta sola");
    assert!(ws.is_closed());
}
