//! La differenza, i livelli: lo stato del corpo, i posti, i livelli nuovi e i loro attributi.

use super::*;

impl Lavoro<'_> {
    /// La parte di cui `n` risponde da sé quando si chiede se è ricco. Un
    /// gruppo risponde solo di sé: i suoi oggetti sono elementi del file, e il
    /// confronto scende fino a loro, che si scrivono ognuno per sé (un oggetto
    /// diventato ricco si riscrive con la sua ricetta, il gruppo resta). Ogni
    /// altro contenitore risponde di ciò che contiene, tranne gli oggetti con
    /// una ricetta applicata nel file.
    pub(super) fn propria(&self, n: &Arc<Node>) -> Arc<Node> {
        if !matches!(n.kind, NodeKind::Group { .. }) {
            return self.senza_ricette(n);
        }
        let mut solo = (**n).clone();
        if let Some(f) = solo.children_mut() {
            f.clear();
        }
        Arc::new(solo)
    }

    /// `n` senza gli oggetti che contiene con una ricetta applicata nel file.
    /// Lo stesso `Arc` se dentro non ce ne sono.
    pub(super) fn senza_ricette(&self, n: &Arc<Node>) -> Arc<Node> {
        let Some(figli) = n.children() else {
            return n.clone();
        };
        let ricette = self.copia.mappa.ricette();
        let mut cambiato = false;
        let tenuti: Vec<Arc<Node>> = figli
            .iter()
            .filter_map(|c| {
                let con_ricetta = self
                    .elemento(c.id)
                    .and_then(|e| e.id.as_deref())
                    .is_some_and(|id| ricette.applicata(id));
                if con_ricetta {
                    cambiato = true;
                    return None;
                }
                let dentro = self.senza_ricette(c);
                cambiato |= !Arc::ptr_eq(&dentro, c);
                Some(dentro)
            })
            .collect();
        if !cambiato {
            return n.clone();
        }
        let mut copia = (**n).clone();
        if let Some(f) = copia.children_mut() {
            *f = tenuti;
        }
        Arc::new(copia)
    }

    /// Lo stato, nascosto e bloccato, di un oggetto scritto come corpo
    /// espanso con la ricetta: il corpo non lo porta (lo stampo esporta
    /// l'oggetto visibile) e l'impronta non lo conta, quindi va in un `set`
    /// sull'id del corpo, dopo l'`add`. Per un oggetto riscritto prende il
    /// posto del `set` che [`Lavoro::stato`] ha messo sul suo id di prima:
    /// l'elemento di prima se ne va con i suoi attributi, e l'id può essere
    /// nuovo.
    pub(super) fn stato_del_corpo(&mut self, nodo: &Node, riscritto: bool, id: &str) {
        if riscritto {
            if let Some(prima) = self
                .elemento(nodo.id)
                .and_then(Elemento::id_del_file)
                .map(str::to_string)
            {
                self.set.retain(|op| {
                    let solo_stato = op["attrs"].as_object().is_some_and(|a| {
                        a.keys()
                            .all(|k| k == "display" || k == "fub:locked" || k == "fub:guide")
                    });
                    !(op["id"] == prima && solo_stato)
                });
            }
        }
        let mut attrs = Map::new();
        if !nodo.visible {
            attrs.insert("display".into(), json!("none"));
        }
        if nodo.locked {
            attrs.insert("fub:locked".into(), json!("true"));
        }
        if e_guida(nodo) {
            attrs.insert("fub:guide".into(), json!("true"));
            attrs.insert("display".into(), json!("none"));
        }
        if !attrs.is_empty() {
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": attrs }));
        }
    }

    /// Il posto di un oggetto nuovo fra i fratelli di dopo, figli di
    /// `genitore`.
    pub(super) fn posto(
        &mut self,
        genitore: Option<NodeId>,
        fratelli: &[&Arc<Node>],
        i: usize,
    ) -> Result<Value, Rifiuto> {
        if i + 1 == fratelli.len() {
            return Ok(json!({ "last": true }));
        }
        Ok(match i.checked_sub(1).map(|j| fratelli[j]) {
            Some(prec) => json!({ "after": self.bersaglio(prec.id)? }),
            None => self.primo_fra(genitore),
        })
    }

    /// Il primo posto fra i figli di `genitore`: fra i figli della radice
    /// (la cima del motore o il livello che sta per la radice) è subito
    /// dopo la carta, se il file ne ha una, perché la carta resta sotto ogni
    /// cosa; altrimenti il primo.
    pub(super) fn primo_fra(&self, genitore: Option<NodeId>) -> Value {
        let radice = genitore.is_none_or(|g| self.copia.mappa.e_radice(g));
        match self.copia.mappa.carta().filter(|_| radice) {
            Some(carta) => json!({ "after": carta }),
            None => json!({ "first": true }),
        }
    }

    /// Bloccato e nascosto: il `set` di `fub:locked` e di `display` se il
    /// motore li ha cambiati, e l'oggetto di prima con lo stato di dopo, per
    /// il resto del confronto. Si scrive ciò che il file non dice già; il
    /// foglio resta bloccato. Un oggetto mostrato che il file nasconde in un
    /// altro modo (uno stile) non si scrive con `display`.
    pub(super) fn stato(&mut self, b: &Arc<Node>, a: &Arc<Node>) -> Result<Arc<Node>, Rifiuto> {
        if b.visible == a.visible && b.locked == a.locked && e_guida(b) == e_guida(a) {
            return Ok(b.clone());
        }
        let Some(e) = self.elemento(a.id).cloned() else {
            return Err(Rifiuto::NonMappato(format!(
                "il gesto blocca o nasconde l'oggetto {} che non viene da Fub",
                a.id.0
            )));
        };
        let mut attrs = Map::new();
        if b.locked != a.locked && e.ruolo != fub_scene::Role::Paper && a.locked != e.bloccato {
            attrs.insert(
                "fub:locked".into(),
                if a.locked { json!("true") } else { Value::Null },
            );
        }
        if e_guida(b) != e_guida(a) {
            // Crea guide e Rilascia guide: `fub:guide` con `display="none"`,
            // perché chi non conosce `fub:guide` non la disegni, e via tutti
            // e due (formato della scena, guide).
            if e_guida(a) {
                if !b.visible || !a.visible {
                    return Err(no("un oggetto nascosto non diventa una guida"));
                }
                attrs.insert("fub:guide".into(), json!("true"));
                attrs.insert("display".into(), json!("none"));
            } else {
                attrs.insert("fub:guide".into(), Value::Null);
                attrs.insert(
                    "display".into(),
                    if a.visible {
                        Value::Null
                    } else {
                        json!("none")
                    },
                );
            }
        } else if e_guida(a) && b.visible != a.visible {
            return Err(no(
                "un tracciato-guida non si nasconde né si mostra da solo: lo fa Nascondi guide",
            ));
        } else if b.visible != a.visible {
            if e.ruolo == fub_scene::Role::Paper {
                return Err(no("il foglio di Fub non si nasconde"));
            }
            if a.visible && !e.nascosto {
                return Err(no(
                    "l'oggetto è nascosto da uno stile, che display non toglie",
                ));
            }
            if a.visible == e.nascosto {
                attrs.insert(
                    "display".into(),
                    if a.visible {
                        Value::Null
                    } else {
                        json!("none")
                    },
                );
            }
        }
        if !attrs.is_empty() {
            let id = self.bersaglio(a.id)?;
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": attrs }));
        }
        let mut c = (**b).clone();
        c.visible = a.visible;
        c.locked = a.locked;
        if let (NodeKind::Path { guide, .. }, true) = (&mut c.kind, e_guida(b) != e_guida(a)) {
            *guide = e_guida(a);
        }
        Ok(Arc::new(c))
    }

    /// Un livello di Fub rinominato dal motore: il `set` di `fub:layer` col
    /// nome nuovo, e il livello di prima con quel nome, per il resto del
    /// confronto. `None` se il nome non cambia o se `a` non è un livello di
    /// Fub (il livello che sta per la radice non ha un nome da scrivere, e il
    /// confronto lo rifiuta). Nel motore il livello si chiama col suo id
    /// (la mappa lega per nome): rinominarlo è dargli un nome diverso da quello.
    /// Un nome che il formato non tiene si rifiuta.
    pub(super) fn nome_del_livello(&mut self, b: &Node, a: &Node) -> Result<Option<Node>, Rifiuto> {
        if b.name == a.name {
            return Ok(None);
        }
        let Some(e) = self
            .elemento(a.id)
            .filter(|e| e.ruolo == fub_scene::Role::Layer)
            .cloned()
        else {
            return Ok(None);
        };
        let nome = a.name.clone().unwrap_or_default();
        if let Some(perche) = crate::mappa::nome_di_livello_sbagliato(&nome) {
            return Err(no(perche));
        }
        if e.livello.as_deref() != Some(nome.as_str()) {
            let id = self.bersaglio(a.id)?;
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": { "fub:layer": nome } }));
        }
        let mut c = b.clone();
        c.name = a.name.clone();
        Ok(Some(c))
    }

    /// Un livello nuovo del motore in cima al documento: un `<g>` figlio della
    /// radice ([`Lavoro::attributi_del_livello`]), al suo posto fra i livelli.
    /// I suoi oggetti e sottolivelli vengono dopo, ciascuno col suo `add`.
    pub(super) fn livello_nuovo(&mut self, dopo: &Document, i: usize) -> Result<(), Rifiuto> {
        let l = &dopo.layers[i];
        if !l.is_layer() {
            return Err(no("il gesto crea in cima un oggetto che non è un livello"));
        }
        // Il posto: dopo il livello che gli sta sotto; il primo dei livelli va
        // dopo l'elemento che precede il primo livello del file.
        let pos = if i + 1 == dopo.layers.len() {
            json!({ "last": true })
        } else if let Some(sotto) = i.checked_sub(1).map(|j| dopo.layers[j].id) {
            if self.copia.mappa.e_radice(sotto) {
                return Err(no(
                    "un livello nuovo fra gli elementi fuori da ogni livello non ha un posto nel file",
                ));
            }
            json!({ "after": self.bersaglio(sotto)? })
        } else {
            let primo = dopo.layers[i + 1].id;
            let e = self.elemento(primo).cloned().ok_or_else(|| {
                no("un livello nuovo sotto gli elementi fuori da ogni livello non ha un posto nel file")
            })?;
            let indice = e.percorso.first().copied().unwrap_or(0);
            let prima_di_lui = indice.checked_sub(1).and_then(|k| {
                self.copia
                    .mappa
                    .elementi()
                    .iter()
                    .find(|x| x.percorso == [k])
            });
            match self
                .copia
                .mappa
                .carta()
                .or_else(|| prima_di_lui.and_then(Elemento::id_del_file))
            {
                Some(id) => json!({ "after": id }),
                None if indice == 0 => json!({ "first": true }),
                None => {
                    return Err(no(
                        "un livello nuovo sotto tutti gli altri non ha un posto da scrivere",
                    ))
                }
            }
        };
        let attrs = self.attributi_del_livello(l, None)?;
        self.add.push(json!({
            "op": "add", "parent": "#root", "pos": pos,
            "elem": { "tag": "g", "attrs": attrs, "children": [] },
        }));
        Ok(())
    }

    /// Se i figli di un livello nuovo c'erano già tutti (Raccogli in un nuovo
    /// livello: ci vanno con un `move`) o sono tutti nuovi (Duplica livello:
    /// ciascuno col suo `add`). Un livello vuoto ha figli nuovi. Gli uni e gli
    /// altri insieme si rifiutano: i `move` e gli `add` nello stesso `g`
    /// nuovo non hanno un ordine sicuro.
    pub(super) fn figli_di_prima(
        &self,
        figli: &[&Arc<Node>],
        prima: &Posti<'_>,
    ) -> Result<bool, Rifiuto> {
        let di_prima =
            |c: &&Arc<Node>| prima.nodi.contains_key(&c.id) && !self.riscritti.contains(&c.id);
        if !figli.is_empty() && figli.iter().all(di_prima) {
            return Ok(true);
        }
        if figli
            .iter()
            .all(|c| !prima.nodi.contains_key(&c.id) && !ha_pezzi_di_prima(c, prima))
        {
            return Ok(false);
        }
        Err(no(
            "un livello nuovo con oggetti di prima e oggetti nuovi insieme non si scrive",
        ))
    }

    /// Gli attributi di un livello nuovo, anche di un sottolivello: un id di
    /// livello nuovo e `fub:layer` col nome del motore (formato della scena
    /// §3, ADR 0251). Si scrive solo un livello nascosto o bloccato al più:
    /// ciò che il formato non dice (il modello, la stampa, l'anteprima, le
    /// immagini sbiadite) si rifiuta. Un livello che ritaglia (Duplica di un
    /// livello che ritaglia) ha il suo `clip-path` e un `clipPath` privato
    /// nuovo ([`Lavoro::ritaglio_del_livello_nuovo`]), nelle coordinate del
    /// `genitore`. Il colore del motore non si scrive: il formato non lo ha,
    /// e il motore ne dà uno a ogni livello nuovo.
    pub(super) fn attributi_del_livello(
        &mut self,
        l: &Node,
        genitore: Option<NodeId>,
    ) -> Result<Map<String, Value>, Rifiuto> {
        let NodeKind::Layer {
            children,
            template,
            printable,
            preview,
            dim_images,
            ..
        } = &l.kind
        else {
            return Err(no("il livello nuovo non è un livello"));
        };
        if *template || !*printable || !*preview || dim_images.is_some() {
            return Err(no(
                "il livello nuovo ha opzioni che il formato della scena non ha",
            ));
        }
        let nome = self.nome_della_copia(l.name.as_deref().unwrap_or_default());
        if let Some(perche) = crate::mappa::nome_di_livello_sbagliato(&nome) {
            return Err(no(perche));
        }
        let id = self.id_nuovo(Specie::Livello)?;
        self.ids.insert(l.id, id.clone());
        let mut attrs = Map::new();
        attrs.insert("id".into(), json!(id));
        attrs.insert("fub:layer".into(), json!(nome));
        if let Some(ritaglio) = self.ritaglio_del_livello_nuovo(l, genitore)? {
            attrs.insert("clip-path".into(), json!(ritaglio));
        }
        // La scena non mette niente in un livello bloccato: la copia di un
        // livello bloccato (Duplica livello) nasce sbloccata, prende i suoi
        // oggetti e si blocca con un `set`, che va dopo tutti gli `add`.
        let con_figli = children.len() > usize::from(l.clips());
        if l.locked && con_figli {
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": { "fub:locked": "true" } }));
        } else if l.locked {
            attrs.insert("fub:locked".into(), json!("true"));
        }
        if !l.visible {
            attrs.insert("display".into(), json!("none"));
        }
        Ok(attrs)
    }

    /// Il nome di un livello nuovo. Duplica livello nomina la copia «X copy»
    /// col nome del livello nel motore, che per un livello di Fub è il suo
    /// id: la copia prende il nome che si vede, `fub:layer`, con « copia».
    pub(super) fn nome_della_copia(&self, nome: &str) -> String {
        let mappa = &self.copia.mappa;
        nome.strip_suffix(" copy")
            .and_then(|id| mappa.dell_id(id))
            .and_then(|i| mappa.elementi()[i].livello.as_deref())
            .map_or_else(|| nome.to_string(), |vero| format!("{vero} copia"))
    }
}
