//! `fub-cli componenti`: vedere, accendere e spegnere i componenti con le
//! parole e le regole di chi usa l'app. Gli strumenti MCP `fub_components*`
//! (`mcp/tools.rs`) passano da qui: una sola definizione per i due ingressi.
//!
//! - **Lo stato e le scelte li tiene l'host** (`fub_host::componenti`, A2):
//!   da qui si legge la mappa con [`HostPort::components`] e si applica una
//!   scelta con [`HostPort::apply_components`], prima come prova e poi davvero.
//!   Qui restano le parole: i messaggi e la forma JSON.
//! - Passa da `HostPort`: con il vault aperto nell'app, lettura e scrittura
//!   vanno a lei.
//!
//! [`HostPort::components`]: crate::port::HostPort::components
//! [`HostPort::apply_components`]: crate::port::HostPort::apply_components

use std::collections::BTreeMap;

use fub_host::componenti::{self as host, Azione, Componenti, Perche, Rifiuto, NUCLEO};
use serde_json::{json, Value};

pub use fub_host::componenti::Orfani;

use crate::cli::{ComponentiAction, ComponentiArgs, GlobalArgs};
use crate::commands::{paginate, render_error_text, Connection, Failure};
use crate::local::confirm_write;
use crate::output::{envelope_ok, OutputFormat};

fn orfani_json(orfani: Orfani) -> Value {
    match orfani {
        Orfani::Chiedi => Value::Null,
        Orfani::Togli => json!("remove"),
        Orfani::Tieni => json!("keep"),
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

/// I componenti come stanno nel vault aperto, letti dall'host.
pub struct Vista {
    componenti: Componenti,
    nomi: BTreeMap<String, String>,
}

/// Che cosa cambia accendendo o spegnendo un componente, prima di farlo.
#[derive(Debug)]
pub struct Esito {
    id: String,
    azione: &'static str,
    orfani: Orfani,
    /// Il piano dell'host, fatto senza applicarlo.
    piano: host::Esito,
    messaggi: Vec<String>,
}

impl Vista {
    /// Legge la mappa e lo stato dall'host del vault.
    pub fn leggi(c: &Connection) -> Result<Vista, Failure> {
        let componenti = c
            .host
            .components(c.vault_selector())
            .map_err(|error| Failure::from_plugin(&error))?;
        Ok(Vista {
            componenti,
            nomi: host::nomi_italiani(),
        })
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
        NUCLEO.contains(&id)
    }

    fn riga(&self, id: &str) -> Option<&host::RigaNelVault> {
        self.componenti.righe.iter().find(|riga| riga.id == id)
    }

    fn acceso(&self, id: &str) -> bool {
        self.riga(id).is_some_and(|riga| riga.acceso)
    }

    fn ragione(perche: &Perche) -> &'static str {
        match perche {
            Perche::Nucleo => "core",
            Perche::Scelto => "chosen",
            Perche::RichiestoDa(_) => "required",
            Perche::InAttesa => "pending",
            Perche::Spento | Perche::Sconosciuto => "off",
        }
    }

    /// Una riga per componente, nell'ordine della mappa.
    pub fn elenco(&self) -> Vec<Value> {
        self.componenti
            .righe
            .iter()
            .map(|r| {
                json!({
                    "id": r.id,
                    "name": self.nome(&r.id),
                    "group": r.gruppo,
                    "enabled": r.acceso,
                    "reason": Self::ragione(&r.perche),
                    "required_by": r.richiesto_da,
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

    fn rifiuto(&self, rifiuto: Rifiuto, opzioni: &Opzioni) -> Failure {
        match rifiuto {
            Rifiuto::Sconosciuto { id } => Self::sconosciuto(&id),
            Rifiuto::Nucleo { id } if Self::nucleo(&id) => Failure::new(
                4,
                "denied",
                format!("{id} fa parte del nucleo: non si spegne"),
            ),
            Rifiuto::Nucleo { id } => {
                Failure::new(4, "denied", format!("{id} serve al nucleo: non si spegne"))
            }
            Rifiuto::Richiesto { id, da } => Failure::new(
                5,
                "conflict",
                format!(
                    "{id} non si spegne. Serve a {}. Con {} si spengono anche loro.",
                    self.chi(&da),
                    opzioni.anche_questi
                ),
            ),
            Rifiuto::ProfiloSconosciuto { nome } => {
                Failure::new(1, "not_found", format!("nessun profilo si chiama «{nome}»"))
            }
            Rifiuto::ProfiloPiuAvanti { nome, arriva_con } => Failure::new(
                4,
                "denied",
                format!(
                    "il profilo «{nome}» arriva più avanti, con: {}",
                    arriva_con.join(", ")
                ),
            ),
        }
    }

    /// Perché `id` è acceso, o che è spento: i dati e la frase.
    pub fn perche(&self, id: &str) -> Result<Value, Failure> {
        let Some(riga) = self.riga(id) else {
            return Err(Self::sconosciuto(id));
        };
        let messaggio = match &riga.perche {
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
        let required_by = match &riga.perche {
            Perche::RichiestoDa(da) => da.clone(),
            _ => Vec::new(),
        };
        Ok(json!({
            "id": id,
            "name": self.nome(id),
            "reason": Self::ragione(&riga.perche),
            "required_by": required_by,
            "message": messaggio,
        }))
    }

    /// Il piano dell'host per `azione`, senza applicarlo.
    fn piano(
        &self,
        c: &Connection,
        azione: Azione,
        opzioni: &Opzioni,
    ) -> Result<host::Esito, Failure> {
        c.host
            .apply_components(c.vault_selector(), azione, false)
            .map_err(|error| Failure::from_plugin(&error))?
            .map_err(|rifiuto| self.rifiuto(rifiuto, opzioni))
    }

    /// Accendere `id`, e chi richiede.
    pub fn accendi(&self, c: &Connection, id: &str, opzioni: &Opzioni) -> Result<Esito, Failure> {
        if self.riga(id).is_none() {
            return Err(Self::sconosciuto(id));
        }
        let azione = Azione::Accendi { id: id.to_string() };
        let mut messaggi = Vec::new();
        if Self::nucleo(id) {
            messaggi.push(format!("{id} fa parte del nucleo: è sempre acceso."));
        }
        let piano = self.piano(c, azione, opzioni)?;
        if !Self::nucleo(id) {
            if self.acceso(id) && piano.scritture.is_empty() {
                messaggi.push(format!("{id} è già acceso."));
            } else {
                messaggi.push(format!("{id} acceso."));
                if !piano.effetto.accesi_anche.is_empty() {
                    messaggi.push(format!(
                        "Attivati anche {}: {} non funziona senza.",
                        self.chi(&piano.effetto.accesi_anche),
                        self.nome(id)
                    ));
                }
            }
        }
        Ok(Esito {
            id: id.to_string(),
            azione: "enable",
            orfani: Orfani::Chiedi,
            piano,
            messaggi,
        })
    }

    /// Spegnere `id`; con `anche_questi` anche chi lo richiede.
    pub fn spegni(
        &self,
        c: &Connection,
        id: &str,
        anche_questi: bool,
        orfani: Orfani,
        opzioni: &Opzioni,
    ) -> Result<Esito, Failure> {
        if self.riga(id).is_none() {
            return Err(Self::sconosciuto(id));
        }
        let azione = Azione::Spegni {
            id: id.to_string(),
            anche_questi,
            orfani,
        };
        let gia_spento = !Self::nucleo(id) && !self.acceso(id);
        let piano = self.piano(c, azione, opzioni)?;
        let mut messaggi = Vec::new();
        if gia_spento {
            messaggi.push(format!("{id} è già spento."));
        } else {
            let effetto = &piano.effetto;
            messaggi.push(format!("{id} spento."));
            if !effetto.spenti_anche.is_empty() {
                messaggi.push(format!(
                    "Spenti anche: {}.",
                    self.chi(&effetto.spenti_anche)
                ));
            }
            if !effetto.orfani.is_empty() {
                let chi = self.chi(&effetto.orfani);
                messaggi.push(match orfani {
                    Orfani::Chiedi => format!(
                        "Non servono più a nessuno: {chi}. Togli: {}; Tienili: {}.",
                        opzioni.togli, opzioni.tieni
                    ),
                    Orfani::Togli => format!("Tolti anche, non servivano più a nessuno: {chi}."),
                    Orfani::Tieni => {
                        format!("Tenuti, anche se non servono più a nessuno: {chi}.")
                    }
                });
            }
        }
        Ok(Esito {
            id: id.to_string(),
            azione: "disable",
            orfani,
            piano,
            messaggi,
        })
    }
}

impl Esito {
    /// Se cambia qualcosa che il vault ricorda.
    pub fn scrive(&self) -> bool {
        self.piano.scrive()
    }

    pub fn messaggio(&self) -> String {
        self.messaggi.join(" ")
    }

    /// Applica la scelta con l'host. Torna gli avvisi dell'host.
    pub fn applica(&self, c: &Connection) -> Result<Vec<String>, Failure> {
        if !self.scrive() {
            return Ok(Vec::new());
        }
        let esito = c
            .host
            .apply_components(c.vault_selector(), self.piano.azione.clone(), true)
            .map_err(|error| Failure::from_plugin(&error))?
            .map_err(|rifiuto| {
                Failure::new(
                    5,
                    "conflict",
                    format!("lo stato dei componenti è cambiato nel frattempo: {rifiuto:?}"),
                )
            })?;
        Ok(esito.avvisi.iter().map(render_error_text).collect())
    }

    pub fn json(&self, dry_run: bool, avvisi: &[String]) -> Value {
        let writes: Vec<Value> = self
            .piano
            .scritture
            .iter()
            .map(|s| json!({ "id": s.id, "enabled": s.acceso }))
            .collect();
        json!({
            "id": self.id,
            "action": self.azione,
            "dry_run": dry_run,
            "also_enabled": self.piano.effetto.accesi_anche,
            "also_disabled": self.piano.effetto.spenti_anche,
            "orphans": self.piano.effetto.orfani,
            "orphans_choice": orfani_json(self.orfani),
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
            let esito = vista.accendi(c, &id, &OPZIONI_CLI)?;
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
            let esito = vista.spegni(c, &id, anche_questi, orfani, &OPZIONI_CLI)?;
            esegui(c, global, format, esito, "spegnere")
        }
    }
}
