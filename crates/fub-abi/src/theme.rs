use serde::{Deserialize, Serialize};

/// Versione congelata del contratto tra una pelle e la shell.
pub const THEME_ENGINE: &str = "theme-1";

/// La versione del contratto che un tema dichiara di implementare.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeEngine {
    #[serde(rename = "theme-1")]
    Theme1,
}

impl ThemeEngine {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Theme1 => THEME_ENGINE,
        }
    }
}

/// Una luce offerta dallo stesso tema.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeLight {
    Dark,
    Light,
}

/// Manifest versionato di un tema installabile.
///
/// `asset_namespace` è il prefisso esclusivo da cui il foglio può caricare
/// risorse: non è un path del filesystem e non concede accesso a URL esterni.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub engine: ThemeEngine,
    pub lights: Vec<ThemeLight>,
    pub asset_namespace: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_1_has_a_stable_wire_name() {
        assert_eq!(ThemeEngine::Theme1.as_str(), "theme-1");
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
        };

        assert_eq!(manifest.engine.as_str(), THEME_ENGINE);
        assert_eq!(manifest.lights, [ThemeLight::Dark, ThemeLight::Light]);
        assert_eq!(manifest.asset_namespace, "theme://fub.serie/");
    }
}
