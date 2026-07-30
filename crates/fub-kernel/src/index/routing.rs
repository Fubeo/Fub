//! La tabella di instradamento: **chi serve cosa**, dichiarato.
//!
//! Il dispatch di prima era per tentativi: si provavano gli indici in ordine di
//! registrazione finché uno non rispondeva `BadArgs`, che per contratto voleva
//! dire «non è roba mia». Con un indice funzionava benissimo. Con quelli che
//! FEATURES chiede — full-text, semantico e vettoriale, proprietà, task,
//! database, citazioni — ogni query girava su tutti, e due indici che
//! rivendicavano la stessa variante si oscuravano a vicenda **in silenzio**.
//!
//! Qui la rivendicazione è un dato, e il silenzio non c'è più:
//!
//! - una **famiglia** ([`QueryKind`]) ha un proprietario solo, e chi arriva
//!   secondo riceve un [`RouteConflict`] invece di vincere o perdere a seconda
//!   dell'ordine di montaggio. È la disciplina del `FormatRegistry`
//!   (decisione 0017), applicata al canale dati;
//! - una **foglia** ([`PredicateKind`]) può averne più d'uno, in ordine di
//!   registrazione, perché un predicato è un fatto sul vault e non una risposta
//!   composta: chi ne rivendica uno promette la stessa risposta degli altri, e
//!   il pianificatore sceglie a chi mandarlo — preferendo chi ne sa valutare di
//!   più in un colpo solo.

use std::collections::BTreeMap;

use fub_abi::traits::{PredicateKind, QueryKind, QueryRoute};

/// Chi risponde: l'indice del kernel, o uno dei registrati (per posizione).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Target {
    Core,
    Provider(usize),
}

/// Due indici si contendono la stessa famiglia di domande.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteConflict {
    pub kind: QueryKind,
    /// L'id di chi ce l'aveva già.
    pub incumbent: String,
    /// L'id di chi è arrivato dopo, e **non** si è registrato.
    pub challenger: String,
}

impl std::fmt::Display for RouteConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "`{}` rivendica {:?}, che è già di `{}` \
             (per sostituirlo di proposito: `Workspace::replace_index_provider`)",
            self.challenger, self.kind, self.incumbent
        )
    }
}

impl std::error::Error for RouteConflict {}

#[derive(Default)]
pub(crate) struct RouteTable {
    /// famiglia → chi la serve. Uno solo.
    queries: BTreeMap<QueryKind, Target>,
    /// foglia → chi la sa valutare, in ordine di registrazione.
    predicates: BTreeMap<PredicateKind, Vec<Target>>,
}

impl RouteTable {
    /// Registra le rotte di un indice, o dice **perché no**.
    ///
    /// Le famiglie già rivendicate sono un conflitto e la dichiarazione **non
    /// avviene affatto** — nemmeno per le rotte libere dello stesso indice: un
    /// indice registrato a metà è peggio di uno non registrato, perché risponde
    /// ad alcune domande e non ad altre senza che nessuno sappia quali.
    pub(crate) fn declare(
        &mut self,
        target: Target,
        routes: &[QueryRoute],
    ) -> Result<(), RouteConflict> {
        for route in routes {
            if let QueryRoute::Query(kind) = route {
                if let Some(&incumbent) = self.queries.get(kind) {
                    if incumbent != target {
                        return Err(RouteConflict {
                            kind: kind.clone(),
                            incumbent: match incumbent {
                                Target::Core => super::CORE_ID.to_string(),
                                Target::Provider(at) => format!("#{at}"),
                            },
                            // Lo riempie chi conosce l'id (vedi `Indexes::declare`).
                            challenger: String::new(),
                        });
                    }
                }
            }
        }
        self.insert(target, routes);
        Ok(())
    }

    /// Dichiara **sostituendo** chi rivendicava le stesse famiglie.
    pub(crate) fn replace(&mut self, target: Target, routes: &[QueryRoute]) {
        self.insert(target, routes);
    }

    fn insert(&mut self, target: Target, routes: &[QueryRoute]) {
        for route in routes {
            match route {
                QueryRoute::Query(kind) => {
                    self.queries.insert(kind.clone(), target);
                }
                QueryRoute::Predicate(kind) => {
                    let evaluators = self.predicates.entry(kind.clone()).or_default();
                    if !evaluators.contains(&target) {
                        evaluators.push(target);
                    }
                }
            }
        }
    }

    /// Rimappa i bersagli dopo che qualcuno se n'è andato (§9.4): `moved` dice
    /// dove è finito ognuno, e `None` vuol dire *non c'è più*.
    ///
    /// Esiste perché [`Target::Provider`] è una **posizione** nell'elenco degli
    /// indici registrati, e togliere il terzo di cinque sposta il quarto e il
    /// quinto: senza questa rimappatura, dopo una disattivazione la tabella
    /// manderebbe le domande di chi se n'è andato a chi gli stava dietro — che è
    /// il modo in cui un indice risponde per un altro senza che nessuno lo
    /// veda. Le rotte di chi è sparito **spariscono**: chi le chiede riceve
    /// `Unserved`, che è la verità.
    pub(crate) fn retarget(&mut self, moved: &dyn Fn(Target) -> Option<Target>) {
        self.queries.retain(|_, target| match moved(*target) {
            Some(new) => {
                *target = new;
                true
            }
            None => false,
        });
        self.predicates.retain(|_, targets| {
            targets.retain_mut(|target| match moved(*target) {
                Some(new) => {
                    *target = new;
                    true
                }
                None => false,
            });
            !targets.is_empty()
        });
    }

    /// Chi serve questa famiglia.
    pub(crate) fn owner(&self, kind: &QueryKind) -> Option<Target> {
        self.queries.get(kind).copied()
    }

    /// Chi sa valutare questa foglia, in ordine di registrazione.
    pub(crate) fn evaluators(&self, kind: &PredicateKind) -> &[Target] {
        self.predicates
            .get(kind)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Tutte le rotte dichiarate, per chi vuole ispezionare il montaggio (§7.6:
    /// l'inventario di ciò che è attivo non esiste ancora, ma questa metà sì).
    pub(crate) fn declared(&self) -> Vec<(QueryRoute, Target)> {
        let mut all: Vec<(QueryRoute, Target)> = self
            .queries
            .iter()
            .map(|(k, t)| (QueryRoute::Query(k.clone()), *t))
            .collect();
        for (kind, targets) in &self.predicates {
            for target in targets {
                all.push((QueryRoute::Predicate(kind.clone()), *target));
            }
        }
        all
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_famiglia_ha_un_padrone_e_il_secondo_non_vince_in_silenzio() {
        let mut table = RouteTable::default();
        table
            .declare(Target::Core, &[QueryRoute::Query(QueryKind::Tags)])
            .expect("il primo passa");
        let conflict = table
            .declare(Target::Provider(0), &[QueryRoute::Query(QueryKind::Tags)])
            .expect_err("la seconda rivendicazione è un conflitto");
        assert_eq!(conflict.kind, QueryKind::Tags);
        assert_eq!(
            table.owner(&QueryKind::Tags),
            Some(Target::Core),
            "e chi c'era resta: il perdente non si registra"
        );
    }

    #[test]
    fn un_indice_in_conflitto_non_resta_registrato_a_meta() {
        let mut table = RouteTable::default();
        table
            .declare(Target::Core, &[QueryRoute::Query(QueryKind::Tags)])
            .unwrap();
        let _ = table.declare(
            Target::Provider(0),
            &[
                QueryRoute::Predicate(PredicateKind::Text),
                QueryRoute::Query(QueryKind::Tags),
            ],
        );
        assert!(
            table.evaluators(&PredicateKind::Text).is_empty(),
            "la rotta libera non deve restare al perdente: risponderebbe ad \
             alcune domande e non ad altre"
        );
    }

    #[test]
    fn una_foglia_ne_ammette_piu_duno_in_ordine_di_registrazione() {
        let mut table = RouteTable::default();
        table
            .declare(Target::Core, &[QueryRoute::Predicate(PredicateKind::Tag)])
            .unwrap();
        table
            .declare(
                Target::Provider(0),
                &[QueryRoute::Predicate(PredicateKind::Tag)],
            )
            .expect("un fatto sul vault lo può verificare più di uno");
        assert_eq!(
            table.evaluators(&PredicateKind::Tag),
            &[Target::Core, Target::Provider(0)]
        );
    }

    #[test]
    fn sostituire_resta_possibile_ma_va_chiesto_per_nome() {
        let mut table = RouteTable::default();
        table
            .declare(Target::Core, &[QueryRoute::Query(QueryKind::Tags)])
            .unwrap();
        table.replace(Target::Provider(3), &[QueryRoute::Query(QueryKind::Tags)]);
        assert_eq!(table.owner(&QueryKind::Tags), Some(Target::Provider(3)));
    }
}
