// La lingua delle risposte dell'host finto. L'host vero manda alla shell
// errori già tradotti dai suoi cataloghi (`host.live.*` in
// `fub-host/src/settings.rs`), e la shell li mostra così come arrivano: un
// messaggio del finto in inglese finiva, con la shell in italiano, dentro una
// fotografia del banco (la scena `grid-result-error`).

import { describe, expect, it } from "vitest";
import type { GridCommandRequest, GridSurfaceSpec } from "./contract";
import { createFakeHost, type GridBytesFake, type LiveNetwork } from "./fake";

const NETWORK: LiveNetwork = {
  addresses: [{ addr: "192.168.1.20", interface: "wlan0", defaultRoute: true }],
  hostName: "Studio",
};

const START = {
  document: { id: "disegni/schizzo.svg", title: "Schizzo" },
  snapshot: { seq: "3", text: "<svg/>" },
};

/// Un errore dell'host, preso com'è arrivato.
async function failure(call: Promise<unknown>): Promise<{ kind: string; message: string }> {
  try {
    await call;
  } catch (error) {
    return error as { kind: string; message: string };
  }
  throw new Error("la chiamata doveva fallire");
}

describe("le risposte dell'host finto parlano italiano", () => {
  it("un comando dei fogli che il provider non serve", async () => {
    // Senza esiti il finto rifiuta ogni comando, come il provider della scena.
    const grid = {
      surface: { id: "xlsx.grid" } as GridSurfaceSpec,
      session: { instance: "g1", revision: "1" },
      windows: [],
    } as unknown as GridBytesFake;
    const host = createFakeHost({ file: { "Conti.xlsx": "" }, gridBytes: grid });
    const { api } = host.module;
    const { revision } = await api.readDocument("Conti.xlsx");
    const session = await api.openGridBytes("xlsx.grid", "Conti.xlsx", "diario", revision);
    const request = { revision: "1", command: { id: "selection.stats" } } as unknown as GridCommandRequest;

    const error = await failure(api.gridBytesCommand("xlsx.grid", session.instance, request));
    expect(error).toEqual({
      kind: "bad_args",
      message: "host fake: il comando della griglia `selection.stats` non è servito",
    });
    expect(await failure(api.closeGridBytes("xlsx.grid", "nessuna"))).toEqual({
      kind: "not_found",
      message: "host fake: la sessione della griglia è chiusa",
    });
  });

  it("la sessione live, con le frasi del catalogo italiano dell'host", async () => {
    const offline = createFakeHost({ live: { addresses: [] } }).module.api;
    expect((await failure(offline.liveStart(START, () => {}))).message).toBe(
      "Il PC non è su una rete locale: nessuna interfaccia attiva ha un indirizzo IPv4 privato.",
    );

    const host = createFakeHost({ live: NETWORK });
    const { api } = host.module;
    expect((await failure(api.liveStart({ ...START, address: "10.9.9.9" }, () => {}))).message).toBe(
      "10.9.9.9 non è l'indirizzo privato di un'interfaccia attiva.",
    );
    const answer = await api.liveStart(START, () => {});
    expect((await failure(api.liveStart(START, () => {}))).message).toBe(
      "«disegni/schizzo.svg» ha già una sessione live.",
    );
    expect((await failure(api.liveStatus("nessuna"))).message).toBe("Questa finestra non ha la sessione live nessuna.");
    host.liveEmit(answer.session.session, [{ t: "ended", reason: "readOnly" }]);
    expect((await failure(api.livePairing(answer.session.session, true))).message).toBe("La sessione live è finita.");
  });

  it("un componente ritirato dal catalogo", async () => {
    const host = createFakeHost({
      installedPlugins: [{
        id: "com.acme.notes",
        name: "Acme Notes",
        mounted: false,
        kind: "component",
        trust: "community",
        permissions: {},
        installation: "41",
        version: "1.2.3",
        enabled: false,
        consent: "undecided",
        runtime_known: false,
        revoked: true,
      }],
    });
    expect(await failure(host.module.api.setInstalledPluginEnabled("41", true))).toEqual({
      kind: "permission_denied",
      message: "Questa versione del catalogo è stata ritirata: non si monta.",
    });
  });
});
