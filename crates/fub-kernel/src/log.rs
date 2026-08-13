//! **Il log: ciò che va storto per chi sviluppa** (§17.3).
//!
//! Questo modulo è metà di una coppia. L'altra metà è
//! [`Event::Trouble`](fub_abi::event::Event::Trouble)
//! ([decisione 0052](../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md)),
//! che porta a chi *legge* le note ciò che ha perso; questo porta a chi *scrive*
//! Fub ciò che è successo. Le due destinazioni non si scelgono a occhio: il
//! criterio sta nella [decisione 0062](../../../docs/decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md),
//! e in una riga sola è *il log è il pavimento, l'evento è la porta* — ogni
//! guasto lascia una riga qui, e solo quelli che raccontano una **perdita**
//! aprono anche la porta.
//!
//! # Perché `tracing` e non un `log!` scritto in casa
//!
//! Perché non siamo i soli a parlare. `tracing` è **già nell'albero** — 0.1.44,
//! tirato da tauri — e con lui ci sono i suoi emittenti: tauri, wry, e ciò che
//! si portano dietro. Un `log!` nostro avrebbe raccolto solo le nostre righe, e
//! il giorno che una finestra non si apre la riga che lo spiega sarebbe stata
//! l'unica a mancare. Prenderlo come dipendenza **diretta** non aggiunge un
//! albero nuovo: aggiunge un nome in un `Cargo.toml` che descrive una cosa che
//! c'era già.
//!
//! # Perché il collettore invece è scritto in casa
//!
//! `tracing-subscriber` **non** è nell'albero, e portarlo dentro costa almeno
//! quattro crate nuovi (`tracing-subscriber`, `sharded-slab`, `thread_local`,
//! `tracing-log`) più `matchers` e un motore di regex se si vuole `env-filter`
//! — che è precisamente la cosa che **non** vogliamo: la
//! [decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)
//! ha tolto la configurazione dalle variabili d'ambiente, e `RUST_LOG` sarebbe
//! stata la terza rientrata dalla finestra. Ciò che resta di
//! `tracing-subscriber` una volta tolto il filtro da variabile d'ambiente è un
//! formattatore, e il formattatore lo vogliamo nostro comunque: una riga di log
//! di Fub è prosa italiana come tutto il resto. È lo stesso conto che
//! [`crate::config`-di-`fub-host`](../../fub_host/config/index.html) ha già
//! fatto per `dirs`, e la stessa risposta.
//!
//! # Cosa questo collettore **non** fa
//!
//! **Gli span**: li accetta e li butta. Non ne apriamo nessuno, e quelli che
//! arrivano da tauri direbbero a chi legge dove si trovava tauri, non dove si
//! trovava Fub. Gli **eventi** dentro quegli span invece si scrivono: è la metà
//! che serve. Il giorno che un lavoro lungo (0035) volesse comparire nel log
//! come un blocco con dentro le sue righe, gli span diventano il modo di
//! ottenerlo e questo è il posto dove si aggiungono.
//!
//! **`max_level_hint`**: torna `None`, ed è una scelta. Un hint viene **messo
//! in cache** da `tracing` al primo callsite, e il livello di Fub si può
//! cambiare dal pannello delle impostazioni mentre l'app gira: un hint
//! accurato avrebbe congelato al primo avvio la risposta a una domanda che
//! l'utente può rifare. Il prezzo è che ogni callsite chiama [`enabled`], che
//! è un `load` atomico.
//!
//! [`enabled`]: Levels::enabled

use crate::veleno::{Ricovero, RicoveroCondiviso};
use camino::{Utf8Path, Utf8PathBuf};
use std::fmt::Write as _;
use std::io::Write as _;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

/// I gradini del log, dal silenzio al racconto di tutto.
///
/// Sono sei perché il sesto è [`Off`](Level::Off), che `tracing::Level` non ha:
/// là il silenzio è l'assenza di un filtro e qui è un valore, perché deve poter
/// essere ciò che una persona sceglie da una tendina. Gli altri cinque sono i
/// suoi, uno a uno, e non per pigrizia: chi legge una riga di log di Fub sta
/// leggendo anche righe di tauri, e due scale diverse nello stesso file
/// sarebbero due scale che nessuno può confrontare.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    /// Non si scrive niente. Non è il default, ed è deliberato: vedi
    /// [`Level::default`].
    Off = 0,
    /// Qualcosa è fallito.
    Error = 1,
    /// Qualcosa è andato storto ma il lavoro è continuato.
    Warn = 2,
    /// Un fatto che si vorrà sapere dopo, senza che niente sia andato storto —
    /// una potatura riuscita, una riconciliazione, un indice ricostruito.
    Info = 3,
    /// Il dettaglio che serve quando si sta cercando un difetto.
    Debug = 4,
    /// Tutto.
    Trace = 5,
}

impl Level {
    /// Il nome con cui la si scrive nelle impostazioni e nel file.
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Off => "off",
            Level::Error => "error",
            Level::Warn => "warn",
            Level::Info => "info",
            Level::Debug => "debug",
            Level::Trace => "trace",
        }
    }

    /// Tutti i gradini, nell'ordine in cui una tendina li mostra.
    pub const ALL: [Level; 6] = [
        Level::Off,
        Level::Error,
        Level::Warn,
        Level::Info,
        Level::Debug,
        Level::Trace,
    ];

    /// Dal nome scritto in un file di impostazioni. `None` se quel nome non è
    /// un gradino — e chi lo riceve **non indovina**: scende al default, che è
    /// la regola che [`crate::settings`] applica a ogni valore che non regge il
    /// suo schema.
    pub fn parse(s: &str) -> Option<Level> {
        Level::ALL.into_iter().find(|l| l.as_str() == s)
    }

    fn from_tracing(level: &tracing::Level) -> Level {
        match *level {
            tracing::Level::ERROR => Level::Error,
            tracing::Level::WARN => Level::Warn,
            tracing::Level::INFO => Level::Info,
            tracing::Level::DEBUG => Level::Debug,
            tracing::Level::TRACE => Level::Trace,
        }
    }
}

impl Default for Level {
    /// [`Info`](Level::Info), e non `Warn`.
    ///
    /// La domanda a cui il default risponde non è «quanto rumore tolleri»: è
    /// «cosa vuoi trovare nel file il giorno che qualcuno ti scrive che una
    /// versione è sparita». La risposta è la riga che dice *l'ho potata io, per
    /// la fascia di ritenzione* — che è un `Info`, perché niente è andato
    /// storto. Un default a `Warn` avrebbe tenuto solo i guasti, cioè
    /// esattamente le righe che l'utente ha **già** visto passare dal centro
    /// notifiche, e buttato quelle che spiegano ciò che non ha visto.
    ///
    /// Il volume lo permette: i punti che scrivono sono ventisei, e nessuno di
    /// loro sta dentro un ciclo.
    fn default() -> Level {
        Level::Info
    }
}

/// **Quanto si scrive, e per chi.**
///
/// Vive dietro un [`Arc`] perché ha due proprietari con due tempi diversi: il
/// collettore, che la legge a ogni callsite, e le impostazioni, che la
/// riscrivono quando qualcuno muove la tendina. Il livello si cambia **mentre
/// l'app gira** — che è il solo modo in cui un log serve a chi sta guardando un
/// difetto adesso: chiedere un riavvio vorrebbe dire chiedere di riprodurre.
#[derive(Debug)]
pub struct Levels {
    global: AtomicU8,
    /// I target che si scrivono fino a [`Level::Debug`] comunque, qualunque sia
    /// il livello globale.
    ///
    /// È una **lista di id**, non una mappa da id a livello, e la forma è presa
    /// da `plugins.disabled` ([decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)):
    /// una mappa avrebbe voluto dire `fub.versioning=debug` dentro una stringa,
    /// cioè un formato dentro un formato — la cosa che `vaults.json` esiste per
    /// non fare. La domanda vera che qualcuno si pone è *voglio vedere tutto di
    /// questo componente*, e ha una risposta booleana.
    ///
    /// Sta in un [`RicoveroCondiviso`] e non in un `RwLock` nudo perché **questo è il
    /// filtro di ogni callsite di `tracing`**: un `expect` qui trasformerebbe un
    /// panico avvenuto altrove in un panico su *ogni riga di log successiva*,
    /// cioè nel canale con cui ogni altro guasto si racconta. Vedi
    /// [`crate::veleno`], e [`FileSink`] per l'altra metà della stessa strada.
    verbose: RicoveroCondiviso<Vec<String>>,
}

impl Default for Levels {
    fn default() -> Levels {
        Levels {
            global: AtomicU8::new(Level::default() as u8),
            verbose: RicoveroCondiviso::new(Vec::new()),
        }
    }
}

impl Levels {
    /// Il livello globale adesso.
    pub fn global(&self) -> Level {
        match self.global.load(Ordering::Relaxed) {
            0 => Level::Off,
            1 => Level::Error,
            2 => Level::Warn,
            3 => Level::Info,
            4 => Level::Debug,
            _ => Level::Trace,
        }
    }

    /// Cambia il livello globale. La chiama chi legge le impostazioni.
    pub fn set_global(&self, level: Level) {
        self.global.store(level as u8, Ordering::Relaxed);
    }

    /// Sostituisce l'elenco dei target verbosi.
    pub fn set_verbose(&self, targets: Vec<String>) {
        *self.verbose.scrivi() = targets;
    }

    /// L'elenco dei target verbosi adesso.
    pub fn verbose(&self) -> Vec<String> {
        self.verbose.leggi().clone()
    }

    /// **Si scrive questa riga?**
    ///
    /// Il globale decide per tutti; un target verboso alza la propria soglia a
    /// [`Debug`](Level::Debug) e **non la abbassa mai**. Che non la abbassi è la
    /// riga che conta: se il globale è a `Trace` e qualcuno ha chiesto di essere
    /// verboso, sarebbe assurdo che chiederlo *tolga* righe. «Verboso» vuol dire
    /// *almeno*, mai *esattamente*.
    pub fn enabled(&self, target: &str, level: Level) -> bool {
        if level as u8 <= self.global.load(Ordering::Relaxed) {
            return true;
        }
        if level > Level::Debug {
            return false;
        }
        self.verbose.leggi().iter().any(|t| t == target)
    }
}

/// **Dove finisce una riga di log.**
///
/// Un trait e non un `File` perché i clienti sono tre e uno solo è un file: il
/// file dell'app, `stderr` di chi non ha un posto dove scrivere, e la memoria
/// di un test. Il terzo è la ragione per cui esiste: senza di lui l'unico modo
/// di provare che una riga è stata scritta sarebbe leggere un file dal disco
/// dentro un test, cioè presidiare il filesystem invece del collettore.
pub trait Sink: Send + Sync + std::fmt::Debug {
    /// Scrive una riga già composta, **senza** l'a capo finale.
    fn write_line(&self, line: &str);
}

/// Il posto dove si scrive quando non c'è un posto dove scrivere.
///
/// È l'unico `stderr` rimasto in Fub, ed è qui apposta: un ambiente senza
/// `HOME` non ha una cartella di configurazione ([`fub_host::config`] torna
/// `None`) e quindi non ha un file di log. Buttare le righe sarebbe stato
/// peggio, e in quel caso `stderr` è precisamente il canale giusto — non c'è
/// nessun altro.
#[derive(Debug)]
pub struct StderrSink;

impl Sink for StderrSink {
    fn write_line(&self, line: &str) {
        let mut err = std::io::stderr().lock();
        let _ = writeln!(err, "{line}");
    }
}

/// Il file di log, con **una** generazione di storico.
///
/// Quando il file supera [`ROTATE_AT`] prende il posto di `<nome>.1` e ne
/// ricomincia uno vuoto. Una generazione sola, e non cinque: il cliente di
/// questo file è il bundle diagnostico (§15.2), che lo allega a una
/// segnalazione — e ciò che serve a una segnalazione è *poco fa*, non *il mese
/// scorso*. Cinque generazioni sarebbero state cinque volte il disco per una
/// domanda che nessuno ha posto.
///
/// # E se il lucchetto del file si avvelena
///
/// È il caso peggiore di tutto il repo, e non per il file: **questo è il canale
/// con cui ogni altro guasto si denuncia.** Un `.expect` qui vorrebbe dire che
/// un panico avvenuto una volta sola dentro `write_line` trasforma ogni riga di
/// log successiva in un panico — e la 0126 denuncia un bus avvelenato *con una
/// riga di log*, la 0120 fa lo stesso per una custodia. Il meccanismo con cui i
/// guasti si raccontano si toglierebbe di mezzo per primo, e ciò che resta è un
/// guasto muto.
///
/// Quindi il lucchetto è un [`Ricovero`]: ci si riprende. Ciò che protegge è un
/// file aperto e un contatore di byte — al peggio manca l'ultimo incremento, e
/// una rotazione arriva una riga tardi.
///
/// **Dove si denuncia che è morto il canale con cui si denuncia?** Non con
/// `tracing::error!`, che da qui rientrerebbe in questo stesso `write_line` sullo
/// stesso thread: un cerchio, e con un prestito esclusivo già preso, un blocco.
/// Si denuncia **nel file, direttamente**, con la guardia già in mano e saltando
/// il collettore — è la sola strada che esce dal cerchio. Se il file non è
/// aperto la riga si perde, e resta il conto di [`Ricovero::denunce`]: è meno,
/// ma è osservabile da qualcuno.
///
/// # E se il file sparisce da sotto
///
/// Un descrittore aperto in append non segue il nome: segue il file. Chi
/// cancella `fub.log` da fuori, o chi lo ruota — `logrotate`, uno script, o
/// **un'altra installazione di Fub** che arriva a [`ROTATE_AT`] per prima e fa
/// la sua [`FileSink::rotate`] — lascia questo sink ad appendere in un file che
/// non ha più un nome, o che ne ha uno che nessuno guarderà mai più. E siccome
/// scrivere lì dentro *riesce*, non c'è nessun errore che lo racconti: il log
/// tace per il resto del processo, cioè proprio da quando servirebbe (0191).
///
/// Quindi prima di ogni riga si chiede **chi è** il file che sta al path, e se
/// non è quello aperto lo si riapre. È uno `stat` accanto a una `write`, sulla
/// strada di una riga di log che già paga una chiamata di sistema; il verso
/// alternativo — controllare ogni N righe — è N righe perse nel vuoto e un
/// numero da difendere.
///
/// La stessa domanda copre la rotazione **fra due installazioni**: chi arriva
/// secondo si accorge che il file sotto di lui non è più il suo, adotta quello
/// nuovo e non ruota una generazione appena nata sopra quella che l'altro ha
/// appena messo via.
#[derive(Debug)]
pub struct FileSink {
    path: Utf8PathBuf,
    state: Ricovero<Option<Open>>,
}

/// Oltre questi byte il file ruota. Dieci mega: abbastanza per settimane al
/// volume dei ventisei punti, poco abbastanza da poter essere allegato.
pub const ROTATE_AT: u64 = 10 * 1024 * 1024;

#[derive(Debug)]
struct Open {
    file: std::fs::File,
    written: u64,
    /// **Chi è** questo file per il sistema, se il sistema sa dirlo: è ciò con
    /// cui si riconosce che il path porta ancora qui e non a un file nuovo di
    /// qualcun altro. `None` vuol dire «questa piattaforma non risponde», e
    /// allora ci si tiene ciò che si ha.
    chi: Option<Chi>,
}

/// Il dispositivo e l'inode: la coppia con cui Unix dice che due nomi sono lo
/// stesso file.
type Chi = (u64, u64);

#[cfg(unix)]
fn chi_e(dati: &std::fs::Metadata) -> Option<Chi> {
    use std::os::unix::fs::MetadataExt;
    Some((dati.dev(), dati.ino()))
}

/// Senza una risposta della piattaforma non si inventa un criterio: `mtime` e
/// dimensione direbbero «è cambiato» a ogni riga scritta da chiunque, e la cura
/// sarebbe una riapertura continua. Su Windows, del resto, un file di log
/// aperto non si lascia né cancellare né rinominare da sotto.
#[cfg(not(unix))]
fn chi_e(_: &std::fs::Metadata) -> Option<Chi> {
    None
}

/// Il file che sta al path è ancora quello aperto?
///
/// Un path che non si legge affatto conta come «non è più lui»: se è sparito la
/// riapertura lo ricrea, e se è illeggibile per un'altra ragione la riapertura
/// fallisce e non si perde niente che non fosse già perso.
fn e_ancora_lui(path: &Utf8Path, open: &Open) -> bool {
    let Some(mio) = open.chi else { return true };
    std::fs::metadata(path).ok().and_then(|d| chi_e(&d)) == Some(mio)
}

impl FileSink {
    /// Apre (o crea) il file, oppure dice perché non ci è riuscito.
    ///
    /// Un log che non si apre non deve impedire di aprire un vault — è la
    /// stessa regola con cui [`crate::settings::MachineSettings::open`] tratta
    /// un file illeggibile, e vale a maggior ragione qui, dove si perde il
    /// racconto e non il contenuto. Ma *non impedire* vuol dire **ripiegare su
    /// un altro canale**, non tenersi un `FileSink` che non ha un file.
    ///
    /// # Perché è un `Result` e non un `(FileSink, Option<String>)`
    ///
    /// Perché un sink che non ha aperto niente **scrive ogni riga nel vuoto,
    /// per sempre**: [`FileSink::write_line`] esce subito quando lo stato è
    /// `None`, e nessuno riprova mai ad aprire. Con la coppia, ripiegare era
    /// una cosa che il chiamante si doveva *ricordare* — `let (sink, _warning)
    /// = …` compilava benissimo, ed è esattamente la riga che stava in
    /// `fub_host::install_logging`: un'installazione portable su un supporto
    /// non scrivibile spegneva **tutto** il log del processo, senza ripiego e
    /// senza una parola, e l'avviso che diceva perché era la cosa buttata via.
    ///
    /// Col `Result` quello stato non è più rappresentabile all'apertura, e chi
    /// apre un log deve scrivere cosa fa quando non si apre. È il compilatore a
    /// tenerlo fermo, non un commento.
    pub fn open(path: &Utf8Path) -> Result<FileSink, String> {
        let sink = FileSink {
            path: path.to_owned(),
            state: Ricovero::new(None),
        };
        match sink.reopen() {
            Ok(open) => {
                *sink.state.prendi() = Some(open);
                Ok(sink)
            }
            Err(e) => Err(format!("log: `{path}` non si apre: {e}")),
        }
    }

    fn reopen(&self) -> std::io::Result<Open> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        let dati = file.metadata();
        let written = dati.as_ref().map(|m| m.len()).unwrap_or(0);
        let chi = dati.ok().as_ref().and_then(chi_e);
        Ok(Open { file, written, chi })
    }

    fn rotate(&self) -> std::io::Result<Open> {
        // Il file corrente diventa la generazione di prima: si sposta su
        // `<path>.1`, sovrascrivendo quella che c'era, e ne ricomincia uno
        // vuoto. Una generazione sola, non cinque: vedi [`FileSink`].
        //
        // Sul `.1` si tenta prima la rimozione perché su Windows `rename` non
        // sovrascrive: lì un bersaglio già esistente fallirebbe, e su Unix la
        // `remove_file` di un path che non c'è è un `Err` che si butta. È
        // l'unica riga in cui i due sistemi prendono due rami invisibili, e
        // tenerla qui costa un controllo che altrove non servirebbe.
        let backup: Utf8PathBuf = format!("{}.1", self.path).into();
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(&self.path, &backup)?;
        self.reopen()
    }
}

impl Sink for FileSink {
    fn write_line(&self, line: &str) {
        let mut state = self.state.prendi();
        // **Il file può non essere più lì**: vedi la testa del tipo. Si guarda
        // prima di ogni riga, denuncia compresa, perché una denuncia scritta in
        // un descrittore che non ha più un nome è persa come tutte le altre.
        if state
            .as_ref()
            .is_some_and(|open| !e_ancora_lui(&self.path, open))
        {
            // Se non si riapre **si tiene il descrittore che c'è** e si riprova
            // alla riga dopo: buttarlo sarebbe spegnere il canale per sempre
            // per un guasto che può durare un istante, ed è il pozzo che
            // `FileSink::open` esiste per rendere irrappresentabile.
            if let Ok(fresh) = self.reopen() {
                *state = Some(fresh);
            }
        }
        // Il canale si denuncia **dentro sé stesso**, prima della riga che
        // qualcuno voleva scrivere: vedi la testa del tipo. `da_raccontare` è
        // ciò che rende «una volta per incidente» vero senza che la porta debba
        // sapere dove si racconta — e se il file non è aperto la denuncia si
        // perde esattamente come la riga, che è la stessa perdita e non una in
        // più.
        let veleni = self.state.da_raccontare();
        if veleni > 0 {
            let avviso = compose(
                crate::time::now_unix_millis(),
                Level::Error,
                "fub.kernel",
                "il lucchetto del file di log si è avvelenato: qualcuno è morto \
                 mentre scriveva. Il file è intatto e si continua a scrivere; \
                 qualche riga può mancare.",
                &format!(" volte={veleni}"),
            );
            scrivi_riga(state.as_mut(), &avviso);
        }
        let Some(open) = state.as_mut() else { return };
        if open.written >= ROTATE_AT {
            match self.rotate() {
                Ok(fresh) => *state = Some(fresh),
                // Il file non si riapre: si smette di scrivere, in silenzio.
                // Non c'è un canale in cui dirlo che non sia questo.
                Err(_) => {
                    *state = None;
                    return;
                }
            }
        }
        scrivi_riga(state.as_mut(), line);
    }
}

/// L'**unico** posto da cui una riga entra nel file, e da cui il conto dei byte
/// si muove. Anche la denuncia di un avvelenamento passa di qui: è ciò che le
/// permette di essere scritta senza rientrare nel collettore.
fn scrivi_riga(open: Option<&mut Open>, line: &str) {
    let Some(open) = open else { return };
    if writeln!(open.file, "{line}").is_ok() {
        open.written += line.len() as u64 + 1;
    }
}

/// Il sink dei test: tiene le righe in memoria e le sa rileggere.
#[derive(Debug, Default)]
pub struct CapturingSink {
    lines: Ricovero<Vec<String>>,
}

impl CapturingSink {
    /// Le righe scritte finora, in ordine.
    pub fn lines(&self) -> Vec<String> {
        self.lines.prendi().clone()
    }
}

impl Sink for CapturingSink {
    fn write_line(&self, line: &str) {
        self.lines.prendi().push(line.into());
    }
}

/// **Il collettore.**
///
/// Un `tracing::Subscriber` di sessanta righe che fa tre cose: chiede a
/// [`Levels`] se la riga si scrive, la compone, e la passa al [`Sink`].
#[derive(Debug)]
pub struct Collector {
    levels: Arc<Levels>,
    sink: Arc<dyn Sink>,
}

impl Collector {
    /// Un collettore che scrive in `sink` con i livelli `levels`.
    pub fn new(levels: Arc<Levels>, sink: Arc<dyn Sink>) -> Collector {
        Collector { levels, sink }
    }
}

impl tracing::Subscriber for Collector {
    fn enabled(&self, metadata: &tracing::Metadata<'_>) -> bool {
        self.levels
            .enabled(metadata.target(), Level::from_tracing(metadata.level()))
    }

    /// Gli span si accettano e si buttano: vedi la testa del modulo. L'id non
    /// può essere zero — `tracing` lo vieta — e non deve essere distinto,
    /// perché non lo si guarda mai.
    fn new_span(&self, _span: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }

    fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}

    fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

    fn event(&self, event: &tracing::Event<'_>) {
        let meta = event.metadata();
        let mut visitor = Composed::default();
        event.record(&mut visitor);
        self.sink.write_line(&compose(
            crate::time::now_unix_millis(),
            Level::from_tracing(meta.level()),
            meta.target(),
            &visitor.message,
            &visitor.fields,
        ));
    }

    fn enter(&self, _span: &tracing::span::Id) {}

    fn exit(&self, _span: &tracing::span::Id) {}

    /// `None`, ed è una scelta: vedi la testa del modulo.
    fn max_level_hint(&self) -> Option<tracing::level_filters::LevelFilter> {
        None
    }
}

/// Il messaggio e i campi di un evento, tirati fuori dal visitor.
#[derive(Default)]
struct Composed {
    message: String,
    fields: String,
}

impl tracing::field::Visit for Composed {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            let _ = write!(self.fields, " {}={value}", field.name());
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        // Il messaggio arriva come `fmt::Arguments`, il cui `Debug` è il suo
        // `Display`: `{value:?}` qui è la frase, non la frase fra virgolette.
        if field.name() == "message" {
            self.message = format!("{value:?}");
        } else {
            let _ = write!(self.fields, " {}={value:?}", field.name());
        }
    }
}

/// **La forma di una riga.**
///
/// `<istante> <LIVELLO> <target> <messaggio><campi>`, e l'ordine non è
/// arbitrario: le tre colonne fisse stanno davanti perché una riga di log si
/// legge con `grep` e con l'occhio, e in entrambi i casi ciò che si cerca per
/// primo è *quando* e *chi*. L'istante è ISO con i `:`, e quindi **non** è
/// [`crate::time::now_stamp`], che i `:` li toglie per stare in un nome di
/// file: due forme diverse per due mestieri diversi.
fn compose(millis: u64, level: Level, target: &str, message: &str, fields: &str) -> String {
    format!(
        "{} {:<5} {target} {message}{fields}",
        crate::time::stamp_iso_millis(millis),
        level.as_str().to_uppercase(),
    )
}

/// **Installa il collettore per tutto il processo.**
///
/// Torna `Err` se qualcuno l'ha già fatto — che in un binario è un difetto e in
/// una suite di test è la normalità, perché i test girano insieme nello stesso
/// processo. Per quello c'è [`captured`], che non tocca il globale.
pub fn install(levels: Arc<Levels>, sink: Arc<dyn Sink>) -> Result<(), String> {
    tracing::subscriber::set_global_default(Collector::new(levels, sink))
        .map_err(|e| format!("log: il collettore era già installato: {e}"))
}

/// **Cattura le righe scritte da `f`, solo su questo thread.**
///
/// È la porta dei test, e passa da `with_default` di `tracing`, che è
/// *thread-local*: due test che girano insieme nello stesso processo non si
/// vedono le righe a vicenda. Senza questo, presidiare il log avrebbe voluto
/// dire un test che gira da solo — cioè un presidio che la suite non esegue
/// come esegue gli altri.
pub fn captured<R>(levels: Arc<Levels>, f: impl FnOnce() -> R) -> (R, Vec<String>) {
    let sink = Arc::new(CapturingSink::default());
    let collector = Collector::new(levels, sink.clone());
    let out = tracing::subscriber::with_default(collector, f);
    (out, sink.lines())
}

/// Come [`captured`], ai livelli di default.
pub fn captured_default<R>(f: impl FnOnce() -> R) -> (R, Vec<String>) {
    captured(Arc::new(Levels::default()), f)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La riga porta le tre colonne davanti al messaggio, e nell'ordine.
    #[test]
    fn una_riga_dice_quando_quanto_e_chi_prima_di_dire_cosa() {
        let riga = compose(
            0,
            Level::Warn,
            "fub.versioning",
            "non si legge",
            " id=Alpha.md",
        );
        assert_eq!(
            riga,
            "1970-01-01T00:00:00.000Z WARN  fub.versioning non si legge id=Alpha.md"
        );
    }

    /// Il globale decide per tutti.
    #[test]
    fn il_livello_globale_taglia() {
        let l = Levels::default();
        l.set_global(Level::Warn);
        assert!(l.enabled("fub.core", Level::Error));
        assert!(l.enabled("fub.core", Level::Warn));
        assert!(!l.enabled("fub.core", Level::Info));
    }

    /// «Verboso» vuol dire *almeno*, mai *esattamente*: alza la soglia di un
    /// target e non la abbassa a nessuno.
    #[test]
    fn un_target_verboso_alza_la_soglia_e_non_la_abbassa() {
        let l = Levels::default();
        l.set_global(Level::Error);
        l.set_verbose(vec!["fub.versioning".into()]);
        assert!(l.enabled("fub.versioning", Level::Debug));
        assert!(!l.enabled("fub.core", Level::Debug));
        // Sopra Debug non arriva nemmeno chi è verboso.
        assert!(!l.enabled("fub.versioning", Level::Trace));

        // E con il globale già alto, essere verboso non toglie niente.
        l.set_global(Level::Trace);
        assert!(l.enabled("fub.versioning", Level::Trace));
    }

    /// `Off` è silenzio vero, anche per un errore.
    #[test]
    fn spento_vuol_dire_spento() {
        let l = Levels::default();
        l.set_global(Level::Off);
        assert!(!l.enabled("fub.core", Level::Error));
    }

    /// Il nome di un gradino sopravvive al giro dal file e ritorno.
    #[test]
    fn i_gradini_si_rileggono_dal_nome_che_scrivono() {
        for level in Level::ALL {
            assert_eq!(Level::parse(level.as_str()), Some(level));
        }
        assert_eq!(Level::parse("verboso"), None);
    }

    /// Il collettore scrive davvero, e scrive **solo** ciò che passa il filtro.
    /// Il conto delle righe è nell'asserzione apposta: un presidio che guarda
    /// il contenuto senza contare passerebbe anche avendo catturato niente.
    #[test]
    fn il_collettore_scrive_cio_che_passa_e_solo_quello() {
        let levels = Arc::new(Levels::default());
        levels.set_global(Level::Warn);
        let ((), righe) = captured(levels, || {
            tracing::warn!(target: "fub.test", "questa passa");
            tracing::info!(target: "fub.test", "questa no");
            tracing::error!(target: "fub.test", campo = 7, "anche questa passa");
        });
        assert_eq!(righe.len(), 2, "due righe su tre, e non altre: {righe:?}");
        assert!(righe[0].contains("WARN "), "{:?}", righe[0]);
        assert!(
            righe[0].ends_with("fub.test questa passa"),
            "{:?}",
            righe[0]
        );
        assert!(righe[1].contains("ERROR"), "{:?}", righe[1]);
        assert!(
            righe[1].ends_with("fub.test anche questa passa campo=7"),
            "il campo strutturato segue il messaggio: {:?}",
            righe[1]
        );
    }

    /// La `TempDir` va **tenuta**: cade con lei la cartella, e un sink che
    /// scrive dentro una cartella già cancellata fallirebbe per una ragione che
    /// non c'entra con ciò che si sta provando.
    fn tempdir() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
        (dir, path)
    }

    /// **Un file che non si apre non diventa un sink.**
    ///
    /// Prima era un `FileSink` con lo stato a `None`, cioè un pozzo: ogni riga
    /// del processo ci finiva dentro e nessuno riapriva mai. Adesso non esiste —
    /// e a tenerlo fermo è il **tipo di ritorno**, non questo banco, che sulla
    /// forma nuova è verde per costruzione. Qui si prova che il `Err` porta con
    /// sé il path, perché è ciò che il chiamante deve poter dire a chi guarda.
    ///
    /// La cartella impossibile si costruisce senza permessi — una cartella
    /// *dentro un file* non si crea da nessuna parte, nemmeno da root e nemmeno
    /// su Windows.
    #[test]
    fn un_file_di_log_che_non_si_apre_non_diventa_un_sink() {
        let (_tmp, dir) = tempdir();
        let occupato = dir.join("non-una-cartella");
        std::fs::write(&occupato, b"un file, non una cartella").expect("scrive");

        let path = occupato.join("fub.log");
        let e = FileSink::open(&path).expect_err("sotto un file non si crea niente");
        assert!(
            e.contains(path.as_str()),
            "l'errore non dice quale file: {e}"
        );
    }

    /// Il file ruota, e ciò che c'era prima si ritrova in `.1`.
    #[test]
    fn il_file_ruota_e_non_perde_la_generazione_di_prima() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("fub.log");
        let sink = FileSink::open(&path).expect("il file si apre");

        let lunga = "x".repeat(1024);
        let mut scritte = 0u64;
        while scritte < ROTATE_AT + 1 {
            sink.write_line(&lunga);
            scritte += lunga.len() as u64 + 1;
        }
        sink.write_line("dopo la rotazione");

        let ruotato =
            std::fs::read_to_string(format!("{path}.1")).expect("la generazione di prima");
        assert!(ruotato.len() as u64 >= ROTATE_AT, "{}", ruotato.len());
        let corrente = std::fs::read_to_string(&path).expect("il file corrente");
        assert!(
            corrente.contains("dopo la rotazione"),
            "il file nuovo riparte e riceve: {corrente:?}"
        );
        assert!(
            (corrente.len() as u64) < ROTATE_AT,
            "il file nuovo è nuovo: {}",
            corrente.len()
        );
    }

    /// **Un file di log tolto da sotto torna ad avere un file**, invece di
    /// scrivere per sempre in un descrittore che non ha più un nome.
    ///
    /// Le due prove stanno su Unix perché su Windows il caso non si costruisce:
    /// un file aperto non si lascia cancellare né rinominare da sotto.
    #[cfg(unix)]
    #[test]
    fn un_log_cancellato_da_fuori_torna_ad_avere_un_file() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("fub.log");
        let sink = FileSink::open(&path).expect("il file si apre");
        sink.write_line("prima");
        std::fs::remove_file(&path).expect("qualcuno lo cancella da fuori");

        sink.write_line("dopo");
        let scritto = std::fs::read_to_string(&path).expect(
            "dopo la cancellazione il log non ha più un file: ogni riga del \
             processo, da qui alla fine, è scritta nel vuoto",
        );
        assert!(scritto.contains("dopo"), "{scritto:?}");
    }

    /// **Una rotazione fatta da fuori non lascia questo sink ad appendere nella
    /// generazione di prima.**
    ///
    /// Quel `rename` è esattamente ciò che fa la [`FileSink::rotate`] di
    /// un'altra installazione arrivata a [`ROTATE_AT`] per prima. Senza la
    /// riapertura le righe nuove finiscono in `.1`, e la rotazione successiva
    /// — di chiunque delle due — ci passa sopra: è così che «si perde il file
    /// vecchio».
    #[cfg(unix)]
    #[test]
    fn una_rotazione_di_qualcun_altro_non_si_porta_via_le_righe_di_questo() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("fub.log");
        let sink = FileSink::open(&path).expect("il file si apre");
        sink.write_line("prima");
        std::fs::rename(&path, format!("{path}.1")).expect("la rotazione di qualcun altro");

        sink.write_line("dopo");
        let corrente = std::fs::read_to_string(&path)
            .expect("dopo la rotazione altrui non c'è più nessun `fub.log`");
        assert!(corrente.contains("dopo"), "{corrente:?}");
        let vecchia =
            std::fs::read_to_string(format!("{path}.1")).expect("la generazione di prima");
        assert!(vecchia.contains("prima"), "{vecchia:?}");
        assert!(
            !vecchia.contains("dopo"),
            "la riga nuova è finita nella generazione di prima, che la \
             rotazione successiva sovrascrive: {vecchia:?}"
        );
    }

    // -----------------------------------------------------------------------
    // Il veleno del canale che denuncia (0126 estesa, `crate::veleno`)
    // -----------------------------------------------------------------------

    /// Avvelena un lucchetto facendo paniare **dentro** un `catch_unwind` col
    /// prestito in mano: è come lo produce la vita, e non serve un thread —
    /// quindi non c'è niente che possa andare in blocco invece che in rosso.
    ///
    /// L'hook dei panici si mette a tacere per la durata del misfatto, o un
    /// panico voluto stamperebbe la sua traccia e farebbe sembrare rotto un
    /// banco verde.
    fn avvelena(f: impl FnOnce()) {
        let vecchio = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
        std::panic::set_hook(vecchio);
    }

    /// **Il canale con cui i guasti si denunciano sopravvive al proprio.**
    ///
    /// Col `.lock().expect("file di log")` di prima questo caso non falliva
    /// «male»: paniava alla prima riga scritta dopo il misfatto, cioè faceva
    /// esattamente ciò che l'app avrebbe fatto a ogni `tracing::error!`
    /// successivo — e il primo `tracing::error!` a farne le spese sarebbe stato
    /// quello con cui la 0126 denuncia un bus avvelenato.
    #[test]
    fn un_file_di_log_avvelenato_scrive_lo_stesso_e_lo_dice_nel_file() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("fub.log");
        let sink = FileSink::open(&path).expect("il file si apre");
        sink.write_line("prima del misfatto");

        avvelena(|| {
            let _guardia = sink.state.prendi();
            panic!("qualcuno muore col file in mano");
        });

        sink.write_line("dopo il misfatto");
        let scritto = std::fs::read_to_string(&path).expect("il file di log");
        assert!(scritto.contains("dopo il misfatto"), "{scritto}");
        // La denuncia sta **nel file**, non in un `tracing::error!` che da qui
        // rientrerebbe: è la sola strada che esce dal cerchio.
        assert!(
            scritto.contains("il lucchetto del file di log si è avvelenato"),
            "il canale non ha detto di essersi avvelenato: {scritto}"
        );
        assert_eq!(sink.state.denunce(), 1, "un incidente vale uno");

        // E lo dice **una volta per incidente**: la riga dopo non la ripete.
        sink.write_line("terza riga");
        let scritto = std::fs::read_to_string(&path).expect("il file di log");
        assert_eq!(
            scritto.matches("si è avvelenato").count(),
            1,
            "la denuncia si ripete a ogni riga: {scritto}"
        );
    }

    /// **Il filtro di ogni callsite sopravvive al proprio veleno.**
    ///
    /// È il gemello del caso qui sopra un piano più su: `Levels::enabled` gira
    /// prima di *ogni* riga di `tracing`, e col `.expect("target verbosi")` di
    /// prima un solo panico avvenuto tenendo l'elenco avrebbe reso paniante ogni
    /// macro di log del processo, comprese quelle di tauri.
    #[test]
    fn un_filtro_avvelenato_risponde_lo_stesso() {
        let levels = Levels::default();
        levels.set_verbose(vec!["fub.versioning".into()]);
        avvelena(|| {
            let _guardia = levels.verbose.scrivi();
            panic!("qualcuno muore tenendo l'elenco dei verbosi");
        });
        assert!(levels.enabled("fub.versioning", Level::Debug));
        assert_eq!(levels.verbose(), vec!["fub.versioning".to_string()]);
        assert_eq!(levels.verbose.denunce(), 1);
    }
}
