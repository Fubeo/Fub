//! Cosa conta come **link rotto**, e cosa no.
//!
//! È la regola dietro [`IndexQuery::VaultHealth`], e vive qui e non dentro chi
//! tiene il grafo perché la domanda «questo link è rotto?» ha una risposta sola
//! e almeno due che possono darla: chi risolve i link oggi, e chiunque
//! rivendichi la famiglia domani.
//!
//! # Cosa NON è un link rotto (e perché è dichiarato qui)
//!
//! - Un **URL** non punta al vault: non risolvere è la sua condizione normale.
//! - Un **allegato che c'è** — `![](img/foto.png)` con il PNG al suo posto. Fino
//!   al §14.1 *nessun* riferimento ad allegato era giudicabile, e la ragione era
//!   dichiarata qui sopra: nel kernel un PNG non esisteva, quindi «c'è» e «non
//!   c'è» erano la stessa risposta e segnalarli tutti avrebbe riempito il
//!   rapporto di falsi positivi, uno per immagine. Con l'anagrafe la differenza
//!   si può fare, e le due metà si separano: quello che c'è non è un problema,
//!   quello che manca **è un link rotto** — ed è il caso che l'utente vede
//!   davvero, perché è un'immagine che non si carica.
//!
//! Restano rotti: i wikilink che non risolvono a nessuna nota, i link markdown a
//! documenti (path senza estensione, o con un'estensione di documento) che non
//! esistono, e i riferimenti a un file — di qualunque specie — che il vault non
//! ha.
//!
//! [`IndexQuery::VaultHealth`]: crate::traits::IndexQuery::VaultHealth

use crate::model::{DocId, Link, LinkTarget};

/// Chi sa dire a quale documento arriva un riferimento.
///
/// Le due domande sono distinte perché le loro regole lo sono: un wikilink
/// porta un nome e la sua risoluzione è globale, un link markdown porta un path
/// ed è relativo al documento che lo contiene (vedi [`super::path`]). Chi
/// implementa questo trait tiene un indice; chi lo consuma applica una regola —
/// ed è la separazione che permette alla regola di stare qui.
pub trait LinkResolver {
    /// Il documento che porta questo nome di pagina, se c'è.
    fn resolve_wiki(&self, page: &str) -> Option<DocId>;
    /// Il documento a cui punta `target` scritto dentro `source`, se c'è.
    fn resolve_path(&self, source: &DocId, target: &str) -> Option<DocId>;
    /// Il **file** che un riferimento nomina, di qualunque specie: un allegato,
    /// o qualcosa che nessuno sa cosa sia (§14.1).
    ///
    /// È una domanda diversa da [`resolve_path`](LinkResolver::resolve_path) e
    /// non la sua versione permissiva: là si cerca una **nota**, quindi un path
    /// senza estensione vale e l'estensione si può sottintendere; qui si cerca
    /// un file, e `img/foto.png` è quel file o non è niente.
    ///
    /// Prende il [`LinkTarget`] intero e non una stringa perché le due specie di
    /// riferimento si cercano in due modi, ed è la stessa differenza che c'è fra
    /// le note: un path si cerca **per path**, relativo a chi lo scrive; un
    /// wikilink si cerca **per nome** — `![[foto.png]]` è il modo in cui
    /// Obsidian incorpora un allegato, e finché un PNG nel kernel non esisteva
    /// quel riferimento risultava rotto anche quando l'immagine era lì.
    fn resolve_entry(&self, source: &DocId, target: &LinkTarget) -> Option<DocId>;
}

/// La destinazione **come era scritta** se il link è rotto, `None` se risolve o
/// se non è un riferimento a un documento del vault.
///
/// Si restituisce ciò che c'è nel sorgente e non ciò che si è cercato: è quello
/// che l'utente vede e correggerà.
pub fn broken_target<R: LinkResolver + ?Sized>(
    source: &DocId,
    link: &Link,
    doc_extensions: &[String],
    resolver: &R,
) -> Option<String> {
    match &link.target {
        // Un URL non punta al vault.
        LinkTarget::Url(_) => None,
        LinkTarget::Wiki { page, .. } => {
            // L'ancora (`#titolo`, `#^blocco`) non entra nel giudizio: risolverla
            // contro heading e ancore del bersaglio è la voce dichiarata in coda
            // alla decisione 0003, e un link a una nota che esiste non è rotto
            // perché punta a un titolo che non c'è più — è un'altra diagnosi.
            //
            // Se non è una nota può essere un **allegato incorporato**
            // (`![[foto.png]]`, §14.1): finché il vault non sapeva di avere dei
            // PNG, quel riferimento risultava rotto anche con l'immagine al suo
            // posto — un falso positivo per ogni immagine incorporata.
            (resolver.resolve_wiki(page).is_none()
                && resolver.resolve_entry(source, &link.target).is_none())
            .then(|| page.clone())
        }
        LinkTarget::Path(path) => {
            // Un allegato si cerca **per quello che è scritto**, un documento
            // anche per quello che è sottinteso (l'estensione). Sono due
            // domande, e la seconda non sa rispondere alla prima: `resolve_path`
            // cerca fra le note, e fra le note un PNG non c'è mai.
            if is_attachment(path, doc_extensions) {
                return resolver
                    .resolve_entry(source, &link.target)
                    .is_none()
                    .then(|| path.clone());
            }
            resolver
                .resolve_path(source, path)
                .is_none()
                .then(|| path.clone())
        }
    }
}

/// Il path punta a qualcosa che non è un documento? (vedi il § in testa)
///
/// `doc_extensions` sono le estensioni che un `FormatProvider` rivendica: quali
/// siano non è una costante di questo modulo, perché il progetto esiste per
/// poterne aggiungere.
pub fn is_attachment(path: &str, doc_extensions: &[String]) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    // Il frammento (`file.md#titolo`) non fa parte del nome del file.
    let name = name.split(['#', '?']).next().unwrap_or(name);
    match name.rsplit_once('.') {
        // Senza estensione è un documento: è la forma dei link fra note.
        None => false,
        Some((_, ext)) => !doc_extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_extension_nobody_claims_is_an_attachment() {
        let md = [String::from("md")];
        assert!(is_attachment("img/foto.png", &md));
        assert!(!is_attachment("note/b.md", &md));
        // Senza estensione è la forma normale di un link fra note.
        assert!(!is_attachment("note/c", &md));
        // Il frammento non fa parte del nome del file.
        assert!(!is_attachment("note/b.md#titolo", &md));
        // Il caso dell'estensione non conta.
        assert!(!is_attachment("note/b.MD", &md));
    }
}
