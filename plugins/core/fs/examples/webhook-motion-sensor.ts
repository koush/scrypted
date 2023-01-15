import { ScriptDevice } from "@scrypted/common/src/eval/monaco/script-device"; // SCRYPTED_FILTER_EXAMPLE_LINE
import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk"; // SCRYPTED_FILTER_EXAMPLE_LINE
declare const device: ScriptDevice & ScryptedDeviceBase; // SCRYPTED_FILTER_EXAMPLE_LINE
const { endpointManager } = sdk; // SCRYPTED_FILTER_EXAMPLE_LINE

class WebhookExample implements HttpRequestHandler {
    timeout: any;

    async onRequest(request: HttpRequest, response: HttpResponse) {
        response.send('OK');
        device.motionDetected = true;
        // reset the motion sensor after 10 seconds.
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => device.motionDetected = false, 10000);
    }
}

device.handleTypes(ScryptedInterface.MotionSensor);

endpointManager.getLocalEndpoint(device.nativeId, { insecure: true, public: true })
    .then(endpoint => console.log('motion webhook:', endpoint));

export default WebhookExample;
