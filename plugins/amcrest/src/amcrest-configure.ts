import { AudioStreamConfiguration, Setting } from '@scrypted/sdk';
import { autoconfigureCodecs as ac } from '../../../common/src/autoconfigure-codecs';
import { AmcrestCameraClient } from "./amcrest-api";

export const amcrestAutoConfigureSettings: Setting = {
    key: 'amcrest-autoconfigure',
    type: 'html',
    value: 'Amcrest autoconfiguration will configure the camera codecs and the motion sensor.',
};

export async function autoconfigureSettings(client: AmcrestCameraClient, cameraNumber: number) {
    await client.setWatermark(cameraNumber, false).catch(() => { });

    const audioOptions: AudioStreamConfiguration = {
        codec: 'aac',
        sampleRate: 8000,
    };

    await client.resetMotionDetection(cameraNumber).catch(() => {});

    return ac(
        () => client.getCodecs(cameraNumber),
        options => client.configureCodecs(cameraNumber, options),
        audioOptions,
    );
}
