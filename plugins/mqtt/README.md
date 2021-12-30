# MQTT Plugin for Scrypted

The MQTT Plugin can be used as both an MQTT Broker and or as an MQTT Client.

The MQTT Client for Scrypted can be both a MQTT publisher and a subscriber:
 * Devices published from Scrypted will report their state and events to the MQTT Broker.
 * MQTT topics subscribed by Scrypted can be used to import devices into Scrypted.

This plugin includes the Aedes MQTT Broker.