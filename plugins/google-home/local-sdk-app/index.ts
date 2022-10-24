/// <reference types="@google/local-home-sdk" />

import { IntentFlow } from "@google/local-home-sdk";

const app = new smarthome.App("1.0.0");

let SCRYPTED_INSECURE_PORT = 11080;

app
  .onIdentify(async (request: IntentFlow.IdentifyRequest) => {
    console.debug("IDENTIFY request:", request);

    const device = request.inputs[0].payload.device;
    if (device.mdnsScanData?.type !== "scrypted-gh") {
      console.error("mdns type not 'scrypted-gh'");
      throw Error("mdns type not 'scrypted-gh'");
    }

    SCRYPTED_INSECURE_PORT = parseInt(request.inputs[0].payload.device.mdnsScanData!.txt.port);

    // Decode scan data to obtain metadata about local device
    const proxyDeviceId = "local-hub-id";

    // Return a response
    const response: IntentFlow.IdentifyResponse = {
      intent: smarthome.Intents.IDENTIFY,
      requestId: request.requestId,
      payload: {
        device: {
          id: proxyDeviceId,
          isProxy: true,     // Device can control other local devices
          isLocalOnly: true, // Device not present in `SYNC` response
        },
      },
    };
    console.debug("IDENTIFY response:", response);
    return response;
  })
  .onReachableDevices(request => {
    console.debug("REACHABLE_DEVICES request:", request);

    const reachableDevices = request.devices.map(device => ({
      verificationId: device.id,
    }))
      .filter(device => device.verificationId !== 'local-hub-id');

    // Return a response
    const response: IntentFlow.ReachableDevicesResponse = {
      intent: smarthome.Intents.REACHABLE_DEVICES,
      requestId: request.requestId,
      payload: {
        devices: reachableDevices,
      },
    };
    console.debug("REACHABLE_DEVICES response:", request);
    return response;
  })
  .onQuery(async (request) => {
    try {
      console.debug("QUERY request", request);

      const command = new smarthome.DataFlow.HttpRequestData();
      command.requestId = request.requestId;
      command.deviceId = request.inputs[0].payload.devices[0].id;
      command.method = smarthome.Constants.HttpOperation.POST;
      command.port = SCRYPTED_INSECURE_PORT;
      command.path = '/endpoint/@scrypted/google-home/public';
      command.dataType = 'application/json';

      delete request.devices;

      command.data = JSON.stringify(request);

      command.additionalHeaders = {
        'Authorization': (request.inputs?.[0]?.payload?.devices?.[0]?.customData as any)?.localAuthorization,
      }

      try {
        const result = await app.getDeviceManager()
          .send(command);
        console.log('COMMAND result', result);
        const httpResult = result as smarthome.DataFlow.HttpResponseData;
        const responseBody = httpResult.httpResponse.body;
        const responseJson = JSON.parse(responseBody as string);
        console.log('QUERY result', responseJson);
        return responseJson;
      } catch (err) {
        // Handle command error
        console.error('QUERY error', err);
        throw err;
      }

    }
    catch (e) {
      console.error('QUERY failure', e);
      throw e;
    }
  })
  .onExecute(async (request) => {

    try {
      console.debug("EXECUTE request", request);

      const command = new smarthome.DataFlow.HttpRequestData();
      command.requestId = request.requestId;
      command.deviceId = request.inputs[0].payload.commands[0].devices[0].id;
      command.method = smarthome.Constants.HttpOperation.POST;
      command.port = SCRYPTED_INSECURE_PORT;
      command.path = '/endpoint/@scrypted/google-home/public';
      command.dataType = 'application/json';

      delete request.devices;

      command.data = JSON.stringify(request);

      command.additionalHeaders = {
        'Authorization': (request.inputs?.[0]?.payload?.commands?.[0].devices?.[0]?.customData as any)?.localAuthorization,
      }

      try {
        const result = await app.getDeviceManager()
          .send(command);
        console.log('COMMAND result', result);
        const httpResult = result as smarthome.DataFlow.HttpResponseData;
        const responseBody = httpResult.httpResponse.body;
        const responseJson = JSON.parse(responseBody as string);
        console.log('EXECUTE result', responseJson);
        return responseJson;
      } catch (err) {
        // Handle command error
        console.error('EXECUTE error', err);
        throw err;
      }

    }
    catch (e) {
      console.error('EXECUTE failure', e);
      throw e;
    }
  })
  .listen()
  .then(() => {
    console.log("Ready");
  });
