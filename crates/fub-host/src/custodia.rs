//! **La porta unica dei lucchetti dell'host**, e la politica che ci sta dentro
//! (decisione 0120).
//!
//! # Il difetto non era il panico
//!
//! Il panico lo aveva già affrontato la [0032]: un provider che pania costa la
//! *chiamata*, non il vault, e la rete sta in [`fub_kernel::safety`]. Il doc di
//! quel modulo però descriveva il resto del guaio senza ripararlo — *«i
//! `.write().unwrap()` di chi monta lo traducono in un panico su ogni comando
//! successivo»* — e quel «chi monta» era qui.
//!
//! Il difetto misurato non era che l'host paniasse: era che alla **stessa
//! domanda** — *cosa si fa quando questo lucchetto è avvelenato?* — i tre strati
//! rispondevano in tre modi, e nessuno dei tre stava scritto.
//!
//! - `crates/fub-host/src/runner.rs` scriveva `.expect("workspace avvelenato")`:
//!   sembra una decisione presa, ed è solo una frase.
//! - `crates/fub-app/src/lib.rs` scriveva `.unwrap()` nudo, quattordici volte:
//!   la stessa cosa detta per abitudine, senza nemmeno la frase.
//! - `crates/fub-host/src/config.rs` scriveva `.unwrap_or_else(|e|
//!   e.into_inner())`: **ricuperava**, ed è la risposta opposta.
//!
//! Il terzo è quello che ha reso la cosa decidibile, ed è rimasto dov'era: là il
//! lucchetto serializza due variabili d'ambiente in un test, e un panico dentro
//! quella sezione non lascia niente di storto perché non c'è niente da lasciare.
//! La politica non è dei lucchetti: è di **cosa il lucchetto protegge**.
//!
//! # La decisione: irrecuperabile, e detta una volta sola
//!
//! Un [`std::sync::RwLock`] si avvelena **solo** se a paniare è chi tiene il
//! prestito esclusivo (chi legge non lo avvelena, ed è metà del regalo della
//! [0024]). Quindi «avvelenato» qui non vuol dire «qualcuno è morto vicino»:
//! vuol dire *una mutazione si è fermata a metà*. Un [`fub_kernel::Workspace`]
//! preso a quel punto ha un indice alimentato per metà, un documento nella
//! tabella e non nel grafo, un lotto aperto che nessuno chiuderà. `into_inner`
//! restituirebbe quello stato e lo farebbe passare per buono: chi cerca
//! troverebbe risposte *sbagliate* invece di risposte *mancanti*, che è il modo
//! peggiore di sopravvivere. Ricuperare qui non è ricuperare — è mentire.
//!
//! Ma «irrecuperabile» non autorizza il panico ripetuto, che è ciò che
//! l'`unwrap` faceva: rendeva l'app **muta** a ogni chiamata successiva, senza
//! una riga che dicesse perché. Le due cose stanno insieme così:
//!
//! 1. **la prima volta** che una custodia risulta avvelenata scrive *una* riga
//!    di `tracing::error!` che dice cosa è successo, cosa non è più credibile e
//!    che va riavviato;
//! 2. **tutte le volte**, prima compresa, chi chiede riceve un
//!    [`PluginError::Internal`] con la stessa frase — che sull'IPC diventa un
//!    errore discriminabile e sullo schermo una frase, non un vuoto.
//!
//! Il conto delle denunce è di **questa** custodia e non del processo: due vault
//! aperti sono due stati, e sapere che il primo è morto non dice niente del
//! secondo. Si può chiedere ([`Custodia::denunce`]), e vale zero o uno per
//! sempre.
//!
//! # Perché una porta e non una convenzione
//!
//! Perché la risposta giusta è **una**, e una risposta che va ripetuta a ogni
//! `.lock()` futuro è la risposta sbagliata: il secondo chiamante la deve
//! ereditare gratis. Qui il `RwLock` è privato a questo modulo e non esce mai —
//! `read`/`write` consegnano la guardia o l'errore, e `.lock()` su una
//! [`Custodia`] **non esiste**, quindi non compila. È la forma del `mod intake`
//! di `fub-kernel/src/bus.rs`.
//!
//! Che il tipo sia generico non è eleganza: è la prova. La seconda custodia —
//! il registro dei bundle, le bandiere dei job, le sveglie, gli scarti
//! dell'apertura, la mappa delle sessioni — non ha ridiscusso niente.
//!
//! Chi resta fuori sta in `crates/fub-host/tests/un_lucchetto_solo.rs`, che è il
//! conto: ogni `Mutex`/`RwLock` nudo di `fub-host` e `fub-app` vuole una riga
//! con la sua ragione.
//!
//! # E quanto a lungo lo si è tenuto
//!
//! La stessa porta risponde a una seconda domanda, che è quella della §27.3:
//! *questo prestito esclusivo quanto è durato?*. La regola dichiarata dei job —
//! un prestito per chiamata, mai per la durata del job — limita per quanto si
//! tiene il lucchetto **fra** le chiamate, non **dentro** una, e ciò che gira
//! dentro una non è tutto codice di casa: i venticinque metodi che il contratto
//! dichiara `&mut self` sono il posto da cui un provider di terzi entra tenendo
//! in mano il vault intero.
//!
//! Un prestito esclusivo lungo non si può interrompere — chi lo tiene ha `&mut`
//! su ciò che sta dentro, e togliergli il tavolo da sotto vorrebbe dire
//! esattamente lo stato a metà di cui sopra —, quindi ciò che si può fare non è
//! impedirlo: è **accorgersene e dirlo**, invece di restare fermi in silenzio.
//! Che è la differenza fra un'app rotta e un plugin lento, e oggi l'utente non
//! ha modo di distinguerle.
//!
//! Vale sul prestito **esclusivo** e non su quello condiviso, e non per
//! simmetria mancata: un condiviso non mette in fila gli altri condivisi, e
//! l'unico lungo che questo repo ha per scelta — la raccolta degli spazi
//! per-documento in fondo a un'apertura — è lungo *perché* è condiviso, cioè è
//! la riparazione e non il difetto.
//!
//! [0024]: ../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md
//! [0032]: ../../../docs/decisions/0032-il-runner-dei-job.md

use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, Instant};

use fub_abi::PluginError;

/// **Quanto può durare un prestito esclusivo prima che valga la pena dirlo.**
///
/// Non è una soglia di correttezza — niente si rompe a 249 ms e niente si
/// ripara a 251 —: è la durata oltre la quale chi guarda lo schermo smette di
/// leggere un'attesa come una risposta che sta arrivando e comincia a leggerla
/// come qualcosa che si è inceppato. Il numero misurato che questo repo ha
/// dall'altra parte è 0,12 ms per un salvataggio sotto contesa (decisione
/// 0024): fra i due c'è un fattore duemila, e nessuna mutazione di casa ci
/// arriva vicino per caso.
const TROPPO_A_LUNGO: Duration = Duration::from_millis(250);

/// **Un dato condiviso dietro un lucchetto, con la politica del veleno dentro.**
///
/// Si clona come un `Arc` — è un `Arc` — e chi ne ha una copia ha lo stesso
/// dato. Il `RwLock` non esce: le uniche due porte sono [`Custodia::read`] e
/// [`Custodia::write`], che rispondono con la guardia o con la frase.
pub struct Custodia<T> {
    dentro: Arc<Interno<T>>,
}

struct Interno<T> {
    /// **Il lucchetto, e non esce di qui.** È l'intera ragione per cui questo
    /// tipo esiste: un campo privato di un modulo privato non si prende a mano.
    lucchetto: RwLock<T>,
    /// Come si chiama ciò che sta dentro, quando bisogna dire che è morto.
    /// `&'static str` e non `String` perché è una costante del sito di
    /// costruzione: se un giorno servisse il path del vault, allora la frase la
    /// comporrebbe chi apre, e questo campo diventerebbe `Box<str>`.
    nome: &'static str,
    /// Quante volte questa custodia ha **denunciato**, cioè scritto la riga.
    /// Zero o uno, per sempre. Vedi [`Custodia::denunce`].
    denunce: AtomicU32,
    /// Oltre quanto un prestito esclusivo è **lungo**. È un campo e non la
    /// costante letta a ogni giro perché un banco che prova la proprietà non
    /// deve dormire un quarto di secondo per vederla: la soglia è ciò che si
    /// muove, la proprietà no.
    soglia: Duration,
    /// Quanti prestiti esclusivi hanno passato la soglia. A differenza delle
    /// denunce **cresce**: un veleno è uno stato e si dice una volta, una
    /// lentezza è un fatto e ne può capitare un altro. Vedi
    /// [`Custodia::lente`].
    lente: AtomicU32,
}

impl<T> Clone for Custodia<T> {
    fn clone(&self) -> Self {
        Custodia {
            dentro: Arc::clone(&self.dentro),
        }
    }
}

impl<T: std::fmt::Debug> std::fmt::Debug for Custodia<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Custodia")
            .field("nome", &self.dentro.nome)
            .field("denunce", &self.denunce())
            .finish_non_exhaustive()
    }
}

impl<T> Custodia<T> {
    /// Mette `valore` in custodia. `nome` è ciò che comparirà nella frase quando
    /// questa custodia risulterà avvelenata: va scritto per chi la legge sullo
    /// schermo, non per chi cerca il simbolo nel sorgente.
    pub fn new(nome: &'static str, valore: T) -> Self {
        Custodia::con_soglia(nome, valore, TROPPO_A_LUNGO)
    }

    /// La stessa, con un'altra idea di **quanto è lungo**.
    ///
    /// Esiste perché la proprietà che [`TROPPO_A_LUNGO`] compra si possa
    /// provare senza pagarla: un banco che la vuole vedere mette una soglia di
    /// un millesimo e tiene il prestito per cinque, invece di dormire un quarto
    /// di secondo per ogni riga che prova. È la stessa ragione per cui
    /// [`denunce`](Custodia::denunce) è pubblica — una proprietà che nessuno
    /// può chiedere è una promessa.
    pub fn con_soglia(nome: &'static str, valore: T, soglia: Duration) -> Self {
        Custodia {
            dentro: Arc::new(Interno {
                lucchetto: RwLock::new(valore),
                nome,
                denunce: AtomicU32::new(0),
                soglia,
                lente: AtomicU32::new(0),
            }),
        }
    }

    /// Il prestito **condiviso**. Chi legge non avvelena niente: se questa
    /// risponde di no è perché qualcun altro, prima, è morto scrivendo.
    pub fn read(&self) -> Result<RwLockReadGuard<'_, T>, PluginError> {
        match self.dentro.lucchetto.read() {
            Ok(g) => Ok(g),
            Err(_) => Err(self.denuncia()),
        }
    }

    /// Il prestito **esclusivo**. Chi lo prende e pania è chi avvelena: è il
    /// caso che questa politica descrive.
    pub fn write(&self) -> Result<Presa<'_, T>, PluginError> {
        match self.dentro.lucchetto.write() {
            Ok(g) => Ok(Presa::nuova(g, &self.dentro)),
            Err(_) => Err(self.denuncia()),
        }
    }

    /// Il prestito condiviso **senza mettersi in fila**: `None` se in questo
    /// istante non lo si può avere, per qualunque ragione — qualcuno scrive, o
    /// la custodia è morta.
    ///
    /// Le due ragioni non si distinguono di proposito: chi chiede «lo posso
    /// avere adesso?» sta misurando la contesa, e per lui «no» è uno solo. Chi
    /// vuole sapere *perché* usa [`read`](Custodia::read), che aspetta e
    /// risponde.
    pub fn try_read(&self) -> Option<RwLockReadGuard<'_, T>> {
        self.dentro.lucchetto.try_read().ok()
    }

    /// Il prestito esclusivo **senza mettersi in fila**. Vedi
    /// [`try_read`](Custodia::try_read) per perché il «no» è uno solo.
    pub fn try_write(&self) -> Option<Presa<'_, T>> {
        self.dentro
            .lucchetto
            .try_write()
            .ok()
            .map(|g| Presa::nuova(g, &self.dentro))
    }

    /// Sono la **stessa** custodia? Serve a chi prova che riaprire un vault
    /// già aperto non lo riapre: la domanda è sull'identità del dato, non sul
    /// suo contenuto.
    pub fn ptr_eq(a: &Self, b: &Self) -> bool {
        Arc::ptr_eq(&a.dentro, &b.dentro)
    }

    /// **Quante volte questa custodia ha scritto la riga**: zero finché è viva,
    /// uno da quando è morta, e uno per sempre.
    ///
    /// È pubblica perché è la proprietà che questa decisione compra, e una
    /// proprietà che nessuno può chiedere è una promessa. La misura
    /// `crates/fub-host/tests/un_lucchetto_solo.rs`.
    pub fn denunce(&self) -> u32 {
        self.dentro.denunce.load(Ordering::Relaxed)
    }

    /// **Quanti prestiti esclusivi sono durati più della soglia.** È la
    /// proprietà che la §27.3 compra, e per la ragione scritta accanto a
    /// [`denunce`](Custodia::denunce) si può chiedere.
    pub fn lente(&self) -> u32 {
        self.dentro.lente.load(Ordering::Relaxed)
    }

    /// La frase, e — la prima volta soltanto — la riga nel log.
    ///
    /// Un atomico e non un [`std::sync::Once`], che pure saprebbe fare la parte
    /// del «una volta sola»: `Once` esegue la chiusura sotto un lucchetto suo, e
    /// mettere un lucchetto dentro la risposta a *«un lucchetto è andato
    /// storto»* è il modo di scoprire un giorno che la via d'uscita si può
    /// bloccare. Qui la risposta è una parola e un `compare_exchange`, e non può
    /// aspettare nessuno.
    #[cold]
    fn denuncia(&self) -> PluginError {
        if self
            .dentro
            .denunce
            .compare_exchange(0, 1, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            tracing::error!(
                target: "fub.host",
                "{}: un panico ha interrotto una modifica a metà mentre teneva il lucchetto. \
                 Ciò che ne resta in memoria non è uno stato che qualcuno abbia scritto — un \
                 indice alimentato a metà, un lotto che nessuno chiuderà — e riusarlo darebbe \
                 risposte sbagliate invece che mancanti. Da qui in poi ogni chiamata che passa \
                 di qui risponde di no invece di paniare: i dati sul disco non sono toccati, \
                 riavvia Fub. Il panico che lo ha causato è stato riportato dove è successo.",
                self.dentro.nome,
            );
        }
        // Le volte dopo non scrivono niente: la riga è una diagnosi, e una
        // diagnosi ripetuta a ogni chiamata è rumore che copre la prima.
        PluginError::Internal(
            format!(
                "{}: stato irrecuperabile — un panico ha interrotto una modifica a metà, e ciò \
                 che resta in memoria non è credibile. I file sul disco non sono toccati: \
                 riavvia Fub.",
                self.dentro.nome
            )
            .into(),
        )
    }
}

impl<T> Interno<T> {
    /// La riga — la prima volta soltanto — e il conto, sempre.
    ///
    /// «La prima volta soltanto» è la stessa regola del veleno e per la stessa
    /// ragione: una diagnosi ripetuta a ogni giro è rumore che copre la prima,
    /// e chi vuole sapere se è successo ancora ha il conto, che invece cresce.
    #[cold]
    fn lentezza(&self, durata: Duration) {
        if self.lente.fetch_add(1, Ordering::Relaxed) == 0 {
            tracing::warn!(
                target: "fub.host",
                "{}: una modifica ha tenuto il prestito esclusivo per {} ms. Finché lo teneva, \
                 ogni lettura e ogni salvataggio su questo vault erano fermi ad aspettarla: \
                 sullo schermo è un'app che non risponde, e non lo è — è una singola operazione \
                 lenta. Se si ripete, chi la fa va spostato in un job, che il prestito lo prende \
                 e lo rilascia a ogni capacità invece di tenerlo per tutta la durata del lavoro.",
                self.nome,
                durata.as_millis(),
            );
        }
    }
}

/// **Il prestito esclusivo, e per quanto lo si è tenuto.**
///
/// Si usa come la guardia che avvolge — `*presa`, `presa.metodo()` — e l'unica
/// cosa che aggiunge la fa sciogliendosi: guarda l'orologio, e se il prestito è
/// durato più della soglia della custodia lo dice.
///
/// Il lucchetto si **rilascia prima** di scrivere la riga, e non è un dettaglio
/// di stile: il campo si scioglie dopo il corpo del [`Drop`], quindi lasciandolo
/// dov'era la diagnosi di un prestito troppo lungo si sarebbe scritta tenendolo,
/// cioè allungando esattamente ciò che sta misurando.
pub struct Presa<'a, T> {
    /// `Option` per poterlo sciogliere **prima** della riga: vedi sopra. Vale
    /// `Some` per tutta la vita della presa e `None` solo dentro il [`Drop`].
    guardia: Option<RwLockWriteGuard<'a, T>>,
    dentro: &'a Interno<T>,
    preso: Instant,
}

impl<'a, T> Presa<'a, T> {
    fn nuova(guardia: RwLockWriteGuard<'a, T>, dentro: &'a Interno<T>) -> Self {
        Presa {
            guardia: Some(guardia),
            dentro,
            // Dopo l'acquisizione e non prima: ciò che si misura è per quanto
            // **si tiene**, non per quanto si è aspettato di avere. Chi ha
            // aspettato è la vittima, e il suo conto lo tiene la presa
            // dell'altro.
            preso: Instant::now(),
        }
    }
}

impl<T> Deref for Presa<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.guardia.as_ref().expect("la presa vive finché non si scioglie")
    }
}

impl<T> DerefMut for Presa<'_, T> {
    fn deref_mut(&mut self) -> &mut T {
        self.guardia.as_mut().expect("la presa vive finché non si scioglie")
    }
}

impl<T> Drop for Presa<'_, T> {
    fn drop(&mut self) {
        let durata = self.preso.elapsed();
        drop(self.guardia.take());
        if durata >= self.dentro.soglia {
            self.dentro.lentezza(durata);
        }
    }
}

impl<T: Default> Custodia<T> {
    /// Comodità per chi mette in custodia un dato che nasce vuoto.
    pub fn vuota(nome: &'static str) -> Self {
        Custodia::new(nome, T::default())
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    /// Avvelena la custodia come la avvelena la vita: un thread che pania
    /// tenendo il prestito **esclusivo**.
    ///
    /// Il panico è di proposito e non deve sporcare l'output del banco: l'hook
    /// si mette a tacere per la durata del misfatto e si rimette subito.
    fn avvelena<T: Send + Sync + 'static>(c: &Custodia<T>) {
        let copia = c.clone();
        let hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let _ = std::thread::spawn(move || {
            let _g = copia.write().expect("viva prima del misfatto");
            panic!("a metà");
        })
        .join();
        std::panic::set_hook(hook);
    }

    #[test]
    fn viva_non_denuncia_e_lascia_passare() {
        let c = Custodia::new("il conto", 1_u32);
        *c.write().expect("prestito esclusivo") += 1;
        assert_eq!(*c.read().expect("prestito condiviso"), 2);
        assert_eq!(c.denunce(), 0, "una custodia viva non ha niente da dire");
    }

    #[test]
    fn avvelenata_dice_di_no_invece_di_paniare() {
        let c = Custodia::new("il vault di prova", 1_u32);
        avvelena(&c);
        // Il punto della decisione: **non** un panico, né alla prima né alla
        // decima. Se questo tornasse un `unwrap`, questo test non fallirebbe:
        // abortirebbe il thread del banco — che è precisamente ciò che
        // succedeva all'utente a ogni IPC.
        for _ in 0..10 {
            assert!(c.read().is_err(), "letta da morta");
            assert!(c.write().is_err(), "scritta da morta");
        }
    }

    #[test]
    fn la_frase_nomina_cio_che_e_morto_e_dice_del_disco() {
        let c = Custodia::new("il vault di prova", 1_u32);
        avvelena(&c);
        let PluginError::Internal(frase) = c.read().expect_err("morta") else {
            panic!("un veleno non è un errore di dominio: è un guasto dell'host");
        };
        let frase = frase.to_string();
        assert!(frase.contains("il vault di prova"), "{frase}");
        assert!(frase.contains("disco"), "cosa NON si è perso: {frase}");
        assert!(frase.contains("riavvia"), "cosa deve fare: {frase}");
    }

    #[test]
    fn la_riga_si_scrive_una_volta_sola() {
        let c = Custodia::new("il vault di prova", 1_u32);
        avvelena(&c);
        assert_eq!(c.denunce(), 0, "finché nessuno chiede, niente da dire");
        for _ in 0..50 {
            drop(c.read());
            drop(c.write());
        }
        assert_eq!(
            c.denunce(),
            1,
            "cento chiamate e una riga: è la metà del difetto che la 0120 ripara"
        );
    }

    /// **Un prestito esclusivo troppo lungo si dice** (§27.3).
    ///
    /// La soglia si abbassa invece di dormirci sopra: ciò che si prova è che
    /// la porta guarda l'orologio e parla, non quanto vale il quarto di secondo
    /// di [`TROPPO_A_LUNGO`].
    #[test]
    fn una_modifica_che_tiene_il_vault_troppo_a_lungo_si_dice() {
        let c = Custodia::con_soglia("il vault di prova", 1_u32, Duration::from_millis(1));
        {
            let mut g = c.write().expect("prestito esclusivo");
            *g += 1;
            std::thread::sleep(Duration::from_millis(8));
        }
        assert_eq!(
            c.lente(),
            1,
            "il prestito è durato più della soglia e nessuno lo ha detto: è l'attesa che \
             sullo schermo sembra un'app rotta"
        );
        assert_eq!(*c.read().expect("viva"), 2, "e la modifica è avvenuta");
        assert_eq!(c.denunce(), 0, "lento non vuol dire morto");
    }

    /// L'altra metà, che impedisce alla riparazione di diventare «ogni prestito
    /// è lento»: una mutazione normale non dice niente. Ed è anche la ragione
    /// per cui la misura parte **dopo** l'acquisizione — qui il secondo
    /// prestito ha aspettato il primo, e ad averlo tenuto non è lui.
    #[test]
    fn un_prestito_normale_non_dice_niente() {
        let c = Custodia::con_soglia("il vault di prova", 1_u32, Duration::from_millis(50));
        let barriera = std::sync::Barrier::new(2);
        std::thread::scope(|s| {
            s.spawn(|| {
                let _g = c.write().expect("prestito esclusivo");
                barriera.wait();
                std::thread::sleep(Duration::from_millis(2));
            });
            barriera.wait();
            let _g = c.write().expect("il secondo aspetta il primo");
        });
        assert_eq!(
            c.lente(),
            0,
            "chi ha aspettato non è chi ha tenuto: la misura parte dall'acquisizione"
        );
    }

    /// E la riga è una, come quella del veleno — ma il conto no, perché una
    /// lentezza è un fatto e non uno stato: ne può capitare un'altra.
    #[test]
    fn la_riga_e_una_e_il_conto_cresce() {
        let c = Custodia::con_soglia("il vault di prova", 1_u32, Duration::from_millis(1));
        for _ in 0..3 {
            let _g = c.write().expect("prestito esclusivo");
            std::thread::sleep(Duration::from_millis(4));
        }
        assert_eq!(c.lente(), 3, "tre fatti, tre nel conto");
    }

    #[test]
    fn due_custodie_sono_due_stati() {
        let viva: Custodia<u32> = Custodia::new("il secondo vault", 7);
        let morta: Custodia<u32> = Custodia::new("il primo vault", 1);
        avvelena(&morta);
        assert!(morta.read().is_err());
        assert_eq!(
            *viva.read().expect("il secondo vault non c'entra niente"),
            7,
            "il veleno è del dato, non del processo"
        );
        assert_eq!(viva.denunce(), 0);
    }

    #[test]
    fn una_copia_e_lo_stesso_stato() {
        let c: Custodia<u32> = Custodia::new("il vault di prova", 1);
        let copia = c.clone();
        avvelena(&c);
        assert!(copia.read().is_err(), "clonare non è duplicare");
        drop(c.read());
        drop(copia.read());
        assert_eq!(copia.denunce(), 1, "una riga, non una per copia");
    }
}
