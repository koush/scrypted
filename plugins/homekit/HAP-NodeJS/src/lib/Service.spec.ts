import { Characteristic, SerializedService, Service, ServiceEventTypes, uuid } from '..';

const createService = () => {
  return new Service('Test', uuid.generate('Foo'), 'subtype');
}

describe('Service', () => {

  describe('#constructor()', () => {
    it('should set the name characteristic to the display name', () => {
      const service = createService();
      expect(service.getCharacteristic(Characteristic.Name)!.value).toEqual('Test');
    });

    it('should fail to load with no UUID', () => {
      expect(() => {
        new Service('Test', '', 'subtype');
      }).toThrow('valid UUID');
    });
  });

  describe('#addCharacteristic()', () => {

  });

  describe('#setHiddenService()', () => {

  });

  describe('#addLinkedService()', () => {

  });

  describe('#removeLinkedService()', () => {

  });

  describe('#removeCharacteristic()', () => {

  });

  describe('#getCharacteristic()', () => {

  });

  describe('#testCharacteristic()', () => {

  });

  describe('#setCharacteristic()', () => {

  });

  describe('#updateCharacteristic()', () => {

  });

  describe('#addOptionalCharacteristic()', () => {

  });

  describe('#getCharacteristicByIID()', () => {

  });

  describe('#toHAP()', () => {

  });

  describe(`@${ServiceEventTypes.CHARACTERISTIC_CHANGE}`, () => {

  });

  describe(`@${ServiceEventTypes.SERVICE_CONFIGURATION_CHANGE}`, () => {

  });

  describe('#serialize', () => {
    it('should serialize service', () => {
      const service = new Service.Lightbulb("TestLight", "subTypeLight");
      service.isHiddenService = true;
      service.isPrimaryService = true;

      const json = Service.serialize(service);
      expect(json.displayName).toEqual(service.displayName);
      expect(json.UUID).toEqual(service.UUID);
      expect(json.subtype).toEqual(service.subtype);
      expect(json.hiddenService).toEqual(service.isHiddenService);
      expect(json.primaryService).toEqual(service.isPrimaryService);

      // just count the elements. If those characteristics are serialized correctly is tested in the Characteristic.spec
      expect(service.characteristics).toBeDefined();
      expect(json.characteristics.length).toEqual(service.characteristics.length);
      expect(service.optionalCharacteristics).toBeDefined();
      expect(json.optionalCharacteristics!.length).toEqual(service.optionalCharacteristics.length);
    });

    it("should serialize service with proper constructor name", () => {
      const service = new Service.Speaker("Speaker Name");

      const json = Service.serialize(service);
      expect(json.constructorName).toBe("Speaker");
    });
  });

  describe('#deserialize', () => {
    it('should deserialize legacy json from homebridge', () => {
      const json = JSON.parse('{"displayName":"Test Light","UUID":"00000043-0000-1000-8000-0026BB765291",' +
          '"characteristics":[{"displayName":"Name","UUID":"00000023-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"string","unit":null,"minValue":null,"maxValue":null,"minStep":null,"perms":["pr"]},' +
          '"value":"Test Light","eventOnlyCharacteristic":false},' +
          '{"displayName":"On","UUID":"00000025-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"bool","unit":null,"minValue":null,"maxValue":null,"minStep":null,"perms":["pr","pw","ev"]},' +
          '"value":false,"eventOnlyCharacteristic":false}]}');
      const service = Service.deserialize(json);

      expect(service.displayName).toEqual(json.displayName);
      expect(service.UUID).toEqual(json.UUID);
      expect(service.subtype).toBeUndefined();
      expect(service.isHiddenService).toEqual(false);
      expect(service.isPrimaryService).toEqual(false);

      // just count the elements. If those characteristics are serialized correctly is tested in the Characteristic.spec
      expect(service.characteristics).toBeDefined();
      expect(service.characteristics.length).toEqual(2);
      expect(service.optionalCharacteristics).toBeDefined();
      expect(service.optionalCharacteristics!.length).toEqual(0); // homebridge didn't save those
    });

    it('should deserialize complete json', () => {
      // json for a light accessory
      const json = JSON.parse('{"displayName":"TestLight","UUID":"00000043-0000-1000-8000-0026BB765291",' +
          '"subtype":"subTypeLight","hiddenService":true,"primaryService":true,' +
          '"characteristics":[{"displayName":"Name","UUID":"00000023-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"string","unit":null,"minValue":null,"maxValue":null,"minStep":null,"perms":["pr"]},' +
          '"value":"TestLight","accessRestrictedToAdmins":[],"eventOnlyCharacteristic":false},' +
          '{"displayName":"On","UUID":"00000025-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"bool","unit":null,"minValue":null,"maxValue":null,"minStep":null,"perms":["pr","pw","ev"]},' +
          '"value":false,"accessRestrictedToAdmins":[],"eventOnlyCharacteristic":false}],' +
          '"optionalCharacteristics":[{"displayName":"Brightness","UUID":"00000008-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"int","unit":"percentage","minValue":0,"maxValue":100,"minStep":1,"perms":["pr","pw","ev"]},' +
          '"value":0,"accessRestrictedToAdmins":[],"eventOnlyCharacteristic":false},' +
          '{"displayName":"Hue","UUID":"00000013-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"float","unit":"arcdegrees","minValue":0,"maxValue":360,"minStep":1,"perms":["pr","pw","ev"]},' +
          '"value":0,"accessRestrictedToAdmins":[],"eventOnlyCharacteristic":false},' +
          '{"displayName":"Saturation","UUID":"0000002F-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"float","unit":"percentage","minValue":0,"maxValue":100,"minStep":1,"perms":["pr","pw","ev"]},' +
          '"value":0,"accessRestrictedToAdmins":[],"eventOnlyCharacteristic":false},' +
          '{"displayName":"Name","UUID":"00000023-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"string","unit":null,"minValue":null,"maxValue":null,"minStep":null,"perms":["pr"]},' +
          '"value":"","accessRestrictedToAdmins":[],"eventOnlyCharacteristic":false},' +
          '{"displayName":"Color Temperature","UUID":"000000CE-0000-1000-8000-0026BB765291",' +
          '"props":{"format":"uint32","unit":null,"minValue":140,"maxValue":500,"minStep":1,"perms":["pr","pw","ev"]},' +
          '"value":140,"accessRestrictedToAdmins":[],"eventOnlyCharacteristic":false}]}');

      const service = Service.deserialize(json);

      expect(service.displayName).toEqual(json.displayName);
      expect(service.UUID).toEqual(json.UUID);
      expect(service.subtype).toEqual(json.subtype);
      expect(service.isHiddenService).toEqual(true);
      expect(service.isPrimaryService).toEqual(true);

      // just count the elements. If those characteristics are serialized correctly is tested in the Characteristic.spec
      expect(service.characteristics).toBeDefined();
      expect(service.characteristics.length).toEqual(2); // On, Name
      expect(service.optionalCharacteristics).toBeDefined();
      expect(service.optionalCharacteristics!.length).toEqual(5); // as defined in the Lightbulb service
    });

    it("should deserialize from json with constructor name", () => {
      const json: SerializedService = JSON.parse('{"displayName":"Speaker Name","UUID":"00000113-0000-1000-8000-0026BB765291",' +
        '"constructorName":"Speaker","hiddenService":false,"primaryService":false,"characteristics":' +
        '[{"displayName":"Name","UUID":"00000023-0000-1000-8000-0026BB765291","eventOnlyCharacteristic":false,"constructorName":"Name",' +
        '"value":"Speaker Name","props":{"format":"string","perms":["pr"],"maxLen":64}},{"displayName":"Mute",' +
        '"UUID":"0000011A-0000-1000-8000-0026BB765291","eventOnlyCharacteristic":false,' +
        '"constructorName":"Mute","value":false,"props":{"format":"bool","perms":["ev","pr","pw"]}}],' +
        '"optionalCharacteristics":[{"displayName":"Active","UUID":"000000B0-0000-1000-8000-0026BB765291",' +
        '"eventOnlyCharacteristic":false,"constructorName":"Active","value":0,"props":{"format":"uint8","perms":["ev","pr","pw"],' +
        '"minValue":0,"maxValue":1,"minStep":1}},{"displayName":"Volume","UUID":"00000119-0000-1000-8000-0026BB765291",' +
        '"eventOnlyCharacteristic":false,"constructorName":"Volume","value":0,"props":{"format":"uint8","perms":["ev","pr","pw"],' +
        '"unit":"percentage","minValue":0,"maxValue":100,"minStep":1}}]}');

      const service = Service.deserialize(json);

      expect(service instanceof Service.Speaker).toBeTruthy();
    });
  });
});
