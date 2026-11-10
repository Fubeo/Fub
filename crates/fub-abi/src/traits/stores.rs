//! Le capacità per famiglia, prima metà: vault, blob, impostazioni e stato di
//! vista, ognuna divisa in lettura e scrittura.

use super::*;

// ---------------------------------------------------------------------------
// Capability handle: l'unico modo con cui un provider tocca il mondo esterno.
// Nativo → oggetto in-process diretto. WASM (M5) → proxy che reinoltra le
// chiamate come host function attraverso il confine.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Le capacità, per famiglia
// ---------------------------------------------------------------------------
//
// Le capacità — ventidue quando la decisione 0013 ha chiuso l'elenco,
// **trentaquattro** oggi, tutte per aggiunta (il conto si rifà contando le
// `func` delle quattordici interfacce `host-*` in `wit/fub/abi.wit`, ed è
// l'unico modo per cui questo numero è vero: scritto e basta, invecchia — §16.7)
// — non stanno
// in un trait solo, e la ragione è il §7.1: un trait solo si implementa **per
// intero o per niente**, e chi ne può fare solo una metà (il percorso di
// render, che ha il workspace in prestito condiviso; un comando che si è
// dichiarato di sola lettura; a M5 un componente senza il permesso di
// scrivere) è costretto a scrivere l'altra metà come una fila di rifiuti.
// Erano novantasei corpi di metodo per quattro implementazioni, di cui ventidue
// non facevano niente se non dire di no.
//
// Le famiglie sono quattordici e sono scelte su un criterio solo: **cosa vuol dire
// negarne una.** È per questo che la lettura del vault sta separata dalla sua
// scrittura e dalle operazioni strutturali (i tre gradi che `read_vault` e
// `write_vault` distinguono, §7.3), che i blob del plugin si dividono nello
// stesso modo, e che ciò che l'host sa e il provider no — l'orologio, il
// pannello attivo — è una famiglia sua e non un residuo.
//
// Chi implementa tutto lo dichiara una volta: [`HostApi`] e [`ReadApi`] sono
// **somme**, con una impl generica, e nessuno le implementa a mano. Chi le
// riceve continua a scrivere `&mut dyn HostApi` come prima.
//
// Al confine WIT le quattordici famiglie sono quattordici `interface`, e lì la scomposizione
// smette di essere una comodità di tipi: un componente a cui il mondo non
// importa `host-vault-write` non ha **modo** di chiamarla — il rifiuto non è
// più una risposta a runtime, è l'assenza della funzione.

/// Leggere il vault: la sorgente, la struttura, l'elenco, il cestino.
///
/// È la famiglia sotto
/// [`permission::READ_VAULT`](crate::options::permission::READ_VAULT), ed è la
/// sola che ogni percorso ha — anche quello di render, anche una simulazione.
pub trait VaultRead: Send + Sync {
    /// Legge la sorgente di un documento dal vault.
    fn read_document(&self, id: &DocId) -> Result<String, PluginError>;

    /// I **byte** di un documento, senza decodificarli.
    ///
    /// Sta accanto a [`VaultRead::read_document`] e non al posto suo, per la
    /// stessa ragione per cui nel kernel `read` e `read_bytes` sono due
    /// funzioni: chi legge del testo non deve poter dimenticare di decodificare.
    ///
    /// Esiste perché senza di lei il confine dei plugin è **testo e basta**, e
    /// un estrattore di terzi — il PDF, l'OCR, la trascrizione di FEATURES §9.1,
    /// che è il modo in cui omnisearch fa entrare gli allegati nella ricerca —
    /// non ha modo di chiedere ciò che gli serve. Il kernel sapeva già leggere a
    /// byte per conto proprio (`SourceKind::Bytes`, dalla
    /// [decisione 0017](../../../docs/decisions/0182-provider-e-porte-generiche.md));
    /// quel sapere si fermava sul confine, e questa è la firma che lo fa passare
    /// (§21.8).
    ///
    /// È sotto lo stesso permesso di ogni altra lettura del vault
    /// ([`permission::READ_VAULT`](crate::options::permission::READ_VAULT)):
    /// leggere del testo e leggere dei byte non sono due gradi di fiducia — chi
    /// può leggere una nota può già leggerne i byte decodificandoli lui.
    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError>;

    /// La revisione dei byte sorgente di un documento, anche opaco o binario.
    ///
    /// È una capacità e non un calcolo perché la [`Revision`] è **opaca** (solo
    /// l'uguaglianza è contratto) e come l'host la derivi non è promesso a
    /// nessuno: un provider che se la ricavasse da sé dal sorgente si legherebbe
    /// a questa implementazione. Vedi [`crate::edit`].
    ///
    /// Sta fra le **letture**, e non è una svista: chi prepara una modifica
    /// (calcolare gli edit è la parte lunga) può farlo mentre disegna, e
    /// consegnarla poi da dove si scrive.
    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError>;

    /// I documenti del vault, in ordine di id, **a finestra**.
    ///
    /// Senza, `read_document` serve solo per gli id che arrivano dagli eventi:
    /// un plugin non potrebbe rispondere a [`Event::VaultOpened`] guardandosi
    /// intorno, né costruire alcunché sull'intero vault.
    ///
    /// La [`Page`] non è un ornamento e non è simmetria con [`IndexQuery`]: è il
    /// metodo con cui un provider si guarda intorno, e senza finestra clona
    /// **tutto** il vault a ogni chiamata — il versioning lo chiama a ogni
    /// riconciliazione, e ogni feature che riparte da [`Event::VaultOpened`] lo
    /// chiamerà. `None` resta "tutto", perché chi ha davvero bisogno
    /// dell'insieme intero non deve inventarsi un tetto (è la stessa regola di
    /// [`Page`] nelle query); ma adesso chi ne vuole venti chiede venti, e il
    /// `total` gli dice quanti sono in tutto.
    ///
    /// [`Event::VaultOpened`]: crate::Event::VaultOpened
    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError>;

    /// Il primo nome libero della famiglia `<nome>`, `<nome> 1`, `<nome> 2`, …
    /// a partire da un id qualsiasi. Se l'id è già libero, è lui.
    ///
    /// È una capacità e non un calcolo perché il vault è l'unico a sapere cosa
    /// è occupato — l'indicizzato **e** ciò che sta sul disco e nessuno ha
    /// ancora visto — e perché la convenzione dei nomi (D3) deve restare una
    /// sola: la usano `create_note`, il ripristino dal cestino e ogni
    /// [`ImportProvider`](crate::transfer::ImportProvider) che risolva un
    /// conflitto con
    /// [`ConflictPolicy::Rename`](crate::transfer::ConflictPolicy::Rename).
    /// Con ~50 importer in FEATURES 17.1, l'alternativa è cinquanta
    /// convenzioni.
    ///
    /// Non prenota niente: fra la domanda e la scrittura il nome può diventare
    /// occupato, e a quel punto è la scrittura a dirlo.
    fn free_name(&self, id: &DocId) -> DocId;

    // --- il modello parsato, e di che formato è ------------------------------
    //
    // Le due capacità del §4.2 e del §4.3, che sono la stessa domanda a due
    // distanze: *cosa c'è dentro questo documento* e *cosa saprei farci*. Stanno
    // qui accanto a `read_document` perché sono la stessa specie di cosa — una
    // lettura del vault — e non dentro [`IndexQuery`], che è il canale di ciò
    // che è **derivato** e aggregato. Vedi il § in testa a `IndexQuery` per la
    // linea di confine, e il verbale della decisione 0018 per perché passa di lì.
    //
    // I due nomi dicono i due **costi**, ed è deliberato: `read_` è una lettura
    // (disco, parse), `_of` è una domanda sul nome a cui risponde una mappa. Una
    // coppia simmetrica — `document_model`/`document_format` — sarebbe stata più
    // ordinata e avrebbe nascosto che una delle due si può fare tremila volte e
    // l'altra no.

    /// La struttura di un documento: il modello parsato, con gli `Span`. Il
    /// gemello di [`read_document`](VaultRead::read_document), che ne dà la
    /// sorgente.
    ///
    /// È il verso che mancava. Uno c'era, ed è
    /// [`IndexProvider::on_documents_indexed`]: **spinto**, a chi indicizza,
    /// quando lo decide il kernel. Chi sta dentro un indice era quindi già
    /// servito — un indice dei task, le flashcard da blocchi, le citazioni, il
    /// chunking per l'embedding ricevono ogni modello mentre passa. Tagliato
    /// fuori era il percorso **one-shot**: chi ha bisogno del modello di
    /// *questo* documento *adesso* e non era in ascolto quando è passato — un
    /// comando che spunta il task sotto il cursore, un
    /// [`ExportProvider`](crate::transfer::ExportProvider) su un documento solo,
    /// un linter su richiesta, un TOC generato al volo. Le sue due strade erano
    /// entrambe storte: riparsare con un parser proprio, o registrare un
    /// `IndexProvider`-specchio al solo scopo di veder passare i modelli — cioè
    /// tenere una copia dell'intero vault per rispondere a una domanda su una
    /// nota.
    ///
    /// # Cosa costa, detto nella firma
    ///
    /// **Rilegge e riparsa dal disco a ogni chiamata.** Non è un dettaglio
    /// d'implementazione ma il contratto, perché un canale che serve una cache e
    /// uno che riparsa sono due firme diverse e la differenza si vede quando il
    /// chiamante cammina l'intero vault. La cache del kernel tiene i soli
    /// **metadati** (identità, frontmatter, outline, link): il corpo non c'è, e
    /// promettere un modello servito dalla cache sarebbe promettere una cache
    /// che non esiste. Chi vuole i soli metadati non passa di qui e non paga il
    /// disco — [`IndexQuery::Outline`], [`IndexQuery::Properties`] e
    /// [`IndexQuery::Tags`] rispondono dalla cache calda.
    ///
    /// Il modello è quello del **file**, con le regole di sintassi registrate
    /// già applicate. Un buffer aperto e non salvato non lo conosce nessuno al
    /// di qua del confine: chi disegna un editor tiene il proprio testo, e la
    /// verità del vault è ciò che sta sul disco.
    ///
    /// Documento che il vault non conosce → [`PluginError::Internal`] con il
    /// nome dentro; è la stessa risposta di
    /// [`read_document`](VaultRead::read_document), e per la stessa ragione —
    /// non è una domanda malformata, è una domanda su qualcosa che non c'è.
    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError>;

    /// Di che formato è un documento, e che sintassi capirebbe: il
    /// [`DocumentFormat`](crate::format::DocumentFormat) di un [`DocId`].
    ///
    /// `None` = **nessun provider lo rivendica**, ed è una risposta utile
    /// quanto le altre: è il modo con cui chi cammina una lista sa che quel
    /// nome non è roba sua e va ignorato, invece di provare a leggerlo e
    /// dedurlo dall'errore.
    ///
    /// Non restituisce un `Result` e non tocca il disco: è una domanda sul
    /// **nome**, risolta dal registro dei formati sull'estensione. Vale quindi
    /// anche per un documento che non esiste ancora — chi sta per creare
    /// `Diario/2026-07-26.md` può chiedere prima chi lo tratterà — e si può
    /// fare su tutta una lista senza pagare un'apertura a testa.
    fn format_of(&self, id: &DocId) -> Option<DocumentFormat>;

    /// Il testo con cui il formato di `doc` scrive `link`, con le sintassi che
    /// il vault vi accende: la domanda che una feature fa invece di comporre
    /// `[[…]]` da sé.
    ///
    /// `Ok(None)` = il formato non sa scrivere quel riferimento, oppure nessun
    /// provider rivendica `doc`. Come [`format_of`](VaultRead::format_of) è una
    /// domanda sul **nome**: non legge il documento, che può non esistere
    /// ancora.
    fn format_link(&self, doc: &DocId, link: &LinkInsert) -> Result<Option<String>, PluginError>;

    /// Gli edit che portano su `to` i riferimenti che oggi raggiungono `from`:
    /// è la riscrittura dei backlink di una rinomina, per quando il contenuto
    /// di `from` confluisce in un documento che **esiste già** (l'unione di
    /// note). Il piano è quello del kernel — quali link puntano davvero a
    /// `from`, con quale nome o path chiamare `to` —, il testo lo scrive il
    /// formato di ciascun documento, con la sua grammatica, alias e frammenti
    /// compresi.
    ///
    /// Non scrive niente: ogni edit porta la revisione su cui è stato
    /// calcolato, e chi lo applica con [`apply_edit`](VaultWrite::apply_edit)
    /// trova un conflitto se il documento è cambiato nel frattempo. Gli edit
    /// dentro `from` (i link a sé stessa) sono calcolati come se il suo testo
    /// stesse già in `to`. Un host che non sa fare il piano risponde
    /// [`PluginError::Unserved`], e chi chiede resta sulla via di prima.
    fn link_retarget_edits(
        &self,
        from: &DocId,
        to: &DocId,
    ) -> Result<Vec<PlannedEdit>, PluginError> {
        Err(PluginError::Unserved(
            format!("questo host non sa riportare su `{to}` i link verso `{from}`").into(),
        ))
    }

    /// La modifica che porta a fatto (`done`) o da fare il task di `marker`,
    /// scritta dal formato di `doc` sul sorgente attuale.
    ///
    /// Il marcatore viene da [`read_model`](VaultRead::read_model); il
    /// simbolo lo sceglie il provider. `Ok(None)` = il formato non offre
    /// l'operazione. La richiesta porta la revisione del sorgente su cui il
    /// provider ha lavorato: se il file cambia prima di
    /// [`apply_edit`](VaultWrite::apply_edit), l'applicazione è un conflitto e
    /// non un simbolo scritto nel posto sbagliato.
    fn task_state_edit(
        &self,
        doc: &DocId,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Option<EditRequest>, PluginError>;

    /// Il contenuto del cestino, dal più recente al più vecchio.
    ///
    /// Sta qui accanto a [`list_documents`](VaultRead::list_documents) e non
    /// dentro [`IndexQuery`] perché il cestino **non è indicizzato**: una nota
    /// cestinata non ha modello, né tag, né archi nel grafo — è esattamente
    /// ciò che l'indice non contiene. Interrogarlo dal canale dati sarebbe
    /// promettere che il canale dati sappia rispondere su ciò che non ha
    /// letto.
    ///
    /// È una **lettura** e sta fra le letture: un pannello "cestino" è una
    /// view, e una view disegna dal percorso di render.
    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError>;
}

/// Scrivere il **testo** di un documento che già esiste — o che si sta creando
/// riscrivendolo per intero.
///
/// Due capacità sole, e sono la famiglia più piccola perché è quella su cui si
/// dice di no più spesso: è ciò che una simulazione non fa, ciò che un comando
/// dichiarato innocuo non può fare, ciò che un plugin senza
/// [`permission::WRITE_VAULT`](crate::options::permission::WRITE_VAULT) non
/// ottiene.
pub trait VaultWrite: VaultRead {
    /// Scrive la sorgente di un documento nel vault.
    ///
    /// È la scrittura di chi il documento intero ce l'ha in mano: l'editor che
    /// salva il proprio buffer, un importer che crea una nota. Chi vuole
    /// cambiarne **un pezzo** usa [`apply_edit`](VaultWrite::apply_edit) — non
    /// per eleganza, ma perché una riscrittura totale non dice *cosa* è
    /// cambiato.
    ///
    /// # La base, e perché è un tipo a due casi e non un `Option`
    ///
    /// [`WriteBase::DescendsFrom`] porta la revisione che chi scrive si aspetta
    /// di trovare sul disco. Se non combacia, l'host risponde
    /// [`PluginError::Conflict`] e **non scrive niente**: qualcuno ha riscritto
    /// il file da quando questo testo è stato preso, e sovrascriverlo
    /// distruggerebbe il suo lavoro senza che nessuna delle due metà del sistema
    /// se ne accorga. È la stessa guardia di
    /// [`apply_edit`](VaultWrite::apply_edit) (decisione 0008), applicata alla
    /// seconda primitiva di scrittura invece di restare privilegio della prima.
    ///
    /// [`WriteBase::Dictated`] è l'altra metà, e non è l'assenza della prima:
    /// una riscrittura totale può essere compiuta da sé — un importer che crea
    /// una nota, un template che scrive la nota di oggi, il ripristino di una
    /// versione non stanno correggendo un testo che hanno letto, lo stanno
    /// **dettando**. Obbligarli a esibire una base vorrebbe dire farsela
    /// inventare, e una base inventata è una guardia che dice sempre di sì.
    ///
    /// La differenza con [`apply_edit`](VaultWrite::apply_edit), che una base la
    /// pretende e basta, resta e ha la stessa ragione di prima: un edit **non
    /// esiste** senza la revisione su cui è stato calcolato — i suoi offset
    /// indicano un testo, e senza dire quale non sono una modifica ma
    /// un'ipotesi. Qui invece i due casi sono due mestieri, e il tipo li fa
    /// nominare entrambi: fino alla decisione 0092 questo parametro era un
    /// `Option`, e scrivere ciechi era ciò che succedeva **omettendo** —
    /// cioè il default, che è il modo in cui una guardia protegge chi si
    /// ricorda di attivarla e nessun altro.
    ///
    /// # Cosa torna
    ///
    /// La revisione **prodotta**, cioè quella che il file ha adesso. Serve a chi
    /// scrive due volte di fila senza rileggere: è la `base` della scrittura
    /// dopo. Senza, l'unico modo di averla sarebbe ricalcolarla per conto
    /// proprio — cioè una seconda implementazione di come questo host deriva le
    /// impronte, che è la cosa che [`Revision`](crate::edit::Revision) è opaca
    /// per impedire.
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError>;

    /// Deposita byte grezzi senza conversioni di codifica o terminatori.
    ///
    /// `None` crea soltanto se il documento non esiste; `Some` richiede
    /// l'impronta dei byte attuali e risponde `Conflict` senza modifiche se
    /// non coincide. Il controllo e la scrittura sono atomici. Non esiste
    /// una sovrascrittura cieca implicita.
    ///
    /// La revisione restituita identifica i byte depositati. La precondizione
    /// si ottiene da `document_revision` o da una scrittura precedente, non
    /// ricodificando una rappresentazione che potrebbe aver cambiato i byte.
    /// Permessi e simulazione seguono la stessa regola di `write_document`.
    fn write_document_bytes(
        &mut self,
        id: &DocId,
        bytes: &[u8],
        expected: Option<Revision>,
    ) -> Result<Revision, PluginError>;

    /// Cambia **un pezzo** di documento: gli edit della richiesta, tutti o
    /// nessuno, sul sorgente che la sua `base` nomina.
    ///
    /// È la primitiva su cui poggia ogni modifica programmatica che non sia la
    /// riscrittura di un file intero — spuntare un task, scrivere una proprietà,
    /// correggere un link, inserire un template — e senza la quale ognuna di
    /// esse rileggerebbe e riscriverebbe tutto, perdendo per strada cosa è
    /// cambiato e chi altro stava scrivendo.
    ///
    /// [`PluginError::Conflict`] = il documento è cambiato da quando gli edit
    /// sono stati calcolati, e non è stato scritto niente: chi chiama rilegge,
    /// ricalcola e riprova. [`PluginError::BadArgs`] = gli edit non stanno in
    /// piedi (fuori dal sorgente, a metà di un carattere, sovrapposti).
    ///
    /// Il rapporto torna nelle coordinate del testo **nuovo** e porta ciò che
    /// era stato sostituito: è quanto serve a mettere il cursore dove l'utente
    /// se lo aspetta, e a costruire l'edit inverso
    /// ([`EditReport::inverse`](crate::edit::EditReport::inverse)).
    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError>;
}

/// Le operazioni **strutturali** sul vault: creare, rinominare, cestinare,
/// ripristinare, distruggere.
///
/// Creare, rinominare, cestinare sono le tre cose che si fanno a un documento
/// *senza aprirlo*. Fino alla decisione 0013 erano kernel-owned e fuori dal
/// contratto, e la conseguenza era che template, daily note, import,
/// auto-archiviazione e cleanup wizard (FEATURES 16, 17, 8.3, 7.2) non potevano
/// essere un plugin: il vault sapeva farle, il confine no.
///
/// Stanno sotto
/// [`permission::WRITE_VAULT`](crate::options::permission::WRITE_VAULT) come
/// [`VaultWrite`], e sono una famiglia a parte perché il no è di **specie
/// diversa**: chi scrive testo cambia una nota che l'utente ha già, chi cestina
/// gliela toglie. Un host può voler concedere il primo e negare il secondo, e
/// finché erano lo stesso trait quella distinzione non era esprimibile.
pub trait VaultStructure: VaultRead {
    /// Crea un documento **nuovo** con il sorgente dato, e fallisce se quel
    /// path è già occupato.
    ///
    /// È questo rifiuto a distinguerla da [`write_document`](VaultWrite::write_document),
    /// che crea ciò che non c'è e sovrascrive ciò che c'è: un plugin di
    /// template che scrivesse la nota di oggi con `write_document` e sbagliasse
    /// la data **cancellerebbe** una nota dell'utente, senza che niente nel
    /// codice sembri una cancellazione. Chi vuole un nome comunque libero lo
    /// chiede a [`free_name`](VaultRead::free_name) e passa quello: due capacità
    /// che si compongono dicono cosa succede, una che rinomina in silenzio no.
    ///
    /// L'id è quello del chiamante e non un nome da cui l'host deriva un path:
    /// un importer o un template sanno *dove* va la nota (`Diario/2026-07-26.md`),
    /// e un host che scegliesse la cartella al posto loro renderebbe
    /// inesprimibile metà del capitolo 16.
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError>;

    /// Rinomina/sposta un documento **preservando l'identità**, e riscrive i
    /// wikilink entranti che puntavano al vecchio nome.
    ///
    /// È il rename del kernel, non un rename "nudo": non ce ne sono due. Un
    /// rename che lasciasse i backlink rotti non è una versione più semplice
    /// della stessa operazione — è un'operazione che mette il vault in uno
    /// stato che l'utente non ha chiesto, e che nessuna delle due firme
    /// direbbe. Chi davvero vuole spostare un file senza toccare nessun altro
    /// documento oggi non ha un chiamante; il giorno che l'avrà, sarà un
    /// parametro in più su una capacità nuova, non un secondo significato di
    /// questo nome.
    ///
    /// Ne segue che una rinomina è un **lotto** (decisione 0011): N sorgenti riscritti,
    /// un solo [`Event::BatchEnded`](crate::Event::BatchEnded). Chiamata da
    /// dentro un lotto già aperto — un comando, per esempio — vi si unisce
    /// invece di aprirne un altro.
    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError>;

    /// Sposta un documento nel cestino e restituisce dov'è finito.
    ///
    /// Si chiama `trash_` e non `delete_` perché è ciò che fa: il documento
    /// esce dal vault (e dagli indici, e da
    /// [`list_documents`](VaultRead::list_documents)) ma non è distrutto, e l'id
    /// restituito è quello con cui si ripristina. L'unica capacità che
    /// distrugge è [`empty_trash`](VaultStructure::empty_trash), e si chiama così.
    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError>;

    /// Come [`trash_document`](VaultStructure::trash_document), ma soltanto se
    /// il documento ha ancora la revisione `expected`: chi ha deciso di
    /// cestinare guardando una revisione non deve cestinarne una più nuova.
    /// Se è cambiata, il risultato è [`PluginError::Conflict`] e il documento
    /// resta dov'è.
    ///
    /// Un host che serializza le scritture fa il confronto e il cestinamento
    /// sotto lo stesso turno; questo default li compone soltanto, quindi
    /// regge fra chi non scrive in parallelo.
    fn trash_document_if(&mut self, id: &DocId, expected: &Revision) -> Result<DocId, PluginError> {
        if self.document_revision(id)? != *expected {
            return Err(PluginError::Conflict(
                format!("`{id}` changed since its revision was read").into(),
            ));
        }
        self.trash_document(id)
    }

    /// Riporta nel vault una voce del cestino (`entry` è il suo
    /// [`TrashEntry::id`]) e restituisce il [`DocId`] con cui è tornata: il suo
    /// path d'origine, oppure `to` se il chiamante ne sceglie un altro.
    ///
    /// Il ripristino è una scrittura normale — parse, grafo, indici, eventi —
    /// e quindi è a sua volta annullabile. Se il path d'origine è di nuovo
    /// occupato e `to` non è stato dato, è un errore e non un nome scelto
    /// d'ufficio: chi chiama ha [`free_name`](VaultRead::free_name) e decide.
    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError>;

    /// Crea una cartella vuota (e quelle che le mancano sopra), e fallisce se
    /// quel path è già occupato.
    ///
    /// Serve a chi sposta una cartella intera: le voci si spostano una per una
    /// e portano con sé le cartelle che attraversano, ma una sottocartella
    /// **vuota** non ha una voce che la porti. Un host che non la sa creare
    /// risponde [`PluginError::Unserved`], e chi chiede dice cosa resta dietro.
    fn create_folder(&mut self, folder: &str) -> Result<(), PluginError> {
        Err(PluginError::Unserved(
            format!("questo host non sa creare la cartella `{folder}`").into(),
        ))
    }

    /// Toglie una cartella **vuota sul disco**. Una cartella che contiene
    /// ancora qualcosa — anche un file che il vault non mostra — resta dov'è,
    /// e l'errore lo dice: non c'è una variante che cancelli il contenuto.
    fn remove_empty_folder(&mut self, folder: &str) -> Result<(), PluginError> {
        Err(PluginError::Unserved(
            format!("questo host non sa togliere la cartella `{folder}`").into(),
        ))
    }

    /// Dice al vault che una cartella sta per cambiare path, perché ciò che tiene
    /// **per path di cartella** — l'icona, lo spazio, l'ordine scelto a mano dei
    /// figli — la segua. Le voci si spostano poi una per una, e ognuna porta con
    /// sé il proprio; la cartella non ha una voce che lo faccia per lei.
    /// Un host che non tiene niente del genere risponde
    /// [`PluginError::Unserved`], e lo spostamento va avanti lo stesso.
    fn migrate_folder_organization(&mut self, from: &str, to: &str) -> Result<(), PluginError> {
        Err(PluginError::Unserved(
            format!("questo host non sa portare `{from}` in `{to}`").into(),
        ))
    }

    /// Svuota il cestino e dice quante voci ha distrutto.
    ///
    /// È l'unica capacità del contratto da cui non si torna indietro, e per
    /// questo è una capacità a sé e non un `trash_document(force: true)`: un
    /// booleano che cambia "sposta" in "distruggi" è il tipo di parametro che
    /// si passa sbagliato una volta sola.
    ///
    /// Il conteggio è un `u64` e non un `usize`: al confine il guest può essere
    /// a 32 bit, e un tipo che cambia larghezza a seconda di chi lo compila non
    /// è un tipo del contratto.
    fn empty_trash(&mut self) -> Result<u64, PluginError>;
}

// --- storage persistente per-plugin -----------------------------------------
//
// Blob nominati con path relativi dentro uno spazio che l'host assegna e
// impone (`.fub/plugins/<id>/` per dati autorevoli, `.fub/data/plugins/<id>/`
// per cache): il plugin non conosce la radice del vault, non compone path
// assoluti e non può uscire dal proprio recinto.
// È l'alternativa a un'API filesystem scoped, ed è stata scelta perché il
// recinto qui è una proprietà della firma, non una convenzione da
// rispettare — vedi ../../../docs/architecture/plugin-runtime.md.
//
// Sono **due** famiglie e non una, per la stessa ragione per cui lo sono la
// lettura e la scrittura del vault: il percorso di render può rileggere ciò che
// il provider si è salvato (un pannello che ricorda la sezione aperta) e non
// deve poter scrivere mentre disegna.

/// Rileggere i propri blob persistenti.
pub trait DataRead: Send + Sync {
    /// Legge un blob autorevole. Assente → `Ok(None)` (mancare non è un errore).
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError>;
    /// I blob autorevoli sotto un prefisso, path relativi allo spazio del plugin e
    /// ordinati. Prefisso inesistente → lista vuota.
    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError>;
    /// Legge un blob derivato dalla cache. Assente → `Ok(None)`.
    fn cache_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError>;
}

/// Scrivere e cancellare i propri blob persistenti.
pub trait DataWrite: DataRead {
    /// Scrive un blob autorevole, creando le directory intermedie.
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError>;
    /// Cancella un blob autorevole. Idempotente: cancellare ciò che non c'è riesce.
    fn data_remove(&mut self, path: &str) -> Result<(), PluginError>;
    /// Scrive un blob derivato nella cache, creando le directory intermedie.
    fn cache_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError>;
}

// --- le impostazioni (§11.1) -----------------------------------------------
//
// Sono **due** famiglie e non una, come per il vault e per i blob: leggere la
// propria configurazione è ciò che un `activate` fa per sapere se è acceso, e
// deve poterlo fare anche dal percorso di sola lettura; scriverla è un atto che
// una simulazione non compie e che un plugin senza permesso non ha.
//
// Non c'è un `settings_list`: l'elenco con schema, valore e provenienza è una
// **risposta con dei dati**, quindi passa dal canale dati
// ([`IndexQuery::Settings`]) come i documenti, i tag e i backlink. La riga che
// divide le due cose è quella della decisione 0013, applicata di nuovo.

/// Leggere le impostazioni **dichiarate**.
///
/// Qualunque chiave dichiarata, non solo le proprie: la configurazione non è un
/// recinto e non contiene segreti (vedi [`crate::settings`]), e un plugin di
/// tema che non potesse leggere `editor.font-size` perché non è sua sarebbe un
/// plugin di tema inutile. Ciò che è recintato è la **scrittura**.
pub trait SettingsRead: Send + Sync {
    /// Il valore che vale adesso per questa chiave: quello del vault, quello
    /// della macchina, o il default dello schema — in quest'ordine.
    ///
    /// Una chiave che **nessuno ha dichiarato** è
    /// [`PluginError::BadArgs`](crate::PluginError::BadArgs) e non `None`: lo
    /// schema è il contratto fra chi legge e chi configura, e una chiave fuori
    /// schema è un errore di chi la chiede — quasi sempre un refuso — non uno
    /// stato del vault. Un valore c'è **sempre**, perché il default fa parte
    /// della dichiarazione.
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError>;
}

/// Scrivere un'impostazione **che si è dichiarata scrivibile da un programma**.
///
/// È la metà che la [decisione 0010](../../../docs/decisions/README.md)
/// aveva lasciato aperta. Due condizioni, e nessuna delle due basta da sola: il
/// permesso `fub:write-settings` nel manifest (chi scrive), e
/// [`SettingSpec::program_writable`](crate::settings::SettingSpec::program_writable)
/// sulla chiave (cosa si scrive). La seconda esiste perché il divieto che conta
/// — privacy e AI non si spostano da sole — non riguarda *chi* chiede: un
/// componente che potesse allargarsi i permessi da sé non ha permessi, e questo
/// vale anche quando quel componente è un comando del core.
pub trait SettingsWrite: SettingsRead {
    /// Scrive la chiave nel livello che il suo
    /// [`scope`](crate::settings::SettingSpec::scope) dichiara: il vault, o la
    /// macchina. Non è un parametro perché non è una scelta di chi scrive —
    /// sarebbe il modo di far viaggiare un'impostazione che non deve viaggiare.
    ///
    /// Il valore è convalidato contro la specie dichiarata (intervallo di un
    /// numero, elenco di una scelta): un valore fuori schema è
    /// [`PluginError::BadArgs`](crate::PluginError::BadArgs), non un
    /// arrotondamento.
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError>;

    /// Dimentica ciò che era stato deciso: la chiave **ricade** al livello
    /// sotto, che è il default solo se non c'era niente in mezzo.
    ///
    /// È una capacità sua e non `set_setting(default)` perché sono due cose
    /// diverse: scrivere il default *decide* che vale il default (e resta scritto
    /// quando il default cambia), azzerare *smette di decidere*. È la differenza
    /// che un «ripristina» deve fare, ed è il §11.1 per intero — l'import,
    /// l'export e il reset sono comandi che stanno in piedi su questa riga.
    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError>;
}

// --- lo stato di vista (§11.2) ----------------------------------------------
//
// Dove un provider tiene lo scroll, le sezioni collassate, il filtro corrente,
// la scheda attiva. È il caso proprio che la decisione 0013 aveva lasciato senza
// contenitore togliendo lo `storage_*` volatile — e non è quello che rientra
// dalla finestra, perché le tre proprietà che gli mancavano ci sono tutte:
//
// - **non viaggia col vault.** Vive nella cartella di configurazione della
//   macchina, accanto alle impostazioni di macchina (decisione 0036). Lo scroll
//   di ieri sul portatile non è un fatto sul vault, e sincronizzarlo vorrebbe
//   dire far litigare due finestre su dove si era rimasti;
// - **è per esemplare**, non per view: la chiave la compone l'host con
//   [`ViewInstance::instance`], che è già «quale delle tre istanze di questa
//   view sono io» (decisione 0007). Lo stesso pannello aperto due volte ha due
//   scroll, ed è la ragione per cui il §11.2 diceva *per-pannello*;
// - **è recintato**, come i blob: la chiave è la propria, e l'id di chi scrive
//   non è un parametro.
//
// Sono **due** famiglie e non una, per la ragione già scritta sui blob: si
// rilegge mentre si disegna, e non si deve poter scrivere mentre si disegna.

/// Rileggere lo stato di vista del proprio esemplare.
pub trait ViewStateRead: Send + Sync {
    /// Lo stato salvato sotto questa chiave, o `None` se non ce n'è.
    ///
    /// Assente non è un errore ed è il caso **normale**: la prima volta che una
    /// view si disegna nessuno le ha ancora salvato niente, e un provider che
    /// dovesse distinguere «mai scritto» da «errore» per disegnare la propria
    /// prima riga avrebbe un ramo che nessuno prova.
    ///
    /// **Fuori da un esemplare di view è `None`**, sempre: chi non sta
    /// disegnando né reagendo per conto di un'istanza non ha uno stato di vista
    /// da rileggere, e inventargliene uno vorrebbe dire dargli quello di
    /// qualcun altro.
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError>;
}

/// Ricordare lo stato di vista del proprio esemplare.
pub trait ViewStateWrite: ViewStateRead {
    /// Salva (`Some`) o dimentica (`None`) lo stato sotto questa chiave.
    ///
    /// `None` e non una capacità a sé perché qui — a differenza delle
    /// impostazioni — non ci sono livelli sotto a cui ricadere: una chiave c'è o
    /// non c'è, e `null` è un valore JSON come un altro che sarebbe stato
    /// ambiguo scrivere per dire «scordatelo».
    ///
    /// **Fuori da un esemplare di view è un errore** e non un silenzio: leggere
    /// a vuoto è il caso normale di chi non ha ancora salvato niente, scrivere
    /// nel vuoto è invece qualcuno che crede di ricordare e non ricorderà —
    /// cioè un difetto che si vede solo alla riapertura, quando è tardi.
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError>;
}
