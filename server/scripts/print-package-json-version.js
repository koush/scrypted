async function main() {
    const response = await fetch('https://registry.npmjs.org/@scrypted/server');
    const json = await response.json();
    console.log(json['dist-tags'].latest);
    // const packageJson = require('../package.json');
    // console.log(packageJson.version);
}

main();
