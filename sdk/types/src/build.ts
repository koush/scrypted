import fs from "fs";
import path from 'path';
import { ArrayType, DeclarationReflection, InferredType, LiteralType, ProjectReflection, ReferenceType, ReflectionKind, SomeType, Type } from 'typedoc';
import { ScryptedInterface, ScryptedInterfaceDescriptor } from "./types.input";

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../gen/schema.json')).toString()) as ProjectReflection;
const packageJson = require('../package.json');
const typesVersion = packageJson.version;
const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = {};

const allProperties: { [property: string]: DeclarationReflection } = {};

function toTypescriptType(type: SomeType ): string {
    if (type.type === 'literal')
        return `'${type.value}'`;
    if (type.type === 'array')
        return `${toTypescriptType(type.elementType)}[]`;
    if (type.type === 'union')
        return type.types.map((type: any) => toTypescriptType(type)).join(' | ')
    if (type.type === 'reference') {
        if (type.typeArguments)
            return `${type.name}<${type.typeArguments.map((t: any) => toTypescriptType(t)).join(', ')}>`;
        return type.name;
    }
    return (type as any).name;
}

for (const name of Object.values(ScryptedInterface)) {
    const td = schema.children?.find((child) => child.name === name);
    const children = td?.children || [];
    const properties = children.filter((child) => child.kind === ReflectionKind.Property).map((child) => child.name);
    const methods = children.filter((child) => child.kind === ReflectionKind.Method).map((child) => child.name);
    ScryptedInterfaceDescriptors[name] = {
        name,
        methods,
        properties,
    };

    for (const p of children.filter((child) => child.kind === ReflectionKind.Property)) {
        allProperties[p.name] = p;
    }
}

const properties = Object.values(ScryptedInterfaceDescriptors).map(d => d.properties).flat();
const methods = Object.values(ScryptedInterfaceDescriptors).map(d => d.methods).flat();

const deviceStateContents = `
export interface DeviceState {
${Object.entries(allProperties).map(([property, { type, flags }]) => `  ${property}${flags.isOptional ? '?' : ''}: ${toTypescriptType(type!)}`).join('\n')};
}

export class DeviceBase implements DeviceState {
${Object.entries(allProperties).map(([property, { type, flags }]) => `  ${property}${flags.isOptional ? '?' : '!'}: ${toTypescriptType(type!)}`).join('\n')};
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

export const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = ${JSON.stringify(ScryptedInterfaceDescriptors, undefined, 2)};

${fs.readFileSync(path.join(__dirname, './types.input.ts'))}
`;

fs.writeFileSync(path.join(__dirname, '../gen/index.ts'), contents);

const discoveredTypes = new Set<string>();
discoveredTypes.add('EventDetails');

// When computing method signatures, we push the generic parameter types
// into this set. We can then convert them to Any.
// Pop the types off when we're done.
const parameterTypes = new Set<string>();

function toPythonType(type: any): string {
    if (type.type === 'array')
        return `list[${toPythonType(type.elementType)}]`;
    if (type.type === 'intersection')
        return `Union[${type.types.map((et: any) => toPythonType(et)).join(', ')}]`
    if (type.type === 'tuple')
        return `tuple[${type.elements.map((et: any) => toPythonType(et)).join(', ')}]`;
    if (type.type === 'union')
        return type.types.map((type: any) => toPythonType(type)).join(' | ')
    if (type.name === 'AsyncGenerator')
        return `AsyncGenerator[${toPythonType(type.typeArguments[0])}, None]`;
    if (type.name === 'Record')
        return `Mapping[${toPythonType(type.typeArguments[0])}, ${toPythonType(type.typeArguments[1])}]`;
    type = type.typeArguments?.[0]?.name || type.name || type;
    if (parameterTypes.has(type))
        return 'Any';
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

const enums = schema.children?.filter((child) => child.kind === ReflectionKind.Enum) ?? [];
const interfaces = schema.children?.filter((child: any) => Object.values(ScryptedInterface).includes(child.name)) ?? [];
let python = `
TYPES_VERSION = "${typesVersion}"

`;

for (const iface of ['Logger', 'DeviceManager', 'SystemManager', 'MediaManager', 'EndpointManager', 'ClusterManager']) {
    const child = schema.children?.find((child: any) => child.name === iface);

    if (child)
        interfaces.push(child);
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
    text = text.slice(0, text.length - 2)
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
    return text.slice(0, text.length - 1)

}

function addNonDictionaryType(td: DeclarationReflection) {
    seen.add(td.name);
    python += `
class ${td.name}:
${toDocstring(td)}
`;
    // cache type parameters so underlying generators can map them to Any
    for (const typeParameter of td.typeParameters || []) {
        parameterTypes.add(typeParameter.name);
    }

    const children = td.children || [];
    const properties = children.filter((child) => child.kind === ReflectionKind.Property);
    const methods = children.filter((child) => child.kind === ReflectionKind.Method);
    for (const property of properties) {
        python += `    ${property.name}: ${toPythonType(property.type)}${toComment(property)}
`
    }
    for (const method of methods) {
        python += `    ${toPythonMethodDeclaration(method)} ${method.name}(${selfSignature(method)}) -> ${toPythonReturnType(method.signatures![0].type)}:
        ${toDocstring(method, true)}

`
    }
    if (!td.children)
        python += `
    pass
`

    // reset for the next type
    parameterTypes.clear();
}

for (const td of interfaces) {
    if (seen.has(td.name))
        continue;
    addNonDictionaryType(td);
}

let pythonEnums = ''
for (const e of enums) {
    if (e.children) {
        pythonEnums += `
class ${e.name}(str, Enum):
${toDocstring(e)}
`
        for (const val of e.children) {
            if (val.type && 'value' in val.type)
                pythonEnums += `    ${val.name} = "${val.type.value}"
`;
        }
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
for (const [val, { type }] of Object.entries(allProperties)) {
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
    const unknowns = schema.children?.filter((child: any) => discoveredTypes.has(child.name) && !enums.find((e: any) => e.name === child.name)) ?? [];

    const newSeen = new Set([...seen, ...discoveredTypes]);
    discoveredTypes.clear();

    let pythonUnknowns = '';

    for (const td of unknowns) {
        if (seen.has(td.name))
            continue;
        if (td.name === 'EventListener' || td.name === 'SettingValue')
            continue;
        const isDictionary = !td.children?.find((c) => c.kind === ReflectionKind.Method);
        if (!isDictionary) {
            addNonDictionaryType(td);
            continue;
        }
        pythonUnknowns += `
class ${td.name}(TypedDict):
${toDocstring(td)}
`;

        const properties = td.children?.filter((child) => child.kind === ReflectionKind.Property) || [];
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
    from typing import TypedDict, Mapping
except:
    from typing_extensions import TypedDict, Mapping
from typing import Union, Any, AsyncGenerator

from .other import *

${pythonEnums}
${python}
`

fs.writeFileSync(path.join(__dirname, '../scrypted_python/scrypted_sdk/types.py'), pythonTypes);
