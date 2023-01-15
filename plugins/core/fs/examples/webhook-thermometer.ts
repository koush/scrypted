import { ScriptDevice } from "@scrypted/common/src/eval/monaco/script-device"; // SCRYPTED_FILTER_EXAMPLE_LINE
import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk"; // SCRYPTED_FILTER_EXAMPLE_LINE
declare const device: ScriptDevice & ScryptedDeviceBase; // SCRYPTED_FILTER_EXAMPLE_LINE
const { endpointManager } = sdk; // SCRYPTED_FILTER_EXAMPLE_LINE

class WebhookExample implements HttpRequestHandler {
    timeout: any;

    async onRequest(request: HttpRequest, response: HttpResponse) {
        response.send('OK');
        // scrpyted uses metric for all units, so this must be celsius
        device.temperature = parseFloat(request.body!);
    }
}

device.handleTypes(ScryptedInterface.Thermometer);

endpointManager.getLocalEndpoint(device.nativeId, { insecure: true, public: true })
    .then(endpoint => {
        console.log('motion webhook:', endpoint);
        console.log('example:');
        console.log('   curl -H "Content-Type: text/plain" --data 25 ', endpoint);
    });

export default WebhookExample;
