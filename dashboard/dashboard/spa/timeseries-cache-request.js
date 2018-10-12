/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import {
  CacheRequestBase, READONLY, READWRITE, jsonResponse,
} from './cache-request-base.js';
import Range from './range.js';
import ResultChannelSender from './result-channel-sender.js';

// TODO move to separate file.
async function* raceAllPromises(promises) {
  promises = promises.map((p, id) => {
    const replacement = p.then(result => {
      return {id, result};
    });
    replacement.id = id;
    return replacement;
  });
  while (promises.length) {
    const {id, result} = await Promise.race(promises);
    promises = promises.filter(p => p.id !== id);
    yield result;
  }
}

// TODO move this to an ES6 module and share with the page.
function normalize(table, columnNames) {
  return table.map(row => {
    const datum = {};
    for (let i = 0; i < columnNames.length; ++i) {
      datum[columnNames[i]] = row[i];
    }
    return datum;
  });
}

/**
 * Finds the first index in the array whose value is >= loVal.
 *
 * The key for the search is defined by the mapFn. This array must
 * be prearranged such that ary.map(mapFn) would also be sorted in
 * ascending order.
 *
 * @param {Array} ary An array of arbitrary objects.
 * @param {function():*} mapFn Callback that produces a key value
 *     from an element in ary.
 * @param {number} loVal Value for which to search.
 * @return {Number} Offset o into ary where all ary[i] for i <= o
 *     are < loVal, or ary.length if loVal is greater than all elements in
 *     the array.
 */
function findLowIndexInSortedArray(ary, mapFn, loVal) {
  if (ary.length === 0) return 1;

  let low = 0;
  let high = ary.length - 1;
  let i;
  let comparison;
  let hitPos = -1;
  while (low <= high) {
    i = Math.floor((low + high) / 2);
    comparison = mapFn(ary[i]) - loVal;
    if (comparison < 0) {
      low = i + 1; continue;
    } else if (comparison > 0) {
      high = i - 1; continue;
    } else {
      hitPos = i;
      high = i - 1;
    }
  }
  // return where we hit, or failing that the low pos
  return hitPos !== -1 ? hitPos : low;
}

// TODO move this to an ES6 module
function mergeObjectArrays(key, merged, ...arrays) {
  for (const objects of arrays) {
    for (const obj of objects) {
      // Bisect key to find corresponding entry in merged.
      const index = findLowIndexInSortedArray(
          merged, entry => entry[key], obj[key]);
      if (index >= merged.length) {
        merged.push({...obj});
        continue;
      }
      const entry = merged[index];
      if (entry[key] === obj[key]) {
        Object.assign(entry, obj);
        continue;
      }
      merged.splice(index, 0, {...obj});
    }
  }
}

class TimeseriesSlice {
  constructor(options) {
    this.columns = options.columns;
    this.revisionRange = options.revisionRange;
    this.testSuite = options.testSuite;
    this.measurement = options.measurement;
    this.bot = options.bot;
    this.testCase = options.testCase;
    this.buildType = options.buildType;
    this.responsePromise_ = undefined;
  }

  intersects(other) {
    if (this.testSuite !== other.testSuite) return false;
    if (this.bot !== other.bot) return false;
    if (this.measurement !== other.measurement) return false;
    if (this.testCase !== other.testCase) return false;
    if (this.buildType !== other.buildType) return false;
  }

  get responsePromise() {
    if (!this.responsePromise_) this.responsePromise_ = this.fetch_();
    return this.responsePromise_;
  }

  async fetch_() {
    // TODO use TimeseriesRequest?
  }
}

const STORE_DATA = 'data';
const STORE_METADATA = 'metadata';
const STORE_RANGES = 'ranges';
const STORES = [STORE_DATA, STORE_METADATA, STORE_RANGES];

const ACCESS_TIME_KEY = '_accessTime';

export default class TimeseriesCacheRequest extends CacheRequestBase {
  constructor(fetchEvent) {
    super(fetchEvent);
    this.parseRequestPromise = this.parseRequest_();
  }

  async parseRequest_() {
    this.body_ = await this.fetchEvent.request.clone().formData();

    if (!this.body_.has('columns')) throw new Error('Missing columns');
    this.columns_ = this.body_.get('columns').split(',');

    this.maxRevision_ = parseInt(this.body_.get('max_revision')) || undefined;
    this.minRevision_ = parseInt(this.body_.get('min_revision')) || undefined;
    this.revisionRange_ = Range.fromExplicitRange(
        this.minRevision_ || 0, this.maxRevision_ || Number.MAX_SAFE_INTEGER);

    this.testSuite_ = this.body_.get('test_suite') || '';
    this.measurement_ = this.body_.get('measurement') || '';
    this.bot_ = this.body_.get('bot') || '';
    this.testCase_ = this.body_.get('test_case') || '';
    this.buildType_ = this.body_.get('build_type') || '';
  }

  async sendResults_() {
    await this.parseRequestPromise;
    const channelName = this.fetchEvent.request.url + '?' +
      new URLSearchParams(this.body_);
    const sender = new ResultChannelSender(channelName);
    await sender.send(this.generateResults());
  }

  respond() {
    this.fetchEvent.respondWith(this.responsePromise.then(jsonResponse));
    this.fetchEvent.waitUntil(this.sendResults_());
  }

  get databaseName() {
    return TimeseriesCacheRequest.databaseName({
      testSuite: this.testSuite_,
      measurement: this.measurement_,
      bot: this.bot_,
      testCase: this.testCase_,
      buildType: this.buildType_,
    });
  }

  get databaseVersion() {
    return 1;
  }

  async upgradeDatabase(db) {
    if (db.oldVersion < 1) {
      db.createObjectStore(STORE_DATA);
      db.createObjectStore(STORE_METADATA);
      db.createObjectStore(STORE_RANGES);
    }
  }

  get generateResults() {
    return async function* () {
      await this.parseRequestPromise;
      const cacheResult = await this.readDatabase_();
      let finalResult = cacheResult;
      let availableRangeByCol = new Map();
      let mergedData = [];
      if (cacheResult && cacheResult.data) {
        mergedData = [...cacheResult.data];
        availableRangeByCol = cacheResult.availableRangeByCol;
        delete cacheResult.availableRangeByCol;
        yield cacheResult;
      }

      // Sometimes the client will request the same data in multiple different ways:
      // the minimap and the main chart both request XY data for the brushed
      // revision range, but the minimap also wants XY data outside the brushed
      // revision range, and the main chart also wants ANNOTATIONS data inside
      // the brushed revision range. We should only request the XY data inside
      // the brushed revision range from the server once, and share the data
      // between both TimeseriesCacheRequests.

      // TODO if there are any IN_PROGRESS requests for parts of this data
      // (columns or ranges), then don't request those parts here, but add those
      // requests' async generators to this networkPromises, and filter by
      // revision range before merging into mergedData.

      // If a col is available for revisionRange_, then don't fetch it.
      const columns = [...this.columns_];
      for (let ci = 0; ci < columns.length; ++ci) {
        const col = columns[ci];
        if (col === 'revision') continue;
        const availableRange = availableRangeByCol.get(col);
        if (!availableRange) continue;
        if (this.revisionRange_.duration === availableRange.duration) {
          columns.splice(ci, 1);
          --ci;
        }
      }

      // If all cols but revisions are available for the request range, then
      // don't fetch from the network.
      if (columns.length === 1) return;

      // If all cols are available for some subrange, then don't fetch that
      // range.
      let availableRange = this.revisionRange_;
      for (const col of columns) {
        if (col === 'revision') continue;
        const availableForCol = availableRangeByCol.get(col);
        if (!availableForCol) {
          availableRange = new Range();
          break;
        }
        availableRange = availableRange.findIntersection(availableForCol);
      }
      const missingRanges = Range.findDifference(
          this.revisionRange_, availableRange);

      const networkPromises = missingRanges.map((range, index) =>
        this.readNetwork_(range, columns).then(result => {
          return {result, range, columns};
        }));
      for await (const {result, range, columns} of raceAllPromises(
          networkPromises)) {
        if (!result || result.error || !result.data || !result.data.length) {
          continue;
        }
        mergeObjectArrays('revision', mergedData, result.data);
        finalResult = {...result, data: mergedData};
        yield finalResult;
      }
      this.scheduleWrite(finalResult);
    };
  }

  async readNetwork_(range, columns) {
    const params = {
      test_suite: this.testSuite_,
      measurement: this.measurement_,
      bot: this.bot_,
      build_type: this.buildType_,
      columns: columns.join(','),
    };
    if (range.min) params.min_revision = range.min;
    if (range.max < Number.MAX_SAFE_INTEGER) params.max_revision = range.max;
    if (this.testCase_) params.test_case = this.testCase_;
    let url = new URL(this.fetchEvent.request.url);
    url = url.origin + url.pathname + '?' + new URLSearchParams(params);
    const response = await fetch(url, {
      method: this.fetchEvent.request.method,
      headers: this.fetchEvent.request.headers,
    });
    if (!response.ok) {
      return {};
    }
    const responseJson = await response.json();
    if (responseJson.data) {
      responseJson.data = normalize(responseJson.data, columns);
    }
    return responseJson;
  }

  async readDatabase_() {
    const db = await this.databasePromise;
    const transaction = db.transaction(STORES, READONLY);

    const dataPointsPromise = this.getDataPoints_(transaction);
    const [
      improvementDirection,
      units,
      rangesByCol,
    ] = await Promise.all([
      this.getMetadata_(transaction, 'improvement_direction'),
      this.getMetadata_(transaction, 'units'),
      this.getRanges_(transaction),
    ]);

    const availableRangeByCol = this.getAvailableRangeByCol_(rangesByCol);
    if (availableRangeByCol.size === 0) return;
    return {
      availableRangeByCol,
      data: await dataPointsPromise,
      improvement_direction: improvementDirection,
      units,
    };
  }

  getAvailableRangeByCol_(rangesByCol) {
    const availableRangeByCol = new Map();
    if (!rangesByCol) return availableRangeByCol;
    for (const [col, rangeDicts] of rangesByCol) {
      if (!rangeDicts) continue;
      for (const rangeDict of rangeDicts) {
        const range = Range.fromDict(rangeDict);
        const intersection = range.findIntersection(this.revisionRange_);
        if (!intersection.isEmpty) {
          availableRangeByCol.set(col, intersection);
          break;
        }
      }
    }
    return availableRangeByCol;
  }

  async getMetadata_(transaction, key) {
    const store = transaction.objectStore(STORE_METADATA);
    return await store.get(key);
  }

  async getRanges_(transaction) {
    const rangeStore = transaction.objectStore(STORE_RANGES);
    const promises = [];
    for (const col of this.columns_) {
      if (col === 'revision') continue;
      promises.push(rangeStore.get(col).then(ranges => [col, ranges]));
    }
    const rangesByCol = await Promise.all(promises);
    return new Map(rangesByCol);
  }

  async getDataPoints_(transaction) {
    const dataStore = transaction.objectStore(STORE_DATA);
    if (!this.minRevision_ && !this.maxRevision_) {
      const dataPoints = await dataStore.getAll();
      return dataPoints;
    }

    const dataPoints = [];
    dataStore.iterateCursor(this.range_, cursor => {
      if (!cursor) return;
      dataPoints.push(cursor.value);
      cursor.continue();
    });

    await transaction.complete;
    return dataPoints;
  }

  get range_() {
    if (this.minRevision_ && this.maxRevision_) {
      return IDBKeyRange.bound(this.minRevision_, this.maxRevision_);
    }
    if (this.minRevision_ && !this.maxRevision_) {
      return IDBKeyRange.lowerBound(this.minRevision_);
    }
    if (!this.minRevision_ && this.maxRevision_) {
      return IDBKeyRange.upperBound(this.maxRevision_);
    }
  }

  async writeDatabase({data, ...metadata}) {
    const db = await this.databasePromise;
    const transaction = db.transaction(STORES, READWRITE);
    await Promise.all([
      this.updateAccessTime_(transaction),
      this.writeData_(transaction, data),
      this.writeRanges_(transaction, data),
      this.writeMetadata_(transaction, metadata),
    ]);
    await transaction.complete;
  }

  async writeRanges_(transaction, data) {
    const revisionRange = Range.fromExplicitRange(
        this.minRevision_ || 0,
        data[data.length - 1].revision);
    const rangeStore = transaction.objectStore(STORE_RANGES);
    await Promise.all(this.columns_.map(async col => {
      if (col === 'revision') return;
      const prevRangesRaw = (await rangeStore.get(col)) || [];
      const prevRanges = prevRangesRaw.map(Range.fromDict);
      const newRanges = revisionRange.mergeIntoArray(prevRanges);
      rangeStore.put(newRanges.map(range => range.toJSON()), col);
    }));
  }

  async updateAccessTime_(transaction) {
    const metadataStore = transaction.objectStore(STORE_METADATA);
    await metadataStore.put(new Date().toISOString(), ACCESS_TIME_KEY);
  }

  async writeData_(transaction, data) {
    const dataStore = transaction.objectStore(STORE_DATA);
    await Promise.all(data.map(async datum => {
      // Merge with existing data
      const prev = await dataStore.get(datum.revision);
      const next = Object.assign({}, prev, datum);
      await dataStore.put(next, datum.revision);
    }));
  }

  writeMetadata_(transaction, metadata) {
    const metadataStore = transaction.objectStore(STORE_METADATA);
    for (const [key, value] of Object.entries(metadata)) {
      metadataStore.put(value, key);
    }
  }
}

TimeseriesCacheRequest.databaseName = ({
  timeseries, testSuite, measurement, bot, testCase = '', buildType = '',
}) => `timeseries/${testSuite}/${measurement}/${bot}/${testCase}/${buildType}`;
