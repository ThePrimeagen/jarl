import { describe, expect, it } from "vitest";
import { settingsOrDefaults } from "../examples/settings";

describe("settings example", () => {
  it("unwraps the settings once FileMissing is handled", async () => {
    expect(await settingsOrDefaults("settings.json")).toEqual({ theme: "dark" });
  });
});
