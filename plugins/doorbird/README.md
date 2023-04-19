# Doorbird Plugin for Scrypted

The Doorbird Plugin bridges compatible Doorbird video doorbell cameras to Scrypted.

# Notes
* Make sure that the user you want to use for the Doorbird plugin login has the API access rights.
* Doorbrid cameras are quite limited in terms of maximum number of concurrent streams. Keep this in mind if you are also using other software with the Doorbird station. You have the possibility to override the internally used RTSP URL and provide another RTSP server which provides the video stream.
* The doorbird mobile apps always have precedence over the public LAN API. So when somebody uses the Doorbird app to talk to the Doorbird station, the streams will be interrupted.
* The doorbird camera just provides JPEG snapshots with VGA resolution. You can use the scrypted snapshot plugin to get a snapshot from the higher resolution video stream. Just set the option in the snapshot plugin to "enabled".
