# Unifi Protect Plugin for Scrypted

The Unifi Protect Plugin connects your Unifi Cameras to Scrypted.

## Connection modes

The plugin supports two connection modes:

### Local User (default)

Uses a Protect local user account against the private Protect API. This provides the full feature set (cameras, lights, sensors, locks, two-way audio, privacy masks, dynamic bitrate, etc.).

Requirements:
* The Protect appliance such as a Cloud Key or Dream Machine
* Protect user account with **Local Administrator** permissions. **NOTE**: This may be downgraded to Read Only under certain situations (see `Troubleshooting`)
   * Two Factor Authentication will not work.
   * A local account is recommended in case the Ubiquiti SSO service goes down.

### API Key Only

Uses a UniFi OS Integration API key with no local user account — the same approach Home Assistant added for UniFi Protect. Authentication is via the `X-API-KEY` header against Protect's public Integration API.

Create a key in the UniFi OS local portal: **Settings → Control Plane → Integrations**.

API Key Only currently supports:
* Cameras (RTSPS streams, snapshots, motion/smart detections, doorbell ring, status LED)
* Lights (on/off, brightness, motion)

Not available in API Key Only mode (use Local User instead):
* Sensors and locks
* Two-way audio / intercom
* Privacy masks and dynamic bitrate
* Optical zoom and fingerprint sensors
* Package camera snapshots

# Troubleshooting
A Scrypted or Unifi Protect update or change may have occurred.
For troubleshooting with Local User mode, ensure user account permission is **Administrator** in Protect application.

Administrator permissions is **required** in the following instances:
* Initial Unifi device setup (i.e., if you're (re-)adding a new device)
* `Camera Status Indicator` Scrypted feature is enabled
* `Dynamic Bitrate` Scrypted feature is enabled
