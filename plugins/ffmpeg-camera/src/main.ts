import sdk, { FFmpegInput, Intercom, MediaObject, PictureOptions, ScryptedInterface, ScryptedMimeTypes, Setting, SettingValue } from "@scrypted/sdk";
import { CameraProviderBase, CameraBase, UrlMediaStreamOptions } from "./common";
import { StorageSettings } from "../../../common/src/settings";
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from "../../../common/src/media-helpers";
import child_process, { ChildProcess } from "child_process";

const { mediaManager } = sdk;

function parseDoubleQuotedArguments(input: string) {
    const regex = new RegExp('"[^"]+"|[\\S]+', 'g');
    const parsed: string[] = [];
    input.match(regex).forEach(element => {
        if (!element) return;
        return parsed.push(element.replace(/"/g, ''));
    });
    return parsed;
}

class FFmpegCamera extends CameraBase<UrlMediaStreamOptions> {
    takePictureThrottled(option?: PictureOptions): Promise<MediaObject> {
        throw new Error("The RTSP Camera does not provide snapshots. Install the Snapshot Plugin if snapshots are available via an URL.");
    }

    storageSettings = new StorageSettings(this, {
        ffmpegInputs: {
            title: 'FFmpeg Input Stream Arguments',
            description: 'FFmpeg input arguments passed to the command line ffmpeg tool. A camera may have multiple streams with different bitrates.',
            placeholder: '-i rtmp://[user:password@]192.168.1.100[:1935]/channel/101',
            multiple: true,
        },
        // ffmpegOutput: {
        //     title: 'FFmpeg Output Stream Arguments',
        //     description: 'Optional (two way audio): FFmpeg output arguments passed to the command line ffmpeg tool to play back an audio stream.',
        //     placeholder: '-vn -acodec copy -f adts udp://192.168.1.101:1234',
        //     onPut: (_, newValue) => {
        //         let interfaces = this.providedInterfaces;
        //         if (!newValue)
        //             interfaces = interfaces.filter(iface => iface !== ScryptedInterface.Intercom);
        //         else
        //             interfaces.push(ScryptedInterface.Intercom);
        //         this.provider.updateDevice(this.nativeId, this.providedName, interfaces);
        //     },
        // },
    })

    // twoway: ChildProcess;

    // async startIntercom(media: MediaObject): Promise<void> {
    //     const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
    //     const ffmpegInput: FFmpegInput = JSON.parse(buffer.toString());

    //     const args = ffmpegInput.inputArguments.slice();
    //     args.push(...this.storageSettings.values.ffmpegOutput.split(' '));
    //     this.console.log('starting intercom', safePrintFFmpegArguments(this.console, args));
    //     this.stopIntercom();
    //     this.twoway = child_process.spawn(await mediaManager.getFFmpegPath(), args);
    //     ffmpegLogInitialOutput(this.console, this.twoway);
    // }

    // async stopIntercom(): Promise<void> {
    //     this.twoway?.kill('SIGKILL');
    //     this.twoway = undefined;
    // }

    createFFmpegMediaStreamOptions(ffmpegInput: string, index: number) {
        // this might be usable as a url so check that.
        let url: string;
        try {
        }
        catch (e) {
        }

        return {
            id: `channel${index}`,
            name: `Stream ${index + 1}`,
            url,
            video: {
            },
            audio: this.isAudioDisabled() ? null : {},
        };
    }

    getRawVideoStreamOptions(): UrlMediaStreamOptions[] {
        const ffmpegInputs = this.storageSettings.values.ffmpegInputs as string[];

        // filter out empty strings.
        const ret = ffmpegInputs
            .filter(ffmpegInput => !!ffmpegInput)
            .map((ffmpegInput, index) => this.createFFmpegMediaStreamOptions(ffmpegInput, index));

        if (!ret.length)
            return;
        return ret;

    }

    async getFFmpegInputSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSettingBase(key: string, value: SettingValue) {
        if (this.storageSettings.settings[key]) {
            this.storageSettings.putSetting(key, value);
        }
        else {
            super.putSettingBase(key, value);
        }
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            ...await this.getFFmpegInputSettings(),
        ];
    }

    async createVideoStream(options?: UrlMediaStreamOptions): Promise<MediaObject> {
        const index = this.getRawVideoStreamOptions()?.findIndex(vso => vso.id === options.id);
        const ffmpegInputs = this.storageSettings.values.ffmpegInputs as string[];
        const ffmpegInput = ffmpegInputs[index];

        if (!ffmpegInput)
            throw new Error('video streams not set up or no longer exists.');

        const ret: FFmpegInput = {
            url: options.url,
            inputArguments: parseDoubleQuotedArguments(ffmpegInput),
            mediaStreamOptions: options,
        };

        return mediaManager.createFFmpegMediaObject(ret);
    }

}

class FFmpegProvider extends CameraProviderBase<UrlMediaStreamOptions> {
    createCamera(nativeId: string): FFmpegCamera {
        return new FFmpegCamera(nativeId, this);
    }
}

export default new FFmpegProvider();
