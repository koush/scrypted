import path from 'path';
import { app, BrowserWindow, ipcRenderer } from 'electron';
import { RuntimeWorkerOptions } from '../runtime-worker';

if (process.platform === 'darwin') {
    // Electron plist must be modified with this to hide dock icon before start. app.dock.hide flashes the dock before program starts.
    // <key>LSUIElement</key>
    // <string>1</string>
    app.dock.hide();
}

let win: BrowserWindow;
const winQueue: any[] = [];

const createWindow = () => {
    console.log('creating window');
    win = new BrowserWindow({
        width: 800,
        height: 600,
        // show: false,
        webPreferences: {
            backgroundThrottling: false,
            preload: path.join(__dirname, 'electron-plugin-preload.js'),
            nodeIntegration: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
        }
    });

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

let firstMessage = true;
function processMessage(message: any) {
    if (firstMessage) {
        firstMessage = false;
        win.webContents.send('scrypted-init', message);
        return;
    }

    win.webContents.send('scrypted', message);
}

process.on('message', (message) => {
    if (win)
        processMessage(message);
    else
        winQueue.push(message);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.whenReady().then(() => {
    createWindow()
});
