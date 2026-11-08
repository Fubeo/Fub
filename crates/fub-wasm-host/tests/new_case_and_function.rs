//! Un caso nuovo e una funzione nuova in un'interfaccia esportata (#289).
//!
//! Stesso giro di `published_record_does_not_grow.rs`: un guest compilato
//! contro la WIT di prima, un host con la WIT cresciuta. Il risultato è scritto
//! com'è, e `docs/reference/abi-and-wit.md` lo riporta in «Compatibilità».
//!
//! # Due banchi
//!
//! - **Il contratto vero.** `esempi/plugin-prima-del-caso` e
//!   `esempi/plugin-prima-della-funzione` esportano `fub:abi/plugin@0.2.0` da
//!   una copia ferma di `wit/frozen/0.2.0.wit` con una sola differenza: il
//!   primo non ha `data`, l'ultimo caso dell'`enum component-kind`; il
//!   secondo non ha `run-job`, l'ultima funzione dell'interfaccia. Li carica
//!   `WasmBundle`, cioè l'host di Fub così com'è.
//! - **Una cosa alla volta.** `esempi/servizio-prima` esporta un'interfaccia
//!   piccola, `esempio:servizio/servizio@0.1.0`, con un `enum`, un `variant` e
//!   due funzioni. Qui l'host la fa crescere con `bindgen!` (il meccanismo con
//!   cui l'host di Fub controlla i suoi export) in tre modi distinti, più un
//!   host uguale al guest che prova che il guest funziona: un rifiuto allora
//!   è della crescita, non di un guasto del componente. Lo stesso banco manda
//!   al guest vecchio il caso nuovo per la via dinamica, l'unica che arriva a
//!   chiamarlo.
//!
//! # Il risultato
//!
//! Nel component model di wasmtime il tipo di un'interfaccia esportata si
//! controlla per intero quando l'host la lega: un `enum` o un `variant` deve
//! avere esattamente i casi attesi, nello stesso ordine, e ogni funzione che
//! l'host conosce deve esserci. Un caso nuovo in coda, o una funzione nuova,
//! **non** sono additivi per un plugin già compilato: l'host non lo istanzia.
//! Il caso nuovo non arriva mai al guest vecchio: un host tipizzato non lo
//! carica, e la via dinamica lo rifiuta con un errore tipizzato, non con una
//! trap. Quell'errore però chiude l'istanza: la chiamata dopo è una trap
//! «cannot enter component instance».
//!
//! Se uno di questi test diventa verde nel senso opposto, cioè il guest si
//! carica, la regola di «Compatibilità» va riletta prima del test.

mod common;

use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;
use wasmtime::component::{Component, Func, Linker, Val};
use wasmtime::{Engine, Store};

/// L'interfaccia del guest com'è, in ogni host di questo file: il pacchetto e
/// il nome dell'export sono quelli che il guest ha compilato.
const EXPORT: &str = "esempio:servizio/servizio@0.1.0";

/// L'host che vede l'interfaccia com'era: la prova che il guest funziona.
mod uguale {
    wasmtime::component::bindgen!({
        inline: "
            package esempio:servizio@0.1.0;

            interface servizio {
                enum colore { rosso, verde }
                variant forma { punto, cerchio(u32) }

                eco-colore: func(colore: colore) -> colore;
                descrivi: func(forma: forma) -> string;
            }

            world uguale {
                export servizio;
            }
        ",
        world: "uguale",
    });
}

/// L'host con un colore in più, in coda all'`enum`.
mod enum_cresciuto {
    wasmtime::component::bindgen!({
        inline: "
            package esempio:servizio@0.1.0;

            interface servizio {
                enum colore { rosso, verde, blu }
                variant forma { punto, cerchio(u32) }

                eco-colore: func(colore: colore) -> colore;
                descrivi: func(forma: forma) -> string;
            }

            world enum-cresciuto {
                export servizio;
            }
        ",
        world: "enum-cresciuto",
    });
}

/// L'host con una forma in più, in coda al `variant`.
mod variante_cresciuta {
    wasmtime::component::bindgen!({
        inline: "
            package esempio:servizio@0.1.0;

            interface servizio {
                enum colore { rosso, verde }
                variant forma { punto, cerchio(u32), quadrato(u32) }

                eco-colore: func(colore: colore) -> colore;
                descrivi: func(forma: forma) -> string;
            }

            world variante-cresciuta {
                export servizio;
            }
        ",
        world: "variante-cresciuta",
    });
}

/// L'host con una funzione in più, in coda all'interfaccia.
mod funzione_nuova {
    wasmtime::component::bindgen!({
        inline: "
            package esempio:servizio@0.1.0;

            interface servizio {
                enum colore { rosso, verde }
                variant forma { punto, cerchio(u32) }

                eco-colore: func(colore: colore) -> colore;
                descrivi: func(forma: forma) -> string;
                conta: func() -> u32;
            }

            world funzione-nuova {
                export servizio;
            }
        ",
        world: "funzione-nuova",
    });
}

/// Il guest di prima, compilato adesso, con un linker che non gli dà niente.
///
/// Il componente di `wasm32-wasip2` porta con sé gli import di WASI della std
/// di Rust; il guest non li chiama, e un import che diventa una trap basta a
/// istanziarlo. La compilazione passa dal banco comune: se il componente non
/// si compila il test fallisce e lo dice, non salta.
fn guest_di_prima() -> (Engine, Component, Linker<()>) {
    let wasm = common::component("servizio-prima", "servizio_prima", "");
    let engine = Engine::default();
    let component = Component::from_file(&engine, wasm.as_std_path())
        .expect("il guest di prima è un componente valido");
    let mut linker = Linker::new(&engine);
    linker
        .define_unknown_imports_as_traps(&component)
        .expect("gli import di WASI diventano trap");
    (engine, component, linker)
}

#[test]
fn the_old_guest_works_with_a_host_that_sees_the_same_interface() {
    let (engine, component, linker) = guest_di_prima();
    let mut store = Store::new(&engine, ());
    let host = uguale::Uguale::instantiate(&mut store, &component, &linker)
        .expect("l'host uguale istanzia il guest di prima");
    let servizio = host.esempio_servizio_servizio();
    use uguale::exports::esempio::servizio::servizio::{Colore, Forma};

    let colore = servizio
        .call_eco_colore(&mut store, Colore::Verde)
        .expect("eco-colore risponde");
    assert_eq!(colore, Colore::Verde);
    let forma = servizio
        .call_descrivi(&mut store, Forma::Cerchio(3))
        .expect("descrivi risponde");
    assert_eq!(forma, "cerchio di raggio 3");
}

#[test]
fn a_new_enum_case_refuses_the_old_guest() {
    let (engine, component, linker) = guest_di_prima();
    let mut store = Store::new(&engine, ());
    let error =
        enum_cresciuto::EnumCresciuto::instantiate(&mut store, &component, &linker)
            .err()
            .expect("un colore in più nell'host e il guest di prima non si istanzia");
    let message = format!("{error:#}");
    assert!(
        message.contains("expected enum of 3 names, found 2 names"),
        "il rifiuto nomina l'enum cresciuto, non un altro guasto: {message}"
    );
}

#[test]
fn a_new_variant_case_refuses_the_old_guest() {
    let (engine, component, linker) = guest_di_prima();
    let mut store = Store::new(&engine, ());
    let error = variante_cresciuta::VarianteCresciuta::instantiate(
        &mut store, &component, &linker,
    )
    .err()
    .expect("una forma in più nell'host e il guest di prima non si istanzia");
    let message = format!("{error:#}");
    assert!(
        message.contains("expected variant of 3 cases, found 2 cases"),
        "il rifiuto nomina il variant cresciuto, non un altro guasto: {message}"
    );
}

#[test]
fn a_new_function_refuses_the_old_guest() {
    let (engine, component, linker) = guest_di_prima();
    let mut store = Store::new(&engine, ());
    let error =
        funzione_nuova::FunzioneNuova::instantiate(&mut store, &component, &linker)
            .err()
            .expect("una funzione in più nell'host e il guest di prima non si istanzia");
    let message = format!("{error:#}");
    assert!(
        message.contains("conta"),
        "il rifiuto nomina la funzione che manca, non un altro guasto: {message}"
    );
}

/// Una funzione esportata del guest di prima, presa per la via dinamica da
/// un'istanza nuova.
fn funzione_dinamica(name: &str) -> (Store<()>, Func) {
    let (engine, component, linker) = guest_di_prima();
    let mut store = Store::new(&engine, ());
    let instance = linker
        .instantiate(&mut store, &component)
        .expect("il guest di prima si istanzia");
    let interface = component
        .get_export_index(None, EXPORT)
        .expect("il guest esporta l'interfaccia");
    let index = component
        .get_export_index(Some(&interface), name)
        .unwrap_or_else(|| panic!("il guest esporta `{name}`"));
    let func = instance
        .get_func(&mut store, index)
        .unwrap_or_else(|| panic!("`{name}` è una funzione"));
    (store, func)
}

/// Il rifiuto di un caso che il guest non conosce: un errore, non una trap,
/// e nomina il caso.
fn assert_typed_refusal(error: &wasmtime::Error, case: &str) {
    assert!(
        error.downcast_ref::<wasmtime::Trap>().is_none(),
        "il caso nuovo è un errore, non una trap: {error:#}"
    );
    let message = format!("{error:#}");
    assert!(
        message.contains(case),
        "l'errore nomina il caso che il guest non conosce: {message}"
    );
}

/// Il caso nuovo mandato al guest vecchio per la via dinamica.
///
/// Un host tipizzato non ci arriva (i test qui sopra), e quello di Fub è
/// tipizzato. Per la via dinamica, `Func::call` con un `Val`, il valore si
/// abbassa secondo il tipo del guest: un nome che il guest non conosce è un
/// errore restituito all'host, non una trap. Vale per l'`enum` e per il
/// `variant`.
#[test]
fn the_new_case_sent_dynamically_is_a_typed_error_and_not_a_trap() {
    let mut results = [Val::Bool(false)];

    let (mut store, eco) = funzione_dinamica("eco-colore");
    let error = eco
        .call(&mut store, &[Val::Enum("blu".to_string())], &mut results)
        .expect_err("un colore che il guest non conosce non si abbassa");
    assert_typed_refusal(&error, "blu");

    let (mut store, descrivi) = funzione_dinamica("descrivi");
    let quadrato = Val::Variant("quadrato".to_string(), Some(Box::new(Val::U32(2))));
    let error = descrivi
        .call(&mut store, &[quadrato], &mut results)
        .expect_err("una forma che il guest non conosce non si abbassa");
    assert_typed_refusal(&error, "quadrato");
}

/// Dopo quel rifiuto l'istanza non si rientra più.
///
/// wasmtime chiude l'ingresso dell'istanza prima di abbassare gli argomenti, e
/// l'errore di abbassamento non lo riapre: la chiamata dopo, anche con un caso
/// che il guest conosce, è una trap «cannot enter component instance». Per un
/// host dinamico il caso nuovo costa l'istanza intera, non solo la chiamata.
#[test]
fn after_the_new_case_the_dynamic_instance_cannot_be_entered_again() {
    let mut results = [Val::Bool(false)];
    let (mut store, eco) = funzione_dinamica("eco-colore");
    eco.call(&mut store, &[Val::Enum("blu".to_string())], &mut results)
        .expect_err("un colore che il guest non conosce non si abbassa");

    let error = eco
        .call(&mut store, &[Val::Enum("verde".to_string())], &mut results)
        .expect_err("dopo il rifiuto l'istanza non si rientra");
    assert!(
        error.downcast_ref::<wasmtime::Trap>().is_some(),
        "il rientro è una trap: {error:#}"
    );
    let message = format!("{error:#}");
    assert!(
        message.contains("cannot enter component instance"),
        "la trap è quella dell'ingresso chiuso, non un altro guasto: {message}"
    );
}

/// La stessa via dinamica, senza il caso nuovo, risponde a più chiamate di
/// fila: la trap qui sopra viene dal rifiuto, non dalla via dinamica.
#[test]
fn the_dynamic_instance_answers_twice_without_the_new_case() {
    let mut results = [Val::Bool(false)];
    let (mut store, eco) = funzione_dinamica("eco-colore");
    for colore in ["rosso", "verde"] {
        eco.call(&mut store, &[Val::Enum(colore.to_string())], &mut results)
            .expect("un colore che il guest conosce passa");
        eco.post_return(&mut store).expect("il ritorno si chiude");
        assert_eq!(results[0], Val::Enum(colore.to_string()));
    }
}

/// Il contratto vero: un `enum` di `fub:abi/plugin@0.2.0` con un caso in più
/// nell'host, davanti a un plugin compilato senza.
#[test]
fn a_plugin_built_before_the_last_component_kind_is_refused() {
    let wasm = common::component("plugin-prima-del-caso", "plugin_prima_del_caso", "");
    let error = WasmBundle::from_file(&wasm, Trust::Community)
        .expect_err("l'enum component-kind a tre casi non è più quello dell'host");
    let message = format!("{error:?} {error}");
    assert!(
        message.contains("expected enum of 4 names, found 3 names"),
        "il rifiuto nomina l'enum cresciuto, non un altro guasto: {message}"
    );
}

/// Il contratto vero: una funzione di `fub:abi/plugin@0.2.0` che l'host conosce
/// e il plugin, compilato prima, non esporta.
#[test]
fn a_plugin_built_before_run_job_is_refused() {
    let wasm = common::component(
        "plugin-prima-della-funzione",
        "plugin_prima_della_funzione",
        "",
    );
    let error = WasmBundle::from_file(&wasm, Trust::Community)
        .expect_err("l'interfaccia plugin senza run-job non è più quella dell'host");
    let message = format!("{error:?} {error}");
    assert!(
        message.contains("run-job"),
        "il rifiuto nomina la funzione che manca, non un altro guasto: {message}"
    );
}
