import axios from 'axios';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import express, { Request } from 'express';
import fs from 'fs';
import http from 'http';
import httpAuth from 'http-auth';
import https from 'https';
import net from 'net';
import os from 'os';
import path from 'path';
import process from 'process';
import semver from 'semver';
import { install as installSourceMapSupport } from 'source-map-support';
import { createSelfSignedCertificate, CURRENT_SELF_SIGNED_CERTIFICATE_VERSION } from './cert';
import { Plugin, ScryptedUser, Settings } from './db-types';
import Level from './level';
import { PluginError } from './plugin/plugin-error';
import { getScryptedVolume } from './plugin/plugin-volume';
import { RPCResultError } from './rpc';
import { ScryptedRuntime } from './runtime';
import { getHostAddresses, SCRYPTED_DEBUG_PORT, SCRYPTED_INSECURE_PORT, SCRYPTED_SECURE_PORT } from './server-settings';
import { Info } from './services/info';
import { setScryptedUserPassword } from './services/users';
import { sleep } from './sleep';
import { ONE_DAY_MILLISECONDS, UserToken } from './usertoken';
import { once } from 'events';
import util from 'util';

export type Runtime = ScryptedRuntime;

if (!semver.gte(process.version, '16.0.0')) {
    throw new Error('"node" version out of date. Please update node to v16 or higher.')
}

process.on('unhandledRejection', error => {
    if (error?.constructor !== RPCResultError && error?.constructor !== PluginError) {
        console.error('pending crash', error);
        throw error;
    }
    console.warn('unhandled rejection of RPC Result', error);
});

async function listenServerPort(env: string, port: number, server: any) {
    server.listen(port);
    try {
        await once(server, 'listening');
    }
    catch (e) {
        console.error(`Failed to listen on port ${port}. It may be in use.`);
        console.error(`Use the environment variable ${env} to change the port.`);
        throw e;
    }
}

installSourceMapSupport({
    environment: 'node',
});

let workerInspectPort: number = undefined;

async function doconnect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const target = net.connect(workerInspectPort, '127.0.0.1');
        target.once('error', reject)
        target.once('connect', () => resolve(target))
    })
}

const debugServer = net.createServer(async (socket) => {
    if (!workerInspectPort) {
        socket.destroy();
        return;
    }

    for (let i = 0; i < 10; i++) {
        try {
            const target = await doconnect();
            socket.pipe(target).pipe(socket);
            const destroy = () => {
                socket.destroy();
                target.destroy();
            }
            socket.on('error', destroy);
            target.on('error', destroy);
            socket.on('close', destroy);
            target.on('close', destroy);
            return;
        }
        catch (e) {
            await sleep(500);
        }
    }
    console.warn('debugger connect timed out');
    socket.destroy();
})
listenServerPort('SCRYPTED_DEBUG_PORT', SCRYPTED_DEBUG_PORT, debugServer)
    .catch(() => { });

const app = express();

app.set('trust proxy', 'loopback');

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }) as any)

// parse application/json
app.use(bodyParser.json())

// parse some custom thing into a Buffer
app.use(bodyParser.raw({ type: 'application/zip', limit: 100000000 }) as any)

async function start(mainFilename: string, options?: {
    onRuntimeCreated?: (runtime: ScryptedRuntime) => Promise<void>,
}) {
    const volumeDir = getScryptedVolume();
    await fs.promises.mkdir(volumeDir, {
        recursive: true
    });
    const dbPath = path.join(volumeDir, 'scrypted.db');
    const db = new Level(dbPath);
    await db.open();

    let certSetting = await db.tryGet(Settings, 'certificate') as Settings;

    if (certSetting?.value?.version !== CURRENT_SELF_SIGNED_CERTIFICATE_VERSION) {
        const cert = createSelfSignedCertificate();

        certSetting = new Settings();
        certSetting._id = 'certificate';
        certSetting.value = cert;
        certSetting = await db.upsert(certSetting);
    }

    const basicAuth = httpAuth.basic({
        realm: 'Scrypted',
    }, async (username, password, callback) => {
        const user = await db.tryGet(ScryptedUser, username);

        const salted = user.salt + password;
        const hash = crypto.createHash('sha256');
        hash.update(salted);
        const sha = hash.digest().toString('hex');

        callback(sha === user.passwordHash || password === user.token);
    });

    const keys = certSetting.value;

    const httpsServerOptions = process.env.SCRYPTED_HTTPS_OPTIONS_FILE
        ? JSON.parse(fs.readFileSync(process.env.SCRYPTED_HTTPS_OPTIONS_FILE).toString())
        : {};

    const mergedHttpsServerOptions = Object.assign({
        key: keys.serviceKey,
        cert: keys.certificate
    }, httpsServerOptions);
    const secure = https.createServer(mergedHttpsServerOptions, app);
    const insecure = http.createServer(app);

    // use a hash of the private key as the cookie secret.
    app.use(cookieParser(crypto.createHash('sha256').update(certSetting.value.serviceKey).digest().toString('hex')));

    // trap to add access control headers.
    app.use((req, res, next) => {
        if (!req.headers.upgrade)
            scrypted.addAccessControlHeaders(req, res);
        next();
    })

    const authSalt = crypto.randomBytes(16);
    const createTokens = (userToken: UserToken) => {
        const login_user_token = userToken.toString();
        const salted = login_user_token + authSalt;
        const hash = crypto.createHash('sha256');
        hash.update(salted);
        const sha = hash.digest().toString('hex');
        const queryToken = `${sha}#${login_user_token}`;
        return {
            authorization: `Bearer ${queryToken}`,
            // query token are the query parameters that must be added to an url for authorization.
            // useful for cross origin img tags.
            queryToken: {
                scryptedToken: queryToken,
            },
        };
    }

    app.use(async (req, res, next) => {
        if (process.env.SCRYPTED_DISABLE_AUTHENTICATION === 'true') {
            res.locals.username = 'anonymous';
            next();
            return;
        }

        // the remote address may be ipv6 prefixed so use a fuzzy match.
        // eg ::ffff:192.168.2.124
        if (process.env.SCRYPTED_ADMIN_USERNAME
            && process.env.SCRYPTED_ADMIN_ADDRESS
            && req.socket.remoteAddress?.endsWith(process.env.SCRYPTED_ADMIN_ADDRESS)) {
            res.locals.username = process.env.SCRYPTED_ADMIN_USERNAME;
            res.locals.aclId = undefined;
            next();
            return;
        }

        // this is a trap for all auth.
        // only basic auth will fail with 401. it is up to the endpoints to manage
        // lack of login from cookie auth.

        const checkToken = (token: string) => {
            if (process.env.SCRYPTED_ADMIN_TOKEN === token) {
                let username = process.env.SCRYPTED_ADMIN_USERNAME;
                if (!username) {
                    const firstAdmin = [...scrypted.usersService.users.values()].find(u => !u.aclId);
                    username = firstAdmin?._id;
                }
                if (username) {
                    res.locals.username = username;
                    res.locals.aclId = undefined;
                    return;
                }
            }

            for (const user of scrypted.usersService.users.values()) {
                if (user.token === token) {
                    res.locals.username = user._id;
                    res.locals.aclId = user.aclId;
                    break;
                }
            }

            const [checkHash, ...tokenParts] = token.split('#');
            const tokenPart = tokenParts?.join('#');
            if (checkHash && tokenPart) {
                const salted = tokenPart + authSalt;
                const hash = crypto.createHash('sha256');
                hash.update(salted);
                const sha = hash.digest().toString('hex');

                if (checkHash === sha) {
                    const userToken = checkValidUserToken(tokenPart);
                    if (userToken) {
                        res.locals.username = userToken.username;
                        res.locals.aclId = userToken.aclId;
                    }
                }
            }
        }

        const userToken = getSignedLoginUserToken(req);
        if (userToken) {
            const { username, aclId } = userToken;

            // this database lookup on every web request is not necessary, the cookie
            // itself is the auth, and is signed. furthermore, this is currently
            // a single user setup anywyas. revisit this at some point when
            // multiple users are implemented.

            // const user = await db.tryGet(ScryptedUser, username);
            // if (!user) {
            //     console.warn('login not found');
            //     return next();
            // }

            res.locals.username = username;
            res.locals.aclId = aclId;
        }
        else if (req.headers.authorization?.startsWith('Bearer ')) {
            checkToken(req.headers.authorization.substring('Bearer '.length));
        }
        else if (req.query['scryptedToken']) {
            checkToken(req.query.scryptedToken.toString());
        }
        next();
    });

    // allow basic auth to deploy plugins
    app.all('/web/component/*', (req, res, next) => {
        if (req.protocol === 'https' && req.headers.authorization && req.headers.authorization.toLowerCase()?.indexOf('basic') !== -1) {
            const basicChecker = basicAuth.check((req) => {
                res.locals.username = req.user;
                (req as any).username = req.user;
                next();
            });

            // this automatically handles unauthorized.
            basicChecker(req, res);
            return;
        }
        next();
    })

    // verify all plugin related requests have admin auth
    app.all('/web/component/*', (req, res, next) => {
        if (!res.locals.username || res.locals.aclId) {
            res.status(401);
            res.send('Not Authorized');
            return;
        }
        next();
    });

    const scrypted = new ScryptedRuntime(mainFilename, db, insecure, secure, app);
    await options?.onRuntimeCreated?.(scrypted);
    await scrypted.start();

    await listenServerPort('SCRYPTED_SECURE_PORT', SCRYPTED_SECURE_PORT, secure);
    await listenServerPort('SCRYPTED_INSECURE_PORT', SCRYPTED_INSECURE_PORT, insecure);

    console.log('#######################################################');
    console.log(`Scrypted Volume           : ${volumeDir}`);
    console.log(`Scrypted Server (Local)   : https://localhost:${SCRYPTED_SECURE_PORT}/`);
    for (const address of getHostAddresses(true, true)) {
        console.log(`Scrypted Server (Remote)  : https://${address}:${SCRYPTED_SECURE_PORT}/`);
    }
    console.log(`Version:       : ${await scrypted.info.getVersion()}`);
    console.log('#######################################################');
    console.log('Scrypted insecure http service port:', SCRYPTED_INSECURE_PORT);
    console.log('Ports can be changed with environment variables.')
    console.log('https: $SCRYPTED_SECURE_PORT')
    console.log('http : $SCRYPTED_INSECURE_PORT')
    console.log('Certificate can be modified via tls.createSecureContext options in')
    console.log('JSON file located at SCRYPTED_HTTPS_OPTIONS_FILE environment variable:');
    console.log('export SCRYPTED_HTTPS_OPTIONS_FILE=/path/to/options.json');
    console.log('https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions')
    console.log('#######################################################');

    app.get(['/web/component/script/npm/:pkg', '/web/component/script/npm/@:owner/:pkg'], async (req, res) => {
        const { owner, pkg } = req.params;
        let endpoint = pkg;
        if (owner)
            endpoint = `@${owner}/${endpoint}`;
        try {
            const response = await axios(`https://registry.npmjs.org/${endpoint}`);
            res.send(response.data);
        }
        catch (e) {
            res.status(500);
            res.end();
        }
    });

    app.post(['/web/component/script/install/:pkg', '/web/component/script/install/@:owner/:pkg', '/web/component/script/install/@:owner/:pkg/:tag'], async (req, res) => {
        const { owner, pkg, tag } = req.params;
        let endpoint = pkg;
        if (owner)
            endpoint = `@${owner}/${endpoint}`;
        try {
            const plugin = await scrypted.installNpm(endpoint, tag);
            res.send({
                id: scrypted.findPluginDevice(plugin.pluginId)._id,
            });
        }
        catch (e) {
            console.error('plugin installation failed', e);
            res.status(500);
            res.end();
        }
    });

    app.post('/web/component/script/setup', async (req, res) => {
        const npmPackage = req.query.npmPackage as string;
        const plugin = await db.tryGet(Plugin, npmPackage) || new Plugin();

        plugin._id = npmPackage;
        plugin.packageJson = req.body;

        await db.upsert(plugin);

        res.send('ok');
    });

    app.post('/web/component/script/deploy', async (req, res) => {
        const npmPackage = req.query.npmPackage as string;
        const plugin = await db.tryGet(Plugin, npmPackage);

        if (!plugin) {
            res.status(500);
            res.send(`npm package ${npmPackage} not found`);
            return;
        }

        plugin.zip = req.body.toString('base64');
        await db.upsert(plugin);

        const noRebind = req.query['no-rebind'] !== undefined;
        if (!noRebind)
            await scrypted.installPlugin(plugin);

        res.send('ok');
    });

    app.post('/web/component/script/debug', async (req, res) => {
        const npmPackage = req.query.npmPackage as string;
        const plugin = await db.tryGet(Plugin, npmPackage);

        if (!plugin) {
            res.status(500);
            res.send(`npm package ${npmPackage} not found`);
            return;
        }

        const waitDebug = new Promise<void>((resolve, reject) => {
            setTimeout(() => reject(new Error('timed out waiting for debug session')), 30000);
            debugServer.on('connection', resolve);
        });

        workerInspectPort = Math.round(Math.random() * 10000) + 30000;
        try {
            await scrypted.installPlugin(plugin, {
                waitDebug,
                inspectPort: workerInspectPort,
            });
        }
        catch (e) {
            res.status(500);
            res.send(e.toString());
            return
        }

        res.send({
            workerInspectPort,
        });
    });

    const getLoginUserToken = (req: express.Request) => {
        return req.secure ? 'login_user_token' : 'login_user_token_insecure';
    };

    const checkValidUserToken = (token: string) => {
        if (!token)
            return;
        try {
            const userToken = UserToken.validateToken(token);
            if (scrypted.usersService.users.has(userToken.username))
                return userToken;
        }
        catch (e) {
            // console.warn('invalid token', e.message);
        }
    }

    const getSignedLoginUserToken = (req: Request<any>) => {
        const token = req.signedCookies[getLoginUserToken(req)] as string;
        return checkValidUserToken(token)
    };

    app.get('/logout', (req, res) => {
        res.clearCookie(getLoginUserToken(req));
        if (req.headers['accept']?.startsWith('application/json')) {
            res.send({});
        }
        else {
            res.redirect('./endpoint/@scrypted/core/public/');
        }
    });

    let hasLogin = await db.getCount(ScryptedUser) > 0;

    if (process.env.SCRYPTED_ADMIN_USERNAME) {
        let user = await db.tryGet(ScryptedUser, process.env.SCRYPTED_ADMIN_USERNAME);
        if (!user) {
            user = await scrypted.usersService.addUserInternal(process.env.SCRYPTED_ADMIN_USERNAME, crypto.randomBytes(8).toString('hex'), undefined);
            hasLogin = true;
        }
    }

    app.options('/login', (req, res) => {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
        res.send(200);
    });

    app.post('/login', async (req, res) => {
        const { username, password, change_password, maxAge: maxAgeRequested } = req.body;
        const timestamp = Date.now();
        const maxAge = parseInt(maxAgeRequested) || ONE_DAY_MILLISECONDS;
        const addresses = ((await scrypted.addressSettings.getLocalAddresses()) || getHostAddresses(true, true)).map(address => `https://${address}:${SCRYPTED_SECURE_PORT}`);

        if (hasLogin) {
            const user = await db.tryGet(ScryptedUser, username);
            if (!user) {
                res.send({
                    error: 'User does not exist.',
                    hasLogin,
                })
                return;
            }

            const salted = user.salt + password;
            const hash = crypto.createHash('sha256');
            hash.update(salted);
            const sha = hash.digest().toString('hex');
            if (user.passwordHash !== sha && user.token !== password) {
                res.send({
                    error: 'Incorrect password.',
                    hasLogin,
                })
                return;
            }

            const userToken = new UserToken(username, user.aclId, timestamp, maxAge);
            const login_user_token = userToken.toString();
            res.cookie(getLoginUserToken(req), login_user_token, {
                maxAge,
                secure: req.secure,
                signed: true,
                httpOnly: true,
            });

            if (change_password) {
                setScryptedUserPassword(user, change_password, timestamp);
                await db.upsert(user);
            }

            res.send({
                ...createTokens(userToken),
                username,
                expiration: maxAge,
                addresses,
            });

            return;
        }

        if (!username || !password) {
            res.send({
                error: 'Username and password must not be empty.',
                hasLogin,
            });
            return;
        }

        const user = await scrypted.usersService.addUserInternal(username, password, undefined);
        hasLogin = true;

        const userToken = new UserToken(username, user.aclId, timestamp);
        const login_user_token = userToken.toString();
        res.cookie(getLoginUserToken(req), login_user_token, {
            maxAge,
            secure: req.secure,
            signed: true,
            httpOnly: true,
        });

        res.send({
            ...createTokens(userToken),
            username,
            token: user.token,
            expiration: maxAge,
            addresses,
        });
    });

    const resetLogin = path.join(getScryptedVolume(), 'reset-login');
    async function checkResetLogin() {
        try {
            if (fs.existsSync(resetLogin)) {
                fs.rmSync(resetLogin);
                await db.removeAll(ScryptedUser);
                hasLogin = false;
            }
        }
        catch (e) {
        }
    }

    app.get('/login', async (req, res) => {
        await checkResetLogin();

        const hostname = os.hostname()?.split('.')?.[0];
        const addresses = ((await scrypted.addressSettings.getLocalAddresses()) || getHostAddresses(true, true)).map(address => `https://${address}:${SCRYPTED_SECURE_PORT}`);

        // env/header based admin login
        if (res.locals.username) {
            const user = scrypted.usersService.users.get(res.locals.username);
            const userToken = new UserToken(res.locals.username, res.locals.aclId, Date.now());

            res.send({
                ...createTokens(userToken),
                expiration: ONE_DAY_MILLISECONDS,
                username: res.locals.username,
                token: user?.token,
                addresses,
                hostname,
            });
            return;
        }

        // env based anon admin login
        if (process.env.SCRYPTED_DISABLE_AUTHENTICATION === 'true') {
            res.send({
                expiration: ONE_DAY_MILLISECONDS,
                username: 'anonymous',
                addresses,
                hostname,
            })
            return;
        }

        // basic auth
        if (req.protocol === 'https' && req.headers.authorization) {
            const username = await new Promise(resolve => {
                const basicChecker = basicAuth.check((req) => {
                    resolve(req.user);
                });

                // this automatically handles unauthorized.
                basicChecker(req, res);
            });

            const user = await db.tryGet(ScryptedUser, username);
            if (!user.token) {
                user.token = crypto.randomBytes(16).toString('hex');
                await db.upsert(user);
            }
            res.send({
                username,
                token: user.token,
                addresses,
                hostname,
            });
            return;
        }

        // cookie auth
        try {
            const userToken = getSignedLoginUserToken(req);
            if (!userToken)
                throw new Error('Not logged in.');

            res.send({
                ...createTokens(userToken),
                expiration: (userToken.timestamp + userToken.duration) - Date.now(),
                username: userToken.username,
                addresses,
                hostname,
            })
        }
        catch (e) {
            res.send({
                error: e?.message || 'Unknown Error.',
                hasLogin,
                addresses,
                hostname,
            })
        }
    });

    app.get('/', (_req, res) => res.redirect('./endpoint/@scrypted/core/public/'));

    return scrypted;
}

export default start;
