// @vitest-environment happy-dom
// Il campo delle azioni `fub://` consentite: una casella per azione, e i nomi
// che questa shell non conosce restano in coda come erano.
import { expect, it } from "vitest";
import type { SettingEntry } from "../host/contract";
import { t } from "../i18n/strings";
import { describeUriAllowed, uriAllowedField } from "./uri-allowed-field";

const entry = (value: string[]) => ({ spec: { key: "uri.allowed" }, value }) as unknown as SettingEntry;

it("una casella per azione, e lo scritto tiene i nomi sconosciuti", () => {
  const writes: Array<[string[], string, boolean]> = [];
  const field = uriAllowedField(entry(["unique", "futura"]), "f", (value, part, checked) => writes.push([value, part, checked]));
  const boxes = [...field.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  expect(boxes.map((box) => [box.id, box.checked])).toEqual([
    ["f-new", false],
    ["f-daily", false],
    ["f-unique", true],
  ]);
  boxes[0]!.checked = true;
  boxes[0]!.dispatchEvent(new Event("change"));
  expect(writes).toEqual([[["new", "unique", "futura"], t("incoming.allow.new"), true]]);
  expect(describeUriAllowed(["daily", "futura"])).toBe(`${t("incoming.allow.daily")}, futura`);
});

it("la cattura non ha casella: un `capture` di una versione vecchia non si mostra ed esce al primo cambio", () => {
  const writes: string[][] = [];
  const field = uriAllowedField(entry(["capture", "daily"]), "f", (value) => writes.push(value));
  const boxes = [...field.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  expect(boxes.map((box) => box.id)).toEqual(["f-new", "f-daily", "f-unique"]);
  boxes[0]!.checked = true;
  boxes[0]!.dispatchEvent(new Event("change"));
  expect(writes).toEqual([["new", "daily"]]);
  expect(describeUriAllowed(["capture", "daily"])).toBe(t("incoming.allow.daily"));
});
