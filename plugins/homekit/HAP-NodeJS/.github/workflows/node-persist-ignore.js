/**
 * This script tried to solve the problem of having types collisions of node-persist types.
 */

const path = require("path");
const fs = require("fs");

const storageDefinition = "./dist/lib/model/HAPStorage.d.ts";
const resolved = path.resolve(storageDefinition);

if (!fs.existsSync(resolved)) {
  throw new Error("Tried to update definition but could not find HAPStorage.d.ts!");
}

const rows = fs.readFileSync(resolved, "utf8").split("\n");
rows.unshift("// @ts-ignore");

fs.writeFileSync(resolved, rows.join("\n"));
