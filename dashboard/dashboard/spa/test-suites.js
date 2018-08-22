/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class TestSuitesRequest extends cp.RequestBase {
    get url_() {
      // The TestSuitesHandler doesn't use this query parameter, but it helps
      // the browser cache understand that it returns different data depending
      // on whether the user is authorized to access internal data.
      let internal = '';
      if (this.headers_.has('Authorization')) internal = '?internal';
      return `/api/test_suites${internal}`;
    }

    async localhostResponse_() {
      return [
        'system_health.common_desktop',
        'system_health.common_mobile',
        'system_health.memory_desktop',
        'system_health.memory_mobile',
      ];
    }
  }

  class TestSuitesCache extends cp.CacheBase {
    computeCacheKey_() {
      let internal = '';
      if (this.rootState_.userEmail) internal = 'Internal';
      return `testSuites${internal}`;
    }

    get isInCache_() {
      return this.rootState_[this.cacheKey_] !== undefined;
    }

    async readFromCache_() {
      // The cache entry may be a promise: see onStartRequest_().
      return await this.rootState_[this.cacheKey_];
    }

    createRequest_() {
      return new TestSuitesRequest({});
    }

    onStartRequest_(request) {
      this.dispatch_(Redux.UPDATE('', {
        [this.cacheKey_]: request.response,
      }));
    }

    onFinishRequest_(result) {
      this.dispatch_(Redux.UPDATE('', {
        [this.cacheKey_]: result,
      }));
    }
  }

  const ReadTestSuites = () => async(dispatch, getState) =>
    await new TestSuitesCache({}, dispatch, getState).read();

  return {
    ReadTestSuites,
  };
});
