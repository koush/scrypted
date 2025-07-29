import {httpFetch} from '../../../server/src/fetch/http-fetch';
import {listenZero} from '@scrypted/common/src/listen-cluster';
import {ffmpegLogInitialOutput, safePrintFFmpegArguments} from "@scrypted/common/src/media-helpers";
import {readLength, StreamEndError} from "@scrypted/common/src/read-stream";
import sdk, {
    BinarySensor,
    Camera,
    DeviceCreator,
    DeviceCreatorSettings,
    DeviceInformation,
    DeviceProvider,
    FFmpegInput,
    Intercom,
    MediaObject,
    MotionSensor,
    PictureOptions,
    ResponseMediaStreamOptions,
    ScryptedDeviceBase,
    ScryptedDeviceType,
    ScryptedInterface,
    ScryptedMimeTypes,
    Setting,
    Settings,
    VideoCamera
} from '@scrypted/sdk';
import child_process, {ChildProcess} from 'child_process';
import {randomBytes} from 'crypto';
import net from 'net';
import {PassThrough, Readable} from "stream";
import {ApiMotionEvent, ApiRingEvent, DoorbirdAPI} from "./doorbird-api";

const {deviceManager, mediaManager} = sdk;

class DoorbirdCamera extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, Settings, BinarySensor, MotionSensor {
    doorbirdApi: DoorbirdAPI | undefined;
    binarySensorTimeout: NodeJS.Timeout;
    motionSensorTimeout: NodeJS.Timeout;
    doorbellAudioActive: boolean;
    audioTXProcess: ChildProcess;
    audioRXProcess: ChildProcess;
    audioSilenceProcess: ChildProcess;
    audioRXClientSocket: net.Socket;
    pendingPicture: Promise<MediaObject>;

    private static readonly TRANSMIT_AUDIO_CHUNK_SIZE: number = 256;

    constructor(nativeId: string, public provider: DoorbirdCamProvider) {
        super(nativeId);
        this.binaryState = false;
        this.doorbellAudioActive = false;

        this.updateDeviceInfo();
    }

    getDoorbirdApi() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return undefined;

        if (!this.doorbirdApi) {
            this.doorbirdApi = new DoorbirdAPI(this.getIPAddress(), this.getUsername(), this.getPassword(), this.console);

            this.getDoorbirdApi()?.registerRingCallback((event: ApiRingEvent) => {
                this.console?.log("Ring event");
                this.console?.log("Event:", event.event);
                this.console?.log("Time:", event.timestamp);
                this.triggerBinarySensor();
            });
            this.getDoorbirdApi()?.registerMotionCallback((event: ApiMotionEvent) => {
                this.console?.log("Motion event");
                this.console?.log("Time:", event.timestamp);
                this.triggerMotionSensor();
            });
            this.getDoorbirdApi()?.startEventSocket();
        }
        return this.doorbirdApi;
    }

    async updateDeviceInfo(): Promise<void> {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;

        const deviceInfo: DeviceInformation = {
            ...this.info,
            ip
        };

        const response = await this.getDoorbirdApi()?.getInfo();

        deviceInfo.firmware = response.firmwareVersion + '-' + response.buildNumber;

        this.info = deviceInfo;
    }

    async takePicture(option?: PictureOptions): Promise<MediaObject> {
        if (!this.pendingPicture) {
            this.pendingPicture = this.takePictureThrottled(option);
            this.pendingPicture.finally(() => this.pendingPicture = undefined);
        }

        return this.pendingPicture;
    }

    async takePictureThrottled(option?: PictureOptions): Promise<MediaObject> {
        return this.createMediaObject(await this.getDoorbirdApi().getImage(), 'image/jpeg');
    }

    // Unfortunately, the Doorbird public API only offers JPEG snapshots with VGA resolution.
    // Recommendation: use the snapshot plugin to get snapshots with maximum resolution.
    public async getPictureOptions(): Promise<PictureOptions[]> {
        return [{
            id: 'VGA',
            picture: {width: 640, height: 480}
        }];
    }

    public async putSetting(key: string, value: string | number | boolean) {

        this.doorbirdApi?.stopEventSocket();
        this.doorbirdApi = undefined;

        this.storage.setItem(key, value.toString());
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);

        this.provider.updateDevice(this.nativeId, this.name);
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
                value: this.storage.getItem('username'),
                description: 'Required: Username for Doorbird HTTP API.',
            },
            {
                key: 'password',
                title: 'Password',
                value: this.storage.getItem('password'),
                type: 'password',
                description: 'Required: Password for Doorbird HTTP API.',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.1.100',
                value: this.storage.getItem('ip'),
                description: 'Required: IP address of the Doorbird station.',
            },
            {
                key: 'httpPort',
                subgroup: 'Advanced',
                title: 'HTTP Port Override',
                placeholder: '80',
                value: this.storage.getItem('httpPort'),
                description: 'Use this if you have some network firewall rules which change the HTTP port of the camera HTTP port.',
            },
            {
                key: 'rtspUrl',
                subgroup: 'Advanced',
                title: 'RTSP URL Override',
                placeholder: 'rtsp://192.168.2.100/my_doorbird_video_stream',
                value: this.storage.getItem('rtspUrl'),
                description: 'Use this in case you are already using another RTSP server/proxy (e.g. mediamtx, go2rtc, etc.) to limit the number of streams from the camera.',
            },
            {
                key: 'audioDenoise',
                type: 'boolean',
                subgroup: 'Advanced',
                title: 'Denoise',
                value: this.storage.getItem('audioDenoise') === 'true',
                description: 'Denoise both input and output audio streams to reduce background noises.',
            },
            {
                key: 'audioSpeechEnhancement',
                type: 'boolean',
                subgroup: 'Advanced',
                title: 'Speech Enhancement',
                value: this.storage.getItem('audioSpeechEnhancement') === 'true',
                description: 'Apply band filtering and dynamic normalization to both audio streams.',
            }
        ];
    }

    // When the intercom is started, we also start the audio receiver which receives audio fro the doorbird microphone.
    // This audio is then fed into ffmpeg instead of the silent audio from the silence generator.
    // We also start another process(audioTXProcess) which sends audio to the doorbird speaker.
    async startIntercom(media: MediaObject): Promise<void> {
        await this.startAudioReceiver();
        await this.startAudioTransmitter(media);
    }

    async stopIntercom(): Promise<void> {
        this.stopAudioTransmitter();
        this.stopAudioReceiver();
    }

    async startAudioTransmitter(media: MediaObject): Promise<void> {
        this.console.log('Doorbird: Init audio transmitter...');
        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const ffmpegArgs = ffmpegInput.inputArguments.slice();
        ffmpegArgs.push(
            // Do not process video streams (disable video)
            '-vn',
            // Do not process data streams (e.g. timed metadata)
            '-dn',
            // Do not process subtitle streams
            '-sn',
            // Encode audio using PCM µ-law (G.711 codec, 8-bit logarithmic compression)
            '-acodec', 'pcm_mulaw',
            // Bypass internal I/O buffering (write directly to output)
            "-avioflags", "direct",
            // Disable input buffering
            '-fflags', '+flush_packets+nobuffer',
            // Force flushing packets after every frame
            '-flush_packets', '1',
            // Use global headers (required by some muxers) and enable low-latency flags
            '-flags', '+global_header+low_delay',
            // Set number of audio channels to mono
            '-ac', '1',
            // Set audio sample rate to 8000 Hz (expected by Doorbird)
            '-ar', '8000',
            // Force raw µ-law output format (no container)
            '-f', 'mulaw',
            // Do not buffer or delay packets in the muxer
            '-muxdelay', '0',
            // --- Audio Filtering ---
            ...(this.getAudioFilter()),
            // Output to file descriptor 3 (e.g. pipe:3, for inter-process communication)
            'pipe:3'
        );

        safePrintFFmpegArguments(this.console, ffmpegArgs);
        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.audioTXProcess = cp;
        ffmpegLogInitialOutput(this.console, cp);
        cp.on('exit', () => this.console.log('Doorbird: Audio transmitter ended.'));
        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));

        const socket = cp.stdio[3] as Readable;

        const username: string = this.getUsername();
        const password: string = this.getPassword();
        const audioTxUrl: string = `${this.getHttpBaseAddress()}/bha-api/audio-transmit.cgi`;

        (async () => {

            this.console.log('Doorbird: Audio transmitter started.');
            const passthrough = new PassThrough();
            const abortController = new AbortController();
            let totalBytesWritten: number = 0;

            try {
                // Perform POST request instantly instead of unneeded handling with DIGEST authentication.
                // Credentials will be thrown into network by all other requests anyway.
                httpFetch({
                    url: audioTxUrl,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'audio/basic',
                        'Content-Length': '9999999',
                        'Authorization': this.getBasicAuthorization(username, password),
                    },
                    signal: abortController.signal,
                    body: passthrough,
                    responseType: 'readable',
                })

                while (true) {  // Loop will be broken by StreamEndError.

                    // Read the next chunk of audio data from the Doorbird camera.
                    const data = await readLength(socket, DoorbirdCamera.TRANSMIT_AUDIO_CHUNK_SIZE);
                    if (data.length === 0) {
                        break;
                    }

                    // Actually write the data to the passthrough stream.
                    passthrough.push(data);

                    // Add the length of the data to the total bytes written.
                    totalBytesWritten += data.length;
                }
            } catch (e) {
                if (!(e instanceof StreamEndError)) {
                    this.console.error('Doorbird: Audio transmitter error', e);
                }
            } finally {
                this.console.log(`Doorbird: Audio transmitter finished. bytesOut=${totalBytesWritten}ms`);
                passthrough.destroy();
                abortController.abort();
            }
            this.stopIntercom();
        })();
    }

    private getBasicAuthorization(username: string, password: string) {
        return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    stopAudioTransmitter() {
        this.audioTXProcess?.kill('SIGKILL');
        this.audioTXProcess = undefined;
    }

    async startAudioReceiver(): Promise<void> {

        const audioRxUrl = `${this.getHttpBaseAddress()}/bha-api/audio-receive.cgi`;

        this.console.log('Doorbird: Starting audio receiver...');

        const ffmpegPath = await mediaManager.getFFmpegPath();

        const ffmpegArgs = [
            // Suppress printing the FFmpeg banner. Keeps logs clean.
            '-hide_banner',
            // Disable periodic progress/statistics logging. Reduces noise and CPU usage.
            '-nostats',

            // --- Low-latency Input Flags ---
            // Reduce input buffer latency by flushing packets immediately and disabling demuxer buffering.
            '-fflags', '+flush_packets+nobuffer',
            // Do not spend time analyzing the stream to determine properties. Crucial for live streams.
            '-analyzeduration', '0',
            // Set a very small probe size to speed up initial connection, as we already know the format.
            '-probesize', '32',
            // Read input at its native frame rate to ensure real-time processing.
            '-re',

            // --- Input Format Specification ---
            // Set the audio sample rate to 8000 Hz, matching the Doorbird's stream.
            '-ar', '8000',
            // Set the number of audio channels to 1 (mono).
            '-ac', '1',
            // Force the input format to be interpreted as G.711 µ-law.
            '-f', 'mulaw',
            // Specify the input URL for the Doorbird's audio stream.
            '-i', `${audioRxUrl}`,

            // --- Audio Filtering ---
            ...(this.getAudioFilter()),

            // --- Low-latency Output Flags ---
            // Enable low-delay flags in the encoder, preventing frame buffering for lookahead.
            '-flags', '+global_header+low_delay',
            // Bypass FFmpeg's internal I/O buffering, writing directly to the output pipe.
            '-avioflags', 'direct',
            // Force flushing packets to the output immediately after encoding.
            '-flush_packets', '1',
            // Set the maximum demux-decode delay to zero, preventing buffering in the muxer.
            '-muxdelay', '0',

            // --- Output Format Specification ---
            // Re-encode the audio to PCM µ-law after the filter has been applied.
            '-acodec', 'pcm_mulaw',
            // Force the output container format to raw µ-law.
            '-f', 'mulaw',
            // Output the processed audio to file descriptor 3 (the pipe).
            'pipe:3'
        ];

        safePrintFFmpegArguments(console, ffmpegArgs);
        const cp = child_process.spawn(ffmpegPath, ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.audioRXProcess = cp;
        ffmpegLogInitialOutput(console, cp);

        cp.on('exit', () => {
            this.console.log('Doorbird: audio receiver ended.')
            this.stopIntercom();
        });
        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));

        this.doorbellAudioActive = true;
        cp.stdio[3].on('data', data => {
            if (this.doorbellAudioActive && this.audioRXClientSocket) {
                this.audioRXClientSocket.write(data);
            }
        });
    }

    stopAudioReceiver() {
        this.doorbellAudioActive = false;
        this.audioRXProcess?.kill('SIGKILL');
        this.audioRXProcess = undefined;
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [{
            id: 'default',
            name: 'default',
            container: '', // must be empty to support prebuffering
            video: {
                codec: 'h264'
            },
            audio: { /*this.isAudioDisabled() ? null : {}, */
                // this is a hint to let homekit, et al, know that it's OPUS audio and does not need transcoding.
                codec: 'pcm_mulaw',
            }
        }];
    }

    async getVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {

        const audioRtspStreamPort = await this.startAudioRXServer();

        const ffmpegInput: FFmpegInput = {
            url: undefined,
            inputArguments: [
                // --- Low-latency Input Flags (for both streams) ---
                // Suppress printing the FFmpeg banner.
                '-hide_banner',
                // Disable periodic progress/statistics logging.
                '-nostats',
                // Set the log level to 'error' to suppress verbose informational messages.
                '-loglevel', 'error',

                // Reduce input buffer latency by flushing packets immediately and disabling demuxer buffering.
                // '+nobuffer' is particularly important for live streams.
                '-fflags', '+flush_packets+nobuffer',
                // Do not spend time analyzing the stream to determine properties. Crucial for live streams.
                '-analyzeduration', '0',
                // Set a very small probe size to speed up initial connection, as we know the formats.
                '-probesize', '32',
                // Request low-delay flags from decoders.
                '-flags', 'low_delay',

                // --- Video Input (Input 0) ---
                // Force the input format to be interpreted as RTSP.
                '-f', 'rtsp',
                // Use TCP for RTSP transport for better reliability over potentially lossy networks.
                '-rtsp_transport', 'tcp',
                // Specify the input URL for the Doorbird's RTSP video stream.
                '-i', `${this.getRtspAddress()}`,

                // --- Audio Input (Input 1) ---
                // Force the format of the second input to be interpreted as G.711 µ-law.
                '-f', 'mulaw',
                // Set the number of audio channels to 1 (mono) for the audio input.
                '-ac', '1',
                // Set the audio sample rate to 8000 Hz for the audio input.
                '-ar', '8000',
                // Explicitly define the channel layout as mono.
                '-channel_layout', 'mono',
                // Use the system's wall clock for timestamps. This helps synchronize the separate audio
                // and video streams, which do not share a common clock source.
                '-use_wallclock_as_timestamps', '1',
                // Specify the second input as the local TCP socket providing the audio stream.
                // `tcp_nodelay=1` disables Nagle's algorithm, reducing latency for small packets.
                '-i', `tcp://127.0.0.1:${audioRtspStreamPort}?tcp_nodelay=1`,
                // --- Output Stream Handling ---
                // Increase the maximum delay for the muxing queue to 5 seconds (in microseconds).
                // This prevents the "Delay between the first packet and last packet" error
                // by allowing more time for packets from different streams to arrive.
                '-max_delay', '5000000',
                // Finish encoding when the shortest input stream (the video) ends.
                // This ensures ffmpeg terminates if the video stream is interrupted by Doorbird.
                '-shortest',
            ],
            mediaStreamOptions: options,
        };

        return mediaManager.createFFmpegMediaObject(ffmpegInput);
    }

    async startSilenceGenerator() {

        if (this.audioSilenceProcess)
            return;

        this.console.log('Doorbird: starting audio silence generator...')

        const ffmpegPath = await mediaManager.getFFmpegPath();
        const ffmpegArgs = [
            // Suppress printing the FFmpeg banner.
            '-hide_banner',
            // Disable periodic progress/statistics logging.
            '-nostats',
            // Read input at its native frame rate to ensure real-time processing.
            '-re',
            // Use the lavfi (libavfilter) virtual input device.
            '-f', 'lavfi',
            // Specify the input source as a null audio source (silence) with a sample rate of 8000 Hz and mono channel layout.
            '-i', 'anullsrc=r=8000:cl=mono',

            // --- Low-latency Output Flags ---
            // Bypass FFmpeg's internal I/O buffering, writing directly to the output pipe.
            '-avioflags', 'direct',
            // Force flushing packets to the output immediately after encoding.
            '-flush_packets', '1',
            // Set the maximum demux-decode delay to zero, preventing buffering in the muxer.
            '-muxdelay', '0',

            // --- Output Format Specification ---
            // Force the output container format to raw µ-law.
            '-f', 'mulaw',
            // Output the processed audio to file descriptor 3 (the pipe).
            'pipe:3'
        ];

        safePrintFFmpegArguments(console, ffmpegArgs);
        const cp = child_process.spawn(ffmpegPath, ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.audioSilenceProcess = cp;
        ffmpegLogInitialOutput(console, cp);

        cp.on('exit', () => {
            this.console.log('Doorbird: audio silence generator ended.')
            this.audioSilenceProcess = undefined;
        });
        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));
        cp.stdio[3].on('data', data => {
            if (!this.doorbellAudioActive && this.audioRXClientSocket) {
                this.audioRXClientSocket.write(data);
            }
        });
    }

    stopSilenceGenerator() {
        this.audioSilenceProcess?.kill();
        this.audioSilenceProcess = null;
    }

    async startAudioRXServer(): Promise<number> {

        const server = net.createServer(async (clientSocket) => {
            clearTimeout(serverTimeout);
            this.console.log(`Doorbird: audio connection from client ${JSON.stringify(clientSocket.address())}`);

            this.audioRXClientSocket = clientSocket;

            this.startSilenceGenerator();

            this.audioRXClientSocket.on('close', () => {
                this.stopSilenceGenerator();
                this.audioRXClientSocket = null;
            });

        });
        const serverTimeout = setTimeout(() => {
            this.console.log('Doorbird: timed out waiting for tcp client from ffmpeg');
            server.close();
        }, 30000);
        const port = await listenZero(server, '127.0.0.1');
        this.console.log(`Doorbird: audio server started on port ${port}`);
        return port;
    }

    triggerBinarySensor() {
        this.binaryState = true;
        clearTimeout(this.binarySensorTimeout);
        this.binarySensorTimeout = setTimeout(() => this.binaryState = false, 3000);
    }

    triggerMotionSensor() {
        this.motionDetected = true;
        clearTimeout(this.motionSensorTimeout);
        this.motionSensorTimeout = setTimeout(() => this.motionDetected = false, 3000);
    }

    setHttpPortOverride(port: string) {
        this.storage.setItem('httpPort', port || '');
    }

    getHttpBaseAddress() {
        return `http://${this.getUsername()}:${this.getPassword()}@${this.getIPAddress()}:${this.storage.getItem('httpPort') || 80}`;
    }

    getRtspAddress() {
        if (this.storage.getItem('rtspUrl') !== undefined) {
            return this.storage.getItem('rtspUrl');
        } else {
            return this.getRtspDefaultAddress();
        }
    }

    getRtspDefaultAddress() {
        return `rtsp://${this.getUsername()}:${this.getPassword()}@${this.getIPAddress()}/mpeg/media.amp`;
    }

    getIPAddress() {
        return this.storage.getItem('ip');
    }

    setIPAddress(ip: string) {
        return this.storage.setItem('ip', ip);
    }

    getUsername() {
        return this.storage.getItem('username');
    }

    getPassword() {
        return this.storage.getItem('password');
    }

    setAudioDenoise(enabled: boolean) {
        this.storage.setItem('audioDenoise', enabled.toString());
    }

    getAudioDenoise(): boolean {
        return this.storage.getItem('audioDenoise') === 'true';
    }

    setAudioSpeechEnhancement(enabled: boolean) {
        this.storage.setItem('audioSpeechEnhancement', enabled.toString());
    }

    getAudioSpeechEnhancement(): boolean {
        return this.storage.getItem('audioSpeechEnhancement') === 'true';
    }

    private getAudioFilter() {
        const filters: string[] = [];
        if (this.getAudioDenoise()) {
            // Apply noise reduction using the 'afftdn' filter.
            // - 'afftdn=nf=-50' removes background noise below -50 dB (e.g. hiss, hum)
            // - 'agate=threshold=0.06:attack=20:release=250' gates quiet sounds:
            //      threshold=0.06  → suppresses signals below ~-24 dBFS (breaths, room noise)
            //      attack=20       → gate opens smoothly in 20 ms to preserve speech onset
            //      release=250     → gate closes slowly in 250 ms to avoid cutting word ends
            filters.push('afftdn=nf=-50', 'agate=threshold=0.06:attack=20:release=250');
        }
        if (this.getAudioSpeechEnhancement()) {
            // Apply high-pass and low-pass filters to remove frequencies outside the human voice range and apply dynamic normalization.
            // - 'highpass=f=200'      → removes low rumbles below 200 Hz (e.g. touch intercom while speaking, low street noise)
            // - 'lowpass=f=3000'      → removes harsh highs above 3 kHz to reduce hiss/sibilance
            // - 'acompressor=threshold=0.1:ratio=4:attack=20:release=200'
            //      threshold=0.1      → starts compressing above ~-20 dBFS
            //      ratio=4            → reduces dynamic range by a 4:1 ratio
            //      attack=20          → begins compression quickly to catch loud speech
            //      release=200        → smooths out gain after loud parts
            // - 'volume=4'            → boosts output gain 4x after compression
            filters.push('highpass=f=200', 'lowpass=f=3000', 'acompressor=threshold=0.1:ratio=4:attack=20:release=200', 'volume=4');
        }

        if (filters.length === 0) {
            return [];
        }
        return ['-af', filters.join(',')];
    }
}

export class DoorbirdCamProvider extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {

    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);

        for (const camId of deviceManager.getNativeIds()) {
            if (camId)
                this.getDevice(camId);
        }
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {

        let info: DeviceInformation = {};

        const host = settings.ip?.toString();
        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const skipValidate = settings.skipValidate === 'true';

        if (!skipValidate) {
            const api = new DoorbirdAPI(host, username, password, this.console);
            try {
                const deviceInfo = await api.getInfo();

                settings.newCamera = deviceInfo.deviceType;
                info.model = deviceInfo.deviceType;
                info.serialNumber = deviceInfo.serialNumber;
                info.mac = deviceInfo.serialNumber;
                info.manufacturer = 'Bird Home Automation GmbH';
                info.managementUrl = 'https://webadmin.doorbird.com';
            } catch (e) {
                this.console.error('Error adding Doorbird camera', e);
                throw e;
            }
        }
        settings.newCamera ||= 'Doorbird Camera';

        nativeId ||= randomBytes(4).toString('hex');
        const name = settings.newCamera?.toString();
        await this.updateDevice(nativeId, name);

        const device = await this.getDevice(nativeId) as DoorbirdCamera;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        device.setIPAddress(settings.ip.toString());
        device.setHttpPortOverride(settings.httpPort?.toString());
        device.setAudioDenoise(settings.audioDenoise === 'true');
        device.setAudioSpeechEnhancement(settings.audioSpeechEnhancement === 'true');

        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.2.222',
            },
            {
                key: 'httpPort',
                title: 'HTTP Port',
                description: 'Optional: Override the HTTP Port from the default value of 80',
                placeholder: '80',
            },
            {
                key: 'skipValidate',
                title: 'Skip Validation',
                description: 'Add the device without verifying the credentials and network settings.',
                type: 'boolean',
            }
        ]
    }

    updateDevice(nativeId: string, name: string) {
        return deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces: [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
                ScryptedInterface.Intercom,
                ScryptedInterface.BinarySensor,
                ScryptedInterface.MotionSensor
            ],
            type: ScryptedDeviceType.Doorbell,
            info: deviceManager.getNativeIds().includes(nativeId) ? deviceManager.getDeviceState(nativeId)?.info : undefined,
        });
    }

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = this.createCamera(nativeId);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        if (this.devices.delete(nativeId)) {
            this.console.log("Doorbird: Removed device from list: " + id + " / " + nativeId)
        }
    }

    createCamera(nativeId: string): DoorbirdCamera {
        return new DoorbirdCamera(nativeId, this);
    }
}

export default new DoorbirdCamProvider();
