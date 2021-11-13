import stringifyObject from 'stringify-object';
import { ScryptedInterface, ScryptedInterfaceDescriptor } from "./types.input";
import path from 'path';
import fs from "fs";
import { isPropertySignature } from 'typescript';

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schema.json')).toString());
const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = {};

for (const name of Object.values(ScryptedInterface)) {
    const td = schema.children.find((child: any) => child.name === name);
    const properties = td.children.filter((child: any) => child.kindString === 'Property').map((child: any) => child.name);
    const methods = td.children.filter((child: any) => child.kindString === 'Method').map((child: any) => child.name);
    ScryptedInterfaceDescriptors[name] = {
        name,
        methods,
        properties,
    };
}

const properties = Object.values(ScryptedInterfaceDescriptors).map(d => d.properties).flat();

const propertyContents = `
export enum ScryptedInterfaceProperty {
${properties.map(property => '  ' + property + ' = \"' + property + '",\n').join('')}
}
`

const contents = `
${propertyContents}

export const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = ${stringifyObject(ScryptedInterfaceDescriptors, { indent: '  ' })}

${fs.readFileSync(path.join(__dirname, './types.input.ts'))}
`;

fs.writeFileSync(path.join(__dirname, '../types.ts'), contents);

const enums = schema.children.filter((child: any) => child.kindString === 'Enumeration');
const interfaces = schema.children.filter((child: any) => Object.values(ScryptedInterface).includes(child.name));
let python = '';

const unknownTypes = new Set<string>();
unknownTypes.add('EventDetails');

function toPythonType(type: any): string {
    if (type.type === 'array')
        return `list(${toPythonType(type.elementType)})`;
    if (type.type === 'union')
        return type.types.map((type: any) => toPythonType(type)).join(' | ')
    type = type.typeArguments?.[0]?.name || type.name || type;
    switch (type) {
        case 'boolean':
            return 'bool';
        case 'number':
            return 'float';
        case 'string':
            return 'str';
        case 'void':
            return 'None';
        case 'any':
            return 'Any';
        case 'Buffer':
            return 'bytearray';
    }

    if (type === 'Promise')
        return 'None';

    if (typeof type !== 'string')
        return 'Any';
    unknownTypes.add(type);
    return type;
}

function toPythonParameter(param: any) {
    return `${param.name}: ${toPythonType(param.type)}`
}

for (const td of interfaces) {
    python += `
class ${td.name}:
`;

    const properties = td.children.filter((child: any) => child.kindString === 'Property');
    const methods = td.children.filter((child: any) => child.kindString === 'Method');
    for (const property of properties) {
        python += `    ${property.name}: ${toPythonType(property.type)}
`
    }
    for (const method of methods) {
        python += `    def ${method.name}(${(method.signatures[0].parameters || []).map((p: any) => toPythonParameter(p)).join(', ')}) -> ${toPythonType(method.signatures[0].type)}:
        pass
`
    }
    python += `    pass
`;
}

let pythonEnums = ''
for (const e of enums) {
    pythonEnums += `
class ${e.name}(Enum):
`
    for (const val of e.children) {
        pythonEnums += `    ${val.name} = ${val.defaultValue}
`;
    }
}


let seen = new Set<string>();
while (unknownTypes.size) {
    const unknowns = schema.children.filter((child: any) => unknownTypes.has(child.name) && !enums.find((e: any) => e.name === child.name));

    const newSeen = new Set([...seen, ...unknownTypes]);
    unknownTypes.clear();

    let pythonUnknowns = '';

    for (const td of unknowns) {
        if (seen.has(td.name))
            continue;
        if (td.name === 'EventListener' || td.name === 'SettingValue')
            continue;
        pythonUnknowns += `
class ${td.name}(TypedDict):
`;

    const properties = td.children.filter((child: any) => child.kindString === 'Property');
    for (const property of properties) {
        pythonUnknowns += `    ${property.name}: ${toPythonType(property.type)}
`
    }
    pythonUnknowns += `    pass
`;
}

    python = pythonUnknowns + python;
    seen = newSeen;
}


fs.writeFileSync(path.join(__dirname, '../python/scrypted_sdk/types.py'),
    `from __future__ import annotations
from enum import Enum
from typing import TypedDict
from typing import Any
from typing import Callable

SettingValue = str
EventListener = Callable[[Any, Any, Any], None]

${pythonEnums}
${python}
`);
