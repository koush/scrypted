import { HttpRequest } from '@scrypted/types';
import bodyParser from 'body-parser';
import { Request, Response, Router } from 'express';
import { IncomingHttpHeaders, ServerResponse } from 'http';
import WebSocket, { Server as WebSocketServer } from "ws";

export function isConnectionUpgrade(headers: IncomingHttpHeaders) {
    // connection:'keep-alive, Upgrade'
    return headers.connection?.toLowerCase().includes('upgrade');
}

export abstract class PluginHttp<T> {
    wss = new WebSocketServer({ noServer: true });

    constructor(public app: Router) {
    }

    addMiddleware() {
        this.app.all(['/endpoint/@:owner/:pkg/public/engine.io/*', '/endpoint/:pkg/public/engine.io/*'], (req, res) => {
            this.endpointHandler(req, res, true, true, this.handleEngineIOEndpoint.bind(this))
        });

        this.app.all(['/endpoint/@:owner/:pkg/engine.io/*', '/endpoint/@:owner/:pkg/engine.io/*'], (req, res) => {
            this.endpointHandler(req, res, false, true, this.handleEngineIOEndpoint.bind(this))
        });

        // stringify all http endpoints
        this.app.all(['/endpoint/@:owner/:pkg/public', '/endpoint/@:owner/:pkg/public/*', '/endpoint/:pkg', '/endpoint/:pkg/*'], bodyParser.text() as any);

        this.app.all(['/endpoint/@:owner/:pkg/public', '/endpoint/@:owner/:pkg/public/*', '/endpoint/:pkg/public', '/endpoint/:pkg/public/*'], (req, res) => {
            this.endpointHandler(req, res, true, false, this.handleRequestEndpoint.bind(this))
        });

        this.app.all(['/endpoint/@:owner/:pkg', '/endpoint/@:owner/:pkg/*', '/endpoint/:pkg', '/endpoint/:pkg/*'], (req, res) => {
            this.endpointHandler(req, res, false, false, this.handleRequestEndpoint.bind(this))
        });
    }

    abstract handleEngineIOEndpoint(req: Request, res: ServerResponse, endpointRequest: HttpRequest, pluginData: T): void;
    abstract handleRequestEndpoint(req: Request, res: Response, endpointRequest: HttpRequest, pluginData: T): void;
    abstract getEndpointPluginData(req: Request, endpoint: string, isUpgrade: boolean, isEngineIOEndpoint: boolean): Promise<T>;
    abstract handleWebSocket(endpoint: string, httpRequest: HttpRequest, ws: WebSocket, pluginData: T): Promise<void>;
    abstract checkUpgrade(req: Request, res: Response, pluginData: T): void;

    async endpointHandler(req: Request, res: Response, isPublicEndpoint: boolean, isEngineIOEndpoint: boolean,
        handler: (req: Request, res: Response, endpointRequest: HttpRequest, pluginData: T) => void) {

        const isUpgrade = isConnectionUpgrade(req.headers);

        const end = (code: number, message: string) => {
            if (isUpgrade) {
                const socket = res.socket;
                socket.write(`HTTP/1.1 ${code} ${message}\r\n` +
                    '\r\n');
                socket.destroy();
            }
            else {
                res.header('Content-Type', 'text/plain');
                res.status(code);
                res.send(message);
            }
        };

        const { owner, pkg } = req.params;
        let endpoint = pkg;
        if (owner)
            endpoint = `@${owner}/${endpoint}`;
        const pluginData = await this.getEndpointPluginData(req, endpoint, isUpgrade, isEngineIOEndpoint);

        if (!pluginData) {
            end(404, `Not Found (plugin or device "${endpoint}" not found)`);
            return;
        }

        if (isEngineIOEndpoint && isUpgrade) {
            this.checkUpgrade(req, res, pluginData);
        }

        if (isEngineIOEndpoint && req.method === 'OPTIONS') {
            res.send(204);
            return;
        }


        if (!isPublicEndpoint && !res.locals.username) {
            end(401, 'Not Authorized');
            console.log('rejected request', isPublicEndpoint, res.locals.username, req.originalUrl)
            return;
        }

        if (isUpgrade && req.headers.upgrade?.toLowerCase() !== 'websocket') {
            end(404, 'Not Found (unknown upgrade protocol)');
            return;
        }

        let rootPath = `/endpoint/${endpoint}`;
        if (isPublicEndpoint)
            rootPath += '/public'

        const body = req.body && typeof req.body !== 'string' ? JSON.stringify(req.body) : req.body;

        const httpRequest: HttpRequest = {
            body,
            headers: req.headers as any,
            method: req.method,
            rootPath,
            url: req.url,
            isPublicEndpoint,
            username: res.locals.username,
            aclId: res.locals.aclId,
        };

        if (!isEngineIOEndpoint && isUpgrade) {
            try {
                this.wss.handleUpgrade(req, req.socket, (req as any).upgradeHead, async (ws) => {
                    try {
                        await this.handleWebSocket(endpoint, httpRequest, ws, pluginData);
                    }
                    catch (e) {
                        console.error('websocket plugin error', e);
                        ws.close();
                    }
                });
            }
            catch (e) {
                res.header('Content-Type', 'text/plain');
                res.status(500);
                res.send(e.toString());
                console.error(e);
            }
        }
        else {
            try {
                handler(req, res, httpRequest, pluginData);
            }
            catch (e) {
                res.header('Content-Type', 'text/plain');
                res.status(500);
                res.send(e.toString());
                console.error(e);
            }
        }
    }
}
