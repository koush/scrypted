export function getDebugMode(storage: Storage) {
    let debugMode: string[] = [];
    try {
        debugMode = JSON.parse(storage.getItem('debugMode'));
    }
    catch (e) {
    }
    if (!Array.isArray(debugMode))
        debugMode = [];

    return {
        recording: debugMode.includes('Save Recordings'),
        video: debugMode.includes('Transcode Video'),
        audio: debugMode.includes('Transcode Audio'),
        value: debugMode,
    }
}
