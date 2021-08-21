import { Entry, OnOff, ScryptedDevice } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";

commandHandlers['action.devices.commands.OpenClose'] = async (device: ScryptedDevice & Entry, execution) => {
    const ret = executeResponse(device);
    if (execution.params.openPercent === 100)
        device.openEntry();
    else
        device.closeEntry();
    return ret;
}
