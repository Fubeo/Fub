// I collegamenti a una pagina web che i sistemi salvano come file: `.webloc`
// (macOS, un plist XML) e `.url` (Windows, un INI `[InternetShortcut]`).
// Lasciati cadere in una nota diventano un link, non un allegato.

/// Un file così grande non è un collegamento: si deposita come allegato.
const SHORTCUT_LIMIT = 64 * 1024;

/// Gli schemi che un link della nota può portare: un `javascript:` o un
/// `file:` letto da un file trascinato non diventano un link.
const SAFE_SCHEME = /^(https?|mailto|ftp):/i;

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export interface WebShortcut {
  readonly title: string;
  readonly url: string;
}

/// Il file ha il nome di un collegamento web e la taglia per esserlo.
export function looksLikeWebShortcut(name: string, size: number): boolean {
  return /\.(webloc|url)$/i.test(name) && size <= SHORTCUT_LIMIT;
}

/// Il titolo (il nome del file senza estensione) e l'indirizzo, o `null` se
/// il testo non porta un indirizzo leggibile: un plist binario, un INI senza
/// `URL=`, uno schema non ammesso.
export function webShortcut(name: string, text: string): WebShortcut | null {
  const extension = /\.(webloc|url)$/i.exec(name)?.[1]?.toLowerCase();
  if (!extension) return null;
  let url: string | undefined;
  if (extension === "webloc") {
    const found = /<key>\s*URL\s*<\/key>\s*<string>([^<]*)<\/string>/i.exec(text)?.[1];
    url = found?.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => XML_ENTITIES[entity]!);
  } else {
    url = /^\s*URL\s*=\s*(\S.*?)\s*$/im.exec(text)?.[1];
  }
  url = url?.trim();
  if (!url || !SAFE_SCHEME.test(url)) return null;
  return { title: name.replace(/\.(webloc|url)$/i, ""), url };
}
