//! L'adattatore del motore del disegno (piano K5): l'unico crate di Fub che
//! nomina il motore. Apre un SVG nel motore, tiene la scena in sincronia con il
//! file, traduce i gesti e i comandi di Fub e dice ciò che il motore non sa
//! modificare. I moduli sono vuoti: li riempiono i task del piano che li
//! nominano.
#![forbid(unsafe_code)]

/// Aprire un disegno nel motore a partire dai byte del file.
pub mod apertura;
/// I comandi del motore tradotti in comandi di Fub.
pub mod comandi;
/// La differenza fra due stati della scena, scritta come operazioni.
pub mod differenza;
/// I gesti delle forme, della selezione e del testo.
pub mod gesti;
/// Gli identificatori stabili degli elementi del disegno.
pub mod id;
/// La mappa fra gli elementi della scena di Fub e gli oggetti del motore.
pub mod mappa;
/// Il motore iscritto in `fub-motori`, costruito alla prima richiesta.
pub mod motore;
/// Ciò che il motore non sa modificare e che resta com'è nel file.
pub mod perdite;
/// La sincronia fra il documento del motore e il file sul disco.
pub mod sincronia;
