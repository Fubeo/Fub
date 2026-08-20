//! **Che nome prende una nota cestinata**, e come si ritrova quello di prima.
//!
//! Il cestino di un vault è **piatto** e **condiviso** — con Obsidian, e con
//! chiunque altro apra la stessa cartella — quindi il nome dentro `.trash/` è
//! l'unica cosa che sopravvive alla cancellazione: la cartella di provenienza
//! no, e nessun registro accompagna il file. Ricostruire l'originale è quindi
//! una lettura della forma del nome, non di un archivio.
//!
//! Sta qui e non nel kernel perché chi cestina non è più soltanto il kernel: il
//! gemello del contratto ([`MemoryHost`] dell'SDK) risponde alla stessa
//! capacità `trash_document`, e finché il nome se lo costruiva per conto
//! proprio i due davano id di forma diversa allo stesso gesto — chi sviluppava
//! contro il gemello scriveva un `restore` che sul kernel non trovava niente, e
//! nessun test vedeva la differenza (difetto 0219).
//!
//! [`MemoryHost`]: https://docs.rs/fub-sdk

/// La cartella del cestino, dentro il vault.
pub const TRASH_DIR: &str = ".trash";

/// Il nome del file, senza la cartella che lo conteneva.
///
/// È il primo passo del cestino piatto: `Progetti/Idea.md` ci entra come
/// `Idea.md`, e un ripristino la riporta nella radice.
pub fn file_name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// `Nota.md` + `2026-07-24T15-30-00` → `Nota.2026-07-24T15-30-00.md`.
///
/// Il suffisso va **prima** dell'estensione, non dopo: un file che finisce per
/// `.md` resta un file markdown, aperto da Obsidian come dagli altri.
pub fn stamped_name(name: &str, stamp: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}.{stamp}.{ext}"),
        _ => format!("{name}.{stamp}"),
    }
}

/// L'inverso di [`stamped_name`]: il nome originale di un file cestinato.
///
/// Riconosce il suffisso dalla **forma**, non da un registro: il cestino è
/// condiviso con Obsidian, che non tiene nota di nulla, e la ricostruzione deve
/// funzionare anche su file che Fub non ha mai visto. Il prezzo è che una
/// nota davvero intitolata `Riunione.2026-07-24T15-30-00` si ripristina come
/// `Riunione` — l'utente la rinomina, e nessun dato è andato perso.
pub fn strip_stamp(name: &str) -> String {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return name.to_string();
    };
    // Un file senza estensione porta il timbro in coda: lì l'estensione è il
    // timbro stesso.
    if !stem.is_empty() && is_stamp(ext) {
        return stem.to_string();
    }
    match stem.rsplit_once('.') {
        Some((base, tail)) if !base.is_empty() && is_stamp(tail) => format!("{base}.{ext}"),
        _ => name.to_string(),
    }
}

/// La forma `YYYY-MM-DDTHH-MM-SS`, eventualmente seguita da `-<contatore>`
/// (due cancellazioni della stessa nota nello stesso secondo).
pub fn is_stamp(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 19 {
        return false;
    }
    let shape = b[..19].iter().enumerate().all(|(the, c)| match the {
        4 | 7 | 13 | 16 => *c == b'-',
        10 => *c == b'T',
        _ => c.is_ascii_digit(),
    });
    let counter = match &b[19..] {
        [] => true,
        [b'-', digits @ ..] => !digits.is_empty() && digits.iter().all(|c| c.is_ascii_digit()),
        _ => false,
    };
    shape && counter
}

/// Il nome che una nota prende nel cestino, dato un cestino che sa dire se un
/// candidato è già occupato.
///
/// Sulle collisioni non si sovrascrive e non si fallisce: il nome prende un
/// suffisso con l'istante della cancellazione (D2), e — se anche quello è
/// occupato, cioè due cancellazioni nello stesso secondo — un contatore.
///
/// La sequenza dei candidati è infinita, quindi la ricerca finisce sempre: è
/// la ragione per cui questa funzione non ha un ramo di errore.
pub fn trashed_id(id: &str, stamp: &str, occupied: &mut dyn FnMut(&str) -> bool) -> String {
    let name = file_name_of(id);
    (0u32..)
        .map(|n| match n {
            0 => name.to_string(),
            1 => stamped_name(name, stamp),
            _ => stamped_name(name, &format!("{stamp}-{n}")),
        })
        .map(|candidate| format!("{TRASH_DIR}/{candidate}"))
        .find(|candidate| !occupied(candidate))
        .expect("the candidate sequence is infinite")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trashed_name_keeps_its_extension() {
        // Il timbro sta in mezzo: il file resta un `.md`, e Obsidian lo apre.
        assert_eq!(
            stamped_name("Nota.md", "2026-07-24T15-30-00"),
            "Nota.2026-07-24T15-30-00.md"
        );
        assert_eq!(
            stamped_name("senza-estensione", "2026-07-24T15-30-00"),
            "senza-estensione.2026-07-24T15-30-00"
        );
        // Un file che è solo estensione (`.gitignore`) non ha stem da timbrare.
        assert_eq!(
            stamped_name(".env", "2026-07-24T15-30-00"),
            ".env.2026-07-24T15-30-00"
        );
    }

    #[test]
    fn the_original_name_survives_the_round_trip() {
        for name in ["Nota.md", "Con.punti.nel.nome.md", "senza-estensione"] {
            let stamped = stamped_name(name, "2026-07-24T15-30-00");
            assert_eq!(strip_stamp(&stamped), name, "round trip of {name}");
        }
        // Anche col contatore delle collisioni nello stesso secondo.
        assert_eq!(strip_stamp("Nota.2026-07-24T15-30-00-3.md"), "Nota.md");
    }

    #[test]
    fn a_name_that_only_looks_stamped_is_left_alone() {
        // Un file mai timbrato torna identico.
        assert_eq!(strip_stamp("Nota.md"), "Nota.md");
        // Forma sbagliata: non è un timbro, è parte del nome.
        assert_eq!(
            strip_stamp("Riunione.2026-07-24 15:30:00.md"),
            "Riunione.2026-07-24 15:30:00.md"
        );
        assert_eq!(strip_stamp("Bilancio.2026.md"), "Bilancio.2026.md");
        // Il contatore vuole cifre, non un suffisso qualsiasi.
        assert_eq!(
            strip_stamp("Nota.2026-07-24T15-30-00-bozza.md"),
            "Nota.2026-07-24T15-30-00-bozza.md"
        );
    }

    /// Il cestino è piatto: la cartella di provenienza non entra nell'id.
    #[test]
    fn the_trash_is_flat_and_collisions_receive_the_stamp() {
        let occupied = ["".to_string()];
        assert_eq!(
            trashed_id("Progetti/Idea.md", "2026-07-24T15-30-00", &mut |c| {
                occupied.contains(&c.to_string())
            }),
            ".trash/Idea.md"
        );

        let occupied = [".trash/Idea.md".to_string()];
        assert_eq!(
            trashed_id("Progetti/Idea.md", "2026-07-24T15-30-00", &mut |c| {
                occupied.contains(&c.to_string())
            }),
            ".trash/Idea.2026-07-24T15-30-00.md"
        );

        let occupied = [
            ".trash/Idea.md".to_string(),
            ".trash/Idea.2026-07-24T15-30-00.md".to_string(),
        ];
        assert_eq!(
            trashed_id("Idea.md", "2026-07-24T15-30-00", &mut |c| {
                occupied.contains(&c.to_string())
            }),
            ".trash/Idea.2026-07-24T15-30-00-2.md"
        );
    }
}
