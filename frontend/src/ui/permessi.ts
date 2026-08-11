// **I permessi, come li legge chi deve accettarli** (§23.17).
//
// Tre commit di fila hanno aggiunto un permesso al contratto — `fub:read-session`
// e `fub:read-selection` con la 0095, `fub:read-drafts` con la 0096,
// `fub:network` con la 0097 — e tutti e tre sono comparsi in `PluginInfo` da
// soli, cioè nel dato che l'inventario porta fin qui e che nessuna superficie
// rendeva leggibile. Questo modulo è la metà mancante di quelle quattro
// decisioni: finché non c'è, la parte «l'utente può vederla e negarla» del
// valore che i loro cancelli si attribuiscono è una promessa scoperta.
//
// # Perché la frase la scrive la shell
//
// Perché **chi chiede un permesso non deve scrivere la frase con cui lo si
// concede.** Se l'etichetta arrivasse dal manifest — o anche solo dal catalogo
// di stringhe del componente, che è dove finirebbe un `Text` di una
// `SettingSpec` (§12.1) — un componente potrebbe presentare `fub:read-drafts`
// come «migliora i suggerimenti», e sarebbe la sola riga di questa app in cui il
// testo che protegge l'utente lo scrive la parte da cui lo si protegge.
//
// Quindi ciò che attraversa il confine è un **identificatore** (la chiave del
// permesso, che il kernel mette come etichetta della `SettingSpec` fabbricata) e
// la frase sta qui, in un catalogo che è della shell, su un elenco chiuso.
// L'elenco è chiuso di là — `fub_abi::options::permission::ALL` — e i due si
// tengono allineati con un presidio per parte: di qua `permessi.test.ts`
// controlla che ogni voce abbia una frase, di là
// `crates/fub-host/tests/interruttori.rs`
// (`i_permessi_sono_gli_stessi_di_qua_e_di_la`) legge *questo file* e controlla
// che non ne manchi nessuna.
//
// # Cosa questo modulo non fa
//
// Non **restringe** un parametro. L'allowlist di `fub:network` si mostra e non
// si edita, e la ragione non è la fretta: in `Granted::new` un elenco vuoto
// significa *qualunque host* (è la regola uniforme di `OptionMap` — presente =
// acceso, il valore è il parametro), quindi una UI che lasciasse togliere gli
// host uno per uno trasformerebbe «nessuno» in «tutti» proprio al gesto in cui
// qualcuno sta cercando di chiudere. Restringere è una domanda seconda, ed è la
// stessa che la casella del §7.1 pone per i prefissi di path.
import type { BundleInfo, Trust } from "../host/contract";
import { t, type Chiave } from "../i18n/strings";

/// I permessi che questo host conosce, **in ordine di dichiarazione**: è lo
/// stesso ordine di `fub_abi::options::permission::ALL`, e non è alfabetico
/// perché l'ordine in cui si leggono è una scelta — il vault prima della
/// camera.
///
/// L'ordine conta anche per un'altra ragione, e vale la pena scriverla: un
/// elenco che cambia ordine fra un disegno e l'altro è un elenco in cui non si
/// ritrova la riga che si stava guardando.
export const PERMESSI = [
  "fub:read-vault",
  "fub:write-vault",
  "fub:network",
  "fub:read-clipboard",
  "fub:write-clipboard",
  "fub:camera",
  "fub:microphone",
  "fub:external-fs",
  "fub:run-command",
  "fub:call-service",
  "fub:write-settings",
  "fub:read-session",
  "fub:read-selection",
  "fub:read-drafts",
] as const;

export type Permesso = (typeof PERMESSI)[number];

/// La frase di ogni permesso, con la propria **chiave di catalogo scritta per
/// esteso** invece che composta da `` `permission.${nome}` ``.
///
/// È la regola che `strings.test.ts` pretende e che `REACH_KEYS` in
/// `ui/palette.ts` ha inaugurato: una chiave che si compone è una chiave che
/// nessun presidio sa cercare, e che quindi nessuno sa cancellare il giorno in
/// cui la riga sparisce. Qui paga due volte, perché queste quattordici frasi
/// sono insieme le più facili da lasciare marcire e le più gravi.
///
/// Che l'elenco dei nomi sia scritto **due** volte — qui e in [`PERMESSI`] — non
/// è un doppione che possa divergere: `Record<Permesso, Chiave>` non compila se
/// ne manca uno o se ce n'è uno di troppo. La prima porta l'ordine, la seconda
/// le frasi, e il compilatore tiene insieme le due.
export const FRASI: Record<Permesso, Chiave> = {
  "fub:read-vault": "permission.read-vault",
  "fub:write-vault": "permission.write-vault",
  "fub:network": "permission.network",
  "fub:read-clipboard": "permission.read-clipboard",
  "fub:write-clipboard": "permission.write-clipboard",
  "fub:camera": "permission.camera",
  "fub:microphone": "permission.microphone",
  "fub:external-fs": "permission.external-fs",
  "fub:run-command": "permission.run-command",
  "fub:call-service": "permission.call-service",
  "fub:write-settings": "permission.write-settings",
  "fub:read-session": "permission.read-session",
  "fub:read-selection": "permission.read-selection",
  "fub:read-drafts": "permission.read-drafts",
};

/// Di chi ci si sta fidando, come **chiave**: è la premessa con cui si leggono i
/// permessi, non una riga del loro elenco. Stessa regola della tabella qui
/// sopra, e lo stesso motivo per cui le tabelle stanno a livello di modulo e le
/// parole no — le chiavi non invecchiano, le parole cambiano con la lingua.
export const FIDUCIA: Record<Trust, Chiave> = {
  core: "trust.core",
  verified: "trust.verified",
  community: "trust.community",
  development: "trust.development",
  revoked: "trust.revoked",
};

/// La chiave d'impostazione con cui si nega un permesso a un componente.
///
/// È il gemello di `fub_abi::settings::permission_key`, e vale la stessa regola
/// dei nomi delle scorciatoie (§7.4): il componente entra nella **fessura del
/// namespace**, perché un nome di permesso è lo stesso per tutti e senza il
/// componente la chiave collide. A differenza di `keybindingKey`, qui **anche
/// una feature ufficiale nomina col proprio id**: la licenza del core di
/// nominare nudo esiste per le chiavi dell'applicazione, e un permesso è sempre
/// di esattamente un componente.
///
/// I due si provano sugli stessi casi, di qua in `permessi.test.ts` e di là in
/// `crates/fub-abi/src/settings.rs`.
export function permissionKey(pluginId: string, permesso: string): string {
  const i = permesso.indexOf(":");
  const nome = i < 0 ? permesso : permesso.slice(i + 1);
  return `${pluginId}:permissions.${nome}`;
}

/// Questa chiave d'impostazione è un permesso?
///
/// Serve alla scheda della configurazione, che deve **non** disegnarle: sono
/// impostazioni come le altre — stesso store, stessa provenienza, stesso
/// azzeramento — e proprio per questo comparirebbero in fondo al form come
/// settanta righe la cui etichetta è una chiave nuda. Le disegna la scheda dei
/// componenti, accanto a chi le ha chieste, che è l'unico posto in cui
/// significano qualcosa. È la stessa mossa con cui le scorciatoie escono dal
/// form (§18.2), e per la stessa ragione: riconoscere rifacendo il conto,
/// invece di leggere una convenzione sul prefisso.
///
/// È il gemello di `fub_abi::settings::permission_of_key`, ridotto alla domanda
/// che serve di qua.
export function isPermissionKey(chiave: string): boolean {
  const i = chiave.indexOf(":");
  if (i <= 0) return false;
  const nome = chiave.slice(i + 1);
  return nome.startsWith("permissions.") && nome.length > "permissions.".length;
}

/// Una riga da disegnare: cosa chiede il componente, e come si dice.
export interface RigaPermesso {
  /// La chiave del permesso (`fub:network`).
  permesso: string;
  /// La chiave d'impostazione con cui lo si nega.
  chiave: string;
  /// La frase che l'utente legge.
  frase: string;
  /// Il dettaglio del parametro, o `null` se non ne porta uno che si sappia
  /// dire.
  dettaglio: string | null;
  /// Questo host lo conosce? Se no non c'è niente da negare — non governa
  /// nessuna famiglia — e si dice invece di mostrare un interruttore che non fa
  /// niente.
  noto: boolean;
}

/// I permessi che un componente dichiara, nell'ordine in cui si leggono.
///
/// I **noti** vengono per primi e nell'ordine di `PERMESSI`; gli altri in fondo,
/// in ordine di chiave. Non è un'estetica: quelli in fondo sono l'unica parte
/// dell'elenco su cui l'utente non ha una leva, e mescolarli agli altri
/// suggerirebbe che siano negabili anche loro.
export function righe(bundle: BundleInfo): RigaPermesso[] {
  const dichiarati = Object.entries(bundle.permissions).filter(
    ([, v]) => v !== false && v !== null,
  );
  const noti = PERMESSI.filter((p) => dichiarati.some(([k]) => k === p)).map((p) =>
    riga(bundle, p, bundle.permissions[p], true),
  );
  const ignoti = dichiarati
    .filter(([k]) => !(PERMESSI as readonly string[]).includes(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => riga(bundle, k, v, false));
  return [...noti, ...ignoti];
}

function riga(bundle: BundleInfo, permesso: string, valore: unknown, noto: boolean): RigaPermesso {
  return {
    permesso,
    chiave: permissionKey(bundle.id, permesso),
    frase: noto ? t(FRASI[permesso as Permesso]) : t("permission.unknown"),
    dettaglio: dettaglioDi(permesso, valore),
    noto,
  };
}

/// Cosa dire del **parametro**, che per un permesso solo è il permesso stesso.
///
/// La differenza fra `["api.acme.com"]` e nessun elenco è la differenza fra un
/// componente che parla con un servizio e uno che può mandare le note
/// dell'utente ovunque, e la 0097 ha lasciato quella differenza fuori dal
/// cancello **apposta**, delegandola «alla frase che l'utente legge accettando».
/// Questa è quella frase.
///
/// Gli altri parametri che il contratto prevede — i prefissi di path di
/// `read-vault`, `write-vault` ed `external-fs` — **non si dicono**, e non è una
/// dimenticanza: oggi nessuno li onora (è la casella del §7.1), quindi
/// mostrarli sarebbe scrivere una promessa che l'app non mantiene. È lo stesso
/// criterio con cui non si mostra un interruttore che non fa niente.
export function dettaglioDi(permesso: string, valore: unknown): string | null {
  if (permesso !== "fub:network") return null;
  const host = Array.isArray(valore)
    ? valore.filter((h): h is string => typeof h === "string")
    : [];
  return host.length === 0
    ? t("permission.network.anywhere")
    : t("permission.network.only", { hosts: host.join(", ") });
}
