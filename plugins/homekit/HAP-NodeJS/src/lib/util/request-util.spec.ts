import { CharacteristicProps, Formats, Perms } from "../Characteristic";
import { formatOutgoingCharacteristicValue } from "./request-util";

function createProps(format: Formats, props?: Partial<CharacteristicProps>): CharacteristicProps {
  return {
    format: format,
    perms: [Perms.PAIRED_READ],
    ...props,
  };
}

describe("request-util", () => {
  it("should reduce bandwidth of boolean true", () => {
    expect(formatOutgoingCharacteristicValue(true, createProps(Formats.BOOL))).toEqual(1);
  });

  it("should reduce bandwidth of boolean false", () => {
    expect(formatOutgoingCharacteristicValue(false, createProps(Formats.BOOL))).toEqual(0);
  });

  it("should not round valid value", () => {
    const props = createProps(Formats.INT, {
      minStep: 1,
    });
    expect(formatOutgoingCharacteristicValue(4, props)).toBe(4);
  });

  it("should round invalid value", () => {
    const props = createProps(Formats.INT, {
      minStep: 0.15,
      minValue: 6,
    });
    expect(formatOutgoingCharacteristicValue(6.1500001, props)).toBe(6.15);
  });

  it("should round up invalid value", () => {
    const props = createProps(Formats.INT, {
      minStep: 0.1,
      minValue: 2,
    });
    expect(formatOutgoingCharacteristicValue(2.1542, props)).toBe(2.2);
  });

  it("should round invalid huge value", () => {
    const props = createProps(Formats.INT, {
      minStep: 0.1,
      minValue: 10,
      maxValue: 38,
    });
    expect(formatOutgoingCharacteristicValue(36.135795, props)).toBe(36.1);
  });

  it("should handle negative minimum values", () => {
    const props = createProps(Formats.INT, {
      minStep: 0.1,
      minValue: -100,
      maxValue: 100,
    });
    expect(formatOutgoingCharacteristicValue(25.1, props)).toBe(25.1);
  });

  it("should handle small minimum values", () => {
    const props = createProps(Formats.INT, {
      minStep: 0.1,
      minValue: 0.1,
      maxValue: 10000,
    });
    expect(formatOutgoingCharacteristicValue(2.3, props)).toBe(2.3);
  });
});
