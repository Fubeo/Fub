//! I simboli e le loro istanze, le ripetizioni con i loro originali, e i
//! riferimenti che rendono i simboli aciclici.

use super::*;

// I simboli (formato della scena, simboli).

/// Vero se `element`, un `symbol` di una `defs` della radice, ha gli
/// attributi di un simbolo: un id e `overflow="visible"`, e nessun altro
/// attributo SVG. I figli si giudicano uno per uno, come quelli di un gruppo.
pub(super) fn symbol_allowed(element: &Element<'_>) -> bool {
    let mut id = false;
    let mut overflow = false;
    let attributes = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE => match attr.local {
            "overflow" => {
                overflow = trim(&attr.value) == "visible";
                overflow
            }
            "id" => {
                id = !attr.value.is_empty();
                id
            }
            _ => false,
        },
        NS_XLINK | NS_SVG => false,
        _ => true,
    });
    attributes && id && overflow
}

/// Gli attributi SVG di un'istanza oltre a `href`: niente geometria e niente
/// di ciò che il contenuto del simbolo erediterebbe, così il simbolo si vede
/// uguale in ogni istanza.
pub(super) const INSTANCE_ATTRIBUTES: [&str; 8] = [
    "id",
    "transform",
    "opacity",
    "display",
    "style",
    "clip-path",
    "mask",
    "filter",
];

/// Gli attributi SVG di una copia oltre a `href`: dove sta e nient'altro,
/// perché l'editor riscrive le copie quando la ripetizione cambia (formato
/// della scena, ripetizioni).
pub(super) const COPY_ATTRIBUTES: [&str; 2] = ["id", "transform"];

/// Vero se `element`, un `use` fuori dalle `defs`, rimanda a ciò che vuole
/// `target`: un `href` o un `xlink:href`, uno solo, verso un id che
/// `resolve` dice di quel tipo, gli attributi di `attributes`, e per figli
/// soltanto titoli e descrizioni. Un'istanza vuole un simbolo e gli
/// attributi di [`INSTANCE_ATTRIBUTES`], una copia un originale e quelli di
/// [`COPY_ATTRIBUTES`].
pub(super) fn use_allowed(
    doc: &Document<'_>,
    element: &Element<'_>,
    resolve: Resolve<'_>,
    target: ResourceKind,
    attributes: &[&str],
) -> bool {
    let mut hrefs = 0;
    let allowed = element.attrs.iter().all(|attr| match attr.ns {
        NS_NONE | NS_XLINK => {
            if attr.local == "href" {
                hrefs += 1;
                return href_id(&attr.value).is_some_and(|id| resolve(&id) == Some(target));
            }
            if attr.ns == NS_XLINK || !attributes.contains(&attr.local) {
                return false;
            }
            (REFERENCES.contains(&attr.local) || !has_url(&attr.value))
                && svg_attribute(Tag::Use, attr.local, &attr.value, resolve)
        }
        NS_SVG => false,
        _ => true,
    });
    allowed
        && hrefs == 1
        && element
            .children
            .iter()
            .all(|&child| blank_or_meta(doc, child) == Some(true))
}

// Le ripetizioni (formato della scena, ripetizioni).

/// La ripetizione di `element`, se `fub:repeat` si legge. Vale per un `g`
/// che è un gruppo, non un livello: lo sa chi lo classifica.
pub(crate) fn repeat_of(element: &Element<'_>) -> Option<Repeat> {
    read_repeat(element.value(NS_FUB, "repeat")?)
}

/// Gli originali fra i figli di `parent`, una ripetizione: gli id dei figli
/// modificabili, titoli e descrizioni esclusi. `depth` è la profondità dei
/// figli, e `resolve`, che non conosce gli originali, dice che cosa è ogni id
/// a cui rimandano: un'istanza di un simbolo può essere un originale, una
/// copia no.
pub(super) fn originals_of(
    doc: &Document<'_>,
    parent: NodeId,
    depth: usize,
    resolve: Resolve<'_>,
) -> HashSet<String> {
    let mut out = HashSet::new();
    for &child in doc.children(parent) {
        let Some(id) = doc
            .element(child)
            .and_then(|element| element.value(NS_NONE, "id"))
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        let found = classify_child(doc, child, Place::Inside, depth, resolve);
        if found.is_some_and(|(_, role)| !matches!(role, Role::Title | Role::Desc)) {
            out.insert(id.to_owned());
        }
    }
    out
}

/// Che cosa è `id` per i figli di una ripetizione con gli originali
/// `originals`: un id che una risorsa porta resta suo.
pub(super) fn with_originals(
    resolve: Resolve<'_>,
    originals: Option<&HashSet<String>>,
    id: &str,
) -> Option<ResourceKind> {
    resolve(id).or_else(|| {
        originals
            .is_some_and(|originals| originals.contains(id))
            .then_some(ResourceKind::Original)
    })
}

/// Gli id a cui gli attributi di `element` rimandano, come li legge S014:
/// ogni `url(#id)` degli attributi senza prefisso e `xlink`, anche fuori dal
/// formato, e l'`href` locale (`#id`) di un elemento SVG che non è un
/// collegamento, dove `#id` è un'ancora.
pub(crate) fn references_of(element: &Element<'_>) -> Vec<String> {
    let mut out = Vec::new();
    for attr in &element.attrs {
        if attr.ns != NS_NONE && attr.ns != NS_XLINK {
            continue;
        }
        if attr.local != "href" {
            out.extend(url_ids(&attr.value).into_iter().map(str::to_owned));
            continue;
        }
        if element.ns == NS_SVG && element.local != "a" {
            out.extend(href_id(&attr.value));
        }
    }
    out
}

/// Gli id a cui rimanda `element` con ciò che contiene, una volta ciascuno.
fn references_within(doc: &Document<'_>, element: &Element<'_>) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut stack = vec![element];
    while let Some(at) = stack.pop() {
        out.extend(references_of(at));
        stack.extend(
            at.children
                .iter()
                .rev()
                .filter_map(|&child| doc.element(child)),
        );
    }
    out
}

/// I simboli fra `candidates`, `symbol` con gli attributi di
/// [`symbol_allowed`]: quelli che non contengono sé stessi, nemmeno
/// attraverso altri candidati. Un id che `taken` dice già preso, o di un
/// candidato precedente, non è un simbolo. Restituisce gli id, in ordine.
///
/// Gli archi sono i riferimenti, `url(#id)` o `href="#id"`, che il contenuto
/// di un candidato fa ad altri candidati; un candidato su un ciclo, o che
/// rimanda a sé, non è un simbolo. Le componenti fortemente connesse si
/// cercano con Tarjan, senza ricorsione: una catena di simboli può essere
/// lunga quanto il file.
pub(super) fn acyclic_symbols(
    doc: &Document<'_>,
    candidates: &[&Element<'_>],
    taken: &dyn Fn(&str) -> bool,
) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut elements = Vec::new();
    for &element in candidates {
        if !symbol_allowed(element) {
            continue;
        }
        let id = element.value(NS_NONE, "id").expect("un simbolo ha un id");
        if taken(id) || index.contains_key(id) {
            continue;
        }
        index.insert(id.to_owned(), ids.len());
        ids.push(id.to_owned());
        elements.push(element);
    }
    let edges: Vec<Vec<usize>> = elements
        .iter()
        .map(|element| {
            references_within(doc, element)
                .iter()
                .filter_map(|reference| index.get(reference).copied())
                .collect()
        })
        .collect();
    let n = ids.len();
    let mut order = vec![usize::MAX; n];
    let mut low = vec![0; n];
    let mut on_stack = vec![false; n];
    let mut cyclic = vec![false; n];
    let mut stack = Vec::new();
    let mut counter = 0;
    for root in 0..n {
        if order[root] != usize::MAX {
            continue;
        }
        let mut frames = vec![(root, 0)];
        order[root] = counter;
        low[root] = counter;
        counter += 1;
        stack.push(root);
        on_stack[root] = true;
        while let Some(frame) = frames.last_mut() {
            let (node, next) = *frame;
            if next < edges[node].len() {
                frame.1 += 1;
                let to = edges[node][next];
                if to == node {
                    cyclic[node] = true;
                }
                if order[to] == usize::MAX {
                    order[to] = counter;
                    low[to] = counter;
                    counter += 1;
                    stack.push(to);
                    on_stack[to] = true;
                    frames.push((to, 0));
                } else if on_stack[to] {
                    low[node] = low[node].min(order[to]);
                }
                continue;
            }
            frames.pop();
            if let Some(&(parent, _)) = frames.last() {
                low[parent] = low[parent].min(low[node]);
            }
            if low[node] != order[node] {
                continue;
            }
            let mut component = Vec::new();
            loop {
                let member = stack.pop().expect("il nodo è sulla pila");
                on_stack[member] = false;
                component.push(member);
                if member == node {
                    break;
                }
            }
            if component.len() > 1 {
                for member in component {
                    cyclic[member] = true;
                }
            }
        }
    }
    ids.into_iter()
        .zip(cyclic)
        .filter_map(|(id, cyclic)| (!cyclic).then_some(id))
        .collect()
}
