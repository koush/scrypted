import { Lock, ScryptedDevice } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";

commandHandlers['action.devices.commands.LockUnlock'] = async (device: ScryptedDevice & Lock, execution) => {
    const ret = executeResponse(device);
    if (execution.params.lock !== true)
        device.unlock();
    else
        device.lock();
    return ret;
}
