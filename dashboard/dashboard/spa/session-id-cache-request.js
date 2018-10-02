/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import {CacheRequestBase, READONLY, READWRITE, jsonResponse} from './cache-request-base.js';

const STORE_SIDS = 'sids';

// TODO share with utils.js when vulcanize is replaced with webpack
async function sha(s) {
  s = new TextEncoder('utf-8').encode(s);
  const hash = await crypto.subtle.digest('SHA-256', s);
  const view = new DataView(hash);
  let hex = '';
  for (let i = 0; i < view.byteLength; i += 4) {
    hex += ('00000000' + view.getUint32(i).toString(16)).slice(-8);
  }
  return hex;
}

// The SPA can sometimes POST the same data to /short_uri many times in rapid
// succession without waiting for the requests to finish. Store session IDs in
// this queue while waiting for the server to accept them in order to avoid
// posting the same data to the server many times.
const SID_QUEUE = [];

export default class SessionIdCacheRequest extends CacheRequestBase {
  get timingCategory() {
    return 'short_uri';
  }

  get databaseName() {
    return 'short_uri';
  }

  get databaseVersion() {
    return 1;
  }

  async upgradeDatabase(db) {
    if (db.oldVersion < 1) {
      db.createObjectStore(STORE_SIDS);
    }
  }

  get raceCacheAndNetwork_() {
    return async function* () {
      // This class does not race cache vs network. See respond().
    };
  }

  async openStore_(mode) {
    const db = await this.openIDB_(this.databaseName);
    const transaction = db.transaction([STORE_SIDS], mode);
    return transaction.objectStore(STORE_SIDS);
  }

  async isKnown_(sid) {
    if (SID_QUEUE.includes(sid)) return true;
    const store = await this.openStore_(READONLY);
    return await store.get(sid);
  }

  async validate_(sid) {
    SID_QUEUE.push(sid);
    const response = await this.timePromise(
        'Network', fetch(this.fetchEvent.request));
    const json = await this.timePromise('Parse JSON', response.json());
    if (json.sid !== sid) {
      throw new Error(`short_uri expected ${sid} actual ${json.sid}`);
    }
  }

  async write_(sid) {
    await this.timePromise('Write', this.openStore_(READWRITE).then(store =>
      store.put(new Date(), sid)));
    const qi = SID_QUEUE.indexOf(sid);
    if (qi >= 0) SID_QUEUE.splice(qi, 1);
  }

  async computeSid() {
    const body = await this.fetchEvent.request.clone().formData();
    return await sha(decodeURIComponent(body.get('page_state')));
  }

  async respond() {
    // Allow the browser to handle GET /short_uri?sid requests.
    if (this.fetchEvent.request.method !== 'POST') return;

    // respondWith() must be called synchronously, but accepts a Promise.
    const sidPromise = this.computeSid();
    this.fetchEvent.respondWith(sidPromise.then(sid => jsonResponse({sid})));
    const sid = await sidPromise;
    const isKnown = await this.isKnown_(sid);
    if (!isKnown) await this.validate_(sid);
    // Update the timestamp even if the sid was already in the database so that
    // we can evict LRU.
    CacheRequestBase.writer.enqueue(() => this.write_(sid));
  }
}
