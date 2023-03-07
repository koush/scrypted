import { ScryptedDeviceType, ScryptedDevice, EventDetails } from '@scrypted/sdk';
import { DiscoveryEndpoint, Report } from '../alexa';

export interface SupportedType {
    discover(device: ScryptedDevice): Promise<Partial<DiscoveryEndpoint>>;
    sendEvent(device: ScryptedDevice, eventDetails: EventDetails, eventData: any): Promise<Partial<Report>>;
    sendReport(device: ScryptedDevice): Promise<Partial<Report>>;
    setState?(device: ScryptedDevice, payload: any): Promise<Partial<Report>>;
}

export const supportedTypes = new Map<ScryptedDeviceType, SupportedType>();

import '../handlers';
import './camera';
import './camera/handlers';
import './doorbell';
import './garagedoor';
import './switch';
import './switch/handlers';
import './sensor';
import './securitysystem';