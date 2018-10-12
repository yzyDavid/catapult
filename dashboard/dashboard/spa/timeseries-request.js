/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  const LEVEL_OF_DETAIL = Object.freeze({
    XY: 'XY',
    ALERTS: 'ALERTS',
    ANNOTATIONS: 'ANNOTATIONS',
    HISTOGRAM: 'HISTOGRAM',
  });

  function getColumnsByLevelOfDetail(levelOfDetail, statistic) {
    switch (levelOfDetail) {
      case LEVEL_OF_DETAIL.XY:
        return new Set(['revision', 'timestamp', statistic, 'count']);
      case LEVEL_OF_DETAIL.ALERTS:
        return new Set(['revision', 'alert']);
      case LEVEL_OF_DETAIL.ANNOTATIONS:
        return new Set([
          ...getColumnsByLevelOfDetail(LEVEL_OF_DETAIL.XY, statistic),
          ...getColumnsByLevelOfDetail(LEVEL_OF_DETAIL.ALERTS, statistic),
          'diagnostics', 'revisions',
        ]);
      case LEVEL_OF_DETAIL.HISTOGRAMS:
        return new Set(['revision', 'histogram']);
      default:
        throw new Error(`${levelOfDetail} is not a valid Level Of Detail`);
    }
  }

  function transformDatum(
      row, columns, unit, conversionFactor, doNormalize = true) {
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
    constructor(options) {
      super(options);
      this.method_ = 'POST';
      this.measurement_ = options.measurement;
      this.body_ = new FormData();
      this.body_.set('test_suite', options.testSuite);
      this.body_.set('measurement', options.measurement);
      this.body_.set('bot', options.bot);
      if (options.testCase) this.body_.set('test_case', options.testCase);

      this.statistic_ = options.statistic || 'avg';
      if (options.statistic) {
        this.body_.set('statistic', options.statistic);
      }

      if (options.buildType) this.body_.set('build_type', options.buildType);

      this.columns_ = [...getColumnsByLevelOfDetail(
          options.levelOfDetail, this.statistic_)];
      this.body_.set('columns', this.columns_.join(','));

      if (options.minRevision) {
        this.body_.set('min_revision', options.minRevision);
      }
      if (options.maxRevision) {
        this.body_.set('max_revision', options.maxRevision);
      }
    }

    get channelName() {
      return (location.origin + this.url_ + '?' +
              new URLSearchParams(this.body_));
    }

    postProcess_(response, isFromChannel = false) {
      if (!response) return;
      let unit = tr.b.Unit.byJSONName[response.units];
      let conversionFactor = 1;
      if (!unit) {
        const info = tr.v.LEGACY_UNIT_INFO.get(response.units);
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
          row, this.columns_, unit, conversionFactor, !isFromChannel));
    }

    get url_() {
      return '/api/timeseries2';
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
        data.push({
          revision: i * 100,
          timestamp: nowMs - ((sequenceLength - i - 1) * (2592105834 / 50)),
          avg: parseInt(100 * Math.random()),
          count: 1,
          std: parseInt(50 * Math.random()),
          // TODO diagnostics, revisions, alert
        });
      }
      return {data: cp.denormalize(data, this.columns_), units};
    }
  }

  return {
    getColumnsByLevelOfDetail,
    LEVEL_OF_DETAIL,
    TimeseriesRequest,
  };
});
