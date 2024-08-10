import { autoconfigureCodecs as ac } from '../../../common/src/autoconfigure-codecs';
import { AmcrestCameraClient } from "./amcrest-api";

export function autoconfigureSettings(client: AmcrestCameraClient, cameraNumber: number) {
    return ac(
        () => client.getCodecs(cameraNumber),
        options => client.configureCodecs(cameraNumber, options),
    );
}