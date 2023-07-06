import stringifyObject from 'stringify-object';
import { ScryptedInterface, ScryptedInterfaceDescriptor } from "./types.input";
import path from 'path';
import fs from "fs";

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../gen/schema.json')).toString());
const typesVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json')).toString()).version;
const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = {};

const allProperties: { [property: string]: any } = {};

function toTypescriptType(type: any): string {
    if (type.type === 'literal')
        return `'${type.value}'`;
    if (type.type === 'array')
        return `${toTypescriptType(type.elementType)}[]`;
    if (type.type === 'union')
        return type.types.map((type: any) => toTypescriptType(type)).join(' | ')
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
const methods = Object.values(ScryptedInterfaceDescriptors).map(d => d.methods).flat();

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

const methodContents = `
export enum ScryptedInterfaceMethod {
${methods.map(method => '  ' + method + ' = \"' + method + '",\n').join('')}
}
`;

const contents = `
export const TYPES_VERSION = "${typesVersion}";

${deviceStateContents}
${propertyContents}
${methodContents}

export const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = ${stringifyObject(ScryptedInterfaceDescriptors, { indent: '  ' })}

${fs.readFileSync(path.join(__dirname, './types.input.ts'))}
`;

fs.writeFileSync(path.join(__dirname, '../gen/index.ts'), contents);

const discoveredTypes = new Set<string>();
discoveredTypes.add('EventDetails');

function toPythonType(type: any): string {
    if (type.type === 'array')
        return `list[${toPythonType(type.elementType)}]`;
    if (type.type === 'intersection')
        return `Union[${type.types.map((et: any) => toPythonType(et)).join(', ')}]`
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
    discoveredTypes.add(type);
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

let seen = new Set<string>();

seen.add('DeviceState');
seen.add('MediaObject');
seen.add('RTCSignalingSession');
seen.add('RTCSignalingChannel');
seen.add('RTCSignalingClient');

function toDocstring(td: any, includePass: boolean = false) {
    const suffix = includePass ? `    pass` : '';
    const comments: any[] = ((td.comment ?? {}).summary ?? []).filter((item: any) => item.kind === "text");
    if (comments.length === 0) {
        if (includePass) {
            return `pass`;
        }
        return '';
    }
    if (comments.length === 1) {
        return `    """${comments[0].text.replaceAll('\n', ' ')}"""\n${suffix}`;
    }
    let text = `    """\n`;
    for (const comment of comments) {
        text += `    ${comment.text.replaceAll('\n', ' ')}\n\n`;
    }
    text = text.slice(0,text.length - 2)
    text += `    """\n${suffix}`;
    return text

}

function toComment(td: any) {
    const comments: any[] = ((td.comment ?? {}).summary ?? []).filter((item: any) => item.kind === "text");
    if (comments.length === 0) {
        return '';
    }
    if (comments.length === 1) {
        return `  # ${comments[0].text.replaceAll('\n', ' ')}`;
    }
    let text = `  # `;
    for (const comment of comments) {
        text += `${comment.text.replaceAll('\n', ' ')} `;
    }
    return text.slice(0,text.length - 1)

}

function addNonDictionaryType(td: any) {
    seen.add(td.name);
    python += `
class ${td.name}:
${toDocstring(td)}
`;

    const properties = td.children.filter((child: any) => child.kindString === 'Property');
    const methods = td.children.filter((child: any) => child.kindString === 'Method');
    for (const property of properties) {
        python += `    ${property.name}: ${toPythonType(property.type)}${toComment(property)}
`
    }
    for (const method of methods) {
        python += `    ${toPythonMethodDeclaration(method)} ${method.name}(${selfSignature(method)}) -> ${toPythonReturnType(method.signatures[0].type)}:
        ${toDocstring(method, true)}

`
    }
}

for (const td of interfaces) {
    if (seen.has(td.name))
        continue;
    addNonDictionaryType(td);
}

let pythonEnums = ''
for (const e of enums) {
    pythonEnums += `
class ${e.name}(str, Enum):
${toDocstring(e)}
`
    for (const val of e.children) {
        pythonEnums += `    ${val.name} = "${val.type.value}"
`;
    }
}

python += `
class ScryptedInterfaceProperty(str, Enum):
`
for (const val of properties) {
    python += `    ${val} = "${val}"
`;
}

python += `
class ScryptedInterfaceMethods(str, Enum):
`
for (const val of methods) {
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
    if (val === 'nativeId')
        continue;
    python += `
    @property
    def ${val}(self) -> ${toPythonType(type)}:
        return self.getScryptedProperty("${val}")

    @${val}.setter
    def ${val}(self, value: ${toPythonType(type)}):
        self.setScryptedProperty("${val}", value)
`;
}

python += `
ScryptedInterfaceDescriptors = ${JSON.stringify(ScryptedInterfaceDescriptors, null, 2)}
`

while (discoveredTypes.size) {
    const unknowns = schema.children.filter((child: any) => discoveredTypes.has(child.name) && !enums.find((e: any) => e.name === child.name));

    const newSeen = new Set([...seen, ...discoveredTypes]);
    discoveredTypes.clear();

    let pythonUnknowns = '';

    for (const td of unknowns) {
        if (seen.has(td.name))
            continue;
        if (td.name === 'EventListener' || td.name === 'SettingValue')
            continue;
        const isDictionary = !td.children?.find((c: any) => c.kindString === 'Method');
        if (!isDictionary) {
            addNonDictionaryType(td);
            continue;
        }
        pythonUnknowns += `
class ${td.name}(TypedDict):
${toDocstring(td)}
`;

        const properties = td.children?.filter((child: any) => child.kindString === 'Property') || [];
        for (const property of properties) {
            pythonUnknowns += `    ${property.name}: ${toPythonType(property.type)}${toComment(property)}
`
        }
        if (properties.length === 0) {
            pythonUnknowns += `    pass

`;
        }
    }

    python = pythonUnknowns + python;
    seen = newSeen;
}

const pythonTypes = `from __future__ import annotations
from enum import Enum
try:
    from typing import TypedDict
except:
    from typing_extensions import TypedDict
from typing import Union, Any

from .other import *

${pythonEnums}
${python}
`

fs.writeFileSync(path.join(__dirname, '../scrypted_python/scrypted_sdk/types.py'), pythonTypes);
