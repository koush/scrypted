import { AudioStreamConfiguration } from '@scrypted/sdk';
import { autoconfigureCodecs as ac } from '../../../common/src/autoconfigure-codecs';
import { AmcrestCameraClient } from "./amcrest-api";

export function autoconfigureSettings(client: AmcrestCameraClient, cameraNumber: number) {
    const audioOptions: AudioStreamConfiguration = {
        codec: 'aac',
        sampleRate: 8000,
    };

    return ac(
        () => client.getCodecs(cameraNumber),
        options => client.configureCodecs(cameraNumber, options),
        audioOptions,
    );
}
