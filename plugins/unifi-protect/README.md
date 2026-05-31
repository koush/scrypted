# Unifi Protect Plugin for Scrypted

The Unifi Protect Plugin connects your Unifi Cameras to Scrypted. 

## Requirements
* The Protect appliance such as a Cloud Key or Dream Machine
* Protect user account with **Local Administrator** permissions. **NOTE**: This may be downgraded to Read Only under certain situations (see `Troubleshooting`)
   * Two Factor Authentication will not work.
   * A local account is recommended in case the Ubiquiti SSO service goes down.

# Troubleshooting
A Scypted or Unifi Protect update or change may have occurred.
For troubleshooting, ensure user account permission is **Administrator** in Protect application.

Administrator permissions is **required** in the following instances:
* Initial Unifi device setup (i.e., if you're (re-)adding a new device)
* `Camera Status Indicator` Scrypted feature is enabled
* `Dynamic Bitrate` Scrypted feature is enabled
