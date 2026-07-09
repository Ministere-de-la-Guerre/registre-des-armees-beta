import { describe, expect, it } from "vitest";
import { makeUnit } from "../test/factories";
import { BUGGED_UNIFORM_UNIT_BODIES, buggedUniformKey, hasBuggedUniform } from "./buggedUniforms";

describe("buggedUniforms", () => {
  it("flags every variant of the 1811/1814 23e léger (base, commander, TOW)", () => {
    const affected = [
      "ntw3_inf_light_153_023_5628", // 1811 Spain, base
      "ntw3_inf_light_153_023_5628_tow_022", // 1811 Spain, TOW copy
      "ntw3_inf_light_154_023_5662_com_2877", // 1811 Spain, combat general
      "ntw3_inf_light_154_023_5662_tow_022_com_2877", // 1811 Spain, TOW combat general
      "ntw3_inf_light_294_023_6921", // 1814 France, L5 base
      "ntw3_inf_light_294_023_6930_tow_054", // 1814 France, L4 TOW copy
    ];
    for (const unitKey of affected) {
      expect(hasBuggedUniform(makeUnit({ unitKey }))).toBe(true);
    }
  });

  it("maps a regiment's variants to one stable key (for de-duping the warning)", () => {
    const base = buggedUniformKey(makeUnit({ unitKey: "ntw3_inf_light_294_023_6921" }));
    const com = buggedUniformKey(makeUnit({ unitKey: "ntw3_inf_light_294_023_6921_com_4192" }));
    const tow = buggedUniformKey(makeUnit({ unitKey: "ntw3_inf_light_294_023_6921_tow_054" }));
    expect(base).toBe("ntw3_inf_light_294_023_6921");
    expect(com).toBe(base);
    expect(tow).toBe(base);
    // The two 1814 bodies are distinct uniforms — they must not collapse together.
    expect(buggedUniformKey(makeUnit({ unitKey: "ntw3_inf_light_294_023_6930" }))).not.toBe(base);
  });

  it("does not flag the unaffected earlier 23e léger (1798 Egypt, 1805 Germany)", () => {
    expect(hasBuggedUniform(makeUnit({ unitKey: "ntw3_inf_light_076_023_1182" }))).toBe(false); // 1798
    expect(hasBuggedUniform(makeUnit({ unitKey: "ntw3_inf_light_091_023_1215" }))).toBe(false); // 1805
  });

  it("does not flag unrelated units", () => {
    expect(hasBuggedUniform(makeUnit({ unitKey: "ntw3_inf_line_203_023_3277" }))).toBe(false);
    expect(buggedUniformKey(makeUnit({ unitKey: "ntw3_cav_light_091_023_0977" }))).toBeNull();
  });

  it("keeps the affected-regiment list to the four known bodies", () => {
    expect(BUGGED_UNIFORM_UNIT_BODIES).toHaveLength(4);
  });
});
