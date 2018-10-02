/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import analytics from './google-analytics.js';

const VERSION_NUMBER = 1;
const DATA_SOURCE = 'web';
const HIT_TYPE = 'timing';

// Give Timing marks unique names through the use of a numeric counter. This
// only works for the first 2^54 marks. After that, this counter is always the
// same due to JavaScript's double-precision floating-point Number
// implementation (IEEE 754).
let counter = 0;

/**
 * Timing measures performance-related information for display on the Chrome
 * DevTools Performance tab and Google Analytics.
 */
export class Timing {
  constructor(category, action, label) {
    if (!category) throw new Error('No category specified');
    if (!action) throw new Error(`No action specified for ${category}`);
    if (!label) throw new Error(`No label specified for ${category} ${action}`);

    this.category_ = category;
    this.action_ = action;
    this.label_ = label;

    this.name_ = `${category} - ${action}`;
    this.uid_ = `${this.name_}-${counter++}`;
    performance.mark(`${this.uid_}-start`);
  }

  end() {
    performance.mark(`${this.uid_}-end`);
    performance.measure(this.name_, `${this.uid_}-start`, `${this.uid_}-end`);
    this.sendAnalyticsTimingEvent_();
  }

  // Cancel the Timing by removing the starting mark, useful for error handling.
  remove() {
    performance.clearMarks(`${this.uid_}-start`);
  }

  async sendAnalyticsTimingEvent_() {
    const start = performance.getEntriesByName(`${this.uid_}-start`)[0];
    const end = performance.getEntriesByName(`${this.uid_}-end`)[0];
    const duration = end.startTime - start.startTime;

    analytics.sendTiming(this.category_, this.action_, duration, this.label_);
  }
}

export default Timing;
