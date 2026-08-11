//! **La pila delle operazioni annullabili** (§13.3).
//!
//! È la seconda delle due pile che la [`Undo`] descrive, ed è quella che il
//! contratto non poteva tenere: l'altra — l'undo del testo — vive nell'editor,
//! è per-documento e per-pannello, e il suo soggetto è un buffer che non è
//! ancora arrivato sul disco. Questa ha per soggetto ciò che sul disco ci è già
//! arrivato, e quindi vive dove sta il disco.
//!
//! # Cosa ci finisce dentro
//!
//! Le operazioni che si sono **dichiarate** annullabili, e solo quelle: nessuno
//! deduce l'inverso di un'operazione che non lo ha detto. Ci finiscono a
//! **profondità zero**, cioè una macro di tre rinomine è una voce e non tre —
//! la stessa regola per cui è un `batch-ended` solo (decisione 0011). Chi compone
//! comandi compone anche il loro annullamento, ed è ciò che
//! [`Undo::steps`](fub_abi::command::Undo::steps) esiste per permettere.
//!
//! **Non** ci finisce il salvataggio dell'editor, e non è una dimenticanza: il
//! testo che l'utente sta scrivendo ha già la sua pila, in CodeMirror, e
//! metterlo anche qui vorrebbe dire due pile che rispondono alla stessa
//! scorciatoia con due risposte diverse. La riga che le separa è dove passa il
//! gesto: un comando entra da qui, una battuta di tastiera no.
//!
//! # Perché una pila e non un journal
//!
//! Perché dura quanto il vault aperto, che è la cronologia «per sessione» che
//! FEATURES 4.2 chiede. Farla sopravvivere a una chiusura non è tenerla su
//! disco: è accorgersi di ciò che è cambiato mentre l'app era spenta, o
//! riproporre l'annullamento di un'operazione il cui documento nel frattempo
//! qualcun altro ha riscritto tre volte. Quello è il journal del §15.2 — che
//! dalla [0067](../../../docs/decisions/0067-il-registro-di-cio-che-e-successo.md)
//! esiste, e registra alla mutazione dove questa pila si riempie
//! all'invocazione —, ed è
//! un'altra cosa — questa pila è il pezzo che si può avere prima, e senza il
//! quale il journal non saprebbe comunque *cosa* registrare.

use std::collections::VecDeque;

use fub_abi::command::{Partial, Undo};

/// Quante operazioni si ricorda.
///
/// Un tetto e non «illimitato», perché una voce non è un puntatore: porta
/// dentro il **testo sostituito** di ogni modifica che annulla
/// ([`AppliedEdit::replaced`](fub_abi::edit::AppliedEdit::replaced)), quindi
/// una sostituzione su mille note è mille frammenti di documento tenuti in
/// memoria. Cento operazioni sono più di quante un utente ne annulli mai
/// all'indietro in una sessione, e il costo si vede: senza tetto, un'automazione
/// che gira in ciclo riempie la memoria con la storia di ciò che nessuno
/// annullerà.
const TETTO: usize = 100;

/// Una voce della pila: l'annullamento, e **com'era andata l'operazione**.
///
/// I due pezzi arrivano dallo stesso [`CommandOutcome`] e si separano subito
/// dopo — l'esito torna a chi ha invocato, la voce resta qui — quindi se non si
/// appaiano *adesso* non si appaiano più: mesi dopo, davanti al menu che disfa,
/// nessuno sa più che quell'archiviazione era di undici note su dodici. È il
/// danno dichiarato dalla [decisione 0045](../../../docs/decisions/0045-l-undo-ha-due-pile.md)
/// e raccolto dalla §23.14.
///
/// Che a portarlo sia l'**host** e non chi ha scritto il comando è deliberato,
/// ed è la stessa forma della decisione 0098: un conto da ricopiare a mano è un
/// conto che il secondo comando dimentica. Qui la copia è una riga in
/// `invoke_command`, e la eredita ogni comando che ci passerà.
///
/// [`CommandOutcome`]: fub_abi::command::CommandOutcome
pub(crate) struct Entry {
    pub(crate) undo: Undo,
    /// L'operazione era già a metà, e di quanto.
    pub(crate) partial: Option<Partial>,
}

#[derive(Default)]
pub(crate) struct UndoStack {
    /// L'ultima in coda.
    ///
    /// Una **coda a due teste** e non un `Vec`, perché questa pila si riempie
    /// da un capo e si pota dall'altro: si spinge in fondo, si annulla dal
    /// fondo, e oltre il [`TETTO`] si butta via la **testa**. Con un `Vec`
    /// quel «si butta via la testa» era `remove(0)`, che ricopia tutte le voci
    /// rimaste a ogni comando — novantanove, col tetto di oggi. Non era il
    /// costo a fare la differenza (misurato: 231 ns per comando, contro un
    /// comando che scrive sul disco), è che il tipo permetteva di scriverlo:
    /// `VecDeque` non ha una testa da spostare, quindi la variante lenta non
    /// si può più esprimere, e il giorno che il tetto salisse a diecimila non
    /// ci sarebbe niente da riscoprire.
    entries: VecDeque<Entry>,
    /// Un annullamento è in corso.
    ///
    /// È la sola bandiera di questo modulo, e regge un'invariante che senza di
    /// lei si romperebbe subito: **annullare non è annullabile**. I passi di un
    /// annullamento sono comandi come gli altri e dichiarerebbero il proprio
    /// inverso, quindi finirebbero in cima alla pila — e la seconda pressione
    /// di Ctrl-Z rifarebbe ciò che la prima aveva disfatto, per sempre. Il
    /// *redo* è un'altra pila e un'altra decisione.
    replaying: bool,
}

impl UndoStack {
    /// Ricorda un'operazione annullabile, se c'è qualcosa da ricordare —
    /// **insieme al conto di com'era andata**.
    pub(crate) fn push(&mut self, undo: Undo, partial: Option<Partial>) {
        if self.replaying || undo.is_empty() {
            return;
        }
        self.entries.push_back(Entry { undo, partial });
        if self.entries.len() > TETTO {
            // Si perde la **più vecchia**: chi annulla va all'indietro, e la
            // voce che sta per uscire dalla finestra è quella che nessuno
            // raggiungerà mai.
            self.entries.pop_front();
        }
    }

    /// Toglie l'ultima operazione annullabile.
    ///
    /// La voce esce dalla pila **prima** che i suoi passi girino, e non dopo che
    /// sono riusciti: un annullamento che fallisce a metà ha già cambiato
    /// qualcosa, e riproporlo vorrebbe dire riprovare a fare il pezzo che era
    /// già riuscito.
    pub(crate) fn pop(&mut self) -> Option<Entry> {
        self.entries.pop_back()
    }

    /// Segna che un annullamento sta girando, e dice com'era prima.
    ///
    /// **Non si chiama da fuori del suo guardiano**, ed è l'unica cosa che conta
    /// qui: le due metà stanno insieme in
    /// [`Riproduzione`](crate::workspace::Riproduzione), che le chiude cadendo.
    /// L'obiezione che teneva la bandiera a mano era che un `Drop` avrebbe
    /// voluto prestare *la pila* per tutta la durata dell'annullamento — cioè
    /// per tutta la durata delle scritture, che passano dal workspace intero — e
    /// la risposta è che il guardiano presta **il workspace**, non la pila: la
    /// stessa forma di `Lotto`, un piano più in là.
    pub(crate) fn begin_replay(&mut self) -> bool {
        std::mem::replace(&mut self.replaying, true)
    }

    /// Rimette la bandiera com'era. Vedi
    /// [`begin_replay`](UndoStack::begin_replay): la chiama il guardiano.
    pub(crate) fn end_replay(&mut self, prima: bool) {
        self.replaying = prima;
    }

    /// Quante operazioni si può annullare all'indietro.
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::text::Text;

    fn voce(nome: &str) -> Undo {
        Undo::by_command(
            Text::Literal(nome.to_string()),
            "x.y",
            serde_json::Value::Null,
        )
    }

    /// Mette in pila un'operazione riuscita per intero.
    fn spingi(s: &mut UndoStack, nome: &str) {
        s.push(voce(nome), None);
    }

    #[test]
    fn la_pila_e_una_pila() {
        let mut s = UndoStack::default();
        spingi(&mut s, "uno");
        spingi(&mut s, "due");
        assert_eq!(
            s.pop().map(|e| e.undo.label),
            Some(Text::Literal("due".into()))
        );
        assert_eq!(
            s.pop().map(|e| e.undo.label),
            Some(Text::Literal("uno".into()))
        );
        assert!(s.pop().is_none(), "vuota è vuota, e non è un errore");
    }

    #[test]
    fn annullare_non_e_annullabile() {
        let mut s = UndoStack::default();
        spingi(&mut s, "l'operazione");
        let prima = s.begin_replay();
        // I passi di un annullamento sono comandi come gli altri, e
        // dichiarerebbero il proprio inverso.
        spingi(&mut s, "l'inverso dell'operazione");
        s.end_replay(prima);
        assert_eq!(s.len(), 1, "la pila è cresciuta durante un annullamento");
    }

    #[test]
    fn un_annullamento_senza_passi_non_e_una_voce() {
        let mut s = UndoStack::default();
        s.push(
            Undo {
                label: Text::Literal("niente".into()),
                steps: vec![],
            },
            None,
        );
        assert_eq!(s.len(), 0);
    }

    /// **Oltre il tetto si pota dalla testa, e l'ordine resta quello.**
    ///
    /// Non guarda la cima e basta: svuota la pila e confronta **tutte** le
    /// voci, dalla più recente alla più vecchia. È la differenza che conta da
    /// quando le voci stanno in una coda a due teste invece che in un `Vec`:
    /// una pila che spinge, pota o annulla dal capo sbagliato ha ancora
    /// `len() == TETTO` e ancora una cima plausibile, e si tradisce solo
    /// nell'ordine di mezzo. Un banco che guardasse la sola cima lascerebbe
    /// passare la coda che si svuota al rovescio, che è un difetto di
    /// correttezza vestito da ottimizzazione.
    ///
    /// **Vale per tutte e due le forme**: era verde anche col `Vec` e col
    /// `remove(0)`, ed è il motivo per cui sta qui — presidia la proprietà che
    /// il cambio di struttura non doveva toccare, non il cambio.
    #[test]
    fn il_tetto_perde_la_piu_vecchia() {
        let mut s = UndoStack::default();
        for n in 0..TETTO + 5 {
            spingi(&mut s, &format!("op {n}"));
        }
        assert_eq!(s.len(), TETTO);
        let mut uscite = Vec::new();
        while let Some(e) = s.pop() {
            uscite.push(e.undo.label);
        }
        let attese: Vec<Text> = (5..TETTO + 5)
            .rev()
            .map(|n| Text::Literal(format!("op {n}")))
            .collect();
        assert_eq!(
            uscite, attese,
            "le cinque più vecchie sono uscite dalla testa, le altre escono \
             dal fondo in ordine inverso"
        );
    }

    /// **Il conto dell'operazione resta appaiato alla voce che la disfa.**
    ///
    /// È la metà che la [decisione 0045](../../../docs/decisions/0045-l-undo-ha-due-pile.md)
    /// aveva dichiarato mancante: i due pezzi arrivano dallo stesso esito e si
    /// separano subito dopo, quindi o si appaiano qui o non si appaiano mai più.
    #[test]
    fn una_voce_si_ricorda_che_l_operazione_era_a_meta() {
        let mut s = UndoStack::default();
        let conto = Partial::of(
            12,
            11,
            vec![fub_abi::command::Failure::of(
                fub_abi::model::DocId::new("dodici.md"),
                fub_abi::PluginError::Conflict("scritta nel frattempo".into()),
            )],
        );
        assert!(conto.is_some(), "undici su dodici è a metà");
        s.push(voce("l'archiviazione"), conto);

        let voce = s.pop().expect("c'è");
        let partial = voce.partial.expect("il conto è arrivato fin qui");
        assert_eq!(
            (partial.attempted, partial.done, partial.failed()),
            (12, 11, 1)
        );
    }

    /// **Un'operazione riuscita non porta un conto.** `Partial::of` risponde
    /// `None` quando non è mancato niente, e la pila non ha modo di inventarlo:
    /// una voce che si dichiarasse a metà senza esserlo insegnerebbe a chi
    /// annulla che gli avvisi di questa app si cliccano via.
    #[test]
    fn niente_di_mancato_niente_conto() {
        assert!(
            Partial::of(12, 11, Vec::new()).is_none(),
            "dodici davanti e undici cambiate senza guasti è riuscita: la \
             dodicesima non aveva niente da fare"
        );
    }
}
