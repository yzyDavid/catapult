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
window.PRODUCTION_ORIGIN = 'v2spa-dot-chromeperf.appspot.com';
window.PRODUCTION_URL = `https://${PRODUCTION_ORIGIN}`;
window.IS_PRODUCTION = location.hostname === PRODUCTION_ORIGIN;

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

window.ga = window.ga || function() {
  ga.q = ga.q || [];
  ga.q.push(arguments);
};
ga.l = new Date();
ga('create', 'UA-98760012-3', 'auto');
(function() {
  // Write this script tag at runtime instead of in HTML in order to bypass the
  // vulcanizer.
  const script = document.createElement('script');
  script.src = 'https://www.google-analytics.com/analytics.js';
  script.type = 'text/javascript';
  script.async = true;
  document.head.appendChild(script);
})();
