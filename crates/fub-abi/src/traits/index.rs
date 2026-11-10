//! Il canale dati verso le view, prima parte: pagine, filtri, risultati per
//! documento, controlli di salute e bozze.

use super::*;

// ---------------------------------------------------------------------------
// Index — il canale dati verso le view
// ---------------------------------------------------------------------------
//
// Qui passa TUTTO ciò che una view sa del vault: full-text, backlink, grafo,
// proprietà del frontmatter, salute del vault. Ogni domanda che non è
// esprimibile come `IndexQuery` diventa un comando bespoke dell'app, cioè una
// superficie privilegiata che un plugin non potrà mai avere — è la ragione per
// cui questo enum è largo e va deciso prima del freeze di M4.
//
// Chi serve cosa **si dichiara** ([`QueryRoute`]), e chi risponde è un
// [`IndexProvider`] — anche quando è il kernel. Ciò di cui il kernel è già
// l'unica fonte di verità (grafo, metadati parsati, frontmatter) lo serve il
// suo indice interno, che è registrato per primo e non è privilegiato: si
// dichiara come gli altri, e chi vuole sostituirlo lo chiede per nome. Prima
// erano sette varianti su nove a cui il kernel rispondeva con un `return`
// anticipato, e a cui nessun provider registrato arrivava mai: il canale era
// "dati verso le view" per chiunque, ma "dati **da** chiunque" per due varianti
// su nove.
//
// Che il grafo non si duplichi dentro un altro indice resta vero, e adesso ha
// dove essere detto: chi lo volesse servire dichiarerebbe la stessa rotta, e la
// registrazione lo direbbe invece di lasciar vincere l'ordine di montaggio.
//
// # Dove finisce questo canale, e comincia una lettura
//
// Qui sta ciò che è **derivato**: aggregato sul vault (i tag, le faccette, la
// salute), oppure calcolato su una relazione che nessun documento contiene da
// solo (i backlink, i vicini). Il documento **in sé** — la sua sorgente, la sua
// struttura, di che formato è — non passa di qui ma dall'[`HostApi`]
// (`read_document`, `read_model`, `format_of`), e la ragione è
// duplice. La prima: una variante che il kernel servisse **sempre** da sé
// sarebbe una rotta che nessun altro può dichiarare, cioè il difetto che il
// routing (decisione 0019) è servito a togliere — allora era la regola, e
// riportarcelo dentro per un documento singolo sarebbe ricominciare. La
// seconda: `IndexResult` è l'enum su cui ogni indice fa `match`, e infilarci un
// `DocumentModel` intero vorrebbe dire farlo attraversare la firma di chi non
// lo ha chiesto.
//
// [`IndexQuery::Outline`] e [`IndexQuery::Tags`] stanno di qua e restano di
// qua: sono **proiezioni** che il kernel tiene in cache, e servirle costa una
// lettura di mappa invece di un parse. Il criterio non è "riguarda un
// documento" — è *chi lo sa già*.

/// La finestra chiesta su una risposta: da dove cominciare, quanti elementi al
/// più.
///
/// Sta nella **domanda** e non solo nella risposta perché chi serve la query
/// deve poter troncare *prima* di costruire il risultato: un vault con
/// centomila note non deve materializzare centomila righe per mostrarne venti
/// (24.1). `None` al posto di una `Page` significa "tutto": è la forma che
/// tiene onesti i clienti che davvero vogliono l'insieme intero (il pannello
/// tag, l'autocompletamento) senza costringerli a inventarsi un tetto.
///
/// # «Deve poter» non è «lo fa», ed è la differenza che il banco misura
///
/// Quella frase dice cosa la firma **permette**, non cosa succede: la `Page` in
/// ingresso è una facoltà di chi serve, e per anni nessuno ha guardato se
/// qualcuno la esercitasse. Il banco del §17.1
/// ([decisione 0113](../../../docs/decisions/0196-test-e-artefatti-generati.md))
/// l'ha guardato contando le allocazioni, e la risposta era **no** per ogni
/// famiglia dell'indice del kernel: si costruiva l'insieme intero e poi lo si
/// tagliava, quindi mostrare venti righe di un vault costava quanto il vault.
///
/// Le strade sono **tre**, e quale sia percorsa è un fatto misurabile e non una
/// promessa:
///
/// 1. **Paginare alla sorgente**: chi ha un motore che sa fermarsi (tantivy)
///    costruisce il [`Paged`] da sé e non passa da qui.
/// 2. [`Paged::from_source`]: una passata sola su un iteratore — si **conta**
///    tutto, si **materializza** solo la finestra. È la strada di chi ha una
///    mappa e un filtro, e il costo di una pagina smette di dipendere da quanto
///    è grande il vault.
/// 3. [`Paged::window`]: il ritaglio in memoria, che resta l'unica risposta
///    possibile quando la risposta va **ordinata** o **aggregata** prima di
///    essere tagliata (un `sort` per proprietà deve vedere tutte le righe per
///    sapere quali sono le prime venti). Lì la linearità non è uno spreco: è la
///    domanda.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page {
    /// Elementi da saltare. Oltre la fine → pagina vuota, non un errore.
    pub offset: u32,
    /// Quanti al più restituirne. `0` = nessuno (non "tutti": per quello si
    /// omette la `Page`).
    pub limit: u32,
}

impl Page {
    pub fn new(offset: u32, limit: u32) -> Self {
        Page { offset, limit }
    }

    /// I primi `limit` elementi.
    pub fn first(limit: u32) -> Self {
        Page { offset: 0, limit }
    }
}

/// Una risposta a finestra: gli elementi chiesti, da dove cominciano e quanti
/// ce ne sarebbero **in tutto**.
///
/// `total` non è decorativo: senza, chi disegna non sa se esiste una pagina
/// dopo, e "1-20 di 4321" — che è ciò che ogni elenco lungo mostra — non si
/// scrive. È il conteggio *prima* della finestra, non `items.len()`.
///
/// Al confine WIT non esistono i generici: ogni istanza di questo tipo è là un
/// record a sé (`backlinks-page`, `search-page`, …). La ripetizione è il prezzo
/// dichiarato di avere `total` accanto agli elementi invece che in un canale
/// separato che si può dimenticare.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub offset: u32,
    pub total: u32,
}

impl<T> Paged<T> {
    /// Tutto ciò che c'è, senza finestra.
    pub fn all(items: Vec<T>) -> Self {
        let total = items.len() as u32;
        Paged {
            items,
            offset: 0,
            total,
        }
    }

    /// Ritaglia una risposta **già in memoria**.
    ///
    /// È la strada di chi la risposta la deve avere intera per costruirla: chi
    /// la **ordina** o la **aggrega** non sa quali sono le prime venti righe
    /// finché non le ha viste tutte. Il conteggio resta quello vero, solo gli
    /// elementi si riducono.
    ///
    /// **Non è la strada di chi ha solo un filtro**: quella è
    /// [`from_source`](Paged::from_source), che fa la stessa passata senza
    /// costruire ciò che butta. Chiamare `window` su un `.collect()` appena
    /// fatto è il modo in cui una pagina finisce per costare quanto il vault, ed
    /// è ciò che il banco del §17.1 ha misurato.
    pub fn window(items: Vec<T>, page: Option<Page>) -> Self {
        let total = items.len() as u32;
        let Some(page) = page else {
            return Paged {
                items,
                offset: 0,
                total,
            };
        };
        let items = items
            .into_iter()
            .skip(page.offset as usize)
            .take(page.limit as usize)
            .collect();
        Paged {
            items,
            offset: page.offset,
            total,
        }
    }

    /// Conta tutta la sorgente e **costruisce solo la finestra**, in una
    /// passata sola.
    ///
    /// È la forma che mancava, e che rende vera la promessa scritta su
    /// [`Page`]: la fonte è un iteratore — i valori di una mappa, un filtro
    /// sull'anagrafe, l'elenco delle bozze — e `make` è ciò che costa (una
    /// clonazione, un record da comporre). Chi resta fuori dalla finestra viene
    /// **contato e non costruito**, quindi il prezzo di una pagina smette di
    /// dipendere da quanto è grande il vault.
    ///
    /// **`make` è un argomento e non un `.map()` sulla sorgente** proprio per
    /// questo: un `.map()` è pigro ma `from_source` arriva in fondo per contare,
    /// quindi lo applicherebbe a tutti e il guadagno sarebbe zero. Chi legge un
    /// `Paged::from_source(iter.map(caro), …)` sta guardando la stessa
    /// linearità di prima con un nome diverso.
    ///
    /// E un `skip`/`take` da solo non basterebbe, che è l'altra metà del perché
    /// questa funzione esiste invece di essere una riga nei chiamanti: darebbe
    /// la finestra giusta e un `total` sbagliato, cioè una barra di scorrimento
    /// che mente.
    ///
    /// Senza `page` è [`all`](Paged::all): «tutto» resta tutto, e si paga tutto.
    pub fn from_source<I, U, F>(items: I, page: Option<Page>, mut make: F) -> Self
    where
        I: IntoIterator<Item = U>,
        F: FnMut(U) -> T,
    {
        let Some(page) = page else {
            return Paged::all(items.into_iter().map(make).collect());
        };
        let start = page.offset as usize;
        let end = start.saturating_add(page.limit as usize);
        let mut total: u32 = 0;
        let mut items_in_window = Vec::new();
        for (the, item) in items.into_iter().enumerate() {
            total = total.saturating_add(1);
            if the >= start && the < end {
                items_in_window.push(make(item));
            }
        }
        Paged {
            items: items_in_window,
            offset: page.offset,
            total,
        }
    }
}

/// In che verso si cammina il grafo dei link.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkDirection {
    /// I link **uscenti**: le note che questa nomina.
    #[default]
    Outbound,
    /// I link **entranti**: le note che nominano questa (i backlink).
    Inbound,
    /// Entrambi i versi, come li disegna una vista a grafo.
    Both,
}

/// Come si mette alla prova una proprietà del frontmatter.
///
/// Un `variant` e non una coppia operatore+valore: `exists` e `missing` un
/// valore non ce l'hanno, e un campo che in due casi su sette non significa
/// niente è un invito a riempirlo di `null`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum PropertyTest {
    /// La chiave c'è (anche con valore vuoto: `chiave:` esiste).
    Exists,
    /// La chiave non c'è.
    Missing,
    Equals(PropertyValue),
    NotEquals(PropertyValue),
    /// Per un elenco: contiene questo scalare. Per un testo: lo contiene come
    /// sottostringa. Per il resto: uguaglianza.
    Contains(PropertyScalar),
    /// Confronti d'ordine fra valori della **stessa specie** (numero, data,
    /// testo). Specie diverse non si ordinano: la prova è falsa, non un errore
    /// — un vault vero ha frontmatter disomogeneo e una query non deve morirci.
    GreaterThan(PropertyValue),
    LessThan(PropertyValue),
}

/// Una condizione su una proprietà: la foglia
/// [`QueryPredicate::Property`](crate::query::QueryPredicate::Property).
///
/// L'OR e la negazione non stanno qui e non ci sono mai stati: li porta il
/// linguaggio che sta intorno ([`crate::query`]), che è il posto dove valgono
/// per **ogni** foglia e non solo per il frontmatter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropertyFilter {
    pub key: String,
    pub test: PropertyTest,
}

/// Come ordinare i documenti di una [`IndexQuery::Properties`]. Chi non ha la
/// chiave finisce **in fondo** in entrambi i versi (è assente, non minimo).
/// Fra specie diverse l'ordine è un **rango fisso** che non si ribalta col
/// decrescente (decisione 0155). A parità vale l'ordine dei `DocId`: una
/// risposta paginata deve essere stabile, o la seconda pagina ripete la prima.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertySort {
    pub key: String,
    pub descending: bool,
}

/// Quali proprietà del frontmatter portarsi dietro in una risposta.
///
/// Era un `Vec<String>` con la convenzione «vuoto = tutte», e la convenzione si
/// è rotta quando le due domande sono diventate una: un elenco di risultati di
/// ricerca che si trascina l'intero frontmatter di mille note è il default
/// sbagliato, e «tutte» non si può dire con una lista di chiavi che non si
/// conoscono. Sono tre casi, e adesso si nominano.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PropertySelect {
    /// Nessuna: la riga è il documento e basta. È il default, ed è ciò che
    /// vuole chi disegna un elenco di titoli.
    #[default]
    None,
    /// Tutto il frontmatter: l'ispettore delle proprietà, l'esportatore.
    All,
    /// Queste chiavi, in ordine di chiave. Una chiave chiesta e assente non
    /// compare: l'assenza è un fatto, non un valore da inventare.
    Keys { keys: Vec<String> },
}

impl PropertySelect {
    /// Le chiavi nominate, per chi deve decidere se vale la pena guardare il
    /// frontmatter.
    pub fn is_none(&self) -> bool {
        matches!(self, PropertySelect::None)
    }

    pub fn keys(names: &[&str]) -> Self {
        PropertySelect::Keys {
            keys: names.iter().map(|k| k.to_string()).collect(),
        }
    }
}

/// Se la risposta deve portarsi dietro gli **estratti**, o solo dire quali
/// documenti combaciano (§21.9).
///
/// È la stessa specie di distinzione di [`PropertySelect`] — *cosa* torna
/// indietro, non *cosa* si seleziona — e nasce da una misura: una ricerca
/// testuale su duemila note ne costava ventitré millisecondi, e ventuno erano
/// duemila estratti generati per mostrarne venti. Il pianificatore chiede senza
/// finestra (l'ordine della risposta è del contratto, non del motore), quindi
/// senza questo campo non ha nessun modo di dire «per adesso mi bastano gli id»:
/// chi indicizza deve presumere che l'estratto serva sempre, ed è il caso più
/// caro.
///
/// Vale per chi **produce** una risposta, non per chi la legge: un estratto
/// assente non vuol dire che non ce ne sia uno da fare — vuol dire che nessuno
/// l'ha chiesto. È la stessa lettura di
/// [`DocumentMatch::occurrences`] vuoto.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Excerpts {
    /// Sì: chi ha cercato vede **perché** una nota è nel risultato. È il
    /// default, ed è il verso giusto in cui sbagliare — chi non sa di questo
    /// campo riceve una risposta completa e paga, invece di ricevere una
    /// risposta muta e non capire perché.
    #[default]
    Attach,
    /// No: la domanda seleziona e basta. La chiede chi sa che getterà via quasi
    /// tutto — il pianificatore prima di applicare la finestra, un'automazione
    /// che conta, `vault.replace` che riscrive — e non chi disegna un elenco di
    /// risultati.
    ///
    /// Non tocca la **rilevanza**: il punteggio serve a ordinare, e ordinare è
    /// esattamente ciò che si fa prima di sapere quale pagina resta.
    Omit,
}

impl Excerpts {
    pub fn wanted(self) -> bool {
        matches!(self, Excerpts::Attach)
    }
}

/// Una proprietà con il suo valore normalizzato ([`PropertyValue`], decisione 0003).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropertyEntry {
    pub key: String,
    pub value: PropertyValue,
}

/// **Un punto dentro un documento**, dicibile nel contratto (decisione 0049).
///
/// È una primitiva sola per i tre clienti che la chiedevano da tre firme
/// diverse: il salto all'occorrenza di un risultato di ricerca
/// ([`DocumentMatch::occurrences`]), il riferimento a un blocco o a un heading
/// che [`IndexResult::Resolved`] deve poter indicare ([`ResolvedRef`]), e la
/// citazione di una lavagna verso un punto di una nota. Tre modi di dire
/// «dove» sarebbero stati tre modi diversi, e il secondo sarebbe arrivato con
/// il primo già congelato.
///
/// # I tre campi sono tre domande diverse
///
/// - `span` è in **byte del sorgente** del documento — la stessa valuta di ogni
///   altro [`Span`] del modello, e quella che
///   [`ViewUpdate::Reveal`](crate::ui::ViewUpdate::Reveal) sa già portare in
///   un editor. Non è un intervallo dentro
///   [`snippet`](DocumentMatch::snippet): quello serve a **disegnare** una riga
///   e non a tornare al testo, e le due cose non sono la stessa.
/// - `anchor` è l'ancora del blocco che ospita il punto, quando ce n'è una
///   (`^abc`, o lo slug di un heading). Sopravvive alla riscrittura del
///   paragrafo che la contiene, cosa che uno span non fa; ma non è immortale —
///   cancellare la riga che la porta la fa sparire — e per questo non
///   **sostituisce** lo span.
/// - `revision` dice **di quando**: uno span invecchia appena il documento
///   cambia sotto, e senza questo campo la shell porterebbe il cursore nel
///   punto sbagliato senza accorgersene. Il contratto sa già dirlo altrove
///   ([`EditRequest`](crate::edit::EditRequest), decisione 0008), e la risposta
///   qui è **una** perché la domanda era la stessa da due lati.
///
/// Non è opzionale la revisione e non lo è lo span: una posizione che non sa
/// dire di quando è una posizione che non si può usare senza indovinare, e chi
/// non sa dirlo non produce una posizione affatto (`None`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DocPosition {
    /// Byte nel **sorgente** del documento, non dentro un estratto.
    pub span: Span,
    /// L'ancora del blocco che lo ospita, se ne ha una.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
    /// Il sorgente su cui `span` è stato calcolato.
    pub revision: Revision,
}

impl DocPosition {
    /// Un punto senza ancora: il caso di chi ha trovato un'occorrenza nel testo
    /// e non sa (o non ha pagato per sapere) in che blocco cade.
    pub fn at(span: Span, revision: Revision) -> Self {
        DocPosition {
            span,
            anchor: None,
            revision,
        }
    }

    pub fn with_anchor(mut self, anchor: impl Into<String>) -> Self {
        self.anchor = Some(anchor.into());
        self
    }
}

/// Cosa nomina un riferimento: **quale** documento e, quando il riferimento lo
/// dice, **dove dentro** (risposta a [`IndexQuery::Resolve`]).
///
/// `at` è presente solo se il riferimento chiedeva un punto — `[[Nota#Sezione]]`
/// o `[[Nota#^blocco]]` — e quel punto esiste ancora: un `heading` che nessuno
/// ha più, un `^abc` cancellato e un riferimento che nomina la nota e basta
/// danno tutti e tre `None`, e chi ha chiesto apre il documento in cima. È lo
/// stesso degrado del `None` che avvolge questo record, un gradino più in
/// basso.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedRef {
    pub doc: DocId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<DocPosition>,
}

impl ResolvedRef {
    /// Il documento, senza un punto dentro.
    pub fn doc(doc: DocId) -> Self {
        ResolvedRef { doc, at: None }
    }
}

/// Un documento che ha combaciato, con ciò che la query gli ha attaccato
/// addosso: la riga di una collezione (8.4), di un database su file (11) o di
/// un elenco di risultati di ricerca.
///
/// **È un tipo solo dove prima erano due** (`SearchHit` e `DocumentProperties`),
/// ed è la conseguenza visibile del linguaggio: finché «cerca» e «filtra» erano
/// due varianti, i loro risultati erano due tipi e il join fra i due era
/// inesprimibile — le note `tipo: progetto` che parlano di rust dovevano essere
/// due domande e un'intersezione fatta a mano da chi disegna. Adesso sono una
/// domanda sola, e la sua riga porta ciò che ha da portare: la rilevanza e
/// l'estratto se un ramo di testo ha contribuito, le proprietà se sono state
/// chieste.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentMatch {
    pub doc: DocId,
    /// Rilevanza, quando a selezionare è stato (anche) un
    /// [`QueryPredicate::Text`](crate::query::QueryPredicate::Text). Assente per
    /// una selezione che non ha niente da ordinare per pertinenza: `tipo:
    /// progetto` non è più o meno vero su una nota che su un'altra.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
    /// L'estratto attorno al match, **testo semplice** e mai markup: chi disegna
    /// lo inserisce come testo (nessun varco di injection da un provider di
    /// terzi — stessa regola di [`UiNode`](crate::ui::UiNode)).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    /// Porzioni di `snippet` che hanno prodotto il match, in ordine e non
    /// sovrapposte. Intervalli in **byte dentro `snippet`**, che chi disegna
    /// avvolge con i propri elementi.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub highlights: Vec<Span>,
    /// In ordine di chiave. Quali chiavi ci sono lo decide `select` nella
    /// query; vuoto là = niente, non "tutto il frontmatter" — un elenco di
    /// risultati non deve trascinarsi dietro il frontmatter di mille note per
    /// mostrarne il titolo.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<PropertyEntry>,
    /// **Dove**, nel sorgente del documento, sta ciò che ha combaciato — in
    /// ordine di posizione (decisione 0049).
    ///
    /// Non è un doppione di `highlights`, ed è la distinzione che rende
    /// esprimibili tre cose che prima non lo erano: la ricerca dentro la nota
    /// aperta (§21.4), il «vai all'occorrenza successiva», e N risultati per
    /// nota. `highlights` è la forma giusta per **disegnare** una riga —
    /// intervalli dentro `snippet`, che chi disegna avvolge — e non ha nessuna
    /// coordinata nel documento; queste sono le coordinate, e non hanno niente
    /// da disegnare.
    ///
    /// Vuoto non vuol dire «nessuna occorrenza»: vuol dire che nessuno le ha
    /// calcolate. Chi seleziona senza cercare del testo (`tipo: progetto`) non
    /// ha niente da localizzare, e un provider può rispondere senza pagare la
    /// lettura del sorgente.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub occurrences: Vec<DocPosition>,
}

impl DocumentMatch {
    /// Un documento selezionato e basta: nessuna rilevanza, nessun estratto.
    pub fn of(doc: DocId) -> Self {
        DocumentMatch {
            doc,
            score: None,
            snippet: None,
            highlights: Vec::new(),
            properties: Vec::new(),
            occurrences: Vec::new(),
        }
    }

    pub fn with_score(mut self, score: f32) -> Self {
        self.score = Some(score);
        self
    }

    /// Fonde ciò che un altro ramo sa dello stesso documento.
    ///
    /// La rilevanza che resta è la **maggiore**, e la scelta è deliberata: il
    /// kernel non è un motore di ranking, e sommare le rilevanze di due rami
    /// vorrebbe dire inventare uno scoring che nessuno ha misurato. Comporle
    /// davvero è mestiere di chi indicizza, e ci arriva quando l'intera clausola
    /// gli viene consegnata (il pushdown del pianificatore). L'estratto è il
    /// primo che c'è: due estratti dello stesso documento sono due finestre
    /// sullo stesso testo, e mostrarne due sarebbe rumore.
    ///
    /// **Le occorrenze invece si sommano**, e la differenza non è
    /// un'incoerenza: è la stessa regola resa dipendente da chi chiede
    /// (decisione 0049). «Un estratto per documento» è vero della riga di una
    /// collezione, che di righe ne disegna una; è falso della ricerca, che di
    /// occorrenze ne mostra N e permette di saltare all'una o all'altra. Le due
    /// cose stanno nello stesso record perché il record è uno, e ognuna segue
    /// la regola del proprio cliente.
    pub fn absorb(&mut self, other: DocumentMatch) {
        self.score = match (self.score, other.score) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        if self.snippet.is_none() {
            self.snippet = other.snippet;
            self.highlights = other.highlights;
        }
        for entry in other.properties {
            if !self.properties.iter().any(|and| and.key == entry.key) {
                self.properties.push(entry);
            }
        }
        self.properties.sort_by(|a, b| a.key.cmp(&b.key));
        for position in other.occurrences {
            if !self.occurrences.contains(&position) {
                self.occurrences.push(position);
            }
        }
        self.occurrences.sort_by_key(|p| (p.span.start, p.span.end));
    }
}

/// Un valore distinto di una proprietà e quante note lo portano: la faccetta di
/// 9.1, gemella di [`TagCount`] per il frontmatter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PropertyCount {
    pub value: PropertyValue,
    pub count: u32,
}

/// Quale controllo di salute del vault si sta chiedendo.
///
/// Ogni voce è un'interrogazione sul grafo e sui modelli che il kernel **ha già
/// in memoria**: 7.2 ne chiede una trentina, e senza questa variante ognuna
/// sarebbe un comando bespoke sullo stesso dato.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthCheck {
    /// Link che non risolvono a nessun documento del vault (wikilink e link
    /// markdown; un URL non è un link rotto, è un'altra cosa).
    BrokenLinks,
    /// Note che nessuno nomina: zero riferimenti entranti.
    OrphanDocuments,
    /// File che il filesystem distingue e la chiave di risoluzione no: due path
    /// che differiscono **solo** per maiuscole o per forma di composizione
    /// Unicode (`Nota.md` e `nota.md`, `Café.md` in NFC e in NFD).
    ///
    /// Non è un difetto del vault — quei due file esistono ed è legittimo — ma è
    /// l'unico caso in cui il kernel *non può* dare all'utente una risposta
    /// giusta senza dirgliela: in una sottocartella un link markdown col path
    /// intero disambigua, ma per due file nella **radice** del vault non esiste
    /// nessun wikilink che li separi, perché la risoluzione per nome passa da
    /// una chiave che il caso l'ha già collassato. Quando l'ambiguità non è
    /// esprimibile nella lingua dei link, l'unica risposta possibile è dirlo.
    CollidingPaths,
    /// Proprietà che **sembrano** una data e non lo sono: `scadenza: 5/7/2026`
    /// resta un [`PropertyValue::Text`](crate::model::PropertyValue::Text)
    /// finché il vault non dichiara il proprio formato.
    ///
    /// È il segnale che mancava a una famiglia intera: un testo che sembra una
    /// data non produce un errore da nessuna parte — produce un filtro che non
    /// trova, una faccetta per ogni scrittura diversa dello stesso giorno, e un
    /// ordinamento che separa le specie per rango (la data prima dei testi)
    /// invece di confrontarle come giorni. Finché il formato non è dichiarato
    /// i testi restano lessicali *dentro* il loro rango: plausibile, e sbagliato
    /// come cronologia. Il rilevatore è lo stesso parser con tutti i formati
    /// insieme
    /// ([`DateFormats::looks_like_a_date`](crate::model::DateFormats::looks_like_a_date)):
    /// ciò che due dichiarazioni leggerebbero in due modi è esattamente ciò su
    /// cui vale la pena chiedere a chi possiede il vault.
    UnrecognizedDates,
    /// Note da cui non si va da nessuna parte: nessun link verso il vault. Un
    /// URL esce dal vault e un `[[#Sezione]]` resta nella nota; un link rotto
    /// invece conta, perché chi l'ha scritto voleva andare da qualche parte.
    DeadEnds,
    /// Allegati che nessun documento nomina, né come link né come embed. Un
    /// file che nessuno sa cosa sia ([`EntryKind::Unknown`]) non è un
    /// allegato e non c'entra.
    UnusedAttachments,
}

impl HealthCheck {
    /// Tutti i controlli, in ordine di dichiarazione.
    ///
    /// Esiste perché c'è **un** chiamante che li vuole tutti — il rapporto
    /// diagnostico, che è l'unico posto in cui il vault si racconta intero — e
    /// un elenco scritto a mano lì dentro tace su un controllo nuovo restando
    /// verde: il rapporto continua a essere un array, ha solo una riga in meno,
    /// e nessuno confronta quell'array con l'enum. È la stessa forma di
    /// [`ViewSurface::ALL`], e ha lo stesso presidio dei discriminanti.
    pub const ALL: [HealthCheck; 6] = [
        HealthCheck::BrokenLinks,
        HealthCheck::OrphanDocuments,
        HealthCheck::CollidingPaths,
        HealthCheck::UnrecognizedDates,
        HealthCheck::DeadEnds,
        HealthCheck::UnusedAttachments,
    ];
}

/// Un problema trovato da un [`HealthCheck`], sul documento che lo porta.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HealthIssue {
    /// Il documento in cui sta il problema: la nota che contiene il link rotto,
    /// la nota orfana.
    pub doc: DocId,
    pub check: HealthCheck,
    /// Il dettaglio leggibile: per un link rotto la destinazione **come era
    /// scritta**, che è ciò che serve per correggerla; per una collisione di
    /// path gli **altri** file che condividono la chiave, separati da `, `.
    /// Assente quando il problema è il documento stesso (una nota orfana non ha
    /// un dettaglio).
    pub detail: Option<String>,
    /// Dove sta nel sorgente, quando il problema ha un punto: lo span del link
    /// rotto. In byte, come ogni span del modello.
    pub span: Option<Span>,
}

/// Una **bozza**: ciò che l'utente stava scrivendo e non ha salvato (§15.2).
///
/// Porta il testo con sé, e non un puntatore da risolvere con una seconda
/// domanda: la sola ragione per cui questo tipo esiste è che quel testo non
/// vada perso, e un elenco che dice *ci sono tre bozze* senza poterle mostrare
/// avrebbe rimandato l'unica cosa che conta a una chiamata che può fallire.
/// Quante ce ne sono lo governa la paginazione, come per ogni altra risposta.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftInfo {
    /// Di quale documento è. Per una nota mai salvata è il nome che avrebbe.
    pub doc: DocId,
    /// Millisecondi UNIX dell'ultima scrittura della bozza.
    pub at: u64,
    /// La revisione del file su cui il buffer stava lavorando, **quando chi ha
    /// scritto la bozza la sapeva**.
    ///
    /// `None` non vuol dire «nota nuova» — quello lo dice `exists` — vuol dire
    /// *non lo so*: chi tiene un buffer non sempre ha in mano l'impronta del
    /// file da cui è partito, e inventargliela sarebbe peggio che ammetterlo.
    /// La differenza si vede in cosa si può offrire: con una base si può dire
    /// «il file è cambiato sotto», senza si può solo mostrare i due testi.
    pub base: Option<Revision>,
    /// Il documento c'è ancora? Lo dice l'anagrafe (§14.1), che è chi sa cosa
    /// contiene il vault.
    ///
    /// `false` è il caso che questa voce esiste per non nascondere: una nota
    /// cancellata mentre il suo buffer era sporco lascia una bozza **orfana**,
    /// e quella bozza è l'unica copia rimasta di ciò che l'utente aveva
    /// scritto. Buttarla in silenzio sarebbe la perdita che la seduta 20 vieta.
    pub exists: bool,
    /// La revisione del file **adesso**, per quel che il vault ne sa; `None` se
    /// il documento non c'è o se nessuno ne ha ancora letto i byte.
    ///
    /// Sta accanto a `base` perché è il fatto che il chiamante non può
    /// procurarsi da sé, e **non** un giudizio: che `base != current` voglia
    /// dire *tieni il tuo testo* o *tieni quello sul disco* è una domanda da
    /// fare a una persona, non un ramo di un `if` nel kernel.
    pub current: Option<Revision>,
    /// Il testo non salvato.
    pub text: String,
}
