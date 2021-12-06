import sdk, { FFMpegInput, MediaObject, MediaStreamOptions, Setting, SettingValue } from "@scrypted/sdk";
import { CameraProviderBase, CameraBase, UrlMediaStreamOptions } from "./common";

const { log, deviceManager, mediaManager } = sdk;

class FFmpegCamera extends CameraBase<UrlMediaStreamOptions> {
    createFFmpegMediaStreamOptions(ffmpegInput: string, index: number) {
        // this might be usable as a url so check that.
        let url: string;
        try {
            const parsedUrl = new URL(ffmpegInput);
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

    getFFmpegInputs() {
        let ffmpegInputs: string[] = [];
        try {
            ffmpegInputs = JSON.parse(this.storage.getItem('ffmpegInputs'));
        }
        catch (e) {
        }

        return ffmpegInputs;
    }

    getRawVideoStreamOptions(): UrlMediaStreamOptions[] {
        const ffmpegInputs = this.getFFmpegInputs();

        // filter out empty strings.
        const ret = ffmpegInputs
            .filter(ffmpegInput => !!ffmpegInput)
            .map((ffmpegInput, index) => this.createFFmpegMediaStreamOptions(ffmpegInput, index));

        if (!ret.length)
            return;
        return ret;

    }

    async getFFmpegInputSettings(): Promise<Setting[]> {
        return [
            {
                key: 'ffmpegInputs',
                title: 'FFmpeg Input Stream Arguments',
                description: 'FFmpeg input arguments passed to the command line ffmpeg tool. A camera may have multiple streams with different bitrates.',
                placeholder: '-i rtmp://[user:password@]192.168.1.100[:1935]/channel/101',
                value: this.getFFmpegInputs(),
                multiple: true,
            },
        ];
    }

    async putSettingBase(key: string, value: SettingValue) {
        if (key === 'ffmpegInputs') {
            this.putFFmpegInputs(value as string[]);
        }
        else {
            super.putSettingBase(key, value);
        }
    }

    async putFFmpegInputs(urls: string[]) {
        this.storage.setItem('ffmpegInputs', JSON.stringify(urls.filter(url => !!url)));
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            ...await this.getSnapshotUrlSettings(),
            ...await this.getFFmpegInputSettings(),
        ];
    }

    async createVideoStream(options?: UrlMediaStreamOptions): Promise<MediaObject> {
        const index = this.getRawVideoStreamOptions()?.findIndex(vso => vso.id === options.id);
        const ffmpegInputs = this.getFFmpegInputs();
        const ffmpegInput = ffmpegInputs[index];

        if (!ffmpegInput)
            throw new Error('video streams not set up or no longer exists.');

        const ret: FFMpegInput = {
            url: options.url,
            inputArguments: ffmpegInput.split(' '),
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
