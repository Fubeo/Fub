//! I caratteri che l'host dà ai motori.
//!
//! Un motore non legge i caratteri del sistema: lo stesso documento deve
//! uscire uguale su ogni macchina. L'host gli dà le facce che porta nel
//! binario, una volta per processo, con [`Servizi::fornisci_caratteri`];
//! ogni motore costruisce da queste il suo archivio
//! (`fontdb` o altro), perché questo crate non ne sceglie nessuno.
//!
//! [`Servizi::fornisci_caratteri`]: crate::Servizi::fornisci_caratteri

use std::fmt;

/// I nomi delle tre famiglie generiche: quale famiglia, fra quelle delle
/// facce, risponde a `serif`, `sans-serif` e `monospace`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Generiche {
    /// La famiglia di `serif`.
    pub serif: String,
    /// La famiglia di `sans-serif`.
    pub sans: String,
    /// La famiglia di `monospace`.
    pub mono: String,
}

/// Le facce dei caratteri date dall'host e i nomi delle famiglie generiche.
///
/// Le facce sono i byte dei file (TrueType, OpenType o collezioni), così come
/// sono nel binario: `'static`, quindi nessuna copia. Zero facce è ammesso:
/// i testi si disegnano allora con il ripiego del motore.
#[derive(Clone, PartialEq, Eq)]
pub struct Caratteri {
    facce: Vec<&'static [u8]>,
    serif: String,
    sans: String,
    mono: String,
}

impl Caratteri {
    /// I caratteri con queste facce e queste famiglie generiche.
    pub fn nuovi(facce: impl IntoIterator<Item = &'static [u8]>, generiche: Generiche) -> Self {
        let Generiche { serif, sans, mono } = generiche;
        Self {
            facce: facce.into_iter().collect(),
            serif,
            sans,
            mono,
        }
    }

    /// Le facce, nell'ordine in cui l'host le ha date.
    pub fn facce(&self) -> &[&'static [u8]] {
        &self.facce
    }

    /// La famiglia di `serif`.
    pub fn serif(&self) -> &str {
        &self.serif
    }

    /// La famiglia di `sans-serif`.
    pub fn sans(&self) -> &str {
        &self.sans
    }

    /// La famiglia di `monospace`.
    pub fn mono(&self) -> &str {
        &self.mono
    }
}

impl fmt::Debug for Caratteri {
    /// Il numero delle facce e i loro byte in tutto, non i byte stessi.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let byte: usize = self.facce.iter().map(|faccia| faccia.len()).sum();
        f.debug_struct("Caratteri")
            .field("facce", &self.facce.len())
            .field("byte", &byte)
            .field("serif", &self.serif)
            .field("sans", &self.sans)
            .field("mono", &self.mono)
            .finish()
    }
}
