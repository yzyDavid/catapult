/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  /*
   * Main entry point: actions.load(fetchDescriptor, refStatePath) returns
   * {unit: tr.b.Unit, data: [(tr.v.Histogram|cp.FastHistogram)]}
   *
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
   * Requests return timeseries, which are transformed into FastHistograms and
   * stored on the root state in the following cache structure:
   *
   * {
   *   ...rootState,
   *   timeseries: {
   *     $cacheKey: {
   *       references: [$statePath],
   *       unit: tr.b.Unit,
   *       data: [(FastHistogram|Histogram)],
   *       ranges: {
   *         xy: [tr.b.math.Range],
   *         annotations: [tr.b.math.Range],
   *         histogram: [tr.b.math.Range],
   *       },
   *       requests: {
   *         xy: [
   *           {minRev, maxRev, minTimestampMs, maxTimestampMs, request},
   *         ],
   *         annotations: [...],
   *         histogram: [...],
   *       },
   *     },
   *   },
   * }
   *
   * While a Request is in-flight, it's in the corresponding range in |ranges|.
   * When a Request completes, it's |request| is undefined, but the range
   * remains in Ranges to indicate that its data is stored in
   * timeseries[testPath].data.
   *
   * Requests are cached separately by service-worker.js, so timeseries data
   * can only contain the data that is currently in use by chart-timeseries
   * and pivot-cell elements, as recorded by timeseries[testPath].references,
   * which is a list of statePaths pointing to chart-timeseries and pivot-cell
   * elements' states.
   *
   * The output of this big machine is chart-base.lines[].data.
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

  const LEVEL_OF_DETAIL = {
    // Minimaps only need the (x, y) coordinates to draw the line.
    // FastHistograms contain only revision and the needed statistic.
    // Fetches /api/timeseries2/testpath&columns
    // See `getColumnsByLevelOfDetail` for the columns requested.
    XY: 'xy',

    // chart-pair.chartLayout can draw its lines using XY FastHistograms
    // while asynchronously fetching annotations (e.g.  alerts)
    // for a given revision range for tooltips and icons.
    // If an extant request overlaps a new request, then the new request can
    // fetch the difference and await the extant request.
    // Fetches /api/timeseries2/testpath&min_rev&max_rev&columns
    // See `getColumnsByLevelOfDetail` for the columns requested.
    ANNOTATIONS: 'annotations',

    // pivot-table in chart-section and pivot-section need the full real
    // Histogram with all its statistics and diagnostics and samples.
    // chart-section will also request the full Histogram for the last point in
    // each timeseries in order to get its RelatedNameMaps.
    // Real Histograms contain full RunningStatistics, all diagnostics, all
    // samples. Request single Histograms at a time, even if the user brushes a
    // large range.
    // Fetches /api/histogram/testpath?rev
    HISTOGRAM: 'histogram',
  };

  function getColumnsByLevelOfDetail(levelOfDetail, statistic) {
    switch (levelOfDetail) {
      case LEVEL_OF_DETAIL.XY:
        return ['revision', 'timestamp', statistic];
      case LEVEL_OF_DETAIL.ANNOTATIONS:
        return ['revision', 'alert', 'diagnostics', 'revisions'];
      case LEVEL_OF_DETAIL.HISTOGRAMS:
        return ['revision', 'histogram'];
      default:
        throw new Error(`${level} is not a valid Level Of Detail`);
    }
  }

  // Supports XY and ANNOTATIONS levels of detail.
  // [Re]implements only the Histogram functionality needed for those levels.
  // Can be merged with real Histograms.
  class FastHistogram {
    constructor() {
      this.diagnostics = new tr.v.d.DiagnosticMap();
      // TODO use tr.b.math.RunningStatistic
      this.running = {count: 0, avg: 0, std: 0};
    }

    addHistogram(other) {
      this.diagnostics.addDiagnostics(other.diagnostics);
      const deltaMean = this.running.avg - other.running.avg;
      this.running.avg = ((this.running.avg * this.running.count) +
                          (other.running.avg * other.running.count)) /
                         (this.running.count + other.running.count);
      const thisVar = this.running.std * this.running.std;
      const otherVar = other.running.std * other.running.std;
      const thisCount = this.running.count;
      this.running.count += other.running.count;
      this.running.std = Math.sqrt(thisVar + otherVar + (
        thisCount * other.running.count * deltaMean * deltaMean /
        this.running.count));
    }
  }

  FastHistogram.fromRow = (dict, fetchDescriptor, conversionFactor) => {
    const hist = new FastHistogram();
    const commitPos = dict.revision;
    if (commitPos !== null && commitPos !== undefined) {
      hist.diagnostics.set(
          tr.v.d.RESERVED_NAMES.CHROMIUM_COMMIT_POSITIONS,
          new tr.v.d.GenericSet([parseInt(commitPos)]));
    }

    if (dict.timestamp) {
      hist.diagnostics.set(
          tr.v.d.RESERVED_NAMES.UPLOAD_TIMESTAMP,
          new tr.v.d.DateRange(new Date(dict.timestamp) - 0));
    }
    if (dict.value !== undefined) {
      hist.running[fetchDescriptor.statistic] = dict.value * conversionFactor;
    }
    if (dict.avg !== undefined) {
      hist.running.avg = dict.avg * conversionFactor;
    }
    if (dict.error !== undefined) {
      hist.running.std = dict.error * conversionFactor;
    }
    hist.running.count = 1;
    return hist;
  };

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
     *   levelOfDetail: cp.LEVEL_OF_DETAIL
     *
     *   // Commit revision range
     *   minRevision?: number,
     *   maxRevision?: number,
     * }
     */
    constructor(options) {
      super(options);
      this.measurement_ = options.measurement;
      this.queryParams_ = new URLSearchParams();
      this.queryParams_.set('test_suite', options.testSuite);
      this.queryParams_.set('measurement', options.measurement);
      this.queryParams_.set('bot', options.bot);

      if (options.testCase) {
        this.queryParams_.set('test_case', options.testCase);
      }

      if (options.statistic) {
        this.queryParams_.set('statistic', options.statistic);
      }

      // Question(Sam): What is buildType?
      if (options.buildType) {
        this.queryParams_.set('build_type', options.buildType);
      }

      const columns = getColumnsByLevelOfDetail(
          options.levelOfDetail, options.statistic);
      this.queryParams_.set('columns', columns);
      this.queryParams_.set('level_of_detail', options.levelOfDetail);

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

  // TODO(sbalana): Create a base class for iterative retrieval of cached data
  // through use of asynchronous iterators. This functionality is being
  // monkeypatched by `TimeseriesCache#reader()`.
  class TimeseriesCache extends cp.CacheBase {
    constructor(options, dispatch, getState) {
      super(options, dispatch, getState);

      if (!options.lineDescriptor) throw new Error('lineDescriptor required');
      if (!options.fetchDescriptor) throw new Error('fetchDescriptor required');
      if (!options.refStatePath) throw new Error('refStatePath required');

      this.lineDescriptor_ = this.options_.lineDescriptor;
      this.fetchDescriptor_ = this.options_.fetchDescriptor;
      this.refStatePath_ = this.options_.refStatePath;

      this.minRevision_ = this.options_.minRevision;
      this.maxRevision_ = this.options_.maxRevision;

      this.levelOfDetail_ = this.fetchDescriptor_.levelOfDetail;
      this.columns_ = getColumnsByLevelOfDetail(
          this.levelOfDetail_, this.fetchDescriptor_.statistic);
    }

    get cacheStatePath_() {
      return 'timeseries';
    }

    computeCacheKey_() {
      const {
        testSuite = '',
        measurement = '',
        bot = '',
        testCase = '',
        buildType = '',
      } = this.fetchDescriptor_;
      const key = `${testSuite}/${measurement}/${bot}/${testCase}/${buildType}`;
      return key.replace(/\./g, '_');
    }

    get isInCache_() {
      const entry = this.rootState_.timeseries[this.cacheKey_];

      if (!entry) {
        // The requested timeseries data has not been retrieved yet.
        return false;
      }

      const ranges = entry.ranges[this.fetchDescriptor_.levelOfDetail];

      if (!Array.isArray(ranges)) {
        return false;
      }

      const requestedRange = tr.b.math.Range.fromExplicitRange(
          this.minRevision_, this.maxRevision_);

      const rangeIndex = ranges.findIndex(range =>
        range.containsRangeInclusive(requestedRange)
      );

      if (rangeIndex === -1) {
        // The requested range of data cannot be found in a contiguous chunk.
        return false;
      }

      return true;
    }

    async readFromCache_() {
      let entry = this.rootState_.timeseries[this.cacheKey_];
      await Promise.all(entry.requests[this.levelOfDetail_].map(
          rangeRequest => rangeRequest.completion
      ));
      this.rootState_ = this.getState_();
      entry = this.rootState_.timeseries[this.cacheKey_];
      return {
        unit: entry.unit,
        data: entry.data
      };
    }

    createRequest_() {
      return new TimeseriesRequest({
        testSuite: this.fetchDescriptor_.testSuite,
        measurement: this.fetchDescriptor_.measurement,
        bot: this.fetchDescriptor_.bot,
        testCase: this.fetchDescriptor_.testCase,
        statistic: this.fetchDescriptor_.statistic,
        buildType: this.fetchDescriptor_.buildType,
        levelOfDetail: this.fetchDescriptor_.levelOfDetail,

        minRevision: this.minRevision_,
        maxRevision: this.maxRevision_,
      });
    }

    onStartRequest_(request, completion) {
      this.dispatch_({
        type: TimeseriesCache.reducers.request.name,
        fetchDescriptor: this.fetchDescriptor_,
        cacheKey: this.cacheKey_,
        refStatePath: this.refStatePath_,
        request,
        completion,
      });
      this.rootState_ = this.getState_();
    }

    onFinishRequest_(networkResponse) {
      this.dispatch_({
        type: TimeseriesCache.reducers.receive.name,
        fetchDescriptor: this.fetchDescriptor_,
        cacheKey: this.cacheKey_,
        columns: this.columns_,
        timeseries: networkResponse.data,
        units: networkResponse.units,
        minRevision: this.findMinRevision_(networkResponse),
        maxRevision: this.findMaxRevision_(networkResponse),
      });
      this.rootState_ = this.getState_();
    }

    findMinRevision_(networkResponse) {
      if (this.minRevision_) {
        return this.minRevision_;
      }

      const timeseries = networkResponse.data || [];
      if (timeseries.length && timeseries[0]) {
        return timeseries[0].revision;
      }
    }

    findMaxRevision_(networkResponse) {
      if (this.maxRevision_) {
        return this.maxRevision_;
      }

      const timeseries = networkResponse.data || [];
      if (timeseries.length && timeseries[timeseries.length - 1]) {
        return timeseries[timeseries.length - 1].revision;
      }
    }

    async* reader() {
      this.ensureCacheState_();
      this.cacheKey_ = this.computeCacheKey_();

      // If we already have all the data in Redux, we don't need to make an
      // outgoing request; instead, yield the data we have.
      if (this.isInCache_) {
        yield await this.readFromCache_();
        return;
      }

      const request = this.createRequest_();
      const fullUrl = location.origin + request.url_;
      const listener = new cp.ServiceWorkerListener(fullUrl);

      this.onStartRequest_(request);
      const response = await request.response;

      // Cached results will first yield with an empty object then send the
      // actual result through a BroadcastChannel to avoid useless JSON parsing.
      // ServiceWorkerListener is listening for messages received on the
      // BroadcastChannel.
      if (response) {
        this.onFinishRequest_(response);
        const timeseries = await this.readFromCache_();
        yield {
          timeseries,
          lineDescriptor: this.lineDescriptor_,
        };
      }

      for await (const update of listener) {
        this.onFinishRequest_(update);
        const timeseries = await this.readFromCache_();
        yield {
          timeseries,
          lineDescriptor: this.lineDescriptor_,
        };
      }
    }
  }

  function csvRow(columns, cells) {
    const dict = {};
    for (let i = 0; i < columns.length; ++i) {
      dict[columns[i]] = cells[i];
    }
    return dict;
  }

  TimeseriesCache.reducers = {
    /*
     * type action = {
     *   request: any,
     *   cacheKey: string,
     *   refStatePath: string,
     *   fetchDescriptor: any,
     *   completion: Promise<any>,
     * }
     */
    request: (rootState, action) => {
      // Store action.request in
      // rootState.timeseries[cacheKey].requests[levelOfDetail]

      let timeseries;
      if (rootState.timeseries) {
        timeseries = rootState.timeseries[action.cacheKey];
      }

      const references = [action.refStatePath];
      let requests;
      if (timeseries) {
        references.push(...timeseries.references);
        requests = {...timeseries.requests};
        requests[action.fetchDescriptor.levelOfDetail] = [
          ...requests[action.fetchDescriptor.levelOfDetail],
        ];
      } else {
        requests = {
          [LEVEL_OF_DETAIL.XY]: [],
          [LEVEL_OF_DETAIL.ANNOTATIONS]: [],
          [LEVEL_OF_DETAIL.HISTOGRAM]: [],
        };
      }

      requests[action.fetchDescriptor.levelOfDetail].push({
        request: action.request,
        completion: action.completion,

        // Some of these might be undefined. shouldFetch will need to handle
        // that. reducers.receive will populate all of them.
        minRev: action.fetchDescriptor.minRev,
        maxRev: action.fetchDescriptor.maxRev,
        minTimestampMs: action.fetchDescriptor.minTimestampMs,
        maxTimestampMs: action.fetchDescriptor.maxTimestampMs,
      });

      const ranges = {};
      for (const lod of Object.values(LEVEL_OF_DETAIL)) {
        ranges[lod] = [];
      }

      return {
        ...rootState,
        timeseries: {
          ...rootState.timeseries,
          [action.cacheKey]: {
            ...timeseries,
            references,
            requests,
            data: [],
            ranges,
            unit: tr.b.Unit.byName.unitlessNumber,
          },
        },
      };
    },

    /*
     * type action = {
     *   fetchDescriptor: any,
     *   cacheKey: string,
     *   columns: [string],
     *   timeseries: [any],
     *   units: string,
     *   minRevision?: number,
     *   maxRevision?: number,
     * };
     */
    receive: (rootState, action) => {
      let unit = tr.b.Unit.byJSONName[action.units];
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

      const data = (action.timeseries || []).map(row =>
        FastHistogram.fromRow(
            csvRow(action.columns, row),
            action.fetchDescriptor,
            conversionFactor
        )
      );

      const entry = rootState.timeseries[action.cacheKey];
      const {
        levelOfDetail,
        minRev,
        maxRev,
        minTimestampMs,
        maxTimestampMs,
      } = action.fetchDescriptor;

      // Update ranges
      const rangeReceived = tr.b.math.Range.fromExplicitRange(
          action.minRevision, action.maxRevision);

      // Update requests
      const rangeRequests = entry.requests[levelOfDetail].map(rangeRequest => {
        if (rangeRequest.minRev !== minRev ||
            rangeRequest.maxRev !== maxRev ||
            rangeRequest.minTimestampMs !== minTimestampMs ||
            rangeRequest.maxTimestampMs !== maxTimestampMs) {
          return rangeRequest;
        }
        return {
          ...rangeRequest,
          request: undefined,
          completion: undefined,
        };
      });

      return {
        ...rootState,
        timeseries: {
          ...rootState.timeseries,
          [action.cacheKey]: {
            ...entry,
            requests: {
              ...entry.requests,
              [levelOfDetail]: rangeRequests,
            },
            ranges: {
              ...entry.ranges,
              [levelOfDetail]: rangeReceived.mergeIntoArray(
                  entry.ranges[levelOfDetail]
              ),
            },
            unit,
            data,
          }
        },
      };
    },
  };

  Redux.registerReducers(TimeseriesCache.reducers, [
    Redux.renameReducer('TimeseriesCache.'),
    ...Redux.DEFAULT_REDUCER_WRAPPERS,
  ]);

  const TimeseriesReader = ({dispatch, getState, ...options}) =>
    new TimeseriesCache(options, dispatch, getState).reader();

  return {
    FastHistogram,
    LEVEL_OF_DETAIL,
    TimeseriesReader,
    TimeseriesRequest,
  };
});
