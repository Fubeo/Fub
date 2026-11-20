// Lo specchio dell'organizzazione (`state/organization.ts`), provato senza DOM.
//
// Chi mostra le appuntate — la scrivania, l'albero — le legge da `state.meta` e
// si rifà quando arriva un segnale. Il kernel sposta il pin di una nota
// rinominata dentro la rinomina, e la shell rilegge l'organizzazione dopo il
// `document_renamed`: ma quella rilettura arriva **dopo** che la scrivania ha
// già letto lo specchio vecchio. Se la rilettura non annuncia il dato nuovo, la
// scrivania resta con il path di prima e l'appuntata sparisce.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization } from "../host/contract";

const box = vi.hoisted(() => ({ read: null as null | (() => Promise<Organization>) }));

vi.mock("../host/ipc", () => ({ api: {} }));
vi.mock("../host/query", () => ({ organizationQuery: () => box.read!() }));
vi.mock("../ui/notify", () => ({ notify: vi.fn() }));

const { loadOrganization } = await import("./organization");
const { emptyMeta, on, state } = await import("./store");

function organization(pinned: string[]): Organization {
  return { icons: {}, pinned, order: {}, spaces: [] };
}

beforeEach(() => {
  state.meta = emptyMeta();
});

describe("loadOrganization", () => {
  it("annuncia l'organizzazione che ha letto, perché chi la mostra si rifaccia", async () => {
    box.read = async () => organization(["Altra/Nuova.md"]);
    const heard = vi.fn();
    const off = on("organization", heard);

    await loadOrganization();

    expect(state.meta.pinned).toEqual(["Altra/Nuova.md"]);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
  });

  it("annuncia anche il vuoto che sostituisce un'organizzazione che non si legge", async () => {
    state.meta = { ...emptyMeta(), pinned: ["Vecchia.md"] };
    box.read = async () => {
      throw { kind: "internal", message: "sidecar illeggibile" };
    };
    const heard = vi.fn();
    const off = on("organization", heard);

    await loadOrganization();

    expect(state.meta.pinned).toEqual([]);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
  });
});
