//! **Lo spazio dati di un documento**, dentro lo spazio dati di un plugin
//! (§13.2).
//!
//! # Perché è una regola e non una capacità
//!
//! Un plugin che tiene qualcosa attaccato a *una nota* — annotazioni (13.3),
//! task (10), commenti (4.3, 19.2), righe di database (11), flashcard (21.2) —
//! ha già dove metterlo: [`DataWrite::data_write`](crate::traits::DataWrite).
//! Ciò che non aveva è **un posto dichiarato**, e la differenza si vede solo al
//! rename: chi si sceglie una convenzione sua tiene una chiave che il kernel non
//! riconosce, quindi non può migrargliela, quindi ognuno se la migra da sé
//! ascoltando `DocumentRenamed` — che è ciò che il versioning e il sidecar
//! dell'organizzazione facevano, ognuno per conto proprio e ognuno col proprio
//! buco (il rename fatto ad app chiusa non lo vede nessuno).
//!
//! Questa è la convenzione, ed è **solo** una convenzione: nessuna capacità
//! nuova, nessuna firma in più sull'[`HostApi`](crate::traits::HostApi). La
//! decisione 0013 aveva chiuso l'elenco delle capacità, e ciò che qui serviva
//! non era una porta nuova — era che il kernel sapesse **riconoscere** ciò che
//! passa da quella che c'è già.
//!
//! # La forma
//!
//! ```text
//! .fub/data/plugins/<plugin>/doc/<documento codificato>/<nome>
//! ```
//!
//! - Il documento è **un componente solo**, codificato con [`encode`]: un
//!   `DocId` porta `/`, e lasciarlo nudo renderebbe impossibile dire dove
//!   finisce il documento e dove comincia il nome del plugin.
//! - Il nome è **un componente solo** e senza `/` ([`path`] lo pretende), per la
//!   stessa ragione al contrario: è ciò che rende [`doc_of`] una funzione totale
//!   invece di un indovinello.
//!
//! # Il verso che conta è l'inverso
//!
//! [`doc_of`] — «di quale documento sono questi dati?» — è la metà che porta il
//! peso, ed è la ragione per cui la codifica è **reversibile** invece di essere
//! un'impronta. Con un digest lo spazio sarebbe più corto e più uniforme, e la
//! raccolta sarebbe impossibile: nessuno potrebbe più dire *quale* nota nominava
//! una cartella, quindi nessuno potrebbe sapere che quella nota non c'è più. La
//! domanda «cancellata una nota per sempre, chi cancella i dati che la
//! nominavano?» non ha risposta senza questa funzione.
//!
//! # Cosa NON va qui
//!
//! **Ciò che deve sopravvivere al documento.** La politica di raccolta del
//! kernel è che questo spazio *muore con la nota*: quando il documento non è più
//! né nel vault né nel cestino, ciò che sta sotto il suo prefisso se ne va. È la
//! politica giusta per un'annotazione, per una riga di database, per lo stato di
//! una flashcard — e quella sbagliata per la storia delle versioni, che esiste
//! **apposta** per essere leggibile dopo la cancellazione (il versioning tiene
//! il proprio tombstone, e per questo tiene il proprio store fuori di qui).
//!
//! La riga fra le due cose è quindi netta e si può dire in una frase: *sotto
//! `doc/` sta ciò che non ha senso senza il documento.*

use crate::model::DocId;

/// Il primo componente dello spazio: `doc`.
///
/// È un nome corto e non un prefisso lungo perché appare in ogni path di ogni
/// plugin che lo usi, e perché la cartella accanto — quella che un plugin si
/// tiene per sé — non ha bisogno di dichiararsi: tutto ciò che *non* sta sotto
/// `doc/` è dello spazio del plugin e il kernel non lo tocca.
pub const DOC_SPACE: &str = "doc";

/// Il prefisso di tutto ciò che appartiene a `doc`, con lo `/` finale.
///
/// È ciò che si passa a [`DataRead::data_list`](crate::traits::DataRead::data_list)
/// per riavere ciò che si è scritto su una nota.
pub fn space(doc: &DocId) -> String {
    format!("{DOC_SPACE}/{}/", encode(doc.as_str()))
}

/// Il path di un blob attaccato a `doc`.
///
/// `name` è **un componente**: gli `/` che porta vengono codificati come
/// qualunque altro carattere ostile, quindi `path(d, "a/b")` non crea una
/// sottocartella — è un blob che si chiama `a/b`. Non è una restrizione da
/// aggirare, è ciò che tiene [`doc_of`] totale: se il nome potesse annidarsi,
/// «dove finisce il documento» tornerebbe a essere un indovinello.
pub fn path(doc: &DocId, name: &str) -> String {
    format!("{}{}", space(doc), encode(name))
}

/// Di quale documento sono questi dati, se lo sono.
///
/// `None` per tutto ciò che non sta sotto [`DOC_SPACE`] — cioè per ciò che il
/// plugin si tiene per sé, che il kernel non migra e non raccoglie.
///
/// È l'inverso esatto di [`path`], e la sua totalità è ciò che rende possibile
/// la raccolta: chi cammina lo spazio dati di un plugin può dire, di ogni voce,
/// quale nota nomina — e quindi se quella nota esiste ancora.
pub fn doc_of(rel: &str) -> Option<DocId> {
    let rest = rel.strip_prefix(DOC_SPACE)?.strip_prefix('/')?;
    let (encoded, _name) = rest.split_once('/')?;
    if encoded.is_empty() {
        return None;
    }
    Some(DocId::new(decode(encoded)))
}

/// Codifica una stringa perché stia in **un** componente di path, su ogni
/// filesystem che Fub tocca.
///
/// Passano nudi **tutto il non-ASCII**, le lettere, le cifre e la punteggiatura
/// che i nomi di nota portano davvero: `- . _`, lo spazio, `( ) [ ]`, la virgola
/// e l'apostrofo. `Diario/2026 città.md` diventa `Diario%2F2026 città.md`, che a
/// occhio si legge ancora — e leggersi conta, perché è ciò che qualcuno vedrà
/// aprendo `.fub/data` per capire chi sta occupando spazio.
///
/// Ciò che viene codificato è, oltre allo `/`: il `%` (o la decodifica non
/// sarebbe reversibile), i cinque caratteri che Windows rifiuta nei nomi di
/// file (`\ : * ? " < > |`) e i caratteri di controllo. Lo spazio no, ed è la
/// scelta che si nota: è legale ovunque, e codificarlo renderebbe illeggibile
/// la metà dei nomi di nota per guadagnare niente.
///
/// # Il limite dichiarato
///
/// Un `DocId` molto lungo produce **un** nome di file molto lungo, e i
/// filesystem si fermano intorno ai 255 byte per componente. Un vault con una
/// nota annidata dieci cartelle sotto può superarlo, e allora la scrittura
/// fallisce con un errore di I/O — che è rumoroso e recuperabile, mentre
/// l'alternativa (accorciare con un'impronta) sarebbe silenziosa e
/// **irreversibile**, cioè costerebbe [`doc_of`], cioè costerebbe la raccolta.
pub fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let nudo = !c.is_ascii()
            || c.is_ascii_alphanumeric()
            || matches!(
                c,
                '-' | '.' | '_' | ' ' | '(' | ')' | '[' | ']' | ',' | '\''
            );
        if nudo {
            out.push(c);
        } else {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).as_bytes() {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

/// L'inverso di [`encode`].
///
/// Una sequenza `%XX` malformata resta com'era, come in
/// [`percent_decode`](super::path::percent_decode): questa funzione risponde a
/// «di chi sono questi dati», e una cartella scritta male da qualcun altro non
/// è un motivo per non rispondere.
pub fn decode(s: &str) -> String {
    super::path::percent_decode(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(s: &str) -> DocId {
        DocId::new(s)
    }

    #[test]
    fn outbound_and_return_on_names_ostili() {
        for id in [
            "Nota.md",
            "Progetti/Ferrite.md",
            "a/b/c/Città è così.md",
            "con % dentro.md",
            "Windows: * ? \" < > |.md",
            ".nascosta.md",
            "senza-estensione",
        ] {
            let p = path(&doc(id), "stato.json");
            assert_eq!(
                doc_of(&p).as_ref().map(DocId::as_str),
                Some(id),
                "«{id}» non è tornato indietro da «{p}»"
            );
        }
    }

    #[test]
    fn the_document_remains_a_component_only() {
        // Se lo `/` restasse nudo, «dove finisce il documento» sarebbe un
        // indovinello, e `doc_of` risponderebbe `Progetti` a un dato di
        // `Progetti/Ferrite.md`.
        let p = path(&doc("Progetti/Ferrite.md"), "note.json");
        assert_eq!(p, "doc/Progetti%2FFerrite.md/note.json");
        assert_eq!(p.matches('/').count(), 2, "prefisso, documento, nome");
    }

    #[test]
    fn nemmeno_the_name_is_annida() {
        // Un nome con uno `/` dentro non crea una sottocartella: se lo facesse,
        // `doc_of` non sarebbe più una funzione totale.
        let p = path(&doc("a.md"), "sotto/x.json");
        assert_eq!(p, "doc/a.md/sotto%2Fx.json");
        assert_eq!(doc_of(&p).as_ref().map(DocId::as_str), Some("a.md"));
    }

    #[test]
    fn that_that_the_plugin_holds_for_if_not_and_of_no_document() {
        // È la metà che decide cosa il kernel migra e raccoglie: tutto ciò che
        // non sta sotto `doc/` non lo tocca. Il versioning ci conta.
        assert_eq!(doc_of("versions.json"), None);
        assert_eq!(doc_of("snapshots/abc/123.md"), None);
        // E nemmeno un `doc/` senza nome dentro: è la cartella del documento,
        // non un blob suo.
        assert_eq!(doc_of("doc/a.md"), None);
        assert_eq!(doc_of("doc//x"), None);
    }

    #[test]
    fn remains_readable_to_the_eye() {
        // È l'esempio scritto accanto a `encode`, e sta qui perché un esempio
        // in un commento è la cosa che invecchia per prima: questa riga esiste
        // per farlo invecchiare **rumorosamente**. Ciò che promette è che chi
        // apre `.fub/data` per capire chi occupa spazio ci riesca — quindi
        // lo spazio resta uno spazio e gli accenti restano accenti, e solo lo
        // `/` se ne va, perché è l'unico che romperebbe il componente.
        assert_eq!(encode("Diario/2026 città.md"), "Diario%2F2026 città.md");
    }

    #[test]
    fn the_space_and_the_prefix_of_that_that_there_is_inside() {
        let d = doc("Progetti/Ferrite.md");
        assert!(path(&d, "x").starts_with(&space(&d)));
    }
}
