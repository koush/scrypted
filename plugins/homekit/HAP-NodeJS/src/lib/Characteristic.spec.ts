import {
  Access,
  Characteristic,
  CharacteristicChange,
  CharacteristicEventTypes,
  CharacteristicProps,
  Formats,
  HAPStatus,
  Perms,
  SerializedCharacteristic,
  Units,
  uuid
} from '..';
import { SelectedRTPStreamConfiguration } from "./definitions";
import { HapStatusError } from './util/hapStatusError';

function createCharacteristic(type: Formats, customUUID?: string): Characteristic {
  return new Characteristic('Test', customUUID || uuid.generate('Foo'), { format: type, perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE] });
}

function createCharacteristicWithProps(props: CharacteristicProps, customUUID?: string): Characteristic {
  return new Characteristic('Test', customUUID || uuid.generate('Foo'), props);
}

describe('Characteristic', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  })

  describe('#setProps()', () => {
    it('should overwrite existing properties', () => {
      const characteristic = createCharacteristic(Formats.BOOL);

      const NEW_PROPS = {format: Formats.STRING, perms: [Perms.NOTIFY]};
      characteristic.setProps(NEW_PROPS);

      expect(characteristic.props).toEqual(NEW_PROPS);
    });

    it('should fail when setting invalid value range', function () {
      const characteristic = createCharacteristic(Formats.INT);

      const setProps = (min: number, max: number) => characteristic.setProps({
        minValue: min,
        maxValue: max,
      })

      expect(() => setProps(-256, -512)).toThrow(Error);
      expect(() => setProps(0, -3)).toThrow(Error);
      expect(() => setProps(6, 0)).toThrow(Error);
      expect(() => setProps(678, 234)).toThrow(Error);

      // should allow setting equal values
      setProps(0, 0);
      setProps(3, 3);
    });

    it('should reject update to minValue and maxValue when they are out of range for format type', function () {
      const characteristic = createCharacteristicWithProps({
        format: Formats.UINT8,
        perms: [Perms.NOTIFY, Perms.PAIRED_READ],
        minValue: 0,
        maxValue: 255,
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      mock.mockReset();
      characteristic.setProps({
        minValue: 700,
        maxValue: 1000
      });

      expect(characteristic.props.minValue).toEqual(0); // min for UINT8
      expect(characteristic.props.maxValue).toEqual(255); // max for UINT8
      expect(mock).toBeCalledTimes(2);

      mock.mockReset();
      characteristic.setProps({
        minValue: -1000,
        maxValue: -500
      });

      expect(characteristic.props.minValue).toEqual(0); // min for UINT8
      expect(characteristic.props.maxValue).toEqual(255); // max for UINT8
      expect(mock).toBeCalledTimes(2);

      mock.mockReset();
      characteristic.setProps({
        minValue: 10,
        maxValue: 1000
      });

      expect(characteristic.props.minValue).toEqual(10);
      expect(characteristic.props.maxValue).toEqual(255); // max for UINT8
      expect(mock).toBeCalledTimes(1);
    });

    it('should reject update to minValue and maxValue when minValue is greater than maxValue', function () {
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      });

      expect(function() {
        characteristic.setProps({
          minValue: 1000,
          maxValue: 500,
        })
      }).toThrowError()

      expect(characteristic.props.minValue).toBeUndefined();
      expect(characteristic.props.maxValue).toBeUndefined();
    });

    it('should accept update to minValue and maxValue when they are in range for format type', function () {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.NOTIFY, Perms.PAIRED_READ],
        minValue: 0,
        maxValue: 255,
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      mock.mockReset();
      characteristic.setProps({
        minValue: 10,
        maxValue: 240
      })

      expect(characteristic.props.minValue).toEqual(10);
      expect(characteristic.props.maxValue).toEqual(240);
      expect(mock).toBeCalledTimes(0);

      mock.mockReset();
      characteristic.setProps({
        minValue: -2147483648,
        maxValue: 2147483647
      })

      expect(characteristic.props.minValue).toEqual(-2147483648);
      expect(characteristic.props.maxValue).toEqual(2147483647);
      expect(mock).toBeCalledTimes(0);
    });

    it('should reject non-finite numbers for minValue and maxValue for numeric characteristics', function () {
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      mock.mockReset();
      characteristic.setProps({
        minValue: Number.NEGATIVE_INFINITY,
      });

      expect(characteristic.props.minValue).toEqual(undefined);
      expect(mock).toBeCalledTimes(1);
      expect(mock).toBeCalledWith(expect.stringContaining("Property 'minValue' must be a finite number"), expect.anything());

      mock.mockReset();
      characteristic.setProps({
        maxValue: Number.POSITIVE_INFINITY,
      });

      expect(characteristic.props.maxValue).toEqual(undefined);
      expect(mock).toBeCalledTimes(1);
      expect(mock).toBeCalledWith(expect.stringContaining("Property 'maxValue' must be a finite number"), expect.anything());
    });

    it('should reject NaN numbers for minValue and maxValue for numeric characteristics', function () {
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        perms: [Perms.NOTIFY, Perms.PAIRED_READ],
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      mock.mockReset();
      characteristic.setProps({
        minValue: NaN,
      });

      expect(characteristic.props.minValue).toEqual(undefined);
      expect(mock).toBeCalledTimes(1);
      expect(mock).toBeCalledWith(expect.stringContaining("Property 'minValue' must be a finite number"), expect.anything());

      mock.mockReset();
      characteristic.setProps({
        maxValue: NaN,
      });

      expect(characteristic.props.maxValue).toEqual(undefined);
      expect(mock).toBeCalledTimes(1);
      expect(mock).toBeCalledWith(expect.stringContaining("Property 'maxValue' must be a finite number"), expect.anything());
    });
  });

  describe("validValuesIterator", () => {
    it ("should iterate over min/max value definition", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.PAIRED_READ],
        minValue: 2,
        maxValue: 5,
      });

      const result = Array.from(characteristic.validValuesIterator());
      expect(result).toEqual([2, 3, 4, 5]);
    });

    it ("should iterate over min/max value definition with minStep defined", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.PAIRED_READ],
        minValue: 2,
        maxValue: 10,
        minStep: 2, // can't really test with .x precision as of floating point precision
      });

      const result = Array.from(characteristic.validValuesIterator());
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it ("should iterate over validValues array definition", () => {
      const validValues = [1, 3, 4, 5, 8];
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.PAIRED_READ],
        validValues: validValues
      });

      const result = Array.from(characteristic.validValuesIterator());
      expect(result).toEqual(validValues);
    });

    it ("should iterate over validValueRanges definition", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.PAIRED_READ],
        validValueRanges: [2, 5],
      });

      const result = Array.from(characteristic.validValuesIterator());
      expect(result).toEqual([2, 3, 4, 5]);
    });

    it("should iterate over UINT8 definition", () => {
      const characteristic = createCharacteristic(Formats.UINT8);

      const result = Array.from(characteristic.validValuesIterator());
      expect(result).toEqual(Array.from(new Uint8Array(256).map((value, i) => i)))
    });

    // we could do the same for UINT16, UINT32 and UINT64 but i think thats kind of pointless and takes to long
  });

  describe('#subscribe()', () => {
    it('correctly adds a single subscription', () => {
      const characteristic = createCharacteristic(Formats.BOOL);
      const subscribeSpy = jest.fn();
      characteristic.on(CharacteristicEventTypes.SUBSCRIBE, subscribeSpy);
      characteristic.subscribe();

      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      // @ts-expect-error
      expect(characteristic.subscriptions).toEqual(1);
    });

    it('correctly adds multiple subscriptions', () => {
      const characteristic = createCharacteristic(Formats.BOOL);
      const subscribeSpy = jest.fn();
      characteristic.on(CharacteristicEventTypes.SUBSCRIBE, subscribeSpy);
      characteristic.subscribe();
      characteristic.subscribe();
      characteristic.subscribe();

      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      // @ts-expect-error
      expect(characteristic.subscriptions).toEqual(3);
    });
  });

  describe('#unsubscribe()', () => {
    it('correctly removes a single subscription', () => {
      const characteristic = createCharacteristic(Formats.BOOL);
      const subscribeSpy = jest.fn();
      const unsubscribeSpy = jest.fn();
      characteristic.on(CharacteristicEventTypes.SUBSCRIBE, subscribeSpy);
      characteristic.on(CharacteristicEventTypes.UNSUBSCRIBE, unsubscribeSpy);
      characteristic.subscribe();
      characteristic.unsubscribe();

      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
      // @ts-expect-error
      expect(characteristic.subscriptions).toEqual(0);
    });

    it('correctly removes multiple subscriptions', () => {
      const characteristic = createCharacteristic(Formats.BOOL);
      const subscribeSpy = jest.fn();
      const unsubscribeSpy = jest.fn();
      characteristic.on(CharacteristicEventTypes.SUBSCRIBE, subscribeSpy);
      characteristic.on(CharacteristicEventTypes.UNSUBSCRIBE, unsubscribeSpy);
      characteristic.subscribe();
      characteristic.subscribe();
      characteristic.subscribe();
      characteristic.unsubscribe();
      characteristic.unsubscribe();
      characteristic.unsubscribe();

      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
      // @ts-expect-error
      expect(characteristic.subscriptions).toEqual(0);
    });
  });

  describe('#handleGetRequest()', () => {
    it('should handle special event only characteristics', (callback) => {
      const characteristic = createCharacteristic(Formats.BOOL, Characteristic.ProgrammableSwitchEvent.UUID);

      characteristic.handleGetRequest().then(() => {
        expect(characteristic.statusCode).toEqual(HAPStatus.SUCCESS);
        expect(characteristic.value).toEqual(null);
        callback();
      });
    });

    it('should return cached values if no listeners are registered', (callback) => {
      const characteristic = createCharacteristic(Formats.BOOL);

      characteristic.handleGetRequest().then(() => {
        expect(characteristic.statusCode).toEqual(HAPStatus.SUCCESS);
        expect(characteristic.value).toEqual(null);
        callback();
      });
    });
  });

  describe('#validateClientSuppliedValue()', () => {
    it('rejects undefined values from client', async () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.UINT8,
        maxValue: 1,
        minValue: 0,
        minStep: 1,
        perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-expect-error
      const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

      // set initial known good value
      characteristic.setValue(1);

      // this should throw an error
      await expect(characteristic.handleSetRequest(undefined as unknown as boolean, null as unknown as undefined))
        .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

      // the existing valid value should remain
      expect(characteristic.value).toEqual(1);

      // ensure validator was actually called
      expect(validateClientSuppliedValueMock).toBeCalled();
    });

    it('rejects invalid values for the boolean format type', async () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.BOOL,
        maxValue: 1,
        minValue: 0,
        minStep: 1,
        perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-expect-error
      const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

      // set initial known good value
      characteristic.setValue(true);

      // numbers other than 1 or 0 should throw an error
      await expect(characteristic.handleSetRequest(20, null as unknown as undefined))
        .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

      // strings should throw an error
      await expect(characteristic.handleSetRequest("true", null as unknown as undefined))
        .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

      // the existing valid value should remain
      expect(characteristic.value).toEqual(true);

      // 0 should set the value to false
      await expect(characteristic.handleSetRequest(0, null as unknown as undefined))
        .resolves.toEqual(undefined);
      expect(characteristic.value).toEqual(false);

      // 1 should set the value to true
      await expect(characteristic.handleSetRequest(1, null as unknown as undefined))
        .resolves.toEqual(undefined);
      expect(characteristic.value).toEqual(true);

      // ensure validator was actually called
      expect(validateClientSuppliedValueMock).toBeCalledTimes(4);
    });

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "boolean types sent for %p types should be transformed from false to 0", async (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          maxValue: 1,
          minValue: 0,
          minStep: 1,
          perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
        });

        // @ts-expect-error
        const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

        await characteristic.handleSetRequest(false, null as unknown as undefined);
        expect(characteristic.value).toEqual(0);

        // ensure validator was actually called
        expect(validateClientSuppliedValueMock).toBeCalled();
      });


    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "boolean types sent for %p types should be transformed from true to 1", async (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          maxValue: 1,
          minValue: 0,
          minStep: 1,
          perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
        });

        // @ts-expect-error
        const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

        await characteristic.handleSetRequest(true, null as unknown as undefined);
        expect(characteristic.value).toEqual(1);

        // ensure validator was actually called
        expect(validateClientSuppliedValueMock).toBeCalled();
      });

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "rejects string values sent for %p types sent from client", async (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          maxValue: 1,
          minValue: 0,
          minStep: 1,
          perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
        });

        // @ts-expect-error
        const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

        // set initial known good value
        characteristic.setValue(1);

        // this should throw an error
        await expect(characteristic.handleSetRequest("what is this!", null as unknown as undefined))
          .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST)

        // the existing valid value should remain
        expect(characteristic.value).toEqual(1);

        // ensure validator was actually called
        expect(validateClientSuppliedValueMock).toBeCalled();
      });

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "ensure maxValue is not exceeded for %p types sent from client", async (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          maxValue: 1,
          minValue: 0,
          minStep: 1,
          perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
        });

        // @ts-expect-error
        const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

        // set initial known good value
        characteristic.setValue(1);

        // this should throw an error
        await expect(characteristic.handleSetRequest(100, null as unknown as undefined))
          .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST)

        // this should throw an error
        await expect(characteristic.handleSetRequest(-100, null as unknown as undefined))
          .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST)

        // value should revert to
        expect(characteristic.value).toEqual(1);

        // this should pass
        await expect(characteristic.handleSetRequest(0, null as unknown as undefined))
          .resolves.toEqual(undefined);

        // value should now be 3
        expect(characteristic.value).toEqual(0);

        // ensure validator was actually called
        expect(validateClientSuppliedValueMock).toBeCalledTimes(3);
      });

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "ensure NaN is rejected for %p types sent from client", async (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          maxValue: 1,
          minValue: 0,
          minStep: 1,
          perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
        });

        // @ts-expect-error
        const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

        // set initial known good value
        characteristic.setValue(1);

        // this should throw an error
        await expect(characteristic.handleSetRequest(NaN, null as unknown as undefined))
          .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST)

        // value should revert to
        expect(characteristic.value).toEqual(1);

        // ensure validator was actually called
        expect(validateClientSuppliedValueMock).toBeCalledTimes(1);
      });

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "ensure non-finite values are rejected for %p types sent from client", async (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
        });

        // @ts-expect-error
        const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

        // set initial known good value
        characteristic.setValue(1);

        // this should throw an error
        await expect(characteristic.handleSetRequest(Infinity, null as unknown as undefined))
          .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST)

        // value should revert to
        expect(characteristic.value).toEqual(1);

        // ensure validator was actually called
        expect(validateClientSuppliedValueMock).toBeCalledTimes(1);
      });

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "ensure value is rejected if outside valid values for %p types sent from client", async (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          maxValue: 10,
          minValue: 0,
          minStep: 1,
          validValues: [1, 3, 5, 10],
          perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
        });

        // @ts-expect-error
        const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

        // set initial known good value
        characteristic.setValue(1);

        // this should throw an error
        await expect(characteristic.handleSetRequest(6, null as unknown as undefined))
          .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST)

        // value should revert to
        expect(characteristic.value).toEqual(1);

        // this should pass
        await expect(characteristic.handleSetRequest(3, null as unknown as undefined))
          .resolves.toEqual(undefined);

        // value should now be 3
        expect(characteristic.value).toEqual(3);

        // ensure validator was actually called
        expect(validateClientSuppliedValueMock).toBeCalledTimes(2);
      });

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "ensure value is rejected if outside valid value ranges for %p types sent from client", async (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          maxValue: 1000,
          minValue: 0,
          minStep: 1,
          validValueRanges: [50, 55],
          perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
        });

        // @ts-expect-error
        const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

        // set initial known good value
        characteristic.setValue(50);

        // this should throw an error
        await expect(characteristic.handleSetRequest(100, null as unknown as undefined))
          .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

        // this should throw an error
        await expect(characteristic.handleSetRequest(20, null as unknown as undefined))
          .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

        // value should still be 50
        expect(characteristic.value).toEqual(50);

        // this should pass
        await expect(characteristic.handleSetRequest(52, null as unknown as undefined))
          .resolves.toEqual(undefined);

        // value should now be 52
        expect(characteristic.value).toEqual(52);

        // ensure validator was actually called
        expect(validateClientSuppliedValueMock).toBeCalledTimes(3);
      });

    test.each([Formats.STRING, Formats.TLV8, Formats.DATA])(
      "rejects non-string values for the %p format type from the client", async (stringType) => {
      const characteristic = createCharacteristicWithProps({
        format: stringType,
        perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-expect-error
      const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

      // set initial known good value
      characteristic.setValue('some string');

      // numbers should throw an error
      await expect(characteristic.handleSetRequest(1234, null as unknown as undefined))
        .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

      // booleans should throw an error
      await expect(characteristic.handleSetRequest(false, null as unknown as undefined))
        .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

      // the existing valid value should remain
      expect(characteristic.value).toEqual('some string');

      // strings should pass
      await expect(characteristic.handleSetRequest('some other test string', null as unknown as undefined))
        .resolves.toEqual(undefined);

      // value should now be updated
      expect(characteristic.value).toEqual('some other test string');

      // ensure validator was actually called
      expect(validateClientSuppliedValueMock).toBeCalledTimes(3);
    });

    it('should accept Formats.FLOAT with precision provided by client', async () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-expect-error
      const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

      // set initial known good value
      characteristic.setValue(0.0005);

      // the existing valid value should remain
      expect(characteristic.value).toEqual(0.0005);

      // should allow float
      await expect(characteristic.handleSetRequest(0.0001005, null as unknown as undefined))
        .resolves.toEqual(undefined);

      // value should now be updated
      expect(characteristic.value).toEqual(0.0001005);

      // ensure validator was actually called
      expect(validateClientSuppliedValueMock).toBeCalledTimes(1);
    });

    it("should accept negative floats in range for Formats.FLOAT provided by the client", async () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
        minValue: -1000,
        maxValue: 1000,
      });

      // @ts-expect-error - spying on private property
      const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

      // should allow negative float
      await expect(characteristic.handleSetRequest(-0.013, null as unknown as undefined))
        .resolves.toEqual(undefined);

      // value should now be updated
      expect(characteristic.value).toEqual(-0.013);

      // ensure validator was actually called
      expect(validateClientSuppliedValueMock).toBeCalledTimes(1);
    });

    it('rejects string values exceeding the max length from the client', async () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.STRING,
        maxLen: 5,
        perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-expect-error
      const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

      // set initial known good value
      characteristic.setValue('abcde');

      // should reject strings that are to long
      await expect(characteristic.handleSetRequest('this is to long', null as unknown as undefined))
        .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

      // the existing valid value should remain
      expect(characteristic.value).toEqual('abcde');

      // strings should pass
      await expect(characteristic.handleSetRequest('abc', null as unknown as undefined))
        .resolves.toEqual(undefined);

      // value should now be updated
      expect(characteristic.value).toEqual('abc');

      // ensure validator was actually called
      expect(validateClientSuppliedValueMock).toBeCalledTimes(2);
    });

    it('rejects data values exceeding the max length from the client', async () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.DATA,
        maxDataLen: 5,
        perms: [Perms.EVENTS, Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-expect-error
      const validateClientSuppliedValueMock = jest.spyOn(characteristic, 'validateClientSuppliedValue');

      // set initial known good value
      characteristic.setValue('abcde');

      // should reject strings that are to long
      await expect(characteristic.handleSetRequest('this is to long', null as unknown as undefined))
        .rejects.toEqual(HAPStatus.INVALID_VALUE_IN_REQUEST);

      // the existing valid value should remain
      expect(characteristic.value).toEqual('abcde');

      // strings should pass
      await expect(characteristic.handleSetRequest('abc', null as unknown as undefined))
        .resolves.toEqual(undefined);

      // value should now be updated
      expect(characteristic.value).toEqual('abc');

      // ensure validator was actually called
      expect(validateClientSuppliedValueMock).toBeCalledTimes(2);
    });

  });

  describe('#validateUserInput()', () => {

    it('should validate an integer property', () => {
      const VALUE = 1024;
      const characteristic = createCharacteristic(Formats.INT);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a float property', () => {
      const VALUE = 1.024;
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        minStep: 0.001,
        perms: [Perms.NOTIFY],
      });
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a UINT8 property', () => {
      const VALUE = 10;
      const characteristic = createCharacteristic(Formats.UINT8);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a UINT16 property', () => {
      const VALUE = 10;
      const characteristic = createCharacteristic(Formats.UINT16);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a UINT32 property', () => {
      const VALUE = 10;
      const characteristic = createCharacteristic(Formats.UINT32);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a UINT64 property', () => {
      const VALUE = 10;
      const characteristic = createCharacteristic(Formats.UINT64);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a boolean property', () => {
      const VALUE = true;
      const characteristic = createCharacteristic(Formats.BOOL);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a string property', () => {
      const VALUE = 'Test';
      const characteristic = createCharacteristic(Formats.STRING);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a data property', () => {
      const VALUE = Buffer.from("Hello my good friend. Have a nice day!", "ascii").toString("base64");
      const characteristic = createCharacteristic(Formats.DATA);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a TLV8 property', () => {
      const VALUE = '';
      const characteristic = createCharacteristic(Formats.TLV8);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate a dictionary property', () => {
      const VALUE = {};
      const characteristic = createCharacteristic(Formats.DICTIONARY);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it('should validate an array property', () => {
      const VALUE = ['asd'];
      const characteristic = createCharacteristic(Formats.ARRAY);
      // @ts-expect-error
      expect(characteristic.validateUserInput(VALUE)).toEqual(VALUE);
    });

    it("should validate boolean inputs", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.BOOL,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      characteristic.setValue(true);
      expect(characteristic.value).toEqual(true);

      characteristic.setValue(false);
      expect(characteristic.value).toEqual(false);

      characteristic.setValue(1);
      expect(characteristic.value).toEqual(true);

      characteristic.setValue(0);
      expect(characteristic.value).toEqual(false);

      characteristic.setValue("1");
      expect(characteristic.value).toEqual(true);

      characteristic.setValue("true");
      expect(characteristic.value).toEqual(true);

      characteristic.setValue("0");
      expect(characteristic.value).toEqual(false);

      characteristic.setValue("false");
      expect(characteristic.value).toEqual(false);

      characteristic.setValue({ some: 'object' });
      expect(characteristic.value).toEqual(false);
      expect(mock).toBeCalledTimes(1);
    });

    it("should validate boolean inputs when value is undefined", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.BOOL,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      characteristic.setValue(undefined as unknown as boolean);
      expect(characteristic.value).toEqual(false);
      expect(mock).toBeCalledTimes(1);
    });

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "should validate %p inputs", (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
          minValue: 0,
          maxValue: 100,
        });

        // @ts-ignore - spying on private property
        const mock = jest.spyOn(characteristic, 'characteristicWarning');

        characteristic.setValue(1);
        expect(characteristic.value).toEqual(1);

        // round to nearest valid value, trigger warning
        mock.mockReset();
        characteristic.setValue(-100);
        expect(characteristic.value).toEqual(0);
        expect(mock).toBeCalledTimes(1);

        // round to nearest valid value, trigger warning
        mock.mockReset();
        characteristic.setValue(200);
        expect(characteristic.value).toEqual(100);
        expect(mock).toBeCalledTimes(1);

        // parse string
        mock.mockReset();
        characteristic.setValue('50');
        expect(characteristic.value).toEqual(50);
        expect(mock).toBeCalledTimes(0);

        // handle NaN from non-numeric string, restore last known value, trigger warning
        mock.mockReset();
        characteristic.setValue(50);
        characteristic.setValue('SOME STRING');
        expect(characteristic.value).toEqual(50);
        expect(mock).toBeCalledTimes(1);
        expect(mock).toBeCalledWith(expect.stringContaining('NaN'))

        // handle NaN: number from number value
        mock.mockReset();
        characteristic.setValue(50);
        characteristic.setValue(NaN);
        expect(characteristic.value).toEqual(50);
        expect(mock).toBeCalledTimes(1);
        expect(mock).toBeCalledWith(expect.stringContaining('NaN'))

        // handle object, restore last known value, trigger warning
        mock.mockReset();
        characteristic.setValue(50);
        characteristic.setValue({ some: 'object' });
        expect(characteristic.value).toEqual(50);
        expect(mock).toBeCalledTimes(1);

        // handle boolean - true -> 1
        mock.mockReset();
        characteristic.setValue(true);
        expect(characteristic.value).toEqual(1);
        expect(mock).toBeCalledTimes(0);

        // handle boolean - false -> 0
        mock.mockReset();
        characteristic.setValue(false);
        expect(characteristic.value).toEqual(0);
        expect(mock).toBeCalledTimes(0);
      }
    );

    test.each([Formats.INT, Formats.FLOAT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "should validate %p inputs when value is undefined", (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
          minValue: 0,
          maxValue: 100,
        });

        // @ts-ignore - spying on private property
        const mock = jest.spyOn(characteristic, 'characteristicWarning');

        // undefined values should be set to the minValue if not yet set
        mock.mockReset();
        characteristic.setValue(undefined as unknown as boolean);
        expect(characteristic.value).toEqual(0);
        expect(mock).toBeCalledTimes(1);

        // undefined values should be set to the existing value if set
        mock.mockReset();
        characteristic.setValue(50);
        characteristic.setValue(undefined as unknown as boolean);
        expect(characteristic.value).toEqual(50);
        expect(mock).toBeCalledTimes(1);
      }
    );

    test.each([Formats.INT, Formats.UINT8, Formats.UINT16, Formats.UINT32, Formats.UINT64])(
      "should round when a float is provided for %p inputs", (intType) => {
        const characteristic = createCharacteristicWithProps({
          format: intType,
          perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
          minValue: 0,
          maxValue: 100,
        });

        characteristic.setValue(99.5);
        expect(characteristic.value).toEqual(100);

        characteristic.setValue(0.1);
        expect(characteristic.value).toEqual(0);
      }
    );

    it("should not round floats for Formats.FLOAT", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
        minValue: 0,
        maxValue: 100,
      });

      characteristic.setValue(99.5);
      expect(characteristic.value).toEqual(99.5);

      characteristic.setValue(0.1);
      expect(characteristic.value).toEqual(0.1);
    });

    it("should validate Formats.FLOAT with precision", () => {
      const characteristic = new Characteristic.CurrentAmbientLightLevel();

      // @ts-expect-error - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      mock.mockReset();
      characteristic.setValue(0);
      expect(characteristic.value).toEqual(0.0001);
      expect(mock).toBeCalledTimes(1);

      mock.mockReset();
      characteristic.setValue(0.0001);
      expect(characteristic.value).toEqual(0.0001);
      expect(mock).toBeCalledTimes(0);

      mock.mockReset();
      characteristic.setValue('0.0001');
      expect(characteristic.value).toEqual(0.0001);
      expect(mock).toBeCalledTimes(0);

      mock.mockReset();
      characteristic.setValue(100000.00000001);
      expect(characteristic.value).toEqual(100000);
      expect(mock).toBeCalledTimes(1);

      mock.mockReset();
      characteristic.setValue(100000);
      expect(characteristic.value).toEqual(100000);
      expect(mock).toBeCalledTimes(0);
    });

    it("should allow negative floats in range for Formats.FLOAT", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
        minValue: -1000,
        maxValue: 1000,
      });

      // @ts-expect-error - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      mock.mockReset();
      characteristic.setValue(-0.013);
      expect(characteristic.value).toEqual(-0.013);
      expect(mock).toBeCalledTimes(0);
    });

    it("should not allow non-finite floats in range for Formats.FLOAT", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.FLOAT,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-expect-error - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      mock.mockReset();
      characteristic.setValue(Infinity);
      expect(characteristic.value).toEqual(0);
      expect(mock).toBeCalledTimes(1);

      mock.mockReset();
      characteristic.setValue(Number.POSITIVE_INFINITY);
      expect(characteristic.value).toEqual(0);
      expect(mock).toBeCalledTimes(1);

      mock.mockReset();
      characteristic.setValue(Number.NEGATIVE_INFINITY);
      expect(characteristic.value).toEqual(0);
      expect(mock).toBeCalledTimes(1);
    });

    it("should validate string inputs", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
        maxLen: 15,
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // valid string
      mock.mockReset();
      characteristic.setValue("ok string");
      expect(characteristic.value).toEqual("ok string");
      expect(mock).toBeCalledTimes(0);

      // number - convert to string - trigger warning
      mock.mockReset();
      characteristic.setValue(12345);
      expect(characteristic.value).toEqual("12345");
      expect(mock).toBeCalledTimes(1);

      // not a string or number, use last known good value and trigger warning
      mock.mockReset();
      characteristic.setValue("ok string");
      characteristic.setValue({ ok: 'an object' });
      expect(characteristic.value).toEqual("ok string");
      expect(mock).toBeCalledTimes(1);

      // max length exceeded
      mock.mockReset();
      characteristic.setValue("this string exceeds the max length allowed");
      expect(characteristic.value).toEqual("this string exc");
      expect(mock).toBeCalledTimes(1);
    });

    it("should validate string inputs when undefined", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.STRING,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
        maxLen: 15,
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // undefined values should be set to "undefined" of no valid value is set yet
      mock.mockReset();
      characteristic.setValue(undefined as unknown as boolean);
      expect(characteristic.value).toEqual("undefined");
      expect(mock).toBeCalledTimes(1);

      // undefined values should revert back to last known good value if set
      mock.mockReset();
      characteristic.setValue("ok string");
      characteristic.setValue(undefined as unknown as boolean);
      expect(characteristic.value).toEqual("ok string");
      expect(mock).toBeCalledTimes(1);
    });

    it("should validate data type intputs", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.DATA,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
        maxDataLen: 15,
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // valid data
      mock.mockReset();
      characteristic.setValue("some data");
      expect(characteristic.value).toEqual("some data");
      expect(mock).toBeCalledTimes(0);

      // not valid data
      mock.mockReset();
      characteristic.setValue({ some: 'data' });
      expect(mock).toBeCalledTimes(1);

      // max length exceeded
      mock.mockReset();
      characteristic.setValue("this string exceeds the max length allowed");
      expect(mock).toBeCalledTimes(1);
    });

    it("should handle null inputs correctly for scalar Apple characteristics", () => {
      const characteristic = new Characteristic('CurrentTemperature', Characteristic.CurrentTemperature.UUID, {
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
        format: Formats.FLOAT,
        minValue: 0,
        maxValue: 100,
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // if the initial value is null, validation should set a valid default
      mock.mockReset();
      characteristic.setValue(null as unknown as boolean);
      expect(characteristic.value).toEqual(0);
      expect(mock).toBeCalledTimes(2);

      // if the value has been previously set, and null is received, the previous value should be returned,
      mock.mockReset();
      characteristic.setValue(50);
      characteristic.setValue(null as unknown as boolean);
      expect(characteristic.value).toEqual(50);
      expect(mock).toBeCalledTimes(1);
    });

    it("should handle null inputs correctly for scalar non-scalar Apple characteristics", () => {
      const characteristicTLV = new SelectedRTPStreamConfiguration();
      const characteristicData = new Characteristic("Data characteristic", Characteristic.SupportedRTPConfiguration.UUID, {
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
        format: Formats.DATA,
      });

      const exampleString = "Example String"; // data and tlv8 are both string based

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristicTLV, 'characteristicWarning');

      // null is a valid value for tlv8 format
      mock.mockReset();
      characteristicTLV.setValue(exampleString);
      expect(characteristicTLV.value).toEqual(exampleString);
      characteristicTLV.setValue(null as unknown as string);
      expect(characteristicTLV.value).toEqual(null);
      expect(mock).toBeCalledTimes(0);

      // null is a valid value for data format
      mock.mockReset();
      characteristicData.setValue(exampleString);
      expect(characteristicData.value).toEqual(exampleString);
      characteristicData.setValue(null as unknown as string);
      expect(characteristicData.value).toEqual(null);
      expect(mock).toBeCalledTimes(0);
    });

    it("should handle null inputs correctly for non-Apple characteristics", () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE]
      });

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // if the initial value is null, still allow null for non-Apple characteristics
      mock.mockReset();
      characteristic.setValue(null as unknown as boolean);
      expect(characteristic.value).toEqual(null);
      expect(mock).toBeCalledTimes(0);

      // if the value has been previously set, and null is received, still allow null for non-Apple characteristics
      mock.mockReset();
      characteristic.setValue(50);
      characteristic.setValue(null as unknown as boolean);
      expect(characteristic.value).toEqual(null);
      expect(mock).toBeCalledTimes(0);
    });
  });

  describe('#getDefaultValue()', () => {

    it('should get the correct default value for a boolean property', () => {
      const characteristic = createCharacteristic(Formats.BOOL);
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(false);
    });

    it('should get the correct default value for a string property', () => {
      const characteristic = createCharacteristic(Formats.STRING);
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual('');
    });

    it('should get the correct default value for a data property', () => {
      const characteristic = createCharacteristic(Formats.DATA);
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(null);
    });

    it('should get the correct default value for a TLV8 property', () => {
      const characteristic = createCharacteristic(Formats.TLV8);
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(null);
    });

    it('should get the correct default value for a dictionary property', () => {
      const characteristic = createCharacteristic(Formats.DICTIONARY);
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual({});
    });

    it('should get the correct default value for an array property', () => {
      const characteristic = createCharacteristic(Formats.ARRAY);
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual([]);
    });

    it('should get the correct default value a UINT8 property without minValue', () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.UINT8,
        perms: [Perms.TIMED_WRITE, Perms.PAIRED_READ],
      });
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(0);
      expect(characteristic.value).toEqual(null); // null if never set
    });

    it('should get the correct default value a UINT8 property with minValue', () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.UINT8,
        perms: [Perms.TIMED_WRITE, Perms.PAIRED_READ],
        minValue: 50,
      });
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(50);
      expect(characteristic.value).toEqual(null); // null if never set
    });

    it('should get the correct default value a INT property without minValue', () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.TIMED_WRITE, Perms.PAIRED_READ],
      });
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(0);
      expect(characteristic.value).toEqual(null); // null if never set
    });

    it('should get the correct default value a INT property with minValue', () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.TIMED_WRITE, Perms.PAIRED_READ],
        minValue: 50,
      });
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(50);
      expect(characteristic.value).toEqual(null); // null if never set
    });

    it('should get the correct default value for the current temperature characteristic', () => {
      const characteristic = new Characteristic.CurrentTemperature();
      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(0);
      expect(characteristic.value).toEqual(0);
    });

    it('should get the default value from the first item in the validValues prop', () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.TIMED_WRITE, Perms.PAIRED_READ],
        validValues: [5, 4, 3, 2]
      });

      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(5);
      expect(characteristic.value).toEqual(null); // null if never set
    });

    it('should get the default value from minValue prop if set', () => {
      const characteristic = createCharacteristicWithProps({
        format: Formats.INT,
        perms: [Perms.TIMED_WRITE, Perms.PAIRED_READ],
        minValue: 100,
        maxValue: 255,
      });

      // @ts-expect-error
      expect(characteristic.getDefaultValue()).toEqual(100);
      expect(characteristic.value).toEqual(null); // null if never set
    });

  });

  describe('#toHAP()', () => {

  });

  describe(`@${CharacteristicEventTypes.GET}`, () => {
    it('should call any listeners for the event', (callback) => {
      const characteristic = createCharacteristic(Formats.STRING);

      const listenerCallback = jest.fn();

      characteristic.handleGetRequest().then(() => {
        characteristic.on(CharacteristicEventTypes.GET, listenerCallback);
        characteristic.handleGetRequest();
        expect(listenerCallback).toHaveBeenCalledTimes(1);
        callback();
      })
    });

    it("should handle GET event errors gracefully when using on('get')", async () => {
      const characteristic = createCharacteristic(Formats.STRING);

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // throw HapStatusError - should not trigger characteristic warning
      mock.mockReset();
      characteristic.removeAllListeners('get');
      characteristic.on('get', (callback) => {
        callback(new HapStatusError(HAPStatus.RESOURCE_BUSY));
      });
      await expect(characteristic.handleGetRequest()).rejects.toEqual(HAPStatus.RESOURCE_BUSY)
      expect(characteristic.statusCode).toEqual(HAPStatus.RESOURCE_BUSY);
      expect(mock).toBeCalledTimes(0);

      // throw number - should not trigger characteristic warning
      mock.mockReset();
      characteristic.removeAllListeners('get');
      characteristic.on('get', (callback) => {
        callback(HAPStatus.RESOURCE_BUSY);
      });
      await expect(characteristic.handleGetRequest()).rejects.toEqual(HAPStatus.RESOURCE_BUSY)
      expect(characteristic.statusCode).toEqual(HAPStatus.RESOURCE_BUSY);
      expect(mock).toBeCalledTimes(0);

      // throw out of range number - should convert status code to SERVICE_COMMUNICATION_FAILURE
      mock.mockReset();
      characteristic.removeAllListeners('get');
      characteristic.on('get', (callback) => {
        callback(234234234234);
      });
      await expect(characteristic.handleGetRequest()).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(0);

      // throw other error - callback style getters should still not trigger warning when error is passed in
      mock.mockReset();
      characteristic.removeAllListeners('get');
      characteristic.on('get', (callback) => {
        callback(new Error('Something else'));
      });
      await expect(characteristic.handleGetRequest()).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(0);
    });
  });

  describe("onGet handler", () => {
    it("should ignore GET event handler when onGet was specified", async () => {
      const characteristic = createCharacteristic(Formats.STRING);

      const listenerCallback = jest.fn().mockImplementation((callback) => {
        callback(undefined, "OddValue");
      });
      const handlerMock = jest.fn();

      characteristic.onGet(() => {
        handlerMock();
        return "CurrentValue";
      });
      characteristic.on(CharacteristicEventTypes.GET, listenerCallback);
      const value = await characteristic.handleGetRequest();

      expect(value).toEqual("CurrentValue");
      expect(handlerMock).toHaveBeenCalledTimes(1);
      expect(listenerCallback).toHaveBeenCalledTimes(0);
    });

    it("should handle GET event errors gracefully when using the onGet handler", async () => {
      const characteristic = createCharacteristic(Formats.STRING);

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // throw HapStatusError - should not trigger characteristic warning
      mock.mockReset();
      characteristic.onGet(() => {
        throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      });
      await expect(characteristic.handleGetRequest()).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(0);

      // throw number - should not trigger characteristic warning
      mock.mockReset();
      characteristic.onGet(() => {
        throw HAPStatus.SERVICE_COMMUNICATION_FAILURE;
      });
      await expect(characteristic.handleGetRequest()).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(0);

      // throw out of range number - should convert status code to SERVICE_COMMUNICATION_FAILURE
      mock.mockReset();
      characteristic.onGet(() => {
        throw 234234234234;
      });
      await expect(characteristic.handleGetRequest()).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(0);

      // throw other error - should trigger characteristic warning
      mock.mockReset();
      characteristic.onGet(() => {
        throw new Error('A Random Error');
      });
      await expect(characteristic.handleGetRequest()).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(1);
    });
  });

  describe(`@${CharacteristicEventTypes.SET}`, () => {
    it('should call any listeners for the event', () => {
      const characteristic = createCharacteristic(Formats.STRING);

      const VALUE = 'NewValue';
      const listenerCallback = jest.fn();

      characteristic.handleSetRequest(VALUE);
      characteristic.on(CharacteristicEventTypes.SET, listenerCallback);
      characteristic.handleSetRequest(VALUE);

      expect(listenerCallback).toHaveBeenCalledTimes(1);
    });

    it("should handle SET event errors gracefully when using on('set')", async () => {
      const characteristic = createCharacteristic(Formats.STRING);

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // throw HapStatusError - should not trigger characteristic warning
      mock.mockReset();
      characteristic.removeAllListeners('set');
      characteristic.on('set', (value, callback) => {
        callback(new HapStatusError(HAPStatus.RESOURCE_BUSY));
      });
      await expect(characteristic.handleSetRequest('hello')).rejects.toEqual(HAPStatus.RESOURCE_BUSY)
      expect(characteristic.statusCode).toEqual(HAPStatus.RESOURCE_BUSY);
      expect(mock).toBeCalledTimes(0);

      // throw number - should not trigger characteristic warning
      mock.mockReset();
      characteristic.removeAllListeners('set');
      characteristic.on('set', (value, callback) => {
        callback(HAPStatus.RESOURCE_BUSY);
      });
      await expect(characteristic.handleSetRequest('hello')).rejects.toEqual(HAPStatus.RESOURCE_BUSY)
      expect(characteristic.statusCode).toEqual(HAPStatus.RESOURCE_BUSY);
      expect(mock).toBeCalledTimes(0);

      // throw out of range number - should convert status code to SERVICE_COMMUNICATION_FAILURE
      mock.mockReset();
      characteristic.removeAllListeners('set');
      characteristic.on('set', (value, callback) => {
        callback(234234234234);
      });
      await expect(characteristic.handleSetRequest('hello')).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(0);

      // throw other error - callback style setters should still not trigger warning when error is passed in
      mock.mockReset();
      characteristic.removeAllListeners('set');
      characteristic.on('set', (value, callback) => {
        callback(new Error('Something else'));
      });
      await expect(characteristic.handleSetRequest('hello')).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(0);
    });
  });

  describe("onSet handler", () => {
    it("should ignore SET event handler when onSet was specified", () => {
      const characteristic = createCharacteristic(Formats.STRING);

      const listenerCallback = jest.fn();
      const handlerMock = jest.fn();

      characteristic.onSet(value => {
        handlerMock(value);
        expect(value).toEqual("NewValue");
        return;
      });
      characteristic.on(CharacteristicEventTypes.SET, listenerCallback);
      characteristic.handleSetRequest("NewValue");

      expect(handlerMock).toHaveBeenCalledTimes(1);
      expect(listenerCallback).toHaveBeenCalledTimes(0);
    });

    it("should handle SET event errors gracefully when using onSet handler", async () => {
      const characteristic = createCharacteristic(Formats.STRING);

      // @ts-ignore - spying on private property
      const mock = jest.spyOn(characteristic, 'characteristicWarning');

      // throw HapStatusError - should not trigger characteristic warning
      mock.mockReset();
      characteristic.onSet(() => {
        throw new HapStatusError(HAPStatus.RESOURCE_BUSY);
      });
      await expect(characteristic.handleSetRequest('hello')).rejects.toEqual(HAPStatus.RESOURCE_BUSY)
      expect(characteristic.statusCode).toEqual(HAPStatus.RESOURCE_BUSY);
      expect(mock).toBeCalledTimes(0);

      // throw number - should not trigger characteristic warning
      mock.mockReset();
      characteristic.onSet(() => {
        throw HAPStatus.RESOURCE_BUSY;
      });
      await expect(characteristic.handleSetRequest('hello')).rejects.toEqual(HAPStatus.RESOURCE_BUSY)
      expect(characteristic.statusCode).toEqual(HAPStatus.RESOURCE_BUSY);
      expect(mock).toBeCalledTimes(0);

      // throw out of range number - should convert status code to SERVICE_COMMUNICATION_FAILURE
      mock.mockReset();
      characteristic.onSet(() => {
        throw 234234234234;
      });
      await expect(characteristic.handleSetRequest('hello')).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(0);

      // throw other error - should trigger characteristic warning
      mock.mockReset();
      characteristic.onSet(() => {
        throw new Error('A Random Error');
      });
      await expect(characteristic.handleSetRequest('hello')).rejects.toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE)
      expect(characteristic.statusCode).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      expect(mock).toBeCalledTimes(1);
    });
  });

  describe(`@${CharacteristicEventTypes.CHANGE}`, () => {

    it('should call listeners for the event when the characteristic is event-only, and the value is set', (callback) => {
      const characteristic = createCharacteristic(Formats.STRING, Characteristic.ProgrammableSwitchEvent.UUID);

      const VALUE = 'NewValue';
      const listenerCallback = jest.fn();
      const setValueCallback = jest.fn();

      characteristic.setValue(VALUE, () => {
        setValueCallback();

        characteristic.on(CharacteristicEventTypes.CHANGE, listenerCallback);
        characteristic.setValue(VALUE, () => {
          setValueCallback();

          expect(listenerCallback).toHaveBeenCalledTimes(1);
          expect(setValueCallback).toHaveBeenCalledTimes(2);
          callback();
        });
      })
    });

    it('should call any listeners for the event when the characteristic is event-only, and the value is updated', () => {
      const characteristic = createCharacteristic(Formats.STRING);
      // characteristic.eventOnlyCharacteristic = true;

      const VALUE = 'NewValue';
      const listenerCallback = jest.fn();
      const updateValueCallback = jest.fn();

      characteristic.on(CharacteristicEventTypes.CHANGE, listenerCallback);
      // noinspection JSDeprecatedSymbols
      characteristic.updateValue(VALUE, updateValueCallback)

      expect(listenerCallback).toHaveBeenCalledTimes(1);
      expect(updateValueCallback).toHaveBeenCalledTimes(1);
    });

    it("should call the change listener with proper context when supplied as second argument to updateValue", () => {
      const characteristic = createCharacteristic(Formats.STRING);

      const VALUE = "NewValue";
      const CONTEXT = "Context";

      const listener = jest.fn().mockImplementation((change: CharacteristicChange) => {
        expect(change.newValue).toEqual(VALUE);
        expect(change.context).toEqual(CONTEXT);
      });

      characteristic.on(CharacteristicEventTypes.CHANGE, listener);
      characteristic.updateValue(VALUE, CONTEXT);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should call the change listener with proper context when supplied as second argument to setValue", () => {
      const characteristic = createCharacteristic(Formats.STRING);

      const VALUE = "NewValue";
      const CONTEXT = "Context";

      const listener = jest.fn().mockImplementation((change: CharacteristicChange) => {
        expect(change.newValue).toEqual(VALUE);
        expect(change.context).toEqual(CONTEXT);
      });

      characteristic.on(CharacteristicEventTypes.CHANGE, listener);
      characteristic.setValue(VALUE, CONTEXT);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe(`@${CharacteristicEventTypes.SUBSCRIBE}`, () => {

    it('should call any listeners for the event', () => {
      const characteristic = createCharacteristic(Formats.STRING);

      const cb = jest.fn();

      characteristic.on(CharacteristicEventTypes.SUBSCRIBE, cb);
      characteristic.subscribe();

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe(`@${CharacteristicEventTypes.UNSUBSCRIBE}`, () => {

    it('should call any listeners for the event', () => {
      const characteristic = createCharacteristic(Formats.STRING);

      const cb = jest.fn();

      characteristic.subscribe();
      characteristic.on(CharacteristicEventTypes.UNSUBSCRIBE, cb);
      characteristic.unsubscribe();

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('should not call any listeners for the event if none are registered', () => {
      const characteristic = createCharacteristic(Formats.STRING);

      const cb = jest.fn();

      characteristic.on(CharacteristicEventTypes.UNSUBSCRIBE, cb);
      characteristic.unsubscribe();

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('#serialize', () => {
    it('should serialize characteristic', () => {
      const props: CharacteristicProps = {
        format: Formats.INT,
        perms: [Perms.TIMED_WRITE, Perms.PAIRED_READ],
        unit: Units.LUX,
        maxValue: 1234,
        minValue: 123,
        validValueRanges: [123, 1234],
        adminOnlyAccess: [Access.WRITE],
      };

      const characteristic = createCharacteristicWithProps(props, Characteristic.ProgrammableSwitchEvent.UUID);
      characteristic.value = "TestValue";

      const json = Characteristic.serialize(characteristic);
      expect(json).toEqual({
        displayName: characteristic.displayName,
        UUID: characteristic.UUID,
        props: props,
        value: "TestValue",
        eventOnlyCharacteristic: true,
      })
    });

    it("should serialize characteristic with proper constructor name", () => {
      const characteristic = new Characteristic.Name();
      characteristic.updateValue("New Name!");

      const json = Characteristic.serialize(characteristic);
      expect(json).toEqual({
        displayName: 'Name',
        UUID: '00000023-0000-1000-8000-0026BB765291',
        eventOnlyCharacteristic: false,
        constructorName: 'Name',
        value: 'New Name!',
        props: { format: 'string', perms: [ 'pr' ], maxLen: 64 }
      });
    });
  });

  describe('#deserialize', () => {
    it('should deserialize legacy json from homebridge', () => {
      const json = JSON.parse('{"displayName": "On", "UUID": "00000025-0000-1000-8000-0026BB765291", ' +
          '"props": {"format": "int", "unit": "seconds", "minValue": 4, "maxValue": 6, "minStep": 0.1, "perms": ["pr", "pw", "ev"]}, ' +
          '"value": false, "eventOnlyCharacteristic": false}');
      const characteristic = Characteristic.deserialize(json);

      expect(characteristic.displayName).toEqual(json.displayName);
      expect(characteristic.UUID).toEqual(json.UUID);
      expect(characteristic.props).toEqual(json.props);
      expect(characteristic.value).toEqual(json.value);
    });

    it('should deserialize complete json', () => {
      const json: SerializedCharacteristic = {
        displayName: "MyName",
        UUID: "00000001-0000-1000-8000-0026BB765291",
        props: {
          format: Formats.INT,
          perms: [Perms.TIMED_WRITE, Perms.PAIRED_READ],
          unit: Units.LUX,
          maxValue: 1234,
          minValue: 123,
          validValueRanges: [123, 1234],
          adminOnlyAccess: [Access.NOTIFY, Access.READ],
        },
        value: "testValue",
        eventOnlyCharacteristic: false,
      };

      const characteristic = Characteristic.deserialize(json);

      expect(characteristic.displayName).toEqual(json.displayName);
      expect(characteristic.UUID).toEqual(json.UUID);
      expect(characteristic.props).toEqual(json.props);
      expect(characteristic.value).toEqual(json.value);
    });

    it("should deserialize from json with constructor name", () => {
      const json: SerializedCharacteristic = {
        displayName: 'Name',
        UUID: '00000023-0000-1000-8000-0026BB765291',
        eventOnlyCharacteristic: false,
        constructorName: 'Name',
        value: 'New Name!',
        props: { format: 'string', perms: [ Perms.PAIRED_READ ], maxLen: 64 }
      };

      const characteristic = Characteristic.deserialize(json);

      expect(characteristic instanceof Characteristic.Name).toBeTruthy();
    });

  });

});
