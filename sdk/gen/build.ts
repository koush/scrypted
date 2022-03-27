import stringifyObject from 'stringify-object';
import { ScryptedInterface, ScryptedInterfaceDescriptor } from "./types.input";
import path from 'path';
import fs, { mkdir } from "fs";

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schema.json')).toString());
const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = {};

const allProperties: {[property: string]: any} = {};

function toTypescriptType(type: any): string {
    if (type.type === 'array')
        return `${toTypescriptType(type.elementType)}[]`;
    return type.name;
}

for (const name of Object.values(ScryptedInterface)) {
    const td = schema.children.find((child: any) => child.name === name);
    const properties = td.children.filter((child: any) => child.kindString === 'Property').map((child: any) => child.name);
    const methods = td.children.filter((child: any) => child.kindString === 'Method').map((child: any) => child.name);
    ScryptedInterfaceDescriptors[name] = {
        name,
        methods,
        properties,
    };

    for (const p of td.children.filter((child: any) => child.kindString === 'Property')) {
        allProperties[p.name] = p.type;
    }
}

const properties = Object.values(ScryptedInterfaceDescriptors).map(d => d.properties).flat();

const deviceStateContents = `
export interface DeviceState {
${Object.entries(allProperties).map(([property, type]) => `  ${property}?: ${toTypescriptType(type)}`).join('\n')}
}

export class DeviceBase implements DeviceState {
${Object.entries(allProperties).map(([property, type]) => `  ${property}?: ${toTypescriptType(type)}`).join('\n')}
}
`;

const propertyContents = `
export enum ScryptedInterfaceProperty {
${properties.map(property => '  ' + property + ' = \"' + property + '",\n').join('')}
}
`;

const contents = `
${deviceStateContents}
${propertyContents}

export const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = ${stringifyObject(ScryptedInterfaceDescriptors, { indent: '  ' })}

${fs.readFileSync(path.join(__dirname, './types.input.ts'))}
`;

fs.writeFileSync(path.join(__dirname, '../types/index.ts'), contents);

const dictionaryTypes = new Set<string>();
dictionaryTypes.add('EventDetails');

function toPythonType(type: any): string {
    if (type.type === 'array')
        return `list[${toPythonType(type.elementType)}]`;
    if (type.type === 'tuple')
        return `tuple[${type.elements.map((et: any) => toPythonType(et)).join(', ')}]`;
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
            // generic return type... how to handle this?
        case 'T':
            return 'Any';
    }

    if (typeof type !== 'string')
        return 'Any';
    dictionaryTypes.add(type);
    return type;
}

function toPythonReturnType(type: any): string {
    if (type.name === 'Promise')
        return toPythonReturnType(type.typeArguments[0]);
    return toPythonType(type);
}

function toPythonParameter(param: any) {
    const ret = `${param.name}: ${toPythonType(param.type)}`
    if (param.flags?.isOptional)
        return `${ret} = None`;
    return ret;
}

function toPythonMethodDeclaration(method: any) {
    if (method.signatures[0].type.name === 'Promise')
        return 'async def';
    return 'def';
}

function selfSignature(method: any) {
    const params = (method.signatures[0].parameters || []).map((p: any) => toPythonParameter(p));
    params.unshift('self');
    return params.join(', ');
}

const enums = schema.children.filter((child: any) => child.kindString === 'Enumeration');
const interfaces = schema.children.filter((child: any) => Object.values(ScryptedInterface).includes(child.name));
let python = '';

for (const iface of ['Logger', 'DeviceManager', 'SystemManager', 'MediaManager', 'EndpointManager']) {
    interfaces.push(schema.children.find((child: any) => child.name === iface));
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
        python += `    ${toPythonMethodDeclaration(method)} ${method.name}(${selfSignature(method)}) -> ${toPythonReturnType(method.signatures[0].type)}:
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

python += `
class ScryptedInterfaceProperty(Enum):
`
    for (const val of properties) {
        python += `    ${val} = "${val}"
`;
}


python += `
class DeviceState:
    def getScryptedProperty(self, property: str) -> Any:
        pass
    def setScryptedProperty(self, property: str, value: Any):
        pass
`
    for (const [val, type] of Object.entries(allProperties)) {
        python += `
    @property
    def ${val}(self) -> ${toPythonType(type)}:
        self.getScryptedProperty("${val}")
    @${val}.setter
    def ${val}(self, value: ${toPythonType(type)}):
        self.setScryptedProperty("${val}", value)
`;
}


let seen = new Set<string>();
seen.add('DeviceState');
seen.add('MediaObject');

while (dictionaryTypes.size) {
    const unknowns = schema.children.filter((child: any) => dictionaryTypes.has(child.name) && !enums.find((e: any) => e.name === child.name));

    const newSeen = new Set([...seen, ...dictionaryTypes]);
    dictionaryTypes.clear();

    let pythonUnknowns = '';

    for (const td of unknowns) {
        if (seen.has(td.name))
            continue;
        if (td.name === 'EventListener' || td.name === 'SettingValue')
            continue;
        pythonUnknowns += `
class ${td.name}(TypedDict):
`;

    const properties = td.children?.filter((child: any) => child.kindString === 'Property') || [];
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

const pythonTypes = `from __future__ import annotations
from enum import Enum
from typing_extensions import TypedDict
from typing import Any
from typing import Callable

from .other import *

${pythonEnums}
${python}
`

fs.writeFileSync(path.join(__dirname, '../scrypted_python/scrypted_sdk/types.py'), pythonTypes);
fs.writeFileSync(path.join(__dirname, '../types/scrypted_python/scrypted_sdk/types.py'), pythonTypes);
fs.copyFileSync(path.join(__dirname, '../scrypted_python/scrypted_sdk/other.py'), path.join(__dirname, '../types/scrypted_python/scrypted_sdk/other.py'));