//! **Di chi è un id** — la regola dei namespace, per tutti gli spazi di nomi
//! del contratto (§7.4).
//!
//! Gli spazi di nomi sono otto e fino al §7.4 nessuno aveva una regola: id di
//! view, di comando, di regola sintattica e di renderer, `custom-kind` dei
//! blocchi, `ns` delle query e degli update custom, topic degli eventi custom,
//! chiavi di impostazione, nomi dei job. Alcuni avevano una **convenzione**
//! scritta in un commento (`"<plugin-id>/<nome>"` per i topic), altri niente, e
//! nessuna era imposta da qualcosa.
//!
//! Non è pignoleria di stile: il costo di non averla non si paga scrivendo le
//! voci ma **dopo**, e non lo paga chi ha sbagliato. Due plugin che rivendicano
//! `board` si oscurano a vicenda in silenzio; e rinominare un id dopo il freeze
//! vuol dire rompere le hotkey, le impostazioni salvate e i link a view di
//! chiunque abbia scritto un plugin nel frattempo.
//!
//! # La regola, in due righe
//!
//! - Il **core** nomina liberamente: un id nudo (`backlinks`, `note.create`) è
//!   suo, e così un id nel namespace [`CORE_NS`](crate::options::CORE_NS)
//!   (`fubmd:diagrams`).
//! - Chiunque altro nomina **dentro il proprio id di plugin**:
//!   `com.acme.tasks:board`. Non è una convenzione da rispettare, è la
//!   condizione perché la registrazione riesca.
//!
//! Ne segue la proprietà che serve: **due plugin non possono collidere**, e il
//! solo spazio conteso è quello del core con sé stesso — dove una collisione è
//! un errore di chi scrive questo repo, che un test vede.
//!
//! # Perché il separatore è `:` e non `/` né `.`
//!
//! Perché è quello che [`OptionMap`](crate::options::OptionMap) già usa per le
//! sue chiavi, e le chiavi di opzione sono uno degli otto spazi. Un secondo
//! separatore avrebbe voluto dire una seconda regola con un secondo modo di
//! sbagliarla. Il `.` resta libero **dentro** il nome (`note.create`,
//! `com.acme.tasks`), che è ciò che permette a un id di plugin di essere un
//! nome a domini rovesciati senza ambiguità: si spezza sul **primo** `:`.

use crate::options::{OptionMap, CORE_NS};

/// Chi sta registrando un nome.
///
/// Non è il grado di fiducia e non è il manifest: è la sola domanda che la
/// regola dei nomi si pone — *questo nome è tuo?* Chi decide che qualcuno è
/// [`Owner::Core`] è l'host, al montaggio.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Owner<'a> {
    /// Il core: id nudi e namespace `fubmd`.
    Core,
    /// Un plugin, col proprio id: solo `<id>:<nome>`.
    Plugin(&'a str),
}

impl Owner<'_> {
    /// Il namespace che questo proprietario può usare.
    pub fn namespace(&self) -> &str {
        match self {
            Owner::Core => CORE_NS,
            Owner::Plugin(id) => id,
        }
    }
}

/// Perché un id non è nominabile da chi lo sta registrando.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdFault {
    /// Un id nudo da un plugin: nessuno spazio di nomi, quindi nessun modo di
    /// non collidere.
    Unnamespaced { id: String, owner: String },
    /// Un id nel namespace di **qualcun altro**.
    Foreign {
        id: String,
        namespace: String,
        owner: String,
    },
    /// `:` c'è ma una delle due metà è vuota (`:board`, `acme:`).
    Malformed { id: String },
}

impl std::fmt::Display for IdFault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IdFault::Unnamespaced { id, owner } => write!(
                f,
                "l'id `{id}` non ha un namespace: `{owner}` deve nominare `{owner}:{id}`"
            ),
            IdFault::Foreign {
                id,
                namespace,
                owner,
            } => write!(
                f,
                "l'id `{id}` sta nel namespace `{namespace}`, che non è di `{owner}`"
            ),
            IdFault::Malformed { id } => {
                write!(f, "l'id `{id}` ha un `:` con una metà vuota")
            }
        }
    }
}

impl std::error::Error for IdFault {}

/// `owner` può registrare questo id?
///
/// È la funzione che ogni registrazione chiama, per **ogni** nome che il
/// registrante dichiara — non solo per il primo. Un provider che offre tre view
/// e ne nomina bene due non ne registra due: non si registra affatto, perché una
/// registrazione a metà è uno stato che nessuno ha chiesto.
pub fn check(id: &str, owner: Owner<'_>) -> Result<(), IdFault> {
    if id.is_empty() {
        return Err(IdFault::Malformed { id: id.to_string() });
    }
    match id.split_once(':') {
        None => match owner {
            // Il core nomina anche nudo: è ciò che tiene `backlinks` e
            // `note.create` leggibili, e sono i nomi che l'utente vede nella
            // palette e nelle hotkey.
            Owner::Core => Ok(()),
            Owner::Plugin(plugin) => Err(IdFault::Unnamespaced {
                id: id.to_string(),
                owner: plugin.to_string(),
            }),
        },
        Some((ns, name)) if ns.is_empty() || name.is_empty() => {
            Err(IdFault::Malformed { id: id.to_string() })
        }
        Some((ns, _)) if ns == owner.namespace() => Ok(()),
        Some((ns, _)) => Err(IdFault::Foreign {
            id: id.to_string(),
            namespace: ns.to_string(),
            owner: owner.namespace().to_string(),
        }),
    }
}

/// Il namespace di un id, se ne ha uno: la stessa lettura di
/// [`OptionMap::ns_of`], perché è lo stesso spazio di nomi.
pub fn namespace_of(id: &str) -> Option<&str> {
    OptionMap::ns_of(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_core_may_name_bare_and_in_its_own_namespace() {
        assert!(check("backlinks", Owner::Core).is_ok());
        assert!(check("note.create", Owner::Core).is_ok());
        assert!(check("fubmd:diagrams", Owner::Core).is_ok());
        // Ma non nel namespace di un plugin: il core non si intesta i nomi
        // altrui più di quanto possa farlo un plugin.
        assert!(matches!(
            check("com.acme.tasks:board", Owner::Core),
            Err(IdFault::Foreign { .. })
        ));
    }

    #[test]
    fn a_plugin_may_only_name_inside_its_own_id() {
        let acme = Owner::Plugin("com.acme.tasks");
        assert!(check("com.acme.tasks:board", acme).is_ok());
        // Un id nudo è quello che collide in silenzio: è il caso che la regola
        // esiste per rendere impossibile.
        assert!(matches!(
            check("board", acme),
            Err(IdFault::Unnamespaced { .. })
        ));
        // E il namespace del core non è di nessun plugin.
        assert!(matches!(
            check("fubmd:diagrams", acme),
            Err(IdFault::Foreign { .. })
        ));
    }

    #[test]
    fn the_split_is_on_the_first_colon_so_reverse_domain_ids_work() {
        // Un id di plugin con dei punti dentro resta un id solo; e un nome che
        // contiene a sua volta un `:` non spezza la proprietà.
        let acme = Owner::Plugin("com.acme.tasks");
        assert!(check("com.acme.tasks:board:kanban", acme).is_ok());
        assert_eq!(namespace_of("com.acme.tasks:board"), Some("com.acme.tasks"));
    }

    #[test]
    fn a_colon_with_an_empty_half_is_malformed_for_everyone() {
        for owner in [Owner::Core, Owner::Plugin("acme")] {
            assert!(matches!(
                check(":board", owner),
                Err(IdFault::Malformed { .. })
            ));
            assert!(matches!(
                check("acme:", owner),
                Err(IdFault::Malformed { .. })
            ));
            assert!(matches!(check("", owner), Err(IdFault::Malformed { .. })));
        }
    }

    #[test]
    fn the_message_says_what_to_write_instead() {
        let fault = check("board", Owner::Plugin("acme")).expect_err("id nudo da un plugin");
        assert!(
            fault.to_string().contains("acme:board"),
            "il messaggio deve portare l'id giusto, non solo dire che è sbagliato: {fault}"
        );
    }
}
