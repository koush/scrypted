import child_process from 'child_process';
import fs from "fs";
import os from "os";
import path from 'path';
import { PortablePython } from 'py';
import { PassThrough, Readable, Writable } from 'stream';
import { installScryptedServerRequirements, version as packagedPythonVersion } from '../../../bin/packaged-python';
import { RpcMessage, RpcPeer } from "../../rpc";
import { createRpcDuplexSerializer } from '../../rpc-serializer';
import { getPluginVolume } from '../plugin-volume';
import { ChildProcessWorker } from "./child-process-worker";
import { RuntimeWorkerOptions } from "./runtime-worker";

export class PythonRuntimeWorker extends ChildProcessWorker {
    static {
        if (!fs.existsSync(process.env.SCRYPTED_PYTHON_PATH)) {
            try {
                const py = new PortablePython(packagedPythonVersion);
                const portablePython = py.executablePath;
                // is this possible?
                if (fs.existsSync(portablePython))
                    process.env.SCRYPTED_PYTHON_PATH = portablePython;
            }
            catch (e) {
            }
        }
    }

    serializer: ReturnType<typeof createRpcDuplexSerializer>;
    peerin: Writable;
    peerout: Readable;
    _stdout = new PassThrough();
    _stderr = new PassThrough();
    pythonInstallationComplete = true;

    get stdout() {
        return this._stdout;
    }

    get stderr() {
        return this._stderr;
    }

    constructor(options: RuntimeWorkerOptions) {
        super(options);

        const { env, pluginDebug } = options;
        const args: string[] = [
            // unbuffered stdout/stderr
            '-u',
            // prevent any global packages from being used
            // '-S',
        ];

        if (pluginDebug) {
            args.push(
                '-m',
                'debugpy',
                '--listen',
                `0.0.0.0:${pluginDebug.inspectPort}`,
                '--wait-for-client',
            )
        }

        args.push(
            path.join(__dirname, '../../../python', 'plugin_remote.py'),
            this.pluginId,
        )

        const gstEnv: NodeJS.ProcessEnv = {};
        // hack to fix gst plugin search path on mac...
        if (os.platform() === 'darwin') {
            const gstPaths = [
                '/opt/homebrew/lib/gstreamer-1.0',
                '/usr/local/lib/gstreamer-1.0',
            ];
            for (const gstPath of gstPaths) {
                // search for common plugins.
                if (fs.existsSync(path.join(gstPath, 'libgstx264.dylib'))
                    || fs.existsSync(path.join(gstPath, 'libgstlibav.dylib'))
                    || fs.existsSync(path.join(gstPath, 'libgstvideotestsrc.dylib'))) {
                    gstEnv['GST_PLUGIN_PATH'] = gstPath;
                    break;
                }
            }
        }

        let pythonPath = !process.env.SCRYPTED_PORTABLE_PYTHON && process.env.SCRYPTED_PYTHON_PATH;

        if (!pythonPath) {
            if (os.platform() === 'win32') {
                pythonPath = 'py.exe';
            }
            else {
                pythonPath = 'python3';
            }
        }

        const setup = () => {
            const types = require.resolve('@scrypted/types');
            const PYTHONPATH = types.substring(0, types.indexOf('types') + 'types'.length);
            this.worker = child_process.spawn(pythonPath, args, {
                cwd: options.unzippedPath,
                // stdin, stdout, stderr, peer in, peer out
                stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
                env: Object.assign({}, process.env, env, gstEnv, {
                    // rev this if the base python version or server characteristics change.
                    SCRYPTED_PYTHON_VERSION: '20240317',
                    PYTHONUNBUFFERED: '1',
                    PYTHONPATH,
                }),
            });
            this.setupWorker();

            this.worker.stdout.pipe(this.stdout);
            this.worker.stderr.pipe(this.stderr);
        };

        let pluginPythonVersion: string = options.packageJson.scrypted.pythonVersion?.[os.platform()]?.[os.arch()] || options.packageJson.scrypted.pythonVersion?.default;
        if (process.env.SCRYPTED_PORTABLE_PYTHON && !pluginPythonVersion)
            pluginPythonVersion = packagedPythonVersion;

        let portablePythonOptions = options.packageJson.scrypted.pythonVersion?.options?.[os.platform()]?.[os.arch()] || options.packageJson.scrypted.pythonVersion?.options?.default || {};

        // if the plugin requests a specific python, then install it via portable python
        if (!pluginPythonVersion) {
            setup();
            this.peerin = this.worker.stdio[3] as Writable;
            this.peerout = this.worker.stdio[4] as Readable;
            return;
        }

        const strippedPythonVersion = pluginPythonVersion.replace('.', '');
        const envPython = !process.env.SCRYPTED_PORTABLE_PYTHON && process.env[`SCRYPTED_PYTHON${strippedPythonVersion}_PATH`];
        if (envPython && fs.existsSync(envPython)) {
            pythonPath = envPython;
            setup();
            this.peerin = this.worker.stdio[3] as Writable;
            this.peerout = this.worker.stdio[4] as Readable;
            return;
        }

        const peerin = this.peerin = new PassThrough();
        const peerout = this.peerout = new PassThrough();

        const finishSetup = () => {
            setup();

            peerin.pipe(this.worker.stdio[3] as Writable);
            (this.worker.stdio[4] as Readable).pipe(peerout);
        };

        const pyVersion = require('py/package.json').version;
        const pyPath = path.join(getPluginVolume(this.pluginId), 'py');
        const portableInstallPath = path.join(pyPath, pyVersion);

        const py = new PortablePython(pluginPythonVersion, portableInstallPath, portablePythonOptions);
        if (fs.existsSync(py.executablePath) && !py.isTagOutdated()) {
            pythonPath = py.executablePath;
            finishSetup();
        }
        else {
            (async () => {
                try {
                    this.pythonInstallationComplete = false;
                    await fs.promises.rm(pyPath, { recursive: true, force: true }).catch(() => { });
                    pythonPath = await installScryptedServerRequirements(pluginPythonVersion, portableInstallPath, portablePythonOptions);
                    finishSetup();
                }
                catch (e) {
                    process.nextTick(() => {
                        this.emit('error', new Error('Failed to install portable python.'));
                    });
                }
                finally {
                    this.pythonInstallationComplete = true
                }
            })();
        }
    }

    setupRpcPeer(peer: RpcPeer): void {
        const serializer = this.serializer = createRpcDuplexSerializer(this.peerin);
        serializer.setupRpcPeer(peer);
        this.peerout.on('data', data => serializer.onData(data));
        this.peerin.on('error', e => {
            this.emit('error', e);
            serializer.onDisconnected();
        });
        this.peerout.on('error', e => {
            this.emit('error', e)
            serializer.onDisconnected();
        });
    }

    send(message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any): void {
        try {
            if (this.pythonInstallationComplete && !this.worker)
                throw new Error('python worker has been killed');
            this.serializer.sendMessage(message, reject, serializationContext);
        }
        catch (e) {
            reject?.(e);
        }
    }
}
