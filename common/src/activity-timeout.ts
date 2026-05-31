export function createActivityTimeout(timeout: number, timeoutCallback: () => void) {
    let dataTimeout: NodeJS.Timeout;

    let lastTime = Date.now();
    function resetActivityTimer() {
        lastTime = Date.now();
    }

    function clearActivityTimer() {
        clearInterval(dataTimeout);
    }

    if (timeout) {
        dataTimeout = setInterval(() => {
            if (Date.now() > lastTime + timeout) {
                clearInterval(dataTimeout);
                dataTimeout = undefined;
                timeoutCallback();
            }
        }, timeout);
    }

    resetActivityTimer();
    return {
        resetActivityTimer,
        clearActivityTimer,
    }
}
