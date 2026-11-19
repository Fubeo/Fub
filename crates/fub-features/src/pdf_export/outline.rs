//! I segnalibri del PDF: l'albero dei titoli della nota, nel pannello del
//! lettore.
//!
//! L'elenco li dà in fila, ognuno col suo livello; l'albero lo fanno i
//! livelli. Un segnalibro sta sotto l'ultimo che lo precede con un livello
//! più basso: un Titolo 3 subito dopo un Titolo 1 sta sotto quel Titolo 1,
//! come nell'indice della nota, e un primo segnalibro di livello 2 sta in
//! cima. Ogni ramo è aperto.

use pdf_writer::{Finish, Ref, TextStr};

use super::writer::{Scrittore, PUNTI_PER_PIXEL};
use super::Segnalibro;

/// Per ogni segnalibro, l'indice del suo genitore nella fila (`None`: sta in
/// cima).
pub(super) fn genitori(segnalibri: &[Segnalibro]) -> Vec<Option<usize>> {
    let mut aperti: Vec<usize> = Vec::new();
    let mut genitori = Vec::with_capacity(segnalibri.len());
    for (i, s) in segnalibri.iter().enumerate() {
        while aperti
            .last()
            .is_some_and(|&a| segnalibri[a].livello >= s.livello)
        {
            aperti.pop();
        }
        genitori.push(aperti.last().copied());
        aperti.push(i);
    }
    genitori
}

impl Scrittore<'_> {
    /// Scrive l'albero dei segnalibri e ne dà la radice; `None` se l'elenco
    /// non ne ha.
    pub(super) fn segnalibri(&mut self) -> Option<Ref> {
        let elenco = self.elenco;
        let segnalibri = &elenco.segnalibri;
        if segnalibri.is_empty() {
            return None;
        }
        let genitori = genitori(segnalibri);
        let radice = self.rif();
        let rif: Vec<Ref> = segnalibri.iter().map(|_| self.rif()).collect();
        // I figli di ogni nodo, nell'ordine della fila; l'ultimo indice è la
        // radice.
        let n = segnalibri.len();
        let mut figli: Vec<Vec<usize>> = vec![Vec::new(); n + 1];
        // Il posto di ogni nodo fra i figli del suo genitore.
        let mut posti = Vec::with_capacity(n);
        for (i, genitore) in genitori.iter().enumerate() {
            let fratelli = &mut figli[genitore.unwrap_or(n)];
            posti.push(fratelli.len());
            fratelli.push(i);
        }
        // Quanti discendenti ha ogni nodo: con ogni ramo aperto è il numero
        // che il lettore mostra. I figli vengono sempre dopo il genitore, e
        // quindi si contano dal fondo.
        let mut discendenti = vec![0i32; n];
        for i in (0..n).rev() {
            if let Some(g) = genitori[i] {
                discendenti[g] += discendenti[i] + 1;
            }
        }
        let alto = self.alto();
        let radice_figli = &figli[n];
        let mut o = self.pdf.outline(radice);
        o.first(rif[radice_figli[0]]);
        o.last(rif[*radice_figli.last().expect("la radice ha figli")]);
        o.count(n as i32);
        o.finish();
        for (i, s) in segnalibri.iter().enumerate() {
            let fratelli = &figli[genitori[i].unwrap_or(n)];
            let posto = posti[i];
            let mut voce = self.pdf.outline_item(rif[i]);
            voce.title(TextStr(&s.titolo));
            voce.parent(genitori[i].map_or(radice, |g| rif[g]));
            if posto > 0 {
                voce.prev(rif[fratelli[posto - 1]]);
            }
            if let Some(&dopo) = fratelli.get(posto + 1) {
                voce.next(rif[dopo]);
            }
            if let (Some(&primo), Some(&ultimo)) = (figli[i].first(), figli[i].last()) {
                voce.first(rif[primo]);
                voce.last(rif[ultimo]);
                voce.count(discendenti[i]);
            }
            voce.dest().page(self.pagine[s.pagina]).xyz(
                0.0,
                alto - s.y as f32 * PUNTI_PER_PIXEL,
                None,
            );
            voce.finish();
        }
        Some(radice)
    }
}
