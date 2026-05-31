import sdk, { Device, DeviceCreator, DeviceCreatorSettings, DeviceInformation, DeviceProvider, LockState, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting } from '@scrypted/sdk'
import { randomBytes } from 'crypto'
import { BticinoSipCamera } from './bticino-camera'
import { ControllerApi } from './c300x-controller-api';
import { SipHelper } from './sip-helper';

const { systemManager, deviceManager } = sdk

export class BticinoSipPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {

    devices = new Map<string, BticinoSipCamera>()

    constructor() {
        super();
        this.systemDevice = {
            deviceCreator: 'Bticino Doorbell',
        };
    }

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

    deviceInfo(setupData) : DeviceInformation {
        return {
            model: setupData["model"].toLocaleUpperCase(),
            manufacturer: `Bticino (c300x-controller v${setupData["version"]})`,
            version: setupData["version"],
            firmware: setupData["firmware"],
            ip: setupData["ipAddress"],
            mac: setupData["macAddress"],
            managementUrl: 'http://' + setupData["ipAddress"] + ':8080'
        }
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        if( !settings.ip ) {
            throw new Error('IP address is required!')
        }

        let validate = ControllerApi.validate( settings.ip )

        return validate.then( async (setupData) => {
            const nativeId = randomBytes(4).toString('hex')
            const name = settings.newCamera?.toString() === undefined ? "Doorbell" : settings.newCamera?.toString()
            const deviceInfo : DeviceInformation = this.deviceInfo(setupData)
            await this.updateDevice(nativeId, name, deviceInfo)
    
            const lockDevice: Device = {
                providerNativeId: nativeId,
                info: deviceInfo,
                nativeId: nativeId + '-lock',
                name: name + ' Lock',
                type: ScryptedDeviceType.Lock,
                interfaces: [ScryptedInterface.Lock, ScryptedInterface.HttpRequestHandler],
            }

            const aswmSwitchDevice: Device = {
                providerNativeId: nativeId,
                info: deviceInfo,
                nativeId: nativeId + '-aswm-switch',
                name: name + ' Voicemail',
                type: ScryptedDeviceType.Switch,
                interfaces: [ScryptedInterface.OnOff, ScryptedInterface.HttpRequestHandler],
            }           
            
            const muteSwitchDevice: Device = {
                providerNativeId: nativeId,
                info: deviceInfo,
                nativeId: nativeId + '-mute-switch',
                name: name + ' Muted',
                type: ScryptedDeviceType.Switch,
                interfaces: [ScryptedInterface.OnOff, ScryptedInterface.HttpRequestHandler],
            }
            const devices = setupData["model"] === 'c100x' ? [lockDevice, muteSwitchDevice] : [lockDevice, aswmSwitchDevice, muteSwitchDevice]
    
            await deviceManager.onDevicesChanged({
                providerNativeId: nativeId,
                devices: devices
            })
    
            let sipCamera : BticinoSipCamera = await this.getDevice(nativeId)
            
            sipCamera.putSetting("sipfrom", "scrypted-" + sipCamera.id + "@127.0.0.1")
            sipCamera.putSetting("sipto", setupData["model"] + "@" + setupData["ipAddress"] )
            sipCamera.putSetting("sipdomain", setupData["domain"])
            sipCamera.putSetting("sipdebug", true )
            
            systemManager.getDeviceById<BticinoSipCamera>(sipCamera.id)
    
            let lock = await sipCamera.getDevice(undefined)
            lock.lockState = LockState.Locked

            return nativeId
        })
    }

    updateDevice(nativeId: string, name: string, deviceInfo) {
        return deviceManager.onDeviceDiscovered({
            nativeId,
            info: deviceInfo,
            name,
            interfaces: [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
                ScryptedInterface.Intercom,
                ScryptedInterface.BinarySensor,
                ScryptedInterface.MotionSensor,
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
            ControllerApi.validate(SipHelper.getIntercomIp(camera)).then( async (setupData) => { 
                camera.info = this.deviceInfo(setupData)
            } )            
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