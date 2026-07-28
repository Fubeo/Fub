//! Il confine, e quante volte si scrive la sua disciplina (seduta 7).
//!
//! Qui si prova ciò che le sei voci hanno cambiato, e ognuna delle quattro
//! sezioni prova una cosa che **prima non era esprimibile**:
//!
//! - **§7.3** i permessi hanno un punto di applicazione: `PluginPermissions`
//!   esisteva nel contratto e non lo leggeva nessuno;
//! - **§7.4** un id ha un proprietario, e una collisione è un errore invece di
//!   un secondo provider irraggiungibile in silenzio;
//! - **§7.5** due plugin si possono chiamare, e chi dipende da ciò che non c'è
//!   non si monta;
//! - **§7.6** c'è un inventario di ciò che è attivo.
//!
//! Il §7.1 e il §7.2 non hanno una sezione loro, e non è una dimenticanza: la
//! scomposizione dell'`HostApi` è provata dal **compilatore** (un `ReadApi` non
//! ha le capacità di scrittura: se le avesse, `render_view` chiamerebbe una
//! funzione che non esiste), e la disciplina di consegna unificata è provata da
//! ogni test che c'era già — `provider_reentrancy`, `index_feeding`,
//! `view_invalidation` girano tutti sullo stesso `Workspace::lend`.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::error::PluginError;
use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::options::permission;
use fubmd_abi::traits::{
    HostApi, IndexProvider, IndexQuery, IndexResult, PluginManifest, PluginPermissions, QueryKind,
    QueryRoute, ReadApi, ServiceProvider, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_kernel::{
    FormatRegistry, PluginRegistry, RegistrationKind, RegistryError, Trust, Workspace,
};

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    let ws = Workspace::new(&root, FormatRegistry::new());
    (dir, ws)
}

/// Una view che non fa niente: serve a **nominare** qualcosa.
struct Vista(&'static str);

impl ViewProvider for Vista {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(self.0, self.0, ViewSurface::RightSidebar)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("niente"))
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

/// Una view che **cambia idea** su ciò che offre: serve a `refresh_specs`.
#[derive(Clone)]
struct VistaMutevole(Arc<Mutex<Vec<String>>>);

impl VistaMutevole {
    fn che_offre(ids: &[&str]) -> Self {
        VistaMutevole(Arc::new(Mutex::new(
            ids.iter().map(|id| id.to_string()).collect(),
        )))
    }

    /// Da adesso dichiara questi, e il kernel non lo sa finché non glielo si
    /// chiede: è l'altra metà di «le spec sono dato di registrazione».
    fn adesso_dice(&self, ids: &[&str]) {
        *self.0.lock().expect("lock") = ids.iter().map(|id| id.to_string()).collect();
    }
}

impl ViewProvider for VistaMutevole {
    fn views(&self) -> Vec<ViewSpec> {
        self.0
            .lock()
            .expect("lock")
            .iter()
            .map(|id| ViewSpec::new(id, id, ViewSurface::RightSidebar))
            .collect()
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        Ok(UiNode::text("niente"))
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

/// Un indice che non indicizza niente: serve a **rivendicare** una rotta.
struct Indice(&'static str);

impl IndexProvider for Indice {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(self.0.to_string()))]
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_document_indexed(&mut self, _doc: &DocumentModel) {}

    fn on_document_removed(&mut self, _id: &DocId) {}

    fn reconcile(&mut self, _ids: &[DocId]) {}

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Ok(IndexResult::Custom(serde_json::Value::Null))
    }
}

// ---------------------------------------------------------------------------
// §7.3 — i permessi hanno un punto di applicazione
// ---------------------------------------------------------------------------

#[test]
fn a_plugin_without_write_vault_cannot_write_even_though_the_host_could() {
    let (_dir, mut ws) = vault();
    // Legge e basta: è ciò che il manifest dichiara, ed è la prima volta che
    // dichiararlo cambia qualcosa.
    ws.register_plugin(
        PluginManifest::new("terzi.lettore", "Lettore")
            .granting(PluginPermissions::of(&[permission::READ_VAULT])),
        Trust::Community,
    )
    .expect("dichiarato");

    ws.with_host("terzi.lettore", |host| {
        // Le letture passano.
        host.list_documents(None).expect("legge il vault");

        // Le scritture no, e il messaggio dice **chi** e **cosa gli manca**:
        // un rifiuto che non lo dicesse non sarebbe diagnosticabile in un
        // montaggio con venti plugin.
        let err = host
            .write_document(&DocId::new("a.md"), "ciao")
            .expect_err("non ha `write-vault`");
        let PluginError::PermissionDenied(msg) = &err else {
            panic!("atteso permesso negato, trovato {err:?}");
        };
        assert!(msg.to_string().contains("terzi.lettore"), "{msg}");
        assert!(msg.to_string().contains(permission::WRITE_VAULT), "{msg}");

        // E le strutturali sono una famiglia a parte, negata dallo stesso
        // permesso: non è la scrittura di testo con un altro nome.
        assert!(matches!(
            host.trash_document(&DocId::new("a.md")),
            Err(PluginError::PermissionDenied(_))
        ));
    });
}

#[test]
fn a_revoked_plugin_gets_nothing_at_all_not_even_reading() {
    let (_dir, mut ws) = vault();
    // Permessi pieni **e** revocato: `Trust::Revoked` non è un grado di fiducia
    // più basso, è l'assenza del permesso di essere eseguiti.
    ws.register_plugin(
        PluginManifest::new("terzi.revocato", "Revocato").granting(PluginPermissions::core()),
        Trust::Revoked,
    )
    .expect("dichiarato");

    ws.with_host("terzi.revocato", |host| {
        let err = host
            .list_documents(None)
            .expect_err("un revocato non legge nemmeno");
        assert!(
            matches!(&err, PluginError::PermissionDenied(msg) if msg.to_string().contains("revocato")),
            "{err:?}"
        );
    });
}

#[test]
fn an_undeclared_id_is_refused_and_not_granted_in_blank() {
    let (_dir, mut ws) = vault();
    // Nessuna dichiarazione. Prima questo id avrebbe ricevuto l'host intero:
    // `KernelHost` portava una stringa e nient'altro, quindi non aveva modo di
    // negare niente a nessuno.
    ws.with_host("chi.sono.io", |host| {
        let err = host
            .list_documents(None)
            .expect_err("un id non dichiarato non è un plugin");
        assert!(
            matches!(&err, PluginError::PermissionDenied(msg) if msg.to_string().contains("non è un plugin dichiarato")),
            "{err:?}"
        );
    });
}

#[test]
fn the_two_policies_compose_and_the_first_reason_is_the_one_read() {
    // La combinatoria del §7.3, senza un tipo per combinazione: un comando
    // simulato di un plugin senza permessi ha **due** ragioni per essere
    // negato, e chi legge ne vede una — quella che si applica per prima.
    let (_dir, mut ws) = vault();
    ws.register_plugin(
        PluginManifest::new("terzi.muto", "Muto").granting(PluginPermissions::default()),
        Trust::Community,
    )
    .expect("dichiarato");

    ws.with_host("terzi.muto", |host| {
        let err = host
            .read_document(&DocId::new("a.md"))
            .expect_err("non ha nemmeno `read-vault`");
        assert!(matches!(err, PluginError::PermissionDenied(_)), "{err:?}");
    });
}

#[test]
fn the_capabilities_that_cannot_say_no_give_the_null_answer() {
    let (_dir, mut ws) = vault();
    // Serve una politica che neghi **tutto**, perché l'orologio e il contesto
    // non hanno un permesso che li governi: sono ciò che l'host sa e il guest
    // no, non una risorsa del vault. Chi li perde è chi non gira affatto.
    ws.register_plugin(
        PluginManifest::new("terzi.revocato", "Revocato").granting(PluginPermissions::core()),
        Trust::Revoked,
    )
    .expect("dichiarato");

    ws.with_host("terzi.revocato", |host| {
        // Cinque capacità del contratto non restituiscono un `Result`. Negarle
        // non ha un canale, e la risposta nulla è ciò che resta: il nome che è
        // stato passato, nessun formato, il tempo a zero. È una proprietà di
        // quelle firme, ed è la ragione per cui una capacità nuova dovrebbe
        // portare un esito anche quando "non può fallire".
        assert_eq!(host.free_name(&DocId::new("a.md")), DocId::new("a.md"));
        assert!(host.format_of(&DocId::new("a.md")).is_none());
        assert_eq!(host.now_unix_millis(), 0);
        assert!(host.active_context().is_none());
    });
}

// ---------------------------------------------------------------------------
// §7.4 — un id ha un proprietario
// ---------------------------------------------------------------------------

#[test]
fn a_view_id_already_taken_is_refused_and_the_loser_does_not_register() {
    let (_dir, mut ws) = vault();
    ws.register_core_feature("fubmd.uno", "Uno").expect("uno");
    ws.register_core_feature("fubmd.due", "Due").expect("due");

    ws.register_view_provider("fubmd.uno", Box::new(Vista("pannello")))
        .expect("il primo si registra");
    let err = ws
        .register_view_provider("fubmd.due", Box::new(Vista("pannello")))
        .expect_err("il secondo rivendica lo stesso id");
    let RegistryError::Claimed {
        kind,
        id,
        incumbent,
        challenger,
    } = &err
    else {
        panic!("atteso un conflitto, trovato {err:?}");
    };
    assert_eq!((*kind, id.as_str()), (RegistrationKind::View, "pannello"));
    assert_eq!(
        (incumbent.as_str(), challenger.as_str()),
        ("fubmd.uno", "fubmd.due")
    );

    // E il perdente **non si è registrato affatto**: prima vinceva il primo e
    // la seconda view restava irraggiungibile in silenzio, il che da fuori è
    // indistinguibile da un id sbagliato.
    assert_eq!(ws.views().len(), 1);
}

#[test]
fn a_third_party_cannot_name_bare_and_the_message_says_what_to_write() {
    let (_dir, mut ws) = vault();
    ws.register_plugin(
        PluginManifest::new("com.acme.tasks", "Tasks").granting(PluginPermissions::core()),
        Trust::Community,
    )
    .expect("dichiarato");

    let err = ws
        .register_view_provider("com.acme.tasks", Box::new(Vista("board")))
        .expect_err("un id nudo da un terzo è quello che collide in silenzio");
    assert!(
        err.to_string().contains("com.acme.tasks:board"),
        "il messaggio deve portare l'id giusto: {err}"
    );

    // Dentro il proprio namespace invece passa, e nessun altro plugin ci può
    // entrare: è la proprietà che rende impossibile una collisione fra terzi.
    ws.register_view_provider("com.acme.tasks", Box::new(Vista("com.acme.tasks:board")))
        .expect("il suo namespace è suo");
}

#[test]
fn replacing_is_asked_for_by_name_and_leaves_one_owner() {
    let (_dir, mut ws) = vault();
    ws.register_core_feature("fubmd.uno", "Uno").expect("uno");
    ws.register_core_feature("fubmd.due", "Due").expect("due");
    ws.register_view_provider("fubmd.uno", Box::new(Vista("pannello")))
        .expect("il primo");

    // La stessa disciplina delle rotte (decisione 0019) e dei formati
    // (decisione 0017): sostituire resta possibile, ma si chiede.
    ws.replace_view_provider("fubmd.due", Box::new(Vista("pannello")))
        .expect("sostituire si può, chiedendolo");
    assert_eq!(ws.views().len(), 1, "una view, un proprietario");
    assert_eq!(
        ws.plugins()
            .iter()
            .filter(|p| p
                .registrations
                .iter()
                .any(|r| r.kind == RegistrationKind::View))
            .map(|p| p.id.clone())
            .collect::<Vec<_>>(),
        vec!["fubmd.due".to_string()],
        "e l'inventario non tiene il ricordo di chi è stato sostituito"
    );
}

#[test]
fn a_refused_replacement_does_not_take_away_the_one_who_was_there() {
    let (_dir, mut ws) = vault();
    ws.register_core_feature("fubmd.backlinks", "Backlinks")
        .expect("il core");
    ws.register_view_provider("fubmd.backlinks", Box::new(Vista("backlinks")))
        .expect("registrata");
    ws.register_plugin(
        PluginManifest::new("com.acme.tasks", "Tasks"),
        Trust::Community,
    )
    .expect("dichiarato");

    // Una sostituzione ha due effetti — togliere chi c'era, mettersi al suo
    // posto — e il permesso va chiesto prima di **entrambi**. Chiesto in mezzo,
    // il rifiuto lasciava il vault senza la view del core: il varco era che un
    // terzo poteva cancellare un id che non poteva nemmeno nominare.
    let err = ws
        .replace_view_provider("com.acme.tasks", Box::new(Vista("backlinks")))
        .expect_err("un terzo non nomina `backlinks` nudo, nemmeno per sostituirla");
    assert!(
        matches!(&err, RegistryError::Namespace(_)),
        "atteso un rifiuto sui nomi, trovato {err:?}"
    );
    assert_eq!(
        ws.views().len(),
        1,
        "un rifiuto vuol dire «non è registrato», non «l'altro è sparito»"
    );

    // E lo stesso per chi non si è dichiarato affatto: è l'altro modo in cui
    // `admit` dice di no, e da fuori il danno sarebbe stato identico.
    let err = ws
        .replace_view_provider("mai.dichiarato", Box::new(Vista("backlinks")))
        .expect_err("un id non dichiarato non registra niente");
    assert!(
        matches!(&err, RegistryError::UnknownPlugin(_)),
        "atteso un id sconosciuto, trovato {err:?}"
    );
    assert_eq!(ws.views().len(), 1, "e la view del core è ancora sua");
    assert_eq!(
        ws.plugins()
            .iter()
            .find(|p| p.id == "fubmd.backlinks")
            .expect("il core è nell'inventario")
            .registrations
            .len(),
        1,
        "l'inventario deve dire ancora che `backlinks` è del core"
    );
}

#[test]
fn a_refused_index_replacement_does_not_leave_the_route_without_an_owner() {
    let (_dir, mut ws) = vault();
    ws.register_core_feature("fubmd.tasks", "Tasks")
        .expect("il core");
    ws.register_index_provider("fubmd.tasks", Box::new(Indice("fubmd:tasks")))
        .expect("registrato");
    ws.register_plugin(
        PluginManifest::new("com.acme.tasks", "Tasks"),
        Trust::Community,
    )
    .expect("dichiarato");

    // Qui il danno era più silenzioso che per le view: la rotta restava servita
    // da chi c'era, e a perdersi era la riga dell'inventario — cioè il §7.6
    // diceva che `fubmd:tasks` non è di nessuno mentre qualcuno rispondeva.
    let err = ws
        .replace_index_provider("com.acme.tasks", Box::new(Indice("fubmd:tasks")))
        .expect_err("il namespace `fubmd` non è di un terzo");
    assert!(
        matches!(&err, RegistryError::Namespace(_)),
        "atteso un rifiuto sui nomi, trovato {err:?}"
    );
    assert_eq!(
        ws.plugins()
            .iter()
            .find(|p| p.id == "fubmd.tasks")
            .expect("il core è nell'inventario")
            .registrations
            .len(),
        1,
        "l'inventario deve dire ancora che `fubmd:tasks` è del core"
    );
}

#[test]
fn changing_ones_mind_does_not_get_around_the_rule_of_names() {
    let (_dir, mut ws) = vault();
    ws.register_core_feature("fubmd.uno", "Uno").expect("uno");
    ws.register_view_provider("fubmd.uno", Box::new(Vista("pannello")))
        .expect("il core");
    ws.register_plugin(
        PluginManifest::new("com.acme.tasks", "Tasks"),
        Trust::Community,
    )
    .expect("dichiarato");

    let acme = VistaMutevole::che_offre(&["com.acme.tasks:board"]);
    ws.register_view_provider("com.acme.tasks", Box::new(acme.clone()))
        .expect("il suo namespace è suo");

    // Registrarsi con un id ammissibile e poi dichiararne un altro era l'ultimo
    // modo di aggirare la regola dei nomi: le spec si rileggevano e basta.
    acme.adesso_dice(&["board"]);
    let err = ws
        .refresh_specs("com.acme.tasks")
        .expect_err("un id nudo resta inammissibile anche a chi cambia idea");
    assert!(
        matches!(&err, RegistryError::Namespace(_)),
        "atteso un rifiuto sui nomi, trovato {err:?}"
    );

    // E il nome di **qualcun altro** resta suo anche quando chi lo chiede
    // potrebbe nominarlo: fra due feature del core la regola dei nomi non dice
    // niente, e ciò che decide è la contesa.
    ws.register_core_feature("fubmd.due", "Due").expect("due");
    let due = VistaMutevole::che_offre(&["sua"]);
    ws.register_view_provider("fubmd.due", Box::new(due.clone()))
        .expect("registrata");
    due.adesso_dice(&["pannello"]);
    let err = ws
        .refresh_specs("fubmd.due")
        .expect_err("`pannello` è di `fubmd.uno`");
    assert!(
        matches!(&err, RegistryError::Claimed { incumbent, .. } if incumbent == "fubmd.uno"),
        "atteso un id già rivendicato, trovato {err:?}"
    );

    // Un rifiuto non cambia niente: né le spec, né l'inventario.
    let mut viste = ws.views().iter().map(|s| s.id.clone()).collect::<Vec<_>>();
    viste.sort();
    assert_eq!(viste, vec!["com.acme.tasks:board", "pannello", "sua"]);
}

#[test]
fn the_inventory_follows_a_provider_that_changes_its_mind() {
    let (_dir, mut ws) = vault();
    ws.register_core_feature("fubmd.uno", "Uno").expect("uno");
    let provider = VistaMutevole::che_offre(&["prima"]);
    ws.register_view_provider("fubmd.uno", Box::new(provider.clone()))
        .expect("registrata");

    // Ne aggiunge una e ne toglie una: l'inventario del §7.6 deve dire lo
    // **stato**, non la registrazione — o «cosa è attivo» risponderebbe con
    // ciò che era attivo il primo giorno.
    provider.adesso_dice(&["seconda", "terza"]);
    ws.refresh_specs("fubmd.uno").expect("sono nomi suoi");

    let ids = |ws: &Workspace| {
        let mut ids = ws
            .plugins()
            .iter()
            .find(|p| p.id == "fubmd.uno")
            .expect("nell'inventario")
            .registrations
            .iter()
            .filter(|r| r.kind == RegistrationKind::View)
            .map(|r| r.id.clone())
            .collect::<Vec<_>>();
        ids.sort();
        ids
    };
    assert_eq!(ids(&ws), vec!["seconda", "terza"]);

    // E il nome lasciato è **libero**: se l'inventario tenesse il ricordo,
    // nessun altro potrebbe più prenderlo e nessuno saprebbe perché.
    ws.register_core_feature("fubmd.due", "Due").expect("due");
    ws.register_view_provider("fubmd.due", Box::new(Vista("prima")))
        .expect("`prima` non è più di nessuno");

    // Un provider che non offre più niente non lascia una riga di ricordo.
    provider.adesso_dice(&[]);
    ws.refresh_specs("fubmd.uno")
        .expect("non offrire è una scelta");
    assert!(ids(&ws).is_empty());
}

// ---------------------------------------------------------------------------
// §7.5 — i plugin si parlano
// ---------------------------------------------------------------------------

/// Un servizio che risponde a un metodo solo.
struct Contatore;

impl ServiceProvider for Contatore {
    fn call(
        &self,
        service: &str,
        method: &str,
        args: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        match method {
            // Legge il vault con le **proprie** capacità: chi chiama non gli
            // presta le sue, e lui non presta le proprie a chi chiama.
            "quante" => Ok(serde_json::json!(host.list_documents(None)?.total)),
            "eco" => Ok(args),
            altro => Err(PluginError::BadArgs(
                format!("`{service}` non conosce `{altro}`").into(),
            )),
        }
    }
}

#[test]
fn a_plugin_calls_another_and_gets_an_answer_back() {
    let (_dir, mut ws) = vault();
    ws.register_plugin(
        PluginManifest::core("com.acme.db", "DB").providing(&["com.acme.db"]),
        Trust::Core,
    )
    .expect("chi offre");
    ws.register_service_provider("com.acme.db", Box::new(Contatore))
        .expect("registrato");
    ws.register_plugin(
        PluginManifest::core("com.acme.charts", "Charts").requiring(&["com.acme.db"]),
        Trust::Core,
    )
    .expect("chi chiede");

    let risposta = ws.with_host("com.acme.charts", |host| {
        host.call_service("com.acme.db", "eco", serde_json::json!({"x": 1}))
    });
    assert_eq!(
        risposta.expect("il servizio risponde"),
        serde_json::json!({"x": 1})
    );

    // Un metodo che non c'è è `bad-args`: la domanda è arrivata a chi la doveva
    // ricevere, ed è malposta.
    let err = ws
        .with_host("com.acme.charts", |host| {
            host.call_service("com.acme.db", "boh", serde_json::Value::Null)
        })
        .expect_err("metodo ignoto");
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");
}

#[test]
fn a_service_nobody_offers_is_unserved_not_an_internal_error() {
    let (_dir, mut ws) = vault();
    ws.register_core_feature("fubmd.solo", "Solo")
        .expect("solo");

    let err = ws
        .with_host("fubmd.solo", |host| {
            host.call_service("com.acme.db", "quante", serde_json::Value::Null)
        })
        .expect_err("nessuno lo offre");
    // «Nessuno lo serve» e «chi lo serve ha fallito» sono due risposte diverse,
    // e chi disegna deve poter scegliere fra «installa il plugin» e «qualcosa è
    // andato storto». È la stessa distinzione della decisione 0019.
    assert!(matches!(err, PluginError::Unserved(_)), "{err:?}");
}

#[test]
fn a_plugin_whose_requirement_is_missing_is_not_declared_at_all() {
    let (_dir, mut ws) = vault();
    let err = ws
        .register_plugin(
            PluginManifest::core("com.acme.charts", "Charts").requiring(&["com.acme.db"]),
            Trust::Core,
        )
        .expect_err("il requisito non c'è");
    let RegistryError::MissingRequirement { plugin, requires } = &err else {
        panic!("atteso un requisito mancante, trovato {err:?}");
    };
    assert_eq!(plugin, "com.acme.charts");
    assert_eq!(requires, &["com.acme.db".to_string()]);

    // «Non si dichiara affatto» è la semantica scelta, e si vede: non c'è un
    // plugin attivo-ma-degradato da gestire in ogni feature che lo incontra.
    assert!(ws.plugins().is_empty());
}

#[test]
fn a_service_cannot_be_offered_twice_nor_named_by_someone_else() {
    let (_dir, mut ws) = vault();
    ws.register_plugin(
        PluginManifest::core("com.acme.db", "DB").providing(&["com.acme.db"]),
        Trust::Core,
    )
    .expect("il primo");

    // Lo stesso `ns` da un secondo plugin: è una contesa come quella di una
    // view, e si vede alla dichiarazione.
    let err = ws
        .register_plugin(
            PluginManifest::core("com.altri.db", "Altro DB").providing(&["com.acme.db"]),
            Trust::Core,
        )
        .expect_err("il servizio è già offerto");
    assert!(matches!(err, RegistryError::Claimed { .. }), "{err:?}");

    // E un terzo non può nemmeno **nominare** un servizio fuori dal proprio
    // namespace: la regola del §7.4 vale anche qui.
    let err = ws
        .register_plugin(
            PluginManifest::new("com.altri.db", "Altro DB").providing(&["com.acme.altro"]),
            Trust::Community,
        )
        .expect_err("il namespace non è suo");
    assert!(matches!(err, RegistryError::Namespace(_)), "{err:?}");
}

#[test]
fn a_service_that_calls_itself_is_refused_by_name() {
    /// Un servizio che si richiama: senza la catena sarebbe uno stack overflow.
    struct Ouroboros;
    impl ServiceProvider for Ouroboros {
        fn call(
            &self,
            service: &str,
            _method: &str,
            _args: serde_json::Value,
            host: &mut dyn HostApi,
        ) -> Result<serde_json::Value, PluginError> {
            host.call_service(service, "ancora", serde_json::Value::Null)
        }
    }

    let (_dir, mut ws) = vault();
    ws.register_plugin(
        PluginManifest::core("com.acme.giro", "Giro").providing(&["com.acme.giro"]),
        Trust::Core,
    )
    .expect("dichiarato");
    ws.register_service_provider("com.acme.giro", Box::new(Ouroboros))
        .expect("registrato");

    let err = ws
        .call_service("com.acme.giro", "vai", serde_json::Value::Null)
        .expect_err("il giro va rifiutato");
    // Nominare il giro è la differenza fra un errore che si corregge e una
    // profondità massima che si aggira.
    assert!(
        matches!(&err, PluginError::BadArgs(msg) if msg.to_string().contains("com.acme.giro → com.acme.giro")),
        "{err:?}"
    );
}

// ---------------------------------------------------------------------------
// §7.6 — l'inventario di ciò che è attivo
// ---------------------------------------------------------------------------

#[test]
fn the_inventory_says_who_is_active_with_what_and_what_they_registered() {
    let (_dir, mut ws) = vault();
    ws.register_core_feature("fubmd.pannelli", "Pannelli")
        .expect("core");
    ws.register_view_provider("fubmd.pannelli", Box::new(Vista("pannello")))
        .expect("registrata");
    ws.register_plugin(
        PluginManifest::new("com.acme.tasks", "Tasks")
            .granting(PluginPermissions::of(&[permission::READ_VAULT])),
        Trust::Community,
    )
    .expect("terzi");

    let inventario = ws.plugins();
    assert_eq!(
        inventario.len(),
        2,
        "chi è dichiarato compare, anche se non ha registrato niente"
    );

    let pannelli = &inventario[0];
    assert_eq!(pannelli.trust, Trust::Core);
    assert_eq!(
        pannelli
            .registrations
            .iter()
            .map(|r| (r.kind, r.id.as_str()))
            .collect::<Vec<_>>(),
        vec![(RegistrationKind::View, "pannello")]
    );

    // I permessi ci sono **con i loro parametri**: è la mappa del manifest, non
    // un elenco di booleani — che è la forma che il §7.6 vuole far sparire.
    let tasks = &inventario[1];
    assert!(tasks.permissions.enabled(permission::READ_VAULT));
    assert!(!tasks.permissions.enabled(permission::WRITE_VAULT));
    assert!(
        tasks.registrations.is_empty(),
        "un plugin dichiarato che non ha registrato niente è precisamente ciò \
         che si vuole poter vedere"
    );
}

#[test]
fn declaring_the_same_plugin_twice_is_a_conflict() {
    let mut registro = PluginRegistry::new();
    registro
        .declare(PluginManifest::core("fubmd.uno", "Uno"), Trust::Core)
        .expect("il primo");
    let err = registro
        .declare(PluginManifest::core("fubmd.uno", "Bis"), Trust::Core)
        .expect_err("due plugin con lo stesso id");
    assert!(matches!(err, RegistryError::DuplicatePlugin(_)), "{err:?}");
}
