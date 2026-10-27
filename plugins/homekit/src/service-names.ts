import { ConfiguredName, Name } from '@homebridge/hap-nodejs/dist/lib/definitions/CharacteristicDefinitions.js';
import type { Service } from '@homebridge/hap-nodejs/dist/lib/Service.js';

/** Give grouped services their own labels instead of the accessory's name. */
export function setServiceName(service: Service, name: string): void {
    // Sensors and switches do not all declare ConfiguredName as optional.
    if (!service.testCharacteristic(ConfiguredName)
        && !service.optionalCharacteristics.some(characteristic => characteristic.UUID === ConfiguredName.UUID)) {
        service.addOptionalCharacteristic(ConfiguredName);
    }
    service.displayName = name;
    service.updateCharacteristic(Name, name);
    service.updateCharacteristic(ConfiguredName, name);
}
