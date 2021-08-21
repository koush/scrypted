// THIS FILE IS AUTO-GENERATED - DO NOT MODIFY
import "./";

import { Characteristic } from "../Characteristic";
import { Service } from "../Service";

describe("ServiceDefinitions", () => {
  describe("AccessCode", () => {
    it("should be able to construct", () => {
      const service0 = new Service.AccessCode();
      const service1 = new Service.AccessCode("test name");
      const service2 = new Service.AccessCode("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("AccessControl", () => {
    it("should be able to construct", () => {
      const service0 = new Service.AccessControl();
      const service1 = new Service.AccessControl("test name");
      const service2 = new Service.AccessControl("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("AccessoryInformation", () => {
    it("should be able to construct", () => {
      const service0 = new Service.AccessoryInformation();
      const service1 = new Service.AccessoryInformation("test name");
      const service2 = new Service.AccessoryInformation("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("AccessoryRuntimeInformation", () => {
    it("should be able to construct", () => {
      const service0 = new Service.AccessoryRuntimeInformation();
      const service1 = new Service.AccessoryRuntimeInformation("test name");
      const service2 = new Service.AccessoryRuntimeInformation("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("AirPurifier", () => {
    it("should be able to construct", () => {
      const service0 = new Service.AirPurifier();
      const service1 = new Service.AirPurifier("test name");
      const service2 = new Service.AirPurifier("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("AirQualitySensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.AirQualitySensor();
      const service1 = new Service.AirQualitySensor("test name");
      const service2 = new Service.AirQualitySensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("AudioStreamManagement", () => {
    it("should be able to construct", () => {
      const service0 = new Service.AudioStreamManagement();
      const service1 = new Service.AudioStreamManagement("test name");
      const service2 = new Service.AudioStreamManagement("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Battery", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Battery();
      const service1 = new Service.Battery("test name");
      const service2 = new Service.Battery("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
      // noinspection JSDeprecatedSymbols

      new Service.BatteryService();
    });
  });

  describe("BridgeConfiguration", () => {
    it("should be able to construct", () => {
      const service0 = new Service.BridgeConfiguration();
      const service1 = new Service.BridgeConfiguration("test name");
      const service2 = new Service.BridgeConfiguration("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("BridgingState", () => {
    it("should be able to construct", () => {
      const service0 = new Service.BridgingState();
      const service1 = new Service.BridgingState("test name");
      const service2 = new Service.BridgingState("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("CameraControl", () => {
    it("should be able to construct", () => {
      const service0 = new Service.CameraControl();
      const service1 = new Service.CameraControl("test name");
      const service2 = new Service.CameraControl("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("CameraOperatingMode", () => {
    it("should be able to construct", () => {
      const service0 = new Service.CameraOperatingMode();
      const service1 = new Service.CameraOperatingMode("test name");
      const service2 = new Service.CameraOperatingMode("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("CameraRecordingManagement", () => {
    it("should be able to construct", () => {
      const service0 = new Service.CameraRecordingManagement();
      const service1 = new Service.CameraRecordingManagement("test name");
      const service2 = new Service.CameraRecordingManagement("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
      // noinspection JSDeprecatedSymbols

      new Service.CameraEventRecordingManagement();
    });
  });

  describe("CameraRTPStreamManagement", () => {
    it("should be able to construct", () => {
      const service0 = new Service.CameraRTPStreamManagement();
      const service1 = new Service.CameraRTPStreamManagement("test name");
      const service2 = new Service.CameraRTPStreamManagement("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("CarbonDioxideSensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.CarbonDioxideSensor();
      const service1 = new Service.CarbonDioxideSensor("test name");
      const service2 = new Service.CarbonDioxideSensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("CarbonMonoxideSensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.CarbonMonoxideSensor();
      const service1 = new Service.CarbonMonoxideSensor("test name");
      const service2 = new Service.CarbonMonoxideSensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("CloudRelay", () => {
    it("should be able to construct", () => {
      const service0 = new Service.CloudRelay();
      const service1 = new Service.CloudRelay("test name");
      const service2 = new Service.CloudRelay("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
      // noinspection JSDeprecatedSymbols

      new Service.Relay();
    });
  });

  describe("ContactSensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.ContactSensor();
      const service1 = new Service.ContactSensor("test name");
      const service2 = new Service.ContactSensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("DataStreamTransportManagement", () => {
    it("should be able to construct", () => {
      const service0 = new Service.DataStreamTransportManagement();
      const service1 = new Service.DataStreamTransportManagement("test name");
      const service2 = new Service.DataStreamTransportManagement("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Diagnostics", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Diagnostics();
      const service1 = new Service.Diagnostics("test name");
      const service2 = new Service.Diagnostics("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Door", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Door();
      const service1 = new Service.Door("test name");
      const service2 = new Service.Door("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Doorbell", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Doorbell();
      const service1 = new Service.Doorbell("test name");
      const service2 = new Service.Doorbell("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Fan", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Fan();
      const service1 = new Service.Fan("test name");
      const service2 = new Service.Fan("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Fanv2", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Fanv2();
      const service1 = new Service.Fanv2("test name");
      const service2 = new Service.Fanv2("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Faucet", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Faucet();
      const service1 = new Service.Faucet("test name");
      const service2 = new Service.Faucet("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("FilterMaintenance", () => {
    it("should be able to construct", () => {
      const service0 = new Service.FilterMaintenance();
      const service1 = new Service.FilterMaintenance("test name");
      const service2 = new Service.FilterMaintenance("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("GarageDoorOpener", () => {
    it("should be able to construct", () => {
      const service0 = new Service.GarageDoorOpener();
      const service1 = new Service.GarageDoorOpener("test name");
      const service2 = new Service.GarageDoorOpener("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("HeaterCooler", () => {
    it("should be able to construct", () => {
      const service0 = new Service.HeaterCooler();
      const service1 = new Service.HeaterCooler("test name");
      const service2 = new Service.HeaterCooler("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("HumidifierDehumidifier", () => {
    it("should be able to construct", () => {
      const service0 = new Service.HumidifierDehumidifier();
      const service1 = new Service.HumidifierDehumidifier("test name");
      const service2 = new Service.HumidifierDehumidifier("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("HumiditySensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.HumiditySensor();
      const service1 = new Service.HumiditySensor("test name");
      const service2 = new Service.HumiditySensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("InputSource", () => {
    it("should be able to construct", () => {
      const service0 = new Service.InputSource();
      const service1 = new Service.InputSource("test name");
      const service2 = new Service.InputSource("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("IrrigationSystem", () => {
    it("should be able to construct", () => {
      const service0 = new Service.IrrigationSystem();
      const service1 = new Service.IrrigationSystem("test name");
      const service2 = new Service.IrrigationSystem("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("LeakSensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.LeakSensor();
      const service1 = new Service.LeakSensor("test name");
      const service2 = new Service.LeakSensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Lightbulb", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Lightbulb();
      const service1 = new Service.Lightbulb("test name");
      const service2 = new Service.Lightbulb("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("LightSensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.LightSensor();
      const service1 = new Service.LightSensor("test name");
      const service2 = new Service.LightSensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("LockManagement", () => {
    it("should be able to construct", () => {
      const service0 = new Service.LockManagement();
      const service1 = new Service.LockManagement("test name");
      const service2 = new Service.LockManagement("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("LockMechanism", () => {
    it("should be able to construct", () => {
      const service0 = new Service.LockMechanism();
      const service1 = new Service.LockMechanism("test name");
      const service2 = new Service.LockMechanism("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Microphone", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Microphone();
      const service1 = new Service.Microphone("test name");
      const service2 = new Service.Microphone("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("MotionSensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.MotionSensor();
      const service1 = new Service.MotionSensor("test name");
      const service2 = new Service.MotionSensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("NFCAccess", () => {
    it("should be able to construct", () => {
      const service0 = new Service.NFCAccess();
      const service1 = new Service.NFCAccess("test name");
      const service2 = new Service.NFCAccess("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("OccupancySensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.OccupancySensor();
      const service1 = new Service.OccupancySensor("test name");
      const service2 = new Service.OccupancySensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Outlet", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Outlet();
      const service1 = new Service.Outlet("test name");
      const service2 = new Service.Outlet("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Pairing", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Pairing();
      const service1 = new Service.Pairing("test name");
      const service2 = new Service.Pairing("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("PowerManagement", () => {
    it("should be able to construct", () => {
      const service0 = new Service.PowerManagement();
      const service1 = new Service.PowerManagement("test name");
      const service2 = new Service.PowerManagement("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("ProtocolInformation", () => {
    it("should be able to construct", () => {
      const service0 = new Service.ProtocolInformation();
      const service1 = new Service.ProtocolInformation("test name");
      const service2 = new Service.ProtocolInformation("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("SecuritySystem", () => {
    it("should be able to construct", () => {
      const service0 = new Service.SecuritySystem();
      const service1 = new Service.SecuritySystem("test name");
      const service2 = new Service.SecuritySystem("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("ServiceLabel", () => {
    it("should be able to construct", () => {
      const service0 = new Service.ServiceLabel();
      const service1 = new Service.ServiceLabel("test name");
      const service2 = new Service.ServiceLabel("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Siri", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Siri();
      const service1 = new Service.Siri("test name");
      const service2 = new Service.Siri("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Slats", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Slats();
      const service1 = new Service.Slats("test name");
      const service2 = new Service.Slats("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
      // noinspection JSDeprecatedSymbols

      new Service.Slat();
    });
  });

  describe("SmartSpeaker", () => {
    it("should be able to construct", () => {
      const service0 = new Service.SmartSpeaker();
      const service1 = new Service.SmartSpeaker("test name");
      const service2 = new Service.SmartSpeaker("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("SmokeSensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.SmokeSensor();
      const service1 = new Service.SmokeSensor("test name");
      const service2 = new Service.SmokeSensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Speaker", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Speaker();
      const service1 = new Service.Speaker("test name");
      const service2 = new Service.Speaker("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("StatefulProgrammableSwitch", () => {
    it("should be able to construct", () => {
      const service0 = new Service.StatefulProgrammableSwitch();
      const service1 = new Service.StatefulProgrammableSwitch("test name");
      const service2 = new Service.StatefulProgrammableSwitch("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("StatelessProgrammableSwitch", () => {
    it("should be able to construct", () => {
      const service0 = new Service.StatelessProgrammableSwitch();
      const service1 = new Service.StatelessProgrammableSwitch("test name");
      const service2 = new Service.StatelessProgrammableSwitch("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Switch", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Switch();
      const service1 = new Service.Switch("test name");
      const service2 = new Service.Switch("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("TargetControl", () => {
    it("should be able to construct", () => {
      const service0 = new Service.TargetControl();
      const service1 = new Service.TargetControl("test name");
      const service2 = new Service.TargetControl("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("TargetControlManagement", () => {
    it("should be able to construct", () => {
      const service0 = new Service.TargetControlManagement();
      const service1 = new Service.TargetControlManagement("test name");
      const service2 = new Service.TargetControlManagement("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Television", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Television();
      const service1 = new Service.Television("test name");
      const service2 = new Service.Television("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("TelevisionSpeaker", () => {
    it("should be able to construct", () => {
      const service0 = new Service.TelevisionSpeaker();
      const service1 = new Service.TelevisionSpeaker("test name");
      const service2 = new Service.TelevisionSpeaker("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("TemperatureSensor", () => {
    it("should be able to construct", () => {
      const service0 = new Service.TemperatureSensor();
      const service1 = new Service.TemperatureSensor("test name");
      const service2 = new Service.TemperatureSensor("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Thermostat", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Thermostat();
      const service1 = new Service.Thermostat("test name");
      const service2 = new Service.Thermostat("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("ThreadTransport", () => {
    it("should be able to construct", () => {
      const service0 = new Service.ThreadTransport();
      const service1 = new Service.ThreadTransport("test name");
      const service2 = new Service.ThreadTransport("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("TimeInformation", () => {
    it("should be able to construct", () => {
      const service0 = new Service.TimeInformation();
      const service1 = new Service.TimeInformation("test name");
      const service2 = new Service.TimeInformation("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("TransferTransportManagement", () => {
    it("should be able to construct", () => {
      const service0 = new Service.TransferTransportManagement();
      const service1 = new Service.TransferTransportManagement("test name");
      const service2 = new Service.TransferTransportManagement("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Tunnel", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Tunnel();
      const service1 = new Service.Tunnel("test name");
      const service2 = new Service.Tunnel("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
      // noinspection JSDeprecatedSymbols

      new Service.TunneledBTLEAccessoryService();
    });
  });

  describe("Valve", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Valve();
      const service1 = new Service.Valve("test name");
      const service2 = new Service.Valve("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("WiFiRouter", () => {
    it("should be able to construct", () => {
      const service0 = new Service.WiFiRouter();
      const service1 = new Service.WiFiRouter("test name");
      const service2 = new Service.WiFiRouter("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("WiFiSatellite", () => {
    it("should be able to construct", () => {
      const service0 = new Service.WiFiSatellite();
      const service1 = new Service.WiFiSatellite("test name");
      const service2 = new Service.WiFiSatellite("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("WiFiTransport", () => {
    it("should be able to construct", () => {
      const service0 = new Service.WiFiTransport();
      const service1 = new Service.WiFiTransport("test name");
      const service2 = new Service.WiFiTransport("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("Window", () => {
    it("should be able to construct", () => {
      const service0 = new Service.Window();
      const service1 = new Service.Window("test name");
      const service2 = new Service.Window("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });

  describe("WindowCovering", () => {
    it("should be able to construct", () => {
      const service0 = new Service.WindowCovering();
      const service1 = new Service.WindowCovering("test name");
      const service2 = new Service.WindowCovering("test name", "test sub type");

      expect(service0.displayName).toBe("");
      expect(service0.testCharacteristic(Characteristic.Name)).toBe(false);
      expect(service0.subtype).toBeUndefined();

      expect(service1.displayName).toBe("test name");
      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service1.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service1.subtype).toBeUndefined();

      expect(service2.displayName).toBe("test name");
      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);
      expect(service2.getCharacteristic(Characteristic.Name).value).toBe("test name");
      expect(service2.subtype).toBe("test sub type");
    });
  });
});
