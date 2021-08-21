import { CharacteristicValue, Nullable } from "../../types";
import { CharacteristicProps, Formats } from "../Characteristic";

/**
 * Prepares the characteristic value to be sent to the HomeKit controller.
 * This includes changing booleans to 0 or 1 (for lower bandwidth) and converting
 * numbers to the desired minStep (by converting them to a string).
 * The minStep conversion only happens for minStep < 1
 *
 * @param value - The value which should be formatted
 * @param props - The characteristic properties used to format the value.
 * @private
 */
export function formatOutgoingCharacteristicValue(value: Nullable<CharacteristicValue>, props: CharacteristicProps): Nullable<CharacteristicValue>;
export function formatOutgoingCharacteristicValue(value: CharacteristicValue, props: CharacteristicProps): CharacteristicValue
export function formatOutgoingCharacteristicValue(value: Nullable<CharacteristicValue>, props: CharacteristicProps): Nullable<CharacteristicValue> {
  if (typeof value === "boolean") {
    return value? 1: 0;
  } else if (typeof value === "number") {
    if (!props.minStep || props.minStep >= 1) {
      return value;
    }

    const base = props.minValue ?? 0;
    const inverse = 1 / props.minStep;

    return Math.round(((Math.round((value - base) * inverse) / inverse) + base) * 10000) / 10000;
  }

  return value;
}

export function isNumericFormat(format: Formats | string): boolean {
  switch (format) {
    case Formats.INT:
    case Formats.FLOAT:
    case Formats.UINT8:
    case Formats.UINT16:
    case Formats.UINT32:
    case Formats.UINT64:
      return true;
    default:
      return false;
  }
}

export function isUnsignedNumericFormat(format: Formats | string): boolean {
  switch (format) {
    case Formats.UINT8:
    case Formats.UINT16:
    case Formats.UINT32:
    case Formats.UINT64:
      return true;
    default:
      return false;
  }
}

export function isIntegerNumericFormat(format: Formats | string): boolean {
  switch (format) {
    case Formats.INT:
    case Formats.UINT8:
    case Formats.UINT16:
    case Formats.UINT32:
    case Formats.UINT64:
      return true;
    default:
      return false;
  }
}

export function numericLowerBound(format: Formats | string): number {
  switch (format) {
    case Formats.INT:
      return -2147483648;
    case Formats.FLOAT:
      return -Number.MAX_VALUE;
    case Formats.UINT8:
    case Formats.UINT16:
    case Formats.UINT32:
    case Formats.UINT64:
      return 0;
    default:
      throw new Error("Unable to determine numeric lower bound for " + format);
  }
}

export function numericUpperBound(format: Formats | string): number {
  switch (format) {
    case Formats.INT:
      return 2147483647;
    case Formats.FLOAT:
      return Number.MAX_VALUE;
    case Formats.UINT8:
      return 255;
    case Formats.UINT16:
      return 65535;
    case Formats.UINT32:
      return 4294967295;
    case Formats.UINT64:
      return 18446744073709551615; // don't get fooled, javascript uses 18446744073709552000 here
    default:
      throw new Error("Unable to determine numeric lower bound for " + format);
  }
}
