/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import Range from './range.js';
import {CacheRequestBase, READONLY, READWRITE} from './cache-request-base.js';


/**
 * Timeseries are stored in IndexedDB to optimize the speed of ranged reading.
 * Here is the structure in TypeScript:
 *
 *   type ReportDatabase = {
 *     // Reports for each row, indexed by revision
 *     reports: {
 *       [revision: number]: [Report]
 *     },
 *
 *     // Data that doesn't change between revisions
 *     metadata: {
 *       rows: [Row],    // List of rows for this template
 *       modified: Date, // If this doesn't match, get rid of existing data.
 *
 *       // General data for the template
 *       editable: boolean,
 *       name: string,
 *       internal: boolean,
 *       owners: [string],
 *       statistics: [string]
 *     }
 *   }
 *
 *   type Row = {
 *     bots: [string],
 *     improvement_direction: number,
 *     label: string,
 *     measurement: string,
 *     testCases: [string],
 *     testSuites: [string],
 *     units: string
 *   }
 *
 *   type Report = {
 *     descriptors: [Descriptor],
 *     statistics: any, // see RunningStatistics.fromDict()
 *     // revision: number, // not being used
 *   }
 *
 *   type Descriptor = {
 *     bot: string,
 *     testCase: string,
 *     testSuite: string
 *   }
 *
 */

// Constants for the database structure
const STORE_REPORTS = 'reports';
const STORE_METADATA = 'metadata';
const STORES = [STORE_REPORTS, STORE_METADATA];

export default class ReportCacheRequest extends CacheRequestBase {
  constructor(fetchEvent) {
    super(fetchEvent);
    const {searchParams} = new URL(fetchEvent.request.url);

    const id = searchParams.get('id');
    if (!id) {
      throw new Error('ID is not specified for this report request!');
    }

    this.templateId_ = parseInt(id);
    if (isNaN(this.templateId_)) {
      throw new Error('Template ID is not a real number!');
    }

    const modified = searchParams.get('modified');
    if (!modified) {
      throw new Error('Modified is not specified for this report request!');
    }
    this.modified_ = parseInt(modified);
    if (isNaN(this.modified_)) {
      throw new Error(`Modified is not a valid number: ${modified}`);
    }

    const revisions = searchParams.get('revisions');
    if (!revisions) {
      throw new Error('Revisions is not specified for this report request!');
    }
    this.revisions_ = revisions.split(',');

    // Data can be stale if the template was modified after being stored on
    // IndexedDB. This value is modified in read() and later used in write().
    this.isTemplateDifferent_ = false;
  }

  get timingCategory() {
    return 'Reports';
  }

  get databaseName() {
    return ReportCacheRequest.databaseName({id: this.templateId_});
  }

  get databaseVersion() {
    return 1;
  }

  async upgradeDatabase(db) {
    if (db.oldVersion < 1) {
      db.createObjectStore(STORE_REPORTS);
      db.createObjectStore(STORE_METADATA);
    }
  }

  async read(db) {
    const transaction = db.transaction(STORES, READONLY);

    // Start all asynchronous actions at once then "await" only the results
    // needed.
    const reportsPromise = this.getReports_(transaction);
    const metadataPromises = {
      editable: this.getMetadata_(transaction, 'editable'),
      internal: this.getMetadata_(transaction, 'internal'),
      modified: this.getMetadata_(transaction, 'modified'),
      name: this.getMetadata_(transaction, 'name'),
      owners: this.getMetadata_(transaction, 'owners'),
      rows: this.getMetadata_(transaction, 'rows'),
      statistics: this.getMetadata_(transaction, 'statistics'),
    };

    // Check the "modified" query parameter to verify that the template was not
    // modified after storing the data on IndexedDB. Returns true if the data is
    // stale and needs to be rewritten; otherwise, false.
    const lastModified = await metadataPromises.modified;
    if (typeof lastModified !== 'number') return;
    if (lastModified !== this.modified_) {
      this.isTemplateDifferent_ = true;
      return;
    }

    const rows = await metadataPromises.rows;

    // Rows is undefined when no data has been cached yet.
    if (!Array.isArray(rows)) return;

    const reportsByRevision = await reportsPromise;

    // Check if there are no matching revisions
    if (Object.keys(reportsByRevision).length === 0) return;

    return {
      editable: await metadataPromises.editable,
      id: this.templateId_,
      internal: await metadataPromises.internal,
      name: await metadataPromises.name,
      owners: await metadataPromises.owners,
      report: {
        rows: this.mergeRowsWithReports_(rows, reportsByRevision),
        statistics: await metadataPromises.statistics,
      },
    };
  }

  // Merge row metadata with report data indexed by revision.
  mergeRowsWithReports_(rows, reportsByRevision) {
    return rows.map((row, rowIndex) => {
      const data = {};
      for (const revision of this.revisions_) {
        if (!Array.isArray(reportsByRevision[revision])) continue;
        if (!reportsByRevision[revision][rowIndex]) continue;
        data[revision] = reportsByRevision[revision][rowIndex];
      }
      return {
        ...row,
        data,
      };
    });
  }

  async getReports_(transaction) {
    const timing = this.time('Read - Reports');
    const reportStore = transaction.objectStore(STORE_REPORTS);

    const reportsByRevision = {};
    await Promise.all(this.revisions_.map(async(revision) => {
      const reports = await reportStore.get(revision);
      if (reports) {
        reportsByRevision[revision] = reports;
      }
    }));

    timing.end();
    return reportsByRevision;
  }

  async getMetadata_(transaction, key) {
    const timing = this.time('Read - Metadata');
    const metadataStore = transaction.objectStore(STORE_METADATA);
    const result = await metadataStore.get(key);
    timing.end();
    return result;
  }

  async write(db, networkResults) {
    const {report: networkReport, ...metadata} = networkResults;
    const {rows: networkRows, statistics} = networkReport;

    const transaction = db.transaction(STORES, READWRITE);
    await Promise.all([
      this.writeReports_(transaction, networkResults),
      this.writeMetadata_(transaction, networkResults),
    ]);

    const timing = this.time('Write - Queued Tasks');
    await transaction.complete;
    timing.end();
  }

  async writeReports_(transaction, networkResults) {
    const reportStore = transaction.objectStore(STORE_REPORTS);

    // When the report template changes, reports may pertain to different
    // benchmarks.
    if (this.isTemplateDifferent_) {
      await reportStore.clear();
    }

    // Organize reports by revision to optimize for reading by revision.
    const reportsByRevision = getReportsByRevision(networkResults.report.rows);

    // Store reportsByRevision in the "reports" object store.
    for (const [revision, reports] of Object.entries(reportsByRevision)) {
      reportStore.put(reports, revision);
    }
  }

  async writeMetadata_(transaction, networkResults) {
    const metadataStore = transaction.objectStore(STORE_METADATA);

    // When the report template changes, any portion of the metadata can change.
    if (this.isTemplateDifferent_) {
      await metadataStore.clear();
    }

    const {report: networkReport, ...metadata} = networkResults;
    const {rows: networkRows, statistics} = networkReport;

    // Store everything in "rows" but "data"; that belongs in the "reports"
    // store, which is handled by `writeReports_`.
    const rows = networkRows.map(({data: _, ...row}) => row);

    metadataStore.put(rows, 'rows');
    metadataStore.put(statistics, 'statistics');
    metadataStore.put(this.modified_, 'modified');

    for (const [key, value] of Object.entries(metadata)) {
      metadataStore.put(value, key);
    }
  }
}

ReportCacheRequest.databaseName = (options) => `report/${options.id}`;

function getReportsByRevision(networkRows) {
  const reportsByRevision = {};

  for (let i = 0; i < networkRows.length; ++i) {
    const {data} = networkRows[i];

    for (const [revision, report] of Object.entries(data)) {
      // Verify there is an array of reports for this revision.
      if (!Array.isArray(reportsByRevision[revision])) {
        reportsByRevision[revision] = [];
      }

      // Add this report to the corresponding row.
      reportsByRevision[revision][i] = report;
    }
  }

  return reportsByRevision;
}
