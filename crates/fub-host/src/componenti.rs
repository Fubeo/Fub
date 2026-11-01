//! **I componenti di un vault**: che cosa è acceso, perché, e come si accende
//! e si spegne. CLI, MCP e il canale dell'app (`crate::control`) passano da
//! qui (A2): una sola definizione per tutti gli ingressi.
//!
//! - **La mappa** sono le righe di `fub_features::componenti`, ri-esportate
//!   qui; **il risolutore** è `fub_componenti`.
//! - **Lo stato sta in cinque chiavi del vault** (A1, D-5):
//!   `plugins.disabled` per i bundle, come prima; `components.off` per le
//!   righe senza bundle spente a mano (Lavagna, PDF); `components.kept` per i
//!   componenti di supporto tenuti con «Tienili»; `components.waiting` per
//!   quelli in attesa di una risposta; `components.profile` per il profilo
//!   scelto. Un vault senza le chiavi nuove vale come prima: tutto acceso
//!   tranne `plugins.disabled`.
//! - **In lettura si è tolleranti**: un id che la mappa non ha, o che sta
//!   nella chiave sbagliata, non conta e si dice in [`Componenti::mancanti`];
//!   resta nel file com'è, perché una build con meno feature non cancelli lo
//!   stato di chi ne ha di più.
//! - **In scrittura** i bundle passano da [`Host::set_plugin_enabled`]
//!   (montati e smontati subito), il resto dalle chiavi `components.*`:
//!   elenchi ordinati e senza doppioni, e una chiave vuota si toglie invece di
//!   restare `[]`, così un vault che non ha mai toccato i componenti non
//!   cambia file. Spenta o riaccesa la lavagna, il vault si rimonta: il
//!   formato `.canvas` si registra soltanto montando (`crate::mount`).

use std::collections::{BTreeMap, BTreeSet};

use fub_abi::settings::{SettingSource, SettingValue};
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};

pub use fub_componenti::{Effetto, Errore, Mappa, Perche, Stato};
pub use fub_features::componenti::*;

use crate::session::Host;
use crate::settings::{
    COMPONENTS_KEPT, COMPONENTS_OFF, COMPONENTS_PROFILE, COMPONENTS_WAITING, PLUGINS_DISABLED,
};

/// Il gruppo dei componenti di supporto: accesi se qualcuno li richiede.
pub const SUPPORTO: &str = "supporto";

/// La lavagna: spenta, l'host non registra il formato `.canvas`.
pub const LAVAGNA: &str = "fub.lavagna";

/// Il visore dei PDF: tutto nel client, l'host lo dice soltanto.
pub const PDF: &str = "fub.pdf";

/// Le chiavi dello stato, nell'ordine in cui [`Chiavi`] le legge.
const CHIAVI: [&str; 5] = [
    PLUGINS_DISABLED,
    COMPONENTS_OFF,
    COMPONENTS_KEPT,
    COMPONENTS_WAITING,
    COMPONENTS_PROFILE,
];

/// Che cosa fare di ciò che dopo uno spegnimento non serve più a nessuno.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Orfani {
    /// Nessuna risposta: restano accesi, in attesa.
    #[default]
    Chiedi,
    /// Togli: si spengono nello stesso comando.
    Togli,
    /// Tienili: restano accesi, e lo restano anche dopo.
    Tieni,
}

/// Una scelta di chi usa l'app.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "azione", rename_all = "snake_case")]
pub enum Azione {
    /// Accende `id` e ciò che richiede.
    Accendi { id: String },
    /// Spegne `id`; con `anche_questi` anche chi lo richiede.
    Spegni {
        id: String,
        #[serde(default)]
        anche_questi: bool,
        #[serde(default)]
        orfani: Orfani,
    },
    /// Risponde per i componenti in attesa: `ids`, o tutti se è vuoto.
    Rispondi {
        orfani: Orfani,
        #[serde(default)]
        ids: Vec<String>,
    },
    /// Applica un profilo di [`profili`].
    Profilo { nome: String },
}

/// Perché una scelta non si applica. Non è un errore dell'host: è una
/// risposta, e chi la riceve la dice con le sue parole.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "rifiuto", rename_all = "snake_case")]
pub enum Rifiuto {
    /// La mappa non ha `id`.
    Sconosciuto { id: String },
    /// `id` è del nucleo, o serve al nucleo: non si spegne.
    Nucleo { id: String },
    /// `id` serve a questi componenti accesi (a catena).
    Richiesto { id: String, da: Vec<String> },
    /// Nessun profilo si chiama così.
    ProfiloSconosciuto { nome: String },
    /// Il profilo aspetta componenti che non ci sono ancora.
    ProfiloPiuAvanti {
        nome: String,
        arriva_con: Vec<String>,
    },
}

/// Un id che una chiave nomina e che non conta: la mappa non l'ha, o non sta
/// in quella chiave.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mancante {
    pub chiave: String,
    pub id: String,
}

/// Una riga della mappa, come sta nel vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RigaNelVault {
    pub id: String,
    /// La chiave del catalogo con il nome.
    pub nome: String,
    pub gruppo: String,
    pub bundle: bool,
    pub acceso: bool,
    pub perche: Perche,
    /// Gli accesi che lo richiedono direttamente.
    pub richiesto_da: Vec<String>,
}

/// I componenti di un vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Componenti {
    /// Una riga per componente, nell'ordine della mappa.
    pub righe: Vec<RigaNelVault>,
    pub stato: Stato,
    /// Il profilo scelto; `None` vuol dire personalizzato.
    pub profilo: Option<String>,
    pub mancanti: Vec<Mancante>,
}

/// Una riga che cambia: un bundle (in `plugins.disabled`) o una riga senza
/// bundle che si spegne a mano (in `components.off`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scrittura {
    pub id: String,
    pub acceso: bool,
    pub bundle: bool,
}

/// Che cosa cambia una scelta: prima di farla (`applicato: false`) o dopo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Esito {
    pub azione: Azione,
    pub effetto: Effetto,
    /// Le righe da accendere o spegnere, nell'ordine in cui farlo.
    pub scritture: Vec<Scrittura>,
    /// Le chiavi `components.*` che cambiano.
    pub chiavi: Vec<String>,
    /// Lo stato dopo la scelta.
    pub stato: Stato,
    pub applicato: bool,
    /// Gli errori dello spegnimento dei bundle e della riapertura: la scelta
    /// è applicata lo stesso.
    pub avvisi: Vec<PluginError>,
}

impl Esito {
    /// Se cambia qualcosa che il vault ricorda.
    pub fn scrive(&self) -> bool {
        !self.scritture.is_empty() || !self.chiavi.is_empty()
    }
}

/// I valori delle chiavi dello stato, come stanno nel vault.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Chiavi {
    pub disabled: Vec<String>,
    pub off: Vec<String>,
    pub kept: Vec<String>,
    pub waiting: Vec<String>,
    pub profile: String,
    /// Le chiavi `components.*` che stanno davvero nel file del vault.
    pub nel_vault: BTreeSet<String>,
}

impl Chiavi {
    fn elenco(&self, chiave: &str) -> &[String] {
        match chiave {
            COMPONENTS_OFF => &self.off,
            COMPONENTS_KEPT => &self.kept,
            COMPONENTS_WAITING => &self.waiting,
            _ => &self.disabled,
        }
    }
}

/// Lo stato letto dalle chiavi, con la mappa che lo risolve.
pub struct Lettura {
    righe: Vec<Riga>,
    mappa: Mappa,
    chiavi: Chiavi,
    stato: Stato,
    mancanti: Vec<Mancante>,
}

/// Il piano di una scelta: lo stato nuovo e che cosa scrivere.
pub struct Piano {
    pub effetto: Effetto,
    pub stato: Stato,
    pub scritture: Vec<Scrittura>,
    /// Le chiavi `components.*` che cambiano, con il valore nuovo (`None`:
    /// si toglie).
    pub chiavi: Vec<(&'static str, Option<SettingValue>)>,
}

fn nucleo(id: &str) -> bool {
    NUCLEO.contains(&id)
}

/// Una riga che si spegne a mano e non è un bundle: Lavagna e PDF.
fn senza_bundle_spegnibile(riga: &Riga) -> bool {
    !riga.bundle && riga.gruppo != SUPPORTO && !nucleo(riga.id)
}

impl Lettura {
    /// Legge lo stato dalle chiavi, con le righe di questa build.
    pub fn da(chiavi: Chiavi) -> Lettura {
        Lettura::con(righe(), mappa(), chiavi)
    }

    fn con(righe: Vec<Riga>, mappa: Mappa, chiavi: Chiavi) -> Lettura {
        let riga = |id: &str| righe.iter().find(|riga| riga.id == id);
        let disabled: BTreeSet<&str> = chiavi.disabled.iter().map(String::as_str).collect();
        let mut mancanti = Vec::new();
        let mut valide = |chiave: &str, vale: &dyn Fn(&Riga) -> bool| -> BTreeSet<String> {
            let mut prese = BTreeSet::new();
            for id in chiavi.elenco(chiave) {
                match riga(id) {
                    Some(r) if vale(r) => {
                        prese.insert(id.clone());
                    }
                    _ => mancanti.push(Mancante {
                        chiave: chiave.to_string(),
                        id: id.clone(),
                    }),
                }
            }
            prese
        };
        let off = valide(COMPONENTS_OFF, &senza_bundle_spegnibile);
        let kept = valide(COMPONENTS_KEPT, &|r: &Riga| r.gruppo == SUPPORTO);
        let di_base = |r: &Riga| {
            r.gruppo != SUPPORTO
                && !nucleo(r.id)
                && if r.bundle {
                    !disabled.contains(r.id)
                } else {
                    !off.contains(r.id)
                }
        };
        // In attesa sta solo ciò che senza la risposta sarebbe acceso: un
        // bundle spento in `plugins.disabled` non torna acceso da qui.
        let waiting = valide(COMPONENTS_WAITING, &|r: &Riga| {
            !nucleo(r.id) && (r.gruppo == SUPPORTO || di_base(r))
        });
        let mut scelti: BTreeSet<String> = righe
            .iter()
            .filter(|r| di_base(r))
            .map(|r| r.id.to_string())
            .filter(|id| !waiting.contains(id))
            .collect();
        scelti.extend(kept.iter().cloned());
        let in_attesa = waiting.difference(&kept).cloned().collect();
        Lettura {
            righe,
            mappa,
            chiavi,
            stato: Stato { scelti, in_attesa },
            mancanti,
        }
    }

    pub fn stato(&self) -> &Stato {
        &self.stato
    }

    pub fn mappa(&self) -> &Mappa {
        &self.mappa
    }

    /// Gli accesi che richiedono `id` direttamente.
    fn richiesto_da(&self, attivi: &BTreeSet<String>, id: &str) -> Vec<String> {
        attivi
            .iter()
            .filter(|a| self.mappa.richiesti(a).iter().any(|r| r == id))
            .cloned()
            .collect()
    }

    /// La vista: una riga per componente, lo stato, il profilo.
    pub fn componenti(&self) -> Componenti {
        let attivi = self.mappa.attivi(&self.stato);
        Componenti {
            righe: self
                .righe
                .iter()
                .map(|r| RigaNelVault {
                    id: r.id.to_string(),
                    nome: r.nome.to_string(),
                    gruppo: r.gruppo.to_string(),
                    bundle: r.bundle,
                    acceso: attivi.contains(r.id),
                    perche: self.mappa.perche(&self.stato, r.id),
                    richiesto_da: self.richiesto_da(&attivi, r.id),
                })
                .collect(),
            stato: self.stato.clone(),
            profilo: Some(self.chiavi.profile.clone()).filter(|nome| !nome.is_empty()),
            mancanti: self.mancanti.clone(),
        }
    }

    fn rifiuto(errore: Errore, id: &str) -> Rifiuto {
        match errore {
            Errore::Sconosciuto(id) => Rifiuto::Sconosciuto { id },
            Errore::Nucleo => Rifiuto::Nucleo { id: id.to_string() },
            Errore::Richiesto { da } => Rifiuto::Richiesto {
                id: id.to_string(),
                da,
            },
        }
    }

    /// Che cosa cambierebbe `azione`, senza farlo.
    pub fn pianifica(&self, azione: &Azione) -> Result<Piano, Rifiuto> {
        let mut profilo = None;
        let (nuovo, effetto, toccati): (Stato, Effetto, Vec<String>) = match azione {
            Azione::Accendi { id } => {
                let (nuovo, effetto) = self
                    .mappa
                    .accendi(&self.stato, id)
                    .map_err(|errore| Self::rifiuto(errore, id))?;
                let mut toccati = vec![id.clone()];
                toccati.extend(effetto.accesi_anche.iter().cloned());
                (nuovo, effetto, toccati)
            }
            Azione::Spegni {
                id,
                anche_questi,
                orfani,
            } => {
                let spegni = if *anche_questi {
                    Mappa::spegni_con_dipendenti
                } else {
                    Mappa::spegni
                };
                let (mut nuovo, effetto) = spegni(&self.mappa, &self.stato, id)
                    .map_err(|errore| Self::rifiuto(errore, id))?;
                match orfani {
                    Orfani::Chiedi => {}
                    Orfani::Togli => nuovo = self.mappa.togli(&nuovo, &effetto.orfani),
                    Orfani::Tieni => nuovo = self.mappa.tieni(&nuovo, &effetto.orfani),
                }
                let mut toccati = vec![id.clone()];
                toccati.extend(effetto.spenti_anche.iter().cloned());
                toccati.extend(effetto.orfani.iter().cloned());
                (nuovo, effetto, toccati)
            }
            Azione::Rispondi { orfani, ids } => {
                let ids: Vec<String> = if ids.is_empty() {
                    self.stato.in_attesa.iter().cloned().collect()
                } else {
                    ids.iter()
                        .filter(|id| self.stato.in_attesa.contains(*id))
                        .cloned()
                        .collect()
                };
                let nuovo = match orfani {
                    Orfani::Chiedi => self.stato.clone(),
                    Orfani::Togli => self.mappa.togli(&self.stato, &ids),
                    Orfani::Tieni => self.mappa.tieni(&self.stato, &ids),
                };
                (nuovo, Effetto::default(), ids)
            }
            Azione::Profilo { nome } => {
                let def = profilo_def(nome)
                    .ok_or_else(|| Rifiuto::ProfiloSconosciuto { nome: nome.clone() })?;
                if def.piu_avanti() {
                    return Err(Rifiuto::ProfiloPiuAvanti {
                        nome: nome.clone(),
                        arriva_con: def.arriva_con.iter().map(|id| id.to_string()).collect(),
                    });
                }
                let mut scelta = def.profilo();
                // Un profilo che non è «Tutto» lascia stare le righe senza
                // gruppo e i disegni: restano come sono.
                if def.nome != PROFILO_TUTTO {
                    scelta.componenti.extend(
                        self.righe
                            .iter()
                            .filter(|r| GRUPPI_FUORI_DAI_PROFILI.contains(&r.gruppo))
                            .filter(|r| self.stato.scelti.contains(r.id))
                            .map(|r| r.id.to_string()),
                    );
                }
                let (nuovo, effetto) = self.mappa.applica_profilo(&self.stato, &scelta);
                profilo = Some(def.nome);
                let toccati = self.righe.iter().map(|r| r.id.to_string()).collect();
                (nuovo, effetto, toccati)
            }
        };
        // Chi era in attesa e ora un acceso lo richiede di nuovo non aspetta
        // più una risposta: senza, rispegnere chi lo richiede lo lascerebbe
        // acceso senza chiedere.
        let mut nuovo = nuovo;
        let risolti: Vec<String> = nuovo
            .in_attesa
            .iter()
            .filter(|id| matches!(self.mappa.perche(&nuovo, id), Perche::RichiestoDa(_)))
            .cloned()
            .collect();
        for id in &risolti {
            nuovo.in_attesa.remove(id);
        }
        let scritture = self.scritture(&nuovo, &toccati);
        let mut chiavi = self.chiavi_nuove(&nuovo);
        // Il profilo: scritto se se ne applica uno, tolto appena si tocca un
        // interruttore che cambia qualcosa.
        let cambia = !scritture.is_empty() || !chiavi.is_empty();
        let voluto = match profilo {
            Some(nome) => nome.to_string(),
            None if cambia => String::new(),
            None => self.chiavi.profile.clone(),
        };
        if voluto != self.chiavi.profile {
            let valore = Some(voluto)
                .filter(|nome| !nome.is_empty())
                .map(SettingValue::Text);
            chiavi.push((COMPONENTS_PROFILE, valore));
        } else if voluto.is_empty() && cambia && self.nel_vault(COMPONENTS_PROFILE) {
            chiavi.push((COMPONENTS_PROFILE, None));
        }
        Ok(Piano {
            effetto,
            stato: nuovo,
            scritture,
            chiavi,
        })
    }

    fn nel_vault(&self, chiave: &str) -> bool {
        self.chiavi.nel_vault.contains(chiave)
    }

    /// Le righe `toccati` il cui stato cambia, nell'ordine in cui scriverle:
    /// prima gli spegnimenti, da chi richiede verso chi è richiesto, poi le
    /// accensioni, dai requisiti verso chi li richiede.
    fn scritture(&self, nuovo: &Stato, toccati: &[String]) -> Vec<Scrittura> {
        let attivi = self.mappa.attivi(nuovo);
        let disabled: BTreeSet<&str> = self.chiavi.disabled.iter().map(String::as_str).collect();
        let off: BTreeSet<&str> = self.chiavi.off.iter().map(String::as_str).collect();
        let mut visti = BTreeSet::new();
        let mut scritture: Vec<Scrittura> = toccati
            .iter()
            .filter(|id| visti.insert(id.as_str()))
            .filter_map(|id| self.righe.iter().find(|r| r.id == id))
            .filter(|r| !nucleo(r.id) && (r.bundle || senza_bundle_spegnibile(r)))
            .filter_map(|r| {
                let ora = if r.bundle {
                    !disabled.contains(r.id)
                } else {
                    !off.contains(r.id)
                };
                let voluto = attivi.contains(r.id);
                (ora != voluto).then(|| Scrittura {
                    id: r.id.to_string(),
                    acceso: voluto,
                    bundle: r.bundle,
                })
            })
            .collect();
        scritture.sort_by_key(|s| {
            let p = self.profondita(&s.id) as i64;
            (s.acceso, if s.acceso { p } else { -p })
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

    /// Le chiavi `components.off`, `kept` e `waiting` per lo stato `nuovo`,
    /// soltanto quelle che cambiano. Ciò che una chiave nominava e non contava
    /// resta com'era.
    fn chiavi_nuove(&self, nuovo: &Stato) -> Vec<(&'static str, Option<SettingValue>)> {
        let attivi = self.mappa.attivi(nuovo);
        let riga = |id: &str| self.righe.iter().find(|r| r.id == id);
        let fermi = |chiave: &str| -> BTreeSet<String> {
            self.mancanti
                .iter()
                .filter(|m| m.chiave == chiave)
                .map(|m| m.id.clone())
                .collect()
        };
        let mut off = fermi(COMPONENTS_OFF);
        off.extend(
            self.righe
                .iter()
                .filter(|r| senza_bundle_spegnibile(r) && !attivi.contains(r.id))
                .map(|r| r.id.to_string()),
        );
        let mut kept = fermi(COMPONENTS_KEPT);
        kept.extend(
            nuovo
                .scelti
                .iter()
                .filter(|id| riga(id).is_some_and(|r| r.gruppo == SUPPORTO))
                .cloned(),
        );
        let mut waiting = fermi(COMPONENTS_WAITING);
        waiting.extend(nuovo.in_attesa.iter().cloned());
        let mut chiavi = Vec::new();
        for (chiave, voluto) in [
            (COMPONENTS_OFF, off),
            (COMPONENTS_KEPT, kept),
            (COMPONENTS_WAITING, waiting),
        ] {
            let ora: BTreeSet<String> = self.chiavi.elenco(chiave).iter().cloned().collect();
            let ordinato = self.chiavi.elenco(chiave).windows(2).all(|w| w[0] < w[1]);
            if voluto.is_empty() {
                if self.nel_vault(chiave) {
                    chiavi.push((chiave, None));
                }
            } else if voluto != ora || !ordinato {
                chiavi.push((
                    chiave,
                    Some(SettingValue::List(voluto.into_iter().collect())),
                ));
            }
        }
        chiavi
    }
}

fn profilo_def(nome: &str) -> Option<DefProfilo> {
    fub_features::componenti::profilo(nome)
}

/// Se la lavagna è spenta in questo vault, letto dal file prima che il vault
/// si monti: `crate::mount` non registra il formato `.canvas`.
pub(crate) fn lavagna_spenta(settings: &fub_kernel::SettingsStore) -> bool {
    settings
        .effective(COMPONENTS_OFF)
        .ok()
        .and_then(|(value, _)| {
            value
                .as_list()
                .map(|ids| ids.iter().any(|id| id == LAVAGNA))
        })
        .unwrap_or(false)
}

impl Host {
    fn chiavi_dei_componenti(&self, vault: Option<&str>) -> Result<Chiavi, PluginError> {
        let valori = self.settings_with_source(vault, &CHIAVI)?;
        let mut chiavi = Chiavi::default();
        let elenco = |value: &SettingValue| -> Vec<String> {
            value.as_list().map(<[String]>::to_vec).unwrap_or_default()
        };
        for (chiave, (value, source)) in CHIAVI.iter().zip(valori) {
            if source == SettingSource::Vault {
                chiavi.nel_vault.insert(chiave.to_string());
            }
            match *chiave {
                PLUGINS_DISABLED => chiavi.disabled = elenco(&value),
                COMPONENTS_OFF => chiavi.off = elenco(&value),
                COMPONENTS_KEPT => chiavi.kept = elenco(&value),
                COMPONENTS_WAITING => chiavi.waiting = elenco(&value),
                _ => {
                    chiavi.profile = match value {
                        SettingValue::Text(nome) => nome,
                        _ => String::new(),
                    }
                }
            }
        }
        Ok(chiavi)
    }

    /// I componenti del vault: la mappa, che cosa è acceso e perché.
    pub fn components(&self, vault: Option<&str>) -> Result<Componenti, PluginError> {
        Ok(Lettura::da(self.chiavi_dei_componenti(vault)?).componenti())
    }

    /// Applica una scelta, o con `apply` falso dice che cosa cambierebbe.
    ///
    /// Il rifiuto è una risposta e non un errore dell'host: sta dentro l'`Ok`,
    /// così attraversa il canale dell'app con il suo tipo.
    pub fn apply_components(
        &self,
        vault: Option<&str>,
        azione: Azione,
        apply: bool,
    ) -> Result<Result<Esito, Rifiuto>, PluginError> {
        let lettura = Lettura::da(self.chiavi_dei_componenti(vault)?);
        let piano = match lettura.pianifica(&azione) {
            Ok(piano) => piano,
            Err(rifiuto) => return Ok(Err(rifiuto)),
        };
        let mut esito = Esito {
            azione,
            effetto: piano.effetto,
            scritture: piano.scritture,
            chiavi: piano.chiavi.iter().map(|(k, _)| k.to_string()).collect(),
            stato: piano.stato,
            applicato: false,
            avvisi: Vec::new(),
        };
        if !apply || !esito.scrive() {
            esito.applicato = apply;
            return Ok(Ok(esito));
        }
        // La radice prima di scrivere: il rimontaggio la vuole canonica, e
        // `vault` può essere un altro nome dello stesso vault.
        let root = self.session_root(vault)?;
        let vault = Some(root.as_str());
        for scrittura in esito.scritture.iter().filter(|s| s.bundle) {
            let errori = self.set_plugin_enabled(vault, &scrittura.id, scrittura.acceso)?;
            esito.avvisi.extend(errori);
        }
        if !piano.chiavi.is_empty() {
            self.write_vault_settings(vault, piano.chiavi)?;
        }
        if esito.scritture.iter().any(|s| s.id == LAVAGNA) {
            esito.avvisi.extend(self.remount(&root)?);
        }
        esito.applicato = true;
        Ok(Ok(esito))
    }
}

/// Il nome di ogni riga nel catalogo italiano: per chi parla da terminale.
pub fn nomi_italiani() -> BTreeMap<String, String> {
    let italiano: BTreeMap<String, String> = catalog()
        .into_iter()
        .find(|c| c.locale == "it")
        .map(|c| c.entries)
        .unwrap_or_default();
    righe()
        .iter()
        .map(|r| {
            let nome = italiano
                .get(r.nome)
                .cloned()
                .unwrap_or_else(|| r.id.to_string());
            (r.id.to_string(), nome)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lettura(disabled: &[&str], off: &[&str], kept: &[&str], waiting: &[&str]) -> Lettura {
        let elenco = |ids: &[&str]| ids.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        let mut nel_vault = BTreeSet::new();
        for (chiave, ids) in [
            (COMPONENTS_OFF, off),
            (COMPONENTS_KEPT, kept),
            (COMPONENTS_WAITING, waiting),
        ] {
            if !ids.is_empty() {
                nel_vault.insert(chiave.to_string());
            }
        }
        Lettura::da(Chiavi {
            disabled: elenco(disabled),
            off: elenco(off),
            kept: elenco(kept),
            waiting: elenco(waiting),
            profile: String::new(),
            nel_vault,
        })
    }

    #[test]
    fn senza_chiavi_gli_scelti_sono_le_righe_che_non_sono_di_supporto() {
        let lettura = lettura(&[], &[], &[], &[]);
        assert!(lettura.stato.scelti.contains("fub.graph"));
        assert!(lettura.stato.scelti.contains(LAVAGNA));
        assert!(!lettura.stato.scelti.contains("fub.penna"));
        assert!(!lettura.stato.scelti.contains("fub.markdown"));
        assert!(lettura.mancanti.is_empty());
    }

    #[test]
    fn un_id_sconosciuto_o_fuori_posto_non_conta_e_resta_scritto() {
        let lettura = lettura(
            &[],
            &["fub.sparito", "fub.graph", LAVAGNA],
            &["fub.graph"],
            &[],
        );
        assert!(lettura.stato.scelti.contains("fub.graph"));
        assert!(!lettura.stato.scelti.contains(LAVAGNA));
        assert_eq!(lettura.mancanti.len(), 3, "{:?}", lettura.mancanti);
        let piano = lettura
            .pianifica(&Azione::Accendi { id: LAVAGNA.into() })
            .unwrap();
        assert_eq!(
            piano.chiavi,
            [(
                COMPONENTS_OFF,
                Some(SettingValue::List(vec![
                    "fub.graph".into(),
                    "fub.sparito".into()
                ]))
            )]
        );
    }

    #[test]
    fn spegnere_la_penna_con_pdf_e_lavagna_accesi_e_rifiutato() {
        let lettura = lettura(&[], &[], &[], &[]);
        let rifiuto = lettura
            .pianifica(&Azione::Spegni {
                id: "fub.penna".into(),
                anche_questi: false,
                orfani: Orfani::Chiedi,
            })
            .err()
            .unwrap();
        assert_eq!(
            rifiuto,
            Rifiuto::Richiesto {
                id: "fub.penna".into(),
                da: vec![LAVAGNA.into(), PDF.into()]
            }
        );
    }

    #[test]
    fn spegnere_lavagna_e_pdf_lascia_la_penna_in_attesa() {
        let lettura = lettura(&[], &[PDF], &[], &[]);
        let piano = lettura
            .pianifica(&Azione::Spegni {
                id: LAVAGNA.into(),
                anche_questi: false,
                orfani: Orfani::Chiedi,
            })
            .unwrap();
        assert_eq!(piano.effetto.orfani, ["fub.penna"]);
        assert_eq!(
            piano.scritture,
            [Scrittura {
                id: LAVAGNA.into(),
                acceso: false,
                bundle: false
            }]
        );
        assert!(piano.chiavi.contains(&(
            COMPONENTS_WAITING,
            Some(SettingValue::List(vec!["fub.penna".into()]))
        )));
    }

    #[test]
    fn un_profilo_piu_avanti_e_rifiutato() {
        let lettura = lettura(&[], &[], &[], &[]);
        let rifiuto = lettura
            .pianifica(&Azione::Profilo {
                nome: "grafica".into(),
            })
            .err()
            .unwrap();
        assert!(
            matches!(rifiuto, Rifiuto::ProfiloPiuAvanti { .. }),
            "{rifiuto:?}"
        );
        assert!(matches!(
            lettura.pianifica(&Azione::Profilo { nome: "boh".into() }),
            Err(Rifiuto::ProfiloSconosciuto { .. })
        ));
    }

    #[test]
    fn un_profilo_lascia_stare_i_gruppi_fuori_dai_profili() {
        let lettura = lettura(&[], &[], &[], &[]);
        let piano = lettura
            .pianifica(&Azione::Profilo {
                nome: "note".into(),
            })
            .unwrap();
        for r in righe() {
            if GRUPPI_FUORI_DAI_PROFILI.contains(&r.gruppo) && !nucleo(r.id) {
                assert!(piano.stato.scelti.contains(r.id), "«{}»", r.id);
            }
        }
        assert!(!piano.stato.scelti.contains(LAVAGNA));
        assert!(piano
            .chiavi
            .contains(&(COMPONENTS_PROFILE, Some(SettingValue::Text("note".into())))));
    }

    // Spostati da `fub-cli` con la logica (A2).

    #[test]
    fn un_id_che_la_mappa_non_ha_piu_non_accende_e_non_si_tocca() {
        let lettura = lettura(&["fub.sparito"], &[], &[], &[]);
        assert!(!lettura.mappa.attivi(&lettura.stato).contains("fub.sparito"));
        let piano = lettura
            .pianifica(&Azione::Spegni {
                id: "fub.graph".into(),
                anche_questi: false,
                orfani: Orfani::Chiedi,
            })
            .unwrap();
        assert_eq!(
            piano.scritture,
            [Scrittura {
                id: "fub.graph".into(),
                acceso: false,
                bundle: true
            }]
        );
    }

    #[test]
    fn spegnere_con_i_dipendenti_spegne_prima_chi_richiede() {
        let lettura = lettura(&[], &[], &[], &[]);
        let piano = lettura
            .pianifica(&Azione::Spegni {
                id: "fub.properties".into(),
                anche_questi: true,
                orfani: Orfani::Chiedi,
            })
            .unwrap();
        let ordine: Vec<&str> = piano.scritture.iter().map(|s| s.id.as_str()).collect();
        let proprieta = ordine
            .iter()
            .position(|id| *id == "fub.properties")
            .unwrap();
        let template = ordine.iter().position(|id| *id == "fub.template").unwrap();
        assert!(template < proprieta, "{ordine:?}");
        assert!(piano.scritture.iter().all(|s| !s.acceso));
    }

    #[test]
    fn accendere_accende_prima_i_requisiti() {
        // Anche Base, che altrimenti terrebbe accesa Proprietà.
        let lettura = lettura(
            &["fub.properties", "fub.template", "fub.base"],
            &[],
            &[],
            &[],
        );
        let piano = lettura
            .pianifica(&Azione::Accendi {
                id: "fub.template".into(),
            })
            .unwrap();
        let scritture: Vec<(&str, bool)> = piano
            .scritture
            .iter()
            .map(|s| (s.id.as_str(), s.acceso))
            .collect();
        assert_eq!(
            scritture,
            [("fub.properties", true), ("fub.template", true)]
        );
        assert_eq!(piano.effetto.accesi_anche, ["fub.properties"]);
    }

    /// Con il PDF acceso la penna serve ancora: spegnere la lavagna non lascia
    /// orfani, e la lavagna è una scrittura (di `components.off`).
    #[test]
    fn spegnere_la_lavagna_con_il_pdf_acceso_tiene_la_penna() {
        let lettura = lettura(&[], &[], &[], &[]);
        let piano = lettura
            .pianifica(&Azione::Spegni {
                id: LAVAGNA.into(),
                anche_questi: false,
                orfani: Orfani::Chiedi,
            })
            .unwrap();
        assert!(piano.effetto.orfani.is_empty());
        assert_eq!(
            piano.chiavi,
            [(
                COMPONENTS_OFF,
                Some(SettingValue::List(vec![LAVAGNA.into()]))
            )]
        );
    }

    /// Un vault che non ha mai toccato i componenti non cambia file per una
    /// scelta che non cambia niente.
    #[test]
    fn una_scelta_che_non_cambia_niente_non_scrive() {
        let lettura = lettura(&[], &[], &[], &[]);
        let piano = lettura
            .pianifica(&Azione::Accendi {
                id: "fub.graph".into(),
            })
            .unwrap();
        assert!(piano.scritture.is_empty());
        assert!(piano.chiavi.is_empty());
    }
}
