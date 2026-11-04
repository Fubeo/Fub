// I permessi come li legge chi deve accettarli (§23.17), provati senza DOM: la
// **chiave** che si compone e le **righe** che si disegnano sono decisioni, e
// una decisione che si prova solo aprendo l'app non la prova nessuno.
import { describe, expect, it } from "vitest";
import type { BundleInfo } from "../host/contract";
import { t } from "../i18n/strings";
import {
  TRUST_LABELS,
  PHRASES,
  PERMISSIONS,
  LIST_SHOWN,
  detailOf,
  isPermissionKey,
  permissionKey,
  rows,
} from "./permissions";

function bundle(permissions: Record<string, unknown>, mounted = true): BundleInfo {
  return {
    id: "com.acme",
    name: "Acme",
    mounted,
    kind: "component",
    trust: "community",
    permissions,
  };
}

describe("la chiave con cui si nega un permesso", () => {
  // Il gemello sta in `fub_abi::settings::permission_key`, e si prova sugli
  // stessi casi: due funzioni che compongono la stessa stringa in due
  // linguaggi divergono al primo refuso, e divergerebbero **in silenzio** —
  // l'interruttore resterebbe nel pannello, si potrebbe muovere, e non
  // negherebbe niente.
  it("mette il componente nella fessura del namespace", () => {
    expect(permissionKey("com.acme", "fub:read-vault")).toBe("com.acme:permissions.read-vault");
    expect(permissionKey("com.acme", "fub:network")).toBe("com.acme:permissions.network");
  });

  it("e vale anche per una feature ufficiale", () => {
    // A differenza delle scorciatoie: la licenza del core di nominare nudo
    // esiste per le chiavi dell'applicazione, e un permesso è sempre di
    // esattamente un componente.
    expect(permissionKey("fub.search", "fub:read-vault")).toBe("fub.search:permissions.read-vault");
  });

  it("e si riconosce, perché la scheda della configurazione non deve disegnarla", () => {
    expect(isPermissionKey("com.acme:permissions.network")).toBe(true);
    for (const other of [
      "plugins.disabled",
      "versioning.enabled",
      "com.acme:keys.tasks.add",
      "com.acme:permissions.",
      ":permissions.network",
      "permissions.network",
    ]) {
      expect(isPermissionKey(other), other).toBe(false);
    }
  });
});

describe("le righe di un componente", () => {
  it("escono nell'ordine dichiarato e non in quello della mappa", () => {
    // La mappa arriva in ordine di chiave (`BTreeMap` di là): `network`
    // precederebbe `read-vault`, cioè la rete comparirebbe prima del vault
    // solo perché comincia per n.
    const r = rows(bundle({ "fub:network": true, "fub:read-vault": true }));
    expect(r.map((x) => x.permission)).toEqual(["fub:read-vault", "fub:network"]);
  });

  it("dicono cosa il componente può fare, non il nome della capacità", () => {
    const [r] = rows(bundle({ "fub:read-drafts": true }));
    expect(r.message).toBe(t("permission.read-drafts"));
    expect(r.message).not.toContain("fub:");
    expect(r.key).toBe("com.acme:permissions.read-drafts");
  });

  it("un permesso spento con `false` non è dichiarato", () => {
    // È la regola di `OptionMap`: presente = acceso, e un `false` esplicito
    // spegne. Mostrarlo sarebbe dire che il componente chiede una cosa che non
    // chiede.
    expect(rows(bundle({ "fub:read-vault": false }))).toEqual([]);
  });

  it("un permesso che questo host non conosce si dice, e non si nega", () => {
    // Non governa nessuna famiglia, quindi non c'è niente da togliergli: un
    // interruttore lì sarebbe un interruttore che non fa niente. Ma sta
    // nell'elenco, perché il manifest lo dichiara e nasconderlo sarebbe
    // mostrare un manifest diverso da quello vero.
    const r = rows(bundle({ "terzi:qualcosa": true, "fub:read-vault": true }));
    expect(r.map((x) => x.known)).toEqual([true, false]);
    expect(r[1].message).toBe(t("permission.unknown"));
  });
});

describe("il parametro della rete", () => {
  // «Può connettersi a qualunque host» non è «può connettersi ad api.acme.com»,
  // e la 0097 ha lasciato quella differenza fuori dal cancello **apposta**,
  // delegandola alla frase che l'utente legge accettando. Questa è quella
  // frase, ed è l'unico posto in cui esiste.
  it("distingue un elenco da nessun elenco", () => {
    expect(detailOf("fub:network", ["api.acme.com"])).toBe(
      t("permission.network.only", { hosts: "api.acme.com" }),
    );
    expect(detailOf("fub:network", true)).toBe(t("permission.network.anywhere"));
    expect(detailOf("fub:network", [])).toBe(t("permission.network.anywhere"));
  });

  it("un elenco scritto male non apre a tutti: dice «nessuno», come il recinto", () => {
    // `"api.acme.com"` al posto di `["api.acme.com"]`: il `Guard` lo legge come
    // un recinto che non nomina nessuno, e la frase non può dire «ovunque».
    expect(detailOf("fub:network", "api.acme.com")).toBe(t("permission.network.none"));
    expect(detailOf("fub:network", { host: "api.acme.com" })).toBe(t("permission.network.none"));
    expect(detailOf("fub:network", [42])).toBe(t("permission.network.none"));
    // Il `Guard` della rete scarta le non-stringhe e tiene le altre.
    expect(detailOf("fub:network", ["api.acme.com", 42])).toBe(
      t("permission.network.only", { hosts: "api.acme.com" }),
    );
  });
});

describe("le cartelle dei permessi sul vault", () => {
  // Il `Guard` le onora su ogni porta dei documenti (`path_allowlist`): la
  // persona deve leggerle prima di accettare.
  it("un permesso con elenco mostra l'elenco", () => {
    for (const p of ["fub:read-vault", "fub:write-vault", "fub:read-drafts", "fub:read-session", "fub:read-selection"]) {
      expect(detailOf(p, ["Progetti/", "Diario"]), p).toBe(
        t("permission.folders.only", { folders: "Progetti, Diario" }),
      );
    }
  });

  it("senza elenco non aggiunge niente alla frase, che dice già tutto il vault", () => {
    for (const value of [true, null, undefined, []]) {
      expect(detailOf("fub:read-vault", value), String(value)).toBeNull();
    }
  });

  it("un elenco scritto male dice «nessuna cartella»", () => {
    for (const value of ["Progetti", 3, { Progetti: true }, ["Progetti", 3], [null]]) {
      expect(detailOf("fub:write-vault", value), JSON.stringify(value)).toBe(t("permission.folders.none"));
    }
  });

  it("la radice è detta a parole, e un nome lunghissimo non si taglia", () => {
    expect(detailOf("fub:read-vault", ["/"])).toBe(
      t("permission.folders.only", { folders: t("permission.folders.root") }),
    );
    const long = `${"Una cartella dal nome molto lungo/".repeat(8)}fine`;
    expect(detailOf("fub:read-vault", [long])).toContain(long);
  });

  it("i prefissi di `external-fs` non si dicono: nessuno li onora", () => {
    expect(detailOf("fub:external-fs", ["/tmp"])).toBeNull();
    expect(detailOf("fub:camera", ["x"])).toBeNull();
  });
});

describe("i comandi di `fub:run-command`", () => {
  it("un permesso con elenco mostra l'elenco, a nome esatto", () => {
    expect(detailOf("fub:run-command", ["note.property.set", "note.rename"])).toBe(
      t("permission.commands.only", { commands: "note.property.set, note.rename" }),
    );
  });

  it("senza elenco non aggiunge niente", () => {
    for (const value of [true, null, undefined, []]) {
      expect(detailOf("fub:run-command", value), String(value)).toBeNull();
    }
  });

  it("un elenco scritto male dice «nessun comando», come il `Guard` che chiude", () => {
    for (const value of ["note.trash", 1, {}, ["note.trash", 1]]) {
      expect(detailOf("fub:run-command", value), JSON.stringify(value)).toBe(t("permission.commands.none"));
    }
  });

  it("un elenco di 50 comandi si accorcia con «e altri N»", () => {
    const commands = Array.from({ length: 50 }, (_, i) => `recipe.passo${i}`);
    const detail = detailOf("fub:run-command", commands)!;
    const shown = commands.slice(0, LIST_SHOWN - 1).join(", ");
    expect(detail).toBe(
      t("permission.commands.only", {
        commands: `${shown} ${t("permission.commands.more", { n: 50 - (LIST_SHOWN - 1) })}`,
      }),
    );
    expect(detail).not.toContain(commands[LIST_SHOWN - 1]);
    // Fino al limite si scrivono tutti: «e altri 1» non accorcia niente.
    const few = commands.slice(0, LIST_SHOWN);
    expect(detailOf("fub:run-command", few)).toBe(t("permission.commands.only", { commands: few.join(", ") }));
  });

  it("e la riga del componente lo porta", () => {
    const [r] = rows(bundle({ "fub:run-command": ["note.rename"] }));
    expect(r.detail).toBe(t("permission.commands.only", { commands: "note.rename" }));
  });
});

describe("i cataloghi non hanno buchi", () => {
  it("ogni permesso ha una frase, e non è la chiave nuda", () => {
    // L'ultimo gradino della scala di ripiego è la chiave nuda (0040): brutto
    // apposta, e visibile. Qui sarebbe visibile in un elenco che qualcuno legge
    // per decidere di cosa fidarsi.
    for (const p of PERMISSIONS) {
      const key = PHRASES[p];
      expect(t(key), `${p} non ha una frase`).not.toBe(key);
    }
  });

  it("e ogni grado di fiducia ha un nome", () => {
    for (const [degree, key] of Object.entries(TRUST_LABELS)) {
      expect(t(key), degree).not.toBe(key);
    }
  });
});
