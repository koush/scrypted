import sdk, { FFMpegInput, MediaObject, MediaStreamOptions, Setting, SettingValue } from "@scrypted/sdk";
import child_process from "child_process";
import { CameraProviderBase, CameraBase, UrlMediaStreamOptions } from "./common";
// import {} from "../../../common/src/stream-parser"
// import {} from "../../../common/src/ffmpeg-rebroadcast"
import net from 'net';
import {listenZeroCluster} from "../../../common/src/listen-cluster"

const { log, deviceManager, mediaManager } = sdk;

class GStreamerCamera extends CameraBase<MediaStreamOptions> {
    createGStreamerMediaStreamOptions(gstreamerInput: string, index: number): MediaStreamOptions {
        return {
            id: `channel${index}`,
            name: `Stream ${index + 1}`,
            video: {
            },
            audio: this.isAudioDisabled() ? null : {},
        };
    }

    getGStreamerInputs() {
        let gstreamerInputs: string[] = [];
        try {
            gstreamerInputs = JSON.parse(this.storage.getItem('gstreamerInputs'));
        }
        catch (e) {
        }

        return gstreamerInputs;
    }

    getRawVideoStreamOptions(): MediaStreamOptions[] {
        const gstreamerInputs = this.getGStreamerInputs();

        // filter out empty strings.
        const ret = gstreamerInputs
            .filter(gstreamerInput => !!gstreamerInput)
            .map((gstreamerInput, index) => this.createGStreamerMediaStreamOptions(gstreamerInput, index));

        if (!ret.length)
            return;
        return ret;

    }

    async getGStreamerInputSettings(): Promise<Setting[]> {
        return [
            {
                key: 'gstreamerInputs',
                title: 'GStreamer Input Stream Arguments',
                description: 'GStreamer input arguments passed to the command line gst-launch-1.0 tool. A camera may have multiple streams with different bitrates.',
                placeholder: '-i rtmp://[user:password@]192.168.1.100[:1935]/channel/101',
                value: this.getGStreamerInputs(),
                multiple: true,
            },
        ];
    }

    async putSettingBase(key: string, value: SettingValue) {
        if (key === 'gstreamerInputs') {
            this.putGStreamerInputs(value as string[]);
        }
        else {
            super.putSettingBase(key, value);
        }
    }

    async putGStreamerInputs(gstreamerInputs: string[]) {
        this.storage.setItem('gstreamerInputs', JSON.stringify(gstreamerInputs.filter(url => !!url)));
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            ...await this.getSnapshotUrlSettings(),
            ...await this.getGStreamerInputSettings(),
        ];
    }

    async createVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const index = this.getRawVideoStreamOptions()?.findIndex(vso => vso.id === options.id);
        const gstreamerInputs = this.getGStreamerInputs();
        const gstreamerInput = gstreamerInputs[index];

        if (!gstreamerInput)
            throw new Error('video streams not set up or no longer exists.');

        const server = net.createServer(async (clientSocket) => {
            clearTimeout(serverTimeout);
            server.close();

            const gstreamerServer = net.createServer(gstreamerSocket => {
                clearTimeout(gstreamerTimeout);
                gstreamerServer.close();
                clientSocket.pipe(gstreamerSocket).pipe(clientSocket);
            });
            const gstreamerTimeout = setTimeout(() => {
                this.console.log('timed out waiting for gstreamer');
                gstreamerServer.close();
            }, 30000);
            const gstreamerPort = await listenZeroCluster(gstreamerServer);
            const args = gstreamerInput.split(' ');
            args.push('!', 'mpegtsmux', '!',  'tcpclientsink', `port=${gstreamerPort}`, 'sync=false');
            this.console.log(args);
            const cp = child_process.spawn('gst-launch-1.0', args);
            cp.stdout.on('data', data => this.console.log(data.toString()));
            cp.stderr.on('data', data => this.console.log(data.toString()));

            clientSocket.on('close', () => cp.kill());
        });
        const serverTimeout = setTimeout(() => {
            this.console.log('timed out waiting for client');
            server.close();
        }, 30000);
        const port = await listenZeroCluster(server);

        const ret: FFMpegInput = {
            url: undefined,
            inputArguments: [
                '-f',
                'mpegts',
                '-i',
                `tcp://127.0.0.1:${port}`
            ],
            mediaStreamOptions: options,
        };

        return mediaManager.createFFmpegMediaObject(ret);
    }

}

class GStreamerProvider extends CameraProviderBase<MediaStreamOptions> {
    createCamera(nativeId: string): GStreamerCamera {
        return new GStreamerCamera(nativeId, this);
    }
}

export default new GStreamerProvider();
