import { ScryptedDevice, StartStop } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";

commandHandlers['action.devices.commands.StartStop'] = async (device: ScryptedDevice & StartStop, execution) => {
    const ret = executeResponse(device);
    if (execution.params.start === false)
        device.stop()
    else
        device.start();
    return ret;
}
