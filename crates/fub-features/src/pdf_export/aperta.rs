//! Le scelte **aperte** del profilo e della memoria: un insieme di valori
//! conosciuti più quello che una versione più nuova di Fub avrà aggiunto.
//!
//! Un profilo è un file che si copia da un vault all'altro, e un Fub più
//! vecchio può aprirne uno scritto da un Fub più nuovo. Se un formato di pagina
//! nuovo (`"B5"`) rendesse illeggibile tutto il profilo, la persona perderebbe
//! ogni altra regolazione per una che questa versione non sa disegnare. Per
//! questo ogni scelta a elenco tiene il valore che non conosce in
//! [`Altro`](scelta_aperta), lo riscrive com'era e lascia a chi la usa la
//! decisione di ricadere sul valore di serie.

/// Dichiara un'enumerazione di valori scritti come testo nel JSON, con la
/// variante `Altro(String)` per un valore che questa versione non conosce.
///
/// Il primo valore elencato è quello di serie.
macro_rules! scelta_aperta {
    (
        $(#[$meta:meta])*
        pub enum $nome:ident {
            $( $(#[$vmeta:meta])* $var:ident => $testo:literal ),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum $nome {
            $( $(#[$vmeta])* $var, )+
            /// Un valore che questa versione non conosce: si conserva com'è e
            /// si riscrive uguale.
            Altro(String),
        }

        impl $nome {
            /// Ogni valore conosciuto, nell'ordine della dichiarazione.
            pub const CONOSCIUTI: &'static [$nome] = &[ $( $nome::$var ),+ ];

            /// Il testo con cui il valore sta nel file.
            pub fn come_testo(&self) -> &str {
                match self {
                    $( Self::$var => $testo, )+
                    Self::Altro(testo) => testo,
                }
            }

            /// Il valore di un testo letto dal file: mai un errore.
            pub fn da_testo(testo: &str) -> Self {
                match testo {
                    $( $testo => Self::$var, )+
                    altro => Self::Altro(altro.to_owned()),
                }
            }

            /// Se questa versione sa che cosa vuol dire.
            pub fn conosciuta(&self) -> bool {
                !matches!(self, Self::Altro(_))
            }
        }

        impl Default for $nome {
            fn default() -> Self {
                Self::CONOSCIUTI[0].clone()
            }
        }

        impl ::serde::Serialize for $nome {
            fn serialize<S: ::serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(self.come_testo())
            }
        }

        impl<'de> ::serde::Deserialize<'de> for $nome {
            fn deserialize<D: ::serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let testo = <::std::borrow::Cow<'de, str>>::deserialize(d)?;
                Ok(Self::da_testo(&testo))
            }
        }
    };
}

pub(crate) use scelta_aperta;
