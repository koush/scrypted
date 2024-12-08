# Cloud Access Plugin for Scrypted

1. Log into Scrypted Cloud using the login button.
2. This Scrypted server is now available at https://home.scrypted.app.

See below for additional recommendations.

## Port Forwarding

The network's router must configure an external port, the `From Port`, to the send traffic to the `Forward Port` on this server. These ports have random defaults that can be seen in the plugin Settings, and can be changed if preferred. Ports 10443 and 10444 are already being used by Scrypted itself, and should not be used. Choose another port, like 11443.

### What You'll Need
- Access to your router's settings (usually through a web browser).
- Ability to change settings on your host machine's firewall (like ufw for Linux or Windows Firewall for Windows).

### Step-by-Step Instructions

1. **Port Configuration**
   - For simplicity, use the same port number (e.g 11443) for both "From Port" and "Forward Port" fields in the Scrypted Cloud plugin settings General tab.
   
2. **Access Your Router Settings**  
  - Open your web browser and go to your router's login page. You may need the router's IP address, username, and password.  
    > If you're not sure how to do this, [find the guide specific to your router here](https://portforward.com/router.htm).

3. **Navigate to Firewall or Port Forwarding Section**  
  - Once logged in, find the section that deals with "Firewall" or "Port Forwarding". It could be under tabs like "Advanced," "NAT," or "Security."
  
4. **Set Up Port Forwarding Rule**
    - Use the port number you chose in Step 1 (e.g 11443) to set up a new Port Forwarding rule on your router.

5. **Change Port Forwarding Mode in Scrypted**
    - Go back to Scrypted and navigate to the "General" tab in the Cloud plugin.
    - Select "Router Forward" from the "Port Forwarding Mode" dropdown menu.

6. **Save Your Settings**
    - Don't forget to save your changes in both your router and in Scrypted.

7. **Reload Plugin**
    - After all configuration is complete, Reload Cloud Plugin to ensure the new settings are applied.

6. **Test Your Setup**
    - In the Scrypted Cloud plugin settings, find and click the `Test Port Forward` button under the `Advanced` Settings tab. This will confirm if everything is set up correctly.

### Firewall Configuration
Make sure your host machine’s firewall isn't blocking the port you've chosen. You may need to create an 'allow' rule for this port in your host's firewall settings.

## Custom Domains

Custom Domains can be used with the Cloud Plugin.

Set up a reverse proxy to the https Forward Port shown in settings.

## Cloudflare Tunnels

Scrypted Cloud automatically creates a login free tunnel for remote access.

The following steps are only necessary if you want to associate the tunnel with your existing Cloudflare account to manage it remotely.

1. Navigate to the Cloud Plugin's Cloudflare Settings.
2. Enter the Cloudflare subdomain, e.g. `scrypted.example.org`.
3. Open the authorization link printed in the Log in a browser.
4. Log in to Cloudflare if prompted. Then open the authorization link again.
5. Select the domain for the specified the subdomain.
6. Authorization should now be complete.

::: info
Visiting the authorization link twice as directed in the above instructions may be necessary. Cloudflare will not prompt a with a list of domains unless the browser session is already logged in.
:::
