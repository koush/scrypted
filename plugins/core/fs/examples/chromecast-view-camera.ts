import { ScriptDevice } from "@scrypted/common/src/eval/monaco/script-device"; // SCRYPTED_FILTER_EXAMPLE_LINE
import sdk, { MediaPlayer, ScryptedDeviceBase, StartStop, VideoCamera } from "@scrypted/sdk"; // SCRYPTED_FILTER_EXAMPLE_LINE
declare const device: ScriptDevice & ScryptedDeviceBase; // SCRYPTED_FILTER_EXAMPLE_LINE
const { systemManager } = sdk; // SCRYPTED_FILTER_EXAMPLE_LINE

/**
 * Start/Stop playback of a camera on a Chromecast.
 * Can be used as an automation action.
 */

// Provide the names of the camera and the Chromecast and Camera here.
// The names must match *exactly*.
// Can also use systemManager.getDeviceById(id) with the numerical id in
// dashboard address bar, eg: https://localhost:10443/endpoint/@scrypted/core/public/#/device/100
const chromecast = systemManager.getDeviceByName<MediaPlayer & StartStop>('Office TV');
const camera = systemManager.getDeviceByName<VideoCamera>('Backyard');

class ChromecastViewCameraExample implements StartStop {
    timeout: any;

    async start() {
        device.running = true;
        const video = await camera.getVideoStream();
        await chromecast.load(video);

        // automatically stop the playback after 1 minute
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => this.stop(), 60000);
    }
    async stop() {
        device.running = false;
        await chromecast.stop();
    }
}

export default ChromecastViewCameraExample;
