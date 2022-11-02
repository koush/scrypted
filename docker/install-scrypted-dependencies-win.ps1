winget install -h OpenJS.NodeJS
winget install -h "Python 3.10"

py -m pip install --upgrade pip
py -m pip install aiofiles debugpy typing_extensions typing opencv-python

npx -y scrypted@latest install-server

$USER_HOME_ESCAPED = $env:USERPROFILE.replace('\', '\\')
$SCRYPTED_HOME = $env:USERPROFILE + '\.scrypted'
$SCRYPTED_HOME_ESCAPED_PATH = $SCRYPTED_HOME.replace('\', '\\')
npm install --prefix $SCRYPTED_HOME node-windows@1.0.0-beta.6 --save

$SERVICE_JS = @"
const child_process = require('child_process');
child_process.spawn('npx.cmd', ['-y', 'scrypted', 'serve'], {
    stdio: 'inherit',
});
"@

$SERVICE_JS_PATH = $SCRYPTED_HOME + '\service.js'
$SERVICE_JS_ESCAPED_PATH = $SERVICE_JS_PATH.replace('\', '\\')
$SERVICE_JS | Out-File -Encoding ASCII -FilePath $SERVICE_JS_PATH

$INSTALL_SERVICE_JS = @"
var Service = require('node-windows').Service;

var svc = new Service({
  name: 'Scrypted',
  description: 'Scrypted Home Automation',
  script: '$($SERVICE_JS_ESCAPED_PATH)',
  env: [
    {
      name: "USERPROFILE",
      value: '$($USER_HOME_ESCAPED)'
    },
  ]
});

svc.on('alreadyuninstalled', () => {
  svc.install();
});

svc.on('uninstall', () => {
  svc.install();
});

svc.on('error', () => {
  svc.install();
});

svc.on('install', () => {
  svc.start();
});

svc.uninstall();
"@

$INSTALL_SERVICE_JS_PATH = $SCRYPTED_HOME + '\install-service.js'
$INSTALL_SERVICE_JS | Out-File -Encoding ASCII -FilePath $INSTALL_SERVICE_JS_PATH

node $INSTALL_SERVICE_JS_PATH

Write-Output "Scrypted is now running at: https://localhost:10443/"
Write-Output "Note that it is https and that you'll be asked to approve/ignore the website certificate."
