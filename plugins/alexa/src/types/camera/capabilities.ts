import sdk, { MediaObject, MotionSensor, ObjectDetector, ScryptedDevice, ScryptedInterface } from "@scrypted/sdk";
import { ChangeReport, DiscoveryCapability, ObjectDetectionEvent, Report, StateReport, Property } from "../../alexa";

const { mediaManager } = sdk;

export async function reportCameraState(device: ScryptedDevice & MotionSensor & ObjectDetector): Promise<Partial<Report>>{
    let data = {
        context: {
            properties: []
        }
        
    } as Partial<StateReport>;

    if (device.interfaces.includes(ScryptedInterface.ObjectDetector)) {
        const detectionTypes = await (device as any as ObjectDetector).getObjectTypes();
        const classNames = detectionTypes.classes.filter(t => t !== 'ring' && t !== 'motion').map(type => type.toLowerCase());

        data.context.properties.push({
            "namespace": "Alexa.SmartVision.ObjectDetectionSensor",
            "name": "objectDetectionClasses",
            "value": classNames.map(type => ({
                "imageNetClass": type
            })),
            "timeOfSample": new Date().toISOString(),
            "uncertaintyInMilliseconds": 0
        });
    }

    if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
        data.context.properties.push({
            "namespace": "Alexa.MotionSensor",
            "name": "detectionState",
            "value": device.motionDetected ? "DETECTED" : "NOT_DETECTED",
            "timeOfSample": new Date().toISOString(),
            "uncertaintyInMilliseconds": 0
        });
    }

    return data;
};

export async function sendCameraEvent (eventSource: ScryptedDevice & MotionSensor & ObjectDetector, eventDetails, eventData): Promise<Partial<Report>> {      
    if (eventDetails.eventInterface === ScryptedInterface.ObjectDetector) {

        // ring and motion are not valid objects
        if (eventData.detections.has('ring') || eventData.detections.has('motion'))
            return undefined;

        console.debug('ObjectDetector event', eventData);

        let mediaObj: MediaObject = undefined;
        let frameImageUri: string = undefined;

        try {
            mediaObj = await eventSource.getDetectionInput(eventData.detectionId, eventData.eventId);
            frameImageUri = await mediaManager.convertMediaObjectToUrl(mediaObj, 'image/jpeg');
        } catch (e) { }

        let data = {
            event: {
                header: {
                    namespace: 'Alexa.SmartVision.ObjectDetectionSensor',
                    name: 'ObjectDetection'
                },
                payload: {
                    "events": [eventData.detections.map(detection => {
                        let event = {
                            "eventIdentifier": eventData.eventId,
                            "imageNetClass": detection.className,
                            "timeOfSample": new Date(eventData.timestamp).toISOString(),
                            "uncertaintyInMilliseconds": 500
                        };
                        
                        if (detection.id) {
                            event["objectIdentifier"] = detection.id;
                        }

                        if (frameImageUri) {
                            event["frameImageUri"] = frameImageUri;
                        }

                        return event;
                    })]
                }
            }
        } as Partial<ObjectDetectionEvent>;

        return data;
    }
    
    if (eventDetails.eventInterface === ScryptedInterface.MotionSensor)
        return {
            event: {
                payload: {
                    change: {
                        cause: {
                            type: "PHYSICAL_INTERACTION"
                        },
                        properties: [
                            {
                                "namespace": "Alexa.MotionSensor",
                                "name": "detectionState",
                                "value": eventData ? "DETECTED" : "NOT_DETECTED",
                                "timeOfSample": new Date(eventDetails.eventTime).toISOString(),
                                "uncertaintyInMilliseconds": 500
                            }
                        ]
                    }
                },
            }
        } as Partial<ChangeReport>;

    return undefined;
};

export async function getCameraCapabilities(device: ScryptedDevice): Promise<DiscoveryCapability[]> {
    const capabilities = [
        {
            "type": "AlexaInterface",
            "interface": "Alexa.RTCSessionController",
            "version": "3",
            "configuration": {
                "isFullDuplexAudioSupported": true,
            }
        } as DiscoveryCapability
    ];

    if (device.interfaces.includes(ScryptedInterface.ObjectDetector)) {
        const detectionTypes = await (device as any as ObjectDetector).getObjectTypes().catch(() => {}) || undefined;
        const classNames = detectionTypes?.classes?.filter(t => t !== 'ring' && t !== 'motion').map(type => type.toLowerCase()).filter(c => !!c);
        if (classNames?.length) {
            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.SmartVision.ObjectDetectionSensor",
                    "version": "1.0",
                    "properties": {
                        "supported": [{
                            "name": "objectDetectionClasses"
                        }],
                        "proactivelyReported": true,
                        "retrievable": true
                    },
                    "configuration": {
                        "objectDetectionConfiguration": classNames.map(type => ({
                            "imageNetClass": type
                        }))
                    }
                } as DiscoveryCapability
            );
    
            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.DataController",
                    "instance": "Camera.SmartVisionData",
                    "version": "1.0",
                    "properties": undefined,
                    "configuration": {
                        "targetCapability": {
                            "name": "Alexa.SmartVision.ObjectDetectionSensor",
                            "version": "1.0"
                        },
                        "dataRetrievalSchema": {
                            "type": "JSON",
                            "schema": "SmartVisionData"
                        },
                        "supportedAccess": ["BY_IDENTIFIER", "BY_TIMESTAMP_RANGE"]
                    }
                } as DiscoveryCapability
            );
        }
    
        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
            capabilities.push(
                {
                    "type": "AlexaInterface",
                    "interface": "Alexa.MotionSensor",
                    "version": "3",
                    "properties": {
                        "supported": [
                            {
                                "name": "detectionState"
                            }
                        ],
                        "proactivelyReported": true,
                        "retrievable": true
                    }
                } as DiscoveryCapability
            );
        }
    }

    return capabilities;
};