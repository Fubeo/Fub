//! **Che forma ha una scorciatoia**, e quali questa app sa premere.
//!
//! Una scorciatoia è una stringa che qualcuno scrive: un comando la dichiara
//! nel proprio `CommandSpec`, un plugin nel suo, l'utente nelle impostazioni.
//! La leggono due mondi lontani: la shell, che a ogni tasto premuto deve dire
//! se l'accordo è *quello*, e chi guarda il registro fermo per dire «questi
//! due comandi si contendono lo stesso accordo».
//!
//! Prima era scritta in tre copie, e due non erano ciò che dicevano di essere:
//! spezzavano solo sul `-` e non sapevano che una scorciatoia è una
//! **sequenza** di accordi separati da spazio, né che ci sono stringhe che
//! questa shell **non può premere** (difetto 0148). Qui la forma è dichiarata
//! una volta sola, e la copia della shell è tenuta uguale dal mirror delle
//! regole (`crates/fub-abi/tests/rules_mirror.rs` con la gemella
//! `apps/client/src/rules/rules-mirror.test.ts`).
//!
//! # Le due metà della forma
//!
//! - **È una sequenza**: `Mod-k d` sono due accordi premuti in ordine.
//! - **Il primo accordo porta un modificatore, i successivi no per forza**:
//!   un tasto nudo non ha un momento in cui è libero mentre si scrive una nota;
//!   dopo `Mod-k` la modalità c'è ed è dichiarata, e dentro quella finestra la
//!   `d` non è di nessuno.
//!
//! # `Mod` e `Ctrl`
//!
//! `Mod` è il modificatore dei comandi: Cmd sul Mac, Ctrl altrove. `Ctrl` è il
//! tasto Control **anche** sul Mac, per i pochi accordi che lì non possono
//! stare su Cmd: `Cmd-Tab` è del sistema, e il giro delle schede è `Ctrl-Tab`
//! come in ogni browser. Fuori dal Mac i due sono lo stesso tasto, quindi
//! `Ctrl-k` e `Mod-k` si contendono lo stesso gesto: le domande sui conflitti
//! si fanno sulla forma **piegata** ([`folded`]), dove `ctrl` diventa `mod`.
//! `Mod-Ctrl-k` si rifiuta, perché fuori dal Mac sarebbe un tasto tenuto due
//! volte.
//!
//! # Perché `None` e non «una stringa qualunque»
//!
//! `Meta-k` non è `Mod-k`: `Meta` non è fra i modificatori che questa app
//! riconosce, e leggere perdonando il modificatore ignoto vorrebbe dire
//! registrare `k` **nudo**. Chi l'ha scritto crederebbe di aver configurato
//! Meta. Una scorciatoia scritta male si rifiuta e si dice.

/// I modificatori che questa app riconosce, e nessun altro.
///
/// `mod` è Ctrl o Cmd: sono lo stesso modificatore per chi scrive un accordo, e
/// due tasti diversi solo per chi ha comprato il computer. `ctrl` è Control
/// anche sul Mac.
const MODIFIERS: [&str; 4] = ["mod", "ctrl", "shift", "alt"];

/// Un accordo — modificatori e tasto — già in forma confrontabile.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Chord {
    /// Il tasto, minuscolo: com'è scritto da chi dichiara la scorciatoia, e come
    /// la shell legge `KeyboardEvent.key`.
    pub key: String,
    /// Ctrl o Cmd.
    pub command: bool,
    /// Control anche sul Mac; fuori dal Mac è lo stesso tasto di `command`.
    pub control: bool,
    pub shift: bool,
    pub alt: bool,
}

impl Chord {
    /// La forma con cui un accordo si **confronta**: modificatori in ordine
    /// alfabetico, minuscolo. Non è la forma che si legge — quella la scrive
    /// chi disegna, e dice `Mod-K`.
    pub fn canonical(&self) -> String {
        let mut parts: Vec<&str> = Vec::with_capacity(5);
        if self.alt {
            parts.push("alt");
        }
        if self.control {
            parts.push("ctrl");
        }
        if self.command {
            parts.push("mod");
        }
        if self.shift {
            parts.push("shift");
        }
        parts.push(&self.key);
        parts.join("-")
    }

    /// Lo stesso accordo con `ctrl` letto come `mod`: com'è premuto fuori dal
    /// Mac.
    fn fold(&self) -> Chord {
        Chord {
            command: self.command || self.control,
            control: false,
            ..self.clone()
        }
    }
}

/// La scorciatoia scomposta negli accordi che la compongono, o `None` se non è
/// una scorciatoia che questa app sa premere.
///
/// `None` e non un elenco vuoto: chi la scrive deve poterlo **sapere**, e un
/// valore che si confonde con «nessuna scorciatoia» è esattamente il modo in cui
/// non lo saprebbe.
pub fn chords(binding: &str) -> Option<Vec<Chord>> {
    let text = binding.trim();
    if text.is_empty() {
        return None;
    }
    let mut chords = Vec::new();
    for piece in text.split_whitespace() {
        // `Mod--` è il tasto meno: il separatore non può essere anche il tasto.
        let (parts, key): (Vec<&str>, &str) = match piece.strip_suffix("--") {
            Some(mods) => (mods.split('-').filter(|p| !p.is_empty()).collect(), "-"),
            None => {
                let mut parts: Vec<&str> = piece.split('-').collect();
                // L'ultimo pezzo è il tasto; se è vuoto (`Mod-`) non c'è un tasto.
                let key = parts.pop().filter(|t| !t.is_empty())?;
                (parts, key)
            }
        };
        let mods: Vec<String> = parts.iter().map(|p| p.to_lowercase()).collect();
        if mods.iter().any(|m| !MODIFIERS.contains(&m.as_str())) {
            return None;
        }
        // `Mod-Mod-k` non è un accordo: chi l'ha scritto voleva dire qualcosa
        // che non c'è, e indovinare quale è il modo di sbagliare in silenzio.
        let mut seen: Vec<&String> = mods.iter().collect();
        seen.sort();
        seen.dedup();
        if seen.len() != mods.len() {
            return None;
        }
        // `Mod-Ctrl-k`: fuori dal Mac è Ctrl tenuto due volte, cioè `Mod-k`.
        if mods.iter().any(|m| m == "mod") && mods.iter().any(|m| m == "ctrl") {
            return None;
        }
        // `+` e `=` sono lo stesso tasto dello zoom: sulla tastiera americana
        // `+` è `Shift-=`, su quella italiana `+` ha un tasto suo.
        let plus = key == "+";
        chords.push(Chord {
            key: if plus {
                "=".to_string()
            } else {
                key.to_lowercase()
            },
            command: mods.iter().any(|m| m == "mod"),
            control: mods.iter().any(|m| m == "ctrl"),
            shift: !plus && mods.iter().any(|m| m == "shift"),
            alt: mods.iter().any(|m| m == "alt"),
        });
    }
    let first = chords.first()?;
    if !first.command && !first.control && !first.shift && !first.alt {
        return None;
    }
    Some(chords)
}

/// La scorciatoia in forma canonica — gli accordi in ordine, i modificatori in
/// ordine, tutto minuscolo — o `None` se questa app non la sa premere.
///
/// È la chiave con cui due scorciatoie si scoprono la stessa: `Shift-Mod-g` e
/// `Mod-Shift-g` sono due stringhe per la tastiera e un gesto solo per le dita.
pub fn canonical(binding: &str) -> Option<String> {
    Some(
        chords(binding)?
            .iter()
            .map(Chord::canonical)
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// La scorciatoia in forma canonica **piegata**: come [`canonical`], con
/// `ctrl` letto come `mod`.
///
/// È la chiave dei conflitti. `Ctrl-Tab` e `Mod-Tab` sono due accordi sul Mac
/// e uno solo altrove, e un conflitto che esiste su una piattaforma è un
/// conflitto: chi dichiara i tasti non sa dove li premeranno.
pub fn folded(binding: &str) -> Option<String> {
    Some(
        chords(binding)?
            .iter()
            .map(|chord| chord.fold().canonical())
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// La corta **oscura** la lunga: chi preme la corta non arriva mai alla lunga.
///
/// Non è un conflitto di accordi — `Mod-k` e `Mod-k d` non sono lo stesso
/// accordo — ma il risultato per chi preme è lo stesso, e peggio: la lunga non
/// si esegue mai e nessuno lo dice. La regola che lo produce è che un accordo
/// completo si esegue subito, senza aspettare per vedere se ne arriva un altro
/// (aspettare metterebbe un ritardo su ogni pressione di `Mod-k`).
///
/// Si legge sulla forma canonica, dove la sequenza è già separata da spazi: la
/// corta è un prefisso della lunga **fino a un confine di accordo**, o `mod-k`
/// oscurerebbe `mod-k2 d`, che non è la stessa cosa. La forma è quella
/// piegata, per la ragione di [`folded`].
pub fn obscures(short: &str, long: &str) -> bool {
    let (Some(short), Some(long)) = (folded(short), folded(long)) else {
        return false;
    };
    // Prefisso fino al confine di accordo: la corta seguita da uno spazio.
    // Niente `format!` intermedio: con `starts_with` regge, `corta.len()` è un
    // confine di char, e l'ottetto successivo è uno spazio.
    long.len() > short.len()
        && long.starts_with(&short)
        && long.as_bytes().get(short.len()) == Some(&b' ')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_orders_of_modifiers_are_the_same_gesture() {
        assert_eq!(canonical("Shift-Mod-g"), canonical("Mod-Shift-g"));
        assert_eq!(canonical("Mod-Shift-g").as_deref(), Some("mod-shift-g"));
    }

    #[test]
    fn a_sequence_stays_a_sequence() {
        assert_eq!(canonical("Mod-k  d").as_deref(), Some("mod-k d"));
        assert_ne!(canonical("Mod-k d"), canonical("Mod-k-d"));
    }

    #[test]
    fn what_this_app_cannot_press_does_not_normalize() {
        // Il modificatore che non esiste, il primo tasto nudo, il tasto che
        // manca, il modificatore ripetuto, il vuoto.
        for writing in ["Meta-k", "d", "Mod-", "Mod-Mod-k", "Mod-Ctrl-k", "", "   "] {
            assert_eq!(canonical(writing), None, "\"{writing}\"");
        }
        // E il secondo accordo nudo invece va bene: dopo `Mod-k` la modalità è
        // aperta e dichiarata.
        assert_eq!(canonical("Mod-k d").as_deref(), Some("mod-k d"));
    }

    #[test]
    fn minus_and_plus_are_keys() {
        assert_eq!(canonical("Mod--").as_deref(), Some("mod--"));
        assert_eq!(canonical("Mod-Shift--").as_deref(), Some("mod-shift--"));
        assert_eq!(canonical("Mod-+"), canonical("Mod-="));
        assert_eq!(canonical("Mod-Shift-+"), canonical("Mod-="));
        assert_eq!(canonical("-"), None);
    }

    #[test]
    fn obscures_respects_chord_boundaries() {
        assert!(obscures("Mod-k", "Mod-k d"));
        assert!(!obscures("Mod-k", "Mod-k"));
        assert!(!obscures("Mod-k d", "Mod-k"));
        // Il caso che uno `starts_with` sulla stringa nuda sbaglierebbe.
        assert!(!obscures("Mod-k", "Mod-k2 d"));
        // E ciò che non si sa premere non oscura niente.
        assert!(!obscures("Meta-k", "Meta-k d"));
        // `Ctrl-k` è il prefisso di `Mod-k d` fuori dal Mac.
        assert!(obscures("Ctrl-k", "Mod-k d"));
    }

    #[test]
    fn ctrl_is_its_own_word_and_folds_into_mod() {
        assert_eq!(canonical("Ctrl-Tab").as_deref(), Some("ctrl-tab"));
        assert_eq!(
            canonical("Shift-Ctrl-Tab").as_deref(),
            Some("ctrl-shift-tab")
        );
        assert_ne!(canonical("Ctrl-Tab"), canonical("Mod-Tab"));
        assert_eq!(folded("Ctrl-Tab"), folded("Mod-Tab"));
        assert_eq!(folded("Alt-Ctrl-k  d").as_deref(), Some("alt-mod-k d"));
    }
}
