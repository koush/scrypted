import { Setting, SettingValue } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { BticinoSipCamera } from './bticino-camera';

export class BticinoStorageSettings {
    private storageSettings
    
    constructor(camera : BticinoSipCamera) {
        this.storageSettings = new StorageSettings( camera, {
            sipfrom: {
                title: 'SIP From: URI',
                type: 'string',
                value: camera.storage.getItem('sipfrom'),
                description: 'SIP URI From field: Using the IP address of your server you will be calling from.',
                placeholder: 'user@192.168.0.111',
                multiple: false,
            },
            sipto: {
                title: 'SIP To: URI',
                type: 'string',
                description: 'SIP URI To field: Must look like c300x@192.168.0.2',
                placeholder: 'c300x@192.168.0.2',
            },
            sipdomain: {
                title: 'SIP domain',
                type: 'string',
                description: 'SIP domain - tshe internal BTicino domain, usually has the following format: 2048362.bs.iotleg.com',
                placeholder: '2048362.bs.iotleg.com',
            },
            sipexpiration: {
                title: 'SIP UA expiration',
                type: 'number',
                range: [60, 3600],
                description: 'How long the UA should remain active before expiring and having to re-register (in seconds)',
                defaultValue: 600,
                placeholder: '600',
            },
            thumbnailCacheTime: {
                title: 'Thumbnail cache time',
                type: 'number',
                range: [60, 86400],
                description: 'How long the snapshot is cached before taking a new one. (in seconds)',
                defaultValue: 300,
                placeholder: '300',
            },            
            sipdebug: {
                title: 'SIP debug logging',
                type: 'boolean',
                description: 'Enable SIP debugging',
                placeholder: 'true or false',
            },     
            DEVADDR: {
                title: 'Device address (DEVADDR)',
                type: 'string',
                description: 'Only specify if this is different than 20. For c100x this is a UUID, see: tcpdump -i lo port 5060',
                defaultValue: '20',
                placeholder: '20',
            },               
            notifyVoicemail: {
                title: 'Notify on new voicemail messages',
                type: 'boolean',
                description: 'Enable voicemail alerts',
                placeholder: 'true or false',
                onGet: async () => {
                    return {
                        hide: this.storageSettings.values.sipto.indexOf('c100x') == 0,
                    }
                }
            },   
            doorbellWebhookUrl: {
                title: 'Doorbell Sensor Webhook',
                type: 'string',
                readonly: true,
                mapGet: () => {
                    return camera.doorbellWebhookUrl;
                },
                description: 'Incoming doorbell sensor webhook url.',
            },
            doorbellLockWebhookUrl: {
                title: 'Doorbell Lock Webhook',
                type: 'string',
                readonly: true,
                mapGet: () => {
                    return camera.doorbellLockWebhookUrl;
                },
                description: 'Incoming doorbell sensor webhook url.',
            }            
        });
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }
 
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }       
}