# Unifi Protect Plugin for Scrypted

The Unifi Protect Plugin connects your Unifi Cameras to Scrypted. 

## Requirements
* The Protect appliance such as a Cloud Key or Dream Machine
* Protect user account with **Administrator** permissions. **NOTE**: This may be downgraded to Read Only under certain situations (see `Troubleshooting`)

# Troubleshooting
A Scypted or Unifi Protect update or change may have occurred.
For troubleshooting, ensure user account permission is **Administrator** in Protect application.

Administrator permissions is **required** in the following instances:
* Initial Unifi device setup (i.e., if you're (re-)adding a new device)
* `Camera Status Indicator` Scrypted feature is enabled
* `Dynamic Bitrate` Scrypted feature is enabled

## Unifi Beta 1.21.0-beta.3
This beta has a bug in it that causes HomeKit Secure Video recordings to fail. Please roll back to a prior or stable release, and flag [this issue](https://community.ui.com/releases/UniFi-Protect-Application-1-21-0-beta-3/32c7bb7a-697d-4841-8b9f-eef49b8682e9#comment/ad1c2710-2451-4612-847f-6413eb8ec0db).

