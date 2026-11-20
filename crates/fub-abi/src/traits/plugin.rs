//! Gli eventi verso i provider (`EventHandler`) e il ciclo di vita del plugin:
//! permessi, manifest, timer, orologio civile e il trait `Plugin`.

use super::*;

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

/// Reazione agli eventi del vault.
///
/// # Semantica di consegna (contratto)
///
/// Gli eventi arrivano **dopo che la tua chiamata è tornata**, mai dentro di
/// essa: se durante `handle` (o `on_action`, `flush`, `activate`) emetti
/// eventi o scrivi documenti via [`HostApi`], gli handler — te compreso — li
/// ricevono quando il tuo frame si è chiuso. Un provider non è mai rientrato
/// nella propria istanza. È la semantica che il component model impone a M5
/// (un'istanza WASM non è rientrante) e vale identica in nativo: contarci
/// sopra in un senso o nell'altro non è un dettaglio d'implementazione.
///
/// # Cosa arriva: l'evento e la sua origine (decisione 0012)
///
/// [`handle`](EventHandler::handle) riceve un [`Notice`], non un [`Event`] nudo:
/// accanto a *cosa* è successo c'è **chi lo ha chiesto**
/// ([`Origin::actor`](crate::event::Origin::actor)) e di quale **lotto** fa
/// parte ([`Origin::batch`](crate::event::Origin::batch)). È ciò che rende
/// scrivibile un'automazione su-modifica: senza,
/// [`Actor::is_plugin`](crate::event::Actor::is_plugin) non avrebbe niente da
/// leggere e ogni handler che scrive dovrebbe riconoscere le proprie scritture
/// dal loro *contenuto* — cioè richiamarsi da solo finché il budget del dispatch
/// non lo tronca.
///
/// # E cosa non arriva: `index-updated` dentro un lotto
///
/// Chi dichiara [`EventKind::IndexUpdated`](crate::event::EventKind::IndexUpdated)
/// deve dichiarare anche
/// [`EventKind::BatchEnded`](crate::event::EventKind::BatchEnded): dentro un
/// lotto è il solo dei due che arriva (vedi [`crate::event`]). Gli eventi
/// **per-documento** invece passano tutti, dentro un lotto come fuori.
pub trait EventHandler: Send + Sync {
    fn subscribed(&self) -> EventMask;
    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError>;
}

// ---------------------------------------------------------------------------
// Ciclo di vita del plugin (bundle nativo o WASM)
// ---------------------------------------------------------------------------

/// Cosa un plugin dichiara di voler fare.
///
/// Erano tre booleani — leggere, scrivere, rete — contro ciò che il 20.1, il
/// 23.1 e il 20.3 chiedono: appunti, camera e microfono, filesystem esterno, e
/// soprattutto **rete con allowlist** e **file con allowlist**, cioè permessi
/// che hanno un *parametro*. Un booleano non ha dove metterlo, e il permesso
/// «rete» senza allowlist è o tutto o niente.
///
/// Le chiavi del core stanno in [`permission`](crate::options::permission); il
/// valore è il parametro (una lista di host, un elenco di prefissi di path).
/// Un permesso con un namespace di terzi resta nella mappa e attraversa il
/// confine intatto: un host che non lo conosce può **rifiutarlo**, che è
/// esattamente ciò che un enum chiuso non gli avrebbe permesso di fare.
///
/// Il **punto di applicazione non esiste ancora** ed è il §7.3: qui c'è la
/// forma, che è la metà che scade col freeze.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PluginPermissions {
    pub granted: crate::options::OptionMap,
}

impl PluginPermissions {
    /// I permessi che dichiarano questi nomi, senza parametro.
    pub fn of(names: &[&str]) -> Self {
        PluginPermissions {
            granted: names
                .iter()
                .fold(crate::options::OptionMap::new(), |m, n| m.on(*n)),
        }
    }

    pub fn has(&self, name: &str) -> bool {
        self.granted.enabled(name)
    }

    /// I permessi che una **feature ufficiale** dichiara: leggere e scrivere il
    /// vault, invocare i comandi del registro, chiamare i servizi degli altri.
    ///
    /// Non è "tutti i permessi", ed è deliberato che non lo sia: la rete, gli
    /// appunti, la camera e il filesystem esterno non li ha nessuna delle
    /// feature di questo repo, e concederli in blocco a chi è di casa
    /// renderebbe il punto di applicazione del §7.3 vero solo per i plugin di
    /// terzi — cioè una regola che non si prova mai dove la si scrive.
    pub fn core() -> Self {
        PluginPermissions::of(&[
            crate::options::permission::READ_VAULT,
            crate::options::permission::WRITE_VAULT,
            crate::options::permission::RUN_COMMAND,
            crate::options::permission::CALL_SERVICE,
            // Le impostazioni (§11.1): c'è perché ha un cliente vero — i comandi
            // `settings.*` di `CoreCommands` — e non per completezza. Concederlo
            // qui non apre niente di per sé: il secondo cancello è **la
            // chiave**, e una chiave che non si è dichiarata scrivibile da un
            // programma resta chiusa anche a chi ha questo permesso.
            crate::options::permission::WRITE_SETTINGS,
            // La sessione (§23.5): entrambi, e con due clienti distinti che è
            // ciò che li giustifica. `read-session` da solo basta all'indice
            // della nota (`fub.outline` segna la sezione del cursore) e ai
            // backlink; `read-selection` lo vuole chi conta le parole di ciò
            // che è selezionato e chi ci costruisce sopra un wikilink.
            crate::options::permission::READ_SESSION,
            crate::options::permission::READ_SELECTION,
        ])
    }
}

/// La versione del contratto che QUESTO abi definisce. È la stessa del
/// `package fub:abi@…` nel WIT (il test di conformità le confronta).
pub const ABI_VERSION: &str = "0.2.0";

// Niente `Eq`: i permessi portano un parametro JSON, e `serde_json::Value` non
// è `Eq` (contiene numeri in virgola mobile). È lo stesso motivo per cui
// `Block::Custom` si ferma a `PartialEq`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    /// La versione del contratto (`fub:abi@X.Y.Z`) contro cui il plugin è
    /// stato scritto. È il punto d'appoggio della promessa "cambi additivi
    /// versionati post-freeze": senza un campo versione fin dal primo
    /// manifest, il campo aggiunto dopo avrebbe lui stesso bisogno di una
    /// versione per essere letto.
    ///
    /// La regola di caricamento è [`abi_compatible`]: si rifiuta una major
    /// diversa, si accetta una minor uguale o inferiore a quella dell'host
    /// (il contratto post-freeze cresce solo per aggiunta).
    pub abi_version: String,
    pub permissions: PluginPermissions,
    /// I **servizi che offre** (§7.5): i `ns` con cui altri plugin lo chiamano
    /// via [`HostServices::call_service`].
    ///
    /// Sta nel manifest e non in un metodo del provider perché l'host deve
    /// poterlo leggere **prima** di montarlo: è ciò con cui risolve le
    /// dipendenze di chi arriva dopo. Ogni nome vale la regola del §7.4 — o è
    /// l'id del plugin, o è dentro di esso.
    #[serde(default)]
    pub provides: Vec<String>,
    /// I servizi di cui **ha bisogno**. Un requisito che nessuno offre non è un
    /// avvertimento: il plugin non si dichiara affatto, e chi lo monta legge
    /// quale requisito manca.
    ///
    /// È la semantica dichiarata della terna del §7.5, ed è quella che non
    /// lascia in piedi uno stato intermedio: un plugin «attivo ma degradato»
    /// è uno stato che nessuno prova e che ogni feature deve poi gestire.
    #[serde(default)]
    pub requires: Vec<String>,
    /// Le **impostazioni che dichiara** (§11.1): chiave, specie, default,
    /// etichetta, gruppo.
    ///
    /// Sta qui e non in un `SettingsProvider` da registrare per la stessa
    /// ragione di `provides`, un passo più in là: la dichiarazione viene prima
    /// di [`Plugin::activate`], e il primo che legge un'impostazione è proprio
    /// un `activate` che deve sapere se la sua feature è accesa. Uno schema
    /// registrato dopo sarebbe uno schema assente nel momento in cui serve.
    ///
    /// Ogni chiave vale la regola del §7.4 come i nomi dei servizi: il core
    /// nomina nudo (`versioning.enabled`), un plugin dentro il proprio id.
    #[serde(default)]
    pub settings: Vec<SettingSpec>,
    /// Le **stringhe che dichiara** (§12.1), una voce per lingua.
    ///
    /// Sta nel manifest per le stesse due ragioni di `settings`, più una terza
    /// che è solo delle stringhe. Le prime due: si legge **prima** di montare —
    /// una palette di comandi mostra i titoli di componenti che nessuno ha
    /// ancora attivato — e un catalogo registrato da
    /// [`Plugin::activate`](crate::traits::Plugin::activate) sarebbe assente
    /// esattamente quando serve. La terza: un catalogo è **dato**, e dato nel
    /// manifest vuol dire che si corregge una traduzione senza ricompilare, e
    /// che a M5 un componente WASM non se lo scrive a build time.
    ///
    /// Le chiavi qui dentro sono **nude**, e questa è la differenza deliberata
    /// dalle chiavi delle impostazioni: quelle vivono in un archivio solo e
    /// devono quindi qualificarsi col nome di chi le dichiara
    /// (`versioning.enabled`); un catalogo appartiene a un componente e basta,
    /// quindi la qualifica è **strutturale** — un plugin non ha nemmeno il modo
    /// di nominare la stringa di un altro.
    #[serde(default)]
    pub strings: Vec<StringCatalog>,
    /// La lingua in cui questo componente è scritto: il penultimo gradino della
    /// scala di [`Strings`](crate::text::Strings), quello che si usa quando la
    /// lingua di chi guarda non ha catalogo.
    ///
    /// Vuoto = nessun ripiego, e si scende dritti alla chiave nuda. È il
    /// default corretto per chi non dichiara stringhe.
    #[serde(default)]
    pub default_locale: String,
    /// Le **sveglie** che dichiara (§22.1, decisione 0069): un nome e ogni
    /// quanto suona.
    ///
    /// Sta nel manifest per la ragione di `settings`, letta su un asse
    /// diverso. Là la dichiarazione doveva precedere
    /// [`Plugin::activate`](crate::traits::Plugin::activate) perché il primo
    /// lettore di un'impostazione è proprio un `activate`; qui perché una
    /// sveglia è ciò che **fa succedere** un evento, non ciò che ne filtra uno.
    /// Una [`EventMask`](crate::event::EventMask) è il posto sbagliato per
    /// definizione: si applica agli eventi che accadono, e un timer che nessuno
    /// ha fatto partire non ne genera nessuno da filtrare — è la ragione per cui
    /// il tentativo ritirato dalla decisione 0063 non trovava un valutatore.
    ///
    /// Ogni nome è **nudo** e vale dentro il componente, come le chiavi di un
    /// catalogo di stringhe: la qualifica è strutturale, ed è
    /// [`Event::TimerFired::owner`](crate::event::Event::TimerFired) a dire di
    /// chi è.
    #[serde(default)]
    pub timers: Vec<TimerSpec>,
    /// I servizi che **usa se c'è** (K1): come [`requires`](Self::requires),
    /// ma se nessuno li offre il componente si monta lo stesso. Un nome che
    /// compare anche in `requires` resta un requisito: `requires` vince.
    #[serde(default)]
    pub uses: Vec<String>,
    /// Di che tipo è il componente (K1). Il default è [`ComponentKind::Mode`].
    #[serde(default)]
    pub kind: ComponentKind,
    /// Come arriva (K1, ADR 0233): incluso, in un'edizione, o da scaricare.
    /// Niente librerie caricate a runtime: il livello 3 sono le edizioni.
    #[serde(default)]
    pub delivery: Delivery,
    /// I pezzi del client che il componente carica (K1): chunk Vite, come
    /// percorsi sotto `apps/client/src/` (es. `editors/rich`).
    #[serde(default)]
    pub ui: Vec<String>,
    /// Il gruppo della pagina dei componenti (K1): `scrivere`, `leggere`,
    /// `pensare`, `disegnare`, `foto`, `ufficio`, `altro`, `supporto`.
    /// Assente = nessun gruppo dichiarato.
    #[serde(default)]
    pub group: Option<String>,
}

/// Di che tipo è un componente (K1). L'ordine dei casi è il discriminante
/// dell'ABI: un caso nuovo va in coda.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentKind {
    /// Un modo di lavorare (scrivere, leggere, disegnare…): il default.
    #[default]
    Mode,
    /// Un motore che altri componenti usano.
    Engine,
    /// Un servizio di supporto.
    Service,
    /// Dati (dizionari, modelli, cataloghi).
    Data,
}

/// Come arriva un componente (K1, ADR 0233). L'ordine dei casi è il
/// discriminante dell'ABI: un caso nuovo va in coda.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Delivery {
    /// Dentro il binario che gira: il default.
    #[default]
    Included,
    /// In un'edizione dell'app (il livello 3 dell'ADR 0233): non si carica a
    /// runtime, si installa l'edizione che lo contiene.
    Edition { name: String },
    /// Da scaricare: l'indirizzo, l'impronta SHA-256 (64 cifre esadecimali) e
    /// la dimensione in byte (mai 0).
    Download {
        url: String,
        sha256: String,
        bytes: u64,
    },
}

/// Una sveglia dichiarata da un componente (§22.1, decisione 0069).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimerSpec {
    /// Il nome, nudo: viaggia in
    /// [`Event::TimerFired::timer`](crate::event::Event::TimerFired) e serve a
    /// chi ha dichiarato più di una sveglia per distinguerle.
    pub id: String,
    pub schedule: TimerSchedule,
}

/// Ogni quanto suona una sveglia (§22.1, decisione 0069; §22.4, decisione 0091).
///
/// **Due famiglie, e la differenza non è di comodo.** `Every` e `After` si
/// misurano in *tempo trascorso*: la loro regola è pura e sta tutta in
/// [`nth_after`](TimerSchedule::nth_after), che non ha bisogno di sapere che ore
/// sono. `AtWallClock` si misura in *ora civile*: quanti secondi manchino alle
/// nove dipende da che ore sono adesso, e nessuna funzione che non lo riceva lo
/// può calcolare. La regola di questa seconda famiglia esiste lo stesso e sta
/// lo stesso nel contratto — è [`WallClock::next_after`], che riceve l'ora
/// civile invece di leggerla — e per questo `nth_after` risponde `None` a un
/// orario di parete: non è «non suona più», è *questa non è la sua regola*, e il
/// suo doc lo dice.
///
/// Il caso nuovo è **in coda**, e non «dove starebbe meglio»: l'ordine dei casi
/// è il discriminante dell'ABI
/// ([0088](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)),
/// quindi additivo vuol dire in fondo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TimerSchedule {
    /// Suona ogni `seconds` secondi, per sempre, a partire dalla
    /// registrazione del componente.
    Every { seconds: u64 },
    /// Suona **una volta sola**, `seconds` secondi dopo la registrazione.
    After { seconds: u64 },
    /// Suona a un **orario di parete** (§22.4, decisione 0091): «ogni giorno
    /// alle 9», «il lunedì alle 7:30».
    AtWallClock(WallClock),
}

impl TimerSchedule {
    /// Fra quanti secondi dalla registrazione suona la `n`-esima volta
    /// (`n` a partire da 0)? `None` = non suona più.
    ///
    /// È la regola della famiglia che si misura in **tempo trascorso**, e sta
    /// nel contratto perché chi implementa lo scheduler la applichi invece di
    /// avere la propria idea di cosa voglia dire «ogni ora», che è il modo in
    /// cui due host finirebbero per suonare in due momenti diversi.
    ///
    /// **Per un [`AtWallClock`](TimerSchedule::AtWallClock) risponde `None`, e
    /// non vuol dire che non suona.** Vuol dire che la sua regola è un'altra —
    /// [`WallClock::next_after`] — perché di questa firma manca l'ingrediente:
    /// quanti secondi manchino alle nove non è una funzione di *quante volte ha
    /// già suonato*, è una funzione di *che ore sono adesso*. Chi implementa uno
    /// scheduler distingue le due famiglie con
    /// [`wall_clock`](TimerSchedule::wall_clock), che è la domanda fatta apposta
    /// per non doverlo dedurre da un `None`.
    pub fn nth_after(&self, n: u64) -> Option<u64> {
        match *self {
            TimerSchedule::Every { seconds } => seconds.max(1).checked_mul(n.checked_add(1)?),
            TimerSchedule::After { seconds } if n == 0 => Some(seconds),
            TimerSchedule::After { .. } => None,
            TimerSchedule::AtWallClock(_) => None,
        }
    }

    /// L'orario di parete, se è di quella famiglia.
    ///
    /// Esiste perché uno scheduler non debba distinguere le due famiglie da un
    /// `None` di [`nth_after`](TimerSchedule::nth_after): un `None` è già la
    /// risposta di un `After` che ha finito, e due significati sullo stesso
    /// valore sono il modo in cui una sveglia smette di suonare senza che
    /// nessuno abbia scritto una riga sbagliata.
    pub fn wall_clock(&self) -> Option<&WallClock> {
        match self {
            TimerSchedule::AtWallClock(w) => Some(w),
            _ => None,
        }
    }
}

/// Una sveglia a **orario di parete** (§22.4, decisione 0091).
///
/// «Ogni giorno alle 9» non è «ogni 86400 secondi»: l'una segue il calendario di
/// chi la legge — e quindi il suo fuso e la sua ora legale — l'altra no.
///
/// **L'orario è in due interi e non in una stringa `"09:00"`**: una stringa
/// vuole un parser al confine, e con lui un modo di fallire che nessuno sa dove
/// mettere — un manifest si legge quando il componente si registra, e «l'orario
/// non si capisce» diventerebbe un errore di registrazione per un campo che
/// avrebbe potuto non essere sbagliabile. Due interi si controllano dove si
/// leggono.
///
/// **Un caso solo per «ogni giorno» e «il lunedì»**, con [`days`](Self::days)
/// vuoto a dire *ogni giorno*: un `Daily` e un `Weekly` separati sarebbero due
/// casi del `variant` con la stessa aritmetica dentro, e il secondo si
/// distinguerebbe dal primo solo per un campo in più.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WallClock {
    /// L'ora, `0..=23`. Fuori scala la sveglia non suona: vedi
    /// [`valid`](Self::valid).
    pub hour: u8,
    /// I minuti, `0..=59`.
    pub minute: u8,
    /// In che giorni. **Vuoto = ogni giorno.**
    #[serde(default)]
    pub days: Vec<Weekday>,
    /// Il fuso in cui leggere [`hour`](Self::hour), come nome IANA
    /// (`Europe/Rome`). **Assente = il fuso della macchina** — cioè quello del
    /// sistema, salvo l'impostazione `timers.zone` che lo sovrascrive per questa
    /// macchina.
    ///
    /// I due stati sono due significati diversi, e la ragione per cui il campo
    /// c'è. Assente vuol dire *quando chi guarda lo schermo comincia a
    /// lavorare*: un portatile portato a Tokyo suona alle 9 di Tokyo, ed è il
    /// caso normale. Presente vuol dire *ancorato a un posto*: «il digest delle
    /// 9 dell'ufficio di Roma» resta delle 9 di Roma anche per chi lo legge
    /// altrove — che è ciò che un vault condiviso fra persone in due paesi vuole
    /// poter dire, e che un fuso implicito non sa esprimere.
    ///
    /// Un nome che il database dei fusi non conosce **non fa suonare la
    /// sveglia**, e non ripiega su UTC: un ripiego silenzioso è la specie di
    /// bugia che la [0077] rifiuta nel registro dei comandi — la dichiarazione
    /// sarebbe onorata da un'altra sveglia, all'ora sbagliata, senza che nessuno
    /// se ne accorga.
    ///
    /// [0077]: ../../../docs/decisions/README.md
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zone: Option<String>,
    /// Quanto tardi è ancora utile suonare, in secondi. **`0` = mai.**
    ///
    /// **Non è il campo dell'ora legale**, ed è la cosa che questa decisione ha
    /// scoperto misurando: l'ora legale non ne vuole uno, perché a lei
    /// rispondono due *regole* — quelle qui sotto — e restava scoperta un'altra
    /// domanda, che la voce non aveva fatto. Un'occorrenza può essere passata
    /// senza che nessuno la suonasse perché la macchina dormiva, perché il pool
    /// era occupato, perché l'app era chiusa. La domanda utile non è
    /// *si recupera?* ma *fino a quanto tardi ha ancora senso*: un promemoria
    /// delle 9 alle 17 non serve più (`0`), un backup notturno in ritardo di
    /// venti minuti va fatto lo stesso (`3600`).
    ///
    /// Un intero al posto di una bandiera **risolve da sé la macchina che dorme
    /// due giorni**: quelle occorrenze cadono fuori da qualunque finestra
    /// sensata e non suonano — invece di suonare due volte, che è la risposta
    /// che nessuno vuole e che un `catch-up: bool` avrebbe dato.
    ///
    /// # Le due regole dell'ora legale, che non sono campi
    ///
    /// **Un'ora che non esiste si sposta in avanti** della durata del salto: la
    /// domenica in cui l'ora legale entra, una sveglia delle 2:30 suona alle
    /// 3:30. È la disambiguazione *compatible* di RFC 5545, cioè ciò che fa ogni
    /// calendario, e vuol dire che la sveglia non perde mai un giorno.
    ///
    /// **Un'ora che esiste due volte suona alla prima.** Discende
    /// dall'invariante e non da una scelta: al più *una* suonata per occorrenza,
    /// sempre, perché **un'occorrenza è la sua data civile e non il suo
    /// istante**. La domenica in cui l'ora legale esce, le 2:30 che accadono due
    /// volte sono una sola data civile.
    #[serde(default)]
    pub catch_up_seconds: u64,
}

impl WallClock {
    /// Ogni giorno a quest'ora, nel fuso della macchina, senza recupero.
    pub fn daily(hour: u8, minute: u8) -> Self {
        WallClock {
            hour,
            minute,
            days: Vec::new(),
            zone: None,
            catch_up_seconds: 0,
        }
    }

    /// Solo in questi giorni.
    pub fn on(mut self, days: impl IntoIterator<Item = Weekday>) -> Self {
        self.days = days.into_iter().collect();
        self
    }

    /// In questo fuso, per nome IANA, invece che in quello della macchina.
    pub fn anchored(mut self, zone: impl Into<String>) -> Self {
        self.zone = Some(zone.into());
        self
    }

    /// Con questa finestra di recupero.
    pub fn catching_up(mut self, seconds: u64) -> Self {
        self.catch_up_seconds = seconds;
        self
    }

    /// L'orario è scrivibile su un orologio?
    ///
    /// Un orario fuori scala non è un errore di registrazione ed è deliberato:
    /// il manifest si legge quando il componente entra, e rifiutare un
    /// componente intero per una sveglia storta sarebbe una punizione
    /// sproporzionata. Non suona, e non suona **in modo osservabile** — chi
    /// implementa uno scheduler chiama questa funzione e sa perché.
    pub fn valid(&self) -> bool {
        self.hour < 24 && self.minute < 60
    }

    /// Il giorno è fra quelli dichiarati? (elenco vuoto = ogni giorno)
    pub fn falls_on(&self, day: Weekday) -> bool {
        self.days.is_empty() || self.days.contains(&day)
    }

    /// **La regola.** La prima occorrenza *strettamente dopo* `now`, in ora
    /// civile locale; `None` se non ne esiste nessuna.
    ///
    /// È pura come [`TimerSchedule::nth_after`] ed è nel contratto per la stessa
    /// ragione — due host non devono avere due idee di quando siano le nove del
    /// prossimo lunedì — ma riceve l'ora civile invece di riceverne il
    /// trascorso: è l'ingrediente che alla firma sorella manca, ed è tutto ciò
    /// che serve perché anche questa famiglia abbia la sua regola qui dentro.
    ///
    /// **Il calendario finisce qui, il fuso no.** Questa funzione lavora su ore
    /// civili e non sa cosa sia un fuso: convertire un'ora civile nell'istante
    /// in cui accade — e decidere cosa fare dell'ora che l'ora legale cancella o
    /// raddoppia — è di chi possiede l'orologio, cioè dell'host. Il contratto
    /// dice *quali* occorrenze esistono, l'host dice *quando* accadono.
    pub fn next_after(&self, now: CivilTime) -> Option<CivilTime> {
        if !self.valid() {
            return None;
        }
        let today = CivilTime {
            hour: self.hour,
            minute: self.minute,
            second: 0,
            ..now
        };
        let first = if today > now { today } else { today.next_day() };
        // Al più otto giorni: sette coprono ogni elenco non vuoto, e l'ottavo
        // esiste solo perché il primo candidato può essere già domani.
        let mut c = first;
        for _ in 0..8 {
            if self.falls_on(c.weekday()) {
                return Some(c);
            }
            c = c.next_day();
        }
        None
    }

    /// L'ultima occorrenza **a `now` o prima**, in ora civile locale.
    ///
    /// È la metà della regola che serve al recupero: senza di lei uno scheduler
    /// che si sveglia in ritardo sa solo qual è la prossima, e non ha modo di
    /// sapere se ne ha appena persa una — cioè
    /// [`catch_up_seconds`](Self::catch_up_seconds) non sarebbe onorabile, e un
    /// campo dichiarato e non onorato è peggio di un campo assente.
    pub fn latest_upto(&self, now: CivilTime) -> Option<CivilTime> {
        if !self.valid() {
            return None;
        }
        let today = CivilTime {
            hour: self.hour,
            minute: self.minute,
            second: 0,
            ..now
        };
        let first = if today <= now {
            today
        } else {
            today.prev_day()
        };
        let mut c = first;
        for _ in 0..8 {
            if self.falls_on(c.weekday()) {
                return Some(c);
            }
            c = c.prev_day();
        }
        None
    }
}

/// Un'**ora civile**: ciò che si legge su un calendario appeso al muro, senza
/// fuso e senza offset (§22.4, decisione 0091).
///
/// Non attraversa il confine e non sta nel WIT: è l'ingrediente della regola,
/// come `n` lo è di [`TimerSchedule::nth_after`]. Chi possiede l'orologio la
/// costruisce dal proprio istante e la riconverte in un istante; chi applica la
/// regola non ha bisogno d'altro.
///
/// **Il confronto è l'ordine cronologico**, ed è la ragione dell'ordine dei
/// campi: `derive(PartialOrd)` confronta in ordine di dichiarazione, e dall'anno
/// al secondo quello è esattamente l'ordine del tempo.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CivilTime {
    pub year: i32,
    /// `1..=12`.
    pub month: u8,
    /// `1..=31`.
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

impl CivilTime {
    /// Il giorno della settimana, dal calendario gregoriano proplettico.
    pub fn weekday(&self) -> Weekday {
        // Giorni dal 1970-01-01, che era un giovedì.
        let d = self.days_from_epoch().rem_euclid(7);
        match (d + 3) % 7 {
            0 => Weekday::Monday,
            1 => Weekday::Tuesday,
            2 => Weekday::Wednesday,
            3 => Weekday::Thursday,
            4 => Weekday::Friday,
            5 => Weekday::Saturday,
            _ => Weekday::Sunday,
        }
    }

    /// Stessa ora, il giorno dopo.
    pub fn next_day(self) -> Self {
        Self::from_days(self.days_from_epoch() + 1, self)
    }

    /// Stessa ora, il giorno prima.
    pub fn prev_day(self) -> Self {
        Self::from_days(self.days_from_epoch() - 1, self)
    }

    /// I giorni dal 1970-01-01 (algoritmo *days from civil* di Howard Hinnant).
    fn days_from_epoch(&self) -> i64 {
        let y = self.year as i64 - i64::from(self.month <= 2);
        let was = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - was * 400;
        let m = self.month as i64;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + self.day as i64 - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        was * 146_097 + doe - 719_468
    }

    /// L'inverso, tenendo l'ora di `time_of_the_day`.
    fn from_days(days: i64, time_of_the_day: Self) -> Self {
        let z = days + 719_468;
        let was = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = z - was * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
        let y = yoe + was * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        CivilTime {
            year: (y + i64::from(m <= 2)) as i32,
            month: m as u8,
            day: d as u8,
            ..time_of_the_day
        }
    }
}

impl PluginManifest {
    /// Un manifest **senza permessi**: id, nome, e la versione di ABI con cui è
    /// compilato.
    ///
    /// Il default è nessun permesso, e non è pigrizia: un plugin che non
    /// dichiara niente non deve poter fare niente, o dichiarare smetterebbe di
    /// essere ciò che apre le porte. I permessi si aggiungono con
    /// [`granting`](PluginManifest::granting).
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        PluginManifest {
            id: id.into(),
            name: name.into(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            abi_version: ABI_VERSION.to_string(),
            permissions: PluginPermissions::default(),
            provides: Vec::new(),
            requires: Vec::new(),
            settings: Vec::new(),
            strings: Vec::new(),
            default_locale: String::new(),
            timers: Vec::new(),
            uses: Vec::new(),
            kind: ComponentKind::Mode,
            delivery: Delivery::Included,
            ui: Vec::new(),
            group: None,
        }
    }

    /// Le sveglie che questo componente dichiara (§22.1).
    pub fn waking(mut self, timers: Vec<TimerSpec>) -> Self {
        self.timers = timers;
        self
    }

    /// Le impostazioni che questo plugin dichiara (§11.1).
    pub fn configuring(mut self, settings: Vec<SettingSpec>) -> Self {
        self.settings = settings;
        self
    }

    /// Le stringhe che questo plugin dichiara (§12.1), con la lingua in cui è
    /// scritto.
    ///
    /// Le due cose insieme e non in due metodi: un catalogo senza lingua di
    /// ripiego è la metà che si dimentica, e si dimentica in silenzio — le
    /// chiavi restano nude solo per chi legge in un'altra lingua.
    pub fn speaking(
        mut self,
        default_locale: impl Into<String>,
        strings: Vec<StringCatalog>,
    ) -> Self {
        self.default_locale = default_locale.into();
        self.strings = strings;
        self
    }

    /// I servizi che questo plugin offre (§7.5).
    pub fn providing(mut self, services: &[&str]) -> Self {
        self.provides = services.iter().map(|s| s.to_string()).collect();
        self
    }

    /// I servizi di cui questo plugin ha bisogno per essere montato.
    pub fn requiring(mut self, services: &[&str]) -> Self {
        self.requires = services.iter().map(|s| s.to_string()).collect();
        self
    }

    /// I permessi che questo manifest dichiara.
    pub fn granting(mut self, permissions: PluginPermissions) -> Self {
        self.permissions = permissions;
        self
    }

    /// Il manifest di una **feature ufficiale** di questo repo: la versione del
    /// contratto è quella con cui è compilata, i permessi sono quelli di
    /// [`PluginPermissions::core`].
    ///
    /// Esiste perché dal §7.3 il kernel non registra più provider intestati a
    /// una stringa: chi registra si dichiara, e una feature che sta nello
    /// stesso binario deve dichiararsi come si dichiarerà un plugin — con le
    /// stesse informazioni, o il punto di applicazione lo si proverebbe solo
    /// contro chi non esiste ancora.
    pub fn core(id: impl Into<String>, name: impl Into<String>) -> Self {
        PluginManifest::new(id, name).granting(PluginPermissions::core())
    }
}

/// Un plugin che dichiara `declared` può girare su un host che parla
/// [`ABI_VERSION`]?
///
/// La regola del freeze (M4): **major diversa → rifiuto** (il contratto è
/// cambiato in modo incompatibile); **minor del plugin ≤ minor dell'host →
/// accetto** (post-freeze il contratto cresce solo per aggiunta, quindi un
/// host più nuovo serve ogni plugin più vecchio); minor del plugin maggiore →
/// rifiuto (il plugin usa cose che questo host non ha). La patch non conta.
/// Una versione che non parsa si rifiuta: meglio un no chiaro che un runtime
/// a sorpresa.
pub fn abi_compatible(declared: &str) -> bool {
    fn canonical_number(segment: &str) -> Option<u64> {
        if segment.is_empty()
            || (segment.len() > 1 && segment.starts_with('0'))
            || !segment.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        segment.parse().ok()
    }

    fn major_minor(v: &str) -> Option<(u64, u64)> {
        let mut parts = v.split('.');
        let major = canonical_number(parts.next()?)?;
        let minor = canonical_number(parts.next()?)?;
        canonical_number(parts.next()?)?;
        if parts.next().is_some() {
            return None;
        }
        Some((major, minor))
    }

    match (major_minor(declared), major_minor(ABI_VERSION)) {
        (Some((dmaj, dmin)), Some((hmaj, hmin))) => dmaj == hmaj && dmin <= hmin,
        _ => false,
    }
}

pub trait Plugin: Send + Sync {
    fn manifest(&self) -> PluginManifest;
    fn activate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    fn deactivate(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError>;
    /// Corpo di un job richiesto via [`HostEvents::spawn_job`]: eseguito
    /// dall'host **fuori** dal giro sincrono del kernel (a M5 su un'istanza
    /// separata del componente), con le stesse capacità che il plugin ha
    /// altrove. Default: nessun job supportato.
    ///
    /// Fino alla decisione 0027 questa firma non aveva l'`host`, e il job era
    /// dichiarato «puro rispetto al vault»: input nel `payload`, output nel
    /// risultato. Per un calcolo puro era la firma giusta e resta disponibile —
    /// chi non tocca l'`host` scrive lo stesso job di prima. Per tutto il resto
    /// era il divieto di esistere: import, export, sync, backup, embedding, OCR,
    /// reindicizzazione e web clipper camminano il vault, e l'unico posto in cui
    /// potevano girare era l'unico che non lo vedeva.
    ///
    /// # Ciò che questo host è, e ciò che non è
    ///
    /// È l'`HostApi` di sempre, con davanti la politica del plugin (§7.3): un
    /// job di chi non ha `write_vault` riceve gli stessi rifiuti che riceve il
    /// suo `handle`. **Non** è uno snapshot, e la differenza va detta perché è
    /// l'unica cosa che si comporta diversamente dal giro sincrono:
    ///
    /// - **Il vault si vede per chiamata, non per job.** Ogni capacità prende il
    ///   prestito del workspace, fa il suo lavoro e lo rilascia. Fra due
    ///   chiamate il vault può cambiare — l'utente che salva, il watcher che
    ///   vede una scrittura altrui, un altro job — e chi cammina il vault vedrà
    ///   qualcosa che non è mai stato vero tutto insieme. È il prezzo di non
    ///   tenere fermo il vault per la durata di un lavoro lungo, ed è il verso
    ///   giusto in cui pagarlo: l'alternativa è un'app che si blocca per la
    ///   durata di un export.
    /// - **Contro quel cambio la guardia esiste già, ed è la stessa di tutti.**
    ///   Chi scrive un pezzo passa da [`VaultWrite::apply_edit`] con la `base`
    ///   che [`VaultRead::document_revision`] gli ha dato, e riceve
    ///   [`PluginError::Conflict`] se qualcuno è arrivato prima; chi crea passa
    ///   da [`VaultStructure::create_document`], che rifiuta un path occupato.
    ///   La decisione 0008 aveva scritto che una base omessa la si omette
    ///   «proprio nel caso lungo (l'automazione che calcola per un minuto), che
    ///   è l'unico in cui serve»: questa è quell'automazione.
    /// - **Un job non è una transazione e non è un lotto.** N scritture sono N
    ///   scritture, con N eventi, e nessuno le annulla se la terza fallisce. Il
    ///   lotto (decisione 0011) copre ciò che accade dentro **una** chiamata del
    ///   kernel; un job dura più di una chiamata per definizione.
    /// - **Chi esegue non tiene niente in mano.** L'host chiama `run_job` senza
    ///   nessun prestito del workspace aperto — altrimenti la prima capacità che
    ///   il job usa aspetterebbe chi l'ha chiamato, per sempre.
    ///
    /// L'esito torna comunque come
    /// [`Event::JobDone`](crate::Event::JobDone) sul giro sincrono: ciò che il
    /// job restituisce è il suo **risultato**, non più il suo unico effetto.
    fn run_job(
        &self,
        job: &str,
        payload: serde_json::Value,
        host: &mut dyn HostApi,
    ) -> Result<serde_json::Value, PluginError> {
        let (_, _) = (payload, host);
        Err(PluginError::UnknownJob(job.to_string().into()))
    }
}
