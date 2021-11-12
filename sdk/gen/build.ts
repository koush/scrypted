import { ScryptedInterfaceDescriptors } from "./types.input";
import path from 'path';
import fs from "fs";

const properties = Object.values(ScryptedInterfaceDescriptors).map(d => d.properties).flat();
const interfaces = Object.keys(ScryptedInterfaceDescriptors);

const interfaceContents =
`
export enum ScryptedInterface {
${interfaces.map(iface => '  ' + iface + ' = \"' + iface + '",\n').join('')}
}
`

const propertyContents =
`
export enum ScryptedInterfaceProperty {
${properties.map(property => '  ' + property + ' = \"' + property + '",\n').join('')}
}
`

const contents = `
${propertyContents}
${interfaceContents}
${fs.readFileSync(path.join(__dirname, './types.input.ts'))}
`;

fs.writeFileSync(path.join(__dirname, '../types.ts'), contents);
