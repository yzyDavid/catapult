/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  /*
   * A lineDescriptor describes a single line in the chart-base.
   * A lineDescriptor must specify
   *  * at least one testSuite
   *  * at least one bot
   *  * exactly one measurement
   *  * exactly one statistic
   *  * zero or more testCases
   *  * buildType (enum 'test' or 'ref')
   * When multiple testSuites, bots, or testCases are specified, the timeseries
   * are merged using RunningStatistics.merge().
   *
   * In order to load the data for a lineDescriptor, one or more
   * fetchDescriptors are generated for /api/timeseries2. See
   * Timeseries2Handler.
   * A fetchDescriptor contains a single testPath, columns, and optionally
   * minRev, maxRev, minTimestampMs, and maxTimestampMs.
   */

  const PRIORITY = {
    // Requests with priority=PREFETCH are not directly blocking the user, so
    // they can wait until either
    // 0. a user gesture increases their priority (e.g. opening a sparkline
    //    tab), or
    // 1. the priority queue is empty, or
    // 2. they are canceled.
    PREFETCH: 1,

    // Additional priorities may be added to support, for example, guessing
    // which PREFETCH requests are more or less likely to become USER requests,
    // or prioritizing requests for earlier sections over requests for sections
    // that are lower on the page.  Priority numbers won't be serialized
    // anywhere, so they can be changed when those features are added, so
    // there's no need to leave room between constants.

    // Requests with priority=USER are directly blocking the user, so always
    // pass them directly to the network.
    USER: 2,
  };

  const LEVEL_OF_DETAIL = Object.freeze({
    XY: 'XY',
    ANNOTATIONS_ONLY: 'ANNOTATIONS_ONLY',
    ANNOTATIONS: 'ANNOTATIONS',
    HISTOGRAM: 'HISTOGRAM',
  });

  function getColumnsByLevelOfDetail(levelOfDetail, statistic) {
    switch (levelOfDetail) {
      case LEVEL_OF_DETAIL.XY: return new Set(['revision', 'timestamp', statistic, 'count']);
      case LEVEL_OF_DETAIL.ANNOTATIONS_ONLY: return new Set(['revision', 'alert', 'diagnostics']);
      case LEVEL_OF_DETAIL.ANNOTATIONS:
        return new Set([
          ...getColumnsByLevelOfDetail(LEVEL_OF_DETAIL.XY, statistic),
          ...getColumnsByLevelOfDetail(LEVEL_OF_DETAIL.ANNOTATIONS_ONLY, statistic),
          'revisions',
        ]);
      case LEVEL_OF_DETAIL.HISTOGRAMS: return new Set(['revision', 'histogram']);
      default: throw new Error(`${levelOfDetail} is not a valid Level Of Detail`);
    }
  }

  function transformDatum(row, columns, unit, conversionFactor, doNormalize=true) {
    // `row` is either an array of values directly from /api/timeseries2, or a
    // dictionary from TimeseriesCacheRequest, depending on doNormalize.
    const datum = (doNormalize ? cp.normalize(columns, row) : row);
    if (datum.alert) datum.alert = cp.AlertsSection.transformAlert(datum.alert);
    if (datum.diagnostics) {
      datum.diagnostics = tr.v.d.DiagnosticMap.fromDict(datum.diagnostics);
    }
    datum.timestamp = new Date(datum.timestamp);
    datum.unit = unit;
    datum.avg *= conversionFactor;
    return datum;
  }

  class TimeseriesRequest extends cp.RequestBase {
    /*
     * type options = {
     *   testSuite: string,
     *   measurement: string,
     *   bot: string,
     *   testCase?: string,
     *   statistic: string,
     *   buildType?: any,
     *
     *   columns: [string],
     *   levelOfDetail: cp.LEVEL_OF_DETAIL,
     *
     *   // Commit revision range
     *   minRevision?: number,
     *   maxRevision?: number,
     * }
     */
    constructor(options) {
      super(options);
      this.method_ = 'POST';
      this.measurement_ = options.measurement;
      this.queryParams_ = new URLSearchParams();
      this.queryParams_.set('test_suite', options.testSuite);
      this.queryParams_.set('measurement', options.measurement);
      this.queryParams_.set('bot', options.bot);

      if (options.testCase) {
        this.queryParams_.set('test_case', options.testCase);
      }

      this.statistic_ = options.statistic || 'avg';
      if (options.statistic) {
        this.queryParams_.set('statistic', options.statistic);
      }

      // Question(Sam): What is buildType?
      if (options.buildType) {
        this.queryParams_.set('build_type', options.buildType);
      }

      this.columns_ = [...getColumnsByLevelOfDetail(
          options.levelOfDetail, this.statistic_)];
      this.queryParams_.set('columns', this.columns_.join(','));

      if (options.minRevision) {
        this.queryParams_.set('min_revision', options.minRevision);
      }
      if (options.maxRevision) {
        this.queryParams_.set('max_revision', options.maxRevision);
      }
      if (options.minTimestamp) {
        this.queryParams_.set('min_timestamp', options.minTimestamp);
      }
      if (options.maxTimestamp) {
        this.queryParams_.set('max_timestamp', options.maxTimestamp);
      }
    }

    postProcess_(response, doNormalize=true) {
      if (!response) return;
      let unit = tr.b.Unit.byJSONName[response.units];
      let conversionFactor = 1;
      if (!unit) {
        const info = tr.v.LEGACY_UNIT_INFO.get(action.units);
        if (info) {
          conversionFactor = info.conversionFactor || 1;
          unit = tr.b.Unit.byName[info.name];
        } else {
          unit = tr.b.Unit.byName.unitlessNumber;
        }
      }

      // The backend returns denormalized (tabular) data, but
      // TimeseriesCacheRequest yields normalized (objects) data for speed.
      // Rely on TimeseriesCacheRequest to merge data from network requests in
      // with previous data, so this code does not need to worry about merging
      // across levels of detail. (Merging data across timeseries is handled by
      // MultiTimeseriesIterator using mergeData().)
      return response.data.map(row => transformDatum(
          row, this.columns_, unit, conversionFactor, doNormalize));
    }

    async* reader() {
      const receiver = new cp.ResultChannelReceiver(this.url_);
      const response = await this.response;
      if (response) yield response;
      for await (const update of receiver) {
        yield this.postProcess_(update, false);
      }
    }

    get url_() {
      return `/api/timeseries2?${this.queryParams_}`;
    }

    async localhostResponse_() {
      let units = 'unitlessNumber';
      if (this.measurement_.startsWith('memory:')) {
        units = 'sizeInBytes_smallerIsBetter';
      }
      if (this.measurement_.startsWith('cpu:') ||
          this.measurement_.startsWith('loading') ||
          this.measurement_.startsWith('startup')) {
        units = 'ms_smallerIsBetter';
      }
      if (this.measurement_.startsWith('power')) {
        units = 'W_smallerIsBetter';
      }
      const data = [];
      const sequenceLength = 100;
      const nowMs = new Date() - 0;
      for (let i = 0; i < sequenceLength; i += 1) {
        // revision, timestamp, value
        data.push([
          i * 100,
          nowMs - ((sequenceLength - i - 1) * (2592105834 / 50)),
          parseInt(100 * Math.random()),
        ]);
      }
      return {data, units};
    }
  }

  return {
    getColumnsByLevelOfDetail,
    LEVEL_OF_DETAIL,
    TimeseriesRequest,
  };
});
