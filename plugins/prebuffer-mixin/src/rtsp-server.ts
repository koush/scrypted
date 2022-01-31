import { readLine } from '../../../common/src/read-length';
import net from 'net';
import { Duplex, Readable } from 'stream';


interface Headers{ 
    [header: string]: string 
}

function parseHeaders(headers: string[]): Headers {
    const ret = {};
    for (const header of headers) {
        const index = header.indexOf(':');
        let value = '';
        if (index !== -1)
            value = header.substring(index + 1);
        const key = header.substring(0, index);
        ret[key] = value;
    }
    return ret;
}

class RtspServer {
    constructor(public socket: Duplex, sdp: string) {
        this.loop();
    }

    async loop() {
        try {
            let currentHeaders: string[] = [];
            while (true) {
                let line = await readLine(this.socket);
                line = line.trim();
                if (!line) {
                    await this.headers(currentHeaders);
                    currentHeaders = [];
                    continue;
                }
                currentHeaders.push(line);
            }
        }
        catch (e) {
        }
    }

    async headers(headers: string[]) {
        let [method] = headers[0].split(' ', 1);
        method = method.toLowerCase();
        if (!this[method]) {
            this.respond(400, 'Bad Request', {});
            return;
        }
    }

    respond(code: number, message: string, headers: Headers) {
        let response = `${code} ${message}\r\n`;
        for (const [key, value] of Object.entries(headers)) {
            response += `${key}: ${value}\r\n`;
        }
        response += '\r\n';
        this.socket.write(response);
    }
}
