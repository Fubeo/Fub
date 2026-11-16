// Chi ascolta `setting_changed` reagisce soltanto alle chiavi che legge.
//
// L'evento porta la chiave cambiata (`fub_abi::Event::SettingChanged`), e il
// backend ne manda uno per chiave: anche un cambio di profilo o un
// `settings.json` riscritto arrivano come tanti eventi, uno per chiave che ha
// cambiato valore. Rileggere tutto a ogni evento era il costo del gesto «barra
// laterale dal comando»: una scrittura di `chrome.sidebar.visible` rileggeva le
// impostazioni cinque volte e rimontava il tema.
//
// Un evento senza chiave non lo manda nessun emettitore di oggi; se arrivasse
// (un host vecchio, una ricarica intera) vuol dire «può essere cambiato tutto»,
// e chi ascolta rilegge: un cambio perso è peggio di una rilettura in più.

/// La chiave di un `setting_changed` riguarda chi legge le chiavi di `watches`?
/// Senza chiave sì, sempre.
export function settingTouches(key: string | null | undefined, watches: (key: string) => boolean): boolean {
  return typeof key !== "string" || key === "" || watches(key);
}
