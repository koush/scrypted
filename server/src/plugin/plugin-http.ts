import http from 'http';
import { listenZero } from './listen-zero';
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { HttpRequest, EngineIOHandler, HttpRequestHandler } from '@scrypted/sdk/types';


class PluginHttp {
    async endpointHandler(req: Request, res: Response, isPublicEndpoint: boolean, isEngineIOEndpoint: boolean,
        handler: (req: Request, res: Response, endpointRequest: HttpRequest, handler: EngineIOHandler & HttpRequestHandler) => void) {
    
        const isUpgrade = req.headers.connection?.toLowerCase() === 'upgrade';
    
        const { owner, pkg } = req.params;
        let endpoint = pkg;
        if (owner)
            endpoint = `@${owner}/${endpoint}`;
            
        let rootPath = `/endpoint/${endpoint}`;
        if (isPublicEndpoint)
            rootPath += '/public'
    
        const body = req.body && typeof req.body !== 'string' ? JSON.stringify(req.body) : req.body;
    
        const httpRequest: HttpRequest = {
            body,
            headers: req.headers,
            method: req.method,
            rootPath,
            url: req.url,
            isPublicEndpoint,
            username: res.locals.username,
        };
    
        if (isEngineIOEndpoint && !isUpgrade && isPublicEndpoint) {
            res.header("Access-Control-Allow-Origin", '*');
        }
    
        if (!isEngineIOEndpoint && isUpgrade) {
            this.wss.handleUpgrade(req, req.socket, (req as any).upgradeHead, async (ws) => {
                try {
                    const handler = this.getDevice<EngineIOHandler>(pluginDevice._id);
                    const id = 'ws-' + this.wsAtomic++;
                    const pluginHost = this.plugins[endpoint] ?? this.getPluginHostForDeviceId(endpoint);
                    if (!pluginHost) {
                        ws.close();
                        return;
                    }
                    pluginHost.ws[id] = ws;
    
                    ws.on('message', async (message) => {
                        try {
                            pluginHost.remote.ioEvent(id, 'message', message)
                        }
                        catch (e) {
                            ws.close();
                        }
                    });
                    ws.on('close', async (reason) => {
                        try {
                            pluginHost.remote.ioEvent(id, 'close');
                        }
                        catch (e) {
                        }
                        delete pluginHost.ws[id];
                    });
    
                    await handler.onConnection(httpRequest, `ws://${id}`);
                }
                catch (e) {
                    console.error('websocket plugin error', e);
                    ws.close();
                }
            });
        }
        else {
            handler(req, res, httpRequest, pluginHost, pluginDevice);
        }
    }
}


async function createPluginDeviceHttp() {
    const app = express();

    // parse application/x-www-form-urlencoded
    app.use(bodyParser.urlencoded({ extended: false }) as any)

    // parse application/json
    app.use(bodyParser.json())
    app.disable('x-powered-by');

    app.all(['/endpoint/@:owner/:pkg/public/engine.io/*', '/endpoint/:pkg/public/engine.io/*'], (req, res) => {
        this.endpointHandler(req, res, true, true, this.handleEngineIOEndpoint.bind(this))
    });

    app.all(['/endpoint/@:owner/:pkg/engine.io/*', '/endpoint/@:owner/:pkg/engine.io/*'], (req, res) => {
        this.endpointHandler(req, res, false, true, this.handleEngineIOEndpoint.bind(this))
    });

    // stringify all http endpoints
    app.all(['/endpoint/@:owner/:pkg/public', '/endpoint/@:owner/:pkg/public/*', '/endpoint/:pkg', '/endpoint/:pkg/*'], bodyParser.text() as any);

    app.all(['/endpoint/@:owner/:pkg/public', '/endpoint/@:owner/:pkg/public/*', '/endpoint/:pkg/public', '/endpoint/:pkg/public/*'], (req, res) => {
        this.endpointHandler(req, res, true, false, this.handleRequestEndpoint.bind(this))
    });

    app.all(['/endpoint/@:owner/:pkg', '/endpoint/@:owner/:pkg/*', '/endpoint/:pkg', '/endpoint/:pkg/*'], (req, res) => {
        this.endpointHandler(req, res, false, false, this.handleRequestEndpoint.bind(this))
    });


    const httpServer = new http.Server((req, res) => {

    });
    return listenZero(httpServer);
}
