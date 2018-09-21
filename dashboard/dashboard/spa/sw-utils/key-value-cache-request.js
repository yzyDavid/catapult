/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import {CacheRequestBase, READONLY, READWRITE, jsonResponse} from './cache-request-base.js';

const STORE_DATA = 'data';
const EXPIRATION_KEY = '_expiresTime';

export default class KeyValueCacheRequest extends CacheRequestBase {
  get timingCategory() {
    return 'keyvalue';
  }

  get databaseName() {
    return 'keyvalue';
  }

  get databaseVersion() {
    return 1;
  }

  async upgradeDatabase(db) {
    if (db.oldVersion < 1) {
      db.createObjectStore(STORE_DATA);
    }
  }

  get raceCacheAndNetwork_() {
    return async function* () {
      // This class does not race cache vs network. See respond().
    };
  }

  get expirationMs() {
    return 20 * 60 * 60 * 1000;
  }

  async databaseKey() {
    throw new Error(`${this.constructor.name} must override databaseKey`);
  }

  async openStore_(mode) {
    const db = await this.openIDB_(this.databaseName);
    const transaction = db.transaction([STORE_DATA], mode);
    return transaction.objectStore(STORE_DATA);
  }

  async write_(key, value) {
    const timing = this.time('Write');
    const dataStore = await this.openStore_(READWRITE);
    const expiration = new Date() + this.expirationMs;
    await dataStore.put({value, [EXPIRATION_KEY]: expiration.toISOString()}, key);
    timing.end();
  }

  async getResponse() {
    const key = await this.databaseKey();
    const dataStore = await this.openStore_(READONLY);
    const entry = await dataStore.get(key);
    if (entry && (new Date(entry[EXPIRATION_KEY]) < new Date())) {
      return entry.value;
    }
    const response = await this.timePromise(
        'Network', fetch(this.fetchEvent.request));
    const value = await this.timePromise('Parse JSON', response.json());
    CacheRequestBase.writer.enqueue(() => this.write_(key, value));
    return value;
  }

  async respond() {
    this.fetchEvent.respondWith(this.getResponse().then(jsonResponse));
  }
}
