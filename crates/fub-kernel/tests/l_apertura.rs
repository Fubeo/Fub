//! **L'apertura di un vault non è tutto-o-niente** (§15.7,
//! [decisione 0068](../../../docs/decisions/0068-un-vault-si-apre-per-quel-che-si-legge.md)).
//!
//! La proprietà sotto esame è una sola, e ha un confine che vale quanto lei:
//!
//! - un documento che non si **legge** o non si **parsa** non fa fallire
//!   l'apertura: finisce fra gli scarti dell'`Apertura`, la sua voce resta in
//!   anagrafe — il file c'è — e nessun indice lo riceve;
//! - la **scansione** invece resta fatale, ed è deliberato: un vault che non sa
//!   dire quali documenti esistono non può aprirsi «in parte», perché
//!   `reconcile` dichiara agli indici l'insieme **completo** e un insieme
//!   incompleto li farebbe potare.
//!
//! I due assi si guardano insieme perché il difetto che questa voce toglie non
//! è «manca la tolleranza»: è che la tolleranza c'era già dieci righe sotto —
//! il flush degli indici — e si fermava un passo prima di dove serviva.

use std::sync::{Arc, Mutex};

use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{Event, EventKind, Severity};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute, VaultEntry,
};
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::{Banco, Montato};

/// Un provider `.md` che rifiuta i sorgenti contenenti `BOOM`.
///
/// Il markdown vero non fallisce quasi mai il parse, ma il contratto lo
/// permette — `FormatProvider::parse` restituisce un `Result` — e prima di
/// questa voce quel `Result` era il modo di non far aprire un vault.
struct FallibleProvider;

impl FormatProvider for FallibleProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("fallibile", "Formato fallibile (test)", &["md"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let source = source.text().unwrap_or_default();
        if source.contains("BOOM") {
            return Err(FormatError::Parse("sorgente rifiutato".into()));
        }
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.to_string();
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

/// Un indice che annota **cosa gli è arrivato**: è il solo modo di distinguere
/// «il documento è in anagrafe» da «il documento è stato indicizzato», che è
/// esattamente la distinzione che uno scarto crea.
#[derive(Clone, Default)]
struct SpiaIndice {
    visti: Arc<Mutex<Vec<String>>>,
    /// L'insieme che `reconcile` ha dichiarato completo, dell'ultimo giro.
    esistenti: Arc<Mutex<Vec<String>>>,
}

impl IndexProvider for SpiaIndice {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }

    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn up_to_date(&self, _entries: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }

    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        let mut visti = self.visti.lock().unwrap();
        for doc in docs {
            visti.push(doc.id.to_string());
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        *self.esistenti.lock().unwrap() = ids.iter().map(|d| d.to_string()).collect();
        Vec::new()
    }

    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::BadArgs("la spia non risponde".into()))
    }

    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
}

/// Un vault montato ma **non ancora aperto**, con la spia degli eventi accesa e
/// un indice che annota. `senza_scansione` è indispensabile: l'apertura da
/// guardare è la prima, e il banco altrimenti l'ha già fatta.
fn banco_da_aprire() -> (Montato, SpiaIndice) {
    let spia = SpiaIndice::default();
    let mut banco = Banco::nuovo()
        .con_formato(Box::new(FallibleProvider))
        .con_plugin("test.spia")
        .con_spia()
        .senza_scansione()
        .monta();
    banco
        .register_index_provider("test.spia".to_string(), Box::new(spia.clone()))
        .expect("l'indice si registra");
    (banco, spia)
}

/// Byte che non sono UTF-8: è ciò che resta di una nota dopo un crash a metà
/// scrittura, o un file binario a cui qualcuno ha dato l'estensione sbagliata.
const NON_UTF8: &[u8] = &[0xff, 0xfe, 0x00, 0x9f];

// --- ciò che si tollera ----------------------------------------------------

#[test]
fn una_nota_illeggibile_non_impedisce_al_vault_di_aprirsi() {
    let (mut banco, spia) = banco_da_aprire();
    std::fs::write(banco.root().join("buona.md"), "sto bene").expect("semina");
    std::fs::write(banco.root().join("rotta.md"), NON_UTF8).expect("semina");
    std::fs::write(banco.root().join("altra.md"), "anche io").expect("semina");

    let apertura = banco.reindex().expect("il vault si apre lo stesso");

    let scartati: Vec<String> = apertura.scartati.iter().map(|s| s.id.to_string()).collect();
    assert_eq!(
        scartati,
        ["rotta.md"],
        "l'apertura segnala cosa non ha letto, e solo quello"
    );
    assert!(!apertura.intera(), "questa apertura non è intera");

    let visti = spia.visti.lock().unwrap().clone();
    assert!(
        visti.contains(&"buona.md".to_string()) && visti.contains(&"altra.md".to_string()),
        "le altre note sono arrivate agli indici: {visti:?}"
    );
    assert!(
        !visti.contains(&"rotta.md".to_string()),
        "ciò che non si è letto non si può indicizzare: {visti:?}"
    );
}

#[test]
fn una_nota_che_il_parser_rifiuta_e_uno_scarto_come_una_che_non_si_legge() {
    let (mut banco, spia) = banco_da_aprire();
    std::fs::write(banco.root().join("buona.md"), "sto bene").expect("semina");
    std::fs::write(banco.root().join("rifiutata.md"), "BOOM").expect("semina");

    let apertura = banco.reindex().expect("il vault si apre lo stesso");

    assert_eq!(
        apertura
            .scartati
            .iter()
            .map(|s| s.id.to_string())
            .collect::<Vec<_>>(),
        ["rifiutata.md"],
        "lettura e parse sono lo stesso caso: il contenuto non si è potuto vedere"
    );
    let visti = spia.visti.lock().unwrap().clone();
    assert_eq!(visti, ["buona.md"], "il resto del vault è arrivato");
}

#[test]
fn il_documento_scartato_resta_in_anagrafe_perche_il_file_c_e() {
    let (mut banco, _) = banco_da_aprire();
    std::fs::write(banco.root().join("buona.md"), "sto bene").expect("semina");
    std::fs::write(banco.root().join("rotta.md"), NON_UTF8).expect("semina");

    banco.reindex().expect("apre");

    // Questa è la riga che separa uno scarto da una cancellazione. La scansione
    // ha visto il file, quindi il file **esiste**: sta nell'albero, ha
    // dimensione e data. Toglierlo dall'anagrafe perché non se ne è letto il
    // contenuto vorrebbe dire far sparire dalla vista dell'utente proprio la
    // nota che ha un problema — cioè nascondere il guasto invece di segnalarlo.
    let IndexResult::Entries(pagina) = banco
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })
        .expect("l'anagrafe risponde")
    else {
        panic!("la risposta all'anagrafe è un'anagrafe");
    };
    let anagrafe: Vec<String> = pagina.items.iter().map(|e| e.id.to_string()).collect();
    assert!(
        anagrafe.contains(&"rotta.md".to_string()),
        "la nota illeggibile esiste lo stesso: {anagrafe:?}"
    );

    // E la controprova, che è ciò che rende questo presidio diverso dal primo:
    // **anagrafe e documenti indicizzati adesso divergono**, e uno scarto è
    // esattamente il caso in cui divergono. Prima di questa voce non potevano:
    // o un documento si parsava, o il vault non si apriva.
    let indicizzati: Vec<String> = banco.documents().iter().map(|d| d.to_string()).collect();
    assert_eq!(
        indicizzati,
        ["buona.md"],
        "di ciò che non si è letto non c'è niente da indicizzare"
    );
}

#[test]
fn ogni_scarto_esce_come_guasto_dopo_che_il_vault_si_e_detto_aperto() {
    let (mut banco, _) = banco_da_aprire();
    std::fs::write(banco.root().join("rotta.md"), NON_UTF8).expect("semina");

    // Ci si iscrive al **bus** e non alla spia del banco: un `EventHandler` con
    // `EventMask::all()` non riceve i guasti — quella maschera non nomina
    // `EventKind::Trouble` — mentre il ponte verso la shell, che è chi li
    // mostra, prende i `Notice` dal bus come si fa qui.
    let rx = banco.bus().subscribe();
    banco.reindex().expect("apre");

    let visti: Vec<Event> = std::iter::from_fn(|| rx.try_recv().ok())
        .map(|n| n.event)
        .collect();

    let guasto = visti
        .iter()
        .position(|e| {
            matches!(
                e,
                Event::Trouble {
                    severity: Severity::Failure,
                    subject: Some(id),
                    ..
                } if id.as_str() == "rotta.md"
            )
        })
        .expect("lo scarto esce come guasto, col documento per soggetto");

    // **`Failure` e non `Warning`**: la regola della 0052 taglia su
    // derivato-contro-autorevole, e qui non si è perso un indice — che si
    // rifà — ma la vista sul contenuto di una nota dell'utente. È anche la
    // ragione per cui uno scarto non è un `IndexLoss`, che esce `Warning`.
    let aperto = visti
        .iter()
        .position(|e| e.kind() == EventKind::VaultOpened)
        .expect("il vault si dice aperto");

    // **L'ordine si è rovesciato con l'apertura a fasi (§15.7), e va letto come
    // un acquisto e non come una perdita.** Finché l'apertura era una chiamata
    // sola, i guasti potevano precedere `VaultOpened` — e la 0068 aveva chiesto
    // che lo facessero, perché chi disegnava il vault appena aperto avesse già
    // in mano ciò che non si era letto. Adesso `VaultOpened` esce quando il
    // vault è **utilizzabile**, cioè prima che qualsiasi documento sia stato
    // aperto: quel lotto non può più esistere, perché scoprire uno scarto vuol
    // dire aver già letto, e leggere è la fase dopo. Ciò che resta promesso è
    // che ogni scarto esca comunque, sulla stessa superficie, mentre
    // l'indicizzazione procede.
    assert!(
        aperto < guasto,
        "il vault si dichiara aperto quando è usabile, e ciò che non si legge arriva mentre indicizza"
    );

    // E la parte che non si è rovesciata: un guasto resta **dentro**
    // l'apertura, cioè arriva prima che l'indicizzazione si dica finita. Chi
    // aspetta `IndexUpdated` per disegnare una ricerca ha già in mano ciò che di
    // quel vault non entrerà mai nei risultati.
    let indicizzato = visti
        .iter()
        .position(|e| e.kind() == EventKind::IndexUpdated)
        .expect("l'indicizzazione si dice finita");
    assert!(
        guasto < indicizzato,
        "uno scarto è un fatto dell'apertura, non una notizia che arriva dopo"
    );
}

// --- il confine: cosa resta fatale -----------------------------------------

#[test]
fn un_vault_che_non_si_scandisce_non_si_apre_a_meta() {
    // La scansione è l'unico passo il cui fallimento riguarda il vault intero
    // e non un suo documento, ed è per questo che `reindex` restituisce ancora
    // un `Result`: senza l'elenco dei file, `reconcile` direbbe agli indici che
    // l'insieme completo è vuoto, e ognuno cancellerebbe tutto ciò che sa.
    // Meglio non aprire — un danno raro e rumoroso — che aprire potando.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = camino::Utf8PathBuf::from_path_buf(dir.path().join("mai-esistita")).expect("utf8");
    let mut ws = Workspace::new(&root, FormatRegistry::new());

    let esito = ws.reindex();

    assert!(
        esito.is_err(),
        "un vault la cui radice non si legge non si apre con un'apertura vuota"
    );
}

#[test]
fn cio_che_non_si_e_letto_resta_fra_i_documenti_che_esistono() {
    let (mut banco, spia) = banco_da_aprire();
    std::fs::write(banco.root().join("buona.md"), "sto bene").expect("semina");
    std::fs::write(banco.root().join("rotta.md"), NON_UTF8).expect("semina");

    banco.reindex().expect("apre");

    // `reconcile` dichiara agli indici l'insieme **completo**, e ognuno cancella
    // ciò che non c'è dentro. Uno scarto non è un documento sparito: costruire
    // quell'insieme dai soli documenti indicizzati farebbe uscire dalla ricerca,
    // in silenzio e alla prima apertura andata storta, proprio la nota che
    // qualcuno vorrà ritrovare.
    let esistenti = spia.esistenti.lock().unwrap().clone();
    assert_eq!(
        esistenti,
        ["buona.md", "rotta.md"],
        "il documento illeggibile esiste, quindi nessun indice deve buttarlo"
    );
}

// --- la forma dell'apertura: due tempi (§15.7, decisione 0070) --------------

/// **Dopo la prima fase il vault sa cosa c'è, e non cosa dicono.**
///
/// È la linea del taglio, e questo presidio la fissa da tutte e due le parti:
/// se l'anagrafe non fosse intera qui, il vault non sarebbe *utilizzabile* al
/// ritorno di `open` — e se gli indici fossero già pieni, non ci sarebbe una
/// seconda fase da fare.
#[test]
fn la_prima_fase_da_l_anagrafe_e_non_l_indice() {
    let (mut banco, spia) = banco_da_aprire();
    std::fs::write(banco.root().join("una.md"), "prima").expect("semina");
    std::fs::write(banco.root().join("due.md"), "seconda").expect("semina");

    let lavoro = banco.scan_vault().expect("la scansione riesce");

    assert_eq!(lavoro.totale(), 2, "il totale lo sa la scansione");
    assert_eq!(lavoro.fatti(), 0, "e non ha ancora guardato niente");
    assert!(
        spia.visti.lock().unwrap().is_empty(),
        "nessun indice è stato alimentato: leggere è la fase dopo"
    );

    // L'anagrafe invece c'è **tutta**, ed è ciò che rende il vault usabile
    // adesso: l'albero dei file si disegna, una nota si apre.
    let entries = match banco.query_index(IndexQuery::Entries {
        of_kind: None,
        within: None,
        page: None,
    }) {
        Ok(IndexResult::Entries(paged)) => paged,
        altro => panic!("attesa l'anagrafe, trovato {altro:?}"),
    };
    let mut nomi: Vec<String> = entries.items.iter().map(|e| e.id.to_string()).collect();
    nomi.sort();
    assert_eq!(nomi, ["due.md", "una.md"]);
}

/// **Un'indicizzazione portata in fondo a fette dà lo stesso vault di `reindex`.**
///
/// È la promessa che rende `reindex` una composizione e non una seconda strada:
/// se le due divergessero, ogni presidio scritto contro `reindex` starebbe
/// provando qualcosa che in produzione non succede più.
#[test]
fn le_fette_arrivano_dove_arriva_il_giro_intero() {
    let (mut banco, spia) = banco_da_aprire();
    std::fs::write(banco.root().join("una.md"), "prima").expect("semina");
    std::fs::write(banco.root().join("due.md"), "seconda").expect("semina");

    let mut lavoro = banco.scan_vault().expect("scansiona");
    while !lavoro.finita() {
        banco.index_batch(&mut lavoro);
    }
    let apertura = banco.finish_index(lavoro);

    assert!(apertura.intera(), "niente scarti e niente interruzioni");
    let mut visti = spia.visti.lock().unwrap().clone();
    visti.sort();
    assert_eq!(visti, ["due.md", "una.md"], "gli indici hanno tutto");
    let mut esistenti = spia.esistenti.lock().unwrap().clone();
    esistenti.sort();
    assert_eq!(
        esistenti,
        ["due.md", "una.md"],
        "e `reconcile` ha dichiarato l'insieme completo"
    );
}

/// **Chi smette a metà non riconcilia**, ed è la riga che separa «ho smesso di
/// indicizzare» da «cancella».
///
/// `reconcile` dice a ogni indice *quali documenti esistono*, e ognuno cancella
/// ciò che non è nell'elenco. Chiamarlo su un'indicizzazione fermata direbbe
/// agli indici di dimenticare tutto ciò che l'interruzione non ha fatto in
/// tempo a nominare — su un vault grande, quasi tutto.
#[test]
fn un_indicizzazione_interrotta_non_dichiara_completo_niente() {
    let (mut banco, spia) = banco_da_aprire();
    std::fs::write(banco.root().join("una.md"), "prima").expect("semina");
    std::fs::write(banco.root().join("due.md"), "seconda").expect("semina");

    // Si scansiona e **non si fa nessuna fetta**: è l'annullamento premuto
    // sull'istante, che è il caso peggiore e quindi quello da fissare.
    let lavoro = banco.scan_vault().expect("scansiona");
    let apertura = banco.finish_index(lavoro);

    assert!(apertura.interrotta, "l'apertura sa di non essere finita");
    assert!(!apertura.intera(), "e quindi non è intera");
    assert!(
        spia.esistenti.lock().unwrap().is_empty(),
        "`reconcile` non è stato chiamato: un insieme incompleto non si dichiara completo"
    );
}
