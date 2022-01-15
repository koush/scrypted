# Google Device Access Plugin for Scrypted

The Google Device Access Plugin allows you to import and control your Nest and Google devices from Scrypted.

## Setup

### Scrypted Cloud

Scrypted Cloud must be installed so Google can push device status changes to the plugin.

1. Install the Scrypted Cloud plugin (@scrypted/cloud).
2. Log in to Scrypted Cloud.

### Google Account Creation

Follow steps at the link below to create your personal Google Device Access developer account Google Cloud developer account:

* Google Device Access Project aka GDA ($5)
* Google Cloud Project aka GCP (might be within the free tier)
https://developers.google.com/nest/device-access/get-started

### Google Cloud Setup
1. Create a API & Services -> Credentials -> Create Credentials -> OAuth 2.0 -> WebApplication with the following redirect URIs:
```
https://home.scrypted.app/web/oauth/callback
https://www.google.com
```
2. Open the API Dashboard -> Enable Cloud Pub/Sub. You will come back to this again below.

### Google Device Access Setup
1. Create the project.
2. Add the GCP client id.
3. Note the pub/sub topic.

### Scrypted Plugin Setup
1. Enter the GDA project id, GCP client id, and GCP secret.
2. Login.
3. Note the pubsub url.

### Google Cloud PubSub Setup

Create a pubsub *push* subscription and configure it using the previously noted GDA topic and Scrypted pubsub url.
