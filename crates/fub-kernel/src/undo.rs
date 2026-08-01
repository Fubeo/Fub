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

use fub_abi::command::Undo;

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

#[derive(Default)]
pub(crate) struct UndoStack {
    /// L'ultima in coda.
    entries: Vec<Undo>,
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
    /// Ricorda un'operazione annullabile, se c'è qualcosa da ricordare.
    pub(crate) fn push(&mut self, undo: Undo) {
        if self.replaying || undo.is_empty() {
            return;
        }
        self.entries.push(undo);
        if self.entries.len() > TETTO {
            // Si perde la **più vecchia**: chi annulla va all'indietro, e la
            // voce che sta per uscire dalla finestra è quella che nessuno
            // raggiungerà mai.
            self.entries.remove(0);
        }
    }

    /// Toglie l'ultima operazione annullabile.
    ///
    /// La voce esce dalla pila **prima** che i suoi passi girino, e non dopo che
    /// sono riusciti: un annullamento che fallisce a metà ha già cambiato
    /// qualcosa, e riproporlo vorrebbe dire riprovare a fare il pezzo che era
    /// già riuscito.
    pub(crate) fn pop(&mut self) -> Option<Undo> {
        self.entries.pop()
    }

    /// Segna che un annullamento sta girando, e per quanto.
    ///
    /// Il ripristino della bandiera è di chi ha in mano il valore restituito:
    /// un `Drop` sarebbe stato più sicuro e avrebbe voluto prestare la pila per
    /// tutta la durata dell'annullamento — cioè per tutta la durata delle
    /// scritture che l'annullamento fa, che passano dal workspace intero.
    pub(crate) fn begin_replay(&mut self) -> bool {
        std::mem::replace(&mut self.replaying, true)
    }

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

    #[test]
    fn la_pila_e_una_pila() {
        let mut s = UndoStack::default();
        s.push(voce("uno"));
        s.push(voce("due"));
        assert_eq!(s.pop().map(|u| u.label), Some(Text::Literal("due".into())));
        assert_eq!(s.pop().map(|u| u.label), Some(Text::Literal("uno".into())));
        assert!(s.pop().is_none(), "vuota è vuota, e non è un errore");
    }

    #[test]
    fn annullare_non_e_annullabile() {
        let mut s = UndoStack::default();
        s.push(voce("l'operazione"));
        let prima = s.begin_replay();
        // I passi di un annullamento sono comandi come gli altri, e
        // dichiarerebbero il proprio inverso.
        s.push(voce("l'inverso dell'operazione"));
        s.end_replay(prima);
        assert_eq!(s.len(), 1, "la pila è cresciuta durante un annullamento");
    }

    #[test]
    fn un_annullamento_senza_passi_non_e_una_voce() {
        let mut s = UndoStack::default();
        s.push(Undo {
            label: Text::Literal("niente".into()),
            steps: vec![],
        });
        assert_eq!(s.len(), 0);
    }

    #[test]
    fn il_tetto_perde_la_piu_vecchia() {
        let mut s = UndoStack::default();
        for n in 0..TETTO + 5 {
            s.push(voce(&format!("op {n}")));
        }
        assert_eq!(s.len(), TETTO);
        assert_eq!(
            s.pop().map(|u| u.label),
            Some(Text::Literal(format!("op {}", TETTO + 4))),
            "in cima resta la più recente"
        );
    }
}
