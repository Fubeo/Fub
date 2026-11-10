//! Lo schema tantivy dell'indice e ciò che lo accompagna su disco: il
//! manifest, le impronte dei documenti, tag e task indicizzati.

use super::*;

/// Ciò che il manifest deve dire perché ci si possa fidare delle impronte.
///
/// Le impronte vivono qui e non dentro l'indice per non pagare, ad ogni
/// apertura, la lettura documento-per-documento di tutto il vault. Il prezzo è
/// che manifest e indice sono **due cose che possono divergere** (un crash fra
/// il commit e la scrittura del manifest, o un commit deciso da una query e non
/// seguito da un flush). Il guardiano è l'`opstamp`: tantivy lo incrementa ad
/// ogni commit, e un manifest che non cita l'opstamp attualmente committato è
/// per definizione di un'altra epoca — si buttano le impronte, non l'indice, e
/// i documenti si reindicizzano (delete+add è idempotente). Mai il contrario:
/// un manifest creduto valido a sproposito farebbe *saltare* documenti, cioè
/// mentire in silenzio.
#[derive(Debug, Serialize, Deserialize)]
pub(super) struct Manifest {
    pub(super) schema_version: SchemaVersion,
    pub(super) opstamp: u64,
    /// `DocId` → impronta del contenuto indicizzato.
    pub(super) docs: HashMap<String, u64>,
    /// `DocId` → la revisione del **sorgente** da cui quel contenuto è stato
    /// ricavato, cioè ciò che permette di rispondere a
    /// [`IndexProvider::up_to_date`] **senza che nessuno legga il file**
    /// (§14.2).
    ///
    /// È un'informazione diversa da `docs`, non una ridondanza: `docs` è
    /// l'impronta del *modello* — id, testo, tag — e serve a non riscrivere in
    /// tantivy ciò che è identico *dopo* il parse; questa è l'impronta dei
    /// **byte del file**, la stessa che il kernel tiene in anagrafe, e serve a
    /// non arrivare al parse. Non si può derivare l'una dall'altra: fra le due
    /// c'è un parser.
    ///
    /// Assente per un documento indicizzato **senza** che nessuno abbia
    /// dichiarato di che revisione fosse — cioè per ogni scrittura a sessione
    /// aperta, dove il kernel alimenta l'indice senza passare da `up_to_date`.
    /// Vuol dire «alla prossima apertura rileggimelo», che è il verso giusto in
    /// cui sbagliare.
    #[serde(default)]
    pub(super) sources: HashMap<String, String>,
}

/// I tag di un documento come li conta il kernel: quelli nel testo e quelli
/// del frontmatter (`fub_abi::rules::tag::frontmatter_tags`), senza doppioni.
pub(super) fn tag_names(doc: &DocumentModel) -> Vec<String> {
    let mut names: Vec<String> = doc.tags.iter().map(|t| t.name.clone()).collect();
    for name in fub_abi::rules::tag::frontmatter_tags(&doc.frontmatter) {
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// Impronta stabile di ciò che finisce nell'indice per un documento.
///
/// L'impronta è quella del contratto ([`Fnv1a`]) e non una copia con le stesse
/// due costanti: questi numeri sopravvivono su disco fra un avvio e l'altro, e
/// una copia che diverge renderebbe illeggibile un indice già scritto senza che
/// nessun banco se ne accorga — ogni copia resta coerente con sé stessa.
pub(super) fn fingerprint(doc: &DocumentModel) -> u64 {
    let mut h = Fnv1a::new();
    // Il path intero e non il solo nome: da quando l'indice porta la cartella
    // (`folder`, v3), spostare una nota cambia ciò che è indicizzato anche a
    // contenuto identico.
    h.update(doc.id.as_str().as_bytes());
    h.update(&[0]);
    h.update(doc.text.as_bytes());
    h.update(&[0]);
    // I tag del frontmatter entrano nell'impronta come quelli del testo: una
    // nota indicizzata prima che contassero cambia impronta e si reindicizza
    // da sola alla prossima apertura.
    for tag in tag_names(doc) {
        h.update(tag.as_bytes());
        h.update(&[0x1f]);
    }
    // Gli alias finiscono nell'indice (dentro `page_name`, vedi
    // `tantivy_doc`), quindi finiscono nell'impronta: senza, un alias
    // aggiunto a testo invariato non reindicizzerebbe niente e la ricerca
    // per nome resterebbe sorda. Stesso separatore dei tag; nessun campo
    // nuovo, nessuno bump di schema oltre questo commento.
    for alias in doc.frontmatter.aliases() {
        h.update(alias.as_bytes());
        h.update(&[0x1f]);
    }
    let tasks = task_states(doc);
    h.update(&[u8::from(tasks.open), u8::from(tasks.done)]);
    for due in &tasks.due {
        h.update(due.as_bytes());
        h.update(&[0x1f]);
    }
    // Le righe del corpo non stanno nel testo piatto: un a-capo morbido ci
    // diventa uno spazio, e la ricerca per riga lo vedrebbe vecchio.
    h.update(&[0]);
    h.update(scope::layout(doc).as_bytes());
    h.value()
}
/// Le task di un documento: se ce n'è una aperta, una fatta, e le scadenze
/// delle aperte.
#[derive(Default)]
pub(super) struct Tasks {
    pub(super) open: bool,
    pub(super) done: bool,
    pub(super) due: Vec<String>,
}

/// Task presenti nell'albero, compresi liste annidate, citazioni e custom
/// block.
pub(super) fn task_states(doc: &DocumentModel) -> Tasks {
    let mut tasks = Tasks::default();
    let mut pending: Vec<&Block> = doc.body.iter().collect();
    while let Some(block) = pending.pop() {
        match block {
            Block::List { items, .. } => {
                for item in items {
                    if let Some(marker) = item.task {
                        if marker.checked() {
                            tasks.done = true;
                        } else {
                            tasks.open = true;
                            if let Some(due) = item_due(&item.blocks) {
                                tasks.due.push(due);
                            }
                        }
                    }
                    pending.extend(&item.blocks);
                }
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => pending.extend(blocks),
            _ => {}
        }
    }
    // L'ordine delle date è quello del cammino: l'impronta lo vuole stabile.
    tasks.due.sort();
    tasks.due.dedup();
    tasks
}

/// I campi dello schema, risolti una volta sola.
#[derive(Clone, Copy)]
pub(super) struct Fields {
    pub(super) doc_id: Field,
    pub(super) page_name: Field,
    pub(super) body: Field,
    /// I tag esatti, in forma canonica.
    pub(super) tags: Field,
    /// I tag e ogni loro antenato (`progetto/casa` mette anche `progetto`): è
    /// ciò che rende `Tag { descendants: true }` una `TermQuery` invece di un
    /// prefisso da valutare documento per documento.
    pub(super) tag_paths: Field,
    /// Ogni cartella antenata, radice compresa.
    pub(super) folder: Field,
    /// La sola cartella che contiene il documento.
    pub(super) folder_exact: Field,
    /// Il testo degli heading del documento, in fila.
    ///
    /// Il testo c'è già dentro `body` — la proiezione a testo piano non toglie
    /// i titoli — e questa è una **seconda** copia, indicizzata a parte perché
    /// quello che serve è pesarla di più: una nota che ha dedicato una sezione
    /// a una cosa non è come una che la nomina di sfuggita, ed è la distinzione
    /// che `TextField::Heading` esiste per dire.
    pub(super) headings: Field,
    pub(super) task_state: Field,
    /// Righe, blocchi e sezioni del corpo (vedi [`scope`]).
    pub(super) layout: Field,
    /// Le scadenze delle task aperte, `AAAA-MM-GG`: una chiave per data, che
    /// si confronta come testo.
    pub(super) task_due: Field,
}

/// La forma dello schema, in una riga: `nome:tokenizer[:stored]` per campo, in
/// ordine di dichiarazione. Sta accanto a chi lo costruisce, perché è di lui che
/// parla.
#[cfg(test)]
pub(super) fn schema_fingerprint(schema: &Schema) -> String {
    schema
        .fields()
        .map(|(_, entry)| {
            let mut line = entry.name().to_string();
            if let tantivy::schema::FieldType::Str(opts) = entry.field_type() {
                line.push(':');
                line.push_str(match opts.get_indexing_options() {
                    Some(the) => the.tokenizer(),
                    None => "-",
                });
                if opts.is_stored() {
                    line.push_str(":stored");
                }
            } else {
                line.push_str(":other");
            }
            line
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn build_schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    // STRING = tokenizer "raw": il DocId resta un termine unico ed esatto, ed
    // è ciò che rende `delete_term` una cancellazione chirurgica.
    let doc_id = b.add_text_field("doc_id", STRING | STORED);
    let page_name = b.add_text_field("page_name", TEXT | STORED);
    // STORED anche il corpo: il generatore di snippet rilegge il testo del
    // documento, non può ricostruirlo dai postings.
    let body = b.add_text_field("body", TEXT | STORED);
    // STRING, non TEXT: un tag è una CHIAVE, non prosa. Tokenizzato,
    // `tags:rust` matchava anche `#progetto/rust` e `tags:area/lavoro`
    // diventava una phrase query su due termini — conteggi del pannello e
    // risultati del click non coincidevano mai. Ogni tag entra come termine
    // unico nella forma canonica ([`canonical_tag`]).
    let tags = b.add_text_field("tags", STRING | STORED);
    let tag_paths = b.add_text_field("tag_paths", STRING);
    // Come i tag, la cartella è una CHIAVE: termine esatto, non prosa. Non è
    // STORED perché non torna mai indietro — serve solo a filtrare.
    let folder = b.add_text_field("folder", STRING);
    let folder_exact = b.add_text_field("folder_exact", STRING);
    // Prosa, come il corpo: un heading è una frase che qualcuno ha scritto, e
    // si cerca dentro con le stesse regole. Non STORED: da qui non torna
    // indietro niente — gli estratti li genera il corpo.
    let headings = b.add_text_field("headings", TEXT | STORED);
    let task_state = b.add_text_field("task_state", STRING);
    // Soltanto memorizzato: si rilegge per i candidati di `Scoped`, che
    // l'indice ha già trovato col corpo.
    let layout = b.add_text_field("layout", STORED);
    let task_due = b.add_text_field("task_due", STRING);
    (
        b.build(),
        Fields {
            doc_id,
            page_name,
            body,
            tags,
            tag_paths,
            folder,
            folder_exact,
            headings,
            task_state,
            layout,
            task_due,
        },
    )
}
