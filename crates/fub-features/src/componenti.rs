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
//! Lavagna, PDF, Penna, Dizionari e i due motori sono componenti senza un
//! bundle loro (`bundle: false`): sono sempre dentro il binario. Penna,
//! Dizionari e i motori li richiede o li usa qualcun altro; Lavagna e PDF si
//! spengono a mano, e il loro stato sta nelle chiavi `components.*` del vault
//! (`fub_host::componenti`), non in `plugins.disabled`. I loro id sono quelli
//! dell'ADR, e nel manifest di chi li richiede non compaiono: vedi
//! [`SOLO_DELLA_MAPPA`].
//!
//! # Profili
//!
//! [`profili`] sono scelte già fatte sopra questa mappa: un nome e i
//! componenti che accende. Un profilo che nomina componenti che non esistono
//! ancora ([`DefProfilo::arriva_con`]) è «più avanti»: si mostra, e non si
//! applica.

use fub_abi::text::StringCatalog;
use fub_abi::{ComponentKind, Delivery};
use fub_componenti::{Componente, ErroreMappa, Mappa, Profilo};

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

    /// La chiave del catalogo con la descrizione: `component.<nome>.description`,
    /// accanto a quella del nome.
    pub fn descrizione(&self) -> String {
        let radice = self.nome.strip_suffix(".name").unwrap_or(self.nome);
        format!("{radice}.description")
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
            .ui(&["editors/spatial"])
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
        // Sempre compilata nel client, e senza bundle: spenta, l'host non
        // registra il formato `.canvas`. Il motore vettoriale che la porterà
        // non esiste ancora: quando ci sarà, sarà una riga di supporto che
        // questa richiede.
        Riga::modalita("fub.lavagna", "component.lavagna.name")
            .group("pensare")
            .requires(&["fub.penna"])
            .uses(&["fub.rich", "fub.xlsx"])
            .ui(&["editors/canvas"])
            .senza_bundle(),
        // Il visore dei PDF del client (pdfjs, profilo `media-pdf`): senza
        // bundle, e nell'host non c'è niente da spegnere.
        Riga::modalita("fub.pdf", "component.pdf.name")
            .group("leggere")
            .requires(&["fub.penna"])
            .ui(&["editors/media"])
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

/// I gruppi della pagina dei componenti, nell'ordine in cui si disegnano. Una
/// riga che non ne dice uno sta in `altro`, il gruppo di serie di [`Riga`].
pub const GRUPPI: [&str; 8] = [
    "scrivere",
    "leggere",
    "pensare",
    "disegnare",
    "ufficio",
    "foto",
    "altro",
    "supporto",
];

/// La chiave del catalogo con il nome di un gruppo: `component.group.<g>.name`.
pub fn nome_del_gruppo(gruppo: &str) -> String {
    format!("component.group.{gruppo}.name")
}

/// I gruppi che questa build disegna: quelli di [`GRUPPI`] con almeno una
/// riga, nel loro ordine.
pub fn gruppi() -> Vec<&'static str> {
    let righe = righe();
    GRUPPI
        .into_iter()
        .filter(|gruppo| righe.iter().any(|riga| riga.gruppo == *gruppo))
        .collect()
}

/// I nomi e le descrizioni dei componenti, i nomi dei gruppi e dei profili, in
/// tutte le lingue (A10). Le chiavi ci sono anche per le righe che questa
/// build non compila: il catalogo è uno solo.
pub fn catalog() -> Vec<StringCatalog> {
    let mut it = StringCatalog::new("it");
    let mut en = StringCatalog::new("en");
    for (nome, it_nome, en_nome) in NOMI
        .iter()
        .chain(DESCRIZIONI)
        .chain(NOMI_DEI_GRUPPI)
        .chain(NOMI_DEI_PROFILI)
    {
        it = it.with(*nome, *it_nome);
        en = en.with(*nome, *en_nome);
    }
    vec![it, en]
}

/// I nomi dei gruppi: chiave, italiano, inglese.
const NOMI_DEI_GRUPPI: &[(&str, &str, &str)] = &[
    ("component.group.scrivere.name", "Scrivere", "Write"),
    ("component.group.leggere.name", "Leggere", "Read"),
    ("component.group.pensare.name", "Pensare", "Think"),
    ("component.group.disegnare.name", "Disegnare", "Draw"),
    ("component.group.ufficio.name", "Ufficio", "Office"),
    ("component.group.foto.name", "Foto", "Photos"),
    ("component.group.altro.name", "Altro", "Other"),
    ("component.group.supporto.name", "Di supporto", "Support"),
];

/// Che cosa fa ogni componente per chi usa Fub, in una frase: chiave,
/// italiano, inglese.
const DESCRIZIONI: &[(&str, &str, &str)] = &[
    (
        "component.core.description",
        "Il vault, i suoi file e le impostazioni.",
        "The vault, its files and the settings.",
    ),
    (
        "component.maintenance.description",
        "Rifare l'indice e raccogliere ciò che serve per chiedere aiuto.",
        "Rebuild the index and gather what you need to ask for help.",
    ),
    (
        "component.markdown.description",
        "L'editor Markdown: Live, Blocchi e il menu «/».",
        "The Markdown editor: Live, Blocks and the “/” menu.",
    ),
    (
        "component.search.description",
        "Trovare una parola in tutte le note.",
        "Find a word in every note.",
    ),
    (
        "component.versioning.description",
        "Le versioni passate di ogni file, da riprendere quando serve.",
        "Past versions of every file, to bring back when needed.",
    ),
    (
        "component.backlinks.description",
        "Le note che portano a quella che stai leggendo.",
        "The notes that link to the one you are reading.",
    ),
    (
        "component.outline.description",
        "I titoli della nota, per saltare da una parte all'altra.",
        "The headings of the note, to jump from one part to another.",
    ),
    (
        "component.tags.description",
        "Tutti i tag del vault, e le note che li portano.",
        "Every tag in the vault, and the notes that carry it.",
    ),
    (
        "component.properties.description",
        "Le proprietà in testa alla nota, da leggere e cambiare.",
        "The properties at the top of a note, to read and change.",
    ),
    (
        "component.template.description",
        "Modelli di nota, la nota del giorno, la data e l'ora.",
        "Note templates, the daily note, the date and the time.",
    ),
    (
        "component.queries.description",
        "Le ricerche salvate, da rifare con un clic.",
        "Saved searches, to run again with one click.",
    ),
    (
        "component.dashboard.description",
        "Il vault in numeri: note, tag, file e collegamenti rotti.",
        "The vault in numbers: notes, tags, files and broken links.",
    ),
    (
        "component.backup.description",
        "Copie delle note da cui ripartire.",
        "Copies of your notes to start again from.",
    ),
    (
        "component.trash.description",
        "Le note eliminate, da recuperare o togliere per sempre.",
        "Deleted notes, to bring back or remove for good.",
    ),
    (
        "component.stats.description",
        "Parole, caratteri e tempo di lettura della nota.",
        "Words, characters and reading time of the note.",
    ),
    (
        "component.graph.description",
        "I collegamenti fra le note, in una mappa.",
        "The links between notes, on a map.",
    ),
    (
        "component.commands.description",
        "Le azioni che trovi nella palette dei comandi.",
        "The actions you find in the command palette.",
    ),
    (
        "component.blocks.description",
        "Diagrammi, formule ed evidenziato dentro le note.",
        "Diagrams, formulas and highlights inside notes.",
    ),
    (
        "component.base.description",
        "Tabelle che raccolgono le note per proprietà.",
        "Tables that gather notes by their properties.",
    ),
    (
        "component.formatting.description",
        "I pulsanti per grassetto, elenchi e titoli, senza ricordare i simboli.",
        "Buttons for bold, lists and headings, without remembering the symbols.",
    ),
    (
        "component.proof.description",
        "L'ortografia mentre scrivi.",
        "Spelling as you write.",
    ),
    (
        "component.draw.description",
        "I file SVG: penna, forme, frecce, testo.",
        "SVG files: pen, shapes, arrows, text.",
    ),
    (
        "component.rich.description",
        "I file Word e OpenDocument, semplici o completi.",
        "Word and OpenDocument files, simple or complete.",
    ),
    (
        "component.xlsx.description",
        "I file Excel e OpenDocument, semplici o completi.",
        "Excel and OpenDocument files, simple or complete.",
    ),
    (
        "component.lavagna.description",
        "Schede, fili e inchiostro sopra qualsiasi cosa.",
        "Cards, threads and ink over anything.",
    ),
    (
        "component.pdf.description",
        "Leggere, cercare, evidenziare, annotare a penna.",
        "Read, search, highlight, annotate with a pen.",
    ),
    (
        "component.penna.description",
        "Pressione, palmo, scia a bassa latenza, tratti.",
        "Pressure, palm, low-latency trail, strokes.",
    ),
    (
        "component.dizionari.description",
        "Le lingue del correttore.",
        "The languages of the spell checker.",
    ),
    (
        "component.motore-documenti.description",
        "Impaginazione e comandi dei documenti.",
        "Page layout and commands for documents.",
    ),
    (
        "component.motore-fogli.description",
        "Formule, calcolo e comandi dei fogli.",
        "Formulas, calculation and commands for spreadsheets.",
    ),
    (
        "component.importers.description",
        "Portare in Fub le note di Evernote, OneNote, Tomboy e altri.",
        "Bring in notes from Evernote, OneNote, Tomboy and others.",
    ),
    (
        "component.linkcard.description",
        "Un link da solo diventa una scheda con titolo e icona, quando lo chiedi.",
        "A link on its own becomes a card with title and icon, when you ask.",
    ),
    (
        "component.updates.description",
        "Sapere se c'è una versione nuova di Fub, solo quando lo chiedi.",
        "Find out whether a new version of Fub is out, only when you ask.",
    ),
    (
        "component.publish.description",
        "Mettere le note su un sito.",
        "Put your notes on a website.",
    ),
    (
        "component.sync.description",
        "Le stesse note su più dispositivi, cifrate.",
        "The same notes on several devices, encrypted.",
    ),
];

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
    ("component.pdf.name", "PDF", "PDF"),
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

/// Un profilo: un nome e i componenti che accende (A4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DefProfilo {
    /// Il nome che sta in `components.profile`.
    pub nome: &'static str,
    /// La chiave del catalogo con il nome da mostrare.
    pub etichetta: &'static str,
    /// I componenti di questa build che il profilo sceglie.
    pub componenti: Vec<&'static str>,
    /// I componenti che il profilo vuole e che non esistono ancora: se ce
    /// n'è uno, il profilo è «più avanti» e non si applica.
    pub arriva_con: Vec<&'static str>,
}

impl DefProfilo {
    /// Se il profilo aspetta componenti che non ci sono ancora.
    pub fn piu_avanti(&self) -> bool {
        !self.arriva_con.is_empty()
    }

    /// Il profilo per il risolutore.
    pub fn profilo(&self) -> Profilo {
        Profilo {
            nome: self.nome.to_string(),
            componenti: self.componenti.iter().map(|id| id.to_string()).collect(),
        }
    }
}

/// I gruppi che un profilo non tocca, tranne «Tutto»: le righe senza gruppo
/// (aggiornamenti, pubblicazione, sincronizzazione) e i disegni.
pub const GRUPPI_FUORI_DAI_PROFILI: &[&str] = &["altro", "disegnare"];

/// Il nome del profilo che accende tutto.
pub const PROFILO_TUTTO: &str = "tutto";

/// I profili, nell'ordine in cui si mostrano.
pub fn profili() -> Vec<DefProfilo> {
    let righe = righe();
    let note: Vec<&'static str> = righe
        .iter()
        .filter(|riga| {
            riga.id == "fub.markdown"
                || (riga.gruppo == "scrivere" && !["fub.graph", "fub.proof"].contains(&riga.id))
        })
        .map(|riga| riga.id)
        .collect();
    let di_questa_build = |ids: &[&'static str]| -> Vec<&'static str> {
        ids.iter()
            .copied()
            .filter(|id| righe.iter().any(|riga| riga.id == *id))
            .collect()
    };
    let con_le_note = |altri: &[&'static str]| -> Vec<&'static str> {
        let mut ids = note.clone();
        ids.extend(di_questa_build(altri));
        ids
    };
    let profilo = |nome, etichetta, componenti, arriva_con: &[&'static str]| DefProfilo {
        nome,
        etichetta,
        componenti,
        arriva_con: arriva_con.to_vec(),
    };
    vec![
        profilo("solo-note", "profile.solo-note.name", note.clone(), &[]),
        profilo(
            "solo-pdf",
            "profile.solo-pdf.name",
            di_questa_build(&["fub.pdf"]),
            &["fub.pdf-completo"],
        ),
        profilo(
            "studio",
            "profile.studio.name",
            con_le_note(&[
                "fub.graph",
                "fub.proof",
                "fub.pdf",
                "fub.lavagna",
                "fub.rich",
                "fub.xlsx",
            ]),
            &[],
        ),
        profilo(
            "grafica",
            "profile.grafica.name",
            con_le_note(&["fub.lavagna"]),
            &["fub.disegno-completo", "fub.foto"],
        ),
        profilo(
            "fotografia",
            "profile.fotografia.name",
            note.clone(),
            &["fub.libreria-foto", "fub.foto"],
        ),
        profilo(
            PROFILO_TUTTO,
            "profile.tutto.name",
            righe
                .iter()
                .filter(|riga| riga.gruppo != "supporto")
                .map(|riga| riga.id)
                .collect(),
            &[],
        ),
    ]
}

/// Il profilo che si chiama `nome`, se c'è.
pub fn profilo(nome: &str) -> Option<DefProfilo> {
    profili().into_iter().find(|profilo| profilo.nome == nome)
}

/// I nomi dei profili: chiave, italiano, inglese.
const NOMI_DEI_PROFILI: &[(&str, &str, &str)] = &[
    ("profile.solo-note.name", "Solo note", "Notes only"),
    ("profile.studio.name", "Studio", "Study"),
    ("profile.tutto.name", "Tutto", "Everything"),
    ("profile.solo-pdf.name", "Solo PDF", "PDF only"),
    ("profile.grafica.name", "Grafica", "Graphics"),
    ("profile.fotografia.name", "Fotografia", "Photography"),
];
