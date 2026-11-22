//! L'adattatore del motore del disegno (piano K5): l'unico crate di Fub che
//! nomina il motore. Apre un SVG nel motore, tiene la scena in sincronia con il
//! file, traduce i gesti e i comandi di Fub e dice ciò che il motore non sa
//! modificare. I moduli sono vuoti: li riempiono i task del piano che li
//! nominano.
#![forbid(unsafe_code)]

/// Aprire un disegno nel motore a partire dai byte del file.
pub mod apertura;
/// I campioni del documento fra il file e il motore.
pub mod campioni;
/// L'indice dei comandi del Disegno completo, letto dalla mappa.
#[cfg(feature = "completo")]
pub mod catalogo;
/// I comandi del motore tradotti in comandi di Fub.
pub mod comandi;
/// La differenza fra due stati della scena, scritta come operazioni.
pub mod differenza;
/// Il motore non tocca il disco: le radici del processo e la guardia prima
/// del motore.
pub mod disco;
/// Il corpo espanso di un oggetto con la ricetta: la grafica del motore.
mod espansa;
/// Le famiglie del Disegno completo, ognuna con il suo stato pigro.
#[cfg(feature = "completo")]
pub mod famiglie;
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
/// Le preferenze del motore come impostazione di Fub (`draw.motore`).
pub mod preferenze;
/// Lo spessore delle linee a spessore variabile: il profilo e il contorno.
mod profilo;
/// La ricetta di un oggetto ricco accanto all'elemento.
pub mod ricetta;
/// La sincronia fra il documento del motore e il file sul disco.
pub mod sincronia;
