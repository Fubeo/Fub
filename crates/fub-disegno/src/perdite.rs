//! Ciò che il motore non sa modificare. Qui le parti si raccolgono soltanto,
//! una per elemento, con il tipo `unmapped` e il motivo; come si classificano
//! (approssimate, non supportate) lo decide il task che classifica il corpus.
//!
//! Una parte che il motore non sa modificare resta com'è nel file: nessuna
//! operazione la tocca, e un gesto che la toccherebbe è rifiutato.

use fub_abi::{DrawingLoss, DrawingLossKind, MAX_DRAWING_LOSSES};

/// Le parti raccolte, al più [`MAX_DRAWING_LOSSES`]: oltre si contano soltanto.
#[derive(Clone, Debug, Default)]
pub struct Perdite {
    voci: Vec<DrawingLoss>,
    oltre: usize,
}

impl Perdite {
    /// Nessuna parte.
    pub fn nuove() -> Self {
        Self::default()
    }

    /// Una parte di `kind` sull'elemento `element` (l'id, o il tag e il
    /// percorso per un elemento senza id), con il motivo.
    pub fn aggiungi(
        &mut self,
        element: impl Into<String>,
        kind: DrawingLossKind,
        detail: impl Into<String>,
    ) {
        if self.voci.len() >= MAX_DRAWING_LOSSES {
            self.oltre += 1;
            return;
        }
        let mut element = element.into();
        if element.is_empty() {
            element.push_str("svg");
        }
        self.voci.push(DrawingLoss {
            element,
            kind,
            detail: detail.into(),
        });
    }

    /// Un elemento che non torna nella mappa del motore.
    pub fn non_mappato(&mut self, element: impl Into<String>, detail: impl Into<String>) {
        self.aggiungi(element, DrawingLossKind::Unmapped, detail);
    }

    /// Le parti raccolte.
    pub fn voci(&self) -> &[DrawingLoss] {
        &self.voci
    }

    /// Quante parti sono rimaste fuori dall'elenco perché era pieno.
    pub fn oltre(&self) -> usize {
        self.oltre
    }

    /// Quante parti in tutto, comprese quelle oltre il tetto.
    pub fn quante(&self) -> usize {
        self.voci.len() + self.oltre
    }

    /// L'elenco da mandare.
    pub fn in_elenco(self) -> Vec<DrawingLoss> {
        self.voci
    }
}

/// Il nome di un elemento in una parte: il suo id, o il tag con il percorso
/// (`rect[2/0]`) se non ne ha.
pub fn nome(id: Option<&str>, tag: &str, percorso: &[usize]) -> String {
    match id {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            let passi: Vec<String> = percorso.iter().map(usize::to_string).collect();
            format!("{tag}[{}]", passi.join("/"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nome_con_e_senza_id() {
        assert_eq!(nome(Some("oa"), "rect", &[2, 0]), "oa");
        assert_eq!(nome(None, "rect", &[2, 0]), "rect[2/0]");
        assert_eq!(nome(Some(""), "g", &[]), "g[]");
    }

    #[test]
    fn tetto() {
        let mut p = Perdite::nuove();
        for _ in 0..MAX_DRAWING_LOSSES + 3 {
            p.non_mappato("x", "prova");
        }
        assert_eq!(p.voci().len(), MAX_DRAWING_LOSSES);
        assert_eq!(p.oltre(), 3);
        assert_eq!(p.quante(), MAX_DRAWING_LOSSES + 3);
    }
}
