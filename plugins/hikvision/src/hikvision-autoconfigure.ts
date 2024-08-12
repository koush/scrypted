import { Setting } from '@scrypted/sdk';
import { autoconfigureCodecs as ac } from '../../../common/src/autoconfigure-codecs';
import { HikvisionAPI } from './hikvision-api-channels';

export const hikvisionAutoConfigureSettings: Setting = {
    key: 'hikvision-autoconfigure',
    type: 'html',
    value: 'Hikvision autoconfiguration will configure the camera codecs. <b>The camera motion sensor must still be <a target="_blank" href="https://docs.scrypted.app/camera-preparation.html#motion-sensor-setup">configured manually</a>.</b>',
};

export async function autoconfigureSettings(client: HikvisionAPI, camNumber: string) {
    let needReboot = false;
    try {
        needReboot = !await client.putVcaResource(camNumber + '01', 'close');
    }
    catch (e) {
    }

    if (needReboot) {
        client.reboot();
        throw new Error('Camera VCA resource was disabled to enable the third stream. Try again after the camera has completed rebooting.');
    }

    return ac(
        () => client.getCodecs(camNumber),
        (options) => {
            const channelNumber = options.id.substring(1);
            return client.configureCodecs(camNumber, channelNumber, options)
        }
    );
}
