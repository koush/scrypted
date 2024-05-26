# Set-PSDebug -Trace 1

# stop existing service if any
sc.exe stop scrypted.exe

# Install Chocolatey
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))

# Install node.js
choco upgrade -y nodejs-lts --version=20.11.1

# Install VC Redist, which is necessary for portable python
choco install -y vcredist140

# TODO: remove python install, and use portable python
# Install Python
choco upgrade -y python39
# Run py.exe with a specific version
$SCRYPTED_WINDOWS_PYTHON_VERSION="-3.9"

# Refresh environment variables for py and npx to work
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User") 


py $SCRYPTED_WINDOWS_PYTHON_VERSION -m pip install --upgrade pip
py $SCRYPTED_WINDOWS_PYTHON_VERSION -m pip install debugpy typing_extensions typing opencv-python

$SCRYPTED_INSTALL_VERSION=[System.Environment]::GetEnvironmentVariable("SCRYPTED_INSTALL_VERSION","User")
if ($SCRYPTED_INSTALL_VERSION -eq $null) {
  npx -y scrypted@latest install-server
} else {
  npx -y scrypted@latest install-server $SCRYPTED_INSTALL_VERSION 
}

$USER_HOME_ESCAPED = $env:USERPROFILE.replace('\', '\\')
$SCRYPTED_HOME = $env:USERPROFILE + '\.scrypted'
$SCRYPTED_HOME_ESCAPED_PATH = $SCRYPTED_HOME.replace('\', '\\')
npm install --prefix $SCRYPTED_HOME @koush/node-windows --save

$NPX_PATH = (Get-Command npx).Path
# The path needs double quotes to handle spaces in the directory path
$NPX_PATH_ESCAPED = '"' + $NPX_PATH.replace('\', '\\') + '"'

$SERVICE_JS = @"
const fs = require('fs');
try {
  fs.mkdirSync('C:\\WINDOWS\\system32\\config\\systemprofile\\AppData\\Roaming\\npm');
}
catch (e) {
}
const child_process = require('child_process');
child_process.spawn('$NPX_PATH_ESCAPED', ['-y', 'scrypted', 'serve'], {
    stdio: 'inherit',
    // allow spawning .cmd https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
    shell: true,
});
"@

$SERVICE_JS_PATH = $SCRYPTED_HOME + '\service.js'
$SERVICE_JS_ESCAPED_PATH = $SERVICE_JS_PATH.replace('\', '\\')
$SERVICE_JS | Out-File -Encoding ASCII -FilePath $SERVICE_JS_PATH

$INSTALL_SERVICE_JS = @"
const Service = require('@koush/node-windows').Service;
const svc = new Service({
  name: 'Scrypted',
  description: 'Scrypted Home Automation',
  script: '$($SERVICE_JS_ESCAPED_PATH)',
  env: [
    {
      name: "USERPROFILE",
      value: '$($USER_HOME_ESCAPED)'
    },
    {
      name: "SCRYPTED_WINDOWS_PYTHON_VERSION",
      value: '$($SCRYPTED_WINDOWS_PYTHON_VERSION)'
    }
  ]
});
svc.on('alreadyinstalled', () => {
   console.log('Service already installed, uninstalling first');
   // wait 5 seconds after uninstalling before deleting daemon to prevent unlink error
   svc.uninstall(5);
});
svc.on('uninstall', () => {
   console.log('Service uninstalled, reinstalling');
   svc.install();
});
svc.on("install", () => {
   console.log("Service installed");
   // wait 5 seconds for install to actually complete before attempting to start
   // https://github.com/coreybutler/node-windows/issues/318#issuecomment-1232801990
   setTimeout(() => {
     console.log("Starting service");
     svc.start();
   }, 5000);
});
svc.on("start", () => {
  console.log("Service started");
});
svc.install();
"@

$INSTALL_SERVICE_JS_PATH = $SCRYPTED_HOME + '\install-service.js'
$INSTALL_SERVICE_JS | Out-File -Encoding ASCII -FilePath $INSTALL_SERVICE_JS_PATH

node $INSTALL_SERVICE_JS_PATH
del $INSTALL_SERVICE_JS_PATH

Write-Output "Scrypted is now running at: https://localhost:10443/"
Write-Output "Note that it is https and that you'll be asked to approve/ignore the website certificate."
