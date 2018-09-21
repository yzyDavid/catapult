/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import Range from './range.js';
import {CacheRequestBase, READONLY, READWRITE} from './cache-request-base.js';

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

// TODO move this to an ES6 module and share with the page.
function denormalize(objects, columnNames) {
  return objects.map(obj => columnsNames.map(col => obj[col]));
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

/**
 * Timeseries are stored in IndexedDB to optimize the speed of ranged reading.
 * Here is the structure in TypeScript:
 *
 *   type TimeseriesDatabase = {
 *     // Data is optimized for range queries
 *     data: {
 *       [revision: number]: Datum
 *     },
 *
 *     // Maintain the ranges of available data
 *     ranges: [Range],
 *
 *     // Miscellaneous data that doesn't change for each datum
 *     metadata: {
 *       improvement_direction: number,
 *       units: string
 *     }
 *   }
 *
 *   type Datum = {
 *     revision: number,
 *     timestamp?: Date,
 *     [statistic: string]: number
 *   }
 *
 *   type Range = [number, number]
 *
 */

const STORE_DATA = 'data';
const STORE_METADATA = 'metadata';
const STORE_RANGES = 'ranges';
const STORES = [STORE_DATA, STORE_METADATA, STORE_RANGES];

const ACCESS_TIME_KEY = '_accessTime';

export default class TimeseriesCacheRequest extends CacheRequestBase {
  constructor(fetchEvent) {
    super(fetchEvent);
    TimeseriesCacheRequest.IN_PROGRESS.push(this);
    const {searchParams} = new URL(fetchEvent.request.url);

    this.statistic_ = searchParams.get('statistic');
    if (!this.statistic_) {
      throw new Error('Statistic was not specified');
    }

    const columns = searchParams.get('columns');
    if (!columns) {
      throw new Error('Columns was not specified');
    }
    this.columns_ = columns.split(',');

    this.maxRevision_ = parseInt(searchParams.get('max_revision')) || undefined;
    this.minRevision_ = parseInt(searchParams.get('min_revision')) || undefined;
    this.revisionRange_ = Range.fromExplicitRange(
        this.minRevision_ || 0, this.maxRevision_ || Number.MAX_SAFE_INTEGER);

    this.testSuite_ = searchParams.get('test_suite') || '';
    this.measurement_ = searchParams.get('measurement') || '';
    this.bot_ = searchParams.get('bot') || '';
    this.testCase_ = searchParams.get('test_case') || '';
    this.buildType_ = searchParams.get('build_type') || '';
  }

  get timingCategory() {
    return 'Timeseries';
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

  get raceCacheAndNetwork_() {
    return async function* () {
      CacheRequestBase.writer.enqueue(() => this.updateAccessTime_());

      const cacheResult = (await this.readCache_()).result;
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

      // If all cols are available for some subrange, then don't fetch that range
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
        yield {...result, data: mergedData};
        CacheRequestBase.writer.enqueue(() =>
          this.writeIDB_({result, range, columns}));
      }
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
    if (this.testCase_) params.test_case = this.testCase_
    let url = new URL(this.fetchEvent.request.url);
    url = url.origin + url.pathname + '?' + new URLSearchParams(params);
    const response = await this.timePromise('Network', fetch(url, {
      method: this.fetchEvent.request.method,
      headers: this.fetchEvent.request.headers,
    }));
    const responseJson = await this.timePromise('Parse JSON', response.json());
    if (responseJson.data) {
      responseJson.data = normalize(responseJson.data, columns);
    }
    return responseJson;
  }

  async read(db) {
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
    return await this.timePromise('Read - Metadata', store.get(key));
  }

  async getRanges_(transaction) {
    const rangeStore = transaction.objectStore(STORE_RANGES);
    const promises = [];
    for (const col of this.columns_) {
      if (col === 'revision') continue;
      promises.push(rangeStore.get(col).then(ranges => [col, ranges]));
    }
    const timing = this.time('Read - Ranges');
    const rangesByCol = await Promise.all(promises);
    timing.end();
    return new Map(rangesByCol);
  }

  async getDataPoints_(transaction) {
    const timing = this.time('Read - Datapoints');
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
    timing.end();
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

  async write(db, {range, columns, result: {data, ...metadata}}) {
    const transaction = db.transaction(STORES, READWRITE);
    await Promise.all([
      this.writeData_(transaction, data),
      this.writeRanges_(transaction, data, range, columns),
    ]);
    this.writeMetadata_(transaction, metadata);
    await this.timePromise('Write - Queued Tasks', transaction.complete);

    const index = TimeseriesCacheRequest.IN_PROGRESS.indexOf(this);
    TimeseriesCacheRequest.IN_PROGRESS.splice(index, 1);
  }

  async updateAccessTime_() {
    const database = await this.openIDB_(this.databaseName);
    const transaction = db.transaction([STORE_METADATA], READWRITE);
    const metadataStore = transaction.objectStore(STORE_METADATA);
    await metadataStore.put(new Date(), ACCESS_TIME_KEY);
  }

  async writeData_(transaction, data) {
    const timing = this.time('Write - Data');
    const dataStore = transaction.objectStore(STORE_DATA);
    for (const datum of data) {
      // Merge with existing data
      const prev = await dataStore.get(datum.revision);
      const next = Object.assign({}, prev, datum);
      dataStore.put(next, datum.revision);
    }
    timing.end();
  }

  async writeRanges_(transaction, data, range, columns) {
    const firstDatum = data[0] || {};
    const lastDatum = data[data.length - 1] || {};
    const min = firstDatum.revision || range.min || undefined;
    let max = lastDatum.revision || undefined;
    if (!max && range.max !== Number.MAX_SAFE_INTEGER) {
      max = range.max;
    }
    if (!min && !max) {
      throw new Error('Min/max cannot be found; unable to update ranges');
    }
    range = Range.fromExplicitRange(min, max);
    const timing = this.time('Write - Ranges');
    const rangeStore = transaction.objectStore(STORE_RANGES);
    await Promise.all(columns.filter(col => col !== 'revision').map(
        async col => {
          const prevRangesRaw = (await rangeStore.get(col)) || [];
          const prevRanges = prevRangesRaw.map(Range.fromDict);
          const newRanges = range.mergeIntoArray(prevRanges);
          rangeStore.put(newRanges.map(range => range.toJSON()), col);
        }));
    timing.end();
  }

  writeMetadata_(transaction, metadata) {
    const metadataStore = transaction.objectStore(STORE_METADATA);
    for (const [key, value] of Object.entries(metadata)) {
      metadataStore.put(value, key);
    }
  }
}

TimeseriesCacheRequest.IN_PROGRESS = [];

/**
 * type options = {
 *   timeseries: string,
 *   testSuite: string,
 *   measurement: string,
 *   bot: string,
 *   testCase?: string,
 *   buildType?: string,
 * }
 */
TimeseriesCacheRequest.databaseName = ({
  timeseries, testSuite, measurement, bot, testCase = '', buildType = '',
}) => `timeseries/${testSuite}/${measurement}/${bot}/${testCase}/${buildType}`;
