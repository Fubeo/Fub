//! `fub-cli componenti`: vedere, accendere e spegnere i componenti con le
//! parole e le regole di chi usa l'app. Gli strumenti MCP `fub_components*`
//! (`mcp/tools.rs`) passano da qui: una sola definizione per i due ingressi.
//!
//! - **Lo stato si legge da `plugins.disabled`** (A7): scelti sono i
//!   componenti che non sono di supporto né del nucleo e che non stanno in
//!   quell'elenco; quelli di supporto sono accesi se qualcuno li richiede.
//!   «In attesa» è vuoto fra un comando e l'altro.
//! - **Che cosa è acceso lo decide il risolutore** (`fub_componenti`) sulla
//!   mappa di questa build (`fub_host::componenti`).
//! - **Si scrive soltanto con `set_plugin_enabled`**, e soltanto per le righe
//!   che sono bundle: le altre (Lavagna, Penna, Dizionari, i motori) cambiano
//!   solo che cosa si dice, perché in K1 nient'altro le legge. Gli id che
//!   `plugins.disabled` nomina e la mappa non ha più non accendono niente e
//!   restano dove sono: `set_plugin_enabled` tocca soltanto l'id che riceve.
//! - Passa da `HostPort`: con il vault aperto nell'app, lettura e scrittura
//!   vanno a lei.

use std::collections::{BTreeMap, BTreeSet};

use fub_abi::{IndexQuery, IndexResult};
use fub_componenti::{Effetto, Errore, Mappa, Perche, Stato};
use fub_host::componenti::{self as catalogo, Riga};
use serde_json::{json, Value};

use crate::cli::{ComponentiAction, ComponentiArgs, GlobalArgs};
use crate::commands::{paginate, render_error_text, Connection, Failure};
use crate::output::{envelope_ok, OutputFormat};

/// Il gruppo dei componenti di supporto: accesi se qualcuno li richiede.
const SUPPORTO: &str = "supporto";

/// La chiave dell'app con i bundle spenti.
const PLUGINS_DISABLED: &str = "plugins.disabled";

/// Che cosa fare di ciò che dopo uno spegnimento non serve più a nessuno.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Orfani {
    /// Nessuna risposta: si dice che cosa non serve più, e come rispondere.
    Chiedi,
    /// Togli: si spengono nello stesso comando.
    Togli,
    /// Tienili: restano accesi.
    Tieni,
}

impl Orfani {
    fn json(self) -> Value {
        match self {
            Orfani::Chiedi => Value::Null,
            Orfani::Togli => json!("remove"),
            Orfani::Tieni => json!("keep"),
        }
    }
}

/// Come si chiamano le opzioni nell'ingresso che chiede: i messaggi le
/// suggeriscono con il nome che chi legge può scrivere.
pub struct Opzioni {
    pub anche_questi: &'static str,
    pub togli: &'static str,
    pub tieni: &'static str,
}

pub const OPZIONI_CLI: Opzioni = Opzioni {
    anche_questi: "--anche-questi",
    togli: "--togli",
    tieni: "--tieni",
};

pub const OPZIONI_MCP: Opzioni = Opzioni {
    anche_questi: "\"also_dependents\": true",
    togli: "\"orphans\": \"remove\"",
    tieni: "\"orphans\": \"keep\"",
};

/// I componenti come stanno nel vault aperto.
pub struct Vista {
    righe: Vec<Riga>,
    mappa: Mappa,
    nomi: BTreeMap<String, String>,
    /// `plugins.disabled`, com'è.
    spenti: BTreeSet<String>,
    stato: Stato,
}

/// Che cosa cambia accendendo o spegnendo un componente, prima di farlo.
#[derive(Debug)]
pub struct Esito {
    id: String,
    azione: &'static str,
    effetto: Effetto,
    orfani: Orfani,
    /// I bundle da accendere (`true`) o spegnere, nell'ordine in cui farlo.
    scritture: Vec<(String, bool)>,
    messaggi: Vec<String>,
}

impl Vista {
    /// Legge `plugins.disabled` dalle impostazioni del vault.
    pub fn leggi(c: &Connection) -> Result<Vista, Failure> {
        let entries = match c
            .host
            .query_index(c.vault_selector(), IndexQuery::Settings { plugin: None })
            .map_err(|error| Failure::from_plugin(&error))?
        {
            IndexResult::Settings(entries) => entries,
            other => {
                return Err(Failure::local(format!(
                    "settings ha risposto {}",
                    other.kind_name()
                )))
            }
        };
        let spenti = entries
            .iter()
            .find(|entry| entry.spec.key == PLUGINS_DISABLED)
            .and_then(|entry| entry.value.as_list())
            .map(|ids| ids.iter().cloned().collect())
            .unwrap_or_default();
        Ok(Vista::da(spenti))
    }

    fn da(spenti: BTreeSet<String>) -> Vista {
        let righe = catalogo::righe();
        let mappa = catalogo::mappa();
        let italiano: BTreeMap<String, String> = catalogo::catalog()
            .into_iter()
            .find(|c| c.locale == "it")
            .map(|c| c.entries)
            .unwrap_or_default();
        let nomi = righe
            .iter()
            .map(|r| {
                let nome = italiano
                    .get(r.nome)
                    .cloned()
                    .unwrap_or_else(|| r.id.to_string());
                (r.id.to_string(), nome)
            })
            .collect();
        let scelti = righe
            .iter()
            .filter(|r| {
                r.gruppo != SUPPORTO && !catalogo::NUCLEO.contains(&r.id) && !spenti.contains(r.id)
            })
            .map(|r| r.id.to_string())
            .collect();
        Vista {
            righe,
            mappa,
            nomi,
            spenti,
            stato: Stato {
                scelti,
                in_attesa: BTreeSet::new(),
            },
        }
    }

    fn nome<'a>(&'a self, id: &'a str) -> &'a str {
        self.nomi.get(id).map(String::as_str).unwrap_or(id)
    }

    /// «Proprietà (fub.properties), Template (fub.template)».
    fn chi(&self, ids: &[String]) -> String {
        ids.iter()
            .map(|id| format!("{} ({id})", self.nome(id)))
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn nucleo(id: &str) -> bool {
        catalogo::NUCLEO.contains(&id)
    }

    /// Gli accesi che richiedono `id` direttamente.
    fn richiesto_da(&self, attivi: &BTreeSet<String>, id: &str) -> Vec<String> {
        attivi
            .iter()
            .filter(|a| self.mappa.richiesti(a).iter().any(|r| r == id))
            .cloned()
            .collect()
    }

    fn ragione(&self, id: &str) -> &'static str {
        match self.mappa.perche(&self.stato, id) {
            Perche::Nucleo => "core",
            Perche::Scelto => "chosen",
            Perche::RichiestoDa(_) => "required",
            Perche::InAttesa => "pending",
            Perche::Spento | Perche::Sconosciuto => "off",
        }
    }

    /// Una riga per componente, nell'ordine della mappa.
    pub fn elenco(&self) -> Vec<Value> {
        let attivi = self.mappa.attivi(&self.stato);
        self.righe
            .iter()
            .map(|r| {
                json!({
                    "id": r.id,
                    "name": self.nome(r.id),
                    "group": r.gruppo,
                    "enabled": attivi.contains(r.id),
                    "reason": self.ragione(r.id),
                    "required_by": self.richiesto_da(&attivi, r.id),
                    "bundle": r.bundle,
                })
            })
            .collect()
    }

    fn sconosciuto(id: &str) -> Failure {
        Failure::new(
            1,
            "not_found",
            format!("nessun componente si chiama «{id}»"),
        )
    }

    fn errore(&self, errore: Errore, id: &str, opzioni: &Opzioni) -> Failure {
        match errore {
            Errore::Sconosciuto(id) => Self::sconosciuto(&id),
            Errore::Nucleo if Self::nucleo(id) => Failure::new(
                4,
                "denied",
                format!("{id} fa parte del nucleo: non si spegne"),
            ),
            Errore::Nucleo => {
                Failure::new(4, "denied", format!("{id} serve al nucleo: non si spegne"))
            }
            Errore::Richiesto { da } => Failure::new(
                5,
                "conflict",
                format!(
                    "{id} non si spegne. Serve a {}. Con {} si spengono anche loro.",
                    self.chi(&da),
                    opzioni.anche_questi
                ),
            ),
        }
    }

    /// Perché `id` è acceso, o che è spento: i dati e la frase.
    pub fn perche(&self, id: &str) -> Result<Value, Failure> {
        let perche = self.mappa.perche(&self.stato, id);
        let messaggio = match &perche {
            Perche::Sconosciuto => return Err(Self::sconosciuto(id)),
            Perche::Nucleo => format!("{id} fa parte del nucleo: non si spegne."),
            Perche::Scelto => format!("{id} è attivo perché l'hai scelto."),
            Perche::RichiestoDa(da) if da.len() == 1 => {
                format!("{id} è attivo perché lo richiede: {}.", da.join(", "))
            }
            Perche::RichiestoDa(da) => {
                format!("{id} è attivo perché lo richiedono: {}.", da.join(", "))
            }
            Perche::InAttesa => format!("{id} non serve più a nessuno, ed è ancora acceso."),
            Perche::Spento => format!("{id} è spento."),
        };
        let required_by = match &perche {
            Perche::RichiestoDa(da) => da.clone(),
            _ => Vec::new(),
        };
        Ok(json!({
            "id": id,
            "name": self.nome(id),
            "reason": self.ragione(id),
            "required_by": required_by,
            "message": messaggio,
        }))
    }

    /// Le scritture che portano i bundle `toccati` da `plugins.disabled` a
    /// `nuovo`: prima gli spegnimenti, da chi richiede verso chi è richiesto,
    /// poi le accensioni, dai requisiti verso chi li richiede.
    fn scritture(&self, nuovo: &Stato, toccati: &[String]) -> Vec<(String, bool)> {
        let attivi = self.mappa.attivi(nuovo);
        let bundle = |id: &str| self.righe.iter().any(|r| r.id == id && r.bundle);
        let mut visti = BTreeSet::new();
        let mut scritture: Vec<(String, bool)> = toccati
            .iter()
            .filter(|id| visti.insert(id.as_str()))
            .filter(|id| bundle(id) && !Self::nucleo(id))
            .filter_map(|id| {
                let ora = !self.spenti.contains(id);
                let voluto = attivi.contains(id);
                (ora != voluto).then(|| (id.clone(), voluto))
            })
            .collect();
        scritture.sort_by_key(|(id, acceso)| {
            let p = self.profondita(id) as i64;
            (*acceso, if *acceso { p } else { -p })
        });
        scritture
    }

    /// Quanti requisiti stanno sotto `id`, nella catena più lunga.
    fn profondita(&self, id: &str) -> usize {
        self.mappa
            .richiesti(id)
            .iter()
            .map(|r| 1 + self.profondita(r))
            .max()
            .unwrap_or(0)
    }

    /// Accendere `id`, e chi richiede.
    pub fn accendi(&self, id: &str, opzioni: &Opzioni) -> Result<Esito, Failure> {
        if self.mappa.componente(id).is_none() {
            return Err(Self::sconosciuto(id));
        }
        let mut esito = Esito {
            id: id.to_string(),
            azione: "enable",
            effetto: Effetto::default(),
            orfani: Orfani::Chiedi,
            scritture: Vec::new(),
            messaggi: Vec::new(),
        };
        if Self::nucleo(id) {
            esito
                .messaggi
                .push(format!("{id} fa parte del nucleo: è sempre acceso."));
            return Ok(esito);
        }
        let era_acceso = self.mappa.attivi(&self.stato).contains(id);
        let (nuovo, effetto) = self
            .mappa
            .accendi(&self.stato, id)
            .map_err(|errore| self.errore(errore, id, opzioni))?;
        let mut toccati = vec![id.to_string()];
        toccati.extend(effetto.accesi_anche.iter().cloned());
        esito.scritture = self.scritture(&nuovo, &toccati);
        if era_acceso && esito.scritture.is_empty() {
            esito.messaggi.push(format!("{id} è già acceso."));
        } else {
            esito.messaggi.push(format!("{id} acceso."));
            if !effetto.accesi_anche.is_empty() {
                esito.messaggi.push(format!(
                    "Attivati anche {}: {} non funziona senza.",
                    self.chi(&effetto.accesi_anche),
                    self.nome(id)
                ));
            }
        }
        esito.effetto = effetto;
        Ok(esito)
    }

    /// Spegnere `id`; con `anche_questi` anche chi lo richiede.
    pub fn spegni(
        &self,
        id: &str,
        anche_questi: bool,
        orfani: Orfani,
        opzioni: &Opzioni,
    ) -> Result<Esito, Failure> {
        if self.mappa.componente(id).is_none() {
            return Err(Self::sconosciuto(id));
        }
        let mut esito = Esito {
            id: id.to_string(),
            azione: "disable",
            effetto: Effetto::default(),
            orfani,
            scritture: Vec::new(),
            messaggi: Vec::new(),
        };
        if !Self::nucleo(id) && !self.mappa.attivi(&self.stato).contains(id) {
            esito.messaggi.push(format!("{id} è già spento."));
            return Ok(esito);
        }
        let spegni = if anche_questi {
            Mappa::spegni_con_dipendenti
        } else {
            Mappa::spegni
        };
        let (mut nuovo, effetto) = spegni(&self.mappa, &self.stato, id)
            .map_err(|errore| self.errore(errore, id, opzioni))?;
        match orfani {
            Orfani::Chiedi => {}
            Orfani::Togli => nuovo = self.mappa.togli(&nuovo, &effetto.orfani),
            Orfani::Tieni => nuovo = self.mappa.tieni(&nuovo, &effetto.orfani),
        }
        let mut toccati = vec![id.to_string()];
        toccati.extend(effetto.spenti_anche.iter().cloned());
        toccati.extend(effetto.orfani.iter().cloned());
        esito.scritture = self.scritture(&nuovo, &toccati);
        esito.messaggi.push(format!("{id} spento."));
        if !effetto.spenti_anche.is_empty() {
            esito.messaggi.push(format!(
                "Spenti anche: {}.",
                self.chi(&effetto.spenti_anche)
            ));
        }
        if !effetto.orfani.is_empty() {
            let chi = self.chi(&effetto.orfani);
            esito.messaggi.push(match orfani {
                Orfani::Chiedi => format!(
                    "Non servono più a nessuno: {chi}. Togli: {}; Tienili: {}.",
                    opzioni.togli, opzioni.tieni
                ),
                Orfani::Togli => format!("Tolti anche, non servivano più a nessuno: {chi}."),
                Orfani::Tieni => format!("Tenuti, anche se non servono più a nessuno: {chi}."),
            });
        }
        esito.effetto = effetto;
        Ok(esito)
    }
}

impl Esito {
    /// Se cambia qualcosa che il vault ricorda.
    pub fn scrive(&self) -> bool {
        !self.scritture.is_empty()
    }

    pub fn messaggio(&self) -> String {
        self.messaggi.join(" ")
    }

    /// Fa le scritture, in ordine. Torna gli avvisi dell'host.
    pub fn applica(&self, c: &Connection) -> Result<Vec<String>, Failure> {
        let mut avvisi = Vec::new();
        for (id, acceso) in &self.scritture {
            let errori = c
                .host
                .set_plugin_enabled(c.vault_selector(), id, *acceso)
                .map_err(|error| Failure::from_plugin(&error))?;
            avvisi.extend(errori.iter().map(render_error_text));
        }
        Ok(avvisi)
    }

    pub fn json(&self, dry_run: bool, avvisi: &[String]) -> Value {
        let writes: Vec<Value> = self
            .scritture
            .iter()
            .map(|(id, acceso)| json!({ "id": id, "enabled": acceso }))
            .collect();
        json!({
            "id": self.id,
            "action": self.azione,
            "dry_run": dry_run,
            "also_enabled": self.effetto.accesi_anche,
            "also_disabled": self.effetto.spenti_anche,
            "orphans": self.effetto.orfani,
            "orphans_choice": self.orfani.json(),
            "writes": writes,
            "message": self.messaggio(),
            "errors": avvisi,
        })
    }
}

fn vault_required(c: &Connection) -> Result<(), Failure> {
    if c.vault_selector().is_some() || c.host.has_current_vault() {
        return Ok(());
    }
    Err(Failure::bad_args("nessun vault: --vault PATH o FUB_VAULT"))
}

/// La conferma di una scrittura, come per `plugin`.
fn confirm_write(global: &GlobalArgs, prompt: &str) -> Result<(), Failure> {
    if global.no_input {
        return Err(Failure::new(
            4,
            "denied",
            format!("{prompt}: rifiutato (--no-input)"),
        ));
    }
    if global.yes {
        return Ok(());
    }
    if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        return Err(Failure::new(
            4,
            "denied",
            format!("{prompt}: serve --yes su stdin non interattivo"),
        ));
    }
    eprint!("{prompt} [y/N] ");
    use std::io::BufRead;
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(|e| Failure::local(format!("stdin: {e}")))?;
    if line.trim().eq_ignore_ascii_case("y") || line.trim().eq_ignore_ascii_case("yes") {
        Ok(())
    } else {
        Err(Failure::new(4, "denied", "rifiutato dall'utente"))
    }
}

/// Stampa: righe di testo per chi legge, la busta per gli altri formati.
fn stampa(global: &GlobalArgs, format: &OutputFormat, data: Value, righe: &[String]) {
    if format.is_human() {
        if !global.quiet {
            for riga in righe {
                println!("{riga}");
            }
        }
        return;
    }
    crate::print_value(global, format, &envelope_ok(data));
}

fn riga_di_testo(item: &Value) -> String {
    let acceso = if item["enabled"] == true {
        "acceso"
    } else {
        "spento"
    };
    let perche = match item["reason"].as_str() {
        Some("core") => "nucleo",
        Some("chosen") => "scelto",
        Some("required") => "serve",
        Some("pending") => "in attesa",
        _ => "—",
    };
    let mut riga = format!(
        "{acceso:<7}{perche:<8}{:<24}{}",
        item["id"].as_str().unwrap_or_default(),
        item["name"].as_str().unwrap_or_default()
    );
    let da: Vec<&str> = item["required_by"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    if !da.is_empty() {
        riga.push_str(&format!("  ← {}", da.join(", ")));
    }
    riga
}

fn esegui(
    c: &Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
    esito: Esito,
    prompt: &str,
) -> Result<(), Failure> {
    if global.dry_run {
        let righe = vec![format!("Prova, non cambia niente: {}", esito.messaggio())];
        stampa(global, format, esito.json(true, &[]), &righe);
        return Ok(());
    }
    if esito.scrive() {
        confirm_write(global, &format!("{prompt} `{}`", esito.id))?;
    }
    let avvisi = esito.applica(c)?;
    let mut righe = vec![esito.messaggio()];
    righe.extend(avvisi.iter().cloned());
    stampa(global, format, esito.json(false, &avvisi), &righe);
    Ok(())
}

/// `fub-cli componenti …`.
pub fn run(
    c: &Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
    args: ComponentiArgs,
) -> Result<(), Failure> {
    vault_required(c)?;
    let vista = Vista::leggi(c)?;
    match args.action {
        ComponentiAction::Elenco => {
            let offset = global.offset.unwrap_or(0);
            let (items, total) = paginate(vista.elenco(), offset, global.limit);
            let righe: Vec<String> = items.iter().map(riga_di_testo).collect();
            stampa(
                global,
                format,
                json!({ "items": items, "offset": offset, "limit": global.limit, "total": total }),
                &righe,
            );
            Ok(())
        }
        ComponentiAction::Perche(id) => {
            let data = vista.perche(&id)?;
            let righe = vec![data["message"].as_str().unwrap_or_default().to_string()];
            stampa(global, format, data, &righe);
            Ok(())
        }
        ComponentiAction::Accendi(id) => {
            let esito = vista.accendi(&id, &OPZIONI_CLI)?;
            esegui(c, global, format, esito, "accendere")
        }
        ComponentiAction::Spegni {
            id,
            anche_questi,
            togli,
            tieni,
        } => {
            let orfani = match (togli, tieni) {
                (true, _) => Orfani::Togli,
                (_, true) => Orfani::Tieni,
                _ => Orfani::Chiedi,
            };
            let esito = vista.spegni(&id, anche_questi, orfani, &OPZIONI_CLI)?;
            esegui(c, global, format, esito, "spegnere")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn senza_niente_di_spento_gli_scelti_sono_le_righe_che_non_sono_di_supporto() {
        let vista = Vista::da(BTreeSet::new());
        assert!(vista.stato.scelti.contains("fub.graph"));
        assert!(!vista.stato.scelti.contains("fub.penna"));
        assert!(!vista.stato.scelti.contains("fub.markdown"));
    }

    #[test]
    fn un_id_che_la_mappa_non_ha_piu_non_accende_e_non_si_tocca() {
        let vista = Vista::da(BTreeSet::from(["fub.sparito".to_string()]));
        assert!(!vista.mappa.attivi(&vista.stato).contains("fub.sparito"));
        let esito = vista
            .spegni("fub.graph", false, Orfani::Chiedi, &OPZIONI_CLI)
            .unwrap();
        assert_eq!(esito.scritture, [("fub.graph".to_string(), false)]);
    }

    #[test]
    fn spegnere_con_i_dipendenti_spegne_prima_chi_richiede() {
        let vista = Vista::da(BTreeSet::new());
        let esito = vista
            .spegni("fub.properties", true, Orfani::Chiedi, &OPZIONI_CLI)
            .unwrap();
        let ordine: Vec<&str> = esito.scritture.iter().map(|(id, _)| id.as_str()).collect();
        let proprieta = ordine
            .iter()
            .position(|id| *id == "fub.properties")
            .unwrap();
        let template = ordine.iter().position(|id| *id == "fub.template").unwrap();
        assert!(template < proprieta, "{ordine:?}");
        assert!(esito.scritture.iter().all(|(_, acceso)| !acceso));
    }

    #[test]
    fn accendere_accende_prima_i_requisiti() {
        // Anche Base, che altrimenti terrebbe accesa Proprietà.
        let spenti = ["fub.properties", "fub.template", "fub.base"]
            .map(str::to_string)
            .into();
        let vista = Vista::da(spenti);
        let esito = vista.accendi("fub.template", &OPZIONI_CLI).unwrap();
        assert_eq!(
            esito.scritture,
            [
                ("fub.properties".to_string(), true),
                ("fub.template".to_string(), true)
            ]
        );
        assert!(
            esito.messaggio().contains(
                "Attivati anche Proprietà (fub.properties): Template non funziona senza."
            ),
            "{}",
            esito.messaggio()
        );
    }

    #[test]
    fn spegnere_la_lavagna_dice_che_la_penna_non_serve_piu() {
        let vista = Vista::da(BTreeSet::new());
        let esito = vista
            .spegni("fub.lavagna", false, Orfani::Chiedi, &OPZIONI_CLI)
            .unwrap();
        assert!(esito.scritture.is_empty(), "la lavagna non è un bundle");
        assert!(
            esito
                .messaggio()
                .contains("Non servono più a nessuno: Penna (fub.penna)"),
            "{}",
            esito.messaggio()
        );
    }
}
