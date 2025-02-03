import { getH264DecoderArgs } from "@scrypted/common/src/ffmpeg-hardware-acceleration";
import { MixinDeviceBase, ResponseMediaStreamOptions, VideoCamera } from "@scrypted/sdk";
import { StorageSetting, StorageSettings } from "@scrypted/sdk/storage-settings";

export type StreamStorageSetting = StorageSetting & {
    prefersPrebuffer: boolean,
    preferredResolution: number,
};
export type StreamStorageSettingsDict<T extends string> = { [key in T]: StreamStorageSetting };


function getStreamTypes<T extends string>(storageSettings: StreamStorageSettingsDict<T>) {
    return storageSettings;
}

function pickBestStream(msos: ResponseMediaStreamOptions[], resolution: number) {
    if (!msos)
        return;

    let best: ResponseMediaStreamOptions;
    let bestScore: number;
    for (const mso of msos) {
        const score = Math.abs(mso.video?.width * mso.video?.height - resolution);
        if (!best || score < bestScore) {
            best = mso;
            bestScore = score;
            if (Number.isNaN(bestScore))
                bestScore = Number.MAX_SAFE_INTEGER;
        }
    }

    return best;
}

export function createStreamSettings(device: MixinDeviceBase<VideoCamera>) {
    const subgroup = "Manage";

    const streamTypes = getStreamTypes({
        defaultStream: {
            subgroup,
            title: 'Local Stream',
            description: 'The media stream to use when streaming on your local network. This stream should be prebuffered. Recommended resolution: 1920x1080 to 4K.',
            hide: true,
            prefersPrebuffer: false,
            preferredResolution: 3840 * 2160,
        },
        remoteStream: {
            subgroup,
            title: 'Remote (Medium Resolution) Stream',
            description: 'The media stream to use when streaming from outside your local network. Selecting a low birate stream is recommended. Recommended resolution: 1280x720.',
            hide: true,
            prefersPrebuffer: false,
            preferredResolution: 1280 * 720,
        },
        lowResolutionStream: {
            subgroup,
            title: 'Low Resolution Stream',
            description: 'The media stream to use for low resolution output, such as Apple Watch and Video Analysis. Recommended resolution: 480x360.',
            hide: true,
            prefersPrebuffer: false,
            preferredResolution: 480 * 360,
        },
        recordingStream: {
            subgroup,
            title: 'Local Recording Stream',
            description: 'The media stream to use when recording to local storage such as an NVR. Recommended resolution: 1920x1080 to 4K.',
            hide: true,
            // will be automatically prebuferred when in use, but doesn't really need it.
            prefersPrebuffer: false,
            preferredResolution: 3840 * 2160,
        },
        remoteRecordingStream: {
            subgroup,
            title: 'Remote Recording Stream',
            description: 'The media stream to use when recording to cloud storage such as HomeKit Secure Video clips in iCloud. This stream should be prebuffered. Recommended resolution: 1280x720.',
            hide: true,
            prefersPrebuffer: true,
            preferredResolution: 2560 * 1440,
        },
    });

    const storageSettings = new StorageSettings(device, {
        noAudio: {
            subgroup,
            title: 'No Audio',
            description: 'Enable this setting if the camera does not have audio or to mute audio.',
            type: 'boolean',
        },
        enabledStreams: {
            subgroup,
            title: 'Prebuffered Streams',
            description: 'Prebuffering maintains an active connection to the stream and improves load times. Prebuffer also retains the recent video for capturing motion events with HomeKit Secure video. Enabling Prebuffer is not recommended on Cloud cameras.',
            multiple: true,
            hide: false,
        },
        ...streamTypes,
        rebroadcastPort: {
            subgroup,
            title: 'Rebroadcast Port',
            description: 'The port of the RTSP server that will rebroadcast your streams.',
            type: 'number',
            hide: false,
        },
        synthenticStreams: {
            subgroup,
            title: 'Synthetic Streams',
            description: 'Create additional streams by transcoding the existing streams. This can be useful for creating streams with different resolutions or bitrates.',
            immediate: true,
            multiple: true,
            combobox: true,
            choices: [],
            defaultValue: [],
        }
    });

    function getDefaultPrebufferedStreams(msos: ResponseMediaStreamOptions[]) {
        if (!msos)
            return;

        const local = getMediaStream(storageSettings.keys.defaultStream, msos);
        const remoteRecording = getMediaStream(storageSettings.keys.remoteRecordingStream, msos);

        if (!local?.stream || local.stream.source === 'cloud' || local.stream.source === 'synthetic')
            return [];

        if (local.stream.id === remoteRecording.stream.id)
            return [local.stream];
        return [local.stream, remoteRecording.stream];
    }

    function getPrebufferedStreams(msos: ResponseMediaStreamOptions[]) {
        if (!msos)
            return;

        if (!storageSettings.hasValue.enabledStreams)
            return getDefaultPrebufferedStreams(msos);

        return msos.filter(mso => storageSettings.values.enabledStreams.includes(mso.name));
    }


    function getDefaultMediaStream(v: StreamStorageSetting, msos: ResponseMediaStreamOptions[]) {
        return pickBestStream(msos, v.preferredResolution);
    }

    function getMediaStream(key: string, msos: ResponseMediaStreamOptions[]) {
        const v: StreamStorageSetting = storageSettings.settings[key];
        const value = storageSettings.values[key];
        let isDefault = value === 'Default';

        let stream = msos?.find(mso => mso.name === value);
        if (storageSettings.values.synthenticStreams.includes(value)) {
            stream = {
                id: `synthetic:${value}`,
            };
        }
        else {
            if (isDefault || !stream) {
                isDefault = true;
                stream = getDefaultMediaStream(v, msos);
            }
        }
        return {
            title: streamTypes[key].title,
            isDefault,
            stream,
        };
    };

    function createStreamOptions(v: StreamStorageSetting, msos: ResponseMediaStreamOptions[]) {
        const choices = [
            'Default',
            ...msos.map(mso => mso.name),
            ...storageSettings.values.synthenticStreams,
        ];
        const defaultValue = getDefaultMediaStream(v, msos).name;

        const streamOptions = {
            defaultValue: 'Default',
            description: v.description + ` The default for this stream is ${defaultValue}.`,
            choices,
            hide: false,
        };
        return streamOptions;
    }

    storageSettings.options = {
        onGet: async () => {
            let enabledStreams: StorageSetting;

            try {
                const msos = await device.mixinDevice.getVideoStreamOptions();

                enabledStreams = {
                    defaultValue: getDefaultPrebufferedStreams(msos)?.map(mso => mso.name || mso.id),
                    choices: msos.map((mso, index) => mso.name || mso.id),
                    hide: false,
                };

                if (msos?.length > 1) {
                    return {
                        enabledStreams,
                        defaultStream: createStreamOptions(streamTypes.defaultStream, msos),
                        remoteStream: createStreamOptions(streamTypes.remoteStream, msos),
                        lowResolutionStream: createStreamOptions(streamTypes.lowResolutionStream, msos),
                        recordingStream: createStreamOptions(streamTypes.recordingStream, msos),
                        remoteRecordingStream: createStreamOptions(streamTypes.remoteRecordingStream, msos),
                    }
                }
                else {
                    return {
                        enabledStreams,
                    }
                }
            }
            catch (e) {
                device.console.error('error retrieving getVideoStreamOptions', e);
            }

            return {
            }
        }
    }

    return {
        getDefaultPrebufferedStreams,
        getPrebufferedStreams,
        getDefaultStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.defaultStream, msos),
        getRemoteStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.remoteStream, msos),
        getLowResolutionStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.lowResolutionStream, msos),
        getRecordingStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.recordingStream, msos),
        getRemoteRecordingStream: (msos: ResponseMediaStreamOptions[]) => getMediaStream(storageSettings.keys.remoteRecordingStream, msos),
        storageSettings,
    };
}
