//! `FormatProvider` — l'astrazione centrale su "come si comporta un formato di
//! documento". Il markdown è la prima implementazione (nativa, in
//! `fub-format-markdown`); domani org-mode/AsciiDoc sono altri provider senza
//! toccare il kernel.
//!
//! **Regola d'oro (vale da subito, per non dipingerci in un angolo col WASM):**
//! ogni argomento e ogni valore di ritorno è un tipo di `fub-abi`,
//! `Serialize + Deserialize`, esprimibile come record WIT. Niente reference con
//! lifetime nella memoria del kernel, niente trait object, niente closure nelle
//! firme. Così l'impl nativa è veloce e quella WASM-proxy (M5) è meccanica.
//!
//! **Un provider è sostituibile, e ora anche estendibile.** Chi vuole aggiungere
//! *una sintassi* a un formato che c'è già non deve più forkarne il provider: la
//! innesta con una [`SyntaxRule`](crate::custom::SyntaxRule), e il §3.1 è chiuso
//! con la [decisione 0017](../../../docs/decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md).

use serde::{Deserialize, Serialize};

use crate::error::FormatError;
use crate::model::DocumentModel;
use crate::options::{render_option, syntax, OptionMap};

/// Che cosa un provider si aspetta di ricevere in [`FormatProvider::parse`].
///
/// Esiste perché `parse(source: &str)` chiudeva la porta a metà del capitolo 12
/// e 11.4: un `.canvas`, un CSV grande, un PDF trattato come documento (13.2) o
/// un file con encoding da rilevare (2.3) non sono testo UTF-8 già decodificato,
/// e nessuno di loro entrava. È il **varco nel contratto**, cioè la parte che
/// scade col freeze; la sua metà kernel — cosa il vault sa leggere, e cosa è un
/// asset invece che un documento — resta il §14.1.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    /// Testo UTF-8 già decodificato: il caso del markdown e di ogni formato
    /// testuale.
    #[default]
    Text,
    /// I byte grezzi. Chi li chiede si decodifica da sé (o non decodifica
    /// affatto, come un provider di PDF).
    Bytes,
}

/// La sorgente di un documento, nella forma che il suo provider ha chiesto.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentSource {
    Text(String),
    Bytes(Vec<u8>),
}

impl DocumentSource {
    /// Il testo, se questa sorgente è testo. Un provider testuale che riceve dei
    /// byte deve dire di no (`Unsupported`), non indovinare: l'encoding è una
    /// decisione, non un tentativo.
    pub fn text(&self) -> Option<&str> {
        match self {
            DocumentSource::Text(s) => Some(s),
            DocumentSource::Bytes(_) => None,
        }
    }

    pub fn bytes(&self) -> &[u8] {
        match self {
            DocumentSource::Text(s) => s.as_bytes(),
            DocumentSource::Bytes(b) => b,
        }
    }
}

impl From<&str> for DocumentSource {
    fn from(s: &str) -> Self {
        DocumentSource::Text(s.to_string())
    }
}

impl From<String> for DocumentSource {
    fn from(s: String) -> Self {
        DocumentSource::Text(s)
    }
}

/// Descrittore statico di un formato.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormatDescriptor {
    /// Id stabile, es. `"markdown"`.
    pub id: String,
    /// Nome leggibile, es. `"Markdown (Obsidian)"`.
    pub name: String,
    /// Estensioni rivendicate, senza punto: `["md", "markdown"]`.
    pub extensions: Vec<String>,
    /// In che forma questo provider vuole la sorgente. Il kernel legge di
    /// conseguenza: senza questo campo, "leggi il file" e "decodificalo come
    /// UTF-8" restavano la stessa operazione.
    pub source: SourceKind,
}

impl FormatDescriptor {
    /// Un formato testuale: il caso di gran lunga più comune.
    pub fn text(id: impl Into<String>, name: impl Into<String>, extensions: &[&str]) -> Self {
        FormatDescriptor {
            id: id.into(),
            name: name.into(),
            extensions: extensions.iter().map(|e| e.to_string()).collect(),
            source: SourceKind::Text,
        }
    }
}

/// Che sintassi sa leggere un provider — **un elenco di nomi**, non cinque
/// booleani.
///
/// Il vocabolario è quello di [`syntax`], lo stesso di [`ParseContext`]: là si
/// dice *cosa accendere*, qui *cosa so fare*. Erano due elenchi separati, ed
/// erano la stessa domanda vista da due lati (§3.4 e §3.5); tenuti separati, la
/// terza sintassi li faceva divergere. Il valore di una voce è il suo dettaglio:
/// un booleano poteva dire «so fare i callout», non «so fare questi tipi di
/// callout».
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct FormatCapabilities {
    pub syntax: OptionMap,
}

impl FormatCapabilities {
    /// Le capacità di un provider che dichiara questi nomi, senza dettaglio.
    pub fn of(names: &[&str]) -> Self {
        FormatCapabilities {
            syntax: names.iter().fold(OptionMap::new(), |m, n| m.on(*n)),
        }
    }

    pub fn supports(&self, name: &str) -> bool {
        self.syntax.enabled(name)
    }
}

/// Che cosa si sa di un documento **senza averlo aperto**: chi lo tratterebbe,
/// e che sintassi capirebbe.
///
/// È la risposta del §4.3, ed è una risposta sul **nome** e non sul file: la dà
/// il registro dei formati guardando l'estensione, senza leggere un byte. Chi
/// riceve una lista da [`VaultRead::list_documents`](crate::traits::VaultRead::list_documents)
/// non aveva modo di distinguere una nota da un canvas, un CSV, un PDF o un
/// allegato — cioè non poteva decidere se sa lavorarci, e nemmeno se *deve*
/// ignorarlo. Con un formato solo non si vedeva; il §3.4 ha aperto `parse` ai
/// documenti non-testo, quindi si vede da adesso.
///
/// I due campi stanno **insieme** e non in due capacità perché sono la stessa
/// domanda: chiederli separatamente vorrebbe dire poter ricevere il descrittore
/// di un provider e le capacità di un altro, che è uno stato che nessuno sa
/// gestire e che nessun chiamante ha chiesto.
///
/// # Le capacità sono quelle **effettive**
///
/// [`capabilities`](DocumentFormat::capabilities) è ciò che quel documento
/// capirebbe *qui, adesso*: le sintassi del provider **più** quelle che le
/// [`SyntaxRule`](crate::custom::SyntaxRule) registrate gli innestano sopra
/// (§3.1). Rispondere le sole capacità del provider sarebbe rispondere una
/// verità di laboratorio — `==evidenziato==` non è del provider markdown e
/// funziona lo stesso — e rimetterebbe in piedi le due categorie di estensioni
/// che la [decisione 0017](../../../docs/decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md)
/// ha rifiutato: chi accende una sintassi non deve sapere da dove viene, e chi
/// chiede cosa è acceso nemmeno.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentFormat {
    pub descriptor: FormatDescriptor,
    pub capabilities: FormatCapabilities,
}

/// Config a livello di vault (28), di cartella o di nota (6.2, classi da
/// frontmatter) passata al parse.
///
/// `parse_tags` e `parse_wikilinks` erano due booleani contro le ~50 estensioni
/// del capitolo 5.2: con quella forma ogni estensione era un campo nuovo del
/// contratto, cioè una minor a testa. Adesso sono due voci di una mappa, e
/// un'estensione di terzi ci sta accanto senza chiedere permesso a nessuno —
/// che è la metà del §3.4 di cui il §3.1 è l'altra (*chi* la aggiunge).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ParseContext {
    /// Id del documento che stiamo parsando (per riempire `DocumentModel.id`).
    pub doc_id: String,
    /// Cosa è acceso, e con quale parametro. Vedi [`syntax`].
    pub options: OptionMap,
}

impl ParseContext {
    /// Contesto "alla Obsidian": tutto ciò che il core sa fare, acceso.
    pub fn obsidian(doc_id: impl Into<String>) -> Self {
        ParseContext {
            doc_id: doc_id.into(),
            options: OptionMap::new()
                .on(syntax::TAGS)
                .on(syntax::WIKILINKS)
                .on(syntax::FRONTMATTER)
                .on(syntax::CALLOUTS)
                .on(syntax::EMBEDS)
                .on(syntax::FOOTNOTES)
                .on(syntax::DEFINITION_LISTS)
                // Le tre che arrivano da una `SyntaxRule` e non dal provider.
                // Stanno qui insieme alle altre di proposito: chi accende una
                // sintassi non deve sapere **da dove** viene, o il §3.1 avrebbe
                // prodotto due categorie di estensioni invece di una.
                .on(syntax::DIAGRAMS)
                .on(syntax::MATH)
                .on(syntax::HIGHLIGHT),
        }
    }

    /// Contesto vuoto: nessuna estensione accesa.
    pub fn bare(doc_id: impl Into<String>) -> Self {
        ParseContext {
            doc_id: doc_id.into(),
            options: OptionMap::new(),
        }
    }

    pub fn enabled(&self, name: &str) -> bool {
        self.options.enabled(name)
    }
}

/// Per **chi** si sta rendendo.
///
/// Il §3.5 lo dice in una riga: il rendering ha almeno tre bersagli distinti —
/// schermo, stampa e PDF (6.3), pubblicazione statica (19.4) — e un booleano
/// non ne distingueva nemmeno due. È un `enum` e non una voce della mappa
/// perché i bersagli sono **esclusivi**: si rende per uno solo alla volta, e chi
/// riceve `opts` deve poterlo trattare con un match.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderTarget {
    /// La webview: lettura e anteprima.
    #[default]
    Screen,
    Print,
    Pdf,
    /// Pubblicazione statica (19.4): niente che dipenda dall'app che sta girando.
    StaticSite,
}

/// Opzioni di rendering: il bersaglio, e il resto in una mappa.
///
/// Il tema, la risoluzione degli asset (13.1) e il CSS per nota/cartella/tipo
/// (6.2) sono voci della mappa, non campi: sono esattamente la coda aperta che
/// il §3.5 nota. Le chiavi del core stanno in [`render_option`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RenderOptions {
    pub target: RenderTarget,
    pub options: OptionMap,
}

impl RenderOptions {
    /// Le opzioni con cui il kernel rende l'anteprima: schermo, e i wikilink
    /// come data-attribute che il frontend risolve.
    pub fn preview() -> Self {
        RenderOptions {
            target: RenderTarget::Screen,
            options: OptionMap::new().on(render_option::WIKILINKS_AS_DATA_ATTRS),
        }
    }

    pub fn enabled(&self, name: &str) -> bool {
        self.options.enabled(name)
    }
}

/// Il trait centrale. **Object-safe**: nessun metodo generico, nessun `async fn`
/// nel trait (l'I/O vive nell'`HostApi`, non qui — parse/render/serialize sono
/// funzioni CPU pure).
pub trait FormatProvider: Send + Sync {
    /// Quali estensioni / content-type rivendica questo provider.
    fn descriptor(&self) -> FormatDescriptor;

    /// Che sintassi sa leggere.
    fn capabilities(&self) -> FormatCapabilities;

    /// Parsa la sorgente nel modello comune.
    ///
    /// La sorgente arriva nella forma dichiarata da
    /// [`FormatDescriptor::source`]: un provider testuale che ricevesse dei byte
    /// risponde [`FormatError::Unsupported`] invece di indovinare l'encoding.
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError>;

    /// Rende il modello a HTML per il pannello di anteprima.
    ///
    /// Un `Block::Custom` di cui esiste un renderer registrato **non arriva
    /// qui**: il kernel lo estrae prima e lo rende con quello (§3.2). Ciò che
    /// arriva è ciò che il provider conosce, più i kind che nessuno rivendica —
    /// e per quelli la resa generica resta il degrado giusto.
    ///
    /// # Il modello può essere un frammento
    ///
    /// Estrarre quei blocchi vuol dire spezzare il corpo, quindi con dei
    /// renderer registrati questo metodo viene chiamato **una volta per corsa**
    /// con un modello che porta il proprio `id` e i soli blocchi di quella
    /// corsa: `frontmatter`, `outline`, `links`, `tags`, `anchors` e `text`
    /// sono vuoti. È il prezzo di non fare chirurgia sull'HTML, ed è dichiarato
    /// qui perché è una promessa che questa firma fa: **la resa di un blocco
    /// dipende dal blocco**, non dal resto del documento. Ciò che serve
    /// all'intero documento — il tema, il CSS per nota del 6.2, il bersaglio —
    /// viaggia in `opts`, che arriva sempre intero.
    fn render_html(
        &self,
        model: &DocumentModel,
        opts: &RenderOptions,
    ) -> Result<String, FormatError>;

    /// Serializza un modello a sorgente. **Generazione, non round-trip.**
    ///
    /// La fonte di verità di un documento esistente è la sua sorgente sul
    /// disco: il modello è lossy per costruzione (non conserva lo stile di
    /// enfasi, la spaziatura, l'indentazione...), quindi la fedeltà round-trip
    /// integrale è irraggiungibile e NON è l'obiettivo di questo metodo. Il
    /// kernel non riscrive mai un file esistente passando da qui: serve a
    /// generare documenti nuovi (template, "crea nota") e frammenti. Le
    /// modifiche programmatiche a un documento esistente si fanno come patch
    /// chirurgiche sulla sorgente, guidate dagli `Span` del modello.
    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError>;
}
