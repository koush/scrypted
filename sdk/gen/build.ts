import { ScryptedInterfaceDescriptors } from "../descriptor";
import path from 'path';
import fs from "fs";

const properties = Object.values(ScryptedInterfaceDescriptors).map(d => d.properties).flat();

const contents =
`
export enum ScryptedInterfaceProperty {
${properties.map(property => '  ' + property + ' = \"' + property + '",\n').join('')}
}
`

fs.writeFileSync(path.join(__dirname, '../properties.gen.ts'), contents);
