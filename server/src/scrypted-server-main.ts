import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { once } from 'events';
import express, { Request } from 'express';
import fs from 'fs';
import http from 'http';
import httpAuth from 'http-auth';
import https from 'https';
import net from 'net';
import os from 'os';
import path from 'path';
import process from 'process';
import { install as installSourceMapSupport } from 'source-map-support';
import tls from 'tls';
import { createSelfSignedCertificate, CURRENT_SELF_SIGNED_CERTIFICATE_VERSION } from './cert';
import { getScryptedClusterMode } from './cluster/cluster-setup';
import { Plugin, ScryptedUser, Settings } from './db-types';
import { getUsableNetworkAddresses, removeIPv4EmbeddedIPv6 } from './ip';
import Level from './level';
import { getScryptedVolume } from './plugin/plugin-volume';
import { ScryptedRuntime } from './runtime';
import { createClusterServer } from './scrypted-cluster-main';
import { SCRYPTED_DEBUG_PORT, SCRYPTED_INSECURE_PORT, SCRYPTED_SECURE_PORT } from './server-settings';
import { getNpmPackageInfo } from './services/plugin';
import type { ServiceControl } from './services/service-control';
import { setScryptedUserPassword, UsersService } from './services/users';
import { sleep } from './sleep';
import { ONE_DAY_MILLISECONDS, UserToken } from './usertoken';

export type Runtime = ScryptedRuntime;

const listenSet = new net.BlockList();
const { SCRYPTED_SERVER_LISTEN_HOSTNAMES } = process.env;
if (SCRYPTED_SERVER_LISTEN_HOSTNAMES) {
    // add ipv4 and ipv6 loopback
    listenSet.addAddress('127.0.0.1');
    listenSet.addAddress('::1', 'ipv6');
    for (const hostname of SCRYPTED_SERVER_LISTEN_HOSTNAMES.split(',')) {
        if (net.isIPv4(hostname))
            listenSet.addAddress(hostname);
        else if (net.isIPv6(hostname))
            listenSet.addAddress(hostname, 'ipv6');
        else
            throw new Error('Invalid SCRYPTED_SERVER_LISTEN_HOSTNAME: ' + hostname);
    }
}

async function listenServerPort(env: string, port: number, server: http.Server | https.Server | net.Server) {
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
let workerInspectAddress: string = undefined;

async function doconnect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        const target = net.connect(workerInspectPort, workerInspectAddress);
        target.once('error', reject)
        target.once('connect', () => resolve(target))
    })
}

const debugServer = net.createServer(async (socket) => {
    if (listenSet.rules.length && !checkListenSet(socket)) {
        socket.destroy();
        return;
    }

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
});

listenServerPort('SCRYPTED_DEBUG_PORT', SCRYPTED_DEBUG_PORT, debugServer)
    .catch(() => { });

const app = express();

app.set('trust proxy', 'loopback');

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }) as any);

// parse application/json
app.use(bodyParser.json());

// parse some custom thing into a Buffer
app.use(bodyParser.raw({ type: 'application/*', limit: 100000000 }) as any);

function checkListenSet(socket: net.Socket) {
    return listenSet.check(socket.localAddress, net.isIPv4(socket.localAddress) ? 'ipv4' : 'ipv6');
}

if (listenSet.rules.length) {
    app.use((req, res, next) => {
        if (!checkListenSet(req.socket)) {
            res.status(403).send('Access denied on this address: ' + req.socket.localAddress);
            return;
        }
        next();
    });
}

async function start(mainFilename: string, options?: {
    onRuntimeCreated?: (runtime: ScryptedRuntime) => Promise<void>,
    serviceControl?: ServiceControl;
}) {
    console.log('Scrypted server starting.');
    const volumeDir = getScryptedVolume();
    await fs.promises.mkdir(volumeDir, {
        recursive: true
    });
    const dbPath = path.join(volumeDir, 'scrypted.db');
    const db = new Level(dbPath);
    await db.open();

    let certSetting = await db.tryGet(Settings, 'certificate') as Settings;
    let keyPair: ReturnType<typeof createSelfSignedCertificate> = certSetting?.value;

    if (certSetting?.value?.version !== CURRENT_SELF_SIGNED_CERTIFICATE_VERSION) {
        keyPair = createSelfSignedCertificate();
    }
    else {
        keyPair = createSelfSignedCertificate(keyPair);
    }
    certSetting = new Settings();
    certSetting._id = 'certificate';
    certSetting.value = keyPair;
    certSetting = await db.upsert(certSetting);

    let hasLogin = await db.getCount(ScryptedUser) > 0;
    if (process.env.SCRYPTED_ADMIN_USERNAME) {
        let user = await db.tryGet(ScryptedUser, process.env.SCRYPTED_ADMIN_USERNAME);
        if (!user) {
            user = await UsersService.addUserToDatabase(db, process.env.SCRYPTED_ADMIN_USERNAME, crypto.randomBytes(8).toString('hex'), undefined);
            hasLogin = true;
        }
    }

    const basicAuth = httpAuth.basic({
        realm: 'Scrypted',
    }, async (username, password, callback) => {
        const user = await db.tryGet(ScryptedUser, username);
        if (!user) {
            callback(false);
            return;
        }

        const salted = user.salt + password;
        const hash = crypto.createHash('sha256');
        hash.update(salted);
        const sha = hash.digest().toString('hex');

        callback(sha === user.passwordHash || password === user.token);
    });

    // the default http-auth will returns a WWW-Authenticate header if login fails.
    // this causes the Safari to prompt for login.
    // https://github.com/gevorg/http-auth/blob/4158fa75f58de70fd44aa68876a8674725e0556e/src/auth/base.js#L81
    // override the ask function to return a bare 401 instead.
    // @ts-expect-error
    basicAuth.ask = (res) => {
        res.statusCode = 401;
        res.end();
    };

    const httpsServerOptions = process.env.SCRYPTED_HTTPS_OPTIONS_FILE
        ? JSON.parse(fs.readFileSync(process.env.SCRYPTED_HTTPS_OPTIONS_FILE).toString())
        : {};

    const mergedHttpsServerOptions = Object.assign({
        key: keyPair.serviceKey,
        cert: keyPair.certificate
    }, httpsServerOptions);

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

    const getDefaultAuthentication = (req: Request) => {
        const defaultAuthentication = !req.query.disableDefaultAuthentication && process.env.SCRYPTED_DEFAULT_AUTHENTICATION;
        if (defaultAuthentication) {
            const referer = req.headers.referer;
            if (referer) {
                try {
                    const u = new URL(referer);
                    if (u.searchParams.has('disableDefaultAuthentication'))
                        return;
                }
                catch (e) {
                    // no/invalid referer, allow the default auth
                }
            }
            return scrypted.usersService.users.get(defaultAuthentication);
        }
    }

    app.use(async (req, res, next) => {
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

        if (!res.locals.username) {
            const defaultAuthentication = getDefaultAuthentication(req);
            if (defaultAuthentication) {
                res.locals.username = defaultAuthentication._id;
                res.locals.aclId = defaultAuthentication.aclId;
            }
        }

        next();
    });

    // all methods under /web/component require admin auth.
    app.all('/web/component/*', (req, res, next) => {
        // check if the user is admin authed already, and if not, continue on with basic auth to escalate.
        // this will cover anonymous access like in demo site.
        if (res.locals.username && !res.locals.aclId) {
            next();
            return;
        }

        if (req.protocol === 'https' && req.headers.authorization && req.headers.authorization.toLowerCase()?.indexOf('basic') !== -1) {
            const basicChecker = basicAuth.check(async (req) => {
                try {
                    const user = await db.tryGet(ScryptedUser, req.user);
                    res.locals.username = user._id;
                    res.locals.aclId = user.aclId;
                }
                catch (e) {
                    // should be unreachable.
                    console.warn('basic auth failed unexpectedly', e);
                }
                next();
            });

            // this automatically handles unauthorized.
            basicChecker(req, res);
            return;
        }
        next();
    });

    // verify all plugin related requests have admin auth
    app.all('/web/component/*', (req, res, next) => {
        if (!res.locals.username || res.locals.aclId) {
            res.status(401);
            res.send('Not Authorized');
            return;
        }
        next();
    });

    const scrypted = new ScryptedRuntime(mainFilename, db, app);
    if (options?.serviceControl)
        scrypted.serviceControl = options.serviceControl;
    await options?.onRuntimeCreated?.(scrypted);

    const clusterMode = getScryptedClusterMode();
    if (clusterMode?.[0] === 'server') {
        console.log('Cluster server starting.');
        await listenServerPort('SCRYPTED_CLUSTER_SERVER', clusterMode[2], createClusterServer(mainFilename, scrypted, keyPair));
    }

    await scrypted.start();


    app.post('/web/component/restore', async (req, res) => {
        const buffers: Buffer[] = [];
        req.on('data', b => buffers.push(b));
        try {
            await once(req, 'end');
            await scrypted.backup.restore(Buffer.concat(buffers))
        }
        catch (e) {
            res.send({
                error: "Error during restore.",
            });
            return;
        }
    });

    app.get('/web/component/backup', async (req, res) => {
        try {
            const zipBuffer = await scrypted.backup.createBackup();
            // the file is a normal zip file, but an extension is added to prevent safari, etc, from unzipping it automatically.
            res.header('Content-Disposition', 'attachment; filename="scrypted.zip.backup"')
            res.send(zipBuffer);
        }
        catch (e) {
            console.error('Backup error', e);
            res.status(500);
            res.send('Internal Error');
        }
    });

    app.get(['/web/component/script/npm/:pkg', '/web/component/script/npm/@:owner/:pkg'], async (req, res) => {
        const { owner, pkg } = req.params;
        let endpoint = pkg;
        if (owner)
            endpoint = `@${owner}/${endpoint}`;
        try {
            const json = await getNpmPackageInfo(endpoint);
            res.send(json);
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
            res.send(`npm package not found`);
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
            res.send(`npm package not found`);
            return;
        }

        const waitDebug = new Promise<void>((resolve, reject) => {
            setTimeout(() => reject(new Error('timed out waiting for debug session')), 30000);
            debugServer.on('connection', resolve);
        });

        waitDebug.catch(() => { });

        workerInspectPort = Math.round(Math.random() * 10000) + 30000;
        workerInspectAddress = '127.0.0.1';
        try {
            const host = await scrypted.installPlugin(plugin, {
                waitDebug,
                inspectPort: workerInspectPort,
            });

            const clusterWorkerId = await host.clusterWorkerId;
            if (clusterWorkerId) {
                const clusterWorker = scrypted.clusterWorkers.get(clusterWorkerId);
                if (clusterWorker) {
                    workerInspectAddress = clusterWorker.address;
                }
            }
        }
        catch (e) {
            res.header('Content-Type', 'text/plain');
            res.status(500);
            res.send(e.toString());
            return;
        }

        res.send({
            workerInspectPort,
            workerInspectAddress,
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

    app.options('/login', (req, res) => {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
        res.send(200);
    });

    const getAlternateAddresses = async () => {
        const addresses = ((await scrypted.addressSettings.getLocalAddresses()) || getUsableNetworkAddresses())
            .map(address => {
                if (net.isIPv6(address) && !net.isIPv4(address))
                    address = `[${address}]`;
                return `https://${address}:${SCRYPTED_SECURE_PORT}`
            });
        return {
            externalAddresses: [...new Set(Object.values(scrypted.addressSettings.externalAddresses).flat())],
            addresses,
        };
    }

    app.post('/login', async (req, res) => {
        const { username, password, change_password, maxAge: maxAgeRequested } = req.body;
        const timestamp = Date.now();
        const maxAge = parseInt(maxAgeRequested) || ONE_DAY_MILLISECONDS;
        const alternateAddresses = await getAlternateAddresses();

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
                ...alternateAddresses,
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
            ...alternateAddresses,
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
        const alternateAddresses = await getAlternateAddresses();

        // env/header based admin login
        if (res.locals.username) {
            const user = scrypted.usersService.users.get(res.locals.username);
            const userToken = new UserToken(res.locals.username, res.locals.aclId, Date.now());

            res.send({
                ...createTokens(userToken),
                expiration: ONE_DAY_MILLISECONDS,
                username: res.locals.username,
                // TODO: do not return the token from a short term auth mechanism?
                token: user?.token,
                ...alternateAddresses,
                hostname,
            });
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

            const user = await db.tryGet(ScryptedUser, username) as ScryptedUser;
            if (!user.token) {
                user.token = crypto.randomBytes(16).toString('hex');
                await db.upsert(user);
            }

            const userToken = new UserToken(user._id, user.aclId, Date.now());

            res.send({
                ...createTokens(userToken),
                username,
                token: user.token,
                ...alternateAddresses,
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
                ...alternateAddresses,
                hostname,
            })
        }
        catch (e) {
            // env based anon user login
            const defaultAuthentication = getDefaultAuthentication(req);
            if (defaultAuthentication) {
                const userToken = new UserToken(defaultAuthentication._id, defaultAuthentication.aclId, Date.now());
                res.send({
                    ...createTokens(userToken),
                    expiration: ONE_DAY_MILLISECONDS,
                    username: defaultAuthentication,
                    // TODO: do not return the token from a short term auth mechanism?
                    token: defaultAuthentication?.token,
                    ...alternateAddresses,
                    hostname,
                });
                return;
            }

            res.send({
                error: e?.message || 'Unknown Error.',
                hasLogin,
                ...alternateAddresses,
                hostname,
            })
        }
    });

    app.get('/', (_req, res) => res.redirect('./endpoint/@scrypted/core/public/'));

    const hookUpgrade = (server: net.Server | tls.Server) => {
        server.on('upgrade', (req, socket, upgradeHead) => {
            (req as any).upgradeHead = upgradeHead;
            (app as any).handle(req, {
                socket,
                upgradeHead
            })
        });
        return server;
    }

    await listenServerPort('SCRYPTED_SECURE_PORT', SCRYPTED_SECURE_PORT, hookUpgrade(https.createServer(mergedHttpsServerOptions, app)));
    await listenServerPort('SCRYPTED_INSECURE_PORT', SCRYPTED_INSECURE_PORT, hookUpgrade(http.createServer(app)));

    console.log('#######################################################');
    console.log(`Scrypted Volume           : ${volumeDir}`);
    console.log(`Scrypted Server (Local)   : https://localhost:${SCRYPTED_SECURE_PORT}/`);
    for (const address of SCRYPTED_SERVER_LISTEN_HOSTNAMES ? SCRYPTED_SERVER_LISTEN_HOSTNAMES.split(',') : getUsableNetworkAddresses()) {
        console.log(`Scrypted Server (Remote)  : https://${address}:${SCRYPTED_SECURE_PORT}/`);
    }
    console.log(`Version:       : ${await scrypted.info.getVersion()}`);
    console.log('#######################################################');
    console.log('Scrypted insecure http service port:', SCRYPTED_INSECURE_PORT);
    console.log('Ports can be changed with environment variables.');
    console.log('https: $SCRYPTED_SECURE_PORT');
    console.log('http : $SCRYPTED_INSECURE_PORT');
    console.log('Certificate can be modified via tls.createSecureContext options in');
    console.log('JSON file located at SCRYPTED_HTTPS_OPTIONS_FILE environment variable:');
    console.log('export SCRYPTED_HTTPS_OPTIONS_FILE=/path/to/options.json');
    console.log('https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions');
    console.log('#######################################################');

    return scrypted;
}

export default start;
