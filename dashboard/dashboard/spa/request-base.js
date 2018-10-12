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

    // Some CacheRequest classes use ResultChannelSender to stream parts of the
    // requested data as it becomes available.
    async* reader() {
      const receiver = new cp.ResultChannelReceiver(
          this.channelName);
      const response = await this.response;
      if (response) yield response;
      for await (const update of receiver) {
        yield this.postProcess_(update, true);
      }
    }

    get channelName() {
      return location.origin + this.url_;
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

    postProcess_(json, isFromChannel = false) {
      return json;
    }
  }

  return {
    RequestBase,
  };
});
