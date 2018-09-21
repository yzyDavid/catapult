/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

// When true, state is recursively frozen so that improper property setting
// causes an error to be thrown. Freezing significantly impacts performance,
// so set to false in order to measure performance on localhost.
window.IS_DEBUG = location.hostname === 'localhost';

// When in production, tell Redux Dev Tools to disable automatic recording.
const PRODUCTION_ORIGIN = 'v2spa-dot-chromeperf.appspot.com';
window.PRODUCTION_URL = `https://${PRODUCTION_ORIGIN}`;
window.IS_PRODUCTION = location.hostname === PRODUCTION_ORIGIN;

// Google Analytics
const trackingId = IS_PRODUCTION ? 'UA-98760012-3' : 'UA-98760012-4';

window.ga = window.ga || function() {
  ga.q = ga.q || [];
  ga.q.push(arguments);
};
ga.l = new Date();
ga('create', trackingId, 'auto');
ga('send', 'pageview');
(function() {
  // Write this script tag at runtime instead of in HTML in order to prevent
  // vulcanizer from inlining a remote script.
  const script = document.createElement('script');
  script.src = 'https://www.google-analytics.com/analytics.js';
  script.type = 'text/javascript';
  script.async = true;
  document.head.appendChild(script);
})();

// Register the Service Worker when in production. Service Workers are not
// helpful in development mode because all backend responses are being mocked.
if ('serviceWorker' in navigator && !window.IS_DEBUG) {
  const swChannel = new BroadcastChannel('service-worker');
  const analyticsClientIdPromise = new Promise(resolve => ga(tracker => resolve(
      tracker.get('clientId'))));

  document.addEventListener('DOMContentLoaded', async() => {
    const [clientId] = await Promise.all([
      analyticsClientIdPromise,
      navigator.serviceWorker.register(
          'service-worker.js?' + VULCANIZED_TIMESTAMP.getTime()),
    ]);
    if (navigator.serviceWorker.controller === null) {
      location.reload();
    }

    swChannel.postMessage({
      type: 'GOOGLE_ANALYTICS',
      payload: {
        trackingId,
        clientId,
      },
    });
  });
}

window.addEventListener('load', () => {
  tr.b.Timing.ANALYTICS_FILTERS.push(mark =>
    ['firstPaint', 'fetch', 'load'].includes(mark.groupName) ||
    (mark.durationMs > 100));
  const loadTimes = Object.entries(performance.timing.toJSON()).filter(p =>
    p[1] > 0);
  loadTimes.sort((a, b) => a[1] - b[1]);
  const start = loadTimes.shift()[1];
  for (const [name, timeStamp] of loadTimes) {
    tr.b.Timing.mark('load', name, start).end(timeStamp);
  }
});
