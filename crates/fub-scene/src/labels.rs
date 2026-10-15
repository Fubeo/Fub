//! Le etichette nelle forme (formato della scena, etichette): il testo scritto
//! dentro un rettangolo, un rombo o un'ellisse, come nei diagrammi. È un
//! `text` con `fub:inside`, che porta l'id della forma; forma ed etichetta
//! sono figlie dirette dello stesso gruppo, e l'etichetta va a capo nella
//! larghezza della forma col testo in area (`fub:wrap`).
//!
//! È la lettura di `labels.ts` della superficie, regola per regola: i casi
//! scritti a mano in `apps/client/src/__fixtures__/scene-labels/cases.json`
//! valgono per tutte e due. La `transform` dell'etichetta la mette già al
//! centro della forma, così un altro programma la vede dove FubDraw la
//! mostra; rimetterla al centro quando la forma cambia è della superficie.
//! Un valore vuoto o di più parole non si usa, e resta nel file com'è.

use crate::values::is_wsp;

/// La forma di `fub:inside`: l'id, una parola fra spazi; `None` fuori dalla
/// grammatica.
pub fn read_inside(value: &str) -> Option<String> {
    let mut words = value
        .split(|c: char| c.is_ascii() && is_wsp(c as u8))
        .filter(|word| !word.is_empty());
    let id = words.next()?;
    words.next().is_none().then(|| id.to_owned())
}
