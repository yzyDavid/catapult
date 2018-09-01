/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class DescribeRequest extends cp.RequestBase {
    constructor(options) {
      super(options);
      this.testSuite_ = options.testSuite;
    }

    get url_() {
      // The TestSuitesHandler doesn't use this query parameter, but it helps
      // the browser cache understand that it returns different data depending
      // on whether the user is authorized to access internal data.
      let internal = '';
      if (this.headers_.has('Authorization')) internal = '?internal';
      return `/api/describe/${this.testSuite_}${internal}`;
    }

    async localhostResponse_() {
      return {
        bots: [
          'master:bot0',
          'master:bot1',
          'master:bot2',
        ],
        measurements: [
          'memory:a_size',
          'memory:b_size',
          'memory:c_size',
          'cpu:a',
          'cpu:b',
          'cpu:c',
          'power',
          'loading',
          'startup',
          'size',
        ],
        caseTags: {
          'ggg': [
            'browse:media:imgur',
            'load:media:imgur',
            'search:portal:google',
          ],
          'lll': [
            'browse:news:flipboard',
            'load:chrome:blank',
          ],
        },
        cases: [
          'browse:media:facebook_photos',
          'browse:media:imgur',
          'browse:media:youtube',
          'browse:news:flipboard',
          'browse:news:hackernews',
          'browse:news:nytimes',
          'browse:social:facebook',
          'browse:social:twitter',
          'load:chrome:blank',
          'load:games:bubbles',
          'load:games:lazors',
          'load:games:spychase',
          'load:media:google_images',
          'load:media:imgur',
          'load:media:youtube',
          'search:portal:google',
        ],
      };
    }

    postProcess_(json) {
      if (json.unparsed) {
        // eslint-disable-next-line no-console
        console.log(json.unparsed);
        return undefined;
      }
      return json;
    }
  }

  class TestSuiteDescriptorCache extends cp.CacheBase {
    get cacheStatePath_() {
      let internal = '';
      if (this.rootState_.userEmail) internal = 'Internal';
      return 'testSuiteDescriptors' + internal;
    }

    computeCacheKey_() {
      return this.options_.testSuite.replace(/\./g, '_');
    }

    get isInCache_() {
      return this.rootState_[this.cacheStatePath_][this.cacheKey_] !==
        undefined;
    }

    async readFromCache_() {
      // The cache entry may be a promise: see onStartRequest_().
      return await this.rootState_[this.cacheStatePath_][this.cacheKey_];
    }

    createRequest_() {
      return new DescribeRequest({testSuite: this.options_.testSuite});
    }

    onStartRequest_(request) {
      this.dispatch_(Redux.UPDATE(this.cacheStatePath_, {
        [this.cacheKey_]: request.response,
      }));
    }

    onFinishRequest_(result) {
      this.dispatch_(Redux.UPDATE(this.cacheStatePath_, {
        [this.cacheKey_]: result,
      }));
    }
  }

  function mergeDescriptor(merged, descriptor) {
    for (const bot of descriptor.bots) merged.bots.add(bot);
    for (const measurement of descriptor.measurements) {
      merged.measurements.add(measurement);
    }
    for (const testCase of descriptor.cases) {
      merged.testCases.add(testCase);
    }
    for (const [tag, cases] of Object.entries(descriptor.caseTags || {})) {
      if (!merged.testCaseTags.has(tag)) {
        merged.testCaseTags.set(tag, new Set());
      }
      for (const testCase of cases) {
        merged.testCaseTags.get(tag).add(testCase);
      }
    }
  }

  const ReadTestSuiteDescriptors = options =>
    async function* (dispatch, getState) {
      const promises = options.testSuites.map(testSuite =>
        new TestSuiteDescriptorCache({testSuite}, dispatch, getState).read());
      const mergedDescriptor = {
        measurements: new Set(),
        bots: new Set(),
        testCases: new Set(),
        testCaseTags: new Map(),
      };
      const iterator = new cp.BatchIterator(promises);
      for await (const {results, errors} of iterator) {
        for (const descriptor of results) {
          if (!descriptor) continue;
          mergeDescriptor(mergedDescriptor, descriptor);
        }
        yield mergedDescriptor;
      }
    };

  const PrefetchTestSuiteDescriptors = options => async(dispatch, getState) => {
    const reader = ReadTestSuiteDescriptors(options)(dispatch, getState);
    for await (const _ of reader) {
      // The descriptors are not actually needed here, but
      // ReadTestSuiteDescriptors only actually fetches the data if the async
      // generator is pumped.
    }
  };

  return {
    PrefetchTestSuiteDescriptors,
    ReadTestSuiteDescriptors,
  };
});
