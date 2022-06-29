import { ScryptedInterface, ScryptedInterfaceDescriptor, ScryptedInterfaceDescriptors  } from "@scrypted/types";

export const allInterfaceProperties: string[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map(type => type.properties));

export const propertyInterfaces: { [property: string]: ScryptedInterface } = {};
for (const descriptor of Object.values(ScryptedInterfaceDescriptors)) {
    for (const property of descriptor.properties) {
        propertyInterfaces[property] = descriptor.name as ScryptedInterface;
    }
}

export function getInterfaceMethods(descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor }, interfaces: Set<string>) {
    return Object.values(descriptors).filter(e => interfaces.has(e.name)).map(type => type.methods).flat();
}

export function getInterfaceProperties(descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor }, interfaces: Set<string>) {
     return Object.values(descriptors).filter(e => interfaces.has(e.name)).map(type => type.properties).flat();
}

export function isValidInterfaceMethod(descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor }, interfaces: string[], method: string) {
    const availableMethods = getInterfaceMethods(descriptors, new Set(interfaces));
    return availableMethods.includes(method) || descriptors[ScryptedInterface.ScryptedDevice].methods.includes(method);
}

export function isValidInterfaceProperty(descriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor }, interfaces: string[], property: string): boolean {
    const availableProperties = getInterfaceProperties(descriptors, new Set(interfaces));
    return availableProperties.includes(property);
}
