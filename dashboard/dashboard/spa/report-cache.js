/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ReportRequest extends cp.RequestBase {
    /*
     * type options = {
     *   id: number,
     *   name: string,
     *   modified: Date,
     *   revisions: [number|"latest"],
     * }
     */
    constructor(options) {
      super(options);
      this.name_ = options.name;
      this.revisions_ = options.revisions;
      this.queryParams_ = new URLSearchParams();
      this.queryParams_.set('id', options.id);
      this.queryParams_.set('modified', options.modified.getTime());
      this.queryParams_.set('revisions', this.revisions_);
    }

    get url_() {
      return `/api/report/generate?${this.queryParams_}`;
    }

    async localhostResponse_() {
      const rows = [];
      const dummyRow = measurement => {
        const row = {
          testSuites: ['system_health.common_mobile'],
          bots: ['master:bot0', 'master:bot1', 'master:bot2'],
          testCases: [],
          data: {},
          measurement,
        };
        for (const revision of this.revisions_) {
          row.data[revision] = {
            descriptors: [
              {
                testSuite: 'system_health.common_mobile',
                measurement,
                bot: 'master:bot0',
                testCase: 'search:portal:google',
              },
              {
                testSuite: 'system_health.common_mobile',
                measurement,
                bot: 'master:bot1',
                testCase: 'search:portal:google',
              },
            ],
            statistics: [
              10, 0, 0, Math.random() * 1000, 0, 0, Math.random() * 1000],
            revision,
          };
        }
        return row;
      };

      for (const group of ['Pixel', 'Android Go']) {
        rows.push({
          ...dummyRow('memory:a_size'),
          label: group + ':Memory',
          units: 'sizeInBytes_smallerIsBetter',
        });
        rows.push({
          ...dummyRow('loading'),
          label: group + ':Loading',
          units: 'ms_smallerIsBetter',
        });
        rows.push({
          ...dummyRow('startup'),
          label: group + ':Startup',
          units: 'ms_smallerIsBetter',
        });
        rows.push({
          ...dummyRow('cpu:a'),
          label: group + ':CPU',
          units: 'ms_smallerIsBetter',
        });
        rows.push({
          ...dummyRow('power'),
          label: group + ':Power',
          units: 'W_smallerIsBetter',
        });
      }

      return {
        name: this.name_,
        owners: ['benjhayden@chromium.org', 'benjhayden@google.com'],
        url: window.PRODUCTION_URL,
        report: {rows, statistics: ['avg', 'std']},
      };
    }
  }

  class ReportCache extends cp.CacheBase {
    /*
     * type options = {
     *   id: number,
     *   name: string,
     *   modified: Date,
     *   revisions: [number|"latest"],
     * }
     */
    constructor(options, dispatch, getState) {
      super(options, dispatch, getState);
      this.id_ = options.id;
      this.name_ = options.name;
      this.modified_ = options.modified;
      this.revisions_ = options.revisions;
    }

    get cacheStatePath_() {
      return 'reports';
    }

    computeCacheKey_() {
      const keys = [
        this.id_,
        ...this.revisions_,
      ];
      return keys.join('/').replace(/\./g, '_');
    }

    get isInCache_() {
      const path = `${this.cacheStatePath_}.${this.cacheKey_}`;
      return Polymer.Path.get(this.rootState_, path) !== undefined;
    }

    async readFromCache_() {
      const path = `${this.cacheStatePath_}.${this.cacheKey_}`;
      return await Polymer.Path.get(this.rootState_, path);
    }

    createRequest_() {
      return new ReportRequest({
        id: this.id_,
        name: this.name_,
        modified: this.modified_,
        revisions: this.revisions_,
      });
    }

    onStartRequest_(request) {
      this.dispatch_(Redux.UPDATE(this.cacheStatePath_, {
        [this.cacheKey_]: request.response
      }));
    }

    onFinishRequest_(response) {
      this.dispatch_(Redux.UPDATE(this.cacheStatePath_, {
        [this.cacheKey_]: response
      }));
    }

    async* reader() {
      this.ensureCacheState_();
      this.cacheKey_ = this.computeCacheKey_();

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
        yield response;
      }

      // Wait for the Service Worker to finish all it's tasks.
      for await (const update of listener) {
        this.onFinishRequest_(update);
        yield update;
      }
    }
  }

  /*
   * type options = {
   *   id: number,
   *   name: string,
   *   modified: Date,
   *   revisions: [number|"latest"],
   * }
   */
  const ReportReader = ({dispatch, getState, ...options}) =>
    new ReportCache(options, dispatch, getState).reader();

  return {
    ReportReader,
    ReportRequest,
  };
});
