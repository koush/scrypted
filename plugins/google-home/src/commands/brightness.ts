import { Brightness, OnOff, ScryptedDevice } from "@scrypted/sdk";
import { executeResponse } from "../common";
import { commandHandlers } from "../handlers";

commandHandlers['action.devices.commands.BrightnessAbsolute'] = async (device: ScryptedDevice & Brightness, execution) => {
    const ret = executeResponse(device);
    (device as Brightness).setBrightness(execution.params.brightness);
    return ret;
}
