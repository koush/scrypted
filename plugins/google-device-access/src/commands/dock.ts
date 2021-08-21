import { Dock, OnOff, ScryptedDevice } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";

commandHandlers['action.devices.commands.Dock'] = async (device: ScryptedDevice & Dock, execution) => {
    const ret = executeResponse(device);
    device.dock();
    return ret;
}
