// [START gae_flex_datastore_app]
'use strict';

import express from 'express';
import bodyParser from 'body-parser';

const app = express();
app.enable('trust proxy');

app.use(bodyParser());

// By default, the client will authenticate using the service account file
// specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable and use
// the project specified by the GOOGLE_CLOUD_PROJECT environment variable. See
// https://github.com/GoogleCloudPlatform/google-cloud-node/blob/master/docs/authentication.md
// These environment variables are set automatically on Google App Engine
import { Datastore, Key } from '@google-cloud/datastore';
import axios from 'axios';

// Instantiate a datastore client
const datastore = new Datastore();

interface UserIdEndpoint {
  endpoint: string;
}

async function getOne(datastore: Datastore, key: Key): Promise<UserIdEndpoint> {
  const array = await datastore.get(key);
  if (!array[0])
    return;
  return array[0];
}

async function putOne(datastore: Datastore, key: Key, data: UserIdEndpoint) {
  return await datastore.save({
    key,
    data,
    excludeFromIndexes: ['endpoint'],
  })
}

const userIds = new Map<string, UserIdEndpoint>();

app.post('/event', async (req, res) => {
  res.send('ok');

  try {
    // the actual payload with the user id is in a base64 data blob.
    const payload = JSON.parse(Buffer.from(req.body.message.data, 'base64').toString());

    const { userId } = payload;
    if (!userId) {
      console.error('no userId found');
      return;
    }
  
    let endpoint = userIds.get(userId);
  
    if (!endpoint) {
      const key = datastore.key(['UserIdEndpoint', userId]);
      endpoint = await getOne(datastore, key);
  
      if (!endpoint) {
        endpoint = {
          endpoint: undefined,
        };
        putOne(datastore, key, endpoint);
      }

      userIds.set(userId, endpoint);
    }
  
    if (!endpoint.endpoint) {
      console.error('unmapped userId');
      return;
    }
    
    axios.post(endpoint.endpoint, req.body).catch(() => {});
  }
  catch (e) {
    console.error('payload error', e);
  }
})

app.post('/register/:userId', async (req, res) => {

  const { userId } = req.params;
  const { endpoint } = req.body;

  console.log(userId, endpoint);

  let check = userIds.get(userId);
  const key = datastore.key(['UserIdEndpoint', userId]);

  if (!check) {
    // found but no mapping
    if (userIds.has(userId)) {
      res.status(404);
      res.send({});
      return;
    }

    check = await getOne(datastore, key);
    userIds.set(userId, check);
  }

  // must exist to persist
  if (check) {
    if (check.endpoint !== endpoint) {
      check = {
        endpoint,
      };
  
      await putOne(datastore, key, check);
      userIds.set(userId, check);
    }

    res.status(200);
    res.send({});
    return;
  }

  res.status(404);
  res.send({});
});

const PORT = process.env.PORT || 8080;
app.listen(process.env.PORT || 8080, () => {
  console.log(`App listening on port ${PORT}`);
  console.log('Press Ctrl+C to quit.');
});
// [END gae_flex_datastore_app]

module.exports = app;
