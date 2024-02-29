import Http from 'http';
import {  HttpFetchResponseType } from '@scrypted/common/src/http-auth-fetch';
import {  HttpFetchResponse } from '@scrypted/server/src/fetch';
import { Readable } from 'stream';
import * as Auth from 'http-auth-client';

export interface AuthRequestOptions extends Http.RequestOptions {
    sessionAuth?: Auth.Basic | Auth.Digest | Auth.Bearer;
    responseType: HttpFetchResponseType;
}

export type  AuthRequestBody = string | Buffer | Readable;

export class AuthRequst {

    private username: string;
    private password: string;
    private auth: Auth.Basic | Auth.Digest | Auth.Bearer;

    constructor(username:string, password: string, console: Console) {
        this.username = username;
        this.password = password;
    }

    async request(url: string, options: AuthRequestOptions, body?: AuthRequestBody) {

        let opt = {...options};

        if (typeof opt.method === 'undefined') {
            opt.method = 'GET';
        }

        if (opt.headers === undefined) {
            delete opt.headers;
        }

        const response = new Promise<HttpFetchResponse<any>>( (resolve, reject) => {

            const req = Http.request(url, opt)

            req.once('response', async (resp) => {

                if (resp.statusCode == 401) {

                    if (opt.sessionAuth) {
                        resolve(await this.parseResponse (opt.responseType, resp));
                        return;
                    }

                    opt.sessionAuth = this.createAuth(resp.headers['www-authenticate'], !!this.auth);
                    this.auth = undefined;
                    const result = await this.request(url, opt, body);
                    resolve(result);
                }
                else {
                    this.auth = opt.sessionAuth;
                    resolve(await this.parseResponse(opt.responseType, resp));
                }
            });

            req.once('error', (error) => {
                reject(error);
            });

            if (opt.sessionAuth) {
                req.setHeader('Authorization', opt.sessionAuth.authorization(req.method, req.path));
            }
            else if (this.auth) {
                req.setHeader('Authorization', this.auth.authorization(req.method, req.path));
            }

            if (typeof body === 'undefined') {
                req.end();
            }
            else {

                this.readableBody(req, body).pipe(req);
                req.flushHeaders();
            }
    
        });

        return response;
    }

    private createAuth(authenticate: string, noThrow: boolean) {

        try {

            const challenges = Auth.parseHeaders(authenticate);
            let auth = Auth.create(challenges);
            return auth.credentials(this.username, this.password);
        } 
        catch (error) {

            if (noThrow) {
                return undefined;
            }

            throw error;
        }
    }

    private async parseResponse(responseType: HttpFetchResponseType,  msg: Http.IncomingMessage): Promise<HttpFetchResponse<any>> {

        let body: any;
        switch (responseType) {

            case 'json':
                const text = await this.readText(msg);
                body =  JSON.parse(text);
                break;

            case 'text':
                body = await this.readText(msg);
                break;

            case 'buffer':
                body = await this.readBuffer(msg);
                break;

            default:
                body = msg;
        }

        const incomingHeaders = new Headers();

        for (const [k, v] of Object.entries(msg.headers)) {

            for (const vv of (typeof v === 'string' ? [v] : v)) {
                incomingHeaders.append(k, vv)
            }
        }
    
        let result: HttpFetchResponse<any> = { 
            body, 
            headers: incomingHeaders, 
            statusCode: msg.statusCode
        };

        return result;
    }

    private async readText(readable: Readable): Promise<string> {

        let result: string = '';
        return new Promise<string>((resolve, reject) => {

            readable.setEncoding('utf-8');

            readable.on('data', chunk => {
                result += chunk;
            });

            readable.once('end', () => {
                resolve(result);
            });
        });
    }

    private async readBuffer(readable: Readable): Promise<Buffer> {

        let result = Buffer.alloc(0);
        return new Promise<Buffer>((resolve, reject) => {

            readable.on('data', chunk => {
                result = Buffer.concat([result, chunk]);
            });

            readable.once('end', () => {
                resolve(result);
            });
        });
    }

    private readableBody(requst: Http.ClientRequest, body: AuthRequestBody): Readable {

        if (typeof body === 'string') {
            body = Buffer.from(body);
        }

        if (body instanceof Buffer) {

            const len = body.byteLength;
            requst.setHeader('Content-Type', 'application/octet-stream');
            requst.setHeader('Content-Length', len);
            body = Readable.from(body);
        }

        return body;
    }
}
