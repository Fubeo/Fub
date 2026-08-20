//! La sessione: *cosa sta guardando l'utente adesso*.
//!
//! È il più piccolo dei cinque componenti in cui il §8.1 scompone il
//! `Workspace`, e il più netto: un campo solo, e nessuna delle sue quattro
//! operazioni tocca il vault, gli indici o i provider. Sta qui perché la
//! domanda che risponde è sua — *quale pannello ha il focus, su quale
//! documento, con quale selezione* — e perché il kernel la **custodisce**
//! senza derivarla: quale nota guarda l'utente è una decisione della shell
//! ([decisione 0007](../../../docs/decisions/0007-contesto-di-sessione.md)).
//!
//! Il kernel la tocca in un caso solo, ed è di **verità**: quando il sorgente
//! sotto la selezione cambia o il documento sparisce ([`Session::invalidate`]).
//! Uno span stantio è peggio di uno span assente — chi lo usasse taglierebbe i
//! byte sbagliati.
//!
//! Ciò che **non** sta qui è `set_active_context` sul `Workspace`: pubblicare
//! un contesto vuol dire anche dire alla shell quali view ridisegnare, e
//! quell'elenco si calcola sulle spec dei provider. Il taglio passa lì:
//! `Session` decide *cosa è cambiato* ([`Session::publish`] rende la maschera),
//! il `Workspace` traduce la maschera in id di view. È deliberato che il
//! componente non sappia che le view esistono.

use std::sync::RwLock;

use fub_abi::model::DocId;
use fub_abi::session::{ContextMask, ViewContext};

/// Cosa è successo al documento che il contesto stava guardando.
pub enum ContextChange {
    /// Il suo sorgente è stato riscritto: la selezione non è più posizionabile.
    Rewritten,
    /// Ha cambiato path: l'identità del contesto lo segue.
    Renamed(DocId),
    /// Non esiste più.
    Gone,
}

/// Il contesto del pannello con il focus, e nient'altro.
#[derive(Default)]
pub struct Session {
    /// Lo imposta la shell; il kernel non lo deriva né lo inventa. Resta
    /// privato al modulo perché ogni scrittura passa da [`Session::publish`] o
    /// da [`Session::invalidate`], che sono le due sole ragioni per cui cambia.
    context: RwLock<Option<ViewContext>>,
}

impl Session {
    /// Pubblica un contesto e rende **cosa è cambiato** rispetto al precedente.
    ///
    /// La maschera è il risultato utile: chi la riceve sa quali view seguono
    /// quali campi e può decidere cosa ridisegnare. La regola del confronto è
    /// una sola ([`ViewContext::changes`]) e sta nell'abi, perché a M5 un host
    /// diverso deve darne la stessa risposta.
    pub fn publish(&self, context: Option<ViewContext>) -> ContextMask {
        let mut guard = self.context.write().expect("session context write lock");
        let changed = match (&*guard, &context) {
            (Some(before), Some(after)) => before.changes(after),
            // Un contesto che appare o sparisce cambia tutto ciò che si può
            // seguire: non c'è un campo per volta da confrontare.
            (None, Some(_)) | (Some(_), None) => ContextMask::all(),
            (None, None) => ContextMask::default(),
        };
        *guard = context;
        changed
    }

    /// Il contesto del pannello con il focus, se la shell ne ha pubblicato uno.
    pub fn context(&self) -> Option<ViewContext> {
        self.context
            .read()
            .expect("session context read lock")
            .clone()
    }

    /// Il documento del contesto attivo: la lettura che il kernel usa dove il
    /// pannello non c'entra (rename, rimozione, comodità dei test).
    pub fn document(&self) -> Option<DocId> {
        self.context
            .read()
            .expect("session context read lock")
            .as_ref()
            .and_then(|c| c.doc.clone())
    }

    /// Rimette il contesto in accordo con il vault dopo che il documento che
    /// guarda è cambiato, è stato rinominato o è sparito.
    ///
    /// Le selezioni cadono in tutti e tre i casi, e per la stessa ragione: i
    /// loro offset erano di un testo che non c'è più. Il `text` cadrebbe con
    /// essi — tenerlo senza coordinate darebbe una selezione che non si sa più
    /// dov'era. Cadono **tutte insieme** anche quando sono N, ed è la stessa
    /// cosa che dice il tipo (decisione 0093): a cambiare non è una selezione,
    /// è il testo sotto tutte.
    pub fn invalidate(&self, doc: &DocId, change: ContextChange) {
        let mut guard = self.context.write().expect("session context write lock");
        let Some(context) = guard.as_mut() else {
            return;
        };
        if context.doc.as_ref() != Some(doc) {
            return;
        }
        context.selections = None;
        match change {
            ContextChange::Rewritten => {}
            ContextChange::Renamed(to) => context.doc = Some(to),
            ContextChange::Gone => context.doc = None,
        }
    }
}
