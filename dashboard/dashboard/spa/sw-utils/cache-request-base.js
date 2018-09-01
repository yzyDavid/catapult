/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import idb from '/idb/idb.js';
import Timing from './timing.js';
import analytics from './google-analytics.js';


/**
 * CacheRequestBase handles all operations for starting a data race between
 * IndexedDB and the network. Developers can extends this class to retrieve
 * and cache results from remote sources, such as APIs.
 */
export class CacheRequestBase {
  constructor(request) {
    this.request = request;
    this.asyncIterator_ = this.raceCacheAndNetwork_();
  }

  get timingCategory() {
    // e.g. 'Timeseries', 'Reports', 'FullHistograms'
    throw new Error(`${this.constructor.name} didn't overwrite timingCategory`);
  }

  get databaseName() {
    // e.g. `reports/${this.uniqueIdentifier}`
    throw new Error(`${this.constructor.name} didn't overwrite databaseName`);
  }

  get databaseVersion() {
    // e.g. 1, 2, 3
    throw new Error(
        `${this.constructor.name} didn't overwrite databaseVersion`
    );
  }

  async upgradeDatabase(database) {
    // See https://github.com/jakearchibald/idb#upgrading-existing-db
    throw new Error(
        `${this.constructor.name} didn't overwrite upgradeDatabase`
    );
  }

  async read(database) {
    throw new Error(`${this.constructor.name} didn't overwrite read`);
  }

  async write(database, networkResults) {
    throw new Error(`${this.constructor.name} didn't overwrite write`);
  }

  // Child classes should use this method to record performance measures to the
  // Chrome DevTools and, if available, to Google Analytics.
  time(action) {
    return new Timing(this.timingCategory, action, this.request.url);
  }

  [Symbol.asyncIterator]() {
    return this.asyncIterator_;
  }

  next() {
    return this.asyncIterator_.next();
  }

  // TODO(crbug.com/878015): Use async generator methods.
  get raceCacheAndNetwork_() {
    return async function* () {
      const cachePromise = this.readCache_();
      const networkPromise = this.readNetwork_();

      const winner = await Promise.race([cachePromise, networkPromise]);

      if (winner.name === 'IndexedDB' && winner.result) {
        yield winner;
      }

      const res = await networkPromise;
      yield res;
      CacheRequestBase.writer.enqueue(() => this.writeIDB_(res.result));
    };
  }

  async readCache_() {
    const timing = this.time('Cache');
    const response = await this.readIDB_();

    if (response) {
      timing.end();
    } else {
      timing.remove();
    }

    return {
      name: 'IndexedDB',
      result: response,
    };
  }

  async readNetwork_() {
    let timing = this.time('Network');
    const response = await fetch(this.request);
    timing.end();

    timing = this.time('Network - Parse JSON');
    const json = await response.json();
    timing.end();

    return {
      name: 'Network',
      result: json,
    };
  }

  async openIDB_(name) {
    if (!CacheRequestBase.connectionPool.has(name)) {
      const timing = this.time('Open');
      const connection = await idb.open(name, this.databaseVersion,
          this.upgradeDatabase);
      CacheRequestBase.connectionPool.set(name, connection);
      timing.end();
    }
    return CacheRequestBase.connectionPool.get(name);
  }

  async readIDB_() {
    const database = await this.openIDB_(this.databaseName);
    const timing = this.time('Read');
    const results = await this.read(database);
    timing.end();
    return results;
  }

  async writeIDB_(networkResults) {
    const database = await this.openIDB_(this.databaseName);
    const timing = this.time('Write');
    const results = await this.write(database, networkResults);
    timing.end();
    return results;
  }
}

// Keep a pool of open connections to reduce the latency of recurrent opens.
// TODO(b/875941): Use LRU eviction for IndexedDB connections.
CacheRequestBase.connectionPool = new Map();

// Allow reads to be fast by delaying writes by the approximate maximum time
// taken for the cache to respond.
const WRITING_QUEUE_DELAY_MS = 3000;

// WritingQueue queues inputs for a write function, which is called in batch
// after no more inputs are added after a given timeout period.
class WritingQueue {
  constructor() {
    this.timeoutEnabled = true;
    this.queue = [];
    this.timeoutId = undefined;
  }

  enqueue(writeFunc) {
    this.queue.push(writeFunc);

    if (!this.timeoutEnabled) return;

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(this.flush.bind(this), WRITING_QUEUE_DELAY_MS);
  }

  flush() {
    const promises = this.queue.map(writeFunc => (async() => {
      try {
        await writeFunc();
      } catch (err) {
        ga.sendException(err);
      }
    })());

    this.queue = [];

    // Record the size of the connection pool to see if LRU eviction would be
    // necessary for the future.
    const count = CacheRequestBase.connectionPool.size;
    analytics.sendEvent('IndexedDB', 'Connection Pool Size', count);

    return promises;
  }
}

// Delay writes for increased read performance.
CacheRequestBase.writer = new WritingQueue();


export async function deleteDatabaseForTest(databaseName) {
  if (CacheRequestBase.connectionPool.has(databaseName)) {
    await CacheRequestBase.connectionPool.get(databaseName).close();
    CacheRequestBase.connectionPool.delete(databaseName);
  }

  await idb.delete(databaseName);
}

/**
 * Tests should disable the WritingQueue's timeout-based writing mechanism.
 * Instead, manually flushing the writer should be used to allow for synchronous
 * assertions. The two utility functions below make this easy:
 *
 *   test('it_does_stuff', async() => {
 *     disableAutomaticWritingForTest('foo');
 *     // Add tasks to the writing queue...
 *     await flushWriterForTest();
 *     // Make some assertions...
 *   });
 *
 */

export function disableAutomaticWritingForTest() {
  CacheRequestBase.writer.timeoutEnabled = false;
}

export async function flushWriterForTest() {
  if (CacheRequestBase.writer.timeoutId) {
    clearTimeout(CacheRequestBase.writer.timeoutId);
  }

  const tasks = CacheRequestBase.writer.flush();
  await Promise.all(tasks);
}


export default {
  deleteDatabaseForTest,
  disableAutomaticWritingForTest,
  flushWriterForTest,
  CacheRequestBase,
};
