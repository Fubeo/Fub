//! La diagnostica di §12: codici, gravità e il punto della sorgente a cui si
//! riferiscono.

use serde::Serialize;

use crate::text::Span;

/// Un codice di §12.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub enum Code {
    /// Manca `<title>`: il disegno non ha descrizione accessibile.
    S001,
    /// Il documento contiene blocchi estranei.
    S002,
    /// Id duplicato.
    S003,
    /// `fub:ink` o `fub:brush` fuori grammatica o fuori limite.
    S004,
    /// Contenuto attivo conservato ma non eseguito.
    S005,
    /// Immagine incorporata oltre il limite.
    S006,
    /// Versione del formato più recente di quella supportata.
    S007,
    /// `<!DOCTYPE>` presente: sola lettura.
    S008,
    /// Un tratto a penna o un testo contrastano poco con ciò che hanno sotto:
    /// meno di 3:1 un tratto o un testo grande, meno di 4,5:1 un altro testo.
    /// L'evidenziatore no, perché è fatto per stare sotto il testo.
    S009,
    /// Canali d'inchiostro sconosciuti.
    S010,
    /// `fub:units` o `fub:guides` fuori grammatica: si ignorano e restano.
    S011,
    /// Un'immagine senza descrizione, e non dichiarata decorativa.
    S012,
    /// Un testo sotto i 12 pixel a grandezza naturale.
    S013,
    /// Un riferimento locale, `url(#id)` o `href="#id"`, a un id che il
    /// documento non ha.
    S014,
    /// Una carta che non va con la sua tavola: di una tavola che non c'è, la
    /// seconda della stessa tavola, con un rettangolo diverso dal suo, o
    /// libera in un disegno con le tavole.
    S015,
    /// Il nome di una tavola è già del disegno o di una tavola prima.
    S016,
    /// Due colori che il disegno usa come codice, ciascuno per almeno due
    /// aree, si distinguono soltanto per la tinta: il contrasto fra loro è
    /// sotto 3:1.
    S017,
    /// Un oggetto segue con `fub:style` uno stile che non c'è, o uno
    /// dell'altro tipo: si disegna dai suoi attributi.
    S018,
}

/// La gravità di una diagnostica.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

impl Code {
    /// La gravità che §12 assegna al codice.
    pub fn severity(self) -> Severity {
        match self {
            Code::S003 | Code::S004 => Severity::Error,
            Code::S001
            | Code::S005
            | Code::S006
            | Code::S012
            | Code::S014
            | Code::S016
            | Code::S018 => Severity::Warning,
            Code::S002
            | Code::S007
            | Code::S008
            | Code::S009
            | Code::S010
            | Code::S011
            | Code::S013
            | Code::S015
            | Code::S017 => Severity::Info,
        }
    }

    /// Che cosa vuol dire il codice, per chi lo legge.
    pub fn message(self) -> &'static str {
        match self {
            Code::S001 => "il disegno non ha un titolo: manca la descrizione accessibile",
            Code::S002 => "il documento contiene contenuto che FubDraw conserva ma non modifica",
            Code::S003 => "id duplicato: il documento si apre in sola lettura",
            Code::S004 => "inchiostro o pennello non validi: il tratto non si ridisegna",
            Code::S005 => "contenuto attivo conservato ma mai eseguito",
            Code::S006 => "immagine incorporata oltre 5 MiB",
            Code::S007 => "versione del formato più recente di quella supportata: sola lettura",
            Code::S008 => "il documento ha un DOCTYPE: sola lettura",
            Code::S009 => "contrasta poco con ciò che ha sotto: un tratto o un testo grande vogliono 3:1, un testo 4,5:1",
            Code::S010 => "canali d'inchiostro sconosciuti: il tratto non si ridisegna",
            Code::S011 => "unità o guide del documento non valide: si ignorano e restano nel file",
            Code::S012 => "immagine senza descrizione: chi non la vede non sa che cosa mostra",
            Code::S013 => "testo sotto i 12 px a grandezza naturale",
            Code::S014 => {
                "riferimento a un id che il documento non ha: si disegna senza la risorsa"
            }
            Code::S015 => "una carta che non va con la sua tavola",
            Code::S016 => {
                "il nome della tavola è già del disegno o di una tavola prima: un riferimento a quel nome mostra l'altra"
            }
            Code::S017 => {
                "due colori usati come codice si distinguono soltanto per la tinta: il contrasto fra loro è sotto 3:1"
            }
            Code::S018 => "segue uno stile che non c'è: si disegna dai suoi attributi",
        }
    }
}

/// Una diagnostica: il codice, la sua gravità, l'elemento o il blocco a cui si
/// riferisce e un dettaglio leggibile da una macchina.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Diagnostic {
    pub code: Code,
    pub severity: Severity,
    /// Lo span dell'elemento, del blocco o del `DOCTYPE`; assente per le
    /// diagnostiche del documento intero.
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub span: Option<Span>,
    /// Il dettaglio: l'id ripetuto, l'errore dell'inchiostro, il contrasto
    /// misurato, la grandezza del testo, i due colori confusi, lo stile che un
    /// oggetto segue.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Diagnostic {
    pub(crate) fn new(code: Code, span: Option<Span>, detail: Option<String>) -> Self {
        Diagnostic {
            code,
            severity: code.severity(),
            span,
            detail,
        }
    }
}

/// Mette le diagnostiche in un ordine stabile: per codice, poi per posizione.
pub(crate) fn sort(diagnostics: &mut [Diagnostic]) {
    diagnostics.sort_by_key(|d| (d.code, d.span.map(|s| s.bytes[0])));
}
