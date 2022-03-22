import axios from 'axios';
import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase } from '@scrypted/sdk';

class AlexaPlugin extends ScryptedDeviceBase implements HttpRequestHandler {
    constructor() {
        super();
        this.on = this.on || false;
    }

    async onRequest(request: HttpRequest, response: HttpResponse) {
        response.send('', {
            code: 500,
        });
    }
}

export default AlexaPlugin;
