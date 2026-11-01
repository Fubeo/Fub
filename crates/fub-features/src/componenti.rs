//! La **mappa dei componenti** di Fub: una riga per ogni cosa che si accende e
//! si spegne, uscita dal codice che c'è.
//!
//! È la stessa cosa che decide che cosa si compila e che cosa si monta, non una
//! descrizione di esse:
//!
//! - ogni riga sta dietro il `#[cfg(feature = …)]` della sua cargo feature,
//!   come [`OFFICIALS`](crate::inventory): spenta la feature, la riga sparisce
//!   insieme al codice, e la mappa di quella build non la nomina;
//! - il manifest di ogni bundle ufficiale `fub_host::mount` lo costruisce da
//!   qui: `uses`, `kind`, `group` e `ui` sono i campi della sua riga.
//!
//! Il risolutore è `fub_componenti`: [`mappa`] traduce le righe nei suoi
//! [`Componente`] con [`NUCLEO`] come nucleo.
//!
//! # Righe che non sono bundle
//!
//! Lavagna, Penna, Dizionari e i due motori sono componenti senza un bundle
//! loro (`bundle: false`): li richiede o li usa qualcun altro, e in K1 sono
//! sempre dentro il binario. I loro id sono quelli dell'ADR, e nel manifest di
//! chi li richiede non compaiono: vedi [`SOLO_DELLA_MAPPA`].

use fub_abi::text::StringCatalog;
use fub_abi::{ComponentKind, Delivery};
use fub_componenti::{Componente, ErroreMappa, Mappa};

/// Ciò che l'host monta sempre: non si spegne (A6). In K1 «Note» ne fa parte.
pub const NUCLEO: [&str; 3] = ["fub.core", "fub.maintenance", "fub.markdown"];

/// I requisiti che stanno **solo nella mappa**, e il perché: il manifest di chi
/// li richiede non li porta.
///
/// Nel kernel un requisito del manifest si soddisfa solo con il `provides` di
/// un bundle montato (`PluginRegistry::provider_of`): scritti nel manifest,
/// questi terrebbero fuori chi li richiede, e cambierebbe che cosa si monta.
/// Nella mappa invece si risolvono per id. Il test lo confronta: i `requires`
/// del manifest sono quelli della riga senza questi.
pub const SOLO_DELLA_MAPPA: &[(&str, &str)] = &[
    (
        "fub.markdown",
        "è nel nucleo, quindi sempre montato, e il suo bundle non offre servizi",
    ),
    (
        "fub.dizionari",
        "non è un bundle: i dizionari li legge l'indice del correttore",
    ),
    (
        "fub.penna",
        "non è un bundle: l'inchiostro è una libreria dei formati",
    ),
    (
        "fub.motore-documenti",
        "non è un bundle: il motore è dentro il codec dei documenti",
    ),
    (
        "fub.motore-fogli",
        "non è un bundle: il motore è dentro il codec dei fogli",
    ),
];

/// Una riga della mappa.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Riga {
    /// L'id: quello del bundle, se è un bundle (A5).
    pub id: &'static str,
    /// La chiave del nome nel [`catalog`]: `component.<nome>.name`.
    pub nome: &'static str,
    /// Il gruppo della pagina dei componenti.
    pub gruppo: &'static str,
    pub kind: ComponentKind,
    /// Come arriva: in K1 tutte [`Delivery::Included`].
    pub delivery: Delivery,
    pub provides: &'static [&'static str],
    pub requires: &'static [&'static str],
    /// Usa se c'è: non accende niente.
    pub uses: &'static [&'static str],
    /// Le cartelle del client che carica, sotto `apps/client/src/`.
    pub ui: &'static [&'static str],
    /// La cargo feature dietro cui sta, se ne ha una.
    pub cargo_feature: Option<&'static str>,
    /// Se è un bundle che l'host monta.
    pub bundle: bool,
}

impl Riga {
    fn nuova(id: &'static str, nome: &'static str, kind: ComponentKind) -> Self {
        Self {
            id,
            nome,
            gruppo: "altro",
            kind,
            delivery: Delivery::Included,
            provides: &[],
            requires: &[],
            uses: &[],
            ui: &[],
            cargo_feature: None,
            bundle: true,
        }
    }

    /// Un modo di lavorare.
    pub fn modalita(id: &'static str, nome: &'static str) -> Self {
        Self::nuova(id, nome, ComponentKind::Mode)
    }

    /// Un motore che altri usano.
    pub fn motore(id: &'static str, nome: &'static str) -> Self {
        Self::nuova(id, nome, ComponentKind::Engine)
    }

    /// Un servizio.
    pub fn servizio(id: &'static str, nome: &'static str) -> Self {
        Self::nuova(id, nome, ComponentKind::Service)
    }

    pub fn group(mut self, gruppo: &'static str) -> Self {
        self.gruppo = gruppo;
        self
    }

    pub fn provides(mut self, provides: &'static [&'static str]) -> Self {
        self.provides = provides;
        self
    }

    pub fn requires(mut self, requires: &'static [&'static str]) -> Self {
        self.requires = requires;
        self
    }

    pub fn uses(mut self, uses: &'static [&'static str]) -> Self {
        self.uses = uses;
        self
    }

    pub fn ui(mut self, ui: &'static [&'static str]) -> Self {
        self.ui = ui;
        self
    }

    pub fn cargo_feature(mut self, feature: &'static str) -> Self {
        self.cargo_feature = Some(feature);
        self
    }

    /// Un componente senza bundle: lo richiede o lo usa qualcun altro.
    pub fn senza_bundle(mut self) -> Self {
        self.bundle = false;
        self
    }

    /// I `requires` che vanno nel manifest: quelli della riga senza
    /// [`SOLO_DELLA_MAPPA`].
    pub fn requires_del_manifest(&self) -> Vec<&'static str> {
        self.requires
            .iter()
            .copied()
            .filter(|id| SOLO_DELLA_MAPPA.iter().all(|(solo, _)| solo != id))
            .collect()
    }

    /// La riga come la vuole il risolutore.
    pub fn componente(&self) -> Componente {
        let owned = |ids: &[&str]| ids.iter().map(|id| id.to_string()).collect();
        Componente {
            id: self.id.to_string(),
            requires: owned(self.requires),
            uses: owned(self.uses),
            gruppo: Some(self.gruppo.to_string()),
            provides: owned(self.provides),
        }
    }
}

/// Le righe di questa build, nell'ordine in cui le elenca la mappa.
pub fn righe() -> Vec<Riga> {
    vec![
        // Il nucleo.
        Riga::servizio("fub.core", "component.core.name"),
        Riga::servizio("fub.maintenance", "component.maintenance.name"),
        // Oggi sempre compilato: non ha una cargo feature.
        Riga::modalita("fub.markdown", "component.markdown.name")
            .group("scrivere")
            .ui(&["editors/text"]),
        // Le feature delle note, come in `OFFICIALS`: richiedono tutte le note.
        #[cfg(feature = "search")]
        Riga::servizio("fub.search", "component.search.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("search"),
        #[cfg(feature = "versioning")]
        Riga::servizio("fub.versioning", "component.versioning.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("versioning"),
        #[cfg(feature = "backlinks")]
        Riga::modalita("fub.backlinks", "component.backlinks.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("backlinks"),
        #[cfg(feature = "outline")]
        Riga::modalita("fub.outline", "component.outline.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("outline"),
        #[cfg(feature = "tags")]
        Riga::modalita("fub.tags", "component.tags.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("tags"),
        #[cfg(feature = "properties")]
        Riga::servizio("fub.properties", "component.properties.name")
            .group("scrivere")
            .provides(&["fub.properties"])
            .requires(&["fub.markdown"])
            .cargo_feature("properties"),
        #[cfg(feature = "template")]
        Riga::modalita("fub.template", "component.template.name")
            .group("scrivere")
            .requires(&["fub.markdown", "fub.properties"])
            .cargo_feature("template"),
        #[cfg(feature = "queries")]
        Riga::modalita("fub.queries", "component.queries.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("queries"),
        #[cfg(feature = "dashboard")]
        Riga::modalita("fub.dashboard", "component.dashboard.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("dashboard"),
        #[cfg(feature = "backup")]
        Riga::modalita("fub.backup", "component.backup.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("backup"),
        #[cfg(feature = "trash")]
        Riga::modalita("fub.trash", "component.trash.name")
            .group("scrivere")
            .requires(&["fub.markdown", "fub.commands"])
            .cargo_feature("trash"),
        #[cfg(feature = "stats")]
        Riga::modalita("fub.stats", "component.stats.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("stats"),
        #[cfg(feature = "graph")]
        Riga::modalita("fub.graph", "component.graph.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("graph"),
        #[cfg(feature = "commands")]
        Riga::servizio("fub.commands", "component.commands.name")
            .group("scrivere")
            .provides(&["fub.commands"])
            .requires(&["fub.markdown"])
            .cargo_feature("commands"),
        #[cfg(feature = "blocks")]
        Riga::modalita("fub.blocks", "component.blocks.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("blocks"),
        #[cfg(feature = "base")]
        Riga::modalita("fub.base", "component.base.name")
            .group("scrivere")
            .requires(&["fub.markdown", "fub.properties"])
            .cargo_feature("base"),
        #[cfg(feature = "formatting")]
        Riga::modalita("fub.formatting", "component.formatting.name")
            .group("scrivere")
            .requires(&["fub.markdown"])
            .cargo_feature("formatting"),
        #[cfg(feature = "proof")]
        Riga::modalita("fub.proof", "component.proof.name")
            .group("scrivere")
            .requires(&["fub.markdown", "fub.dizionari"])
            .cargo_feature("proof"),
        #[cfg(feature = "draw")]
        Riga::servizio("fub.draw", "component.draw.name")
            .group("disegnare")
            .cargo_feature("draw"),
        // Documenti e Fogli: il bundle e il codec stanno in `fub-host`.
        #[cfg(feature = "rich")]
        Riga::modalita("fub.rich", "component.rich.name")
            .group("ufficio")
            .requires(&["fub.motore-documenti"])
            .uses(&["fub.penna", "fub.dizionari"])
            .ui(&["editors/rich"])
            .cargo_feature("rich"),
        #[cfg(feature = "xlsx")]
        Riga::modalita("fub.xlsx", "component.xlsx.name")
            .group("ufficio")
            .requires(&["fub.motore-fogli"])
            .uses(&["fub.penna"])
            .ui(&["editors/grid"])
            .cargo_feature("xlsx"),
        // Oggi sempre compilata nel client, e senza bundle. Il motore
        // vettoriale che la porterà non esiste ancora: quando ci sarà, sarà
        // una riga di supporto che questa richiede.
        Riga::modalita("fub.lavagna", "component.lavagna.name")
            .group("pensare")
            .requires(&["fub.penna"])
            .uses(&["fub.rich", "fub.xlsx"])
            .ui(&["editors/canvas"])
            .senza_bundle(),
        // Di supporto: accesi quando qualcuno li richiede.
        Riga::motore("fub.penna", "component.penna.name")
            .group("supporto")
            .senza_bundle(),
        Riga::servizio("fub.dizionari", "component.dizionari.name")
            .group("supporto")
            .senza_bundle(),
        #[cfg(feature = "engine-documents")]
        Riga::motore("fub.motore-documenti", "component.motore-documenti.name")
            .group("supporto")
            .cargo_feature("engine-documents")
            .senza_bundle(),
        #[cfg(feature = "engine-sheets")]
        Riga::motore("fub.motore-fogli", "component.motore-fogli.name")
            .group("supporto")
            .cargo_feature("engine-sheets")
            .senza_bundle(),
        // Gli altri bundle che l'host monta e che non sono temi. Nessuno sta
        // in `supporto`: un componente di supporto si spegne quando nessuno lo
        // richiede, e sarebbe un cambiamento visibile.
        Riga::servizio("fub.importers", "component.importers.name").group("scrivere"),
        #[cfg(feature = "http-client")]
        Riga::servizio("fub.linkcard", "component.linkcard.name")
            .group("scrivere")
            .cargo_feature("http-client"),
        #[cfg(feature = "http-client")]
        Riga::servizio("fub.updates", "component.updates.name").cargo_feature("http-client"),
        #[cfg(feature = "http-client")]
        Riga::servizio("fub.publish", "component.publish.name").cargo_feature("http-client"),
        #[cfg(feature = "http-client")]
        Riga::servizio("fub.sync", "component.sync.name").cargo_feature("http-client"),
    ]
}

/// La riga di un id, se questa build ce l'ha.
pub fn riga(id: &str) -> Option<Riga> {
    righe().into_iter().find(|riga| riga.id == id)
}

/// La mappa di questa build, o perché non si costruisce.
pub fn prova_mappa() -> Result<Mappa, ErroreMappa> {
    Mappa::nuova(righe().iter().map(Riga::componente).collect(), NUCLEO)
}

/// La mappa di questa build.
///
/// Le righe sono un dato fisso, e `tests/componenti.rs` prova che la mappa si
/// costruisce in ogni combinazione di feature che la CI compila: qui non può
/// fallire, e se fallisse sarebbe un errore di build arrivato fin qui.
pub fn mappa() -> Mappa {
    prova_mappa()
        .unwrap_or_else(|errore| panic!("la mappa dei componenti non si costruisce: {errore}"))
}

/// I nomi dei componenti, in tutte le lingue (A10). Le chiavi ci sono anche per
/// le righe che questa build non compila: il catalogo è uno solo.
pub fn catalog() -> Vec<StringCatalog> {
    let mut it = StringCatalog::new("it");
    let mut en = StringCatalog::new("en");
    for (nome, it_nome, en_nome) in NOMI {
        it = it.with(*nome, *it_nome);
        en = en.with(*nome, *en_nome);
    }
    vec![it, en]
}

/// Chiave, italiano, inglese.
const NOMI: &[(&str, &str, &str)] = &[
    ("component.core.name", "Fub", "Fub"),
    ("component.maintenance.name", "Manutenzione", "Maintenance"),
    ("component.markdown.name", "Note", "Notes"),
    ("component.search.name", "Ricerca", "Search"),
    ("component.versioning.name", "Versioni", "Versioning"),
    ("component.backlinks.name", "Collegamenti", "Backlinks"),
    ("component.outline.name", "Struttura", "Structure"),
    ("component.tags.name", "Tag", "Tags"),
    ("component.properties.name", "Proprietà", "Properties"),
    ("component.template.name", "Template", "Template"),
    ("component.queries.name", "Query", "Queries"),
    ("component.dashboard.name", "Dashboard", "Dashboard"),
    ("component.backup.name", "Backup", "Backup"),
    ("component.trash.name", "Cestino", "Trash"),
    ("component.stats.name", "Statistiche", "Statistics"),
    ("component.graph.name", "Grafo", "Graph"),
    ("component.commands.name", "Comandi", "Commands"),
    ("component.blocks.name", "Blocchi", "Blocks"),
    ("component.base.name", "Base", "Base"),
    (
        "component.formatting.name",
        "Barra di formattazione",
        "Formatting bar",
    ),
    ("component.proof.name", "Correttore", "Proofing"),
    ("component.draw.name", "Disegni", "Drawings"),
    ("component.rich.name", "Documenti", "Documents"),
    ("component.xlsx.name", "Fogli", "Spreadsheets"),
    ("component.lavagna.name", "Lavagna", "Whiteboard"),
    ("component.penna.name", "Penna", "Pen"),
    ("component.dizionari.name", "Dizionari", "Dictionaries"),
    (
        "component.motore-documenti.name",
        "Motore dei documenti",
        "Document engine",
    ),
    (
        "component.motore-fogli.name",
        "Motore dei fogli",
        "Spreadsheet engine",
    ),
    ("component.importers.name", "Importazione", "Import"),
    (
        "component.linkcard.name",
        "Anteprime dei link",
        "Link cards",
    ),
    ("component.updates.name", "Aggiornamenti", "Updates"),
    ("component.publish.name", "Pubblicazione", "Publishing"),
    ("component.sync.name", "Sincronizzazione", "Sync"),
];
