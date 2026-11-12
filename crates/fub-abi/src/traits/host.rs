//! Le capacità per famiglia, seconda metà: ambiente, eventi, query, servizi,
//! rete, trasferimenti e comandi; poi le due somme `ReadApi` e `HostApi`.

use super::*;

/// Il tetto di [`HostEnv::random_bytes`], in byte.
///
/// Sedici byte sono un UUID, trentadue una chiave: mille sono già due ordini di
/// grandezza sopra ogni identità che si possa voler generare. Il tetto c'è
/// perché una capacità senza tetto è un modo di far allocare all'host quanto
/// pare a chi chiama — la stessa disciplina del freno degli eventi
/// ([decisione 0034](../../../docs/decisions/0184-eventi-accodati-e-job.md)),
/// dove il tetto sta con chi ritira.
///
/// **Non è un termine del contratto.** Il numero non attraversa il confine, e
/// chi lo supera non lo scopre chiedendolo ma sentendoselo dire: sopra il tetto
/// `random_bytes` rende [`BadArgs`](PluginError::BadArgs) invece di mille byte
/// zitti ([decisione 0094](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md)).
/// Così resta alzabile senza rompere nessuno — una promessa pubblica di mille
/// byte, dopo il congelamento di M4, sarebbe stata mille byte per sempre.
pub const MAX_RANDOM_BYTES: u32 = 1024;

/// Ciò che **l'host sa e il provider no**: che ore sono, in che fuso e in che
/// lingua, quanto caso serve, e cosa sta guardando l'utente.
///
/// Le quattro capacità sembrano lontane e sono la stessa specie di cosa — un
/// fatto dell'host che chi gira dentro il confine non può calcolarsi — e si
/// negano insieme: un componente sotto sandbox può non avere orologio (WASI lo
/// può negare), non avere entropia (WASI la può negare allo stesso modo), e non
/// avere titolo a sapere quale nota è aperta. Averle in una famiglia sola è ciò
/// che permette di dirlo in un posto solo.
///
/// Il §12.3 ne ha aggiunte due, con l'argomento dell'orologio applicato dove non
/// lo era: un componente che chiamasse `SystemTime::now` sarebbe non testabile e
/// non funzionante sotto sandbox, e **lo stesso vale per il caso** — che serve a
/// ogni identità che Fub genera (2.2, 8.3, 5.2, 13.3) — e per il **locale**,
/// senza il quale l'orologio sa dire *quando* e non sa dirlo a nessuno.
pub trait HostEnv: Send + Sync {
    /// Millisecondi dall'epoca UNIX, secondo l'host.
    ///
    /// Il tempo è una capacità come le altre: un componente WASM può non avere
    /// orologio (WASI lo può negare), e un host che lo fornisce può renderlo
    /// deterministico nei test. Un plugin che chiamasse `SystemTime::now` per
    /// conto proprio sarebbe non testabile e, sotto sandbox, non funzionante.
    fn now_unix_millis(&self) -> u64;

    /// In che lingua legge chi guarda, in che fuso vive, con che calendario
    /// (§12.3).
    ///
    /// È il gemello dell'orologio: `now_unix_millis` dà millisecondi UTC, cioè
    /// *quando* è successo, e senza questo record non c'è modo di dirlo a
    /// qualcuno — né di ordinare due titoli come li ordinerebbe lui, né di
    /// sapere che il suo lunedì è il primo giorno della settimana.
    ///
    /// **Non ha un gemello che scrive**, e per la stessa ragione di
    /// [`active_context`](HostEnv::active_context): in che lingua legge l'utente
    /// è una decisione dell'utente sull'app, non una capacità da concedere a un
    /// plugin. Chi lo pubblica è la shell, e chi lo decide è la persona davanti
    /// allo schermo attraverso le chiavi `locale.*` (§11.1).
    ///
    /// Un host che non ha sentito nessuno rende [`Locale::default`]: lingua
    /// indeterminata, UTC, ISO 8601. È deterministico di proposito — è la stessa
    /// ragione per cui l'orologio è una capacità.
    ///
    /// Si chiama `user_locale` e non `locale` perché il nome dice **di chi**:
    /// non è il locale del processo né quello del vault, è quello della persona
    /// davanti allo schermo, ed è l'unico che conti quando si decide come
    /// mostrarle una data.
    fn user_locale(&self) -> Locale;

    /// `n` byte di **caso**, per generare un'identità.
    ///
    /// Sotto WASI il caso non c'è di default: è letteralmente lo stesso buco
    /// dell'orologio, un metodo più in là. Ogni identità che Fub genera lo
    /// chiede — UUID per nota (2.2), Zettelkasten id (8.3), id di blocco (5.2, e
    /// la [decisione 0003](../../../docs/decisions/0181-modello-documento-e-arene.md)),
    /// id di annotazione (13.3) — e senza, ognuna di quelle feature si
    /// arrangerebbe con l'orologio, che a due chiamate nello stesso millisecondo
    /// dà lo stesso valore.
    ///
    /// # Byte, e non un UUID
    ///
    /// Perché le identità che servono sono **quattro forme diverse** e un metodo
    /// che ne rendesse una lascerebbe le altre tre a reimplementarsi: la
    /// capacità è l'entropia, che solo l'host ha, mentre la forma (UUID v4, v7,
    /// un id corto per un blocco) è codice di libreria e sta nell'SDK
    /// ([`fub_sdk::ids`](https://docs.rs/fub-sdk)).
    ///
    /// # Per l'identità, non per i segreti
    ///
    /// Ciò che questa capacità promette è che due chiamate non diano lo stesso
    /// valore, non che il prossimo valore sia **imprevedibile**. Chi generasse
    /// da qui un token di sessione o una chiave farebbe l'errore che questa riga
    /// esiste per non far fare: quando servirà un generatore crittografico sarà
    /// una capacità sua, con una firma sua — come il portachiavi di sistema per
    /// i segreti ([`crate::settings`]).
    ///
    /// # Chi riesce riceve esattamente `n` byte
    ///
    /// È la sola lettura possibile di questa firma, ed è ciò per cui rende un
    /// esito: `Ok` sono `n` byte, mai meno. I due modi di non riuscire sono
    /// **nominati** perché chi chiama ci risponde in due modi diversi.
    ///
    /// - [`BadArgs`](crate::PluginError::BadArgs) — sopra
    ///   [`MAX_RANDOM_BYTES`]. È una colpa di chi chiama e si corregge
    ///   chiedendo meno: un plugin che ne chiedesse un gigabyte non ha un caso
    ///   d'uso, ha un difetto, e riceverlo troncato lo lascerebbe convinto di
    ///   avere l'entropia che ha chiesto.
    /// - [`PermissionDenied`](crate::PluginError::PermissionDenied) — la
    ///   capacità [`Capability::Env`](crate::Capability::Env) non è concessa.
    ///   Non si corregge affatto: chiedere meno non serve, e la risposta giusta
    ///   è dirlo a chi guarda.
    ///
    /// Il **tetto non attraversa il confine** ed è di proposito: un numero
    /// pubblicato è una promessa che si congela, mentre ciò che il contratto
    /// deve garantire è che superarlo si **dica** — la stessa forma di
    /// [`Event::Overflow`](crate::Event), dove ciò che si pubblica è la perdita
    /// e non la soglia.
    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError>;

    /// Il contesto del pannello con il focus: quale documento, cosa c'è
    /// selezionato, in che modalità. `None` = la shell non ne ha ancora
    /// pubblicato uno (nessun pannello).
    ///
    /// # Due permessi, non uno
    ///
    /// È il solo metodo del contratto con **due cancelli**, e li ha perché
    /// pubblica due cose dell'utente che si concedono separatamente
    /// (§23.5, decisione 0095):
    /// [`READ_SESSION`](crate::options::permission::READ_SESSION) per quale
    /// nota è aperta e in che modalità,
    /// [`READ_SELECTION`](crate::options::permission::READ_SELECTION) per il
    /// testo selezionato. Senza il primo la risposta è `None`; con il primo e
    /// senza il secondo il contesto arriva con
    /// [`selections`](crate::session::ViewContext::selections) a `None`.
    ///
    /// La coppia esiste per una scelta che all'utente serve e che un cancello
    /// solo non sa esprimere: *«questo plugin può sapere che nota sto
    /// guardando, non cosa ci sto scrivendo»*. Nessuno dei due si appoggia a
    /// [`READ_VAULT`](crate::options::permission::READ_VAULT), che pure governa
    /// il contenuto dei documenti: appoggiarcisi avrebbe legato la selezione
    /// alla cecità sul vault, cioè avrebbe tolto proprio quella scelta.
    ///
    /// Nessuno dei due rifiuti si può **dire**, perché questa firma non ha un
    /// esito — è una delle sei senza `Result` — e in entrambi i casi la
    /// risposta nulla significa già un'altra cosa («nessun pannello», «nessun
    /// cursore»). Regge lo stesso, e per una ragione che vale solo qui: chi la
    /// riceve ha in mano il proprio manifest, quindi sa da sé perché la riceve.
    ///
    /// È il solo contesto di sessione che il contratto espone: una view lo
    /// **chiede** quando ne ha bisogno (un pannello backlink lo fa a ogni
    /// render), invece di riceverlo come argomento — che costringerebbe *ogni*
    /// view a portarselo anche quando non le serve (un grafo, un pannello
    /// impostazioni). Chi lo imposta è la shell, non un plugin:
    /// `active_context` non ha un gemello che scrive nell'`HostApi`, perché
    /// "quale nota guardo e dove ho cliccato" è una decisione dell'utente
    /// sull'app, non una capacità da concedere.
    ///
    /// Restituisce un [`ViewContext`] e non un `DocId` perché con schede,
    /// split e finestre multiple (FEATURES 4.1) "il documento attivo" non è più
    /// una variabile globale: due pannelli backlink affiancati farebbero la
    /// stessa domanda e riceverebbero la stessa risposta, sbagliata per uno dei
    /// due. Il [`PaneId`](crate::session::PaneId) dentro il contesto è ciò che
    /// permette di distinguerli già ora; legarli a un pannello *fisso* è
    /// l'altra metà del problema, e arriva con le istanze di view (§2.3).
    fn active_context(&self) -> Option<ViewContext>;
}

/// Farsi sentire: emettere un evento, chiedere lavoro lungo.
///
/// Le due sono una famiglia perché si negano insieme e per la stessa ragione:
/// sono **effetti che una simulazione non può ritirare**. Un `DocumentChanged`
/// finto fa ricaricare l'editor su una modifica che non è avvenuta; un job
/// gira fuori dal giro sincrono e rientra come evento quando la simulazione è
/// finita da un pezzo.
pub trait HostEvents: Send + Sync {
    /// Emette un evento sull'event bus.
    ///
    /// È l'unica capacità del contratto **senza esito**, e ne segue una cosa
    /// che va detta: un host che non la concede non ha modo di rifiutare, può
    /// solo non emettere. Il silenzio è il no.
    fn emit(&mut self, event: Event);
    /// Chiede l'esecuzione in background di un job ([`Plugin::run_job`]).
    /// Ritorna subito con l'identità del job; l'esito arriverà come
    /// [`Event::JobDone`](crate::Event::JobDone) sul giro sincrono normale.
    ///
    /// Chi lancia non deve leggere il vault per conto del job: dalla decisione
    /// 0027 il job ha l'host, e nel [`JobSpec`] vanno i suoi argomenti. Ciò che
    /// il lanciatore *non* può dare — e resta la ragione per cui questa è una
    /// richiesta e non una chiamata — è il **tempo**: il job gira quando l'host
    /// lo esegue, non adesso.
    ///
    /// I no a monte sono due. Il **nome**: i nomi dei job sono uno degli
    /// spazi di nomi del §7.4 ([`crate::rules::ids`]), e un plugin che non è
    /// core nomina dentro il proprio id; un nome altrui risponde
    /// [`BadArgs`](PluginError::BadArgs), perché `JobDone` lo porta sul bus a
    /// nome del kernel e chi lo ascolta se ne fida. E la **chiusura**: su un
    /// vault che sta chiudendo la richiesta non entra nemmeno in coda e
    /// risponde subito
    /// [`Cancelled`](PluginError::Cancelled) — di quel lavoro non arriverà
    /// nessun `JobDone`, perché non è mai partito. La guardia è per
    /// generazione: chi riapre il vault è un workspace nuovo, e i job
    /// ripartono.
    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError>;

    /// **A che punto sono**: da chiamare dentro [`Plugin::run_job`], quanto
    /// spesso si vuole (§10.3, decisione 0035).
    ///
    /// # Perché è una capacità se il progresso è un evento
    ///
    /// Lo è, e resta un evento: ciò che finisce sul canale è
    /// [`Event::JobProgress`](crate::Event::JobProgress), con la regola della
    /// decisione 0013 — *ciò che si limita a informare è un evento*. Questa è la
    /// **porta**, come [`emit`](HostEvents::emit) è la porta di ogni altro
    /// evento, e c'è per una ragione sola: un job **non conosce il proprio
    /// `JobId`**. [`Plugin::run_job`] riceve il nome dell'entry point, gli
    /// argomenti e l'host — non l'identità — quindi non può nominare sé stesso
    /// in un evento, e chi l'identità ce l'ha è il suo host. Passando da qui
    /// l'id non è un parametro: **non si può sbagliare e non si può fingere**,
    /// che è la stessa proprietà per cui un topic di custom non si può emettere
    /// sotto il nome di un altro (§7.4).
    ///
    /// # Fuori da un job non fa niente, e non è una dimenticanza
    ///
    /// Il default è un no-op: lo eredita ogni host che non sia quello di un job.
    /// Un progresso ha bisogno di una **fine** per essere un progresso, e
    /// l'unica cosa che nel contratto ha una fine dichiarata è un job
    /// ([`Event::JobDone`](crate::Event::JobDone)); una chiamata sincrona finisce
    /// tornando, e mentre gira tiene il prestito esclusivo del workspace — chi
    /// vuole raccontarsi mentre lavora, per costruzione, è un job.
    ///
    /// Come `emit`, non ha esito: un host che non la concede non rifiuta, tace.
    /// E come `emit` **non la si nega a un job annullato**: l'ultima cosa che un
    /// job che sta smettendo può voler dire è a che punto era.
    fn report_progress(&mut self, progress: JobProgress) {
        let _ = progress;
    }
}

/// Il canale dati: interrogare l'indice.
///
/// Una famiglia con una capacità sola, e non è uno spreco: è la sola lettura
/// che non riguarda **un** documento ma ciò che è derivato dall'intero vault, e
/// un host può volerla negare a chi ha `read_vault` ristretto a una cartella —
/// una query aggregata non ha un path da confrontare con una allowlist.
pub trait HostQuery: Send + Sync {
    /// Interroga il vault: backlink, grafo, struttura, tag, proprietà, salute e
    /// ricerca full-text passano tutti di qui, con la stessa semantica di
    /// dispatch del kernel (ciò di cui il kernel è già l'unica fonte di verità
    /// lo serve lui, il resto i provider registrati; vedi [`IndexQuery`]).
    ///
    /// È `&self` — una query non muta niente — ed è la ragione per cui un indice
    /// può servirla sotto prestito condiviso del workspace, come una view.
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError>;
}

/// **Chiamare un altro plugin** e ricevere una risposta (§7.5).
///
/// Era il canale che non c'era. Gli unici modi in cui due provider si potevano
/// parlare erano [`Event::Custom`](crate::Event::Custom) — fire-and-forget,
/// senza risposta — e [`IndexQuery::Custom`], che ha un destinatario dichiarato
/// (decisione 0019) ma resta *una domanda all'indice*. Una **chiamata** non
/// c'era: A non poteva chiedere qualcosa a B e ricevere un risultato.
///
/// Il capitolo 21 lo dà per scontato a ogni riga — FubCharts che disegna dati
/// di FubDB, FubForms che scrive in FubDB, FubCalendar che legge da FubTasks —
/// e senza questa capacità quei moduli non sarebbero plugin: sarebbero crate
/// linkati che si vedono a compile time, cioè il contrario del §16.3.
///
/// # La terna, e perché va insieme
///
/// Da sola una chiamata non basta: serve sapere **chi offre cosa**
/// ([`PluginManifest::provides`]), **chi ha bisogno di chi**
/// ([`PluginManifest::requires`]) e cosa succede quando ciò che serve non c'è.
/// Le tre cose sono una decisione sola, e la risposta di Fub alla terza è:
/// **chi dipende da ciò che non c'è non si dichiara affatto**. Non si attiva
/// degradato e non si disattiva dopo: chi lo monta riceve un errore che nomina
/// il requisito mancante, e decide.
pub trait HostServices: Send + Sync {
    /// Chiama un metodo di un servizio offerto da un altro plugin.
    ///
    /// `service` è un `ns` con la regola dei nomi del §7.4 — è l'id del plugin
    /// che lo offre, o un nome dentro di esso. Nessuno lo offre →
    /// [`PluginError::Unserved`], che è distinguibile da «chi lo offre ha
    /// fallito»; ed è la stessa distinzione che la decisione 0019 ha portato
    /// nel canale dati.
    ///
    /// `&mut self` perché una chiamata può **scrivere**: chiedere a FubDB di
    /// registrare una riga è ciò per cui FubForms esiste. Le capacità di chi
    /// esegue restano le **sue** — un servizio non presta i propri permessi a
    /// chi lo chiama, e chi lo chiama non presta i propri a lui.
    ///
    /// Un servizio non può chiamare sé stesso, nemmeno per giro: la catena è
    /// nota all'host e una ricorsione risponde
    /// [`PluginError::BadArgs`](crate::PluginError::BadArgs) nominando il giro.
    /// È la stessa regola di [`HostCommands::run_command`], per la stessa
    /// ragione.
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError>;

    /// Le destinazioni offerte dagli
    /// [`ExportProvider`](crate::transfer::ExportProvider) registrati, in ordine
    /// di registrazione.
    ///
    /// Stanno qui, accanto a [`call_service`](Self::call_service), perché sono
    /// la stessa mossa: usare un provider che un altro plugin ha registrato,
    /// scelto dall'host e non da una lista che chi chiama si porta dietro.
    fn export_targets(&self) -> Result<Vec<ExportTarget>, PluginError>;

    /// Esporta col provider registrato che offre `request.target`; nessuno la
    /// offre → [`PluginError::BadArgs`].
    ///
    /// Il provider gira con le **proprie** capacità, come un servizio. Chi
    /// chiama riceve i byte degli artefatti nel rapporto, quindi deve poter
    /// leggere ciò che la selezione nomina: il `Guard` del kernel lo controlla
    /// sulla selezione, non sugli artefatti.
    fn run_export(&mut self, request: &ExportRequest) -> Result<ExportReport, PluginError>;

    /// Fa entrare `source` nel vault (o dice cosa entrerebbe, con
    /// [`ImportMode::Preview`](crate::transfer::ImportMode::Preview)) col primo
    /// [`ImportProvider`](crate::transfer::ImportProvider) registrato che la
    /// riconosce; nessuno → [`PluginError::BadArgs`].
    ///
    /// Il provider scrive con le proprie capacità; chi chiama deve poter
    /// scrivere nella cartella di destinazione (leggere, per un'anteprima).
    fn run_import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
    ) -> Result<ImportReport, PluginError>;
}

/// **Parlare con qualcosa che non sta sul disco** (§23.3).
///
/// La [0013](../../../docs/decisions/0185-capability-un-solo-guard.md) l'aveva
/// tenuta fuori con **due bloccanti nominati** — *«servono prima §9.1 (un
/// lavoro lungo che vede il vault) perché sia utile e §7.3 (`network` letto da
/// qualcuno) perché sia sicura»* — ed è la forma migliore in cui un no si possa
/// scrivere. Sono caduti tutti e due: il primo con la
/// [0027](../../../docs/decisions/0183-composizione-host-kernel.md), il
/// secondo con la [0021](../../../docs/decisions/0185-capability-un-solo-guard.md), che aveva
/// scritto perfino la riga d'innesto.
///
/// # Il permesso non dice solo *se*: dice **dove**
///
/// `fub:network` porta come parametro una **allowlist di host**, e lo prometteva
/// dalla [0017](../../../docs/decisions/0182-provider-e-porte-generiche.md)
/// senza che nessuno la leggesse. È l'unico permesso il cui parametro **si
/// onora**, e la ragione per cui si è cominciato da qui invece che dai prefissi
/// di path è che qui il divario fra ciò che il manifest dichiara e ciò che
/// l'app fa non è un recinto che perde: un manifest che dice *«mi connetto solo
/// a api.acme.com»*, mostrato all'utente, **accettato** dall'utente, e che poi
/// consenta qualunque host è una **frase falsa scritta dall'app**.
///
/// # Una richiesta sola, e i redirect non si seguono
///
/// È la proprietà su cui l'allowlist poggia, e senza la quale sarebbe una
/// decorazione: un host dichiarato che risponde `302` verso un host che non lo
/// è porterebbe fuori dal recinto **senza che nessuno lo abbia deciso**. Qui il
/// `3xx` arriva a chi ha chiesto, con il suo `Location`
/// ([`HttpResponse::redirect_to`](crate::net::HttpResponse::redirect_to));
/// seguirlo è **una seconda chiamata**, e ogni chiamata ripassa dal cancello.
/// Un salto che può uscire dal recinto non lo fa l'host per conto di qualcun
/// altro.
pub trait HostNetwork: Send + Sync {
    /// Una richiesta, una risposta.
    ///
    /// `&self` e non `&mut self` — a differenza di
    /// [`call_service`](HostServices::call_service), che pure è un effetto —
    /// perché non tocca niente dell'host: è la proprietà che permette a un job
    /// di farla **senza tenere il prestito del workspace** per quanto dura la
    /// rete, che è l'unica durata di questo contratto che l'host non governa.
    ///
    /// **Un `4xx` o un `5xx` sono `Ok`.** L'errore è non aver potuto chiedere —
    /// DNS, connessione, TLS, il tetto di tempo dell'host — e arriva come
    /// [`PluginError::Io`](crate::PluginError::Io). Le due si correggono in modi
    /// opposti, quindi vanno distinte: a un `404` si risponde guardando la
    /// risposta, a un guasto riprovando o dicendolo a chi guarda.
    ///
    /// I rifiuti sono **tre**, e ognuno dice cosa manca:
    /// [`PermissionDenied`](crate::PluginError::PermissionDenied) senza
    /// `fub:network` **o** verso un host fuori dall'allowlist dichiarata —
    /// perché sono la stessa frase, *non ti è concesso questo* —,
    /// [`BadArgs`](crate::PluginError::BadArgs) per un URL che non si legge o
    /// per uno schema che non è `https` (né `http` verso l'anello locale), e
    /// [`Unserved`](crate::PluginError::Unserved) su un host montato **senza
    /// client di rete**: non è un permesso che manca, è che di qua non ci passa
    /// nessun filo, e chi lo riceve deve poterlo dire diversamente.
    ///
    /// **Il tetto di tempo non attraversa il confine**, per la regola della
    /// [0094](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md): un
    /// limite dell'host dev'essere visibile quando morde, non interrogabile.
    /// Chi lo supera riceve un `Io` che lo dice, e il numero resta alzabile
    /// senza rompere nessuno.
    fn fetch(
        &self,
        request: crate::net::HttpRequest,
    ) -> Result<crate::net::HttpResponse, PluginError>;

    /// Esegue una richiesta legata alla bandiera del job. Il default conserva
    /// il contratto per gli host che non hanno un trasporto interrompibile; un
    /// trasporto che può fermare la connessione deve controllare la bandiera
    /// durante la lettura del corpo.
    fn fetch_cancelled(
        &self,
        request: crate::net::HttpRequest,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<crate::net::HttpResponse, PluginError> {
        if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(PluginError::Cancelled(
                "the network request was cancelled".into(),
            ));
        }
        let response = self.fetch(request)?;
        if cancelled.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(PluginError::Cancelled(
                "the network request was cancelled".into(),
            ));
        }
        Ok(response)
    }
}

/// Un prestito è ancora il filo: serve a chi ha un `Arc<dyn HostNetwork>` e
/// vuole metterci davanti un cancello senza clonarlo.
impl<T: HostNetwork + ?Sized> HostNetwork for &T {
    fn fetch(
        &self,
        request: crate::net::HttpRequest,
    ) -> Result<crate::net::HttpResponse, PluginError> {
        (**self).fetch(request)
    }

    fn fetch_cancelled(
        &self,
        request: crate::net::HttpRequest,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<crate::net::HttpResponse, PluginError> {
        (**self).fetch_cancelled(request, cancelled)
    }
}

/// Leggere una sorgente che l'host tiene aperta per conto di un import.
///
/// È la capacità nata con la decisione 0102, e l'unica del contratto che non
/// presta niente del vault né della macchina: presta **una cosa sola**, quella
/// che l'utente ha appena scelto in un dialogo di sistema, e la presta per la
/// durata di una chiamata. La chiave è
/// [`SourceHandle`](crate::transfer::SourceHandle) e la timbra l'host — vedi lì
/// perché questo basta a rendere superfluo un recinto di path.
pub trait TransferRead: Send + Sync {
    /// Legge dalla sorgente a partire da `offset`.
    ///
    /// **Posizionale, e non è un dettaglio**: è la ragione per cui questa forma
    /// è stata scelta al posto di uno `stream<u8>` di WASI o di un cursore
    /// tenuto dall'host. Quelle sanno solo andare avanti, e un contenitore zip
    /// — cioè `.docx`, `.epub`, `.odt` e mezzo mondo dei backup — ha la propria
    /// directory **in fondo**: chi non può tornare indietro non sfoglia un
    /// archivio, lo scarica tutto.
    ///
    /// **Può restituire meno byte di `len`, e non è un errore.** È la sola
    /// forma che regge con la stessa firma la fine della sorgente e il tetto di
    /// una singola lettura, e obbliga chi legge a scrivere il ciclo che
    /// dovrebbe scrivere comunque. Un vuoto significa: non c'è altro a partire
    /// da lì. Il tetto non è interrogabile, per la regola della
    /// [0094](../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md).
    ///
    /// I rifiuti sono due: [`PermissionDenied`](crate::PluginError::PermissionDenied)
    /// se la famiglia è negata, [`BadArgs`](crate::PluginError::BadArgs) per un
    /// handle che non è (o non è più) di questa chiamata — che è anche ciò che
    /// riceve chi prova a leggere la sorgente di qualcun altro tirando a
    /// indovinare un numero.
    fn read_source(
        &self,
        handle: crate::transfer::SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError>;
}

/// Chi **offre** un servizio agli altri plugin (§7.5).
///
/// Quali `ns` serva non lo dice questo trait: lo dice il
/// [`PluginManifest::provides`] di chi lo registra. È deliberato — «cosa offro»
/// è una dichiarazione del plugin, che l'host legge *prima* di montarlo e usa
/// per risolvere le dipendenze di chi arriva dopo; se stesse in un metodo del
/// provider, per saperlo bisognerebbe averlo già montato.
pub trait ServiceProvider: Send + Sync {
    /// Esegue un metodo. `service` è uno dei `ns` dichiarati nel manifest — un
    /// provider può offrirne più d'uno — e `method` un nome che il servizio
    /// documenta.
    ///
    /// Un `method` ignoto è [`PluginError::BadArgs`]: la domanda è arrivata a
    /// chi la doveva ricevere, ed è malposta. `Unserved` significa un'altra
    /// cosa — che nessuno serve quel `ns` — e lo risponde l'host, non questo
    /// trait.
    fn call(
        &self,
        service: &str,
        method: &str,
        args: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError>;
}

/// Invocare i comandi del registro: la capacità che rende componibili macro e
/// automazioni.
///
/// È una famiglia sua perché è l'unica che **moltiplica**: chi la ottiene può
/// fare tutto ciò che sanno fare i comandi registrati, e un permesso che si
/// concede senza saperlo sarebbe la scala privilegiata verso ogni altra
/// capacità. Il §7.3 la nomina per questo.
pub trait HostCommands: Send + Sync {
    /// Invoca un comando del registro (decisione 0009).
    ///
    /// È la capacità che rende **componibili** macro e automazioni (16.2, 16.3):
    /// senza, ogni plugin che voglia fare ciò che un altro sa già fare deve
    /// conoscerlo, dipenderne e rifarlo. Con, ne conosce l'id — che è l'unica
    /// cosa che una `CommandSpec` promette di non cambiare.
    ///
    /// Tre cose che questa firma dice *non* dicendole:
    ///
    /// - **Non prende un [`InvokeMode`]**: il modo è dell'host, non della
    ///   chiamata. Un comando che si sta simulando invoca in simulazione, e
    ///   riceve il *piano* di ciò che il comando invocato farebbe; il piano di
    ///   una macro è l'unione dei piani dei suoi passi. Se il modo fosse un
    ///   argomento, una simulazione potrebbe diventare reale invocando
    ///   qualcuno — che è esattamente il buco che la decisione 0010 ha chiuso.
    /// - **Non prende un [`Actor`](crate::event::Actor)**: l'attore non si
    ///   riazzera invocando. È chi ha chiesto, cioè chi è *entrato* nel kernel
    ///   (l'utente dalla IPC, il watcher, il plugin da un handler), e resta lui
    ///   per tutta la catena. Un comando che si intestasse le scritture che
    ///   compie per conto dell'utente direbbe all'automazione che le ha chieste
    ///   lei — e un'automazione che non riconosce più chi ha chiesto è quella
    ///   che si richiama da sola.
    /// - **Non apre un lotto suo**: si unisce a quello aperto. Una macro di tre
    ///   comandi è *una* cosa che qualcuno ha chiesto, quindi un
    ///   [`Event::BatchEnded`](crate::Event::BatchEnded) solo, quindi un
    ///   ridisegno solo.
    ///
    /// Un comando non può invocare sé stesso, nemmeno per giro: la catena è
    /// nota all'host, e una ricorsione risponde
    /// [`PluginError::BadArgs`](crate::PluginError::BadArgs) nominando il giro.
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError>;

    /// **Annulla l'ultima operazione annullabile**, e dice quale era (§13.3).
    ///
    /// `Ok(None)` = non c'era niente da annullare, e non è un errore: è la
    /// risposta normale a un vault appena aperto, e un comando che la riceve ha
    /// una frase da mostrare e non un guasto da riferire.
    ///
    /// Sta qui accanto a [`run_command`](HostCommands::run_command) perché la
    /// pila che consuma è fatta di [`Undo`](crate::command::Undo) — cioè, per
    /// metà, di comandi — e perché è la stessa specie di atto: fare qualcosa che
    /// qualcun altro ha dichiarato di saper fare. È una capacità e non un
    /// comando del registro per la ragione della decisione 0009 letta al
    /// contrario: la pila è **privata del kernel**, e un comando riceve solo
    /// l'`HostApi` — quindi «togli l'ultima voce e falla» non è scrivibile senza
    /// una firma. Il comando che la invoca c'è lo stesso, ed è quello che
    /// compare nella palette.
    ///
    /// Tre cose che questa firma dice non dicendole:
    ///
    /// - **Annullare non è annullabile**: mentre un annullamento gira, la pila
    ///   non cresce. Senza, la prima cosa annullabile che si trova sarebbe
    ///   l'annullamento stesso, e Ctrl-Z due volte non farebbe niente due volte.
    ///   Il *redo* è un'altra pila e un'altra decisione, e oggi non c'è.
    /// - **La pila dura quanto il vault aperto.** È la cronologia «per
    ///   sessione» che FEATURES 4.2 chiede, e non di più: farla sopravvivere a
    ///   una chiusura vorrebbe dire tenerla su disco *e* accorgersi di ciò che
    ///   è cambiato mentre l'app era spenta, cioè un journal (§15.2) e non una
    ///   pila.
    /// - **Un annullamento può fallire come qualunque scrittura**, e il caso che
    ///   conta è [`PluginError::Conflict`]: il documento è cambiato da quando
    ///   l'operazione lo aveva toccato, quindi tornare indietro cancellerebbe il
    ///   lavoro di qualcun altro. Fallire lì è il comportamento giusto, e la
    ///   voce resta consumata — riprovare vorrebbe dire riprovare a cancellarlo.
    ///
    /// # Una voce non è un passo, ed è ciò che questa firma diceva male (§23.14)
    ///
    /// La riga qui sopra — *«può fallire come qualunque scrittura»* — descriveva
    /// un annullamento come **una** scrittura. È una lista: una macro che ha
    /// rinominato dodici note torna indietro da dodici rinomine, e il passo che
    /// fallisce sta in mezzo agli altri. Con un `Option<Text>` le tre risposte
    /// possibili erano due, e quella che mancava era la più frequente e la sola
    /// su cui si può fare qualcosa:
    ///
    /// | cosa è successo | cosa risponde |
    /// |---|---|
    /// | tutti i passi sono andati | `Ok(Some(Undone { replay: None, … }))` |
    /// | qualcuno sì e qualcuno no | `Ok(Some(Undone { replay: Some(…), … }))` |
    /// | **niente** è cambiato | `Err(…)` — il primo perché |
    /// | non c'era niente da annullare | `Ok(None)` |
    ///
    /// L'ultima riga della tabella non è un errore e non lo è mai stata: è la
    /// risposta normale a un vault appena aperto.
    ///
    /// La terza tiene la promessa della riga qui sopra **alla lettera**: se non
    /// è cambiato niente, un annullamento è fallito come qualunque scrittura, e
    /// chi lo invocava sperando in un `Err` continua a riceverlo. Ciò che
    /// smette di essere un errore è soltanto il caso in cui *una parte del
    /// lavoro è stata fatta* — buttarla via insieme alla notizia sarebbe l'unica
    /// risposta peggiore del silenzio.
    ///
    /// E l'[`Undone`] porta **due** conti, non uno: quello di questo
    /// annullamento e quello dell'operazione che annulla, che poteva essere già
    /// a metà per conto suo. Vedi il tipo.
    fn undo_last(&mut self) -> Result<Option<Undone>, PluginError>;
}

// ---------------------------------------------------------------------------
// Le due somme: cosa si può fare **senza cambiare niente**, e tutto
// ---------------------------------------------------------------------------

/// Tutto ciò che si può fare **senza cambiare niente**.
///
/// È il tipo del percorso di lettura: `render_view` (che gira sotto prestito
/// condiviso del workspace) e `export` (che per contratto non scrive nel vault)
/// lo ricevono, e la loro firma dice adesso ciò che prima diceva una riga di
/// prosa. Prima ricevevano l'`HostApi` intero e l'host che glielo prestava
/// implementava dodici capacità di scrittura come altrettanti `unreachable!()`:
/// il divieto era vero, e non era un tipo.
///
/// Leggere la **sorgente di un import** sta qui e non su [`HostApi`], e la
/// ragione non è di classificazione: sta qui perché un import di un vault da
/// 4 GiB legge per minuti, e sotto prestito esclusivo affamerebbe chiunque
/// scriva — che è precisamente il difetto per cui la decisione 0024 ha scelto un
/// `RwLock`. Dirlo nel tipo è ciò che permette a chi esegue un job di servire
/// quelle letture tenendo il prestito **condiviso**. Che una sorgente non sia
/// ancora nel vault non la rende una scrittura.
///
/// Non si implementa: c'è una impl generica per chiunque abbia le famiglie di
/// lettura.
pub trait ReadApi:
    VaultRead + DataRead + HostQuery + HostEnv + SettingsRead + ViewStateRead + TransferRead
{
}

impl<
        T: VaultRead
            + DataRead
            + HostQuery
            + HostEnv
            + SettingsRead
            + ViewStateRead
            + TransferRead
            + ?Sized,
    > ReadApi for T
{
}

/// Le capacità che il kernel concede a un provider/plugin: la **somma** delle
/// sedici famiglie.
///
/// È l'**unico** varco col mondo: ciò che non passa di qui, un plugin WASM non
/// lo potrà fare. Per questo la superficie va chiusa *prima* del freeze di M4 —
/// il dogfooding del versioning ha trovato il buco: un `EventHandler` scritto
/// come lo scriverebbe un plugin non aveva modo di tenere uno store di snapshot
/// su disco né di sapere che ore sono. La decisione 0013 ha chiuso l'elenco: dopo il
/// freeze un metodo **aggiunto** a una famiglia è una minor, uno **tolto** è una
/// major.
///
/// Non si implementa e non si dichiara: chi ha le sedici famiglie ce l'ha, per
/// la impl generica qui sotto. Chi lo **riceve** continua a scrivere
/// `&mut dyn HostApi` come prima — è il tipo di chi può fare tutto, e a quello
/// non è cambiato niente.
///
/// # Visibilità durante i callback (contratto)
///
/// Durante un callback **in scrittura** (`handle`, `on_action`, `flush`,
/// `activate`) un provider **non vede sé stesso né i fratelli in corso di
/// chiamata**: l'host li estrae dal workspace per la durata del giro, quindi
/// una [`query_index`](HostQuery::query_index) fatta da lì dentro può trovare
/// meno provider di quanti ne esistano — al limite nessuno. Non è un
/// malfunzionamento: un callback in scrittura risponde da ciò che ha già in
/// mano, non interrogando il mondo che lo sta chiamando. Il percorso di
/// **lettura** (`render_view`) invece gira sotto prestito condiviso e vede il
/// mondo intero, indici compresi.
pub trait HostApi:
    ReadApi
    + VaultWrite
    + VaultStructure
    + DataWrite
    + SettingsWrite
    + ViewStateWrite
    + HostEvents
    + HostCommands
    + HostServices
    + HostNetwork
{
}

impl<T> HostApi for T where
    T: ReadApi
        + VaultWrite
        + VaultStructure
        + DataWrite
        + SettingsWrite
        + ViewStateWrite
        + HostEvents
        + HostCommands
        + HostServices
        + HostNetwork
        + ?Sized
{
}
