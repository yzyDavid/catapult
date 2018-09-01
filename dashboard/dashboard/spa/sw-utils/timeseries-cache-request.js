/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import Range from './range.js';
import {CacheRequestBase} from './cache-request-base.js';


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

// Constants for the database structure
const STORE_DATA = 'data';
const STORE_METADATA = 'metadata';
const STORE_RANGES = 'ranges';
const STORES = [STORE_DATA, STORE_METADATA, STORE_RANGES];

// Constants for IndexedDB options
const TRANSACTION_MODE_READONLY = 'readonly';
const TRANSACTION_MODE_READWRITE = 'readwrite';


export default class TimeseriesCacheRequest extends CacheRequestBase {
  constructor(request) {
    super(request);
    const {searchParams} = new URL(request.url);

    this.statistic_ = searchParams.get('statistic');
    if (!this.statistic_) {
      throw new Error('Statistic was not specified');
    }

    this.levelOfDetail_ = searchParams.get('level_of_detail');
    if (!this.levelOfDetail_) {
      throw new Error('Level Of Detail was not specified');
    }

    const columns = searchParams.get('columns');
    if (!columns) {
      throw new Error('Columns was not specified');
    }
    this.columns_ = columns.split(',');

    const maxRevision = searchParams.get('max_revision');
    this.maxRevision_ = parseInt(maxRevision) || undefined;

    const minRevision = searchParams.get('min_revision');
    this.minRevision_ = parseInt(minRevision) || undefined;

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

  async read(db) {
    const transaction = db.transaction(STORES, TRANSACTION_MODE_READONLY);

    const dataPointsPromise = this.getDataPoints_(transaction);
    const [
      improvementDirection,
      units,
      ranges,
    ] = await Promise.all([
      this.getMetadata_(transaction, 'improvement_direction'),
      this.getMetadata_(transaction, 'units'),
      this.getRanges_(transaction),
    ]);

    if (!ranges) {
      // Nothing has been cached for this level-of-detail yet.
      return;
    }

    if (!this.containsRelevantRanges_(ranges)) return;

    const dataPoints = await dataPointsPromise;
    const data = this.denormalize_(dataPoints);

    return {
      improvement_direction: improvementDirection,
      units,
      data,
    };
  }

  containsRelevantRanges_(ranges) {
    const requestedRange = Range.fromExplicitRange(this.minRevision_,
        this.maxRevision_);

    if (!requestedRange.isEmpty) {
      const intersectingRangeIndex = ranges
          .findIndex(rangeDict => {
            const range = Range.fromDict(rangeDict);
            const intersection = range.findIntersection(requestedRange);
            return !intersection.isEmpty;
          });

      if (intersectingRangeIndex === -1) {
        return false;
      }
    }

    return true;
  }

  /**
   * Denormalize converts the object result from IndexedDB into a tuple with the
   * order specified by the HTTP request's "columns" search parameter.
   *
   * Data point:
   *
   *   {
   *     revision: 564174,
   *     timestamp: "2018-06-05T00:24:35.140250",
   *     avg: 2322.302789,
   *   }
   *
   * Tuple w/ headers ['revision', 'timestamp', 'avg']:
   *
   *   [564174, "2018-06-05T00:24:35.140250", 2322.302789]
   *
   */
  denormalize_(dataPoints) {
    const timing = this.time('Read - Denormalize');

    const denormalizedDatapoints = [];
    for (const dataPoint of dataPoints) {
      const result = [];
      for (const column of this.columns_) {
        result.push(dataPoint[column]);
      }
      denormalizedDatapoints.push(result);
    }

    timing.end();
    return denormalizedDatapoints;
  }

  async getMetadata_(transaction, key) {
    const timing = this.time('Read - Metadata');
    const metadataStore = transaction.objectStore(STORE_METADATA);
    const result = await metadataStore.get(key);
    timing.end();
    return result;
  }

  async getRanges_(transaction) {
    const timing = this.time('Read - Ranges');
    const rangeStore = transaction.objectStore(STORE_RANGES);
    const ranges = await rangeStore.get(this.levelOfDetail_);
    timing.end();
    return ranges;
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

  async write(db, networkResults) {
    const {data: networkData, ...metadata} = networkResults;

    if (metadata.error) return;
    if (!Array.isArray(networkData) || networkData.length === 0) return;

    const data = this.normalize_(networkData);

    const transaction = db.transaction(STORES, TRANSACTION_MODE_READWRITE);
    await Promise.all([
      this.writeData_(transaction, data),
      this.writeRanges_(transaction, data),
    ]);
    this.writeMetadata_(transaction, metadata);

    const timing = this.time('Write - Queued Tasks');
    await transaction.complete;
    timing.end();
  }

  /**
   * Normalize maps each unnamed column to its cooresponding name in the
   * QueryParams. Returns an object with key/value pairs representing
   * column/value pairs. Each datapoint will have a structure similar to the
   * following:
   *   {
   *     revision: 12345,
   *     [statistic]: 42
   *   }
   */
  normalize_(networkData) {
    const timing = this.time('Write - Normalize');

    const data = (networkData || []).map(datum => {
      const normalizedDatum = {};
      for (let i = 0; i < this.columns_.length; ++i) {
        normalizedDatum[this.columns_[i]] = datum[i];
      }
      return normalizedDatum;
    });

    timing.end();
    return data;
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

  async writeRanges_(transaction, data) {
    const timing = this.time('Write - Ranges');

    const firstDatum = data[0] || {};
    const lastDatum = data[data.length - 1] || {};

    const min = this.minRevision_ ||
      firstDatum.revision ||
      undefined;

    const max = this.maxRevision_ ||
      lastDatum.revision ||
      undefined;

    if (min || max) {
      const rangeStore = transaction.objectStore(STORE_RANGES);

      const currRange = Range.fromExplicitRange(min, max);
      const prevRangesRaw = await rangeStore.get(this.levelOfDetail_) || [];
      const prevRanges = prevRangesRaw.map(Range.fromDict);

      const nextRanges = currRange
          .mergeIntoArray(prevRanges)
          .map(range => range.toJSON());

      rangeStore.put(nextRanges, this.levelOfDetail_);
    } else {
      new Error('Min/max cannot be found; unable to update ranges');
    }

    timing.end();
  }

  writeMetadata_(transaction, metadata) {
    const metadataStore = transaction.objectStore(STORE_METADATA);

    for (const [key, value] of Object.entries(metadata)) {
      metadataStore.put(value, key);
    }
  }
}

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
  timeseries,
  testSuite,
  measurement,
  bot,
  testCase = '',
  buildType = ''}) => (
  `timeseries/${testSuite}/${measurement}/${bot}/${testCase}/${buildType}`
);
