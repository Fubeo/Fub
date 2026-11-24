//! Le famiglie del Disegno completo (piano K6, `docs/architecture/disegno-completo.md`):
//! le 26 famiglie della mappa (`crates/fub-disegno/mappa.tsv`), ognuna con il
//! suo stato pigro.
//!
//! - **La mappa** si legge una volta sola ([`righe`]), dalle righe del motore,
//!   degli effetti e degli strumenti: id, famiglia e stato. Le righe
//!   dell'interfaccia e dei pannelli non hanno stato in Rust.
//! - **Lo stato di una famiglia** sta in un [`Pigro`] dello strato dei motori,
//!   dentro [`Famiglie`]: nasce alla prima chiamata della famiglia, o con
//!   `disegno.famiglia.prepara`, mai prima. Nato, si iscrive nel `Budget` dei
//!   servizi come una cache, `disegno.<famiglia>`: i suoi byte sono quelli
//!   delle tabelle del motore che la famiglia fa crescere (patch 0008), e
//!   liberarlo svuota le tabelle e lo rimette da nascere. Un comando che gira
//!   tiene il suo `Arc`: la famiglia liberata intanto cade dopo di lui.
//! - **Ogni famiglia ha il suo file**, `famiglie/<id>.rs`, con lo stato
//!   ([`StatoFamiglia`]): il task della famiglia lo riempie senza toccare
//!   questo modulo.
//! - **Un comando `disegno.<id>`** ([`esegui`]) prepara la sua famiglia, gira
//!   nella sessione del motore sulla selezione e passa per la differenza: rende
//!   le operazioni, o la lettura di un comando che non cambia il documento.
//!   [`Filtro::Fatte`] accetta solo le righe «fatto» della mappa;
//!   [`Filtro::Tutte`] anche le altre, ed esiste solo per le prove.
//! - **Preparare** ([`Famiglie::prepara`]) avvia la nascita in sottofondo
//!   (`Lavori::in_sottofondo`) e risponde subito; una seconda richiesta mentre
//!   il lavoro gira si unisce a lui. Spegnere le famiglie
//!   ([`Famiglie::spegni`]) le libera tutte e alza il numero di giro: l'esito
//!   di un lavoro di un giro passato si butta.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock, PoisonError, Weak};
use std::time::{Duration, Instant};

use fub_abi::{
    DrawingCommandRequest, DrawingDisabledReason, DrawingLoss, DrawingOutcome, DrawingPreview,
    DrawingRefusal, PluginError, Text, MAX_DRAWING_OPS_BYTES,
};
use fub_motori::{Cache, ErroreMotore, Pigro, Servizi};
use serde_json::Value;
use vectorcraft_doc::{Document, NodeId, Selection};
use vectorcraft_engine::EngineError;

use crate::apertura::Copia;
use crate::differenza;
use crate::gesti::{esito_vuoto, selezione_di_fub, Banco};

/// Il prefisso dei comandi del disegno; dopo c'è l'id del motore.
pub const PREFISSO: &str = "disegno.";

/// La mappa, letta dal sorgente: le righe e le colonne sono quelle che la
/// guardia `check-disegno-mappa.mjs` controlla.
const MAPPA: &str = include_str!("../../mappa.tsv");

/// Il documento di dopo un comando portato nel formato del disegno da una famiglia
/// ([`StatoFamiglia::traduci_dopo`]), e ciò che la traduzione ha lasciato fuori: va nelle
/// `losses` dell'esito, perché la perdita si dica.
pub(crate) struct Tradotto {
    pub documento: Document,
    pub perdite: Vec<DrawingLoss>,
}

/// Lo stato di una famiglia, nel suo file `famiglie/<id>.rs`.
///
/// Nasce alla prima chiamata della famiglia ([`StatoFamiglia::nasce`]);
/// [`StatoFamiglia::byte`] e [`StatoFamiglia::libera`] sono quelli della sua
/// cache nel `Budget`. Le altre funzioni hanno un comportamento di serie che
/// la famiglia cambia quando le serve.
pub(crate) trait StatoFamiglia: Send + Sync + 'static {
    /// Lo stato appena nato. Un errore lascia la famiglia da nascere: la
    /// chiamata dopo riprova.
    fn nasce(servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore>
    where
        Self: Sized;

    /// Quanti byte tiene adesso la famiglia (le sue tabelle e cache).
    fn byte(&self) -> u64;

    /// Svuota ciò che si può svuotare e dice quanti byte se ne sono andati.
    fn libera(&self) -> u64;

    /// Gli argomenti del comando `id` (del motore, senza prefisso) come li
    /// vuole il motore. Di serie restano come sono.
    fn adatta(&self, _id: &str, argomenti: Value) -> Result<Value, PluginError> {
        Ok(argomenti)
    }

    /// Il comando `id`, che va nella cronologia del motore, è una lettura
    /// quando non cambia il documento: cambia solo la sessione del motore e
    /// rende un valore (`paint.toggleActive` rende `{fillActive}`). Di serie
    /// no: un comando della cronologia che non cambia niente è `empty`.
    fn legge(&self, _id: &str) -> bool {
        false
    }

    /// La lettura di un comando che non cambia il documento, nella forma di
    /// `DrawingOutcome.reading`, sulla copia aperta (per tradurre i nodi del
    /// motore negli id del file). Di serie è il risultato del motore.
    fn lettura(&self, _id: &str, _copia: &Copia, risultato: Value) -> Value {
        risultato
    }

    /// Perché il comando `id` è spento sulla copia e sulla selezione date, o
    /// `None` se è acceso. Non fa nascere la famiglia; di serie è acceso.
    fn spento(_id: &str, _copia: &Copia, _selezione: &[String]) -> Option<DrawingDisabledReason>
    where
        Self: Sized,
    {
        None
    }

    /// Perché il comando `id` non si fa su questa copia e selezione, pur essendo
    /// acceso: un oggetto che quel comando non sa scrivere (per esempio il tratto
    /// a penna con `object.setProps`). Di serie nessuno; `esegui` rende il motivo
    /// come rifiuto del comando.
    fn rifiuto(_id: &str, _copia: &Copia, _selezione: &[String]) -> Option<DrawingRefusal>
    where
        Self: Sized,
    {
        None
    }

    /// Gli oggetti scelti su cui il comando `id` gira uno alla volta, ognuno
    /// da solo nella selezione del motore, quando il motore lo vuole su un
    /// oggetto solo (`text.setRangeStyle` chiede un testo): `None` di serie,
    /// e il comando gira una volta sola su tutta la selezione. Una lista vuota
    /// è `empty`: niente di ciò che è scelto lo prende.
    fn uno_alla_volta(_id: &str, _copia: &Copia, _selezione: &[String]) -> Option<Vec<NodeId>>
    where
        Self: Sized,
    {
        None
    }

    /// Il livello dove il comando `id` mette ciò che crea o sposta: la
    /// richiesta non ha un campo per il livello (lo strumento sì), e un
    /// comando che lo vuole lo legge dal suo `valore` (Sposta sul livello
    /// corrente). Di serie `None`: il motore lascia lo stato del documento
    /// com'è.
    fn livello(_id: &str, _copia: &Copia, _valore: &Value) -> Result<Option<NodeId>, DrawingRefusal>
    where
        Self: Sized,
    {
        Ok(None)
    }

    /// Perché il comando `id` non si fa con questi argomenti sulla copia e sulla selezione, pur acceso:
    /// un livello bloccato non si rinomina né si colora, e un livello non va dentro se stesso. Di serie
    /// nessuno.
    fn rifiuto_valore(
        _id: &str,
        _copia: &Copia,
        _selezione: &[String],
        _valore: &Value,
    ) -> Option<DrawingRefusal>
    where
        Self: Sized,
    {
        None
    }

    /// Gli argomenti del comando `id` completati con ciò che solo la copia e la selezione sanno, prima
    /// che il motore li veda: il nome di serie di un livello nuovo, che dipende dai livelli del file, o
    /// i livelli della selezione. Un argomento che il formato non tiene (il nome di un livello troppo
    /// lungo) è `BadArgs`, col perché, e niente cambia. Di serie restano come sono.
    fn argomenti_della_copia(
        _id: &str,
        _copia: &Copia,
        _selezione: &[String],
        valore: Value,
    ) -> Result<Value, PluginError>
    where
        Self: Sized,
    {
        Ok(valore)
    }

    /// Perché il risultato del comando `id` non si scrive, visto il documento
    /// del motore `dopo` e gli oggetti che il motore ha lasciato scelti: un
    /// oggetto toccato che la famiglia non lascia cambiare, un risultato che
    /// non fa ciò che il comando dice. Di serie nessuno; `esegui` lo rende come
    /// rifiuto, e niente cambia.
    fn rifiuto_dopo(
        _id: &str,
        _copia: &Copia,
        _dopo: &Document,
        _scelti_dopo: &[NodeId],
    ) -> Option<DrawingRefusal>
    where
        Self: Sized,
    {
        None
    }

    /// La traduzione del documento che il motore ha lasciato dopo il comando `id`, nel formato del
    /// disegno, prima della differenza: un comando che copia roba che il file non scrive (K6 T14, i
    /// campioni di una libreria o quelli predefiniti) la riporta com'è il file, e dice ciò che ha
    /// lasciato fuori ([`Tradotto::perdite`]). `Ok(None)` se non c'è niente da tradurre; un errore
    /// per un risultato che il file non prende e che la famiglia sa dire in italiano (un gruppo di
    /// colori vuoto). Di serie nessuna traduzione.
    fn traduci_dopo(
        _id: &str,
        _copia: &Copia,
        _dopo: &Document,
    ) -> Result<Option<Tradotto>, PluginError>
    where
        Self: Sized,
    {
        Ok(None)
    }

    /// Il rifiuto per un errore del motore sul comando `id`, quando la famiglia
    /// sa che cosa vuol dire: un'operazione fra tracciati che non lascia
    /// niente è `empty`, non un errore. Di serie nessuno, e `esegui` rende
    /// `unsupported`; in ogni caso niente cambia.
    fn rifiuto_del_motore(_id: &str, _errore: &EngineError) -> Option<DrawingRefusal>
    where
        Self: Sized,
    {
        None
    }

    /// Il rifiuto del comando `id` che la famiglia sa prima di legare la scelta ai nodi del motore: un
    /// elemento senza nodo (un rettangolo di Fub) darebbe `unmapped`, e il perché sarebbe sbagliato
    /// (K6 T12, finestre). Di serie nessuno.
    fn rifiuto_prima_dei_nodi(
        _id: &str,
        _copia: &Copia,
        _selezione: &[String],
    ) -> Option<DrawingRefusal>
    where
        Self: Sized,
    {
        None
    }

    /// La frase in italiano per un argomento che il motore rifiuta (`BadParams`, con il
    /// messaggio del motore): quando la famiglia sa dire il perché (K6 T14, temi). Di serie
    /// `None`, e `esegui` rende il messaggio del motore com'è.
    fn messaggio_del_motore(_id: &str, _messaggio: &str) -> Option<String>
    where
        Self: Sized,
    {
        None
    }
}

/// Le 26 famiglie, nell'ordine di `fub_abi::DRAWING_FAMILIES`: per ognuna la
/// variante, il modulo e il nome nella mappa.
macro_rules! famiglie {
    ($($variante:ident, $modulo:ident, $nome:literal;)*) => {
        $(mod $modulo;)*

        /// Una famiglia della mappa.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum Famiglia {
            $(#[doc = concat!("`", $nome, "`")] $variante,)*
        }

        impl Famiglia {
            /// Tutte, nell'ordine della mappa e del contratto.
            pub const TUTTE: [Famiglia; 26] = [$(Famiglia::$variante,)*];

            /// Il nome nella mappa e nel contratto.
            pub fn nome(self) -> &'static str {
                match self {
                    $(Famiglia::$variante => $nome,)*
                }
            }

            /// Lo stato appena nato della famiglia.
            fn nasce(self, servizi: &Arc<Servizi>) -> Result<Box<dyn StatoFamiglia>, ErroreMotore> {
                match self {
                    $(Famiglia::$variante => Ok(Box::new(
                        <$modulo::Stato as StatoFamiglia>::nasce(servizi)?,
                    )),)*
                }
            }

            /// Perché il comando `id` della famiglia è spento.
            fn spento(
                self,
                id: &str,
                copia: &Copia,
                selezione: &[String],
            ) -> Option<DrawingDisabledReason> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::spento(id, copia, selezione)
                    })*
                }
            }

            /// Perché il comando `id` non si fa con questi argomenti, pur acceso.
            fn rifiuto_valore(
                self,
                id: &str,
                copia: &Copia,
                selezione: &[String],
                valore: &Value,
            ) -> Option<DrawingRefusal> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::rifiuto_valore(id, copia, selezione, valore)
                    })*
                }
            }

            /// Gli argomenti del comando `id` con ciò che solo la copia sa.
            fn argomenti_della_copia(
                self,
                id: &str,
                copia: &Copia,
                selezione: &[String],
                valore: Value,
            ) -> Result<Value, PluginError> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::argomenti_della_copia(id, copia, selezione, valore)
                    })*
                }
            }

            /// Perché il comando `id` non si fa su questa copia e selezione, pur acceso.
            fn rifiuto(
                self,
                id: &str,
                copia: &Copia,
                selezione: &[String],
            ) -> Option<DrawingRefusal> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::rifiuto(id, copia, selezione)
                    })*
                }
            }

            /// Gli oggetti su cui il comando `id` gira uno alla volta, se la famiglia lo vuole.
            fn uno_alla_volta(
                self,
                id: &str,
                copia: &Copia,
                selezione: &[String],
            ) -> Option<Vec<NodeId>> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::uno_alla_volta(id, copia, selezione)
                    })*
                }
            }

            /// Il livello dove il comando `id` mette ciò che crea, se la famiglia lo sceglie.
            fn livello(
                self,
                id: &str,
                copia: &Copia,
                valore: &Value,
            ) -> Result<Option<NodeId>, DrawingRefusal> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::livello(id, copia, valore)
                    })*
                }
            }

            /// Perché il risultato del comando `id` non si scrive.
            fn rifiuto_dopo(
                self,
                id: &str,
                copia: &Copia,
                dopo: &Document,
                scelti_dopo: &[NodeId],
            ) -> Option<DrawingRefusal> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::rifiuto_dopo(id, copia, dopo, scelti_dopo)
                    })*
                }
            }

            /// La traduzione del documento dopo il comando `id`, se la famiglia ne ha una, con ciò
            /// che ha lasciato fuori.
            fn traduci_dopo(
                self,
                id: &str,
                copia: &Copia,
                dopo: Arc<Document>,
            ) -> Result<(Arc<Document>, Vec<DrawingLoss>), PluginError> {
                let tradotto = match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::traduci_dopo(id, copia, &dopo)
                    })*
                }?;
                Ok(match tradotto {
                    Some(t) => (Arc::new(t.documento), t.perdite),
                    None => (dopo, Vec::new()),
                })
            }

            /// Il rifiuto per un errore del motore sul comando `id`, se la famiglia lo sa.
            fn rifiuto_del_motore(self, id: &str, errore: &EngineError) -> Option<DrawingRefusal> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::rifiuto_del_motore(id, errore)
                    })*
                }
            }

            /// Il rifiuto della famiglia prima dei nodi della scelta, se ce n'è uno.
            fn rifiuto_prima_dei_nodi(self, id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::rifiuto_prima_dei_nodi(id, copia, selezione)
                    })*
                }
            }

            /// La frase in italiano per un argomento che il motore rifiuta, se la famiglia la sa.
            fn messaggio_del_motore(self, id: &str, messaggio: &str) -> Option<String> {
                match self {
                    $(Famiglia::$variante => {
                        <$modulo::Stato as StatoFamiglia>::messaggio_del_motore(id, messaggio)
                    })*
                }
            }
        }

        /// Un `Pigro` per famiglia, nello stesso ordine.
        fn caselle() -> [Pigro<Nata>; 26] {
            [$(Pigro::nuovo(|servizi: &Arc<Servizi>| Nata::nuova(Famiglia::$variante, servizi)),)*]
        }
    };
}

/// L'inchiostro di Fub e gli strumenti dei tracciati (T12): il ponte lo
/// chiede a ogni `commit`.
pub(crate) use tracciati::inchiostro_toccato;

/// I pennelli che deformano (T17): spostano i punti come gli strumenti dei tracciati.
pub(crate) use pennelli::STRUMENTI_LIQUEFA;

famiglie! {
    Aspetto, aspetto, "aspetto";
    Automazione, automazione, "automazione";
    Colore, colore, "colore";
    Dati, dati, "dati";
    Dinamici, dinamici, "dinamici";
    Effetti, effetti, "effetti";
    Formati, formati, "formati";
    Forme, forme, "forme";
    Grafici, grafici, "grafici";
    Immagini, immagini, "immagini";
    Livelli, livelli, "livelli";
    Nucleo, nucleo, "nucleo";
    Pennelli, pennelli, "pennelli";
    Prospettiva, prospettiva, "prospettiva";
    Pulizia, pulizia, "pulizia";
    Raster, raster, "raster";
    Simboli, simboli, "simboli";
    Stampa, stampa, "stampa";
    Tavole, tavole, "tavole";
    Testo, testo, "testo";
    Tracciati, tracciati, "tracciati";
    Trame, trame, "trame";
    Trasforma, trasforma, "trasforma";
    TreD, tre_d, "tre-d";
    Vista, vista, "vista";
    Web, web, "web";
}

impl Famiglia {
    /// La famiglia con questo nome, se la mappa la conosce.
    pub fn da_nome(nome: &str) -> Option<Famiglia> {
        Famiglia::TUTTE.into_iter().find(|f| f.nome() == nome)
    }

    fn indice(self) -> usize {
        self as usize
    }
}

// ---------------------------------------------------------------------------
// La mappa
// ---------------------------------------------------------------------------

/// Da dove viene una riga della mappa (la colonna `fonte`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Fonte {
    /// Un comando del motore.
    Motore,
    /// Un effetto.
    Effetto,
    /// Uno strumento.
    Strumento,
}

/// A che punto è una riga della mappa (la colonna `stato`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatoRiga {
    /// Ha il suo caso: si raggiunge e fa ciò che fa nel motore.
    Fatto,
    /// Ancora da fare.
    DaFare,
    /// La serve già una funzione di Fub.
    Fub,
    /// Fub non la offre.
    Escluso,
}

/// Una riga della mappa del motore, degli effetti o degli strumenti.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Riga {
    pub fonte: Fonte,
    pub id: String,
    /// La colonna `famiglia` come la scrive la mappa (anche `fub` o
    /// `escluso`, che non sono famiglie).
    pub nome_famiglia: String,
    /// La famiglia, se la colonna ne nomina una.
    pub famiglia: Option<Famiglia>,
    pub stato: StatoRiga,
    /// La feature del motore dietro cui sta, per le righe `sotto:<feature>`
    /// della colonna `pigro` (formati, plug-in, script: fuori da `completo`).
    pub sotto: Option<String>,
}

/// La mappa letta: le righe in ordine e l'indice per fonte e id.
struct Mappa {
    righe: Vec<Riga>,
    indice: HashMap<(Fonte, String), usize>,
}

/// Le righe della mappa che hanno stato in Rust, lette una volta sola.
///
/// # Panics
///
/// Se la mappa compilata non ha le colonne attese o ha uno stato che non
/// conosce: la guardia della mappa e la prova di questo modulo lo vedono
/// prima.
pub fn righe() -> &'static [Riga] {
    &mappa().righe
}

fn mappa() -> &'static Mappa {
    static MAPPA_LETTA: OnceLock<Mappa> = OnceLock::new();
    MAPPA_LETTA.get_or_init(|| leggi(MAPPA).expect("la mappa compilata si legge"))
}

/// Legge il testo della mappa.
fn leggi(testo: &str) -> Result<Mappa, String> {
    let mut linee = testo.lines().filter(|l| !l.starts_with('#'));
    let testa: Vec<&str> = linee
        .next()
        .ok_or("la mappa non ha l'intestazione")?
        .split('\t')
        .collect();
    let colonna = |nome: &str| {
        testa
            .iter()
            .position(|c| *c == nome)
            .ok_or_else(|| format!("la mappa non ha la colonna `{nome}`"))
    };
    let (c_fonte, c_id, c_famiglia, c_stato, c_pigro) = (
        colonna("fonte")?,
        colonna("id")?,
        colonna("famiglia")?,
        colonna("stato")?,
        colonna("pigro")?,
    );
    let mut righe = Vec::new();
    let mut indice = HashMap::new();
    for (n, linea) in linee.enumerate() {
        if linea.is_empty() {
            continue;
        }
        let celle: Vec<&str> = linea.split('\t').collect();
        let cella = |c: usize| {
            celle
                .get(c)
                .copied()
                .ok_or_else(|| format!("la riga {} della mappa è corta", n + 3))
        };
        let fonte = match cella(c_fonte)? {
            "motore" => Fonte::Motore,
            "effetto" => Fonte::Effetto,
            "strumento" => Fonte::Strumento,
            // L'interfaccia e i pannelli non hanno stato in Rust.
            _ => continue,
        };
        let stato = match cella(c_stato)? {
            "fatto" => StatoRiga::Fatto,
            "da fare" => StatoRiga::DaFare,
            "fub" => StatoRiga::Fub,
            "escluso" => StatoRiga::Escluso,
            altro => {
                return Err(format!(
                    "la riga {} della mappa ha lo stato `{altro}`",
                    n + 3
                ))
            }
        };
        let nome_famiglia = cella(c_famiglia)?.to_string();
        let riga = Riga {
            fonte,
            id: cella(c_id)?.to_string(),
            famiglia: Famiglia::da_nome(&nome_famiglia),
            nome_famiglia,
            stato,
            sotto: cella(c_pigro)?.strip_prefix("sotto:").map(str::to_string),
        };
        indice.insert((fonte, riga.id.clone()), righe.len());
        righe.push(riga);
    }
    Ok(Mappa { righe, indice })
}

/// La riga di `id` per la fonte data.
pub fn riga(fonte: Fonte, id: &str) -> Option<&'static Riga> {
    let mappa = mappa();
    mappa
        .indice
        .get(&(fonte, id.to_string()))
        .map(|&i| &mappa.righe[i])
}

/// La famiglia di `id`: di un comando del motore, se no di un effetto, se no
/// di uno strumento.
pub fn famiglia_di(id: &str) -> Option<Famiglia> {
    [Fonte::Motore, Fonte::Effetto, Fonte::Strumento]
        .into_iter()
        .find_map(|fonte| riga(fonte, id))
        .and_then(|r| r.famiglia)
}

/// Quali righe della mappa si eseguono.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Filtro {
    /// Solo le righe «fatto»: quelle che l'IPC raggiunge.
    #[default]
    Fatte,
    /// Anche quelle da fare: solo per le prove, l'IPC non lo accende.
    Tutte,
}

// ---------------------------------------------------------------------------
// Le tabelle del motore
// ---------------------------------------------------------------------------

/// I byte delle tabelle del motore nominate (`vectorcraft_engine::tables`,
/// patch 0008). Un nome che il motore non ha conta zero: la prova del modulo
/// lo vede.
pub(crate) fn byte_delle_tabelle(nomi: &[&str]) -> u64 {
    vectorcraft_engine::tables::tables()
        .iter()
        .filter(|t| nomi.contains(&t.name))
        .map(|t| (t.bytes)() as u64)
        .sum()
}

/// Svuota le tabelle nominate che si possono svuotare; dice quanti byte se
/// ne sono andati.
pub(crate) fn libera_le_tabelle(nomi: &[&str]) -> u64 {
    let prima = byte_delle_tabelle(nomi);
    for t in vectorcraft_engine::tables::tables() {
        if let (true, Some(svuota)) = (nomi.contains(&t.name), t.release) {
            let _ = vectorcraft_engine::guard::catch_panic(svuota);
        }
    }
    prima.saturating_sub(byte_delle_tabelle(nomi))
}

// ---------------------------------------------------------------------------
// Lo stato nato e il suo Budget
// ---------------------------------------------------------------------------

/// Lo stato nato di una famiglia: la cache che si iscrive nel `Budget`.
pub struct Nata {
    famiglia: Famiglia,
    nome: String,
    stato: Box<dyn StatoFamiglia>,
    ultimo_uso: Mutex<Instant>,
    /// Le famiglie che la tengono, per tornare da nascere quando il `Budget`
    /// la libera.
    casa: OnceLock<Weak<Famiglie>>,
    /// Vero dopo l'iscrizione nel `Budget`.
    iscritta: AtomicBool,
}

impl Nata {
    fn nuova(famiglia: Famiglia, servizi: &Arc<Servizi>) -> Result<Nata, ErroreMotore> {
        Ok(Nata {
            famiglia,
            nome: format!("disegno.{}", famiglia.nome()),
            stato: famiglia.nasce(servizi)?,
            ultimo_uso: Mutex::new(Instant::now()),
            casa: OnceLock::new(),
            iscritta: AtomicBool::new(false),
        })
    }

    /// La famiglia di questo stato.
    pub fn famiglia(&self) -> Famiglia {
        self.famiglia
    }

    /// Lo stato della famiglia.
    pub(crate) fn stato(&self) -> &dyn StatoFamiglia {
        self.stato.as_ref()
    }

    fn usata(&self) {
        *self
            .ultimo_uso
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Instant::now();
    }
}

impl Cache for Nata {
    fn nome(&self) -> &str {
        &self.nome
    }

    fn byte(&self) -> u64 {
        self.stato.byte()
    }

    /// Svuota lo stato e lo rimette da nascere. Chi tiene ancora un `Arc`
    /// (un comando che gira) lo tiene vivo fino alla sua fine.
    fn libera(&self, _quanto: u64) -> u64 {
        let reso = self.stato.libera();
        if let Some(casa) = self.casa.get().and_then(Weak::upgrade) {
            casa.dimentica(self);
        }
        reso
    }

    fn ultimo_uso(&self) -> Instant {
        *self
            .ultimo_uso
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// Che cosa ha fatto [`Famiglie::prepara`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Preparazione {
    /// La famiglia è già nata.
    Pronta,
    /// La famiglia nasce in sottofondo (avviata adesso o già in corso).
    InCorso,
    /// Il `Budget` non ha memoria per farla nascere.
    NoMemory,
}

impl Preparazione {
    /// Il nome nella lettura di `disegno.famiglia.prepara`.
    pub fn nome(self) -> &'static str {
        match self {
            Preparazione::Pronta => "pronta",
            Preparazione::InCorso => "in-corso",
            Preparazione::NoMemory => "no-memory",
        }
    }
}

/// I lavori di preparazione, sotto il lucchetto di [`Famiglie`].
#[derive(Default)]
struct Preparazioni {
    /// Le famiglie che nascono in sottofondo adesso.
    in_corso: [bool; 26],
    /// L'errore dell'ultimo lavoro fallito, dato una volta sola alla
    /// richiesta dopo.
    fallite: [Option<String>; 26],
}

/// Gli stati delle 26 famiglie di un motore del disegno.
pub struct Famiglie {
    servizi: Arc<Servizi>,
    caselle: [Pigro<Nata>; 26],
    /// Il numero di giro: sale a ogni [`Famiglie::spegni`].
    giro: AtomicU64,
    preparazioni: Mutex<Preparazioni>,
    finito: Condvar,
    lavori: AtomicUsize,
    nascite: [AtomicUsize; 26],
}

impl Famiglie {
    /// Le famiglie, tutte da nascere, sui servizi dati.
    pub fn nuove(servizi: Arc<Servizi>) -> Arc<Famiglie> {
        Arc::new(Famiglie {
            servizi,
            caselle: caselle(),
            giro: AtomicU64::new(0),
            preparazioni: Mutex::default(),
            finito: Condvar::new(),
            lavori: AtomicUsize::new(0),
            nascite: Default::default(),
        })
    }

    fn casella(&self, famiglia: Famiglia) -> &Pigro<Nata> {
        &self.caselle[famiglia.indice()]
    }

    fn preparazioni(&self) -> std::sync::MutexGuard<'_, Preparazioni> {
        self.preparazioni
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Lo stato della famiglia, che nasce adesso se non c'è. Durante una
    /// nascita avviata da altri (un lavoro di preparazione) aspetta quella.
    pub fn prendi(self: &Arc<Self>, famiglia: Famiglia) -> Result<Arc<Nata>, ErroreMotore> {
        let nata = self.casella(famiglia).prendi(&self.servizi)?;
        self.iscrivi(&nata);
        nata.usata();
        Ok(nata)
    }

    /// Iscrive nel `Budget` uno stato appena nato, una volta sola.
    fn iscrivi(self: &Arc<Self>, nata: &Arc<Nata>) {
        if nata.iscritta.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = nata.casa.set(Arc::downgrade(self));
        self.nascite[nata.famiglia.indice()].fetch_add(1, Ordering::SeqCst);
        let cache: Arc<dyn Cache> = Arc::clone(nata) as Arc<dyn Cache>;
        self.servizi.memoria().registra(&cache);
    }

    /// Rimette da nascere la famiglia di `nata`, se è ancora lei a tenere la
    /// casella: una famiglia rinata intanto resta com'è.
    fn dimentica(&self, nata: &Nata) {
        let casella = self.casella(nata.famiglia);
        let sua = casella
            .se_acceso()
            .is_some_and(|attuale| std::ptr::eq(Arc::as_ptr(&attuale), nata));
        if sua {
            casella.libera();
        }
    }

    /// Lo stato della famiglia se è nato, senza farlo nascere.
    pub fn se_nata(&self, famiglia: Famiglia) -> Option<Arc<Nata>> {
        self.casella(famiglia).se_acceso()
    }

    /// Le famiglie nate adesso.
    pub fn nate(&self) -> Vec<Famiglia> {
        Famiglia::TUTTE
            .into_iter()
            .filter(|f| self.casella(*f).acceso())
            .collect()
    }

    /// I byte delle famiglie nate.
    pub fn byte(&self) -> u64 {
        Famiglia::TUTTE
            .into_iter()
            .filter_map(|f| self.se_nata(f))
            .map(|nata| nata.byte())
            .sum()
    }

    /// Vero se il `Budget` ha posto per una famiglia che nasce: prima libera
    /// ciò che può, poi guarda se sta sotto il tetto.
    fn c_e_memoria(&self) -> bool {
        let conto = self.servizi.memoria().rispetta();
        conto.saltato || conto.dopo <= conto.tetto
    }

    /// Lo stato della famiglia per un comando: quello nato, o uno che nasce
    /// adesso se il `Budget` ha memoria. `Ok(None)` vuol dire `NoMemory`.
    pub fn per_un_comando(
        self: &Arc<Self>,
        famiglia: Famiglia,
    ) -> Result<Option<Arc<Nata>>, ErroreMotore> {
        if let Some(nata) = self.se_nata(famiglia) {
            nata.usata();
            return Ok(Some(nata));
        }
        // Una preparazione in corso ha già guardato la memoria: ci si unisce.
        let in_corso = self.preparazioni().in_corso[famiglia.indice()];
        if !in_corso && !self.c_e_memoria() {
            return Ok(None);
        }
        self.prendi(famiglia).map(Some)
    }

    /// Prepara la famiglia: avvia la sua nascita in sottofondo e risponde
    /// subito. Una famiglia già nata è pronta; una che nasce già si unisce a
    /// quel lavoro; un lavoro precedente fallito dà il suo errore, una volta.
    pub fn prepara(self: &Arc<Self>, famiglia: Famiglia) -> Result<Preparazione, PluginError> {
        if self.casella(famiglia).acceso() {
            return Ok(Preparazione::Pronta);
        }
        let i = famiglia.indice();
        {
            let mut preparazioni = self.preparazioni();
            if preparazioni.in_corso[i] {
                return Ok(Preparazione::InCorso);
            }
            if let Some(errore) = preparazioni.fallite[i].take() {
                return Err(PluginError::Internal(errore.into()));
            }
        }
        // Il `Budget` libera senza il lucchetto delle preparazioni: le cache
        // che libera possono essere famiglie.
        if !self.c_e_memoria() {
            return Ok(Preparazione::NoMemory);
        }
        {
            let mut preparazioni = self.preparazioni();
            if preparazioni.in_corso[i] {
                return Ok(Preparazione::InCorso);
            }
            preparazioni.in_corso[i] = true;
        }
        self.lavori.fetch_add(1, Ordering::SeqCst);
        // Il lavoro porta con sé la sua fine: anche se non parte, o va in
        // panico, la famiglia non resta «in corso».
        let fine = FineDelLavoro {
            famiglie: Arc::clone(self),
            famiglia,
        };
        let giro = self.giro.load(Ordering::SeqCst);
        self.servizi.lavori().in_sottofondo(move || {
            let famiglie = &fine.famiglie;
            match famiglie.casella(famiglia).prendi(&famiglie.servizi) {
                Ok(nata) if famiglie.giro.load(Ordering::SeqCst) == giro => {
                    famiglie.iscrivi(&nata);
                }
                Ok(nata) => {
                    // Spente mentre nasceva: l'esito si butta.
                    famiglie.dimentica(&nata);
                }
                Err(errore) if famiglie.giro.load(Ordering::SeqCst) == giro => {
                    // Il motivo arriva alla richiesta dopo, una volta.
                    famiglie.preparazioni().fallite[famiglia.indice()] = Some(errore.to_string());
                }
                Err(_) => {}
            }
            drop(fine);
        });
        Ok(Preparazione::InCorso)
    }

    /// Libera ogni famiglia nata: tornano da nascere e lasciano il `Budget`
    /// quando cade l'ultimo `Arc`. Dice quanti byte se ne sono andati.
    pub fn libera_tutte(&self) -> u64 {
        Famiglia::TUTTE
            .into_iter()
            .filter_map(|f| self.se_nata(f))
            .map(|nata| Cache::libera(nata.as_ref(), u64::MAX))
            .sum()
    }

    /// Il componente si spegne: un nuovo giro, così che l'esito dei lavori
    /// in corso si butti, e ogni famiglia si libera.
    pub fn spegni(&self) -> u64 {
        self.giro.fetch_add(1, Ordering::SeqCst);
        self.libera_tutte()
    }

    /// Quanti lavori di preparazione sono partiti (per le prove).
    #[doc(hidden)]
    pub fn lavori_avviati(&self) -> usize {
        self.lavori.load(Ordering::SeqCst)
    }

    /// Quante volte la famiglia è nata (per le prove).
    #[doc(hidden)]
    pub fn nascite(&self, famiglia: Famiglia) -> usize {
        self.nascite[famiglia.indice()].load(Ordering::SeqCst)
    }

    /// Aspetta, fino a `massimo`, che nessuna famiglia stia nascendo in
    /// sottofondo; vero se è così (per le prove).
    #[doc(hidden)]
    pub fn aspetta_i_lavori(&self, massimo: Duration) -> bool {
        let preparazioni = self.preparazioni();
        let (preparazioni, _) = self
            .finito
            .wait_timeout_while(preparazioni, massimo, |p| p.in_corso.iter().any(|x| *x))
            .unwrap_or_else(PoisonError::into_inner);
        !preparazioni.in_corso.iter().any(|x| *x)
    }
}

/// La fine di un lavoro di preparazione, quando cade.
struct FineDelLavoro {
    famiglie: Arc<Famiglie>,
    famiglia: Famiglia,
}

impl Drop for FineDelLavoro {
    fn drop(&mut self) {
        self.famiglie.preparazioni().in_corso[self.famiglia.indice()] = false;
        self.famiglie.finito.notify_all();
    }
}

// ---------------------------------------------------------------------------
// I comandi
// ---------------------------------------------------------------------------

/// Il messaggio di una riga che il filtro non lascia passare.
fn non_fatta() -> PluginError {
    PluginError::Unserved(Text::key("host.drawing.not_done"))
}

/// La riga del comando `disegno.<id>` che il filtro lascia passare, con la
/// sua famiglia; `Ok(None)` per un id che il motore non serve qui.
fn riga_del_comando(
    id: &str,
    filtro: Filtro,
) -> Result<Option<(&'static Riga, Famiglia)>, PluginError> {
    let Some(riga) = id
        .strip_prefix(PREFISSO)
        .and_then(|id| riga(Fonte::Motore, id))
    else {
        return Ok(None);
    };
    let Some(famiglia) = riga.famiglia else {
        return Ok(None);
    };
    match riga.stato {
        StatoRiga::Fub | StatoRiga::Escluso => return Ok(None),
        // Le righe dietro una feature del motore che `completo` non accende.
        _ if riga.sotto.is_some() => return Ok(None),
        StatoRiga::DaFare if filtro == Filtro::Fatte => return Err(non_fatta()),
        StatoRiga::Fatto | StatoRiga::DaFare => {}
    }
    Ok(Some((riga, famiglia)))
}

/// Il comando del motore dietro ogni voce del menu Effetto: la voce lo chiama
/// col suo effetto (`effect`, o `id` come la chiave vecchia del motore).
const APPLICA_EFFETTO: &str = "effect.apply";

/// L'effetto che `effect.apply` aggiunge passa come una riga sua: «fatto», o
/// «da fare» col filtro delle prove; una riga da fare con il filtro dell'IPC
/// non è servita, come un comando da fare. `false` (rifiutato) per un effetto
/// di Fub, escluso, dietro una feature spenta o che la mappa non ha: il motore
/// non lo vede. Senza nome decide il motore (dà l'errore degli argomenti).
fn effetto_servito(valore: &Value, filtro: Filtro) -> Result<bool, PluginError> {
    let Some(id) = valore
        .get("effect")
        .or_else(|| valore.get("id"))
        .and_then(Value::as_str)
    else {
        return Ok(true);
    };
    let Some(riga) = riga(Fonte::Effetto, id) else {
        return Ok(false);
    };
    match riga.stato {
        StatoRiga::Fub | StatoRiga::Escluso => Ok(false),
        _ if riga.sotto.is_some() => Ok(false),
        StatoRiga::DaFare if filtro == Filtro::Fatte => Err(non_fatta()),
        StatoRiga::Fatto | StatoRiga::DaFare => Ok(true),
    }
}

/// Le righe «fatto» del motore, come comandi del disegno accesi o spenti
/// sulla selezione. Nessuna famiglia nasce per dirlo.
pub(crate) fn elenco(copia: &Copia, selezione: &[String]) -> Vec<fub_abi::DrawingCommandInfo> {
    righe()
        .iter()
        .filter(|r| r.fonte == Fonte::Motore && r.stato == StatoRiga::Fatto && r.sotto.is_none())
        .filter_map(|r| {
            let famiglia = r.famiglia?;
            let perche = famiglia.spento(&r.id, copia, selezione);
            Some(fub_abi::DrawingCommandInfo {
                id: format!("{PREFISSO}{}", r.id),
                enabled: perche.is_none(),
                disabled_reason: perche,
            })
        })
        .collect()
}

/// I comandi che un disegno in sola lettura fa lo stesso: copiare e leggere gli
/// appunti, che non cambiano il file. Tagliare, incollare, importare e i
/// conflitti di campioni restano rifiutati.
fn si_legge_in_sola_lettura(id: &str) -> bool {
    matches!(
        id,
        "edit.copy"
            // I temi del colore stanno nelle preferenze, non nel disegno: si salvano e si tolgono
            // anche in sola lettura (K6 T14, temi).
            | "colorTheme.save"
            | "colorTheme.delete"
            // Le librerie di campioni: salvarne una e caricarne una dai dati non scrivono il disegno
            // (K6 T14, librerie).
            | "swatch.library.save"
            | "swatch.library.load"
            | "clipboard.flavours"
            | "clipboard.exportSvg"
            | "clipboard.exportPng"
            | "clipboard.exportText"
    )
}

/// Esegue il comando `disegno.<id>` della richiesta: prepara la sua
/// famiglia, lo fa girare nella sessione del motore sulla selezione e passa
/// per la differenza. Le operazioni, se il documento cambia; la lettura, se
/// il comando non va nella cronologia del motore (o la famiglia lo dice una
/// lettura, `StatoFamiglia::legge`) e rende un valore; se no
/// `empty`. Con `preview` il documento che cambierebbe dà i contorni dei
/// tracciati nuovi o cambiati (`DrawingPreview::overlays`), senza operazioni:
/// niente arriva al file finché il client non manda il comando senza. Un id che il motore non serve qui è `unsupported`, uno che il
/// filtro non lascia passare `Unserved`, argomenti che il motore rifiuta
/// `BadArgs`.
pub(crate) fn esegui(
    famiglie: &Arc<Famiglie>,
    filtro: Filtro,
    banco: &mut Banco,
    copia: &Copia,
    richiesta: &DrawingCommandRequest,
) -> Result<DrawingOutcome, PluginError> {
    let rifiuta = |r: DrawingRefusal| DrawingOutcome {
        refused: Some(r),
        ..esito_vuoto(richiesta.revision)
    };
    let Some((riga, famiglia)) = riga_del_comando(&richiesta.id, filtro)? else {
        return Ok(rifiuta(DrawingRefusal::Unsupported));
    };
    if riga.id == APPLICA_EFFETTO && !effetto_servito(&richiesta.value, filtro)? {
        return Ok(rifiuta(DrawingRefusal::Unsupported));
    }
    let nata = match famiglie.per_un_comando(famiglia) {
        Ok(Some(nata)) => nata,
        Ok(None) => return Ok(rifiuta(DrawingRefusal::NoMemory)),
        Err(errore) => return Err(PluginError::Internal(errore.to_string().into())),
    };
    // In sola lettura il file non cambia: si copia e si leggono gli appunti (il
    // Completo copia da qui), ma non si taglia, non si incolla e non si importa.
    if !copia.modificabile && !si_legge_in_sola_lettura(&riga.id) {
        return Ok(rifiuta(DrawingRefusal::Unsupported));
    }
    if let Some(motivo) = famiglia.rifiuto_prima_dei_nodi(&riga.id, copia, &richiesta.selection) {
        return Ok(rifiuta(motivo));
    }
    let scelti = match nodi_scelti(copia, &richiesta.selection) {
        Ok(scelti) => scelti,
        Err(r) => return Ok(rifiuta(r)),
    };
    if let Some(motivo) = famiglia.rifiuto(&riga.id, copia, &richiesta.selection) {
        return Ok(rifiuta(motivo));
    }
    if let Some(motivo) =
        famiglia.rifiuto_valore(&riga.id, copia, &richiesta.selection, &richiesta.value)
    {
        return Ok(rifiuta(motivo));
    }
    let livello = match famiglia.livello(&riga.id, copia, &richiesta.value) {
        Ok(livello) => livello,
        Err(motivo) => return Ok(rifiuta(motivo)),
    };
    // I punti scelti di un comando sui punti (T12): tolti dal valore, vanno
    // nella selezione del motore.
    let mut valore = famiglia.argomenti_della_copia(
        &riga.id,
        copia,
        &richiesta.selection,
        richiesta.value.clone(),
    )?;
    let punti = if famiglia == Famiglia::Tracciati
        && tracciati::SUI_PUNTI.contains(&riga.id.as_str())
    {
        if tracciati::sceglie_inchiostro(copia, &richiesta.selection) {
            return Ok(rifiuta(DrawingRefusal::Unmapped));
        }
        match tracciati::punti(copia, &mut valore) {
            Ok(punti) => punti,
            Err(tracciati::Rifiuto::Motore(r)) => return Ok(rifiuta(r)),
            Err(tracciati::Rifiuto::Argomenti(m)) => return Err(PluginError::BadArgs(m.into())),
        }
    } else {
        Default::default()
    };
    // Un comando che il motore vuole su un oggetto solo gira una volta per
    // oggetto, nella stessa copia: la differenza li scrive in un passo.
    let giri: Vec<Vec<NodeId>> =
        match famiglia.uno_alla_volta(&riga.id, copia, &richiesta.selection) {
            Some(uno) if uno.is_empty() => return Ok(rifiuta(DrawingRefusal::Empty)),
            Some(uno) => uno.into_iter().map(|n| vec![n]).collect(),
            None => vec![scelti.clone()],
        };
    let argomenti = nata.stato().adatta(&riga.id, valore)?;
    let pennello_colore = if riga.id == tracciati::pennello::PENNELLO {
        tracciati::pennello::colore(&argomenti)
    } else {
        None
    };
    // Un gesto lasciato a metà non entra nel comando.
    if banco.in_corso.is_some() {
        banco.ripristina(copia);
    }
    // `select.reselect` ripete l'ultimo comando di selezione, che il motore non
    // ricorda fra due richieste: il ricordo del banco va nello stato del documento.
    let ultimo = banco.ultimo_di_selezione.clone();
    let scelti_dello_strumento = banco.scelti_dello_strumento.clone();
    let sessione = &mut banco.sessione;
    let fatto = vectorcraft_engine::guard::catch_panic(|| {
        // I punti scelti della Maglia tornano scelti per i comandi che li
        // leggono, prima che il comando sostituisca la selezione.
        crate::gesti::strumento::scelti_per_il_comando(
            sessione,
            &riga.id,
            scelti_dello_strumento.as_ref(),
        )?;
        // Il comando cambia anche lo stile delle forme nuove: quello della
        // sessione resta com'era.
        let stile = sessione.paint.clone();
        // Il pennello tondo dipinge col colore che il client ha mandato: solo per questo comando, poi la
        // tavolozza della sessione torna com'era (qui sotto).
        if let Some(colore) = pennello_colore {
            sessione.paint.stroke = vectorcraft_color::Paint::solid(colore);
        }
        let mut fatto = Ok(Value::Null);
        for giro in &giri {
            fatto = sessione
                .doc_mut()
                .map(|stato| {
                    stato.selection = Selection::default();
                    giro.iter().for_each(|n| stato.selection.add(*n));
                    if riga.id == "select.reselect" {
                        stato.last_selection_cmd = ultimo.clone();
                    }
                    if let Some(livello) = livello {
                        stato.active_layer = Some(livello);
                    }
                    for (n, set) in &punti {
                        if !stato.selection.objects.contains(n) {
                            stato.selection.add(*n);
                        }
                        stato.selection.anchors.insert(*n, set.clone());
                    }
                })
                .and_then(|()| sessione.execute(&riga.id, &argomenti));
            if fatto.is_err() {
                break;
            }
        }
        // Dopo più giri il motore lascia scelti tutti gli oggetti del comando.
        if giri.len() > 1 && fatto.is_ok() {
            if let Ok(stato) = sessione.doc_mut() {
                stato.selection = Selection::default();
                giri.iter().flatten().for_each(|n| stato.selection.add(*n));
            }
        }
        sessione.paint = stile;
        fatto
    });
    let risultato = match fatto {
        Ok(Ok(risultato)) => risultato,
        Ok(Err(EngineError::BadParams { msg, .. })) => {
            banco.ripristina(copia);
            let frase = famiglia.messaggio_del_motore(&riga.id, &msg).unwrap_or(msg);
            return Err(PluginError::BadArgs(frase.into()));
        }
        Ok(Err(EngineError::Disabled(..))) => {
            banco.ripristina(copia);
            return Ok(rifiuta(DrawingRefusal::Empty));
        }
        // Il motore rifiuta il comando qui (nessun documento, un oggetto
        // che non c'è, un errore suo): `unsupported`, o il rifiuto che la
        // famiglia sa dare a quell'errore, e niente cambia.
        Ok(Err(errore)) => {
            banco.ripristina(copia);
            let motivo = famiglia.rifiuto_del_motore(&riga.id, &errore);
            return Ok(rifiuta(motivo.unwrap_or(DrawingRefusal::Unsupported)));
        }
        Err(_panico) => {
            banco.ripristina(copia);
            return Ok(rifiuta(DrawingRefusal::Unsupported));
        }
    };
    // Il comando di selezione che il motore ha appena dato ricorda sé e la sua
    // selezione di prima, per `select.reselect`. Un comando che non ne dà uno non
    // cancella il ricordo.
    if let Some(nuovo) = banco
        .sessione
        .doc()
        .ok()
        .and_then(|d| d.last_selection_cmd.clone())
    {
        banco.ultimo_di_selezione = Some(nuovo);
    }
    let Some(dopo) = banco.documento() else {
        banco.ripristina(copia);
        return Ok(rifiuta(DrawingRefusal::Unsupported));
    };
    // Il documento che il motore lascia, tradotto nel formato dalla famiglia (se lo chiede), e ciò
    // che la traduzione lascia fuori: va nell'esito, non in silenzio.
    let (dopo, perdite) = match famiglia.traduci_dopo(&riga.id, copia, dopo) {
        Ok(tradotto) => tradotto,
        Err(errore) => {
            banco.ripristina(copia);
            return Err(errore);
        }
    };
    let selezione: Vec<NodeId> = banco
        .sessione
        .doc()
        .map(|d| d.selection.objects.clone())
        .unwrap_or_default();
    if let Some(motivo) = famiglia.rifiuto_dopo(&riga.id, copia, &dopo, &selezione) {
        banco.ripristina(copia);
        return Ok(rifiuta(motivo));
    }
    // I comandi dei tracciati spostano punti: una matrice li spiega solo se
    // è uno spostamento.
    let dei_punti = riga.famiglia == Some(Famiglia::Tracciati);
    let differenza = vectorcraft_engine::guard::catch_panic(|| {
        differenza::differenza(copia, &dopo, None, None, dei_punti)
    });
    banco.ripristina(copia);
    let differenza = match differenza {
        Ok(Ok(d)) => d,
        Ok(Err(r)) => return Ok(rifiuta(r.rifiuto())),
        Err(_) => return Ok(rifiuta(DrawingRefusal::Unsupported)),
    };
    let mut esito = esito_vuoto(richiesta.revision);
    match differenza.testo() {
        // L'anteprima di un comando con finestra: i contorni di ciò che
        // cambierebbe, senza operazioni, e la copia resta com'è.
        Ok(Some(_)) if richiesta.preview => {
            esito.selection = richiesta.selection.clone();
            esito.preview = Some(DrawingPreview {
                overlays: crate::gesti::strumento::contorni_cambiati(copia, &dopo),
                ..DrawingPreview::default()
            });
        }
        Ok(Some(ops)) => {
            esito.selection = selezione_di_fub(copia, &differenza, &selezione);
            esito.ops = Some(ops);
            esito.losses = perdite;
        }
        // Il documento non cambia ma la selezione sì (`select.all`,
        // `select.inverse`…): l'esito porta la selezione nuova, senza
        // operazioni e senza un passo della cronologia.
        Ok(None) if selezione != scelti => {
            esito.selection = selezione_di_fub(copia, &differenza, &selezione);
        }
        Ok(None) => {
            let legge = vectorcraft_engine::find_command(&riga.id).is_some_and(|c| !c.journal)
                || nata.stato().legge(&riga.id);
            if !legge || risultato.is_null() {
                return Ok(rifiuta(DrawingRefusal::Empty));
            }
            let lettura = nata.stato().lettura(&riga.id, copia, risultato);
            let byte = serde_json::to_vec(&lettura).map_or(usize::MAX, |b| b.len());
            if byte > MAX_DRAWING_OPS_BYTES {
                return Ok(rifiuta(DrawingRefusal::TooLarge));
            }
            esito.selection = richiesta.selection.clone();
            esito.reading = Some(lettura);
        }
        Err(r) => return Ok(rifiuta(r.rifiuto())),
    }
    // Lo stato della famiglia resta vivo fino a qui, anche se il `Budget`
    // lo ha liberato intanto.
    drop(nata);
    Ok(esito)
}

/// Lo strumento del motore `id` trasforma la selezione (la famiglia `trasforma`,
/// T13 giro 5): con un oggetto bloccato o non mappato il gesto si rifiuta come il
/// comando della sua finestra (`object.rotate` e le altre), con lo stesso motivo.
/// Il Contagocce (la famiglia `colore`, T14 giro 6) guarda anche l'oggetto sotto
/// il primo clic, con [`colore::rifiuto_del_contagocce`]. `None` per gli altri
/// strumenti, che la selezione la trattano a modo loro.
pub(crate) fn rifiuto_dello_strumento(
    id: &str,
    copia: &Copia,
    selezione: &[String],
    clic: Option<(vectorcraft_geom::Point, bool)>,
) -> Option<DrawingRefusal> {
    let riga = riga(Fonte::Strumento, id)?;
    match riga.famiglia {
        Some(Famiglia::Trasforma) => nodi_scelti(copia, selezione).err(),
        Some(Famiglia::Colore) => colore::rifiuto_del_contagocce(copia, selezione, clic),
        // Il Generatore forme (T13 giro 7) unisce o toglie le forme scelte: meno di
        // due, o una che non è una forma, si rifiuta come il comando.
        Some(Famiglia::Forme) if id == forme::STRUMENTO_GENERATORE => {
            forme::rifiuto_del_generatore(copia, selezione)
        }
        _ => None,
    }
}

/// Perché la selezione spegne un comando che la usa, o `None` se va bene: un
/// pezzo che il motore non ha è `unmapped`, uno bloccato è di sola lettura. È
/// la stessa regola che `esegui` applica a ogni comando (le famiglie che
/// chiedono la selezione la riusano, senza ripeterla).
pub(crate) fn selezione_spenta(
    copia: &Copia,
    selezione: &[String],
) -> Option<fub_abi::DrawingDisabledReason> {
    match nodi_scelti(copia, selezione) {
        Ok(_) => None,
        Err(DrawingRefusal::Locked) => Some(fub_abi::DrawingDisabledReason::ReadOnly),
        Err(_) => Some(fub_abi::DrawingDisabledReason::Unmapped),
    }
}

/// Gli oggetti del motore della selezione di Fub: un id che la mappa non ha,
/// o che il motore non sa modificare, è `unmapped`; uno bloccato (lui o un
/// antenato) `locked`, e così la carta, che non si cambia (nel motore o
/// fuori, vedi `apertura::CARTA_FUORI`).
pub(crate) fn nodi_scelti(
    copia: &Copia,
    selezione: &[String],
) -> Result<Vec<NodeId>, DrawingRefusal> {
    let mappa = &copia.mappa;
    selezione
        .iter()
        .map(|id| {
            let i = mappa.dell_id(id).ok_or(DrawingRefusal::Unmapped)?;
            if mappa
                .elemento(i)
                .is_some_and(|e| e.ruolo == fub_scene::Role::Paper)
            {
                return Err(DrawingRefusal::Locked);
            }
            let nodo = mappa
                .elemento(i)
                .and_then(|e| e.nodo)
                .ok_or(DrawingRefusal::Unmapped)?;
            let mut j = Some(i);
            while let Some(e) = j.and_then(|j| mappa.elemento(j)) {
                if e.bloccato {
                    return Err(DrawingRefusal::Locked);
                }
                j = e.genitore;
            }
            Ok(nodo)
        })
        .collect()
}

/// `disegno.famiglia.prepara { famiglia }`: la lettura con lo stato della
/// preparazione, o `no_memory`. Il valore l'ha già controllato `validate()`.
pub(crate) fn prepara(
    famiglie: &Arc<Famiglie>,
    richiesta: &DrawingCommandRequest,
) -> Result<DrawingOutcome, PluginError> {
    let nome = richiesta
        .value
        .get("famiglia")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let famiglia = Famiglia::da_nome(nome)
        .ok_or_else(|| PluginError::BadArgs(format!("la famiglia `{nome}` non c'è").into()))?;
    let mut esito = esito_vuoto(richiesta.revision);
    match famiglie.prepara(famiglia)? {
        Preparazione::NoMemory => esito.refused = Some(DrawingRefusal::NoMemory),
        stato => {
            esito.reading = Some(serde_json::json!({
                "famiglia": famiglia.nome(),
                "stato": stato.nome(),
            }));
        }
    }
    Ok(esito)
}

#[cfg(test)]
mod tests;
