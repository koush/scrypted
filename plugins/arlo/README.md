# Arlo Plugin for Scrypted

The Arlo Plugin connects Scrypted to Arlo Cloud, allowing you to access all of your Arlo cameras in Scrypted.

It is highly recommended to create a dedicated Arlo account for use with this plugin and share your cameras from your main account, as Arlo only permits one active login to their servers per account. Using a separate account allows you to use the Arlo app or website simultaneously with this plugin, otherwise logging in from one place will log you out from all other devices.

The account you use for this plugin must have either SMS or email set as the default 2FA option. Once you enter your username and password on the plugin settings page, you should receive a 2FA code through your default 2FA option. Enter that code into the provided box, and your cameras will appear in Scrypted. Or, see below for configuring IMAP to auto-login with 2FA.

If you experience any trouble logging in, clear the username and password boxes, reload the plugin, and try again.

If you are unable to see shared cameras in your separate Arlo account, ensure that both your primary and secondary accounts are upgraded according to this [forum post](https://web.archive.org/web/20230710141914/https://community.arlo.com/t5/Arlo-Secure/Invited-friend-cannot-see-devices-on-their-dashboard-Arlo-Pro-2/m-p/1889396#M1813). Verify the sharing worked by logging in via the Arlo web dashboard.

**If you add or remove cameras from your main Arlo account, or share/un-share/re-share cameras with the Arlo account used with this plugin, ensure that you reload this plugin to get the updated camera state from Arlo Cloud.**

## General Setup Notes

* Ensure that your Arlo account's default 2FA option is set to either SMS or email.
* Motion events notifications should be turned on in the Arlo app. If you are receiving motion push notifications, Scrypted will also receive motion events.
* Disable smart detection and any cloud/local recording in the Arlo app. Arlo Cloud only permits one active stream per camera, so any smart detection or recording features may prevent downstream plugins (e.g. Homekit) from successfully pulling the video feed after a motion event.
* It is highly recommended to enable the Rebroadcast plugin to allow multiple downstream plugins to pull the video feed within Scrypted.
* If there is no audio on your camera, switch to the `FFmpeg (TCP)` parser under the `Cloud RTSP` settings.
* Prebuffering should only be enabled if the camera is wired to a persistent power source, such as a wall outlet. Prebuffering will only work if your camera does not have a battery or `Plugged In to External Power` is selected.
* The plugin supports pulling RTSP or DASH streams from Arlo Cloud. It is recommended to use RTSP for the lowest latency streams. DASH is inconsistent in reliability, and may return finicky codecs that require additional FFmpeg output arguments, e.g. `-vcodec h264`. *Note that both RTSP and DASH will ultimately pull the same video stream feed from your camera, and they cannot both be used at the same time due to the single stream limitation.*

Note that streaming cameras uses extra Internet bandwidth, since video and audio packets will need to travel from the camera through your network, out to Arlo Cloud, and then back to your network and into Scrypted.

## IMAP 2FA

The Arlo Plugin supports using the IMAP protocol to check an email mailbox for Arlo 2FA codes. This requires you to specify an email 2FA option as the default in your Arlo account settings.

The plugin should work with any mailbox that supports IMAP, but so far has been tested with Gmail. To configure a Gmail mailbox, see [here](https://support.google.com/mail/answer/7126229?hl=en) to see the Gmail IMAP settings, and [here](https://support.google.com/accounts/answer/185833?hl=en) to create an App Password. Enter the App Password in place of your normal Gmail password.

The plugin searches for emails sent by Arlo's `do_not_reply@arlo.com` address when looking for 2FA codes. If you are using a service to forward emails to the mailbox registered with this plugin (e.g. a service like iCloud's Hide My Email), it is possible that Arlo's email sender address has been overwritten by the mail forwarder. Check the email registered with this plugin to see what address the mail forwarder uses to replace Arlo's sender address, and update that in the IMAP 2FA settings.

## Virtual Security System for Arlo Sirens

In external integrations like Homekit, sirens are exposed as simple on-off switches. This makes it easy to accidentally hit the switch when using the Home app. The Arlo Plugin creates a "virtual" security system device per siren to allow Scrypted to arm or disarm the siren switch to protect against accidental triggers. This fake security system device will be synced into Homekit as a separate accessory from the camera, with the siren itself merged into the security system accessory.

Note that the virtual security system is NOT tied to your Arlo account at all, and will not make any changes such as switching your device's motion alert armed/disarmed modes. For more information, please see the README on the virtual security system device in Scrypted.

## Video Clips

The Arlo Plugin will show video clips available in Arlo Cloud for cameras with cloud recording enabled. These clips are not downloaded onto your Scrypted server, but rather streamed on-demand. Deleting clips is not available in Scrypted and should be done through the Arlo app or the Arlo web dashboard.