/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import analytics from './sw-utils/google-analytics.js';
import TimeseriesCacheRequest from './sw-utils/timeseries-cache-request.js';

// Create a communication channel between clients and the service worker to
// allow for post-installation configuration. This is curretly used for
// retrieving Google Analytics tracking and client ids.
const channel = new BroadcastChannel('service-worker');

function handleMessage(messageEvent) {
  const {type, payload} = messageEvent.data;

  if (type === 'GOOGLE_ANALYTICS') {
    const {trackingId, clientId} = payload;
    analytics.configure(trackingId, clientId);
  } else {
    throw new Error(`Unknown Service Worker message type: ${type}`);
  }
}

// Setup worker-specific resources such as offline caches.
self.addEventListener('install', event => {
  channel.addEventListener('message', handleMessage);
});

// Allow the worker to finish the setup and clean other worker's related
// resources like removing old caches.
self.addEventListener('activate', event => {
  // Take control of uncontrolled clients. This will register the fetch event
  // listener after install. Note that this is a time sensitive operation.
  // Fetches called before claiming will not be intercepted.
  event.waitUntil(self.clients.claim());
});

// On fetch, use cache but update the entry with the latest contents from the
// server.
self.addEventListener('fetch', event => {
  handleFetch(event, '/api/timeseries2', TimeseriesCacheRequest);
});

function handleFetch(event, url, CacheRequest) {
  if (event.request.url.startsWith(location.origin + url)) {
    const cacheRequest = new CacheRequest(event.request);

    event.respondWith(new Response(new Blob(['null'],
        {type: 'application/json'})));

    event.waitUntil(broadcast(event.request.url, cacheRequest));
  }
}

async function broadcast(url, cacheRequest) {
  // Open a channel for communication between clients.
  const channel = new BroadcastChannel(url);

  // Wait for all results of the CacheRequest. Inform clients of cached results
  // and fresh results from the network.
  for await (const response of cacheRequest) {
    if (response) {
      channel.postMessage({
        type: 'RESULTS',
        payload: response.result,
      });
    }
  }

  // Tell clients that the response has ended.
  channel.postMessage({type: 'DONE'});
}
