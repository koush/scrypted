import child_process from 'child_process';
import fs from "fs";
import os from "os";
import path from 'path';
import { PortablePython } from 'py';
import { PassThrough, Readable, Writable } from 'stream';
import { installScryptedServerRequirements, version as packagedPythonVersion } from '../../../bin/packaged-python';
import { RpcMessage, RpcPeer } from "../../rpc";
import { createRpcDuplexSerializer } from '../../rpc-serializer';
import { ChildProcessWorker } from "./child-process-worker";
import { RuntimeWorkerOptions } from "./runtime-worker";

export class PythonRuntimeWorker extends ChildProcessWorker {
    static {
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

    static pythonInstalls = new Map<string, Promise<string>>();

    serializer: ReturnType<typeof createRpcDuplexSerializer>;
    peerin: Writable;
    peerout: Readable;
    _stdout = new PassThrough();
    _stderr = new PassThrough();
    pythonInstallationComplete = true;

    get pid() {
        return this.worker?.pid || -1;
    }

    get stdout() {
        return this._stdout;
    }

    get stderr() {
        return this._stderr;
    }

    constructor(pluginId: string, options: RuntimeWorkerOptions) {
        super(pluginId, options);

        const { env, pluginDebug } = options;
        const args: string[] = [
            '-u',
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

        let pythonPath = process.env.SCRYPTED_PYTHON_PATH;
        const pluginPythonVersion = options.packageJson.scrypted.pythonVersion?.[os.platform()]?.[os.arch()] || options.packageJson.scrypted.pythonVersion?.default;

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
                // stdin, stdout, stderr, peer in, peer out
                stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
                env: Object.assign({
                    // rev this if the base python version or server characteristics change.
                    SCRYPTED_PYTHON_VERSION: '20240317',
                    PYTHONUNBUFFERED: '1',
                    PYTHONPATH,
                }, gstEnv, process.env, env),
            });

            this.worker.stdout.pipe(this.stdout);
            this.worker.stderr.pipe(this.stderr);
        };


        // if the plugin requests a specific python, then install it via portable python
        if (pluginPythonVersion) {
            const peerin = this.peerin = new PassThrough();
            const peerout = this.peerout = new PassThrough();

            const finishSetup = () => {
                setup();

                peerin.pipe(this.worker.stdio[3] as Writable);
                (this.worker.stdio[4] as Readable).pipe(peerout);
            };

            const py = new PortablePython(pluginPythonVersion);
            if (fs.existsSync(py.executablePath)) {
                pythonPath = py.executablePath;
                finishSetup();
            }
            else {
                this.pythonInstallationComplete = false;
                let install = PythonRuntimeWorker.pythonInstalls.get(pluginPythonVersion);
                if (!install) {
                    install = installScryptedServerRequirements(pluginPythonVersion);
                    install.catch(() => { });
                    PythonRuntimeWorker.pythonInstalls.set(pluginPythonVersion, install);
                }

                install.then(executablePath => {
                    pythonPath = executablePath;
                    finishSetup();
                })
                    .catch(() => {
                        process.nextTick(() => {
                            this.emit('error', new Error('Failed to install portable python.'));
                        })
                    })
                    .finally(() => this.pythonInstallationComplete = true);
            }
        }
        else {
            setup();
            this.peerin = this.worker.stdio[3] as Writable;
            this.peerout = this.worker.stdio[4] as Readable;
            this.setupWorker();
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
