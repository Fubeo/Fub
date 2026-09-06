//! Solo fixture negativa: i corpi non devono mai essere eseguiti.
#[cfg(feature = "format")]
wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:provider-probe/probe-format",
    generate_all,
    stubs,
});
#[cfg(feature = "index")]
wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:provider-probe/probe-index",
    generate_all,
    stubs,
});
#[cfg(feature = "events")]
wit_bindgen::generate!({
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:provider-probe/probe-events",
    generate_all,
    stubs,
});
