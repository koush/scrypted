import { ScryptedDevice } from "@scrypted/sdk";
import type { SmartHomeV1ExecuteRequestExecution, SmartHomeV1ExecuteResponseCommands } from "actions-on-google/dist/service/smarthome/api/v1";

export const commandHandlers: {[trait: string]: (device: ScryptedDevice & any, execution: SmartHomeV1ExecuteRequestExecution) => Promise<SmartHomeV1ExecuteResponseCommands> } = {};
