import { MotionSensor, ObjectDetector, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { getCameraCapabilities, reportCameraState, sendCameraEvent } from "./camera/capabilities";
import { DiscoveryEndpoint, DisplayCategory, Report, DoorbellPressEvent } from "../alexa";
import { supportedTypes } from ".";

supportedTypes.set(ScryptedDeviceType.Doorbell, {
    async discover(device: ScryptedDevice): Promise<Partial<DiscoveryEndpoint>> {
        let capabilities: any[] = [];
        const displayCategories: DisplayCategory[] = [];

        if (device.interfaces.includes(ScryptedInterface.RTCSignalingChannel)) {
            capabilities = await getCameraCapabilities(device);
            displayCategories.push('CAMERA');
        }

        if (device.interfaces.includes(ScryptedInterface.BinarySensor)) {
            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.DoorbellEventSource",
                    "version": "3",
                    "proactivelyReported": true
                } as any,
            );
        }

        //  Important: If your device is a video doorbell, make sure that you list CAMERA before DOORBELL in the displayCategories list.
        displayCategories.push('DOORBELL');

        return {
            displayCategories,
            capabilities
        };
    },
    sendReport(device: ScryptedDevice & MotionSensor & ObjectDetector): Promise<Partial<Report>>{
        return reportCameraState(device);
    },
    async sendEvent(eventSource: ScryptedDevice & MotionSensor & ObjectDetector, eventDetails, eventData): Promise<Partial<Report>> {
        let response = await sendCameraEvent(eventSource, eventDetails, eventData);

        if (response)
            return response;
        
        if (eventDetails.eventInterface === ScryptedInterface.BinarySensor && eventData === false)
            return {};

        if (eventDetails.eventInterface === ScryptedInterface.BinarySensor && eventData === true)
            return {
                event: {
                    header: {
                        namespace: 'Alexa.DoorbellEventSource',
                        name: 'DoorbellPress'
                    },
                    payload: {
                        "cause": {
                            "type": "PHYSICAL_INTERACTION"
                        },
                        "timestamp": new Date(eventDetails.eventTime).toISOString(),
                    }
            }
         } as Partial<DoorbellPressEvent>;
    }
});
