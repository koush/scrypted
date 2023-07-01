# Mail Server (SMTP) Triggers for Scrypted

The SMTP plugin can be used to create email address that can be used to turn Scrypted devices on and off when it receives mail.

This plugin is typically used in conjuction with the Dummy Switch plugin, and a camera that can send mail on motion.

1. Use the Dummy Switch Plygin to create a Dummy Switch activated motion sensor.
2. Enable SMTP/Mail on the Dummy Switch and set up the inbox.
3. Configure the camera to send mail to that mail address ie, camera@server-ip.
