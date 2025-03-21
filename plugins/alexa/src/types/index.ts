import { ScryptedDeviceType, ScryptedDevice, EventDetails } from '@scrypted/sdk';
import { DiscoveryEndpoint, Report } from '../alexa';

export interface SupportedType {
    discover(device: ScryptedDevice): Promise<Partial<DiscoveryEndpoint>>;
    sendEvent(device: ScryptedDevice, eventDetails: EventDetails, eventData: any): Promise<Partial<Report>>;
    sendReport(device: ScryptedDevice): Promise<Partial<Report>>;
    setState?(device: ScryptedDevice, payload: any): Promise<Partial<Report>>;
}

export const supportedTypes = new Map<ScryptedDeviceType | string, SupportedType>();

import '../handlers';
import './camera';
import './camera/handlers';
import './light';
import './light/handlers'
import './fan';
import './doorbell';
import './garagedoor';
import './outlet';
import './switch';
import './switch/handlers';
import './sensor';
import './securitysystem';