//! [`ProviderTable`]: un registro di provider di una specie, e **la disciplina
//! di consegna scritta una volta sola** (§7.2).
//!
//! # Cosa era scritto tre volte
//!
//! `deliver_to_handlers`, `flush_indexes` e `view_action` facevano, riga per
//! riga, la stessa cosa:
//!
//! 1. `mem::take` dei provider dal workspace — perché l'host presta
//!    `&mut Workspace` e un provider che vi restasse dentro sarebbe un alias;
//! 2. la chiamata dentro `with_provider_call`, che rimanda il dispatch degli
//!    eventi a *dopo* che la chiamata è tornata (la semantica che il component
//!    model impone a M5: un'istanza non è rientrante);
//! 3. il ripristino, con in coda **chi si è registrato nel frattempo** — un
//!    provider registrato durante la chiamata non si perde per essere arrivato
//!    nel momento sbagliato.
//!
//! Non è codice di servizio: è la semantica di consegna del contratto, ed era
//! già triplicata. Ogni famiglia di provider che il piano aggiunge — le
//! impostazioni (§11.1), i servizi fra plugin (§7.5) — ne avrebbe portata
//! un'altra copia, e una copia che sbaglia il punto 3 perde registrazioni in
//! un caso che nessun test guarda.
//!
//! # Cosa NON fa questa tabella
//!
//! Non decide chi possiede quale id: quello dipende dalla specie (una view ha
//! id di view, un comando id di comando) e sta dove gli id si conoscono. Qui
//! c'è ciò che è **uguale** per tutte le specie, che è il prestito.

/// I provider di una specie, in ordine di registrazione.
///
/// È un `Vec` con un nome e una disciplina: l'ordine di registrazione è dato
/// (decide chi compare prima negli elenchi e chi è interpellato per primo dove
/// l'ordine conta ancora, come l'import), e il prestito passa da
/// [`Workspace::lend`](crate::Workspace::lend).
pub(crate) struct ProviderTable<T> {
    entries: Vec<T>,
}

impl<T> Default for ProviderTable<T> {
    fn default() -> Self {
        ProviderTable {
            entries: Vec::new(),
        }
    }
}

impl<T> ProviderTable<T> {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn push(&mut self, entry: T) {
        self.entries.push(entry);
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub(crate) fn iter(&self) -> std::slice::Iter<'_, T> {
        self.entries.iter()
    }

    pub(crate) fn iter_mut(&mut self) -> std::slice::IterMut<'_, T> {
        self.entries.iter_mut()
    }

    pub(crate) fn get(&self, at: usize) -> Option<&T> {
        self.entries.get(at)
    }

    pub(crate) fn position(&self, pred: impl FnMut(&T) -> bool) -> Option<usize> {
        self.entries.iter().position(pred)
    }

    /// Toglie le voci che non superano il filtro: è ciò che serve a una
    /// **sostituzione**, dove chi entra prende il posto di chi c'era.
    pub(crate) fn retain(&mut self, keep: impl FnMut(&T) -> bool) {
        self.entries.retain(keep);
    }

    /// Estrae le voci, lasciando la tabella vuota: il primo passo del prestito.
    pub(crate) fn take(&mut self) -> Vec<T> {
        std::mem::take(&mut self.entries)
    }

    /// Rimette le voci prestate, **in coda a quelle registrate nel frattempo**.
    ///
    /// È il passo che le tre copie avevano in comune e che è facile scrivere
    /// al contrario: chi si è registrato durante la chiamata deve finire dopo
    /// chi c'era già, o l'ordine di registrazione — che è dato — dipenderebbe
    /// da quando qualcuno ha chiamato.
    pub(crate) fn restore(&mut self, lent: Vec<T>) {
        let registered_meanwhile = std::mem::take(&mut self.entries);
        self.entries = lent;
        self.entries.extend(registered_meanwhile);
    }
}

impl<T> std::ops::Index<usize> for ProviderTable<T> {
    type Output = T;

    fn index(&self, at: usize) -> &T {
        &self.entries[at]
    }
}

impl<T> std::ops::IndexMut<usize> for ProviderTable<T> {
    fn index_mut(&mut self, at: usize) -> &mut T {
        &mut self.entries[at]
    }
}
