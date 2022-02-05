import { ScryptedInterface, ScryptedInterfaceDescriptors } from "@scrypted/types";

export const allInterfaceMethods: string[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.methods));
export const allInterfaceProperties: string[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).map((type: any) => type.properties));
export const deviceMethods: string[] = ['listen', 'setName', 'setRoom', 'setType'];

export const methodInterfaces: { [method: string]: string } = {};
for (const desc of Object.values(ScryptedInterfaceDescriptors)) {
    for (const method of desc.methods) {
        methodInterfaces[method] = desc.name;
    }
}

export const propertyInterfaces: { [property: string]: ScryptedInterface } = {};
for (const descriptor of Object.values(ScryptedInterfaceDescriptors)) {
    for (const property of descriptor.properties) {
        propertyInterfaces[property] = descriptor.name as ScryptedInterface;
    }
}

export function isValidInterfaceMethod(interfaces: string[], method: string) {
    const availableMethods: string[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).filter((e: any) => interfaces.includes(e.name)).map((type: any) => type.methods));
    return availableMethods.includes(method) || ScryptedInterfaceDescriptors[ScryptedInterface.ScryptedDevice].methods.includes(method);
}

export function isValidInterfaceProperty(interfaces: string[], property: string): boolean {
    const availableProperties: string[] = [].concat(...Object.values(ScryptedInterfaceDescriptors).filter((e: any) => interfaces.includes(e.name)).map((type: any) => type.properties));
    return availableProperties.includes(property);
}
