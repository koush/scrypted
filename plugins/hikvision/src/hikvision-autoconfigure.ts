import { autoconfigureCodecs as ac } from '../../../common/src/autoconfigure-codecs';
import { HikvisionAPI } from './hikvision-api-channels';

export async function autoconfigureSettings(client: HikvisionAPI, camNumber: string) {
    return ac(
        () => client.getCodecs(camNumber),
        (options) => {
            const channelNumber = options.id.substring(1);
            return client.configureCodecs(camNumber, channelNumber, options)
        }
    );
}
