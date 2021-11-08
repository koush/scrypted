export interface ScryptedInterfaceDescriptor {
    name: string;
    properties: string[];
    methods: string[];
}
export declare const ScryptedInterfaceDescriptors: {
    [scryptedInterface: string]: ScryptedInterfaceDescriptor;
};
