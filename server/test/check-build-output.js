const fs = require('fs');
const path = require('path');

const check = path.join(__dirname, '../dist/scrypted-main.js');
if (!fs.existsSync(check)) {
    throw new Error('missing file ' + check);
}
