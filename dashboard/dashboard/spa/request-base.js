/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class RequestBase {
    constructor(options) {
      this.promise_ = undefined;

      this.method_ = 'GET';
      this.headers_ = new Headers(options.headers);
      this.body_ = undefined;

      this.abortController_ = options.abortController;
      if (!this.abortController_ && window.AbortController) {
        this.abortController_ = new window.AbortController();
      }
      this.signal_ = undefined;
      if (this.abortController_) {
        this.signal_ = this.abortController_.signal;
      }
    }

    get response() {
      // Don't call fetch_ before the subclass constructor finishes.
      if (!this.promise_) this.promise_ = this.fetch_();
      return this.promise_;
    }

    async addAuthorizationHeaders_() {
      const headers = await cp.authorizationHeaders();
      for (const [name, value] of headers) {
        this.headers_.set(name, value);
      }
    }

    async fetch_() {
      await this.addAuthorizationHeaders_();

      if (window.IS_DEBUG) {
        // Simulate network latency in order to test loading state e.g. progress
        // bars.
        await cp.timeout(1000);
        return this.postProcess_(await this.localhostResponse_());
      }

      const mark = tr.b.Timing.mark('fetch', this.constructor.name);
      const response = await fetch(this.url_, {
        body: this.body_,
        headers: this.headers_,
        method: this.method_,
        signal: this.signal_,
      });
      mark.end();
      return this.postProcess_(await response.json());
    }

    abort() {
      if (!this.abortController_) return;
      this.abortController_.abort();
    }

    get url_() {
      throw new Error('subclasses must override get url_()');
    }

    async localhostResponse_() {
      return {};
    }

    postProcess_(json) {
      return json;
    }
  }

  class CacheBase {
    constructor(options, dispatch, getState) {
      this.options_ = options;
      this.dispatch_ = dispatch;
      this.getState_ = getState;
      this.rootState_ = this.getState_();
      this.cacheKey_ = undefined; // will be computed in read()
    }

    get cacheStatePath_() {
      // Subclasses may override this to return a statePath. read() will ensure
      // that the statePath exists.
    }

    get defaultCacheState_() {
      // Subclasses may override this to return a different default cache state.
    }

    computeCacheKey_() {
      // Subclasses must override this to return a unique string per request.
      throw new Error('subclasses must override computeCacheKey_');
    }

    get isInCache_() {
      throw new Error('subclasses must override isInCache_()');
    }

    createRequest_() {
      // Subclasses must override this to return an instatiation of a class
      // extending from cp.RequestBase for creating an outgoing HTTP request.
      throw new Error('subclasses must override createRequest_()');
    }

    async fetch_() {
      const request = this.createRequest_();
      const completion = (async() => {
        const response = await request.response;
        this.onFinishRequest_(response);
        return response;
      })();
      this.onStartRequest_(request, completion);
      return await completion;
    }

    onStartRequest_(request, completion) {
      // Subclasses may override this to store request or request.response in
      // the redux store.
    }

    onFinishRequest_(response) {
      // Subclasses may override this to store response in the redux store.
    }

    ensureCacheState_() {
      this.dispatch_(Redux.ENSURE(
          this.cacheStatePath_, this.defaultCacheState_));
      this.rootState_ = this.getState_();
    }

    // Usage:
    // class FooCache extends CacheBase { ... }
    // const ReadFoo = options => async(dispatch, getState) =>
    //   await new FooCache(options, dispatch, getState).read();
    // const foo = await dispatch(ReadFoo(options))
    async read() {
      this.ensureCacheState_();
      this.cacheKey_ = this.computeCacheKey_();
      if (this.cacheKey_ instanceof Promise) {
        // Some caches need to use async APIs to compute their cacheKey_,
        // some caches need read() to call onStartRequest_() before the first
        // await.
        this.cacheKey_ = await this.cacheKey_;
      }

      if (this.isInCache_) {
        return await this.readFromCache_();
      }

      return await this.fetch_();
    }
  }

  return {
    CacheBase,
    RequestBase,
  };
});
