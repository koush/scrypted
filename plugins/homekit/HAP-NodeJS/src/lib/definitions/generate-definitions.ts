import "./CharacteristicDefinitions"

import assert from "assert";
import { Command } from "commander";
import fs from "fs";
import path from "path";
import plist from "simple-plist";
import { Access, Characteristic, Formats, Units } from "../Characteristic";
import { toLongForm } from "../util/uuid";
import {
  CharacteristicClassAdditions,
  CharacteristicDeprecatedNames,
  CharacteristicHidden,
  CharacteristicManualAdditions,
  CharacteristicNameOverrides,
  CharacteristicOverriding,
  CharacteristicSinceInformation,
  CharacteristicValidValuesOverride,
  ServiceCharacteristicConfigurationOverrides,
  ServiceDeprecatedNames,
  ServiceManualAdditions,
  ServiceNameOverrides,
  ServiceSinceInformation
} from "./generator-configuration";

// noinspection JSUnusedLocalSymbols
const temp = Characteristic; // this to have "../Characteristic" not being only type import, otherwise this would not result in a require statement

const command = new Command("generate-definitions")
  .version("1.0.0")
  .option("-f, --force")
  .option("-m, --metadata <path>", "Define a custom location for the plain-metadata.config file",
    "/System/Library/PrivateFrameworks/HomeKitDaemon.framework/Resources/plain-metadata.config")
  .requiredOption("-s, --simulator <path>", "Define the path to the accessory simulator.");

command.parse(process.argv);
const options = command.opts();

const metadataFile: string = options.metadata;
const simulator: string = options.simulator;
if (!fs.existsSync(metadataFile)) {
  console.warn(`The metadata file at '${metadataFile}' does not exist!`);
  process.exit(1);
}
if (!fs.existsSync(simulator)) {
  console.warn(`The simulator app directory '${simulator}' does not exist!`);
  process.exit(1);
}

const defaultPlist: string = path.resolve(simulator, "Contents/Frameworks/HAPAccessoryKit.framework/Resources/default.metadata.plist");
const defaultMfiPlist: string = path.resolve(simulator, "Contents/Frameworks/HAPAccessoryKit.framework/Resources/default_mfi.metadata.plist");

interface CharacteristicDefinition {
  DefaultDescription: string,
  Format: string,
  LocalizationKey: string,
  Properties: number,
  ShortUUID: string,
  MaxValue?: number,
  MinValue?: number,
  MaxLength?: number,
  // MinLength is another property present on the SerialNumber characteristic. Though we already have a special check for that
  StepValue?: number,
  Units?: string,
}

interface SimulatorCharacteristicDefinition {
  UUID: string;
  Name: string;
  Format: string;
  Constraints?: Constraints;
  Permissions: string[]; // stuff like "securedRead", "securedWrite", "writeResponse" or "timedWrite"
  Properties: string[]; // stuff like "read", "write", "cnotify", "uncnotify"
}

interface Constraints {
  StepValue?: number;
  MaximumValue?: number;
  MinimumValue?: number;
  ValidValues?: Record<string, string>;
  ValidBits?: Record<number, string>;
}

interface ServiceDefinition {
  Characteristics: {
    Optional: string[],
    Required: string[]
  },
  DefaultDescription: string,
  LocalizationKey: string,
  ShortUUID: string,
}

interface PropertyDefinition {
  DefaultDescription: string;
  LocalizationKey: string;
  Position: number;
}

interface UnitDefinition {
  DefaultDescription: string,
  LocalizationKey: string;
}

interface CategoryDefinition {
  DefaultDescription: string;
  Identifier: number;
  UUID: string;
}

export interface GeneratedCharacteristic {
  id: string;
  UUID: string,
  name: string,
  className: string,
  deprecatedClassName?: string;
  since?: string,
  deprecatedNotice?: string;

  format: string,
  units?: string,
  properties: number,
  maxValue?: number,
  minValue?: number,
  stepValue?: number,
  maxLength?: number,

  validValues?: Record<string, string>; // <value, key>
  validBitMasks?: Record<string, string>;

  adminOnlyAccess?: Access[],

  classAdditions?: string[],
}

export interface GeneratedService {
  id: string,
  UUID: string,
  name: string,
  className: string,
  deprecatedClassName?: string,
  since?: string,
  deprecatedNotice?: string,

  requiredCharacteristics: string[];
  optionalCharacteristics?: string[];
}

const plistData = plist.readFileSync(metadataFile);
const simulatorPlistData = plist.readFileSync(defaultPlist);
const simulatorMfiPlistData = fs.existsSync(defaultMfiPlist)? plist.readFileSync(defaultMfiPlist): undefined;

if (plistData.SchemaVersion !== 1) {
  console.warn(`Detected unsupported schema version ${plistData.SchemaVersion}!`);
}
if (plistData.PlistDictionary.SchemaVersion !== 1) {
  console.warn(`Detect unsupported PlistDictionary schema version ${plistData.PlistDictionary.SchemaVersion}!`);
}

console.log(`Parsing version ${plistData.Version}...`);

const shouldParseCharacteristics = checkWrittenVersion("./CharacteristicDefinitions.ts", plistData.Version);
const shouldParseServices = checkWrittenVersion("./ServiceDefinitions.ts", plistData.Version);

if (!options.force && (!shouldParseCharacteristics || !shouldParseServices)) {
  console.log("Parsed schema version " + plistData.Version + " is older than what's already generated. " +
    "User --force option to generate and overwrite nonetheless!");
  process.exit(1);
}

const undefinedUnits: string[] = ["micrograms/m^3", "ppm"];

let characteristics: Record<string, CharacteristicDefinition>;
const simulatorCharacteristics: Map<string, SimulatorCharacteristicDefinition> = new Map();
let services: Record<string, ServiceDefinition>;
let units: Record<string, UnitDefinition>;
let categories: Record<string, CategoryDefinition>;
const properties: Map<number, string> = new Map();
try {
  characteristics = checkDefined(plistData.PlistDictionary.HAP.Characteristics);
  services = checkDefined(plistData.PlistDictionary.HAP.Services);
  units = checkDefined(plistData.PlistDictionary.HAP.Units);
  categories = checkDefined(plistData.PlistDictionary.HomeKit.Categories);

  const props: Record<string, PropertyDefinition> = checkDefined(plistData.PlistDictionary.HAP.Properties);
  // noinspection JSUnusedLocalSymbols
  for (const [id, definition] of Object.entries(props).sort(([a, aDef], [b, bDef]) => aDef.Position - bDef.Position)) {
    const perm = characteristicPerm(id);
    if (perm) {
      const num = 1 << definition.Position;
      properties.set(num, perm);
    }
  }

  for (const characteristic of (simulatorPlistData.Characteristics as SimulatorCharacteristicDefinition[])) {
    simulatorCharacteristics.set(characteristic.UUID, characteristic);
  }
  if (simulatorMfiPlistData) {
    for (const characteristic of (simulatorMfiPlistData.Characteristics as SimulatorCharacteristicDefinition[])) {
      simulatorCharacteristics.set(characteristic.UUID, characteristic);
    }
  }
} catch (error) {
  console.log("Unexpected structure of the plist file!");
  throw error;
}

// first step is to check if we are up to date on categories
for (const definition of Object.values(categories)) {
  if (definition.Identifier > 36) {
    console.log(`Detected a new category '${definition.DefaultDescription}' with id ${definition.Identifier}`);
  }
}

const characteristicOutput = fs.createWriteStream(path.join(__dirname, "CharacteristicDefinitions.ts"));

characteristicOutput.write("// THIS FILE IS AUTO-GENERATED - DO NOT MODIFY\n");
characteristicOutput.write(`// V=${plistData.Version}\n`);
characteristicOutput.write("\n");

characteristicOutput.write("import { Access, Characteristic, Formats, Perms, Units } from \"../Characteristic\";\n\n");

/**
 * Characteristics
 */

const generatedCharacteristics: Record<string, GeneratedCharacteristic> = {}; // indexed by id
const writtenCharacteristicEntries: Record<string, GeneratedCharacteristic> = {}; // indexed by class name

for (const [id, definition] of Object.entries(characteristics)) {
  try {
    if (CharacteristicHidden.has(id)) {
      continue;
    }

    // "Carbon dioxide Detected" -> "Carbon Dioxide Detected"
    const name = (CharacteristicNameOverrides.get(id) ?? definition.DefaultDescription).split(" ").map(entry => entry[0].toUpperCase() + entry.slice(1)).join(" ");
    const deprecatedName = CharacteristicDeprecatedNames.get(id);

    // "Target Door State" -> "TargetDoorState", "PM2.5" -> "PM2_5"
    const className = name.replace(/[\s-]/g, "").replace(/[.]/g, "_");
    const deprecatedClassName = deprecatedName?.replace(/[\s-]/g, "").replace(/[.]/g, "_");
    const longUUID = toLongForm(definition.ShortUUID);

    const simulatorCharacteristic = simulatorCharacteristics.get(longUUID);

    const validValues = simulatorCharacteristic?.Constraints?.ValidValues || {};
    const validValuesOverride = CharacteristicValidValuesOverride.get(id);
    if (validValuesOverride) {
      for (const [key, value] of Object.entries(validValuesOverride)) {
        validValues[key] = value;
      }
    }
    for (const [value, name] of Object.entries(validValues)) {
      let constName = name.toUpperCase().replace(/[^\w]+/g, "_");
      if (/^[1-9]/.test(constName)) {
        constName = "_" + constName; // variables can't start with a number
      }
      validValues[value] = constName;
    }
    const validBits = simulatorCharacteristic?.Constraints?.ValidBits;
    let validBitMasks: Record<string, string> | undefined = undefined;
    if (validBits) {
      validBitMasks = {};
      for (const [value, name] of Object.entries(validBits)) {
        let constName = name.toUpperCase().replace(/[^\w]+/g, "_");
        if (/^[1-9]/.test(constName)) {
          constName = "_" + constName; // variables can't start with a number
        }
        validBitMasks["" + (1 << parseInt(value, 10))] = constName + "_BIT_MASK";
      }
    }

    const generatedCharacteristic: GeneratedCharacteristic = {
      id: id,
      UUID: longUUID,
      name: name,
      className: className,
      deprecatedClassName: deprecatedClassName,
      since: CharacteristicSinceInformation.get(id),

      format: definition.Format,
      units: definition.Units,
      properties: definition.Properties,
      minValue: definition.MinValue,
      maxValue: definition.MaxValue,
      stepValue: definition.StepValue,

      maxLength: definition.MaxLength,

      validValues: validValues,
      validBitMasks: validBitMasks,
      classAdditions: CharacteristicClassAdditions.get(id),
    };

    // call any handler which wants to manually override properties of the generated characteristic
    CharacteristicOverriding.get(id)?.(generatedCharacteristic)

    generatedCharacteristics[id] = generatedCharacteristic;
    writtenCharacteristicEntries[className] = generatedCharacteristic;
    if (deprecatedClassName) {
      writtenCharacteristicEntries[deprecatedClassName] = generatedCharacteristic;
    }
  } catch (error) {
    throw new Error("Error thrown generating characteristic '" + id + "' (" + definition.DefaultDescription + "): " + error.message);
  }
}

for (const [id, generated] of CharacteristicManualAdditions) {
  generatedCharacteristics[id] = generated;
  writtenCharacteristicEntries[generated.className] = generated;
  if (generated.deprecatedClassName) {
    writtenCharacteristicEntries[generated.deprecatedClassName] = generated;
  }
}

for (const generated of Object.values(generatedCharacteristics)
  .sort((a, b) => a.className.localeCompare(b.className))) {
  try {
    characteristicOutput.write("/**\n");
    characteristicOutput.write(" * Characteristic \"" + generated.name + "\"\n");
    if (generated.since) {
      characteristicOutput.write(" * @since iOS " + generated.since + "\n");
    }
    if (generated.deprecatedNotice) {
      characteristicOutput.write(" * @deprecated " + generated.deprecatedNotice + "\n");
    }
    characteristicOutput.write(" */\n");


    characteristicOutput.write("export class " + generated.className + " extends Characteristic {\n\n");

    characteristicOutput.write("  public static readonly UUID: string = \"" + generated.UUID + "\";\n\n");

    const classAdditions = generated.classAdditions;
    if (classAdditions) {
      characteristicOutput.write(classAdditions.map(line => "  " + line + "\n").join("") + "\n");
    }

    let validValuesEntries = Object.entries(generated.validValues ?? {})
    if (validValuesEntries.length) {
      for (let [value, name] of validValuesEntries) {
        if (!name) {
          continue
        }
        characteristicOutput.write(`  public static readonly ${name} = ${value};\n`);
      }
      characteristicOutput.write("\n");
    }
    if (generated.validBitMasks) {
      for (let [value, name] of Object.entries(generated.validBitMasks)) {
        characteristicOutput.write(`  public static readonly ${name} = ${value};\n`);
      }
      characteristicOutput.write("\n");
    }

    characteristicOutput.write("  constructor() {\n");
    characteristicOutput.write("    super(\"" + generated.name + "\", " + generated.className + ".UUID, {\n");
    characteristicOutput.write("      format: Formats." + characteristicFormat(generated.format) + ",\n");
    characteristicOutput.write("      perms: [" + generatePermsString(generated.id, generated.properties) + "],\n")
    if (generated.units && !undefinedUnits.includes(generated.units)) {
      characteristicOutput.write("      unit: Units." + characteristicUnit(generated.units) + ",\n");
    }
    if (generated.minValue != null) {
      characteristicOutput.write("      minValue: " + generated.minValue + ",\n");
    }
    if (generated.maxValue != null) {
      characteristicOutput.write("      maxValue: " + generated.maxValue + ",\n");
    }
    if (generated.stepValue != null) {
      characteristicOutput.write("      minStep: " + generated.stepValue + ",\n");
    }
    if (generated.maxLength != null) {
      characteristicOutput.write("      maxLen: " + generated.maxLength + ",\n");
    }
    if (validValuesEntries.length) {
      characteristicOutput.write("      validValues: [" + Object.keys(generated.validValues!).join(", ") + "],\n")
    }
    if (generated.adminOnlyAccess) {
      characteristicOutput.write("      adminOnlyAccess: ["
        + generated.adminOnlyAccess.map(value => "Access." + characteristicAccess(value)).join(", ") + "],\n")
    }
    characteristicOutput.write("    });\n");
    characteristicOutput.write("    this.value = this.getDefaultValue();\n");
    characteristicOutput.write("  }\n");
    characteristicOutput.write("}\n");
    if (generated.deprecatedClassName) {
      characteristicOutput.write("// noinspection JSDeprecatedSymbols\n");
      characteristicOutput.write("Characteristic." + generated.deprecatedClassName + " = " + generated.className + ";\n");
    }
    if (generated.deprecatedNotice) {
      characteristicOutput.write("// noinspection JSDeprecatedSymbols\n");
    }
    characteristicOutput.write("Characteristic." + generated.className + " = " + generated.className + ";\n\n");
  } catch (error) {
    throw new Error("Error thrown writing characteristic '" + generated.id + "' (" + generated.className + "): " + error.message);
  }
}

characteristicOutput.end();

const characteristicProperties = Object.entries(writtenCharacteristicEntries).sort(([a], [b]) => a.localeCompare(b));
rewriteProperties("Characteristic", characteristicProperties);
writeCharacteristicTestFile();

/**
 * Services
 */

const serviceOutput = fs.createWriteStream(path.join(__dirname, "ServiceDefinitions.ts"));

serviceOutput.write("// THIS FILE IS AUTO-GENERATED - DO NOT MODIFY\n");
serviceOutput.write(`// V=${plistData.Version}\n`);
serviceOutput.write("\n");

serviceOutput.write("import { Characteristic } from \"../Characteristic\";\n");
serviceOutput.write("import { Service } from \"../Service\";\n\n");

const generatedServices: Record<string, GeneratedService> = {}; // indexed by id
const writtenServiceEntries: Record<string, GeneratedService> = {}; // indexed by class name

for (const [id, definition] of Object.entries(services)) {
  try {
    // "Carbon dioxide Sensor" -> "Carbon Dioxide Sensor"
    const name = (ServiceNameOverrides.get(id) ?? definition.DefaultDescription).split(" ").map(entry => entry[0].toUpperCase() + entry.slice(1)).join(" ");
    const deprecatedName = ServiceDeprecatedNames.get(id);

    const className = name.replace(/[\s-]/g, "").replace(/[.]/g, "_");
    const deprecatedClassName = deprecatedName?.replace(/[\s-]/g, "").replace(/[.]/g, "_");

    const longUUID = toLongForm(definition.ShortUUID);

    const requiredCharacteristics = definition.Characteristics.Required;
    const optionalCharacteristics = definition.Characteristics.Optional;

    const configurationOverride = ServiceCharacteristicConfigurationOverrides.get(id);
    if (configurationOverride) {
      if (configurationOverride.removedRequired) {
        for (const entry of configurationOverride.removedRequired) {
          const index = requiredCharacteristics.indexOf(entry);
          if (index !== -1) {
            requiredCharacteristics.splice(index, 1);
          }
        }
      }
      if (configurationOverride.removedOptional) {
        for (const entry of configurationOverride.removedOptional) {
          const index = optionalCharacteristics.indexOf(entry);
          if (index !== -1) {
            optionalCharacteristics.splice(index, 1);
          }
        }
      }

      if (configurationOverride.addedRequired) {
        for (const entry of configurationOverride.addedRequired) {
          if (!requiredCharacteristics.includes(entry)) {
            requiredCharacteristics.push(entry);
          }
        }
      }
      if (configurationOverride.addedOptional) {
        for (const entry of configurationOverride.addedOptional) {
          if (!optionalCharacteristics.includes(entry)) {
            optionalCharacteristics.push(entry);
          }
        }
      }
    }

    const generatedService: GeneratedService = {
      id: id,
      UUID: longUUID,
      name: name,
      className: className,
      deprecatedClassName: deprecatedClassName,
      since: ServiceSinceInformation.get(id),

      requiredCharacteristics: requiredCharacteristics,
      optionalCharacteristics: optionalCharacteristics,
    };
    generatedServices[id] = generatedService;
    writtenServiceEntries[className] = generatedService;
    if (deprecatedClassName) {
      writtenServiceEntries[deprecatedClassName] = generatedService;
    }
  } catch (error) {
    throw new Error("Error thrown generating service '" + id + "' (" + definition.DefaultDescription + "): " + error.message);
  }
}

for (const [id, generated] of ServiceManualAdditions) {
  generatedServices[id] = generated;
  writtenServiceEntries[generated.className] = generated;
  if (generated.deprecatedClassName) {
    writtenServiceEntries[generated.deprecatedClassName] = generated;
  }
}

for (const generated of Object.values(generatedServices)
  .sort((a, b) => a.className.localeCompare(b.className))) {
  try {
    serviceOutput.write("/**\n");
    serviceOutput.write(" * Service \"" + generated.name + "\"\n");
    if (generated.since) {
      serviceOutput.write(" * @since iOS " + generated.since + "\n");
    }
    if (generated.deprecatedNotice) {
      serviceOutput.write(" * @deprecated " + generated.deprecatedNotice + "\n");
    }
    serviceOutput.write(" */\n");

    serviceOutput.write("export class " + generated.className + " extends Service {\n\n");

    serviceOutput.write("  public static readonly UUID: string = \"" + generated.UUID + "\";\n\n");

    serviceOutput.write("  constructor(displayName?: string, subtype?: string) {\n");
    serviceOutput.write("    super(displayName, " + generated.className + ".UUID, subtype);\n\n");

    serviceOutput.write("    // Required Characteristics\n");
    for (const required of generated.requiredCharacteristics) {
      const characteristic = generatedCharacteristics[required];
      if (!characteristic) {
        console.warn("Could not find required characteristic " + required + " for " + generated.className);
        continue;
      }

      if (required === "name") {
        serviceOutput.write("    if (!this.testCharacteristic(Characteristic.Name)) { // workaround for Name characteristic collision in constructor\n");
        serviceOutput.write("      this.addCharacteristic(Characteristic.Name).updateValue(\"Unnamed Service\");\n");
        serviceOutput.write("    }\n");
      } else {
        serviceOutput.write("    this.addCharacteristic(Characteristic." + characteristic.className + ");\n");
      }
    }

    if (generated.optionalCharacteristics?.length) {
      serviceOutput.write("\n    // Optional Characteristics\n");
      for (const optional of generated.optionalCharacteristics) {
        const characteristic = generatedCharacteristics[optional];
        if (!characteristic) {
          console.warn("Could not find optional characteristic " + optional + " for " + generated.className);
          continue;
        }
        serviceOutput.write("    this.addOptionalCharacteristic(Characteristic." + characteristic.className + ");\n");
      }
    }

    serviceOutput.write("  }\n}\n");
    if (generated.deprecatedClassName) {
      serviceOutput.write("// noinspection JSDeprecatedSymbols\n");
      serviceOutput.write("Service." + generated.deprecatedClassName + " = " + generated.className + ";\n");
    }
    if (generated.deprecatedNotice) {
      serviceOutput.write("// noinspection JSDeprecatedSymbols\n");
    }
    serviceOutput.write("Service." + generated.className + " = " + generated.className + ";\n\n");
  } catch (error) {
    throw new Error("Error thrown writing service '" + generated.id + "' (" + generated.className + "): " + error.message);
  }
}

serviceOutput.end();


const serviceProperties = Object.entries(writtenServiceEntries).sort(([a], [b]) => a.localeCompare(b));
rewriteProperties("Service", serviceProperties);
writeServicesTestFile();

// ------------------------ utils ------------------------
function checkDefined<T>(input: T): T {
  if (!input) {
    throw new Error("value is undefined!");
  }

  return input;
}

function characteristicFormat(format: string): string {
  // @ts-expect-error
  for (const [key, value] of Object.entries(Formats)) {
    if (value === format) {
      return key;
    }
  }

  throw new Error("Unknown characteristic format '" + format + "'");
}

function characteristicUnit(unit: string): string {
  // @ts-expect-error
  for (const [key, value] of Object.entries(Units)) {
    if (value === unit) {
      return key;
    }
  }

  throw new Error("Unknown characteristic format '" + unit + "'");
}

function characteristicAccess(access: number): string {
  // @ts-expect-error
  for (const [key, value] of Object.entries(Access)) {
    if (value === access) {
      return key;
    }
  }

  throw new Error("Unknown access for '" + access + "'");
}

function characteristicPerm(id: string): string | undefined {
  switch (id) {
    case "aa":
      return "ADDITIONAL_AUTHORIZATION";
    case "hidden":
      return "HIDDEN";
    case "notify":
      return "NOTIFY";
    case "read":
      return "PAIRED_READ";
    case "timedWrite":
      return "TIMED_WRITE";
    case "write":
      return "PAIRED_WRITE";
    case "writeResponse":
      return "WRITE_RESPONSE";
    case "broadcast": // used for bluetooth
      return undefined;
    case "adminOnly":
      return undefined // TODO add support for it (currently unused though)
    default:
      throw new Error("Received unknown perms id: " + id);
  }
}

function generatePermsString(id: string, propertiesBitMap: number): string {
  const perms: string [] = [];

  for (const [bitMap, name] of properties) {
    if (name === "ADDITIONAL_AUTHORIZATION") {
      // aa set by homed just signals that aa may be supported. Setting up aa will always require a custom made app though
      continue;
    }
    if ((propertiesBitMap | bitMap) === propertiesBitMap) { // if it stays the same the bit is set
      perms.push("Perms." + name);
    }
  }

  const result =  perms.join(", ");
  assert(result != "", "perms string cannot be empty (" + propertiesBitMap + ")");
  return result;
}

function checkWrittenVersion(filePath: string, parsingVersion: number): boolean {
  filePath = path.resolve(__dirname, filePath);

  const content = fs.readFileSync(filePath, { encoding: "utf8" }).split("\n", 3);
  const v = content[1];
  if (!v.startsWith("// V=")) {
    throw new Error("Could not detect definition version for '" + filePath + "'");
  }

  const version = parseInt(v.replace("// V=", ""), 10);
  return parsingVersion >= version;
}

function rewriteProperties(className: string, properties: [key: string, value: GeneratedCharacteristic | GeneratedService][]): void {
  const filePath = path.resolve(__dirname, "../" + className + ".ts");
  if (!fs.existsSync(filePath)) {
    throw new Error("File '" + filePath + "' does not exist!");
  }

  const file = fs.readFileSync(filePath, { encoding: "utf8"});
  const lines = file.split("\n");

  let i = 0;

  let importStart = -1;
  let importEnd = -1;
  let foundImport = false;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === "import {") {
      importStart = i; // save last import start;
    } else if (line === "} from \"./definitions\";") {
      importEnd = i;
      foundImport = true;
      break;
    }
  }
  if (!foundImport) {
    throw new Error("Could not find import section!");
  }

  let startIndex = -1;
  let stopIndex = -1;

  for (; i < lines.length; i++) {
    if (lines[i] === "  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-") {
      startIndex = i;
      break;
    }
  }
  if (startIndex === -1) {
    throw new Error("Could not find start pattern in file!");
  }
  for (; i < lines.length; i++) {
    if (lines[i] === "  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=") {
      stopIndex = i;
      break;
    }
  }
  if (stopIndex === -1) {
    throw new Error("Could not find stop pattern in file!");
  }

  const importSize = importEnd - importStart - 1;
  const newImports = properties
    .filter(([key, value]) => key === value.className)
    .map(([key]) => "  " + key + ",");
  lines.splice(importStart + 1, importSize, ...newImports); // remove current imports

  const importDelta = newImports.length - importSize;

  startIndex += importDelta;
  stopIndex += importDelta;

  const amount = stopIndex - startIndex - 1;
  const newContentLines = properties.map(([key, value]) => {
    let line = "";

    let deprecatedNotice = value.deprecatedNotice;

    if (key !== value.className) {
      deprecatedNotice = "Please use {@link " + className + "." + value.className + "}." // prepend deprecated notice
        + (deprecatedNotice? " " + deprecatedNotice: "");
    }
    if (deprecatedNotice) {
      line += "  /**\n";
      line += "   * @deprecated " + deprecatedNotice + "\n";
      line += "   */\n";
    }

    line += "  public static " + key + ": typeof " + value.className + ";";
    return line;
  });
  lines.splice(startIndex + 1, amount, ...newContentLines); // insert new lines

  const resultContent = lines.join("\n");
  fs.writeFileSync(filePath, resultContent, { encoding: "utf8" });
}

function writeCharacteristicTestFile(): void {
  const characteristics = Object.values(generatedCharacteristics).sort((a, b) => a.className.localeCompare(b.className));

  const testOutput = fs.createWriteStream(path.resolve(__dirname, "./CharacteristicDefinitions.spec.ts"), { encoding: "utf8" });
  testOutput.write("// THIS FILE IS AUTO-GENERATED - DO NOT MODIFY\n");
  testOutput.write("import \"./\";\n\n");
  testOutput.write("import { Characteristic } from \"../Characteristic\";\n\n");
  testOutput.write("describe(\"CharacteristicDefinitions\", () => {");

  for (const generated of characteristics) {
    testOutput.write("\n");
    testOutput.write("  describe(\"" + generated.className + "\", () => {\n");

    // first test is just calling the constructor
    testOutput.write("    it(\"should be able to construct\", () => {\n");
    testOutput.write("      new Characteristic." + generated.className + "();\n");
    if (generated.deprecatedClassName) {
      testOutput.write("      // noinspection JSDeprecatedSymbols\n");
      testOutput.write("      new Characteristic." + generated.deprecatedClassName + "();\n");
    }
    testOutput.write("    });\n");

    testOutput.write("  });\n");
  }

  testOutput.write("});\n");
  testOutput.end();
}

function writeServicesTestFile(): void {
  const services = Object.values(generatedServices).sort((a, b) => a.className.localeCompare(b.className));

  const testOutput = fs.createWriteStream(path.resolve(__dirname, "./ServiceDefinitions.spec.ts"), { encoding: "utf8" });
  testOutput.write("// THIS FILE IS AUTO-GENERATED - DO NOT MODIFY\n");
  testOutput.write("import \"./\";\n\n");
  testOutput.write("import { Characteristic } from \"../Characteristic\";\n");
  testOutput.write("import { Service } from \"../Service\";\n\n");
  testOutput.write("describe(\"ServiceDefinitions\", () => {");

  for (const generated of services) {
    testOutput.write("\n");
    testOutput.write("  describe(\"" + generated.className + "\", () => {\n");

    // first test is just calling the constructor
    testOutput.write("    it(\"should be able to construct\", () => {\n");

    testOutput.write("      const service0 = new Service." + generated.className + "();\n");
    testOutput.write("      const service1 = new Service." + generated.className + "(\"test name\");\n");
    testOutput.write("      const service2 = new Service." + generated.className + "(\"test name\", \"test sub type\");\n\n");

    testOutput.write("      expect(service0.displayName).toBe(\"\");\n");
    testOutput.write("      expect(service0.testCharacteristic(Characteristic.Name)).toBe(" + generated.requiredCharacteristics.includes("name") + ");\n");
    testOutput.write("      expect(service0.subtype).toBeUndefined();\n\n");

    testOutput.write("      expect(service1.displayName).toBe(\"test name\");\n");
    testOutput.write("      expect(service1.testCharacteristic(Characteristic.Name)).toBe(true);\n");
    testOutput.write("      expect(service1.getCharacteristic(Characteristic.Name).value).toBe(\"test name\");\n");
    testOutput.write("      expect(service1.subtype).toBeUndefined();\n\n");

    testOutput.write("      expect(service2.displayName).toBe(\"test name\");\n");
    testOutput.write("      expect(service2.testCharacteristic(Characteristic.Name)).toBe(true);\n");
    testOutput.write("      expect(service2.getCharacteristic(Characteristic.Name).value).toBe(\"test name\");\n");
    testOutput.write("      expect(service2.subtype).toBe(\"test sub type\");\n");

    if (generated.deprecatedClassName) {
      testOutput.write("      // noinspection JSDeprecatedSymbols\n");
      testOutput.write("\n      new Service." + generated.deprecatedClassName + "();\n");
    }

    testOutput.write("    });\n");

    testOutput.write("  });\n");
  }

  testOutput.write("});\n");
  testOutput.end();
}
