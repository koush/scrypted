import { Deferred } from '@scrypted/common/src/deferred';
import { readLine } from '@scrypted/common/src/read-stream';
import { parseHeaders, readBody, readMessage, writeMessage } from '@scrypted/common/src/rtsp-server';
import axios from 'axios';
import crypto from 'crypto';
import { Duplex, PassThrough, Writable } from 'stream';
import { digestAuthHeader } from './digest-auth';

export function getTapoAdminPassword(cloudPassword: string) {
    return crypto.createHash('md5').update(Buffer.from(cloudPassword)).digest('hex').toUpperCase();
}

export class TapoAPI {
    keyExchange: string;
    stream: Duplex;

    constructor() {
    }

    static async connect(options: {
        address: string;
        cloudPassword: string;
    }) {
        const url = `http://${options.address}/stream`;

        // will fail with auth required.
        const response = await axios({
            url: url,
            method: 'POST',
            headers: {
                'Content-Type': 'multipart/mixed; boundary=--client-stream-boundary--',
            },
            validateStatus(status) {
                return status === 401;
            },
        });

        const wwwAuthenticate = response.headers['www-authenticate'];

        const password = getTapoAdminPassword(options.cloudPassword);

        const auth = digestAuthHeader('POST', '/stream', wwwAuthenticate, 'admin', password, 0) + ', algorithm=MD5';

        const response2 = await axios({
            url: url,
            method: 'POST',
            headers: {
                'Authorization': auth,
                'Content-Type': 'multipart/mixed; boundary=--client-stream-boundary--',
            },
            responseType: "stream",
        })

        const tapo = new TapoAPI();
        tapo.keyExchange = response2.headers['key-exchange'];
        tapo.stream = response2.data.socket;
        tapo.stream.on('close', () => console.error('strema closed'));
        // this.stream.on('data', data => console.log('data', data));
        // this.stream.resume();
        return tapo;
    }

    async processMessages() {
        const pt = new PassThrough();
        this.stream.pipe(pt);
        while (true) {
            const line = await readLine(pt);
            if (line.trim() !== '----device-stream-boundary--')
                throw new Error('expected ----device-stream-boundary--');
            const message = await readMessage(pt);
            const headers = parseHeaders(['', ...message]);
            const body = await readBody(pt, headers);

            const empty = await readLine(pt);
            if (!empty)
                throw new Error('expected empty line');

            console.log('message', headers, body?.toString());
            if (headers['content-type']?.includes('application/json')) {
                const json = JSON.parse(body.toString());
                if (json.type === 'response') {
                    const { seq, params } = json;
                    const deferred = this.requests.get(seq);
                    if (deferred) {
                        this.requests.delete(seq);
                        deferred.resolve(params)
                    }
                }
            }
        }
    }

    requests = new Map<number, Deferred<any>>();
    seq = 0;
    backchannelSessionId: string;

    async startMpegTsBackchannel(): Promise<Writable> {
        const response = await this.request({
            talk: {
                mode: "aec"
            },
            method: "get"
        });

        const { error_code } = response;
        if (error_code)
            throw new Error('unexpected error_code: ' + JSON.stringify(response));
        this.backchannelSessionId = response.session_id;

        const pt = new PassThrough();

        pt.on('readable', () => {
            let data: Buffer = pt.read();
            if (!data)
                return;

            this.stream.write('----client-stream-boundary--\r\n');
            writeMessage(this.stream, undefined, data, {
                'Content-Type': 'audio/mp2t',
                'X-If-Encrypt': '0',
                'X-Session-Id': this.backchannelSessionId,
            });
        });

        this.stream.on('close', () => pt.destroy());

        return pt;
    }

    async request(params: any) {
        const seq = ++this.seq;
        const request = {
            params,
            seq,
            type: "request"
        };

        const deferred = new Deferred<any>();
        this.requests.set(seq, deferred);
        this.stream.write('----client-stream-boundary--\r\n');
        writeMessage(this.stream, undefined, Buffer.from(JSON.stringify(request)), {
            'Content-Type': 'application/json',
        });

        return deferred.promise;
    }
}

