import sdk, { Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, LockState, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting } from '@scrypted/sdk';
import { randomBytes } from 'crypto';
import { BticinoSipCamera } from './bticino-camera';

export class BticinoSipPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {

    devices = new Map<string, BticinoSipCamera>();

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
        this.console.log("main::createDevice")
        const nativeId = randomBytes(4).toString('hex')
        const name = settings.newCamera?.toString()
        const camera = await this.updateDevice(nativeId, name);

        this.console.log("main::createDevice: " + camera )

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

        const ret = await sdk.deviceManager.onDevicesChanged({
            providerNativeId: nativeId,
            devices: [device],
        });

        let x : BticinoSipCamera = await this.getDevice(nativeId)

        let foo : BticinoSipCamera = sdk.systemManager.getDeviceById<BticinoSipCamera>(x.id)

        this.console.log("main::getDevice: " + x )
        this.console.log("main::" + this.devices.size )
        this.devices.forEach( e => this.console.log("main::device::" + e )  )

        this.console.log("main::getDevice::done" )

        let y = await x.getDevice(undefined)
        y.lockState = LockState.Locked
        //foo.getDevice()

        //let y = await foo.

        return nativeId;
    }

    updateDevice(nativeId: string, name: string) {
        return sdk.deviceManager.onDeviceDiscovered({
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
        this.console.log('release')
    }
}

export default new BticinoSipPlugin()