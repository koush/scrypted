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
1. Create a API & Services -> Credentials -> Create Credentials -> OAuth -> WebApplication with the following redirect URIs:
```
https://home.scrypted.app/web/oauth/callback
https://www.google.com
```
2. Open the API Dashboard and enable the following APIs:
  * Smart Device Management API
  * Cloud Pub/Sub: You will come back to this again below.

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



### Step by Step Guide

1. Browse to https://console.developers.google.com/apis/credentials
2. In the top left bar, click the drop down
3. Select 'New Project'
4. Enter a project name eg NestScrypted
5. Click 'Create'
6. You will be taken back to the 'APIs and services' page
7. In the top left bar, click the drop down and choose your newly created project
8. You need to configure OAuth consent screen - click 'CONFIGURE CONSENT SCREEN' to the right of the page
9. Select 'External' and click 'Create'
10. Complete all mandatory fields
11. Click 'Save and continue' for the next 3 screens
12. Click 'BACK TO DASHBOARD'
13. In the left column, select 'Credentials'
14. At the top of the screen, click '+ CREATE CREDENTIALS'
15. Choose 'OAuth client ID'
16. From the drop down, choose 'Web application' as the application type
17. Enter a name eg Scrypted OAuth
18. Under 'Authorised redirect URIs' click '+ ADD URI' and enter https://home.scrypted.app/web/oauth/callback
19. Click '+ ADD URI' and add https://www.google.com
20. Make a note of the OAuth 'Your Client ID' and 'Your Client Secret' - these are to be entered into Scrypted plugin Google Device Access settings
21. Click 'Create'
22. On the left column, select 'OAuth consent screen'
23. Scroll down to '+ ADD TEST USERS'
24. Add your gmail email addresss as a test user
25. In the left column click 'Enable APIs and services'
26. At the top of the page, click '+ ENABLE APIS AND SERVICES'
27. Search for 'Smart Device Management API'
28. Click the result and select 'ENABLE'
29. In the left column click 'Enable APIs and services'
30. At the top of the page, click '+ ENABLE APIS AND SERVICES'
31. Search for 'Cloud pub/sub api'
32. Select 'Cloud pub/sub api'
33. Click 'ENABLE'
34. Browse to https://console.nest.google.com/device-access/project-list
35. Create a project
36. Enter a name for the project
37. Click 'Next'
38. Enter the OAuth Client ID from step 20 (the same details you recorded on the Scrypted plugin Google D9vice Access settings page)
40. Select 'Enable' and click 'Create Project'
41. Make a note of the Project ID - this is to be entered into Scrypted plugin Google Device Access settings page for Project ID
42. Make a note of the 'Pub/Sub Topic'
43. Go back to the Scrypte plugin and choose 'Login'
44. Select your email address
45. Select all the relevant devices you wish to access in Scrypted, wait for 10 seconds to allow any other options to become active to select
46. Select 'Next'
47. Choose your email account again
48. Click 'Continue' when prompted even though the app has not been verified
49. Click 'Continue' on the page stating 'scrypted.app wants to access your Google Account'
50. Your new devices will be added to Scrypted.
51. Now we need to setup the Google Cloud Pub/Sub - browse to https://console.cloud.google.com/cloudpubsub/subscription/list
52. Click on ‘Create Subscription’
53. In ‘Subscription ID’ field enter any value, eg ‘Scrypted’
54. Click the drop down title ‘Select a Cloud Pub/Sub topic’
55. Click on ‘ENTER TOPIC MANUALLY’
56. Enter the noted pub/sub topic from step 42 and click 'Save'
57. Change 'Delivery type' to Push
58. Enter the URL from Scrypted Google Device Access Settings page (bottom box - 'Pub/Sub Address') in the 'Endpoint URL'
59. Change ‘Message Retention’ to 1 hour rather than 7 days otherwise the system can get overloaded
60. Click ‘Create’
