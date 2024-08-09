import { MediaStreamOptions } from "@scrypted/sdk";
import { OnvifCameraAPI } from "./onvif-api";
import { UrlMediaStreamOptions } from "../../ffmpeg-camera/src/common";

export function computeInterval(fps: number, govLength: number) {
    if (!fps || !govLength)
        return;
    return govLength / fps * 1000;
}

export function convertAudioCodec(codec: string) {
    if (codec?.toLowerCase()?.includes('mp4a'))
        return 'aac';
    if (codec?.toLowerCase()?.includes('aac'))
        return 'aac';
    return codec?.toLowerCase();
}

export function computeBitrate(bitrate: number) {
    if (!bitrate)
        return;
    return bitrate * 1000;
}

export async function configureCodecs(client: OnvifCameraAPI, options: MediaStreamOptions) {
    const profiles: any[] = await client.getProfiles();
    const profile = profiles.find(profile => profile.$.token === options.id);
    const configuration = profile.videoEncoderConfiguration;

    const videoOptions = options.video;

    switch (videoOptions?.codec) {
        case 'h264':
            configuration.encoding = 'H264';

            if (videoOptions?.idrIntervalMillis && videoOptions?.fps) {
                configuration.H264 ||= {};
                configuration.H264.govLength = Math.floor(videoOptions?.fps * videoOptions?.idrIntervalMillis / 1000);
            }
            if (videoOptions?.keyframeInterval) {
                configuration.H264 ||= {};
                configuration.H264.govLength = videoOptions?.keyframeInterval;
            }
            if (videoOptions?.profile) {
                let profile: string;
                switch (videoOptions.profile) {
                    case 'baseline':
                        profile = 'Baseline';
                        break;
                    case 'main':
                        profile = 'Main';
                        break;
                    case 'high':
                        profile = 'High';
                        break;
                }
                if (profile) {
                    configuration.H264 ||= {};
                    configuration.H264.profile = profile;
                }
            }
            break;
    }

    if (videoOptions?.width && videoOptions?.height) {
        configuration.resolution ||= {};
        configuration.resolution.width = videoOptions?.width;
        configuration.resolution.height = videoOptions?.height;
    }

    if (videoOptions?.bitrate) {
        configuration.rateControl ||= {};
        configuration.rateControl.bitrateLimit = Math.floor(videoOptions?.bitrate / 1000);
    }

    if (videoOptions?.bitrateControl) {
        configuration.rateControl ||= {};
        configuration.rateControl.$ ||= {};
        configuration.rateControl.$.ConstantBitrate = videoOptions?.bitrateControl === 'constant';
    }

    if (videoOptions?.fps) {
        configuration.rateControl ||= {};
        configuration.rateControl.frameRateLimit = videoOptions?.fps;
        configuration.rateControl.encodingInterval = 1;
    }

    return new Promise<void>((r, f) => {
        client.cam.setVideoEncoderConfiguration(configuration, (e: Error, result: any) => {
            if (e)
                return f(e);

            r();
        })
    });
}

export async function getCodecs(console: Console, client: OnvifCameraAPI) {
    const profiles: any[] = await client.getProfiles();
    const ret: UrlMediaStreamOptions[] = [];
    for (const { $, name, videoEncoderConfiguration, audioEncoderConfiguration } of profiles) {
        try {
            ret.push({
                id: $.token,
                metadata: {
                    videoId: videoEncoderConfiguration?.$?.token,
                    audioId: audioEncoderConfiguration?.$?.token,
                },
                name: name,
                container: 'rtsp',
                url: await client.getStreamUrl($.token),
                video: {
                    fps: videoEncoderConfiguration?.rateControl?.frameRateLimit,
                    bitrate: computeBitrate(videoEncoderConfiguration?.rateControl?.bitrateLimit),
                    width: videoEncoderConfiguration?.resolution?.width,
                    height: videoEncoderConfiguration?.resolution?.height,
                    codec: videoEncoderConfiguration?.encoding?.toLowerCase(),
                    idrIntervalMillis: computeInterval(videoEncoderConfiguration?.rateControl?.frameRateLimit,
                        videoEncoderConfiguration?.$.GovLength),
                },
                audio: {
                    bitrate: computeBitrate(audioEncoderConfiguration?.bitrate),
                    codec: convertAudioCodec(audioEncoderConfiguration?.encoding),
                }
            })
        }
        catch (e) {
            console.error('error retrieving onvif profile', $.token, e);
        }
    }

    return ret;
}
