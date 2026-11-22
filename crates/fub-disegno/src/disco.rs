//! Il motore del disegno non tocca il disco (piano K6, T28;
//! `docs/architecture/disegno-completo.md#il-disco`).
//!
//! I file li legge e li scrive il kernel; il motore riceve e rende byte. Due
//! cose lo tengono fuori dal disco:
//!
//! - **le radici**: alla nascita del motore, [`confina`] mette nel processo le
//!   radici di [`nessuna`] (vuote ma in vigore, patch 0008): ogni
//!   `check_read` e `check_write` del motore rifiuta, in ogni thread, e la
//!   scansione dei caratteri del sistema si spegne (i caratteri sono quelli
//!   che Fub dà come byte);
//! - **la guardia prima del motore**: [`controlla`] rifiuta un comando che
//!   porta un percorso (come dice lo schema del comando), un comando escluso
//!   e un comando che serve Fub (le righe `fub`: salvare, il recupero, i
//!   modelli), prima che arrivi al motore.
//!
//! L'elenco `crates/fub-disegno/disco.tsv` dice, per ogni punto del motore che
//! tocca il disco, chi ci arriva e perché non tocca il disco di Fub; lo
//! controlla `node tools/disegno-disco/elenco.mjs --check`. Qui entra con
//! `include_str!` e si legge una volta: le righe `escluso` danno i comandi
//! rifiutati col loro perché, le righe `fub` i comandi che serve Fub, le righe `byte` e `kernel` con `id:argomento`
//! le forme di un comando che portano un percorso e passano lo stesso
//! (perché Fub legge il file con il kernel e passa i byte).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::sync::{Arc, OnceLock};

use fub_abi::PluginError;
use serde_json::Value;
use vectorcraft_engine::file_access::{self, AutomationRoots};

/// L'elenco dei punti del motore che toccano il disco, com'è nel crate.
pub const ELENCO: &str = include_str!("../disco.tsv");

/// I nomi di un argomento che porta un percorso, nello schema di un comando
/// del motore (`CommandSpec::params`).
const NOMI_DI_PERCORSO: [&str; 8] = [
    "path",
    "paths",
    "folder",
    "folders",
    "file",
    "files",
    "dir",
    "directory",
];

/// Come comincia la descrizione di un argomento che ha il nome di un percorso
/// ma porta altro: un id (`text.createInPath {path: id}`), degli indici
/// (`[i…]`), dei file come byte (`[{name, dataBase64}…]`).
const NON_PERCORSO: [&str; 3] = ["id", "[i", "[{"];

/// Le radici del processo del motore: nessuna cartella da leggere né da
/// scrivere, ma in vigore. Sempre le stesse (`Arc::ptr_eq`).
pub fn nessuna() -> &'static Arc<AutomationRoots> {
    static NESSUNA: OnceLock<Arc<AutomationRoots>> = OnceLock::new();
    NESSUNA.get_or_init(AutomationRoots::deny_all)
}

/// Il motore non si confina: nel processo ci sono già altre radici.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AltreRadici;

impl fmt::Display for AltreRadici {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(
            "il motore del disegno non nasce: il processo ha già radici per i file che non sono quelle di Fub (nessuna cartella)",
        )
    }
}

impl std::error::Error for AltreRadici {}

/// Confina il motore: radici [`nessuna`] per tutto il processo, e niente
/// scansione dei caratteri del sistema. Si chiama alla nascita del motore; la
/// seconda volta (due `Disegni` nello stesso processo, le prove) le radici
/// sono già quelle e va bene. Altre radici già in vigore sono un errore: il
/// motore non nasce.
pub fn confina() -> Result<(), AltreRadici> {
    vectorcraft_text::set_system_fonts(false);
    let radici = nessuna();
    if file_access::confine_process(Arc::clone(radici)) {
        return Ok(());
    }
    match file_access::current() {
        Some(in_vigore) if Arc::ptr_eq(&in_vigore, radici) => Ok(()),
        _ => Err(AltreRadici),
    }
}

/// Un comando che la guardia rifiuta prima del motore.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RifiutoDisco {
    /// Il comando porta un percorso: i file li legge e li scrive il kernel.
    Percorso { comando: String, argomento: String },
    /// Il comando è escluso (D6, D9, D12): `perche` è la nota dell'elenco.
    Escluso { comando: String, perche: String },
    /// Il comando lo serve Fub, non il motore (una riga `fub` dell'elenco):
    /// arrivato al motore toccherebbe il disco.
    Fub { comando: String },
    /// `prefs.set` nomina una delle preferenze che sono cartelle
    /// ([`crate::preferenze::CARTELLE`]): le cartelle sono del kernel.
    Cartella { chiave: String },
    /// L'elenco nel crate non si legge: ogni comando con un percorso o
    /// escluso si rifiuta finché non si corregge.
    Elenco(String),
}

impl fmt::Display for RifiutoDisco {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RifiutoDisco::Percorso { comando, argomento } => write!(
                f,
                "`{comando}` non prende percorsi (`value.{argomento}`): i file del disegno li legge e li scrive Fub"
            ),
            RifiutoDisco::Escluso { comando, perche } => {
                write!(f, "`{comando}` non c'è nel disegno di Fub: {perche}")
            }
            RifiutoDisco::Fub { comando } => write!(
                f,
                "`{comando}` lo fa Fub, non il motore del disegno: si chiede a Fub, non al motore"
            ),
            RifiutoDisco::Cartella { chiave } => write!(
                f,
                "`prefs.set` non cambia `{chiave}`: le cartelle del disegno sono di Fub, il motore non tocca il disco"
            ),
            RifiutoDisco::Elenco(errore) => {
                write!(f, "l'elenco dei file del motore non si legge: {errore}")
            }
        }
    }
}

impl std::error::Error for RifiutoDisco {}

impl From<RifiutoDisco> for PluginError {
    fn from(rifiuto: RifiutoDisco) -> PluginError {
        match rifiuto {
            RifiutoDisco::Elenco(_) => PluginError::Internal(rifiuto.to_string().into()),
            _ => PluginError::BadArgs(rifiuto.to_string().into()),
        }
    }
}

/// Ciò che la guardia prende dall'elenco.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Elenco {
    /// I comandi esclusi, con il perché (la nota della prima riga che li
    /// nomina).
    pub esclusi: BTreeMap<String, String>,
    /// I comandi che serve Fub (le righe `fub`): non arrivano al motore.
    pub serviti: BTreeSet<String>,
    /// Le forme (comando, argomento) che portano un percorso e passano: Fub
    /// legge o scrive il file con il kernel e passa i byte.
    pub forme: BTreeSet<(String, String)>,
    /// Quante righe ha l'elenco.
    pub righe: usize,
}

/// Legge l'elenco: le righe di commento (`#`) e l'intestazione restano fuori,
/// le colonne si trovano per nome. Un errore nomina la riga.
pub fn analizza(testo: &str) -> Result<Elenco, String> {
    let mut righe = testo
        .lines()
        .enumerate()
        .filter(|(_, r)| !r.starts_with('#') && !r.trim().is_empty());
    let (_, intestazione) = righe
        .next()
        .ok_or_else(|| "manca l'intestazione".to_string())?;
    let colonne: Vec<&str> = intestazione.split('\t').collect();
    let colonna = |nome: &str| {
        colonne
            .iter()
            .position(|c| *c == nome)
            .ok_or_else(|| format!("manca la colonna «{nome}»"))
    };
    let (comandi, come, nota) = (colonna("comandi")?, colonna("come")?, colonna("nota")?);
    let mut elenco = Elenco::default();
    for (n, riga) in righe {
        let campi: Vec<&str> = riga.split('\t').collect();
        if campi.len() != colonne.len() {
            return Err(format!(
                "riga {}: {} colonne, l'intestazione ne ha {}",
                n + 1,
                campi.len(),
                colonne.len()
            ));
        }
        elenco.righe += 1;
        let ids = campi[comandi].trim();
        let ids = if ids == "—" { "" } else { ids };
        for voce in ids.split(',').map(str::trim).filter(|v| !v.is_empty()) {
            let (id, argomento) = match voce.split_once(':') {
                Some((id, argomento)) => (id, Some(argomento)),
                None => (voce, None),
            };
            match (campi[come], argomento) {
                ("escluso", None) => {
                    elenco
                        .esclusi
                        .entry(id.to_string())
                        .or_insert_with(|| campi[nota].to_string());
                }
                ("fub", None) => {
                    elenco.serviti.insert(id.to_string());
                }
                ("byte" | "kernel", Some(argomento)) => {
                    elenco.forme.insert((id.to_string(), argomento.to_string()));
                }
                (_, Some(_)) => {
                    return Err(format!(
                        "riga {}: «{voce}» nomina una forma, che vale solo per byte e kernel",
                        n + 1
                    ))
                }
                _ => {}
            }
        }
    }
    Ok(elenco)
}

/// L'elenco del crate, letto una volta.
pub fn elenco() -> Result<&'static Elenco, &'static str> {
    static ELENCO_LETTO: OnceLock<Result<Elenco, String>> = OnceLock::new();
    ELENCO_LETTO
        .get_or_init(|| analizza(ELENCO))
        .as_ref()
        .map_err(String::as_str)
}

/// Gli argomenti di un comando del motore che portano un percorso, letti dal
/// suo schema: le chiavi del primo `{…}` dei parametri che si chiamano come
/// un percorso ([`NOMI_DI_PERCORSO`]), salvo quelle la cui descrizione dice
/// che portano altro ([`NON_PERCORSO`]). Una chiave dopo `|` è un'alternativa
/// solo se prima c'è un'altra chiave (`path | folder`), non un valore
/// (`orientation?: page|path`).
pub fn argomenti_di_percorso(params: &str) -> Vec<String> {
    chiavi(params)
        .into_iter()
        .filter(|(nome, descrizione)| {
            NOMI_DI_PERCORSO.contains(&nome.as_str())
                && !NON_PERCORSO.iter().any(|p| descrizione.starts_with(p))
        })
        .map(|(nome, _)| nome)
        .collect()
}

/// Le chiavi del primo `{…}` di uno schema, ognuna con la sua descrizione.
fn chiavi(params: &str) -> Vec<(String, String)> {
    let Some(inizio) = params.find('{') else {
        return Vec::new();
    };
    let mut pezzi = Vec::new();
    let mut corrente = String::new();
    let mut profondita = 0usize;
    for c in params[inizio..].chars() {
        match c {
            '{' | '[' | '(' => {
                profondita += 1;
                if profondita == 1 {
                    continue;
                }
            }
            '}' | ']' | ')' => {
                profondita = profondita.saturating_sub(1);
                if profondita == 0 {
                    pezzi.push(std::mem::take(&mut corrente));
                    break;
                }
            }
            ',' if profondita == 1 => {
                pezzi.push(std::mem::take(&mut corrente));
                continue;
            }
            '|' if profondita == 1 && chiave_sola(&corrente) => {
                pezzi.push(std::mem::take(&mut corrente));
                continue;
            }
            _ => {}
        }
        if profondita >= 1 {
            corrente.push(c);
        }
    }
    pezzi
        .iter()
        .filter_map(|pezzo| {
            let pezzo = pezzo.trim();
            let pezzo = pezzo
                .strip_prefix("...")
                .or_else(|| pezzo.strip_prefix('…'))
                .unwrap_or(pezzo);
            let fine = pezzo
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(pezzo.len());
            let (nome, resto) = pezzo.split_at(fine);
            if nome.is_empty() || nome.starts_with(|c: char| c.is_ascii_digit()) {
                return None;
            }
            let resto = resto.trim_start();
            let resto = resto.strip_prefix('?').unwrap_or(resto).trim_start();
            let descrizione = match resto.strip_prefix(':') {
                Some(d) => d.trim(),
                None if resto.is_empty() => "",
                None => return None,
            };
            Some((nome.to_string(), descrizione.to_string()))
        })
        .collect()
}

/// `testo` è solo una chiave (`path`, `path?`), senza descrizione.
fn chiave_sola(testo: &str) -> bool {
    let t = testo.trim();
    let t = t.strip_suffix('?').unwrap_or(t);
    !t.is_empty() && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Per ogni comando del motore, gli argomenti che portano un percorso (solo i
/// comandi che ne hanno). Letti dagli schemi una volta.
pub fn percorsi() -> &'static HashMap<&'static str, Vec<String>> {
    static PERCORSI: OnceLock<HashMap<&'static str, Vec<String>>> = OnceLock::new();
    PERCORSI.get_or_init(|| {
        let specs = vectorcraft_engine::guard::catch_panic(vectorcraft_engine::command_specs)
            .unwrap_or_default();
        specs
            .iter()
            .filter_map(|spec| {
                let argomenti = argomenti_di_percorso(spec.params);
                (!argomenti.is_empty()).then_some((spec.id, argomenti))
            })
            .collect()
    })
}

/// La guardia prima del motore: rifiuta un comando escluso o servito da Fub, e
/// un comando che
/// porta un percorso in `valore` (un argomento dello schema non nullo), salvo
/// le forme che l'elenco dice `byte` o `kernel`.
pub fn controlla(id: &str, valore: &Value) -> Result<(), RifiutoDisco> {
    if id == "prefs.set" {
        cartella_in(valore)?;
    }
    let elenco = elenco().map_err(|e| RifiutoDisco::Elenco(e.to_string()))?;
    if let Some(perche) = elenco.esclusi.get(id) {
        return Err(RifiutoDisco::Escluso {
            comando: id.to_string(),
            perche: perche.clone(),
        });
    }
    if elenco.serviti.contains(id) {
        return Err(RifiutoDisco::Fub {
            comando: id.to_string(),
        });
    }
    let Some(argomenti) = percorsi().get(id) else {
        return Ok(());
    };
    for argomento in argomenti {
        let portato = valore.get(argomento).is_some_and(|v| !v.is_null());
        if portato && !elenco.forme.contains(&(id.to_string(), argomento.clone())) {
            return Err(RifiutoDisco::Percorso {
                comando: id.to_string(),
                argomento: argomento.clone(),
            });
        }
    }
    Ok(())
}

/// Una cartella in `prefs.set`, come `{key, value}` o fra i `values`.
fn cartella_in(valore: &Value) -> Result<(), RifiutoDisco> {
    let nominate = valore.get("key").and_then(Value::as_str).into_iter().chain(
        valore
            .get("values")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|values| values.keys().map(String::as_str)),
    );
    for chiave in nominate {
        if crate::preferenze::e_cartella(chiave) {
            return Err(RifiutoDisco::Cartella {
                chiave: chiave.to_string(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prefs_set_con_una_cartella_si_rifiuta() {
        for valore in [
            json!({"key": "fontsFolder", "value": "/etc"}),
            json!({"values": {"keyboardIncrement": 2, "templatesFolder": "/tmp"}}),
        ] {
            assert!(
                matches!(
                    controlla("prefs.set", &valore),
                    Err(RifiutoDisco::Cartella { .. })
                ),
                "{valore}"
            );
        }
        let ok = json!({"key": "keyboardIncrement", "value": 2});
        assert!(controlla("prefs.set", &ok).is_ok());
        assert!(controlla("prefs.list", &json!({})).is_ok());
    }

    #[test]
    fn le_chiavi_di_percorso_si_leggono_dallo_schema() {
        let a = |p: &str| argomenti_di_percorso(p);
        assert_eq!(a("{path, data?} read it"), ["path"]);
        assert_eq!(
            a("{ids?: [id…], path | folder, copy?: false}"),
            ["path", "folder"]
        );
        assert_eq!(a("{path? | data?: the text}"), ["path"]);
        assert!(a("{spacing?: smooth|steps, orientation?: page|path}").is_empty());
        assert!(a("{path: id of the path}").is_empty());
        assert!(a("{path: [i…] (indices)}").is_empty());
        assert_eq!(
            a("{paths?: [path…], files?: [{name, dataBase64}…]}"),
            ["paths"]
        );
        assert!(a("{linksFolder: true}").is_empty());
        assert!(a("no object here").is_empty());
    }

    #[test]
    fn l_elenco_del_crate_si_legge() {
        let elenco = elenco().expect("disco.tsv si legge");
        assert!(elenco.righe > 0);
    }

    #[test]
    fn una_forma_vale_solo_per_byte_e_kernel() {
        let testo = "file\tfunzione\tprimitiva\tcomandi\tcome\ttask\tnota\n\
                     a.rs\tf\tstd::fs\tfile.place:path\tkernel\tT3\t\n\
                     a.rs\tg\tstd::fs\tplugin.install\tescluso\t\tD9: niente plug-in\n\
                     a.rs\th\tstd::fs\tdocument.save\tfub\t\tlo salva Fub\n";
        let elenco = analizza(testo).unwrap();
        assert!(elenco
            .forme
            .contains(&("file.place".to_string(), "path".to_string())));
        assert_eq!(elenco.esclusi["plugin.install"], "D9: niente plug-in");
        assert!(elenco.serviti.contains("document.save"));
        let sbagliato = "file\tfunzione\tprimitiva\tcomandi\tcome\ttask\tnota\n\
                         a.rs\tf\tstd::fs\tfile.place:path\trifiutato\t\t\n";
        assert!(analizza(sbagliato).unwrap_err().contains("riga 2"));
    }

    #[test]
    fn un_percorso_si_rifiuta_e_senza_percorso_passa() {
        let rifiuto = controlla("color.loadProfile", &json!({"path": "/etc/hostname"}));
        assert!(
            matches!(rifiuto, Err(RifiutoDisco::Percorso { .. })),
            "{rifiuto:?}"
        );
        assert!(controlla("color.loadProfile", &json!({"path": null})).is_ok());
        assert!(controlla("object.group", &json!({})).is_ok());
        let errore = PluginError::from(rifiuto.unwrap_err());
        assert!(matches!(errore, PluginError::BadArgs(_)));
    }

    #[test]
    fn i_comandi_di_fub_e_gli_esclusi_non_arrivano_al_motore() {
        let salva = controlla("document.save", &json!({}));
        assert!(matches!(salva, Err(RifiutoDisco::Fub { .. })), "{salva:?}");
        let recupero = controlla("file.recovery.save", &json!({}));
        assert!(
            matches!(recupero, Err(RifiutoDisco::Fub { .. })),
            "{recupero:?}"
        );
        let caratteri = controlla("text.addFontFiles", &json!({}));
        assert!(
            matches!(&caratteri, Err(RifiutoDisco::Escluso { perche, .. }) if perche.contains("D12")),
            "{caratteri:?}"
        );
        // Le preferenze del motore restano: T11 le mostra fra le impostazioni.
        assert!(controlla("prefs.get", &json!({})).is_ok());
    }
}
