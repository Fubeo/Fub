//! Il sorgente Rust letto **una volta sola**, per due proiezioni (decisione 0053).
//!
//! Il contratto ha una sorgente — i tipi Rust di `fub-abi` — e due confini a
//! valle, che **non hanno la stessa forma**: il WIT (component model, M5) e il
//! JSON di serde (l'IPC verso la webview, oggi). Nessuno dei due si genera
//! dall'altro; tutti e due si derivano da qui.
//!
//! Questo modulo è il **lettore** condiviso: legge la dichiarazione di un enum
//! dal sorgente con `syn` e ne restituisce i casi **nell'ordine in cui sono
//! scritti** — che è il discriminante ABI, e la sola cosa che né il compilatore
//! né serde garantiscono. Sopra ci stanno due proiettori, uno per confine:
//!
//! - [`kebab`] → il WIT, usato da `wit_conformance.rs`;
//! - [`snake`] → il JSON di serde (`rename_all = "snake_case"`), usato da
//!   `ts_enums.rs` per emettere le union del mirror TypeScript.
//!
//! Prima della 0053 l'elenco dei casi si scriveva a mano in tutte e due le sedi
//! e `rust_enum_order` lo **ricalcolava** per confrontarcelo: l'elenco a mano
//! non era la verità, era una seconda occasione di sbagliare. Adesso la verità
//! si legge una volta e si proietta due.

#![allow(dead_code)] // ogni binario di test ne usa una parte

use std::path::PathBuf;

/// Un enum del contratto, come sta scritto nel sorgente.
pub struct RustEnum {
    /// Nome del file sotto `src/`, per i messaggi d'errore.
    pub file: String,
    pub name: String,
    /// I nomi dei casi in `CamelCase`, **nell'ordine di dichiarazione**.
    pub variants: Vec<String>,
    /// Nessun caso porta un payload: è una union di stringhe al confine JSON.
    pub fieldless: bool,
}

fn src_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/src"))
}

fn parse(file: &str) -> syn::File {
    let path = src_dir().join(file);
    let src = std::fs::read_to_string(&path)
        .unwrap_or_else(|and| panic!("cannot read {}: {and}", path.display()));
    syn::parse_file(&src).unwrap_or_else(|and| panic!("{} failed to parse: {and}", path.display()))
}

fn convert(file: &str, and: &syn::ItemEnum) -> RustEnum {
    RustEnum {
        file: file.to_string(),
        name: and.ident.to_string(),
        variants: and.variants.iter().map(|v| v.ident.to_string()).collect(),
        fieldless: and
            .variants
            .iter()
            .all(|v| matches!(v.fields, syn::Fields::Unit)),
    }
}

/// Un enum nominato, letto dal suo file. Panica se non c'è: un rimando a un
/// tipo che non esiste più non deve poter passare per verde.
pub fn read_enum(file: &str, name: &str) -> RustEnum {
    for item in parse(file).items {
        if let syn::Item::Enum(and) = item {
            if and.ident == name {
                return convert(file, &and);
            }
        }
    }
    panic!("enum `{name}` not found among top-level items in src/{file}");
}

/// **Tutti** gli enum senza payload dichiarati in `src/*.rs`, in ordine
/// deterministico (file, poi dichiarazione).
///
/// È un elenco *per costruzione* e non a memoria — il criterio del
/// [§16.7](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md): un enum
/// nuovo entra qui senza che nessuno se ne ricordi, e ciò che ne dipende
/// diventa rosso da solo. Un elenco scritto a mano avrebbe smesso di coprire in
/// silenzio, che è esattamente il difetto per cui questo modulo esiste.
pub fn fieldless_enums() -> Vec<RustEnum> {
    let mut files: Vec<String> = std::fs::read_dir(src_dir())
        .expect("src/ is readable")
        .filter_map(|and| {
            let name = and.ok()?.file_name().to_string_lossy().into_owned();
            name.ends_with(".rs").then_some(name)
        })
        .collect();
    files.sort();

    let mut out = Vec::new();
    for file in files {
        let ast = parse(&file);
        for item in ast.items {
            let syn::Item::Enum(and) = item else { continue };
            if !matches!(and.vis, syn::Visibility::Public(_)) {
                continue;
            }
            let found = convert(&file, &and);
            if !found.fieldless {
                continue;
            }
            // La regola di rappresentazione non si indovina: un enum senza
            // payload che non la dichiara verrebbe proiettato in `CamelCase`
            // sul JSON e nessuno lo saprebbe finché la shell non sbaglia un
            // confronto di stringhe.
            assert!(
                has_snake_case(&and),
                "`{}` (src/{file}) is a fieldless enum and does not declare \
                 `#[serde(rename_all = \"snake_case\")]`: at the JSON boundary \
                 it would be CamelCase, and the TS mirror would say it differently",
                found.name
            );
            out.push(found);
        }
    }
    out
}

fn has_snake_case(and: &syn::ItemEnum) -> bool {
    and.attrs.iter().any(|a| {
        if !a.path().is_ident("serde") {
            return false;
        }
        let mut found = false;
        // L'errore si ignora di proposito: un `#[serde(...)]` che questo
        // lettore non sa scomporre non è un enum senza `rename_all`, è un caso
        // che l'assert qui sopra segnalerà con il nome del tipo.
        let _ = a.parse_nested_meta(|metadata| {
            if metadata.path.is_ident("rename_all") {
                let value: syn::LitStr = metadata.value()?.parse()?;
                found |= value.value() == "snake_case";
            } else if metadata.input.peek(syn::Token![=]) {
                let _: syn::Expr = metadata.value()?.parse()?;
            }
            Ok(())
        });
        found
    })
}

/// Le parole di un identificatore `CamelCase`. `H23` → `["h23"]`,
/// `LeftSidebar` → `["left", "sidebar"]`.
fn words(camel: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (the, c) in camel.chars().enumerate() {
        if c.is_uppercase() && the > 0 {
            out.push(String::new());
        }
        match out.last_mut() {
            Some(w) => w.extend(c.to_lowercase()),
            None => out.push(c.to_lowercase().collect()),
        }
    }
    out
}

/// `CodeBlock` → `code-block`: la convenzione di nome del **WIT**.
pub fn kebab(camel: &str) -> String {
    words(camel).join("-")
}

/// `DryRun` → `dry_run`: la convenzione di **serde** (`rename_all =
/// "snake_case"`), cioè ciò che attraversa davvero l'IPC.
pub fn snake(camel: &str) -> String {
    words(camel).join("_")
}
