import assert from 'assert';
import createDebug from 'debug';
import {ChildProcess, spawn} from 'child_process';
import {
    AudioBitrate,
    AudioSamplerate,
    AudioCodecTypes,
    DataSendCloseReason,
    ErrorHandler,
    FrameHandler,
    SiriAudioStreamProducer, AudioCodecConfiguration
} from "..";

const debug = createDebug("HAP-NodeJS:Remote:GStreamer");

const enum AudioType {
    GENERIC = 2049,
    VOICE = 2048
}

const enum Bandwidth {
    NARROW_BAND = 1101,
    MEDIUM_BAND = 1102,
    WIDE_BAND = 1103,
    SUPER_WIDE_BAND = 1104,
    FULL_BAND = 1105,
    AUTO = -1000
}

const enum BitrateType {
    CONSTANT = 0,
    VARIABLE = 1,
}

export type GStreamerOptions = {
    alsaSrc: string,
}

/**
 * SiriAudioStreamProducer utilizing gstreamer and alsa audio devices to create opus audio frames.
 *
 * This producer is mainly tested on a RaspberryPi, but should also work on other linux based devices using alsa.
 *
 * This producer requires some packages to be installed. It is advised to install the following (for example via apt-get):
 * gstreamer1.0-plugins-base, gstreamer1.0-x, gstreamer1.0-tools, libgstreamer1.0-dev, gstreamer1.0-doc,
 * gstreamer1.0-plugins-good, gstreamer1.0-plugins- ugly, gstreamer1.0-plugins-bad, gstreamer1.0-alsa
 *
 */
export class GStreamerAudioProducer implements SiriAudioStreamProducer {

    private readonly options: GStreamerOptions = {
        alsaSrc: "plughw:1"
    };

    private readonly frameHandler: FrameHandler;
    private readonly errorHandler: ErrorHandler;

    private process?: ChildProcess;
    private running: boolean = false;

    constructor(frameHandler: FrameHandler, errorHandler: ErrorHandler, options?: Partial<GStreamerOptions>) {
        this.frameHandler = frameHandler;
        this.errorHandler = errorHandler;

        if (options) {
            for (const [ key, value ] of Object.entries(options)) {
                // @ts-ignore
                GStreamerAudioProducer.options[key] = value;
            }
        }
    }

    startAudioProduction(selectedAudioConfiguration: AudioCodecConfiguration): void {
        if (this.running) {
            throw new Error("Gstreamer already running");
        }

        const codecParameters = selectedAudioConfiguration.parameters;
        assert(selectedAudioConfiguration.codecType === AudioCodecTypes.OPUS);

        let bitrateType = BitrateType.VARIABLE;
        switch (codecParameters.bitrate) {
            case AudioBitrate.CONSTANT:
                bitrateType = BitrateType.CONSTANT;
                break;
            case AudioBitrate.VARIABLE:
                bitrateType = BitrateType.VARIABLE;
                break;
        }

        let bandwidth = Bandwidth.SUPER_WIDE_BAND;
        switch (codecParameters.samplerate) {
            case AudioSamplerate.KHZ_8:
                bandwidth = Bandwidth.NARROW_BAND;
                break;
            case AudioSamplerate.KHZ_16:
                bandwidth = Bandwidth.WIDE_BAND;
                break;
            case AudioSamplerate.KHZ_24:
                bandwidth = Bandwidth.SUPER_WIDE_BAND;
                break;
        }

        let packetTime = codecParameters.rtpTime;

        debug("Launching gstreamer...");
        this.running = true;

        const args = "-q " +
            "alsasrc device=" + this.options.alsaSrc + " ! " +
            "capsfilter caps=audio/x-raw,format=S16LE,rate=24000 ! " +
            // "level post-messages=true interval=" + packetTime + "000000 ! " + // used to capture rms
            "opusenc " +
                "bitrate-type=" + bitrateType + " " +
                "bitrate=24000 " +
                "audio-type=" + AudioType.VOICE + " " +
                "bandwidth=" + bandwidth + " " +
                "frame-size=" + packetTime + " ! " +
            "fdsink fd=1";

        this.process = spawn("gst-launch-1.0", args.split(" "), {env: process.env});
        this.process.on("error", error => {
            if (this.running) {
                debug("Failed to spawn gstreamer process: " + error.message);
                this.errorHandler(DataSendCloseReason.CANCELLED);
            } else {
                debug("Failed to kill gstreamer process: " + error.message);
            }
        });
        this.process.stdout.on("data", (data: Buffer) => {
            if (!this.running) { // received data after it was closed
                return;
            }

            /*
                This listener seems to get called with only one opus frame most of the time.
                Though it happens regularly that another or many more frames get appended.
                This causes some problems as opus frames don't contain their data length in the "header".
                Opus relies on the container format to specify the length of the frame.
                Although sometimes multiple opus frames are squashed together the decoder seems to be able
                to handle that as it just creates a not very noticeable distortion.
                If we would want to make this perfect we would need to write a nodejs c++ submodule or something
                to interface directly with gstreamer api.
             */

            this.frameHandler({
                data: data,
                rms: 0.25 // only way currently to extract rms from gstreamer is by interfacing with the api directly (nodejs c++ submodule could be a solution)
            });
        });
        this.process.stderr.on("data", data => {
            debug("GStreamer process reports the following error: " + String(data));
        });
        this.process.on("exit", (code, signal) => {
            if (signal !== "SIGTERM") { // if we receive SIGTERM, process exited gracefully (we stopped it)
                debug("GStreamer process unexpectedly exited with code %d (signal: %s)", code, signal);
                this.errorHandler(DataSendCloseReason.UNEXPECTED_FAILURE);
            }
        });
    }

    stopAudioProduction(): void {
        if (this.running) {
            this.process!.kill("SIGTERM");
            this.running = false;
        }

        this.process = undefined;
    }

}
