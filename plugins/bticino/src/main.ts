import sdk, { Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, LockState, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting } from '@scrypted/sdk'
import { randomBytes } from 'crypto'
import { BticinoSipCamera } from './bticino-camera'
import { ControllerApi } from './c300x-controller-api';

const { systemManager, deviceManager } = sdk

export class BticinoSipPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {

    devices = new Map<string, BticinoSipCamera>()

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'newCamera',
                title: 'Add Camera',
                placeholder: 'Camera name, e.g.: Back Yard Camera, Baby Camera, etc',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: 'IP Address of the C300X intercom',
            }            
        ]
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        if( !settings.ip ) {
            throw new Error('IP address is required!')
        }

        let validate = ControllerApi.validate( settings.ip )

        return validate.then( async (setupData) => {
            const nativeId = randomBytes(4).toString('hex')
            const name = settings.newCamera?.toString() === undefined ? "Doorbell" : settings.newCamera?.toString()
            await this.updateDevice(nativeId, name)
    
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
                interfaces: [ScryptedInterface.Lock, ScryptedInterface.HttpRequestHandler],
            }
    
            await deviceManager.onDevicesChanged({
                providerNativeId: nativeId,
                devices: [device],
            })
    
            let sipCamera : BticinoSipCamera = await this.getDevice(nativeId)
            
            sipCamera.putSetting("sipfrom", "scrypted-" + sipCamera.id + "@127.0.0.1")
            sipCamera.putSetting("sipto", "c300x@" + setupData["ipAddress"] )
            sipCamera.putSetting("sipdomain", setupData["domain"])
            sipCamera.putSetting("sipdebug", true )
            
            systemManager.getDeviceById<BticinoSipCamera>(sipCamera.id)
    
            let lock = await sipCamera.getDevice(undefined)
            lock.lockState = LockState.Locked

            return nativeId
        })
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
                ScryptedDeviceType.DeviceProvider,
                ScryptedInterface.HttpRequestHandler,
                ScryptedInterface.VideoClips,
                ScryptedInterface.Reboot
            ],
            type: ScryptedDeviceType.Doorbell,
        })
    }

    async getDevice(nativeId: string): Promise<any> {
        if (!this.devices.has(nativeId)) {
            const camera = new BticinoSipCamera(nativeId, this)
            this.devices.set(nativeId, camera)
        }
        return this.devices.get(nativeId)
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        let camera = this.devices.get(nativeId)
        if( camera ) {
            if( this.devices.delete( nativeId ) ) {
                this.console.log("Removed device from list: " + id + " / " + nativeId )   
            }
        }
    }
}

export default new BticinoSipPlugin()