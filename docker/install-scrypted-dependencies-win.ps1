# Install Chocolatey
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))

# Install node.js
choco upgrade -y nodejs-lts --version=18.13.0

# Install Node.js additional tools for Windows to compile native modules
# https://github.com/nodejs/node/blob/main/tools/msvs/install_tools/install_tools.bat#L55
choco upgrade -y python visualstudio2019-workload-vctools

# Refresh environment variables for py and npx to work
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") 

py -m pip install --upgrade pip
py -m pip install aiofiles debugpy typing_extensions typing opencv-python

npx -y scrypted@latest install-server

$USER_HOME_ESCAPED = $env:USERPROFILE.replace('\', '\\')
$SCRYPTED_HOME = $env:USERPROFILE + '\.scrypted'
$SCRYPTED_HOME_ESCAPED_PATH = $SCRYPTED_HOME.replace('\', '\\')
npm install --prefix $SCRYPTED_HOME node-windows@1.0.0-beta.8 --save

$SERVICE_JS = @"
const fs = require('fs');
try {
  fs.mkdirSync('C:\\WINDOWS\\system32\\config\\systemprofile\\AppData\\Roaming\\npm');
}
catch (e) {
}
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
svc.on('install', () => {
  console.log("Service installed");
});
svc.install();
"@

$INSTALL_SERVICE_JS_PATH = $SCRYPTED_HOME + '\install-service.js'
$INSTALL_SERVICE_JS | Out-File -Encoding ASCII -FilePath $INSTALL_SERVICE_JS_PATH

node $INSTALL_SERVICE_JS_PATH

# Manually start service, node-windows has issues starting service
sc start scrypted.exe

Write-Output "Scrypted is now running at: https://localhost:10443/"
Write-Output "Note that it is https and that you'll be asked to approve/ignore the website certificate."
