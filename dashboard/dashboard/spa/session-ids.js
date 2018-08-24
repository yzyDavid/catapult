/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class SessionIdRequest extends cp.RequestBase {
    constructor(options) {
      super(options);
      this.method_ = 'POST';
      this.headers_.set('Content-type', 'application/x-www-form-urlencoded');
      this.body_ = 'page_state=' + encodeURIComponent(options.sessionStateJson);
    }

    async localhostResponse_() {
      return {};
    }

    get url_() {
      return '/short_uri';
    }

    postProcess_(json) {
      return json.sid;
    }
  }

  // The request handler always computes the SHA256 of the sessionStateJson, so
  // the frontend can duplicate that logic and use the expectedResponse without
  // waiting for the backend to return a predictable response.

  class SessionIdCache extends cp.CacheBase {
    constructor(options, dispatch, getState) {
      super(options, dispatch, getState);
      this.sessionStateJson_ = JSON.stringify(this.options_.sessionState);
    }

    get cacheStatePath_() {
      return 'storedSessionIds';
    }

    get defaultCacheState_() {
      return new Set();
    }

    async computeCacheKey_() {
      const sessionId = await cp.sha(this.sessionStateJson_);
      if (this.options_.sessionIdCallback) {
        this.options_.sessionIdCallback(sessionId);
      }
      return sessionId;
    }

    get isInCache_() {
      return this.rootState_.storedSessionIds.has(this.cacheKey_);
    }

    async readFromCache_() {
      return this.cacheKey_; // Yep, this is it!
    }

    createRequest_() {
      return new SessionIdRequest({sessionStateJson: this.sessionStateJson_});
    }

    onStartRequest_(request) {
      this.dispatch_({
        type: SessionIdCache.reducers.storeSessionId.name,
        sessionId: this.cacheKey_,
      });
    }

    onFinishRequest_(actual) {
      if (window.IS_DEBUG) return;
      if (actual === this.cacheKey_) return;
      // eslint-disable-next-line no-console
      console.error('WRONG sessionId!', {expected: this.cacheKey_, actual});
    }
  }

  SessionIdCache.reducers = {
    storeSessionId: (rootState, action, rootStateAgain) => {
      const storedSessionIds = new Set(rootState.storedSessionIds);
      storedSessionIds.add(action.sessionId);
      return {...rootState, storedSessionIds};
    },
  };

  Redux.registerReducers(SessionIdCache.reducers, [
    Redux.renameReducer('SessionIdCache.'),
    ...Redux.DEFAULT_REDUCER_WRAPPERS,
  ]);


  const readSessionId = options => async(dispatch, getState) =>
    await new SessionIdCache(options, dispatch, getState).read();

  return {
    readSessionId,
  };
});
