import sdk, { Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, LockState, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, Setting } from '@scrypted/sdk';
import { randomBytes } from 'crypto';
import { BticinoSipCamera } from './bticino-camera';

const { systemManager, deviceManager, mediaManager } = sdk;

export class BticinoSipPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {

    devices = new Map<string, BticinoSipCamera>();

    constructor() {
        super()
        systemManager.listen(
            async (eventSource, eventDetails, eventData) => {
                if( !eventSource && ScryptedInterface.ScryptedDevice == eventDetails?.eventInterface && ScryptedInterfaceProperty.id == eventDetails.property ) {
                    this.devices.forEach( (camera) => {
                        if(camera?.id === eventData) {
                            camera.voicemailHandler.cancelVoicemailCheck()
                            if( this.devices.delete(camera.nativeId) ) {
                                this.console.log("Removed device from list: " + eventData)   
                            }
                        }
                    } )
                }
            });
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'newCamera',
                title: 'Add Camera',
                placeholder: 'Camera name, e.g.: Back Yard Camera, Baby Camera, etc',
            }
        ]
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = randomBytes(4).toString('hex')
        const name = settings.newCamera?.toString()
        const camera = await this.updateDevice(nativeId, name);

        const device: Device = {
            providerNativeId: nativeId,
            info: {
                //model: `${camera.model} (${camera.data.kind})`,
                manufacturer: 'BticinoPlugin',
                //firmware: camera.data.firmware_version,
                //serialNumber: camera.data.device_id
            },
            nativeId: nativeId + '-lock',
            name: name + ' Lock',
            type: ScryptedDeviceType.Lock,
            interfaces: [ScryptedInterface.Lock],
        };

        const ret = await deviceManager.onDevicesChanged({
            providerNativeId: nativeId,
            devices: [device],
        });

        let sipCamera : BticinoSipCamera = await this.getDevice(nativeId)
        let foo : BticinoSipCamera = systemManager.getDeviceById<BticinoSipCamera>(sipCamera.id)

        let lock = await sipCamera.getDevice(undefined)
        lock.lockState = LockState.Locked

        return nativeId;
    }

    updateDevice(nativeId: string, name: string) {
        return deviceManager.onDeviceDiscovered({
            nativeId,
            info: {
                //model: `${camera.model} (${camera.data.kind})`,
                manufacturer: 'BticinoSipPlugin',
                //firmware: camera.data.firmware_version,
                //serialNumber: camera.data.device_id
            },
            name,
            interfaces: [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
                ScryptedInterface.Intercom,
                ScryptedInterface.BinarySensor,
                ScryptedDeviceType.DeviceProvider
            ],
            type: ScryptedDeviceType.Doorbell,
        })
    }

    async getDevice(nativeId: string): Promise<any> {
        if (!this.devices.has(nativeId)) {
            const camera = new BticinoSipCamera(nativeId, this);
            this.devices.set(nativeId, camera);
        }
        return this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }
}

export default new BticinoSipPlugin()