import { app, BrowserWindow } from 'electron';
import path from 'path';
import { Deferred } from '../../../deferred';
import { RuntimeWorkerOptions } from '../runtime-worker';

if (process.platform === 'darwin') {
    // Electron plist must be modified with this to hide dock icon before start. app.dock.hide flashes the dock before program starts.
    // <key>LSUIElement</key>
    // <string>1</string>
    app.dock.hide();
}

let win: BrowserWindow;
const winQueue: any[] = [];

const createWindow = (firstMessage: { plugindId: string, options: RuntimeWorkerOptions }) => {
    const message: { plugindId: string, options: RuntimeWorkerOptions } = firstMessage;
    const { options } = message;

    if (options?.pluginDebug) {
        console.warn('debugging', options);
    }

    win = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
            backgroundThrottling: false,
            preload: path.join(__dirname, 'electron-plugin-preload.js'),
            nodeIntegration: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
            additionalArguments: options?.pluginDebug ? [
                `--remote-debugging-port=9222`,
            ] : undefined,
        }
    });
    win.webContents.send('scrypted-init', message);

    // win.loadURL('https://webglsamples.org/aquarium/aquarium.html');
    console.log(__dirname);
    const html = path.join(__dirname, '../../../../electron', 'electron-plugin.html');
    win.loadFile(html);
    win.webContents.openDevTools();

    win.webContents.ipc.on('scrypted', (e, message) => {
        process.send(message);
    });
    win.webContents.ipc.on('scrypted-stdout', (e, message) => {
        process.stdout.write(message);
    });
    win.webContents.ipc.on('scrypted-stderr', (e, message) => {
        process.stderr.write(message);
    });

    while (winQueue.length) {
        processMessage(winQueue.shift());
    }

    function kill() {
        process.exit();
    }

    win.webContents.on('destroyed', kill);
    win.webContents.on('plugin-crashed', kill);
    win.on('close', kill);
}

const firstMessage = new Deferred<any>;
function processMessage(message: any) {
    win.webContents.send('scrypted', message);
}

process.on('message', (message) => {
    if (!firstMessage.finished) {
        firstMessage.resolve(message);
        return;
    }

    if (win)
        processMessage(message);
    else
        winQueue.push(message);
});

process.on('disconnect', () => {
    console.error('peer host disconnected, exiting.');
    process.exit(1);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(async () => {
     const message: { plugindId: string, options: RuntimeWorkerOptions } = await firstMessage.promise;
    createWindow(message)
});
