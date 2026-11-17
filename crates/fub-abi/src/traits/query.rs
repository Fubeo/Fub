//! La domanda all'indice: `IndexQuery` e il modo in cui chi risponde si
//! dichiara (`QueryKind`, `PredicateKind`, `QueryRoute`).

use super::*;

/// Una interrogazione all'indice: il canale dati unico verso le view.
///
/// Ogni variante che seleziona documenti lo fa con lo stesso linguaggio
/// ([`QueryExpr`]), e ogni variante arriva a **qualcuno**: chi la serve è
/// dichiarato alla registrazione ([`QueryRoute`]), non scoperto provando in
/// ordine finché uno non dice di no.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IndexQuery {
    /// **I documenti che combaciano.** È la variante che ha sostituito
    /// `full_text` e `properties`: erano due modi di chiedere la stessa cosa —
    /// quali note — in due lingue che non si potevano comporre.
    ///
    /// Copre 9.1 (ricerca per campo), 8.4 (collezioni), 11 (database su file),
    /// 16 (template con query) e la ricerca vera e propria, e le mette **in
    /// congiunzione fra loro**: `matching` è un'espressione, non un filtro.
    Documents {
        #[serde(default)]
        matching: QueryExpr,
        /// Assente = per rilevanza se c'è (l'ordine di chi ha cercato),
        /// altrimenti per `DocId`.
        #[serde(default)]
        sort: Option<PropertySort>,
        /// Quali proprietà del frontmatter portarsi dietro: esiste per non far
        /// viaggiare l'intero frontmatter di mille note quando ne servono due
        /// colonne.
        #[serde(default)]
        select: PropertySelect,
        #[serde(default)]
        page: Option<Page>,
        /// Se le righe devono portare l'**estratto** attorno al match (§21.9).
        /// Assente = sì: chi non lo nomina riceve una risposta completa.
        #[serde(default)]
        excerpts: Excerpts,
    },
    /// I riferimenti entranti verso un documento, col loro contesto. Vale
    /// anche per un allegato: le note che lo incorporano o lo linkano.
    ///
    /// Resta una variante sua e non una `Documents` con
    /// [`QueryPredicate::Linked`](crate::query::QueryPredicate::Linked) perché
    /// la risposta è **diversa**: porta il frammento di testo in cui il link
    /// compare, che è ciò che un pannello backlink mostra. La forma senza
    /// contesto — «le note che nominano questa, in AND con altro» — è la foglia.
    Backlinks {
        target: DocId,
        #[serde(default)]
        page: Option<Page>,
    },
    /// La struttura (heading) di un documento: il modo con cui una view legge la
    /// struttura parsata senza avere un `FormatProvider` (che, essendo un
    /// plugin, non ha). Documento inesistente → outline vuota, non un errore.
    ///
    /// È l'unica risposta non paginata dell'enum, e per una ragione: cresce con
    /// **un** documento, non col vault, e chi la chiede ha già in mano quel
    /// documento intero.
    Outline { doc: DocId },
    /// I tag con la loro frequenza, in ordine di chiave canonica. Chi vuole i
    /// più usati ordina lui: l'ordine stabile è quello che rende paginabile la
    /// risposta.
    ///
    /// `matching` restringe **su quali documenti** si conta: vuoto = tutto il
    /// vault (il pannello dei tag, l'autocompletamento), altrimenti sono le
    /// **faccette** di un risultato — «quali tag hanno le note che parlano di
    /// rust» — che la decisione 0005 aveva dichiarato fuori portata perché
    /// avrebbero voluto un campo facet nel motore. Con un linguaggio non lo
    /// vogliono: il sottoinsieme è una query, e i tag li conta chi li ha in
    /// cache.
    Tags {
        #[serde(default)]
        matching: QueryExpr,
        #[serde(default)]
        page: Option<Page>,
    },
    /// I vicini nel grafo dei link, fino a `depth` passi.
    ///
    /// È il grafo (7.3) che entra nel contratto: finché usciva solo da un
    /// comando dell'app, una vista a grafo di terzi era impossibile e quella
    /// ufficiale restava superficie privilegiata.
    ///
    /// I **semi** sono un'espressione e non un documento solo, ed è ciò che
    /// rende esprimibile il grafo intero in una domanda sola (`seeds` vuota =
    /// tutto il vault, `depth: 1`, uscenti: sono esattamente gli archi) invece
    /// che in una domanda per nota — che sull'IPC vorrebbe dire mille viaggi
    /// per disegnare un grafo, cioè un comando bespoke.
    ///
    /// Nel verso uscente (o in entrambi) la risposta porta anche gli
    /// **allegati** che i documenti raggiunti nominano, `![[foto.png]]` o
    /// `[pdf](doc.pdf)`: sono foglie, un passo oltre la nota che li nomina, e
    /// il cammino non prosegue da loro. Chi vuole solo le note li riconosce
    /// perché `format_of` non dà un formato.
    Neighbors {
        #[serde(default)]
        seeds: QueryExpr,
        #[serde(default)]
        direction: LinkDirection,
        /// Passi di distanza, almeno 1 (`0` → risposta vuota).
        depth: u8,
        #[serde(default)]
        page: Option<Page>,
    },
    /// I valori distinti di una proprietà con quante note li portano: le
    /// **faccette** di 9.1. Un elenco contribuisce con ogni suo elemento (una
    /// nota con `autore: [a, b]` conta per `a` e per `b`), che è ciò che una
    /// faccetta deve fare.
    PropertyValues {
        key: String,
        /// Su quale sottoinsieme contare: le faccette si contano **sui documenti
        /// già selezionati**, o la navigazione per faccette non converge mai.
        #[serde(default)]
        matching: QueryExpr,
        #[serde(default)]
        page: Option<Page>,
    },
    /// Un controllo di salute del vault (7.2), dal grafo e dai modelli in
    /// memoria.
    VaultHealth {
        check: HealthCheck,
        #[serde(default)]
        page: Option<Page>,
    },
    /// Varco di estensione: query definite da un provider di terzi, con
    /// namespace (`ns` = plugin id). Chi non ha dichiarato quel `ns` non la
    /// riceve mai, e se non l'ha dichiarato nessuno il chiamante riceve
    /// [`PluginError::Unserved`] — non l'errore dell'ultimo interpellato.
    Custom {
        ns: String,
        query: serde_json::Value,
    },
    /// **Questo vault sa quando cambia da fuori?** (§9.7)
    ///
    /// È l'unica variante che non chiede niente *sul contenuto* del vault: chiede
    /// del vault stesso, e la ragione per cui passa da qui invece che da un
    /// comando suo è che i suoi due clienti sono già qui. La shell ha
    /// `query_index`; una feature ha `HostQuery` e null'altro — un comando IPC
    /// nuovo sarebbe stato visibile solo alla prima delle due, cioè un fatto che
    /// il core conosce e i plugin no.
    ///
    /// La domanda che risponde è quella che nessuno faceva: il watcher è
    /// **l'unico** meccanismo con cui Fub viene a sapere che qualcun altro ha
    /// toccato il vault — non c'è una riconciliazione periodica, e niente
    /// confronta mai la cache col disco — e finché nessuno chiedeva se fosse
    /// vivo, un vault senza rilevamento e uno con rilevamento erano
    /// indistinguibili da fuori.
    VaultStatus,
    /// **Cosa sta girando adesso in questo vault?** (§10.3)
    ///
    /// La seconda variante che non chiede del contenuto ma del vault stesso, e
    /// passa da qui per la ragione della [`VaultStatus`](IndexQuery::VaultStatus):
    /// i suoi clienti sono i due che il canale dati ce li ha già — la shell, che
    /// disegna il centro attività, e una feature, che di comandi IPC non ne ha
    /// nessuno.
    ///
    /// È anche la **riconciliazione** di quel centro, ed è la ragione per cui
    /// esiste invece di lasciar contare gli eventi: `job-started` e
    /// `job-progress` si riscoprono chiedendo
    /// ([`Event::is_recoverable`](crate::Event::is_recoverable)), quindi i freni
    /// del canale (decisione 0034) possono buttarli — e chi li butta manda un
    /// `overflow`, che vuol dire *richiedi*. Senza questa domanda quel
    /// troncamento sarebbe una perdita definitiva, cioè un centro attività che
    /// mostra per sempre un lavoro finito.
    Jobs,
    /// **Com'è configurato questo vault?** (§11.1)
    ///
    /// Torna le impostazioni *risolte*: lo schema che qualcuno ha dichiarato, il
    /// valore che vale adesso e da quale livello viene. È la terza variante che
    /// non chiede del contenuto ma del vault stesso, e passa da qui per la
    /// ragione delle altre due — un elenco è **dati**, e i dati hanno un canale
    /// solo (decisione 0013). Un `settings_list` sull'`HostApi` sarebbe stato il
    /// primo caso in cui la shell e un plugin chiedono la stessa cosa a due
    /// porte diverse.
    ///
    /// `plugin` assente = tutte, nell'ordine in cui sono state dichiarate (chi
    /// dichiara le scrive nell'ordine in cui vanno lette). Con un id, solo quelle
    /// dichiarate da lui: è ciò che serve al pannello di **un** plugin, e ciò
    /// che permette a chi disegna di non filtrare per prefisso — la chiave di
    /// una feature del core non ha un prefisso da confrontare.
    Settings { plugin: Option<String> },
    /// **Com'è organizzato questo vault?** (§11.3)
    ///
    /// Icone, note appuntate, ordinamenti scelti a mano, spazi. Passa da qui e
    /// non da un comando IPC per la ragione delle altre quattro varianti che
    /// chiedono del vault e non del contenuto: un elenco è **dati**, e i dati
    /// hanno un canale solo (decisione 0013). Prima era un comando IPC che
    /// restituiva il blob intero, quindi era una cosa che la shell sapeva
    /// chiedere e un provider no — la stessa asimmetria che il canale dati
    /// esiste per non avere.
    ///
    /// Senza parametri: l'organizzazione di un vault è una, e chi ne vuole un
    /// pezzo lo prende dal record. Non è paginata perché non cresce col vault ma
    /// con **ciò che l'utente ha toccato a mano** — le note che ha appuntato, le
    /// cartelle a cui ha dato un'icona.
    Organization,
    /// **Cosa nomina questo riferimento, adesso?** (§13.1)
    ///
    /// È l'altra metà della decisione 0043: se il path è la chiave per sempre,
    /// allora un riferimento *scritto* — un `[[Wikilink]]`, un `[t](a/b.md)` —
    /// non è una chiave, è un nome che va risolto, e la risoluzione ha regole
    /// (nome più vicino alla radice fra omonimi, alias del frontmatter, path
    /// relativo alla cartella di chi scrive) che vivono nel kernel.
    ///
    /// Finché quelle regole non uscivano di lì, la risposta la sapeva **la sola
    /// shell**, per un comando IPC scritto apposta (`resolve_link`): un fatto
    /// sul vault che il core conosceva e un provider no — la stessa asimmetria
    /// che il canale dati esiste per non avere (decisione 0019). Con questa
    /// variante il comando bespoke sparisce e la domanda ha una porta sola.
    ///
    /// I clienti veri sono tre e nessuno è ipotetico: la navigazione da un
    /// wikilink (la shell, oggi), un comando che riceve il nome di una nota
    /// invece del suo path — [`Args::document`](crate::command::Args::document)
    /// costruisce un [`DocId`] dalla stringa e **non risolve niente** — e i
    /// redirect da note rinominate (FEATURES 7.1), che la 0043 ha dichiarato
    /// essere una feature sopra il kernel: una tabella di alias che ascolta
    /// `DocumentRenamed` esiste già oggi, ciò che le mancava era qualcuno che le
    /// facesse la domanda.
    ///
    /// La risposta è **una o nessuna**, e non è paginata: risolvere non è
    /// cercare. Chi vuole i candidati di una ricerca per nome chiede
    /// [`Documents`](IndexQuery::Documents) con
    /// [`TextField::Name`](crate::query::TextField::Name), che è un'altra
    /// domanda e ha un'altra risposta.
    Resolve {
        /// Il bersaglio, nel vocabolario del modello: è ciò che un
        /// [`FormatProvider`](crate::format::FormatProvider) produce parsando, e
        /// riusarlo evita che il chiamante debba dire *di che specie* è il
        /// riferimento con una convenzione sua.
        ///
        /// [`LinkTarget::Url`] risolve a `None` e non è un errore: la domanda
        /// «questo riferimento è una nota del vault?» ha una risposta anche
        /// quando è no, ed è ciò che permette di passare qui l'esito di
        /// [`LinkTarget::classify`] senza filtrarlo prima.
        target: LinkTarget,
        /// Il documento **dentro cui** il riferimento è scritto. Serve ai
        /// [`LinkTarget::Path`], che sono relativi alla cartella di chi li
        /// ospita; assente = relativi alla radice del vault. Per un
        /// [`LinkTarget::Wiki`] non cambia niente, perché la regola Obsidian non
        /// guarda da dove si sta scrivendo.
        #[serde(default)]
        from: Option<DocId>,
    },
    /// **Cosa c'è nel vault**: l'anagrafe, non l'indice (§14.1, §14.2).
    ///
    /// È la sola domanda del canale che risponde anche su ciò che **non** è un
    /// documento, ed è per questo che è una variante e non un filtro di
    /// [`Documents`](IndexQuery::Documents): là si chiedono note, con
    /// frontmatter e rilevanza; qui si chiede *cosa c'è sul disco*, e la
    /// risposta include un PNG, uno ZIP e un file che nessuno sa cosa sia.
    ///
    /// La ragione per cui esiste è la stessa per cui la
    /// [decisione 0013](../../../docs/decisions/0185-capability-un-solo-guard.md)
    /// ha tenuto `create_folder` **fuori** dalle capacità: un'anagrafe che
    /// contenesse gli allegati senza che nessuna domanda li sappia chiedere
    /// sarebbe uno stato che il kernel tiene e nessuno può vedere. Passa di qui
    /// e non da una capacità nuova perché è **una risposta con dei dati**, e
    /// quelle passano dal canale dati
    /// ([decisione 0019](../../../docs/decisions/0182-provider-e-porte-generiche.md)).
    ///
    /// L'ordine è quello dei [`DocId`], come per i documenti e per la stessa
    /// ragione: è ciò che rende stabile una risposta paginata.
    Entries {
        /// Solo una specie, o tutte. `Some(Asset)` è la domanda «quali allegati
        /// ci sono», che è quella che serve a un pannello degli allegati e a
        /// chi cerca gli orfani; `None` è l'anagrafe intera, cioè l'albero dei
        /// file che la shell disegna.
        #[serde(default)]
        of_kind: Option<EntryKind>,
        /// **In quale cartella** (§14.4). Assente = tutto il vault, che è
        /// com'era prima che questo campo esistesse.
        ///
        /// È la metà che mancava al canale della lista: un albero disegna venti
        /// righe e ne chiedeva diecimila, perché l'unica domanda possibile era
        /// «tutto». Con `descendants: false` la risposta cresce con **la
        /// cartella aperta** e non col vault, e la finestra si applica dopo il
        /// filtro — cioè la pagina è una pagina di quella cartella.
        #[serde(default)]
        within: Option<FolderScope>,
        #[serde(default)]
        page: Option<Page>,
    },
    /// **Quali cartelle ci sono** (§14.3).
    ///
    /// Una variante sua e non una specie in più di
    /// [`Entries`](IndexQuery::Entries): una cartella non ha dimensione, non ha
    /// un contenuto da datare e non ha un'impronta, e infilarla in un
    /// [`VaultEntry`] avrebbe voluto dire tre campi che mentono e un filtro da
    /// ricordarsi in ogni cliente dell'anagrafe. Sono due domande, e chi
    /// disegna un livello di albero le fa tutte e due.
    ///
    /// Le cartelle escono dalla **camminata del disco**, non dai path dei file:
    /// una cartella vuota c'è, e resta lì quando la sua ultima nota va nel
    /// cestino — che è ciò che è successo davvero sul disco.
    Folders {
        /// Da dove guardare. Assente = ogni cartella del vault, a ogni
        /// profondità (l'elenco che serve a chi ne offre una da scegliere);
        /// [`FolderScope::direct`] = un livello solo, che è ciò che apre un nodo
        /// dell'albero.
        #[serde(default)]
        under: Option<FolderScope>,
        #[serde(default)]
        page: Option<Page>,
    },
    // In **coda** e non accanto a `VaultHealth`, che pure è la sua vicina di
    // senso: l'ordine dei casi è il discriminante dell'ABI, quindi una variante
    // inserita in mezzo rinumera tutte quelle che vengono dopo. Additiva vuol
    // dire in fondo — è la stessa disciplina delle righe che si appendono a un
    // registro, applicata a un enum.
    /// **Cosa è rimasto non salvato** (§15.2): le bozze che il buffer di crash
    /// ha lasciato sul disco.
    ///
    /// Passa da qui e non da un comando IPC suo per la ragione di `Watching`
    /// più sopra — i clienti sono già qui — e per una che è di questa variante
    /// soltanto: **leggere non è cambiare**
    /// ([0085](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)), e
    /// ritrovare ciò che si stava scrivendo è la lettura più innocua che ci
    /// sia. È chi decide *cosa farne* a mutare qualcosa, e quello è un comando.
    Drafts {
        #[serde(default)]
        page: Option<Page>,
    },
    // In **coda** come le altre varianti nuove: l'ordine dei casi è il
    // discriminante dell'ABI, e additiva vuol dire in fondo (0163).
    /// **Rendi un documento** (§16.6): l'anteprima intera, come la vede la
    /// shell.
    ///
    /// È la metà che mancava al canale dati: prima della 0163 la resa era un
    /// comando IPC bespoke (`render_preview`) che solo la shell sapeva
    /// chiamare, e un `ViewProvider` che voleva mostrare un documento reso non
    /// aveva una porta (difetto 0130). Passa di qui e non da un comando perché
    /// è **una risposta con dei dati**, e quelle passano dal canale dati
    /// (decisione 0019).
    ///
    /// La risposta è [`IndexResult::RenderPreview`], che porta un
    /// [`RenderedDocument`](crate::render::RenderedDocument): l'HTML e le
    /// parti dichiarative che la shell monta da sé.
    RenderPreview {
        /// Il documento da rendere.
        doc: DocId,
    },
    /// **Rendi un ritaglio** (§16.6): la sezione o il blocco che una
    /// transclusione nomina, dentro il documento che lo ospita.
    ///
    /// Come [`RenderPreview`](IndexQuery::RenderPreview), è la metà che
    /// mancava al canale dati: prima della 0163 la transclusione passava da un
    /// comando IPC bespoke (`render_embed`) che solo la shell sapeva chiamare.
    ///
    /// La risposta è [`IndexResult::RenderEmbed`], che porta un
    /// [`EmbedContent`](crate::render::EmbedContent): il documento reso e il
    /// suo id, perché chi monta un embed deve sapere da quale nota viene.
    RenderEmbed {
        /// La pagina che ospita il ritaglio.
        page: String,
        /// La sezione da rendere, se la transclusione ne nomina una.
        #[serde(default)]
        heading: Option<String>,
        /// Il blocco da rendere, se la transclusione ne nomina uno.
        #[serde(default)]
        block: Option<String>,
    },
    /// Le sintassi effettive di un documento, con la forma dichiarata dal
    /// provider o dalla regola registrata a runtime (§4.4).
    SyntaxForms { doc: DocId },
    /// Rende un documento per la stampa, applicando il bersaglio Print a ogni
    /// provider e renderer. L'anteprima resta una domanda distinta e invariata.
    RenderPrint { doc: DocId },
}

impl IndexQuery {
    /// La finestra chiesta, se la variante ne ha una.
    pub fn page(&self) -> Option<Page> {
        match self {
            IndexQuery::Documents { page, .. }
            | IndexQuery::Backlinks { page, .. }
            | IndexQuery::Tags { page, .. }
            | IndexQuery::Neighbors { page, .. }
            | IndexQuery::PropertyValues { page, .. }
            | IndexQuery::VaultHealth { page, .. }
            | IndexQuery::Drafts { page }
            | IndexQuery::Entries { page, .. }
            | IndexQuery::Folders { page, .. } => *page,
            IndexQuery::Outline { .. }
            | IndexQuery::Custom { .. }
            | IndexQuery::VaultStatus
            | IndexQuery::Jobs
            | IndexQuery::Settings { .. }
            | IndexQuery::Organization
            | IndexQuery::Resolve { .. }
            | IndexQuery::RenderPreview { .. }
            | IndexQuery::RenderEmbed { .. }
            | IndexQuery::RenderPrint { .. }
            | IndexQuery::SyntaxForms { .. } => None,
        }
    }

    /// L'espressione che la variante porta, se ne porta una: è ciò che il
    /// pianificatore deve risolvere **prima** di consegnare la query a chi la
    /// serve.
    pub fn expression(&self) -> Option<&QueryExpr> {
        match self {
            IndexQuery::Documents { matching, .. }
            | IndexQuery::Tags { matching, .. }
            | IndexQuery::PropertyValues { matching, .. } => Some(matching),
            IndexQuery::Neighbors { seeds, .. } => Some(seeds),
            IndexQuery::Backlinks { .. }
            | IndexQuery::Outline { .. }
            | IndexQuery::VaultHealth { .. }
            | IndexQuery::Drafts { .. }
            | IndexQuery::Custom { .. }
            | IndexQuery::VaultStatus
            | IndexQuery::Jobs
            | IndexQuery::Settings { .. }
            | IndexQuery::Organization
            | IndexQuery::Resolve { .. }
            // L'anagrafe non seleziona documenti: la sua domanda non è «quali
            // note combaciano» ma «cosa c'è», e un'espressione qui vorrebbe
            // dire filtrare dei file con un linguaggio che parla di note. Vale
            // anche per le cartelle, che una nota non lo sono affatto.
            | IndexQuery::Entries { .. }
            | IndexQuery::Folders { .. }
            // La resa non seleziona documenti: chiede un documento per nome,
            // non quali documenti combaciano.
            | IndexQuery::RenderPreview { .. }
            | IndexQuery::RenderEmbed { .. }
            | IndexQuery::RenderPrint { .. }
            | IndexQuery::SyntaxForms { .. } => None,
        }
    }

    /// Rimpiazza l'espressione con una già risolta (`Docs { … }`), lasciando
    /// tutto il resto com'era.
    pub fn with_expression(self, resolved: QueryExpr) -> IndexQuery {
        match self {
            IndexQuery::Documents {
                sort,
                select,
                page,
                excerpts,
                ..
            } => IndexQuery::Documents {
                matching: resolved,
                sort,
                select,
                page,
                excerpts,
            },
            IndexQuery::Tags { page, .. } => IndexQuery::Tags {
                matching: resolved,
                page,
            },
            IndexQuery::PropertyValues { key, page, .. } => IndexQuery::PropertyValues {
                key,
                matching: resolved,
                page,
            },
            IndexQuery::Neighbors {
                direction,
                depth,
                page,
                ..
            } => IndexQuery::Neighbors {
                seeds: resolved,
                direction,
                depth,
                page,
            },
            other => other,
        }
    }

    /// La famiglia di questa query: ciò che si dichiara di servire.
    pub fn kind(&self) -> QueryKind {
        match self {
            IndexQuery::Documents { .. } => QueryKind::Documents,
            IndexQuery::Backlinks { .. } => QueryKind::Backlinks,
            IndexQuery::Outline { .. } => QueryKind::Outline,
            IndexQuery::Tags { .. } => QueryKind::Tags,
            IndexQuery::Neighbors { .. } => QueryKind::Neighbors,
            IndexQuery::PropertyValues { .. } => QueryKind::PropertyValues,
            IndexQuery::VaultHealth { .. } => QueryKind::VaultHealth,
            IndexQuery::Drafts { .. } => QueryKind::Drafts,
            IndexQuery::Custom { ns, .. } => QueryKind::Custom(ns.clone()),
            IndexQuery::VaultStatus => QueryKind::VaultStatus,
            IndexQuery::Jobs => QueryKind::Jobs,
            IndexQuery::Settings { .. } => QueryKind::Settings,
            IndexQuery::Organization => QueryKind::Organization,
            IndexQuery::Resolve { .. } => QueryKind::Resolve,
            IndexQuery::Entries { .. } => QueryKind::Entries,
            IndexQuery::Folders { .. } => QueryKind::Folders,
            IndexQuery::RenderPreview { .. } => QueryKind::RenderPreview,
            IndexQuery::RenderEmbed { .. } => QueryKind::RenderEmbed,
            IndexQuery::SyntaxForms { .. } => QueryKind::SyntaxForms,
            IndexQuery::RenderPrint { .. } => QueryKind::RenderPrint,
        }
    }
}

/// La famiglia di una [`IndexQuery`]: ciò che un indice dichiara di **servire**.
///
/// Non è il `kind` della serializzazione con un nome diverso: `Custom` porta il
/// namespace, perché due plugin che estendono il canale non si contendono la
/// stessa casella.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum QueryKind {
    Documents,
    Backlinks,
    Outline,
    Tags,
    Neighbors,
    PropertyValues,
    VaultHealth,
    Custom(String),
    /// Chi risponde a «questo vault sa quando cambia da fuori?» (§9.7). Il
    /// proprietario è il kernel, e non è un'ovvietà del codice: è l'unico che
    /// conosce sia l'esito delle sincronizzazioni sia il fatto — passatogli da
    /// chi monta — che un rilevatore ci sia.
    VaultStatus,
    /// Chi risponde a «cosa sta girando adesso?» (§10.3). Il proprietario è di
    /// nuovo il kernel, e di nuovo non per abitudine: la coda dei job è sua
    /// (`spawn_job` conta gli id, `complete_job` chiude), e chi possiede i
    /// thread — che pure sa quali sono partiti — non sa niente di quelli che
    /// devono ancora entrargli in mano.
    Jobs,
    /// Chi risponde a «com'è configurato questo vault?» (§11.1). Il
    /// proprietario è ancora il kernel, e stavolta per un motivo che si vede a
    /// occhio: lo schema lo tiene il registro dei plugin, il valore lo tiene lo
    /// store di configurazione, e sono due cose che stanno nello stesso posto
    /// solo lì.
    Settings,
    /// Chi risponde a «com'è organizzato questo vault?» (§11.3). Il proprietario
    /// è il kernel, e stavolta è una **conquista** e non una constatazione:
    /// finché il sidecar lo leggevano due funzioni dell'host con `std::fs`,
    /// questa domanda non aveva un proprietario affatto — la sapeva fare la
    /// shell, e nessun altro.
    Organization,
    /// Chi risponde a «cosa nomina questo riferimento?» (§13.1). Il proprietario
    /// è il kernel perché la risoluzione è una funzione del **grafo**, che è
    /// suo: gli omonimi si dirimono per distanza dalla radice e gli alias
    /// stanno in un indice che solo lui tiene.
    ///
    /// Che sia una famiglia con un padrone solo — e quindi che un plugin di
    /// redirect **non** possa scavalcarla — è deliberato: chi risolvesse al
    /// posto del kernel deciderebbe anche dove puntano i link nel grafo, cioè
    /// riscriverebbe l'anagrafe del vault dal di fuori. Un redirect è ciò che si
    /// dice quando la risposta è `None`, e vive accanto a questa domanda, non al
    /// suo posto.
    Resolve,
    /// Chi risponde a «cosa c'è in questo vault?» (§14.1, §14.2). Il
    /// proprietario è il kernel, e stavolta per esclusione: l'anagrafe la
    /// costruisce chi cammina il disco, e nessun altro cammina il disco.
    ///
    /// Un indice di terzi può **sostituirla** come ogni altra famiglia — un
    /// giorno, un indice che tiene il proprio elenco su un supporto remoto —
    /// ma chi lo fa si prende anche il resto: la scansione, il rilevamento e la
    /// tabella che il kernel scrive sono la sua fonte, non la sua copia.
    Entries,
    /// Chi risponde a «quali cartelle ci sono?» (§14.3). Il kernel, e per la
    /// ragione di [`Entries`](QueryKind::Entries): una cartella la vede chi
    /// cammina il disco. Le due famiglie restano **due**, così che un indice
    /// che sappia elencare i file di un supporto remoto possa rivendicare la
    /// prima senza doversi inventare la seconda.
    Folders,
    /// Ciò che è rimasto non salvato (§15.2). In coda come nell'[`IndexQuery`],
    /// e per la stessa ragione: l'ordine è il discriminante.
    Drafts,
    /// Chi risponde a «rendi questo documento» (§16.6). Il proprietario è il
    /// kernel, e stavolta per costruzione: la resa compone provider e renderer
    /// registrati, e il registro è suo. In coda come nell'[`IndexQuery`].
    RenderPreview,
    /// Chi risponde a «rendi questo ritaglio» (§16.6). Il proprietario è il
    /// kernel, per la ragione di [`RenderPreview`](QueryKind::RenderPreview):
    /// un ritaglio si rende con gli stessi provider e renderer. In coda come
    /// nell'[`IndexQuery`].
    RenderEmbed,
    /// Chi risponde a «quali forme sintattiche capisce questo documento?».
    /// Il kernel, perché compone il provider col registro aggiornato a runtime.
    SyntaxForms,
    /// Resa per la stampa, distinta dall'anteprima anche nel routing.
    RenderPrint,
}

/// La specie di una [`QueryPredicate`]: ciò che un indice dichiara di saper
/// **valutare**.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum PredicateKind {
    Text,
    Property,
    Tag,
    Folder,
    Linked,
    Custom(String),
    Regex,
    Task,
    Path,
    File,
    Scoped,
    TaskDue,
}

impl PredicateKind {
    pub fn of(predicate: &QueryPredicate) -> Option<PredicateKind> {
        match predicate {
            QueryPredicate::Text(_) => Some(PredicateKind::Text),
            QueryPredicate::Regex { .. } => Some(PredicateKind::Regex),
            QueryPredicate::Task { .. } => Some(PredicateKind::Task),
            QueryPredicate::Path { .. } => Some(PredicateKind::Path),
            QueryPredicate::File { .. } => Some(PredicateKind::File),
            QueryPredicate::Scoped { .. } => Some(PredicateKind::Scoped),
            QueryPredicate::TaskDue { .. } => Some(PredicateKind::TaskDue),
            QueryPredicate::Property { .. } => Some(PredicateKind::Property),
            QueryPredicate::Tag { .. } => Some(PredicateKind::Tag),
            QueryPredicate::Folder { .. } => Some(PredicateKind::Folder),
            QueryPredicate::Linked { .. } => Some(PredicateKind::Linked),
            QueryPredicate::Custom { ns, .. } => Some(PredicateKind::Custom(ns.clone())),
            // `Docs` non ha proprietario: è già la risposta, e chiunque riceva
            // un'espressione deve saperla leggere (è la forma in cui il
            // pianificatore consegna ciò che ha risolto per conto suo).
            QueryPredicate::Docs { .. } => None,
        }
    }
}

/// Cosa un [`IndexProvider`] dichiara di servire, **alla registrazione**.
///
/// Prima non si dichiarava niente: il kernel provava gli indici in ordine finché
/// uno non rispondeva `BadArgs`, e di `BadArgs` arrivava al chiamante quello
/// dell'**ultimo** interpellato mentre ogni altro errore tornava dal **primo**
/// che lo dava — da fuori i due casi non si distinguevano. Con un indice
/// funzionava benissimo; con quelli che FEATURES chiede (full-text, semantico e
/// vettoriale, proprietà, task, database, citazioni) ogni query gira su tutti, e
/// due indici che rivendicano la stessa cosa si oscurano a vicenda **in
/// silenzio**.
///
/// # Le due specie, e perché una sola ha un padrone
///
/// - Una **variante** ([`Query`](QueryRoute::Query)) ha un proprietario solo. Lì
///   la risposta si **compone** — il conteggio dei tag, l'elenco dei backlink,
///   il verdetto di un controllo di salute — e due autori per la stessa risposta
///   vuol dire che vince chi si è registrato prima, cioè un dettaglio di
///   montaggio. Registrare una variante già rivendicata è un conflitto, con la
///   stessa disciplina del `FormatRegistry` (decisione 0017): si rifiuta, e chi
///   vuole **sostituire** lo chiede per nome.
/// - Un **predicato** ([`Predicate`](QueryRoute::Predicate)) può averne più
///   d'uno, e non è una tolleranza: un predicato è un *fatto sul vault*, e `#rust`
///   seleziona le stesse note per chiunque le conti. Chi indicizza il testo
///   conosce anche cartelle e tag — li ha indicizzati per poter filtrare senza
///   uscire dal motore — e dichiararlo è ciò che permette al pianificatore di
///   consegnargli l'intera clausola invece di ricomporla a mano. Chi rivendica
///   una foglia promette la **stessa** risposta degli altri; a chi sia andata
///   davvero risponde il piano, che è visibile.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "route", rename_all = "snake_case")]
pub enum QueryRoute {
    /// «Rispondo io a questa famiglia di domande.»
    Query(QueryKind),
    /// «So valutare questa foglia.»
    Predicate(PredicateKind),
}
