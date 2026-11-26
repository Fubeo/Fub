//! Le capacità che un host può servire, una per famiglia di porte.

use super::*;

/// Le venti famiglie di capacità [conta: guard-famiglie], come nomi su
/// cui una politica risponde.
///
/// Sono i sedici trait di `fub_abi::traits` **più tre**, più una famiglia che
/// nessun trait porta ([`Capability::Notifications`]), e non è una
/// duplicazione: là sono ciò che un host **sa fare**, qui ciò che gli si
/// **concede**. Le due liste devono coprire le stesse cose, e il presidio è
/// che [`Guard`] non compila se un trait non è coperto.
///
/// [`Capability::Notifications`] è l'eccezione che va detta: non c'è un
/// metodo dell'host che notifichi, perché a notificare è l'app, fuori dal
/// contratto dei componenti. Il componente dei compiti dichiara il permesso,
/// l'utente lo nega dalle Impostazioni come ogni altro, e chi sta per
/// mostrare una notifica chiede alla politica di quel componente se la
/// famiglia è concessa. Il cancello è questo stesso `Policy::denies`, non una
/// seconda lettura dell'impostazione.
///
/// # Perché più famiglie che trait
///
/// Per tredici trait su sedici la corrispondenza è uno a uno, ed era vera
/// per tutti e quattordici fino alla
/// [0095](../../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md).
/// [`HostEnv`] ne porta **tre** perché è il solo trait che presta, dallo stesso
/// metodo, una cosa della macchina e due dell'utente: l'orologio e il caso
/// sono [`Capability::Env`], quale nota è aperta è [`Capability::Session`], il
/// testo selezionato è [`Capability::SessionSelection`].
///
/// La scomposizione in sotto-trait — la strada della
/// [0021](../../../../docs/decisions/0185-capability-un-solo-guard.md), che è ciò che di norma
/// rende una famiglia esattamente un trait — qui **non era disponibile**: le
/// tre cose escono da una firma sola, e un trait in più non spacca un record in
/// due. Spaccare il record era un'opzione, ed è quella che si è scartata; vedi
/// il verbale. Il prezzo è che l'invariante da presidiare cambia forma: non
/// «una famiglia, un trait», ma «nessun trait senza almeno una famiglia».
///
/// [`HostQuery`] ne porta **due** dalla
/// [0096](../../../../docs/decisions/0195-versioni-indipendenti.md), e per una
/// ragione diversa da quella di [`HostEnv`]: là le tre cose escono insieme da
/// un record, qui escono da **richieste diverse** — una [`IndexQuery`] nomina
/// già la propria famiglia ([`fub_abi::traits::QueryKind`]), e le bozze sono
/// l'unica il cui contenuto non è nel vault. Il cancello guarda quindi *quale*
/// domanda passa, che è la prima volta che il `Guard` legge un argomento invece
/// del solo metodo — vedi [`Guard::query_capability`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Capability {
    /// Leggere il vault: sorgente, modello, elenco, cestino.
    VaultRead,
    /// Scrivere il testo di un documento.
    VaultWrite,
    /// Creare, rinominare, cestinare, ripristinare, distruggere.
    VaultStructure,
    /// Rileggere i propri blob persistenti.
    DataRead,
    /// Scrivere i propri blob persistenti.
    DataWrite,
    /// Interrogare l'indice — **tranne** le bozze, che hanno la loro.
    Query,
    /// Leggere le **bozze**: ciò che l'utente stava scrivendo e non ha salvato.
    ///
    /// È l'unica famiglia che non copre un trait né un metodo, ma **una
    /// variante di una richiesta**: [`IndexQuery::Drafts`] passa di qui e ogni
    /// altra passa da [`Capability::Query`]. Il taglio è lì perché è lì che sta
    /// la differenza — non fra due canali, ma fra ciò che l'utente ha
    /// consegnato al disco e ciò che non ha ancora deciso di consegnare.
    ///
    /// Sta **al posto** di [`Capability::Query`] e non sopra: chi ha questa e
    /// non quella legge le bozze e nient'altro, che è il pannello di recupero;
    /// chi ha quella e non questa legge tutto il vault e non ciò che si sta
    /// scrivendo adesso. Sono le due frasi che l'utente deve poter dire, e una
    /// famiglia cumulativa ne avrebbe resa inesprimibile la prima.
    Drafts,
    /// Sapere che ore sono, e tirare a sorte.
    ///
    /// **Non** «cosa guarda l'utente»: quella era qui, e se n'è andata con la
    /// [0095](../../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md).
    /// Ciò che resta è della macchina, non di chi la usa, e per questo non ha
    /// un permesso.
    Env,
    /// Sapere **quale nota** l'utente sta guardando, e in che modalità.
    ///
    /// È il contesto senza il suo contenuto: il pannello, il documento, la
    /// modalità. Il nome di una nota non è il suo testo, ma è comunque un fatto
    /// dell'utente — per questo ha un permesso, e per questo non sta con
    /// l'orologio.
    Session,
    /// Leggere il **testo selezionato**, verbatim.
    ///
    /// Sta accanto a [`Capability::Session`] e non dentro, perché la leva che
    /// serve all'utente è proprio fra le due: concedere «sai che nota guardo» e
    /// negare «sai cosa ci sto scrivendo». Chi ha questa e non quella non
    /// riceve niente — il testo arriva dentro il contesto, e senza contesto non
    /// c'è dove metterlo.
    SessionSelection,
    /// Emettere eventi, chiedere job.
    Events,
    /// Invocare i comandi del registro.
    Commands,
    /// Chiamare i servizi offerti dagli altri plugin (§7.5).
    Services,
    /// **Parlare con qualcosa che non sta sul disco** (§23.3).
    ///
    /// È una famiglia il cui permesso dice non solo *se* ma anche **dove**:
    /// `fub:network` porta una allowlist di host, confrontata da
    /// [`Policy::denies_host`]. Le allowlist di prefissi del vault e del
    /// contesto usano invece [`Policy::denies_path`]: host e path hanno domini
    /// e semantiche distinti.
    Network,
    /// Leggere le impostazioni dichiarate (§11.1).
    SettingsRead,
    /// Scrivere quelle che si sono dichiarate scrivibili da un programma.
    SettingsWrite,
    /// Rileggere lo stato di vista del proprio esemplare (§11.2).
    ViewStateRead,
    /// Ricordarlo.
    ViewStateWrite,
    /// **Leggere la sorgente di un import** che l'host tiene aperta (0102).
    ///
    /// L'unica famiglia che non presta niente del vault né della macchina:
    /// presta una cosa sola, quella che l'utente ha appena scelto in un dialogo
    /// di sistema, e la nomina con una chiave che l'host ha timbrato. Per
    /// questo non ha un permesso del manifest — vedi
    /// [`Capability::permission`] — e per questo esiste comunque come famiglia:
    /// una politica deve poterla negare (il safe mode la nega come tutto il
    /// resto), e senza un nome non ci sarebbe niente da negare.
    Transfer,
    /// **Mostrare una notifica del sistema**, fuori dalla finestra: il
    /// promemoria di un compito all'ora scritta.
    ///
    /// Nessun metodo dell'host la porta: la notifica la mostra l'app, che
    /// prima chiede alla politica del componente dei compiti se questa famiglia
    /// è concessa. Così negare `fub:notifications` dalle Impostazioni spegne le
    /// notifiche alla domanda successiva, con lo stesso cancello che nega ogni
    /// altro permesso.
    Notifications,
}

impl Capability {
    /// Tutte, in ordine di dichiarazione. Serve a calcolare una
    /// [`CapabilitySet`] senza scrivere l'elenco una seconda volta: se una
    /// famiglia nascesse e non finisse qui, nascerebbe negata a tutti — che è
    /// il modo giusto di sbagliare, ma va visto.
    ///
    /// «Va visto» è stato per molto tempo una raccomandazione e basta: adesso lo
    /// vede `tests::i_discriminanti_coprono_ogni_famiglia`, perché tutto ciò che
    /// itera le capacità sta a valle di questo elenco — i permessi concessi da
    /// [`Granted::new`] e il presidio delle capacità simulate in
    /// `kernel/tests/invoke_command.rs` — e una famiglia che non ci finisse
    /// sparirebbe da entrambi restando verde.
    pub const ALL: [Capability; 20] = [
        Capability::VaultRead,
        Capability::VaultWrite,
        Capability::VaultStructure,
        Capability::DataRead,
        Capability::DataWrite,
        Capability::Query,
        Capability::Drafts,
        Capability::Env,
        Capability::Session,
        Capability::SessionSelection,
        Capability::Events,
        Capability::Commands,
        Capability::Services,
        Capability::Network,
        Capability::SettingsRead,
        Capability::SettingsWrite,
        Capability::ViewStateRead,
        Capability::ViewStateWrite,
        Capability::Transfer,
        Capability::Notifications,
    ];

    /// Il permesso del core che governa questa famiglia, se ce n'è uno.
    ///
    /// `None` non vuol dire "sempre concessa": vuol dire che **non è un
    /// permesso dichiarabile nel manifest** — i propri blob stanno nel proprio
    /// recinto, l'orologio non è del vault. Una politica può negarle lo stesso,
    /// per ragioni sue.
    pub fn permission(self) -> Option<&'static str> {
        match self {
            // Il canale dati è derivato dal vault: chi non lo può leggere non
            // lo può nemmeno interrogare in aggregato — anzi, meno che mai,
            // perché una risposta aggregata non ha un path da confrontare con
            // una allowlist.
            Capability::VaultRead | Capability::Query => Some(permission::READ_VAULT),
            // Le bozze non stanno sotto `read-vault`, e non è una sfumatura:
            // chi legge il vault legge un documento **che ha nominato**, chi
            // legge le bozze riceve in blocco il testo che l'utente non ha
            // ancora deciso di salvare. È la stessa forma della coppia
            // `read-session`/`read-selection` (0095), applicata al canale dati
            // invece che al contesto — e per la stessa ragione: appoggiarcele
            // renderebbe impossibile la sola cosa che questo permesso esiste
            // per permettere, cioè concedere il vault e negare le bozze.
            Capability::Drafts => Some(permission::READ_DRAFTS),
            Capability::VaultWrite | Capability::VaultStructure => Some(permission::WRITE_VAULT),
            Capability::Commands => Some(permission::RUN_COMMAND),
            // Cosa guarda l'utente e cosa ha selezionato sono **due** permessi
            // perché sono due domande, e la risposta a una non implica l'altra:
            // un pannello che segna la sezione corrente vuole la prima, un
            // contatore di parole della selezione tutte e due. Non si
            // appoggiano a `read-vault` — che pure governa il contenuto dei
            // documenti — perché appoggiarcisi renderebbe impossibile la sola
            // cosa che questi due esistono per permettere: concedere il vault e
            // negare la selezione.
            Capability::Session => Some(permission::READ_SESSION),
            Capability::SessionSelection => Some(permission::READ_SELECTION),
            Capability::Services => Some(permission::CALL_SERVICE),
            Capability::Network => Some(permission::NETWORK),
            Capability::Notifications => Some(permission::NOTIFICATIONS),
            Capability::SettingsWrite => Some(permission::WRITE_SETTINGS),
            // Leggere la configurazione non ha un permesso, e non è una
            // dimenticanza: uno schema è pubblico per costruzione — sta nel
            // manifest di chi lo dichiara — e questo store non contiene segreti,
            // per regola scritta (`fub_abi::settings`). Ciò che si recinta è
            // la scrittura, e lì i cancelli sono due.
            // Lo stato di vista sta nel proprio recinto come i blob, e per la
            // stessa ragione non è un permesso dichiarabile: quello che si
            // legge e si scrive è già solo il proprio.
            // Leggere la sorgente di un import non è un permesso, e qui la
            // ragione è più forte che altrove: il recinto **è già stato
            // disegnato dall'utente**, e non da noi. Ha scelto quel file in un
            // dialogo di sistema un istante fa; l'handle nomina quello e
            // nient'altro, e nessuno può fabbricarne uno. Un `fub:read-source`
            // nel manifest chiederebbe una seconda volta della stessa cosa —
            // che è il modo di rendere i permessi rumore, cioè di far dire di
            // sì senza guardare anche a quelli che contano.
            Capability::Transfer
            | Capability::ViewStateRead
            | Capability::ViewStateWrite
            | Capability::DataRead
            | Capability::DataWrite
            | Capability::Env
            | Capability::Events
            | Capability::SettingsRead => None,
        }
    }

    /// Questa famiglia **cambia il vault dell'utente**?
    ///
    /// Sono le due della scrittura — il testo di un documento e la struttura —
    /// e non ogni famiglia il cui nome contiene `Write`: i propri blob, la
    /// configurazione e lo stato di vista cambiano cose che il vault non
    /// contiene, e chi le confondesse chiederebbe `write-settings` per
    /// annullare una rinomina.
    ///
    /// Il `match` è **esaustivo di proposito**, e senza un `_`: una famiglia
    /// nuova non compila finché qualcuno non ha detto se il vault lo tocca. Con
    /// un ramo di scarto atterrerebbe su `false` restando verde, e il cancello
    /// di [`HostCommands::undo_last`], che è l'unico posto che questa domanda la
    /// fa, tornerebbe silenziosamente più largo di quello che aveva ammesso
    /// l'operazione.
    pub fn writes_the_vault(self) -> bool {
        match self {
            Capability::VaultWrite | Capability::VaultStructure => true,
            Capability::VaultRead
            | Capability::DataRead
            | Capability::DataWrite
            | Capability::Query
            | Capability::Drafts
            | Capability::Env
            | Capability::Session
            | Capability::SessionSelection
            | Capability::Events
            | Capability::Commands
            | Capability::Services
            | Capability::Network
            | Capability::SettingsRead
            | Capability::SettingsWrite
            | Capability::ViewStateRead
            | Capability::ViewStateWrite
            | Capability::Transfer
            | Capability::Notifications => false,
        }
    }
}
