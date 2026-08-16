//! **Che forma ha una scorciatoia**, e quali questa app sa premere (§1.36).
//!
//! Una scorciatoia è una stringa che qualcuno scrive: un comando del core la
//! dichiara nel proprio `CommandSpec`, un plugin la dichiara nel suo, l'utente
//! la riscrive nelle impostazioni. Chi la legge sono due, e stanno lontani: la
//! shell, che deve decidere a ogni tasto premuto se un accordo è *quello*, e
//! chiunque guardi il registro fermo per dire «questi due comandi si contendono
//! lo stesso accordo» — i banchi degli accordi ufficiali, la palette che
//! avverte, un domani un pannello delle impostazioni che rifiuta una riga.
//!
//! Era scritta tre volte, e due delle tre copie non erano ciò che dicevano di
//! essere: si annunciavano «come lo normalizza la shell» e spezzavano solo sul
//! `-`, quindi non sapevano né che una scorciatoia è una **sequenza** di accordi
//! separati da spazio, né che ci sono stringhe che questa shell **non sa
//! premere** — e normalizzavano allegramente anche quelle (difetto 0148). Qui la
//! forma è dichiarata una volta, di qua, e la copia della shell è tenuta uguale
//! dal mirror delle regole (`crates/fub-abi/tests/rules_mirror.rs` con la
//! gemella `frontend/src/rules/rules-mirror.test.ts`), che è il solo modo in cui
//! due lingue diverse restano d'accordo su una regola.
//!
//! # Le due metà della forma
//!
//! - **Una sequenza**: `Mod-k d` è due accordi, il secondo premuto dopo il
//!   primo. Lo spazio separa, e la sequenza è una sola scorciatoia.
//! - **Il primo accordo porta un modificatore, i successivi no per forza**: un
//!   comando che dichiarasse `f` ruberebbe una lettera a chi scrive una nota, e
//!   questa app non ha modi, quindi un tasto nudo non ha un momento in cui è
//!   libero; dopo `Mod-k`, invece, la modalità c'è ed è dichiarata, e dentro
//!   quella finestra la `d` non è di nessuno.
//!
//! # Perché `None` e non «una stringa qualunque»
//!
//! `Ctrl-k` non è `Mod-k`: `Ctrl` non è fra i modificatori che questa app
//! riconosce, e leggerlo perdonando il modificatore ignoto vorrebbe dire
//! registrare `k` **nudo**, cioè un tasto che risponde mentre si scrive. Chi
//! l'ha scritto crederebbe di aver configurato Ctrl. Una scorciatoia scritta
//! male si rifiuta e si dice — è la stessa riga per cui la politica dei nomi
//! risponde con un guasto invece di aggiustare il nome.

/// I modificatori che questa app riconosce, e nessun altro.
///
/// `mod` è Ctrl o Cmd: sono lo stesso modificatore per chi scrive un accordo, e
/// due tasti diversi solo per chi ha comprato il computer.
const MODIFICATORI: [&str; 3] = ["mod", "shift", "alt"];

/// Un accordo solo — i modificatori e il tasto — già in forma confrontabile.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Accordo {
    /// Il tasto, minuscolo: com'è scritto da chi dichiara la scorciatoia, e come
    /// la shell legge `KeyboardEvent.key`.
    pub tasto: String,
    /// Ctrl o Cmd.
    pub comando: bool,
    pub shift: bool,
    pub alt: bool,
}

impl Accordo {
    /// La forma con cui un accordo si **confronta**: modificatori in ordine
    /// alfabetico, minuscolo. Non è la forma che si legge — quella la scrive
    /// chi disegna, e dice `Mod-K`.
    pub fn canonico(&self) -> String {
        let mut pezzi: Vec<&str> = Vec::with_capacity(4);
        if self.alt {
            pezzi.push("alt");
        }
        if self.comando {
            pezzi.push("mod");
        }
        if self.shift {
            pezzi.push("shift");
        }
        pezzi.push(&self.tasto);
        pezzi.join("-")
    }
}

/// La scorciatoia scomposta negli accordi che la compongono, o `None` se non è
/// una scorciatoia che questa app sa premere.
///
/// `None` e non un elenco vuoto: chi la scrive deve poterlo **sapere**, e un
/// valore che si confonde con «nessuna scorciatoia» è esattamente il modo in cui
/// non lo saprebbe.
pub fn accordi(binding: &str) -> Option<Vec<Accordo>> {
    let testo = binding.trim();
    if testo.is_empty() {
        return None;
    }
    let mut accordi = Vec::new();
    for pezzo in testo.split_whitespace() {
        let mut parti: Vec<&str> = pezzo.split('-').collect();
        // L'ultimo pezzo è il tasto; se è vuoto (`Mod-`) non c'è un tasto.
        let tasto = parti.pop().filter(|t| !t.is_empty())?;
        let mods: Vec<String> = parti.iter().map(|p| p.to_lowercase()).collect();
        if mods.iter().any(|m| !MODIFICATORI.contains(&m.as_str())) {
            return None;
        }
        // `Mod-Mod-k` non è un accordo: chi l'ha scritto voleva dire qualcosa
        // che non c'è, e indovinare quale è il modo di sbagliare in silenzio.
        let mut visti: Vec<&String> = mods.iter().collect();
        visti.sort();
        visti.dedup();
        if visti.len() != mods.len() {
            return None;
        }
        accordi.push(Accordo {
            tasto: tasto.to_lowercase(),
            comando: mods.iter().any(|m| m == "mod"),
            shift: mods.iter().any(|m| m == "shift"),
            alt: mods.iter().any(|m| m == "alt"),
        });
    }
    let primo = accordi.first()?;
    if !primo.comando && !primo.shift && !primo.alt {
        return None;
    }
    Some(accordi)
}

/// La scorciatoia in forma canonica — gli accordi in ordine, i modificatori in
/// ordine, tutto minuscolo — o `None` se questa app non la sa premere.
///
/// È la chiave con cui due scorciatoie si scoprono la stessa: `Shift-Mod-g` e
/// `Mod-Shift-g` sono due stringhe per la tastiera e un gesto solo per le dita.
pub fn canonica(binding: &str) -> Option<String> {
    Some(
        accordi(binding)?
            .iter()
            .map(Accordo::canonico)
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
/// oscurerebbe `mod-k2 d`, che non è la stessa cosa.
pub fn oscura(corta: &str, lunga: &str) -> bool {
    let (Some(corta), Some(lunga)) = (canonica(corta), canonica(lunga)) else {
        return false;
    };
    // Prefisso fino al confine di accordo: la corta seguita da uno spazio.
    // Niente `format!` intermedio: con `starts_with` regge, `corta.len()` è un
    // confine di char, e l'ottetto successivo è uno spazio.
    lunga.len() > corta.len()
        && lunga.starts_with(&corta)
        && lunga.as_bytes().get(corta.len()) == Some(&b' ')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn due_ordini_dei_modificatori_sono_lo_stesso_gesto() {
        assert_eq!(canonica("Shift-Mod-g"), canonica("Mod-Shift-g"));
        assert_eq!(canonica("Mod-Shift-g").as_deref(), Some("mod-shift-g"));
    }

    #[test]
    fn una_sequenza_resta_una_sequenza() {
        assert_eq!(canonica("Mod-k  d").as_deref(), Some("mod-k d"));
        assert_ne!(canonica("Mod-k d"), canonica("Mod-k-d"));
    }

    #[test]
    fn cio_che_questa_app_non_sa_premere_non_si_normalizza() {
        // Il modificatore che non esiste, il primo tasto nudo, il tasto che
        // manca, il modificatore ripetuto, il vuoto.
        for scritta in ["Ctrl-k", "d", "Mod-", "Mod-Mod-k", "", "   "] {
            assert_eq!(canonica(scritta), None, "«{scritta}»");
        }
        // E il secondo accordo nudo invece va bene: dopo `Mod-k` la modalità è
        // aperta e dichiarata.
        assert_eq!(canonica("Mod-k d").as_deref(), Some("mod-k d"));
    }

    #[test]
    fn oscura_guarda_i_confini_degli_accordi() {
        assert!(oscura("Mod-k", "Mod-k d"));
        assert!(!oscura("Mod-k", "Mod-k"));
        assert!(!oscura("Mod-k d", "Mod-k"));
        // Il caso che uno `starts_with` sulla stringa nuda sbaglierebbe.
        assert!(!oscura("Mod-k", "Mod-k2 d"));
        // E ciò che non si sa premere non oscura niente.
        assert!(!oscura("Ctrl-k", "Ctrl-k d"));
    }
}
