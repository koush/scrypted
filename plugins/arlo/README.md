# Arlo Plugin for Scrypted

The Arlo Plugin connects Scrypted to Arlo Cloud, allowing you to access all of your Arlo cameras in Scrypted.

It is highly recommended to create a dedicated Arlo account for use with this plugin and share your cameras from your main account, as Arlo only permits one active login to their servers per account. Using a separate account allows you to use the Arlo app or website simultaneously with this plugin, otherwise logging in from one place will log you out from all other devices.

The account you use for this plugin must have either SMS or email set as the default 2FA option. Once you enter your username and password on the plugin settings page, you should receive a 2FA code through your default 2FA option. Enter that code into the provided box, and your cameras will appear in Scrypted. Or, see below for configuring IMAP to auto-login with 2FA.

If you experience any trouble logging in, clear the username and password boxes, reload the plugin, and try again.

## General Setup Notes

* Ensure that your Arlo account's default 2FA option is set to either SMS or email.
* Motion events notifications should be turned on in the Arlo app. If you are receiving motion push notifications, Scrypted will also receive motion events.
* Disable smart detection and any cloud/local recording in the Arlo app. Arlo Cloud only permits one active stream per camera, so any smart detection or recording features may prevent downstream plugins (e.g. Homekit) from successfully pulling the video feed after a motion event.
* It is highly recommended to enable the Rebroadcast plugin to allow multiple downstream plugins to pull the video feed within Scrypted.
* If there is no audio on your camera, switch to the `FFmpeg (TCP)` parser under the `Cloud RTSP` settings.
* Prebuffering should only be enabled if the camera is wired to a persistent power source, such as a wall outlet. Prebuffering will only work if your camera does not have a battery or `Plugged In to External Power` is selected.
* The plugin supports pulling RTSP or DASH streams from Arlo Cloud. It is recommended to use RTSP for the lowest latency streams. DASH is inconsistent in reliability, and may return finicky codecs that require additional FFmpeg output arguments, e.g. `-vcodec h264`.

Note that streaming cameras uses extra Internet bandwidth, since video and audio packets will need to travel from the camera through your network, out to Arlo Cloud, and then back to your network and into Scrypted.

## IMAP 2FA

The Arlo Plugin supports using the IMAP protocol to check an email mailbox for Arlo 2FA codes. This requires you to specify an email 2FA option as the default in your Arlo account settings.

The plugin should work with any mailbox that supports IMAP, but so far has been tested with Gmail. To configure a Gmail mailbox, see [here](https://support.google.com/mail/answer/7126229?hl=en) to see the Gmail IMAP settings, and [here](https://support.google.com/accounts/answer/185833?hl=en) to create an App Password. Enter the App Password in place of your normal Gmail password.

## Video Clips

The Arlo Plugin will show video clips available in Arlo Cloud for cameras with cloud recording enabled. These clips are not downloaded onto your Scrypted server, but rather streamed on-demand. Deleting clips is not available in Scrypted and should be done through the Arlo app or the Arlo web dashboard.