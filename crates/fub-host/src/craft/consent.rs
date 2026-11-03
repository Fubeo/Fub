//! Il consenso alle anteprime fatte dalle app Craft: l'impostazione che dice se Fub le chiede, le fa o le lascia spente.
//!
//! Due letture per chi decide se un'app parte e se un file si legge intero:
//! [`current`] (`craft.cli-previews`) e [`max_bytes`]
//! (`craft.preview-max-mib`). Si rileggono a ogni domanda e non si tengono da
//! parte: un consenso o un peso cambiati valgono dalla domanda dopo. Le due
//! impostazioni dell'albero le legge la shell.
//!
//! Scrivere `craft.cli-previews` non passa di qui: la chiave non è
//! `program_writable`, quindi un plugin o un bundle che la scrivono ricevono
//! `PermissionDenied` dal kernel, e la scrive soltanto la persona
//! (`Host::set_setting_for_user`, dalla shell o dalla CLI).

use fub_abi::settings::SettingValue;
use fub_abi::traits::HostApi;
use fub_format_craft::RenderConsent;

use crate::settings::{
    CRAFT_CLI_PREVIEWS, CRAFT_CLI_PREVIEWS_ASK, CRAFT_CLI_PREVIEWS_OFF, CRAFT_CLI_PREVIEWS_ON,
    CRAFT_PREVIEW_MAX_MIB, CRAFT_PREVIEW_MAX_MIB_DEFAULT, CRAFT_PREVIEW_MAX_MIB_MAX,
    CRAFT_PREVIEW_MAX_MIB_MIN,
};

/// Un MiB in byte.
const MIB: f64 = 1024.0 * 1024.0;

/// Il valore di `craft.cli-previews` che vale adesso. [`RenderConsent::Ask`]
/// quando l'impostazione manca, non si legge, è di un'altra specie (il
/// vecchio interruttore) o non è una delle tre scelte: un dubbio non è mai
/// un sì.
pub fn current(host: &dyn HostApi) -> RenderConsent {
    match host.setting(CRAFT_CLI_PREVIEWS) {
        Ok(SettingValue::Text(value)) => of_value(&value),
        _ => RenderConsent::Ask,
    }
}

/// La scelta di un valore scritto: [`RenderConsent::Ask`] per tutto ciò che
/// non è `on` o `off`.
pub fn of_value(value: &str) -> RenderConsent {
    match value {
        CRAFT_CLI_PREVIEWS_ON => RenderConsent::On,
        CRAFT_CLI_PREVIEWS_OFF => RenderConsent::Off,
        _ => RenderConsent::Ask,
    }
}

/// Il valore che l'impostazione scrive per una scelta.
pub fn value_of(consent: RenderConsent) -> &'static str {
    match consent {
        RenderConsent::Ask => CRAFT_CLI_PREVIEWS_ASK,
        RenderConsent::On => CRAFT_CLI_PREVIEWS_ON,
        RenderConsent::Off => CRAFT_CLI_PREVIEWS_OFF,
    }
}

/// Il peso massimo, in byte, di un file che va letto intero per la sua
/// anteprima: i MiB di `craft.preview-max-mib` per 1024 × 1024. Un valore
/// fuori da 1–4096 si riporta dentro; uno che manca, non si legge o non è un
/// numero finito vale i 64 MiB di partenza.
pub fn max_bytes(host: &dyn HostApi) -> u64 {
    let mib = match host.setting(CRAFT_PREVIEW_MAX_MIB) {
        Ok(SettingValue::Number(mib)) if mib.is_finite() => {
            mib.clamp(CRAFT_PREVIEW_MAX_MIB_MIN, CRAFT_PREVIEW_MAX_MIB_MAX)
        }
        _ => CRAFT_PREVIEW_MAX_MIB_DEFAULT,
    };
    // Dentro 1–4096 il prodotto sta in un u64 senza perdite: al più 2^32.
    (mib * MIB) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::settings::{SettingKind, SettingSpec};
    use fub_sdk::testing::MemoryHost;

    fn spec(key: &str) -> SettingSpec {
        crate::settings::core_settings()
            .into_iter()
            .find(|spec| spec.key == key)
            .expect("la chiave è fra le impostazioni del core")
    }

    fn consent_with(value: Option<SettingValue>) -> RenderConsent {
        let host = match value {
            Some(value) => MemoryHost::new().with_value(spec(CRAFT_CLI_PREVIEWS), value),
            None => MemoryHost::new().with_setting(spec(CRAFT_CLI_PREVIEWS)),
        };
        current(&host)
    }

    fn bytes_with(value: Option<SettingValue>) -> u64 {
        let host = match value {
            Some(value) => MemoryHost::new().with_value(spec(CRAFT_PREVIEW_MAX_MIB), value),
            None => MemoryHost::new().with_setting(spec(CRAFT_PREVIEW_MAX_MIB)),
        };
        max_bytes(&host)
    }

    fn text(value: &str) -> Option<SettingValue> {
        Some(SettingValue::Text(value.into()))
    }

    #[test]
    fn the_consent_reads_each_value_and_doubts_are_ask() {
        assert_eq!(consent_with(None), RenderConsent::Ask, "di partenza");
        assert_eq!(consent_with(text("ask")), RenderConsent::Ask);
        assert_eq!(consent_with(text("on")), RenderConsent::On);
        assert_eq!(consent_with(text("off")), RenderConsent::Off);
        assert_eq!(consent_with(text("forse")), RenderConsent::Ask);
        assert_eq!(
            consent_with(text("ON")),
            RenderConsent::Ask,
            "il caso conta"
        );
        assert_eq!(consent_with(text("")), RenderConsent::Ask);
        assert_eq!(
            consent_with(Some(SettingValue::Toggle(true))),
            RenderConsent::Ask,
            "il vecchio interruttore acceso non è un sì"
        );
        assert_eq!(
            consent_with(Some(SettingValue::Toggle(false))),
            RenderConsent::Ask
        );
        assert_eq!(
            consent_with(Some(SettingValue::Number(1.0))),
            RenderConsent::Ask
        );
        // Nessuno l'ha dichiarata: si chiede.
        assert_eq!(current(&MemoryHost::new()), RenderConsent::Ask);
    }

    /// Le scelte dell'impostazione e il contratto delle anteprime dicono la
    /// stessa parola, nello stesso ordine.
    #[test]
    fn the_choices_are_the_contract_values_in_its_order() {
        let SettingKind::Choice { default, options } = spec(CRAFT_CLI_PREVIEWS).kind else {
            panic!("craft.cli-previews è una scelta");
        };
        assert_eq!(default, CRAFT_CLI_PREVIEWS_ASK);
        let values: Vec<String> = options.iter().map(|option| option.value.clone()).collect();
        let contract: Vec<String> = RenderConsent::ALL
            .iter()
            .map(|consent| {
                serde_json::to_value(consent)
                    .expect("il consenso si serializza")
                    .as_str()
                    .expect("come una parola")
                    .to_string()
            })
            .collect();
        assert_eq!(values, contract);
        for consent in RenderConsent::ALL {
            assert_eq!(of_value(value_of(consent)), consent);
        }
    }

    #[test]
    fn the_limit_is_in_mib_and_brought_back_inside() {
        const M: u64 = 1024 * 1024;
        let number = |n: f64| Some(SettingValue::Number(n));
        assert_eq!(bytes_with(None), 64 * M, "di partenza");
        assert_eq!(bytes_with(number(1.0)), M);
        assert_eq!(bytes_with(number(64.0)), 64 * M);
        assert_eq!(bytes_with(number(4096.0)), 4096 * M);
        assert_eq!(bytes_with(number(0.5)), M, "sotto 1 vale 1");
        assert_eq!(bytes_with(number(0.0)), M);
        assert_eq!(bytes_with(number(-3.0)), M);
        assert_eq!(bytes_with(number(5000.0)), 4096 * M);
        assert_eq!(bytes_with(number(f64::NAN)), 64 * M);
        assert_eq!(bytes_with(number(f64::INFINITY)), 64 * M);
        assert_eq!(bytes_with(text("128")), 64 * M, "un testo non è un numero");
        assert_eq!(bytes_with(Some(SettingValue::Toggle(true))), 64 * M);
        assert_eq!(
            max_bytes(&MemoryHost::new()),
            64 * M,
            "nessuno l'ha dichiarata"
        );
    }
}
