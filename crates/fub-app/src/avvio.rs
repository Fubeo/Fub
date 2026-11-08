//! Il fondo nativo delle finestre, prima che la webview disegni.
//!
//! Fra la creazione della finestra e il primo disegno della pagina si vede il
//! fondo della finestra, che di serie è bianco: con la luce scura è un lampo.
//! Qui si sceglie lo stesso `--bg` dei fogli di serie dello Scrittoio
//! (`apps/client/src/theme/scrittoio/sheet-*.css`) dalla luce e dal contrasto
//! di macchina; dal primo disegno in poi comanda la pagina (lo strato d'avvio
//! in linea, poi il tema vero). Un tema installato con un altro fondo si vede
//! solo da lì: la finestra non conosce i temi.
//!
//! Il test in fondo legge i quattro fogli e pretende gli stessi colori, così
//! un `--bg` cambiato in un foglio non lascia indietro la finestra.

use fub_abi::settings::SettingEntry;
use tauri::window::Color;
use tauri::{Runtime, Theme, WebviewWindow};

/// Il `--bg` dei fogli scuri (`sheet-dark.css`, `sheet-dark-high.css`).
const SCURO: Color = Color(0x0a, 0x0e, 0x16, 0xff);
/// Il `--bg` dei fogli chiari (`sheet-light.css`, `sheet-light-high.css`).
const CHIARO: Color = Color(0xe8, 0xed, 0xf5, 0xff);
/// Gli alti contrasti hanno oggi lo stesso fondo delle luci normali: restano
/// voci a sé perché il test li confronta foglio per foglio.
const SCURO_ALTO: Color = SCURO;
const CHIARO_ALTO: Color = CHIARO;

/// Il fondo per la scelta di luce (`appearance.theme`) e di contrasto
/// (`appearance.contrast`). La luce «come il sistema» (il valore vuoto, o
/// qualunque valore sconosciuto) chiede a `sistema`; se il sistema non
/// risponde vale lo scuro, come in `theme.ts`. Il vecchio tema `lime` era
/// scuro, come lo legge `theme.ts`.
///
/// Il contrasto «come il sistema» resta normale: da qui non si legge
/// `prefers-contrast`, e finché i fondi coincidono non cambia niente.
pub fn fondo(luce: &str, contrasto: &str, sistema: impl FnOnce() -> Option<Theme>) -> Color {
    let scura = match luce {
        "light" => false,
        "dark" | "lime" => true,
        _ => !matches!(sistema(), Some(Theme::Light)),
    };
    match (scura, contrasto == "high") {
        (true, false) => SCURO,
        (true, true) => SCURO_ALTO,
        (false, false) => CHIARO,
        (false, true) => CHIARO_ALTO,
    }
}

/// [`fondo`] con le impostazioni di macchina; il sistema lo dice `finestra`
/// (un errore vale come nessuna risposta).
pub fn fondo_di_macchina<R: Runtime>(
    machine: &[SettingEntry],
    finestra: &WebviewWindow<R>,
) -> Color {
    let testo = |key: &str| {
        machine
            .iter()
            .find(|entry| entry.spec.key == key)
            .and_then(|entry| entry.value.as_text())
            .unwrap_or(fub_kernel::locale::AS_SYSTEM)
    };
    fondo(
        testo(fub_host::settings::APPEARANCE_THEME),
        testo(fub_host::settings::APPEARANCE_CONTRAST),
        || finestra.theme().ok(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Il valore di `--bg:` in un foglio, come `#rrggbb`.
    fn bg(foglio: &str) -> Color {
        let riga = foglio
            .lines()
            .map(str::trim)
            .find(|riga| riga.starts_with("--bg:"))
            .expect("il foglio dichiara --bg");
        let valore = riga["--bg:".len()..].trim().trim_end_matches(';').trim();
        let hex = valore
            .strip_prefix('#')
            .filter(|hex| hex.len() == 6)
            .unwrap_or_else(|| panic!("--bg non è #rrggbb: {valore}"));
        let canale = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).expect("esadecimale");
        Color(canale(0), canale(2), canale(4), 0xff)
    }

    const FOGLI: &str = "apps/client/src/theme/scrittoio/";

    #[test]
    fn i_fondi_sono_quelli_dei_fogli() {
        let casi = [
            (
                "dark",
                "normal",
                include_str!("../../../apps/client/src/theme/scrittoio/sheet-dark.css"),
                "sheet-dark.css",
            ),
            (
                "light",
                "normal",
                include_str!("../../../apps/client/src/theme/scrittoio/sheet-light.css"),
                "sheet-light.css",
            ),
            (
                "dark",
                "high",
                include_str!("../../../apps/client/src/theme/scrittoio/sheet-dark-high.css"),
                "sheet-dark-high.css",
            ),
            (
                "light",
                "high",
                include_str!("../../../apps/client/src/theme/scrittoio/sheet-light-high.css"),
                "sheet-light-high.css",
            ),
        ];
        for (luce, contrasto, foglio, nome) in casi {
            assert_eq!(
                fondo(luce, contrasto, || None),
                bg(foglio),
                "il fondo nativo di {luce}/{contrasto} non è il --bg di {FOGLI}{nome}"
            );
        }
    }

    #[test]
    fn come_il_sistema_chiede_e_ripiega_sullo_scuro() {
        assert_eq!(fondo("", "", || Some(Theme::Light)), CHIARO);
        assert_eq!(fondo("", "", || Some(Theme::Dark)), SCURO);
        assert_eq!(fondo("", "", || None), SCURO);
        assert_eq!(fondo("sconosciuta", "normal", || None), SCURO);
    }

    #[test]
    fn una_scelta_esplicita_non_chiede_al_sistema() {
        let mai = || -> Option<Theme> { panic!("il sistema non va chiesto") };
        assert_eq!(fondo("light", "", mai), CHIARO);
        assert_eq!(fondo("dark", "high", mai), SCURO_ALTO);
        assert_eq!(fondo("lime", "", mai), SCURO);
    }
}
