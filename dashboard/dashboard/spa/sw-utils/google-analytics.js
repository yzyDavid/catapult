/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

// Constants used for sending Google Analytics events/exceptions.
const VERSION_NUMBER = 1;
const DATA_SOURCE = 'web';
const HIT_TYPE_EVENT = 'event';
const HIT_TYPE_TIMING = 'timing';
const HIT_TYPE_EXCEPTION = 'exception';

/**
 * GoogleAnalytics provides an interface to Google Analytic (GA) services from
 * within a Service Worker. This is necessary since all GA client libraries take
 * advantage of the DOM, which is non-accessable within the context of a Service
 * Worker.
 *
 * See https://developers.google.com/web/ilt/pwa/integrating-analytics
 */
class GoogleAnalytics {
  constructor() {
    // GA configuration variables are sent from the application to the Service
    // Worker shortly after being registered.
    this.trackingId = undefined;
    this.clientId = undefined;

    // Used for queueing requests until GA is initialized.
    this.paramsQueue = [];
  }

  // Configure Google Analytics. Any events sent before this function is called
  // will be immediately sent to Google Analytics.
  configure(trackingId, clientId) {
    this.trackingId = trackingId;
    this.clientId = clientId;

    // Send out all pending requests.
    for (const params of this.paramsQueue) {
      this.send_(params);
    }
    this.paramsQueue = [];
  }

  sendEvent(category, action, label, value) {
    const params = this.createParams_();
    params.set('t', HIT_TYPE_EVENT);
    params.set('ec', category);
    params.set('ea', action);
    params.set('ev', value);
    if (label) {
      params.set('el', label);
    }
    this.send_(params);
  }

  sendTiming(category, action, duration, label) {
    const params = this.createParams_();
    const roundedDuration = Math.round(duration);
    params.set('t', HIT_TYPE_TIMING);
    params.set('utc', category);
    params.set('utv', action);
    params.set('utt', roundedDuration);
    if (label) {
      params.set('utl', label);
    }
    this.send_(params);
  }

  sendException(description, fatal = true) {
    const params = this.createParams_();
    params.set('t', HIT_TYPE_EXCEPTION);
    params.set('exd', description);
    params.set('exf', fatal);
    this.send_(params);
  }

  createParams_() {
    const params = new URLSearchParams();
    params.set('v', VERSION_NUMBER);
    params.set('ds', DATA_SOURCE);
    return params;
  }

  async send_(params) {
    if (!this.clientId || !this.trackingId) {
      // `GoogleAnalytics#configure` has not been called yet. There is not
      // enough information to send these parameters to GA.
      this.paramsQueue.push(params);
      return;
    }

    params.set('cid', this.clientId);
    params.set('tid', this.trackingId);

    const response = await fetch('https://www.google-analytics.com/debug/collect', {
      method: 'POST',
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bad response from Google Analytics:\n${text}`);
    }
  }
}

const ga = new GoogleAnalytics();
export default ga;
