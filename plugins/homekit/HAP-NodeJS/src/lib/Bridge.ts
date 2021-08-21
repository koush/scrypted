import { Accessory } from './Accessory';

/**
 * Bridge is a special type of HomeKit Accessory that hosts other Accessories "behind" it. This way you
 * can simply publish() the Bridge (with a single HAPServer on a single port) and all bridged Accessories
 * will be hosted automatically, instead of needed to publish() every single Accessory as a separate server.
 */
export class Bridge extends Accessory {
    constructor(displayName: string, UUID: string) {
        super(displayName, UUID);
        this._isBridge = true;
    }
}
