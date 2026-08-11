//! **Il grafo di un'apertura a caldo è quello di un'apertura a freddo**, e a
//! costruirlo è il `rebuild_graph` di `finish_index`.
//!
//! # Perché questo banco esiste
//!
//! Perché la ricostruzione in blocco *sembra* ridondante e non lo è, e chi la
//! legge senza questo banco davanti conclude il contrario. Il ragionamento che
//! porta fuori strada è questo, ed è quasi giusto: gli indici mantengono il
//! grafo **incrementalmente** (`GraphUpdate::Incremental`, un `upsert` per
//! documento alimentato), quindi in fondo all'apertura il grafo c'è già e
//! rifarlo in blocco è lavoro pagato due volte — tanto più su una riapertura in
//! cui nessun documento è stato riletto, dove sembra che non sia cambiato
//! niente da ricostruire.
//!
//! È **rovesciato**. Un documento ripreso dall'anagrafe non passa da
//! `on_documents_indexed`: passa da `IndexCore::restore`, che il grafo non lo
//! tocca — e lo dice nel proprio commento. Quindi in un'apertura a caldo, che è
//! quella in cui la ricostruzione sembra più inutile, `rebuild_graph` è
//! l'**unica** cosa che costruisce il grafo: saltarla in modo incrementale non
//! toglie del lavoro ridondante, lascia il vault senza backlink e senza link
//! uscenti fino alla prima scrittura.
//!
//! # Chi è stato rosso
//!
//! Questo banco, con la riparazione che sembrava ovvia — `rebuild_graph`
//! chiamato solo in `GraphUpdate::FullRebuild`. Su un vault di 400 note tutte
//! riprese dall'anagrafe, tutte e 400 restavano isolate: zero backlink, zero
//! link uscenti, `[[wikilink]]` che non risolve. Il primo banco lo dice sui
//! numeri, il secondo lo dice sull'unica cosa che l'utente vede.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fub_abi::options::syntax;
use fub_abi::FormatProvider;
use fub_kernel::storage::VaultStorage;
use fub_kernel::{FormatRegistry, MachineSettings, MemStorage, Workspace};

/// Formato `.lnk`: una riga non vuota è il nome di una pagina collegata. È il
/// provider giocattolo di `workspace_incremental.rs`: il kernel non deve
/// conoscere il markdown nemmeno nei propri banchi.
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

    fn render_html(&self, m: &DocumentModel, _o: &RenderOptions) -> Result<String, FormatError> {
        Ok(format!("<pre>{}</pre>", m.text))
    }

    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

const ROOT: &str = "/vault-grafo-a-caldo";
/// Quante note. Il difetto che questo banco tiene fermo non è graduale — o il
/// grafo c'è o non c'è — ma un vault di tre note lascerebbe credere che si
/// tratti di un caso limite.
const NOTE: usize = 400;

fn nome(i: usize) -> String {
    format!("nota{i:04}.lnk")
}

/// Ogni nota punta alla successiva: un anello, così ognuna ha esattamente un
/// link uscente e un backlink, e «il grafo è vuoto» non si può confondere con
/// «questa nota non aveva link».
fn vault(storage: &Arc<MemStorage>) {
    for i in 0..NOTE {
        storage
            .write(
                &Utf8PathBuf::from(format!("{ROOT}/{}", nome(i))),
                format!("nota{:04}\n", (i + 1) % NOTE).as_bytes(),
            )
            .expect("semina");
    }
}

fn aperto(storage: Arc<MemStorage>) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(LinkListProvider))
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::on(
        ROOT,
        registry,
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce");
    ws.reindex().expect("apertura");
    ws
}

/// La fotografia del grafo, documento per documento e nei due versi.
fn grafo(ws: &Workspace) -> Vec<(DocId, Vec<DocId>, Vec<DocId>)> {
    ws.documents()
        .into_iter()
        .map(|d| {
            let entranti: Vec<DocId> = ws.backlinks(&d).into_iter().map(|b| b.source).collect();
            let uscenti = ws.outgoing(&d);
            (d, entranti, uscenti)
        })
        .collect()
}

#[test]
fn una_riapertura_a_caldo_ha_lo_stesso_grafo_di_una_a_freddo() {
    let storage = Arc::new(MemStorage::new());
    vault(&storage);

    // A freddo: ogni nota viene letta e parsata, e il grafo si costruisce anche
    // per la strada incrementale.
    let a_freddo = aperto(Arc::clone(&storage));
    let atteso = grafo(&a_freddo);
    assert!(
        atteso.iter().all(|(_, entranti, _)| entranti.len() == 1),
        "l'anello non si è chiuso: il banco non ha soggetto"
    );
    drop(a_freddo);

    // A caldo: l'anagrafe scritta dall'apertura di prima risponde per tutti, e
    // **nessun** documento passa da `on_documents_indexed`.
    let a_caldo = aperto(Arc::clone(&storage));
    let isolati = grafo(&a_caldo)
        .iter()
        .filter(|(_, entranti, uscenti)| entranti.is_empty() && uscenti.is_empty())
        .count();
    assert_eq!(
        isolati, 0,
        "{isolati} note su {NOTE} sono senza link in entrambi i versi dopo una \
         riapertura a caldo: il grafo non è stato costruito da nessuno, perché \
         chi riprende un documento dall'anagrafe non lo mette nel grafo"
    );
    assert_eq!(
        grafo(&a_caldo),
        atteso,
        "il grafo di una riapertura a caldo diverge da quello di un'apertura a freddo"
    );
}

/// Lo stesso fatto detto sull'unica cosa che l'utente vede: un `[[wikilink]]`
/// che risolve, e un pannello dei backlink che non è vuoto.
///
/// Il banco sopra confronta due fotografie e passerebbe anche se fossero **due
/// grafi vuoti**, il giorno che qualcuno rompesse anche l'apertura a freddo.
/// Questo ancora la pretesa a un valore scritto a mano.
#[test]
fn a_caldo_un_wikilink_risolve_ancora() {
    let storage = Arc::new(MemStorage::new());
    vault(&storage);
    drop(aperto(Arc::clone(&storage)));

    let a_caldo = aperto(storage);
    assert_eq!(
        a_caldo.resolve_link("nota0007"),
        Some(DocId::new(nome(7))),
        "a caldo un wikilink non nomina più niente"
    );
    let entranti: Vec<DocId> = a_caldo
        .backlinks(&DocId::new(nome(7)))
        .into_iter()
        .map(|b| b.source)
        .collect();
    assert_eq!(
        entranti,
        vec![DocId::new(nome(6))],
        "a caldo il pannello dei backlink di una nota è vuoto"
    );
    assert_eq!(
        a_caldo.outgoing(&DocId::new(nome(7))),
        vec![DocId::new(nome(8))]
    );
}
