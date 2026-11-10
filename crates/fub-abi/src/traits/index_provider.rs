//! La risposta dell'indice (`IndexResult` e i suoi tipi) e il trait
//! `IndexProvider`.

use super::*;

/// Un riferimento entrante (backlink) verso un documento.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BacklinkRef {
    pub source: DocId,
    pub context: Option<String>,
}

/// Un vicino nel grafo (risposta a [`IndexQuery::Neighbors`]).
///
/// `via` è l'anello precedente del cammino, e c'è perché senza di esso una
/// risposta con `depth > 1` è un sacchetto di nodi: con esso è un **albero**, e
/// gli archi si ricostruiscono. L'arco è `via → doc` per i link uscenti,
/// `doc → via` per gli entranti; a `depth: 1` `via` è il documento interrogato.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NeighborRef {
    pub doc: DocId,
    pub via: DocId,
    /// Passi dal documento interrogato: 1 = adiacente.
    pub depth: u8,
}

/// Che rapporto ha questo vault con il disco (risposta a
/// [`IndexQuery::VaultStatus`], §9.7).
///
/// I tre campi sono tre domande diverse, e tenerle separate è il punto:
/// «Fub **saprebbe** che il vault è cambiato», «**è già** successo qualcosa
/// che non ha saputo leggere», e «cosa». Un booleano solo avrebbe confuso un
/// vault senza rilevamento — dove il rischio è noto e permanente — con un vault
/// che il rilevamento ce l'ha e ha appena mancato un file, che è un incidente.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultStatus {
    /// `false` = **nessuno vede le scritture altrui**. Non è una condizione di
    /// nicchia: non c'è su network share e cloud drive, sui vault sincronizzati
    /// con strumenti esterni, oltre il limite di inotify su vault grandi, e non
    /// esisterà affatto su CLI, PWA e mobile.
    pub watching: bool,
    /// Quante sincronizzazioni per-path sono fallite da quando il vault è
    /// aperto. Erano `let _ =`: un file esterno che non si legge o non si parsa
    /// lasciava la cache, il grafo e l'indice fermi a **prima**, per sempre,
    /// senza che niente lo dicesse.
    pub sync_failures: u32,
    /// L'ultimo di quei fallimenti, già composto. È un messaggio e non un
    /// codice, e va con il §12.2: quando l'errore al confine avrà una forma,
    /// l'avrà anche questo.
    pub last_sync_error: Option<String>,
    /// **A che punto è l'indicizzazione** dell'apertura (§15.7).
    pub indexing: IndexingState,
}

/// **Se ciò che l'indice risponde è tutto** (§15.7).
///
/// Un vault si apre in due tempi: appena scansionato è utilizzabile — le note
/// ci sono, si aprono, si scrivono — e la ricerca si popola dopo. Chi disegna
/// un risultato deve poter dire «sto ancora indicizzando» invece di mostrare
/// *niente trovato*, che nei primi secondi di un vault grande sarebbe una
/// risposta falsa e indistinguibile da quella vera.
///
/// **Non porta numeri**, ed è deliberato: a che punto è lo racconta il job
/// `vault.index` come qualunque altro lavoro lungo
/// ([`JobStatus::progress`], §10.3). Un `done`/`total` anche qui sarebbe una
/// seconda sorgente per la stessa barra, e le due divergerebbero il giorno che
/// una delle due si aggiorna e l'altra no.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexingState {
    /// L'indicizzazione sta camminando.
    Running,
    /// È arrivata in fondo: l'indice sa tutto ciò che c'è da sapere.
    ///
    /// È il **default** perché è lo stato di un vault che non ha niente da
    /// indicizzare, ed è la risposta giusta per ogni host che serve questa
    /// struttura senza avere un'apertura in corso.
    #[default]
    Ready,
    /// È stata interrotta — dal pulsante, o da un vault che chiude. Ciò che c'è
    /// è buono, ciò che manca non ha un nome, e si rifà riaprendo.
    Stopped,
}

/// Un tag del vault con quante note lo portano (risposta a
/// [`IndexQuery::Tags`]).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagCount {
    /// Nome del tag senza `#`, con la gerarchia intatta (`a/b`).
    pub name: String,
    pub count: u32,
}

/// La risposta a una [`IndexQuery`].
///
/// Tag **adiacente** (`kind` + `value`) e non interno, e non è una scelta di
/// gusto: `Outline` porta una lista e `Custom` può portare uno scalare, e un
/// `variant` con tag interno e payload che non è una mappa **non si
/// serializza** — `serde_json` fallisce a runtime, non in compilazione. Era
/// latente finché nessuno metteva un `IndexResult` sul filo; il canale dati
/// generico sull'IPC (§5.4) ce lo mette a ogni ricerca. È lo stesso difetto che
/// la decisione 0005 aveva trovato su `PropertyValue`, `LinkTarget` e `Inline`,
/// nello stesso modo: mettendoli in un test che li serializza tutti.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum IndexResult {
    /// I documenti che combaciano (risposta a [`IndexQuery::Documents`]).
    Documents(Paged<DocumentMatch>),
    Backlinks(Paged<BacklinkRef>),
    /// Gli heading di un documento, in ordine di apparizione (risposta a
    /// [`IndexQuery::Outline`]). L'unica risposta senza finestra: cresce con un
    /// documento, non col vault.
    Outline(Vec<Heading>),
    /// I tag con la loro frequenza (risposta a [`IndexQuery::Tags`]).
    Tags(Paged<TagCount>),
    /// I vicini nel grafo (risposta a [`IndexQuery::Neighbors`]), per distanza
    /// crescente e poi per `DocId`.
    Neighbors(Paged<NeighborRef>),
    /// Le faccette di una proprietà (risposta a [`IndexQuery::PropertyValues`]).
    PropertyValues(Paged<PropertyCount>),
    /// I problemi trovati (risposta a [`IndexQuery::VaultHealth`]).
    VaultHealth(Paged<HealthIssue>),
    /// Risposta a una [`IndexQuery::Custom`].
    Custom(serde_json::Value),
    /// Il rapporto fra questo vault e il disco (risposta a
    /// [`IndexQuery::VaultStatus`]).
    VaultStatus(VaultStatus),
    /// I lavori lunghi vivi (risposta a [`IndexQuery::Jobs`]), in ordine di
    /// [`JobId`] — cioè di richiesta.
    ///
    /// Senza finestra, come l'outline e per la stessa ragione: non cresce col
    /// vault. Cresce con quanti job ci sono insieme, che è un numero piccolo per
    /// costruzione — i thread che li eseguono sono due.
    Jobs(Vec<JobStatus>),
    /// Le impostazioni risolte (risposta a [`IndexQuery::Settings`]), in ordine
    /// di chiave.
    ///
    /// Senza finestra come le due sopra: un'impostazione la dichiara qualcuno
    /// che l'ha scritta a mano, quindi il loro numero cresce con i plugin
    /// montati e non col vault. Il giorno che un plugin ne dichiarasse mille,
    /// il problema non sarebbe la finestra.
    Settings(Vec<SettingEntry>),
    /// L'organizzazione del vault (risposta a [`IndexQuery::Organization`]):
    /// icone, appuntate, ordinamenti, spazi.
    ///
    /// Un record e non una lista, perché è **una** cosa e non un elenco: chi la
    /// chiede la disegna intera (la sidebar) o ne guarda un campo.
    Organization(Organization),
    /// Cosa nomina un riferimento, o niente (risposta a
    /// [`IndexQuery::Resolve`]).
    ///
    /// `None` non è un errore ed è metà del valore di questa risposta: un
    /// link rotto, un `Url` verso il mondo esterno e una nota rinominata via da
    /// sotto danno tutti e tre `None`, e chi ha chiesto sa che deve proporre
    /// qualcos'altro — creare la nota (§21.7), seguire un redirect, aprire il
    /// browser. Distinguerli qui vorrebbe dire mettere nella risposta di una
    /// domanda sull'anagrafe le ragioni di chi non c'è, che sono di chi
    /// chiede.
    ///
    /// Il payload è un [`ResolvedRef`] e non un [`DocId`] nudo dalla decisione
    /// 0049: `[[Nota#Sezione]]` e `[[Nota#^blocco]]` **portano** un punto — il
    /// modello lo parsa dalla 0003 — e una risposta che sa dire solo *quale
    /// documento* costringeva chi risolve a scartarlo, che è ciò che tutti e
    /// cinque i punti del kernel facevano. È un **ritaglio** della linea di
    /// base, non un'aggiunta: la variante c'era già, e affiancargliene una
    /// seconda avrebbe lasciato per sempre due casi che rispondono alla stessa
    /// domanda, con chi legge a doversi ricordare quale guardare
    /// (`../../../docs/reference/abi-and-wit.md`, tabella dei ritagli).
    Resolved(Option<ResolvedRef>),
    /// Cosa c'è nel vault (risposta a [`IndexQuery::Entries`]), in ordine di
    /// [`DocId`].
    ///
    /// **A finestra**, e qui più che altrove: è l'unica risposta che cresce col
    /// numero di *file* invece che col numero di note, e in un vault vero gli
    /// allegati sono più delle note.
    Entries(Paged<VaultEntry>),
    /// Le cartelle (risposta a [`IndexQuery::Folders`]), in ordine di path.
    ///
    /// A finestra come l'anagrafe: chieste `under` una cartella sono poche, ma
    /// chieste su tutto il vault sono tante quante le cartelle — e chi ne offre
    /// un elenco da scegliere non deve trasferirle tutte per mostrarne dieci.
    Folders(Paged<VaultFolder>),
    /// Ciò che era rimasto non salvato (risposta a [`IndexQuery::Drafts`]). In
    /// coda come la sua domanda, e per la stessa ragione: l'ordine dei casi è
    /// il discriminante dell'ABI.
    Drafts(Paged<DraftInfo>),
    /// Il documento reso (risposta a [`IndexQuery::RenderPreview`]): l'HTML e
    /// le parti dichiarative che la shell monta da sé. In coda come la sua
    /// domanda.
    RenderPreview(RenderedDocument),
    /// Il ritaglio reso (risposta a [`IndexQuery::RenderEmbed`]): il documento
    /// e il suo id, perché chi monta un embed deve sapere da quale nota viene.
    /// In coda come la sua domanda.
    RenderEmbed(EmbedContent),
    /// Le forme sintattiche effettive (risposta a [`IndexQuery::SyntaxForms`]).
    SyntaxForms(Vec<SyntaxForm>),
    /// Il documento reso per la stampa.
    RenderPrint(RenderedDocument),
}

impl IndexResult {
    /// I documenti di una risposta a [`IndexQuery::Documents`], o l'errore che
    /// dice cosa è arrivato invece.
    ///
    /// Esiste perché il `match` con un ramo «l'indice ha risposto fuori tema»
    /// era scritto in ogni chiamante, ogni volta con un messaggio diverso: è la
    /// forma minima del §16.6 applicata al canale più usato.
    pub fn documents(self) -> Result<Paged<DocumentMatch>, PluginError> {
        match self {
            IndexResult::Documents(docs) => Ok(docs),
            other => Err(PluginError::Internal(
                format!(
                    "risposta fuori tema: attesi dei documenti, arrivato {}",
                    other.kind_name()
                )
                .into(),
            )),
        }
    }

    /// I backlink, o l'errore che dice cosa è arrivato invece: la stessa
    /// forma di [`documents`](IndexResult::documents).
    pub fn backlinks(self) -> Result<Paged<BacklinkRef>, PluginError> {
        match self {
            IndexResult::Backlinks(refs) => Ok(refs),
            other => Err(PluginError::Internal(
                format!(
                    "risposta fuori tema: attesi dei backlink, arrivato {}",
                    other.kind_name()
                )
                .into(),
            )),
        }
    }

    /// Il nome della variante, per i messaggi d'errore.
    pub fn kind_name(&self) -> &'static str {
        match self {
            IndexResult::Documents(_) => "documents",
            IndexResult::Backlinks(_) => "backlinks",
            IndexResult::Outline(_) => "outline",
            IndexResult::Tags(_) => "tags",
            IndexResult::Neighbors(_) => "neighbors",
            IndexResult::PropertyValues(_) => "property-values",
            IndexResult::VaultHealth(_) => "vault-health",
            IndexResult::Custom(_) => "custom",
            IndexResult::VaultStatus(_) => "vault-status",
            IndexResult::Jobs(_) => "jobs",
            IndexResult::Settings(_) => "settings",
            IndexResult::Organization(_) => "organization",
            IndexResult::Resolved(_) => "resolved",
            IndexResult::Entries(_) => "entries",
            IndexResult::Folders(_) => "folders",
            IndexResult::Drafts(_) => "drafts",
            IndexResult::RenderPreview(_) => "render-preview",
            IndexResult::RenderEmbed(_) => "render-embed",
            IndexResult::SyntaxForms(_) => "syntax-forms",
            IndexResult::RenderPrint(_) => "render-print",
        }
    }
}

/// **Su questa identità, l'indice adesso mente** (§20.1, decisione 0051).
///
/// È ciò che i tre metodi dell'alimentazione restituiscono, ed è un dato e non
/// un errore: non dice «la chiamata è fallita», dice *quale documento* è rimasto
/// fuori. La differenza è tutta la voce — un indice che perdeva un documento non
/// aveva un valore di ritorno con cui dirlo, e «l'indice ha perso qualcosa»
/// senza un [`DocId`] non fa agire nessuno.
///
/// Il significato è uno solo, letto dal verso di ognuno dei tre metodi:
///
/// - dopo un [`on_documents_indexed`](IndexProvider::on_documents_indexed):
///   questo documento **non c'è**, e chi cerca non lo troverà;
/// - dopo un [`on_documents_removed`](IndexProvider::on_documents_removed):
///   questo documento **c'è ancora**, e chi cerca lo troverà pur essendo sparito
///   dal vault;
/// - dopo un [`reconcile`](IndexProvider::reconcile): questo documento è morto
///   ad app chiusa e l'indice non è riuscito a dimenticarlo.
///
/// In tutti e tre i casi, ciò che l'indice risponde su quell'identità non
/// corrisponde più al vault, e chi ha un canale per dirlo lo dice (§20.2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct IndexLoss {
    /// Il documento su cui l'indice non è più allineato. Nominarlo è l'intero
    /// scopo di questo tipo: è ciò che un esito cumulativo — «il flush è
    /// fallito» — non sa dire, e senza cui nessuno può né ritentare né mostrare
    /// niente di utile.
    pub id: DocId,
    /// Perché, nella forma con cui ogni fallimento arriva a chi disegna: un
    /// [`Text`](crate::text::Text) dentro un [`PluginError`], quindi
    /// traducibile da chi lo mostra (decisione 0041).
    pub why: PluginError,
}

impl IndexLoss {
    /// La perdita di un documento, con la ragione già composta.
    pub fn new(id: DocId, why: PluginError) -> Self {
        IndexLoss { id, why }
    }
}

/// Un indice derivato dal contenuto del vault.
///
/// Il kernel lo alimenta **direttamente** (non via event bus): ogni documento
/// che entra o esce dal `Workspace` passa da `on_documents_indexed` /
/// `on_documents_removed` dentro la stessa operazione che aggiorna il grafo.
/// Un indice non può quindi perdere aggiornamenti per un troncamento della
/// coda eventi ([`Event::Overflow`](crate::Event::Overflow)) — è la ragione
/// per cui l'alimentazione non passa da [`EventHandler`].
///
/// Resta un solo modo di divergere dal vault: ciò che succede mentre l'indice
/// **non è vivo** (documenti cancellati ad app chiusa, se l'indice è
/// persistente). Lo chiude [`IndexProvider::reconcile`].
///
/// # L'alimentazione ha un esito, ed è a lotti (§20.1, decisione 0051)
///
/// I tre metodi che portano il dato restituivano `()` mentre `activate` e
/// `flush` restituivano un `Result`: il ciclo di vita poteva fallire e dirlo,
/// l'alimentazione no. E il canale che il [`PIANO`](../../../docs/project/status.md)
/// dichiarava incapace di perdere pezzi — *«un indice che perde un aggiornamento
/// non tace: risponde sbagliato, in silenzio»* — manteneva la promessa a metà:
/// il **canale** non tronca, ma il **destinatario** può rifiutare, e la firma
/// rendeva quel rifiuto indicibile.
///
/// Le due domande erano due — *che forma ha l'esito* e *qual è la grana* — e
/// hanno una risposta sola, che è la ragione per cui sono state decise insieme:
/// un esito **per lotto** dice *quale* documento (cosa che un esito cumulativo
/// raccolto dal `flush` non sa fare) e costa **un attraversamento del confine
/// per lotto** invece che per documento, con lo stesso campo. A M5 ogni
/// chiamata è una serializzazione, e un `reindex` da 100k note con la firma di
/// prima erano 100k attraversamenti per indice.
///
/// Ciò che il lotto **non** riduce è il volume: quei modelli passano comunque,
/// e per intero. Riduce il numero di volte in cui si attraversa, che è l'unica
/// metà del costo su cui una firma possa qualcosa.
///
/// # Dove sta l'`HostApi`, e perché non è su ogni metodo
///
/// Un indice persistente deve poter **caricare e salvare** il proprio stato, e
/// l'unico storage durevole del contratto è `data_*` dell'[`HostApi`]: senza
/// host in nessuna firma, un index provider di terzi in WASM non potrebbe
/// persistere nulla — lo stesso buco che il versioning ha fatto emergere per
/// [`EventHandler`]. L'host arriva quindi nei **due punti in cui lo stato
/// attraversa il disco**: [`activate`](IndexProvider::activate) per leggerlo,
/// [`flush`](IndexProvider::flush) per scriverlo.
///
/// Non sugli altri, e per ragioni, non per risparmio:
///
/// - `on_documents_*` e `reconcile` sono **mutazioni in memoria**: fra un
///   `on_documents_*` e il `flush` il provider accumula (è già il contratto di
///   `flush`, che esiste perché il kernel scrive un documento alla volta e un
///   indice vuole scrivere a lotti). Dare l'host qui costringerebbe il kernel a
///   prestare `&mut Workspace` dentro il ciclo di alimentazione, cioè a
///   duplicare il modello appena parsato a ogni salvataggio.
/// - `query` prende `&self` e il kernel serve le interrogazioni **sotto
///   prestito condiviso** del workspace: un host per-query lo prenderebbe in
///   esclusiva, il contrario della direzione in cui va la concorrenza
///   (`Mutex` → `RwLock`). Un indice risponde da ciò che ha già in mano.
///
/// L'host è per-chiamata e non un handle conservato alla costruzione perché è
/// l'unica forma che regge entrambi i backend: un handle dovrebbe essere
/// `'static` (la regola d'oro vieta i lifetime nelle firme) e l'host del kernel
/// **è** un prestito `&mut Workspace`, che `'static` non può essere.
pub trait IndexProvider: Send + Sync {
    /// **Cosa serve**, dichiarato una volta alla registrazione.
    ///
    /// È la metà che mancava: senza, il kernel non poteva fare altro che
    /// interpellare tutti in ordine e dedurre da un errore chi fosse il
    /// destinatario. Con essa il dispatch è una lettura di tabella, un
    /// conflitto si vede **al montaggio** invece che come una risposta
    /// plausibile e sbagliata, e «nessuno serve questa domanda»
    /// ([`PluginError::Unserved`]) è distinguibile da «chi la serve ha
    /// fallito» — che è il §12.2 applicato al canale più usato dopo la lista
    /// documenti.
    ///
    /// Dichiarare una famiglia è impegnativo: chi dichiara
    /// [`QueryKind::Tags`] riceverà **ogni** interrogazione sui tag, e nessun
    /// altro la vedrà. Dichiarare un predicato lo è meno — un predicato è un
    /// fatto, e più d'uno lo può verificare — ma chi lo fa promette la stessa
    /// risposta degli altri. Vedi [`QueryRoute`].
    ///
    /// Un elenco vuoto è legittimo e vuol dire una cosa sola: questo indice
    /// **non risponde a niente**, si limita a stare dietro all'alimentazione.
    /// È il caso di chi accumula per esportare, e non è più un indice muto per
    /// sbaglio — lo è per dichiarazione.
    fn routes(&self) -> Vec<QueryRoute>;

    /// Carica lo stato persistente dell'indice. Il kernel la chiama **una
    /// volta**, quando l'indice viene registrato, prima di qualunque
    /// alimentazione.
    ///
    /// Un indice tutto in memoria non ha niente da fare qui; un indice
    /// persistente ricostruisce da `data_*` ciò che gli serve per riconoscere
    /// quel che ha già visto (ed è quel riconoscimento a rendere rapida la
    /// riapertura di un vault non toccato). L'errore non è fatale per il
    /// chiamante: un indice è stato *derivato*, e nel dubbio si ricostruisce.
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;

    /// **Prendi questi documenti**, e di' quali non hai preso.
    ///
    /// I tre metodi dell'alimentazione — questo, `on_documents_removed` e
    /// `reconcile` — sono a **lotto** e restituiscono un esito; erano per
    /// documento e restituivano `()`, ed è il ritaglio della
    /// [decisione 0051](../../../docs/decisions/README.md).
    /// Vedi [`IndexLoss`] per cosa vuol dire nominare una perdita, e il doc del
    /// trait per perché la grana e l'esito sono la stessa domanda.
    ///
    /// # Un lotto non è una transazione
    ///
    /// È la stessa frase della [decisione 0011](../../../docs/decisions/README.md),
    /// e vale nello stesso senso: un lotto **accettato a metà è la norma**, non
    /// un errore. Ciò che si elenca è perduto, ciò che non si elenca è preso, e
    /// non c'è niente da annullare — il chiamante non ritenta il lotto e non
    /// butta via il resto. Un elenco vuoto vuol dire che è andato tutto bene,
    /// ed è ciò che restituisce chi non ha niente da dire.
    ///
    /// Chi fallisce **in blocco** — il writer è andato, l'indice non è più
    /// affidabile — elenca tutto ciò che gli è stato dato. Costa una riga e
    /// dice la verità: quel documento, in quell'indice, adesso non c'è.
    ///
    /// # Chi taglia il lotto
    ///
    /// Il kernel, che è l'unico a sapere quanti modelli ha in mano. Un indice
    /// non può quindi dedurre niente dalla **dimensione** di ciò che riceve: un
    /// lotto di uno non vuol dire «una scrittura singola» e un lotto pieno non
    /// vuol dire «apertura del vault». Ciò che si può dedurre da un lotto è una
    /// cosa sola, e basta: questi documenti sono arrivati insieme, quindi si
    /// possono scrivere insieme.
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss>;

    /// **Togli questi documenti**, e di' quali non hai tolto.
    ///
    /// Il gemello di [`on_documents_indexed`](IndexProvider::on_documents_indexed),
    /// e l'esito ha lo stesso significato letto dall'altro verso: un id
    /// elencato qui è un documento che **c'è ancora** in un indice da cui il
    /// vault l'ha tolto. È la bugia opposta e la più visibile delle due — chi
    /// cerca trova una nota che non esiste e la apre.
    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss>;

    /// Allinea l'indice alla verità completa del vault: `ids` è l'insieme di
    /// **tutti** i documenti esistenti, e ciò che l'indice ha in più è morto e
    /// va cancellato. Il kernel la chiama dopo la scansione del vault.
    ///
    /// Non è un rebuild: i documenti già presenti e immutati non vanno
    /// reindicizzati (è ciò che rende rapida la riapertura di un vault).
    ///
    /// L'esito è l'unico dei tre che nomina identità **che il chiamante non ha
    /// mandato**: ciò che non si è potuto cancellare è per definizione fuori da
    /// `ids`. Il significato però è lo stesso di sempre — su questa identità
    /// l'indice adesso mente — ed è la ragione per cui il tipo è lo stesso.
    fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss>;
    /// Punto di consistenza **e di persistenza**: al ritorno, tutto ciò che è
    /// stato accettato finora è visibile alle `query` e durevole.
    ///
    /// Esiste perché il kernel scrive **un documento alla volta** ma un
    /// indice vuole scrivere **a lotti**: fra un `on_documents_*` e il `flush`
    /// il provider è libero di accumulare. Chi interroga senza aspettare un
    /// flush vede comunque le proprie scritture — è il provider a garantirlo,
    /// non il chiamante.
    ///
    /// È l'unico punto in cui un indice scrive, e per questo riceve l'host:
    /// ciò che deve sopravvivere alla chiusura passa da `data_*`.
    fn flush(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;

    /// **L'ultima chiamata**: l'indice sta per smettere, e questo è il punto in
    /// cui lascia andare ciò che tiene — segmenti mmappati, lock file, thread di
    /// merge, handle aperti. Il gemello di
    /// [`activate`](IndexProvider::activate), che è la prima.
    ///
    /// Il kernel chiama [`flush`](IndexProvider::flush) e **poi** questa: chi
    /// arriva qui ha già avuto il proprio punto di persistenza, e l'host lo
    /// riceve lo stesso perché una chiusura può avere qualcosa di suo da
    /// scrivere (un marcatore di spegnimento pulito, che alla riapertura
    /// distingue «chiuso bene» da «il processo è morto»).
    ///
    /// Non ha un corpo di default, ed è la scelta che la decisione 0028 ha preso
    /// invece di rimandarla: un indice che tiene un lock file e non ha un punto
    /// dove rilasciarlo lo rilascia quando il processo muore, cioè mai — e un
    /// default no-op avrebbe fatto sembrare quel caso normale. Costa una riga a
    /// chi non ha niente da chiudere (`Ok(())`) e la scrive sapendo di non
    /// averne.
    ///
    /// # Perché non basta il `Drop`
    ///
    /// Perché un `Drop` non ha l'`HostApi`: ciò che un indice rende durevole
    /// passa da `data_*`, e un provider che persistesse mentre viene distrutto
    /// dovrebbe usare `std::fs` — cioè uscire dal proprio recinto — o non
    /// persistere affatto. E a M5 non c'è nemmeno il `Drop`: un componente WASM
    /// che l'host smonta non esegue **niente** al proprio smontaggio, quindi
    /// senza questa funzione un indice di terzi non avrebbe alcun modo di
    /// chiudersi bene. Il `Drop` nativo resta, e resta la rete: qui c'è la
    /// chiusura *ordinata*, quella che può ancora parlare.
    ///
    /// Dopo `close` l'indice non riceve più niente — né alimentazione, né
    /// `flush`, né `query`. L'errore non è fatale per chi chiama: chi smette
    /// smette comunque, e ciò che è andato storto torna a chi ha un canale per
    /// dirlo.
    fn close(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;

    /// Risponde a una query **che è stata dichiarata**.
    ///
    /// Il kernel non manda qui domande che [`routes`](IndexProvider::routes) non
    /// rivendica: non c'è nessun «non è roba mia» da restituire, e il `BadArgs`
    /// che serviva a dirlo è tornato a significare quello che dice — gli
    /// argomenti non stanno in piedi.
    ///
    /// Ciò che arriva è **già risolto**: un'espressione contiene solo foglie che
    /// questo provider ha dichiarato di saper valutare, oppure una
    /// [`QueryPredicate::Docs`](crate::query::QueryPredicate::Docs) in cui il
    /// pianificatore ha messo il risultato di ciò che sapeva valutare qualcun
    /// altro. La **struttura** invece resta da leggere: OR, AND e negazione
    /// hanno un'implementazione sola, ed è
    /// [`QueryEvaluator`](crate::query::QueryEvaluator) — chi non vuole
    /// tradurla nel proprio motore implementa le due foglie e lascia fare a
    /// quella.
    ///
    /// # Due `query` possono essere in volo insieme
    ///
    /// Questo trait è `Send + Sync` e questo metodo prende `&self`: l'host
    /// prepara routing e handle sotto un prestito breve, poi serve le
    /// interrogazioni **fuori da ogni prestito del workspace**. N chiamate
    /// concorrenti sulla stessa istanza sono lecite per costruzione.
    ///
    /// Lecite, non necessariamente **parallele**. Un provider che metta un lock
    /// dentro il proprio `&self` è conforme, e si rimette in fila da solo senza
    /// che nessuno se ne accorga: il `RwLock` del workspace non attraversa il
    /// lock di un provider. Il contratto non chiede di dichiararlo, e non è una
    /// dimenticanza — è la [decisione
    /// 0026](../../../docs/decisions/0182-provider-e-porte-generiche.md): una
    /// dichiarazione non potrebbe cambiare ciò che è *lecito* (lo dice già
    /// `Send + Sync`), quindi sarebbe un fatto che nessun chiamante può
    /// verificare e su cui nessuno può agire, e sbagliarla non produrrebbe un
    /// errore ma solo un'attesa.
    ///
    /// Resta quindi un **requisito in prosa**, e vale per chi scrive un indice:
    /// serializzare è permesso e sconsigliato, e chi vuole sapere se il proprio
    /// indice scala lo **misura**. Il primo indice nativo lo fa
    /// (`fub_features::SearchIndex`, presidio
    /// `two_searches_are_in_the_index_together`), e lo fa perché per un anno
    /// non lo faceva senza che si vedesse.
    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;

    /// **Di queste voci, quali hai già così come sono?** Il kernel la chiama
    /// durante la scansione, prima di leggere e parsare (§14.2).
    ///
    /// È la domanda che mancava, e la sua assenza costava una riapertura intera:
    /// il kernel leggeva e parsava **tutto** il vault a ogni apertura *prima
    /// ancora di chiedere all'indice se gli interessava*, e l'indice —
    /// persistente, con tutto già dentro — si limitava a riscrivere ciò che
    /// aveva. La promessa scritta in [`reconcile`](IndexProvider::reconcile) («i
    /// documenti immutati non vanno reindicizzati») era vera per chi indicizza e
    /// falsa per chi alimenta.
    ///
    /// # Cosa arriva, e su cosa si risponde
    ///
    /// Le [`VaultEntry`] dei soli documenti, con dimensione, data e — quando il
    /// kernel ce l'ha — l'impronta del contenuto. Un indice risponde con gli id
    /// che ha già **durevolmente** e nella stessa versione: dopo un `git
    /// checkout` che ha ritimbrato mille file senza cambiarne uno, chi tiene
    /// l'impronta li riconosce tutti e mille.
    ///
    /// # Il default dice di no, ed è la risposta giusta
    ///
    /// Un elenco vuoto significa «mandami tutto», cioè il comportamento di
    /// prima. È deliberato che sia quello che si ottiene **non pensandoci**: un
    /// indice che rispondesse di sì per sbaglio resterebbe indietro in silenzio,
    /// e un indice che dice di no paga una reindicizzazione che non serviva.
    /// Sbagliare da questa parte costa tempo; dall'altra costa un indice che
    /// mente.
    ///
    /// Chi risponde deve dire la verità su **ciò che è durevole**, non su ciò
    /// che ha in memoria: chi ha appena buttato il proprio stato perché la
    /// versione dello schema non combaciava non ha niente, e dirlo è l'unica
    /// cosa che gli impedisce di restare vuoto per sempre.
    ///
    /// # La domanda arriva a fette, e una fetta non parla delle altre
    ///
    /// Il kernel chiede **per fetta**, come alimenta: su un vault grande questo
    /// metodo viene chiamato dieci volte con dieci elenchi diversi, e non è
    /// promesso in che ordine le domande si alternino alle consegne. Chi
    /// risponde soltanto *guardando* ciò che ha non se ne accorge. Chi invece si
    /// **prende nota** di qualcosa mentre risponde deve tenerne conto: quella
    /// nota è per documento, e una domanda su una fetta non dice niente sui
    /// documenti che quella fetta non nomina. Azzerarla a ogni chiamata è la
    /// scorciatoia che sembra pulizia e butta via ciò che un'altra fetta stava
    /// ancora aspettando.
    fn up_to_date(&self, _entries: &[VaultEntry]) -> Vec<DocId> {
        Vec::new()
    }
}
