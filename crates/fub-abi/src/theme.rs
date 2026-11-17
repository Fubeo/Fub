use serde::{Deserialize, Serialize};

use crate::settings::SettingKind;

/// Versione congelata del contratto tra una pelle e la shell.
pub const THEME_ENGINE: &str = "theme-1";

/// Il secondo contratto fra una pelle e la shell: un'altra anatomia e un altro
/// vocabolario, non una revisione del primo. `theme-1` resta com'è.
pub const THEME_ENGINE_2: &str = "theme-2";

/// Quante impostazioni un tema può dichiarare al massimo.
pub const MAX_THEME_SETTINGS: usize = 32;

/// Quanti caratteri (voci di `fonts`) un tema può portare al massimo.
pub const MAX_THEME_FONTS: usize = 8;
/// Quanto può pesare il file di un carattere del tema.
pub const MAX_THEME_FONT_BYTES: u64 = 2 * 1024 * 1024;
/// Quanto possono pesare, insieme, i file dei caratteri di un tema.
pub const MAX_THEME_FONT_TOTAL_BYTES: u64 = 6 * 1024 * 1024;
/// Quanto può essere lungo il nome di una famiglia di caratteri del tema.
pub const MAX_THEME_FONT_FAMILY: usize = 64;

/// Quante icone (nomi) il set di un tema può ridisegnare al massimo.
pub const MAX_THEME_ICONS: usize = 512;
/// Quanti tracciati (`d`) può avere un'icona del tema.
pub const MAX_THEME_ICON_PATHS: usize = 8;
/// Quanto possono pesare, insieme, i tracciati di un'icona del tema.
pub const MAX_THEME_ICON_BYTES: usize = 4 * 1024;
/// Quanto può pesare il file del set di icone di un tema.
pub const MAX_THEME_ICONS_BYTES: u64 = 256 * 1024;

/// La versione del contratto che un tema dichiara di implementare.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeEngine {
    #[serde(rename = "theme-1")]
    Theme1,
    #[serde(rename = "theme-2")]
    Theme2,
}

impl ThemeEngine {
    /// Ogni motore che questo contratto conosce, dal più vecchio.
    pub const ALL: [ThemeEngine; 2] = [Self::Theme1, Self::Theme2];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Theme1 => THEME_ENGINE,
            Self::Theme2 => THEME_ENGINE_2,
        }
    }

    /// Il motore con questo nome, se è uno di quelli conosciuti.
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|engine| engine.as_str() == name)
    }
}

/// Una luce offerta dallo stesso tema.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeLight {
    Dark,
    Light,
}
/// Una proprietà CSS il cui moto è dichiarato dal tema.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMotion {
    Opacity,
    Transform,
}

/// Un'impostazione che un tema dichiara per sé: una scelta che il suo autore
/// lascia a chi lo usa.
///
/// Porta solo ciò che l'autore decide. Chiave qualificata, livello e gruppo li
/// mette l'host quando la dichiara al registro delle impostazioni: un tema non
/// può nominare una chiave fuori dal proprio id né scegliere dove vive il
/// valore.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThemeSetting {
    /// Il nome dentro il tema. La pelle lo ritrova sulla radice del documento
    /// (vedi la guida dell'autore), quindi è un identificatore e non prosa.
    pub name: String,
    /// Come si chiama per un umano. È prosa e non una chiave: un tema non ha
    /// un catalogo di stringhe.
    pub label: String,
    /// Cosa fa, in prosa. Può mancare.
    #[serde(default)]
    pub description: String,
    /// La specie, col suo default dentro: la stessa delle impostazioni dei
    /// componenti. Un tema ne usa tre — interruttore, numero, scelta.
    pub kind: SettingKind,
}

/// Lo stile di un carattere del tema: il valore di `font-style` nella sua
/// regola `@font-face`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeFontStyle {
    Normal,
    Italic,
}

/// Un carattere che un tema porta con sé, da `theme-2`.
///
/// Il tema non scrive `@font-face` (il CSS di un tema non può: un `src:`
/// scritto a mano potrebbe chiamare la rete). Dichiara qui la famiglia, il
/// file e i due assi, e la regola la scrive la shell, con l'URL `data:` del
/// file e nient'altro. La pelle usa poi la famiglia per nome.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeFont {
    /// Il nome con cui la pelle la chiama: lettere, cifre, spazi e `-`, al
    /// massimo [`MAX_THEME_FONT_FAMILY`] caratteri, diverso da ogni famiglia
    /// di serie.
    pub family: String,
    /// Il file, relativo alla cartella del tema: `fonts/<nome>.woff2`, cioè
    /// l'asset `theme://<id>/fonts/<nome>.woff2`. Solo WOFF2.
    pub file: String,
    /// Il peso, da 100 a 900.
    pub weight: u16,
    /// Lo stile: `normal` o `italic`.
    pub style: ThemeFontStyle,
}

/// Manifest versionato di un tema installabile.
///
/// `asset_namespace` è il prefisso esclusivo da cui il foglio può caricare
/// risorse: non è un path del filesystem e non concede accesso a URL esterni.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThemeManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub engine: ThemeEngine,
    pub lights: Vec<ThemeLight>,
    pub asset_namespace: String,
    /// `theme-1` originally omitted this field. Keep that wire form
    /// backwards-compatible while making the default explicit and stable.
    #[serde(default = "default_theme_motion")]
    pub motion: Vec<ThemeMotion>,
    /// Le impostazioni del tema, da `theme-2`. Un manifest che non ne ha non
    /// scrive il campo: la forma sul filo dei temi esistenti non cambia.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub settings: Vec<ThemeSetting>,
    /// Il tema da cui questo parte, da `theme-2`: porta solo ciò che cambia, e
    /// il resto (i fogli che mancano, la pelle) viene da lì. L'host accetta un
    /// solo valore, il tema di serie (`fub.serie`). Un manifest che non eredita
    /// non scrive il campo: la forma sul filo dei temi esistenti non cambia.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
    /// I caratteri che il tema porta, da `theme-2`: la shell ne scrive le
    /// regole `@font-face`. Un manifest che non ne porta non scrive il campo:
    /// la forma sul filo dei temi esistenti non cambia.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fonts: Vec<ThemeFont>,
    /// Il set di icone del tema, da `theme-2`: il nome di un asset JSON
    /// (`icons.json`) che ridisegna, per nome, le icone della shell. Un
    /// manifest che non ne porta non scrive il campo: la forma sul filo dei
    /// temi esistenti non cambia. La regola del file e delle voci sta in
    /// [`rules::theme_icons`](crate::rules::theme_icons).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icons: Option<String>,
}

fn default_theme_motion() -> Vec<ThemeMotion> {
    vec![ThemeMotion::Opacity, ThemeMotion::Transform]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_1_has_a_stable_wire_name() {
        assert_eq!(ThemeEngine::Theme1.as_str(), "theme-1");
    }

    #[test]
    fn every_engine_round_trips_through_its_wire_name() {
        for engine in ThemeEngine::ALL {
            assert_eq!(ThemeEngine::parse(engine.as_str()), Some(engine));
            let wire = serde_json::to_string(&engine).expect("engine");
            assert_eq!(wire, format!("\"{}\"", engine.as_str()));
        }
        assert_eq!(ThemeEngine::Theme2.as_str(), "theme-2");
        assert_eq!(ThemeEngine::parse("theme-3"), None);
    }

    #[test]
    fn a_manifest_without_settings_keeps_its_wire_form() {
        let raw = r#"{"id":"fub.serie","name":"Fub di serie","version":"1.0.0","engine":"theme-1","lights":["dark","light"],"asset_namespace":"theme://fub.serie/","motion":["opacity","transform"]}"#;
        let manifest: ThemeManifest = serde_json::from_str(raw).expect("manifest");
        assert!(manifest.settings.is_empty());
        assert_eq!(manifest.extends, None);
        assert!(manifest.fonts.is_empty());
        assert_eq!(manifest.icons, None);
        assert_eq!(serde_json::to_string(&manifest).expect("wire"), raw);
    }

    #[test]
    fn a_manifest_that_extends_names_its_base_on_the_wire() {
        let raw = r#"{"id":"com.acme.carta","name":"Carta","version":"1.0.0","engine":"theme-2","lights":["light"],"asset_namespace":"theme://com.acme.carta/","motion":["opacity","transform"],"extends":"fub.serie"}"#;
        let manifest: ThemeManifest = serde_json::from_str(raw).expect("manifest");
        assert_eq!(manifest.extends.as_deref(), Some("fub.serie"));
        assert_eq!(serde_json::to_string(&manifest).expect("wire"), raw);
    }

    #[test]
    fn a_manifest_with_fonts_names_them_on_the_wire() {
        let raw = r#"{"id":"com.acme.carta","name":"Carta","version":"1.0.0","engine":"theme-2","lights":["light"],"asset_namespace":"theme://com.acme.carta/","motion":["opacity","transform"],"extends":"fub.serie","fonts":[{"family":"Carta Serif","file":"fonts/carta.woff2","weight":400,"style":"normal"},{"family":"Carta Serif","file":"fonts/carta-italic.woff2","weight":400,"style":"italic"}]}"#;
        let manifest: ThemeManifest = serde_json::from_str(raw).expect("manifest");
        assert_eq!(manifest.fonts.len(), 2);
        assert_eq!(manifest.fonts[0].family, "Carta Serif");
        assert_eq!(manifest.fonts[1].style, ThemeFontStyle::Italic);
        assert_eq!(serde_json::to_string(&manifest).expect("wire"), raw);
    }

    #[test]
    fn a_manifest_with_icons_names_the_set_on_the_wire() {
        let raw = r#"{"id":"com.acme.carta","name":"Carta","version":"1.0.0","engine":"theme-2","lights":["light"],"asset_namespace":"theme://com.acme.carta/","motion":["opacity","transform"],"extends":"fub.serie","icons":"icons.json"}"#;
        let manifest: ThemeManifest = serde_json::from_str(raw).expect("manifest");
        assert_eq!(manifest.icons.as_deref(), Some("icons.json"));
        assert_eq!(serde_json::to_string(&manifest).expect("wire"), raw);
    }

    #[test]
    fn a_theme_2_manifest_declares_its_settings() {
        let raw = r#"{
            "id": "com.acme.notte",
            "name": "Notte",
            "version": "1.0.0",
            "engine": "theme-2",
            "lights": ["dark"],
            "asset_namespace": "theme://com.acme.notte/",
            "settings": [
                { "name": "bordi", "label": "Bordi", "kind": { "kind": "toggle", "default": true } },
                {
                    "name": "trama",
                    "label": "Trama",
                    "description": "La grana della scrivania.",
                    "kind": {
                        "kind": "choice",
                        "default": "fine",
                        "options": [
                            { "value": "fine", "label": "Fine" },
                            { "value": "grossa", "label": "Grossa" }
                        ]
                    }
                }
            ]
        }"#;
        let manifest: ThemeManifest = serde_json::from_str(raw).expect("theme-2 manifest");
        assert_eq!(manifest.engine, ThemeEngine::Theme2);
        assert_eq!(manifest.settings.len(), 2);
        assert_eq!(manifest.settings[0].name, "bordi");
        assert_eq!(manifest.settings[0].description, "");
        assert_eq!(
            manifest.settings[1].kind.default_value(),
            crate::settings::SettingValue::Text("fine".into())
        );
        let again: ThemeManifest =
            serde_json::from_str(&serde_json::to_string(&manifest).expect("wire")).expect("back");
        assert_eq!(again, manifest);
    }

    #[test]
    fn manifest_names_every_theme_boundary_value() {
        let manifest = ThemeManifest {
            id: "fub.serie".into(),
            name: "Fub di serie".into(),
            version: "1.0.0".into(),
            engine: ThemeEngine::Theme1,
            lights: vec![ThemeLight::Dark, ThemeLight::Light],
            asset_namespace: "theme://fub.serie/".into(),
            motion: vec![ThemeMotion::Opacity, ThemeMotion::Transform],
            settings: Vec::new(),
            extends: None,
            fonts: Vec::new(),
            icons: None,
        };

        assert_eq!(manifest.engine.as_str(), THEME_ENGINE);
        assert_eq!(manifest.lights, [ThemeLight::Dark, ThemeLight::Light]);
        assert_eq!(manifest.asset_namespace, "theme://fub.serie/");
        assert_eq!(
            manifest.motion,
            [ThemeMotion::Opacity, ThemeMotion::Transform]
        );
    }

    #[test]
    fn legacy_theme_1_manifest_defaults_motion_exactly() {
        let raw = r#"{
            "id": "fub.serie",
            "name": "Fub di serie",
            "version": "1.0.0",
            "engine": "theme-1",
            "lights": ["dark", "light"],
            "asset_namespace": "theme://fub.serie/"
        }"#;
        let manifest: ThemeManifest = serde_json::from_str(raw).expect("legacy manifest");
        assert_eq!(
            manifest.motion,
            [ThemeMotion::Opacity, ThemeMotion::Transform]
        );
    }
}
