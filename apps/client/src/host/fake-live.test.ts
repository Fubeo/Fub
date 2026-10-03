// La sessione live dell'host finto: gli stessi errori dell'app, lo stato che
// segue gli eventi come nell'host vero, e un errore per ogni sequenza che
// l'host non produrrebbe.

import { describe, expect, it } from "vitest";
import type { LiveEvent, LiveStart } from "./contract";
import { createFakeHost, type LiveNetwork } from "./fake";

const NETWORK: LiveNetwork = {
  addresses: [
    { addr: "192.168.1.20", interface: "wlan0", defaultRoute: true },
    { addr: "10.0.0.5", interface: "eth0", defaultRoute: false },
  ],
  hostName: "Studio di Ada",
};

const START: LiveStart = {
  document: { id: "disegni/schizzo.svg", title: "Schizzo" },
  snapshot: { seq: "3", text: "<svg/>" },
};

const TABLET = {
  device: { name: "Tablet", kind: "tablet" },
  caps: { pressure: true, tilt: false, coalesced: true, predicted: false },
};

const JOIN: LiveEvent = { t: "writerConnected", writer: "1", ...TABLET, resumed: false };
const ADD = [{ op: "add", parent: "l1a2b3c4d" }];

/// Un host con una sessione avviata, e i gruppi di eventi arrivati alla shell.
async function started(network: LiveNetwork = NETWORK) {
  const host = createFakeHost({ live: network });
  const received: LiveEvent[][] = [];
  const answer = await host.module.api.liveStart(START, (events) => received.push(events));
  return { host, api: host.module.api, session: answer.session.session, answer, received };
}

describe("la sessione live dell'host finto", () => {
  it("senza rete configurata non è servita, e un PC fuori rete è unserved", async () => {
    await expect(createFakeHost().module.api.liveStart(START, () => {})).rejects.toThrow(/configured native service/);
    const offline = createFakeHost({ live: { addresses: [] } });
    await expect(offline.module.api.liveStart(START, () => {})).rejects.toMatchObject({ kind: "unserved" });
    const elsewhere = createFakeHost({ live: NETWORK });
    await expect(
      elsewhere.module.api.liveStart({ ...START, address: "192.168.9.9" }, () => {}),
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("avvia sulla rotta predefinita o sull'indirizzo chiesto, una sessione per documento", async () => {
    const { api, answer } = await started();
    expect(answer.session).toMatchObject({ addr: "192.168.1.20:52143", hostName: "Studio di Ada" });
    expect(answer.session.session).toHaveLength(11);
    expect(answer.pairing.payload).toContain("&n=Studio%20di%20Ada");
    expect(answer.addresses).toEqual(NETWORK.addresses);
    await expect(api.liveStart(START, () => {})).rejects.toMatchObject({ kind: "already_exists" });

    const other = await api.liveStart({ ...START, document: { id: "altro.svg", title: "Altro" }, address: "10.0.0.5" }, () => {});
    expect(other.session.addr).toBe("10.0.0.5:52143");
    expect(await api.liveStatus(other.session.session)).toMatchObject({
      ended: false,
      seq: "3",
      pairingExpiresInMs: 300000,
      writer: null,
      pending: [],
    });
  });

  it("lo scrittore consuma il QR, e un commit aspetta la risposta della shell", async () => {
    const { host, api, session, received } = await started();
    host.liveEmit(session, [JOIN, { t: "commit", writer: "1", c: "1", ops: ADD }, { t: "commit", writer: "1", c: "2", ops: ADD }]);
    expect(received).toHaveLength(1);
    expect(await api.livePairing(session, false)).toBeNull();

    let status = await api.liveStatus(session);
    expect(status.writer).toMatchObject({ writer: "1", connected: true, lastC: "0" });
    expect(status.pending.map((commit) => commit.c)).toEqual(["1", "2"]);
    expect(status.stats).toMatchObject({ accepted: "1", admitted: "1", commits: "2", answered: "0" });

    await api.liveSend(session, { t: "ack", writer: "1", c: "1", seq: "4", echo: ADD, duplicate: false });
    await expect(
      api.liveSend(session, { t: "ack", writer: "1", c: "1", seq: "5", echo: ADD, duplicate: false }),
    ).rejects.toMatchObject({ kind: "not_found" });
    await expect(
      api.liveSend(session, { t: "ack", writer: "1", c: "2", seq: "2", echo: ADD, duplicate: false }),
    ).rejects.toMatchObject({ kind: "conflict" });
    await api.liveSend(session, { t: "nack", writer: "1", c: "2", reason: "missing-parent", detail: "", index: 0 });

    status = await api.liveStatus(session);
    expect(status).toMatchObject({ seq: "4", pending: [], stats: { answered: "2" } });
    expect(status.writer?.lastC).toBe("2");
  });

  it("un QR nuovo è rifiutato con lo scrittore collegato, e libera quello in attesa", async () => {
    const { host, api, session, received } = await started();
    host.liveEmit(session, [JOIN]);
    await expect(api.livePairing(session, true)).rejects.toMatchObject({ kind: "already_exists" });

    host.liveEmit(session, [{ t: "writerDisconnected", writer: "1", reason: "lost", resumable: true }]);
    expect((await api.liveStatus(session)).writer).toMatchObject({ connected: false, resumeExpiresInMs: 120000 });
    const renewed = await api.livePairing(session, true);
    expect(renewed?.expiresInMs).toBe(300000);
    expect(received[received.length - 1]).toEqual([{ t: "writerReleased", writer: "1", reason: "pairingRenewed" }]);
    expect((await api.liveStatus(session)).writer).toBeNull();
  });

  it("una sequenza che l'host non produrrebbe lancia", async () => {
    const { host, session } = await started();
    expect(() => host.liveEmit(session, [{ t: "commit", writer: "1", c: "1", ops: ADD }])).toThrow(/without that writer/);
    host.liveEmit(session, [JOIN]);
    expect(() => host.liveEmit(session, [{ ...JOIN, writer: "2" }])).toThrow(/another writer/);
    expect(() =>
      host.liveEmit(session, [{ t: "writerDisconnected", writer: "1", reason: "writerBye", resumable: true }]),
    ).toThrow(/resumable/);
    expect(() => host.liveEmit(session, [{ t: "ended", reason: "terminated" }])).toThrow(/writer is connected/);
    expect(() => host.liveEmit("nessuna", [])).toThrow(/no live session/);
  });

  it("fermarla chiude lo scrittore, manda la fine e restituisce i commit senza risposta", async () => {
    const { host, api, session, received } = await started();
    host.liveEmit(session, [JOIN, { t: "commit", writer: "1", c: "1", ops: ADD }]);
    const report = await api.liveStop(session, "documentClosed");
    expect(report.pending).toEqual([{ writer: "1", c: "1", ops: ADD }]);
    expect(received[received.length - 1]).toEqual([
      { t: "writerDisconnected", writer: "1", reason: "sessionEnded", resumable: false },
      { t: "ended", reason: "documentClosed" },
    ]);
    await expect(api.liveStatus(session)).rejects.toMatchObject({ kind: "not_found" });
    // Il documento è di nuovo libero.
    await api.liveStart(START, () => {});
  });

  it("una sessione finita da sé resta fino allo stop e non accetta messaggi", async () => {
    const { host, api, session, received } = await started();
    host.liveEmit(session, [{ t: "ended", reason: "readOnly" }]);
    expect((await api.liveStatus(session)).ended).toBe(true);
    await expect(api.liveSend(session, { t: "ops", seq: "4", ops: ADD })).rejects.toMatchObject({ kind: "cancelled" });
    await expect(api.livePairing(session, true)).rejects.toMatchObject({ kind: "cancelled" });
    expect(() => host.liveEmit(session, [{ t: "snapshotWanted" }])).toThrow(/after it ended/);
    const count = received.length;
    await api.liveStop(session, "hostClosing");
    expect(received).toHaveLength(count);
  });

  it("una porta guasta non cambia la sessione", async () => {
    const { host, api, session } = await started();
    host.liveEmit(session, [JOIN, { t: "commit", writer: "1", c: "1", ops: ADD }]);
    const repair = host.fault("liveSend");
    await expect(
      api.liveSend(session, { t: "ack", writer: "1", c: "1", seq: "4", echo: ADD, duplicate: false }),
    ).rejects.toThrow();
    repair();
    expect((await api.liveStatus(session)).pending).toHaveLength(1);
    expect(host.atGate("liveSend")).toHaveLength(1);
  });

  it("un contatore fuori dalla sua grafia è un errore della shell", async () => {
    const { api, session } = await started();
    await expect(api.liveSend(session, { t: "ops", seq: "04", ops: ADD })).rejects.toThrow(/not a counter/);
    await expect(api.liveSend(session, { t: "ops", seq: "18446744073709551616", ops: ADD })).rejects.toThrow(/not a counter/);
  });
});
