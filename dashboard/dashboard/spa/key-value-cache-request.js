/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import {CacheRequestBase, READONLY, READWRITE, jsonResponse} from './cache-request-base.js';

const STORE_DATA = 'data';
const EXPIRATION_KEY = '_expiresTime';

export default class KeyValueCacheRequest extends CacheRequestBase {
  constructor(fetchEvent) {
    super(fetchEvent);
    KeyValueCacheRequest.IN_PROGRESS.push(this);
    this.databaseKey = this.getDatabaseKey();
    this.response = this.getResponse();
  }

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

  async getDatabaseKey() {
    throw new Error(`${this.constructor.name} must override getDatabaseKey`);
  }

  async write_(key, value) {
    const timing = this.time('Write');
    const db = await this.openIDB_(this.databaseName);
    const transaction = db.transaction([STORE_DATA], READWRITE);
    const dataStore = transaction.objectStore(STORE_DATA);
    const expiration = new Date(new Date().getTime() + this.expirationMs);
    dataStore.put({value, [EXPIRATION_KEY]: expiration.toISOString()}, key);
    await transaction.complete;
    timing.end();

    const index = KeyValueCacheRequest.IN_PROGRESS.indexOf(this);
    KeyValueCacheRequest.IN_PROGRESS.splice(index, 1);
  }

  async getResponse() {
    const key = await this.databaseKey;
    const db = await this.openIDB_(this.databaseName);
    const transaction = db.transaction([STORE_DATA], READONLY);
    const dataStore = transaction.objectStore(STORE_DATA);
    const entry = await dataStore.get(key);
    if (entry && (new Date(entry[EXPIRATION_KEY]) > new Date())) {
      return entry.value;
    }

    for (const other of KeyValueCacheRequest.IN_PROGRESS) {
      if (other !== this &&
          key === (await other.databaseKey) &&
          KeyValueCacheRequest.IN_PROGRESS.includes(other)) {
        // Double-check that other wasn't removed from IN_PROGRESS while
        // awaiting its databaseKey. Remove `this` from IN_PROGRESS so that
        // `other` doesn't await `this.response`.
        const index = KeyValueCacheRequest.IN_PROGRESS.indexOf(this);
        KeyValueCacheRequest.IN_PROGRESS.splice(index, 1);
        return await other.response;
      }
    }

    const response = await this.timePromise(
        'Network', fetch(this.fetchEvent.request));
    const value = await this.timePromise('Parse JSON', response.json());
    CacheRequestBase.writer.enqueue(() => this.write_(key, value));
    return value;
  }

  async respond() {
    this.fetchEvent.respondWith(this.response.then(jsonResponse));
  }
}

KeyValueCacheRequest.IN_PROGRESS = [];
