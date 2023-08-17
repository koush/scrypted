# Cloud Access Plugin for Scrypted

1. Log into Scrypted Cloud using the login button.
2. This Scrypted server is now available at https://home.scrypted.app.

See below for additional recommendations.

## Port Forwarding

1. Open the Firewall and Port Forwarding Settings on the network's router.
2. Use the ports shown in Settings to configure a Port Forwarding rule on the router.

Use the `Test Port Forward` buttin in `Advanced` Settings tab to verify the configuration is correct.

## Custom Domains

Custom Domains can be used with the Cloud Plugin.

Set up a reverse proxy to the https Forward Port shown in settings.


## Cloudflare Tunnels

Scrypted Cloud automatically creates a login free tunnel for remote access.

The following steps are only necessary if you want to associate the tunnel with your existing Cloudflare account to manage it remotely.

1. Create the Tunnel in the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com).
2. Copy the token shown for the tunnel shown in the `install [token]` command. E.g. `cloudflared service install eyJhI344aA...`.
3. Paste the token into the Cloud Plugin Advanced Settings.
4. Add a `Public Hostname` to the tunnel.
    * Choose a (sub)domain.
    * Service `Type` is `HTTPS` and `URL` is `localhost:port`. Replace the port with `Forward Port` from Cloud Plugin Settings.
    * Expand `Additional Application Settings` -> `TLS` menus and enable `No TLS Verify`.

5. Reload Cloud Plugin.
6. Verify Cloudflare successfully connected by observing the `Console` Logs.