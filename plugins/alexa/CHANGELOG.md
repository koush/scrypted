<details>
<summary>Changelog</summary>

### 0.3.6

alexa: maybe fix alexa when no detection types are available


### 0.3.4

Alexa: add option to not auto enable devices (#1615)


### 0.3.3

google-home/alexa: republish with new sdk for media converter


### 0.3.2

alexa: fix syncedDevices being undefined


### 0.3.1

alexa/google-home: fix potential vulnerability. do not allow local network control using cloud tokens belonging to a different user. the plugins are now locked to a specific scrypted cloud account once paired.


### 0.3.0

alexa/google-home: additional auth token checks to harden endpoints for cloud sharing
alexa: removed unneeded packages (#1319)
alexa: added support for `light`, `outlet`, and `fan` device types (#1318)


### 0.2.10

alexa: fix potential response race


### 0.2.9

alexa: fix race condition in sendResponse


### 0.2.8

alexa: display camera on doorbell press (#1066)


### 0.2.7

alexa: added helpful error messages regarding token expiration (#1007)


### 0.2.6

alexa: fix doorbells


### 0.2.5

alexa: publish w/ storage fix


### 0.2.4

alexa: add setting to publish debug events to console (#685)


### 0.2.3

webrtc/alexa: add option to disable TURN on peers that already have externally reachable addresses


### 0.2.1

alexa: set screen ratio to 720p (#625)


### 0.2.0

alexa: refactor code structure (#606)


### 0.1.0

alexa: ensure we are talking to the correct API endpoint (#580)


### 0.0.20

alexa: provide hint that medium resolution is always used.


### 0.0.19

various: minor cleanups
alexa: added logging around `tokenInfo` resets (#488)
sdk: rename sdk.version to sdk.serverVersion
plugins: update tsconfig.json
alexa: publish beta


### 0.0.18

alexa: rethrow login failure error
added support for type `Garage` and refactored the controller for future support (#479)
updated install instructions (#478)
webrtc/alexa: fix race condition with intercoms and track not received yet.


### 0.0.17

alexa: close potential security hole if scrypted is exposed to the internet directly (ie, user is not using the cloud plugin against recommendations)


### 0.0.16

plugins: remove postinstall
plugins: add tsconfig.json
alexa: doorbell motion sensor support


### 0.0.15

alexa: fix harmless crash in log


### 0.0.14

alexa: fix empty endpoint list


### 0.0.13

all: prune package.json
alexa: fix doorbell syncing


### 0.0.12

alexa: publish


### 0.0.10

alexa: 2 way audio


### 0.0.4

alexa: 2 way audio
alexa: motion events


### 0.0.3

webrtc: refactor
alexa: use rtc signaling channel
alexa: publish


### 0.0.1

alexa: doorbells
alexa: sync devices properly
alexa: add camera/doorbell, fix webrtc to work with amazon reqs
alexa: initial pass with working cameras
cloud: stub out alexa


</details>
