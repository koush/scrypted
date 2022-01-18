# RTSP Cameras and Streams Plugin

## npm commands
 * npm run scrypted-webpack
 * npm run scrypted-deploy <ipaddress>
 * npm run scrypted-debug <ipaddress>

## scrypted distribution via npm
 1. Ensure package.json is set up properly for publishing on npm.
 2. npm publish

## Visual Studio Code configuration

* If using a remote server, edit [.vscode/settings.json](blob/master/.vscode/settings.json) to specify the IP Address of the Scrypted server.
* Launch Scrypted Debugger from the launch menu.

# Setup and Configuration
 
 1. Once the plugin is installed, click "Add a device" and give the RTSP Camera a name.
 
 2. Then under "Settings" and then "General", type in the username and password for your RTSP Stream. Click the green arrow to save the changes.
 
 3. Then add the RTSP Stream Link.
 
  ie: rtsp://<ip-address>:<port>/<channel>/<mode>
 
  *Please note that RTSP Streams differ between each camera make and model.*

  If your camera has support for a substream, click the "Add" button to add another RTSP Stream URL.
 
 4. Once you are done, Click "Save RTSP Stream URL"
 
 Enable "No Audio" if the camera does not have audio or if you want to mute audio.
 
