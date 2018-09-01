/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  /**
   * ServiceWorkerListener creates a communication channel between the
   * application and the service worker.
   */
  class ServiceWorkerListener {
    constructor(url) {
      if (navigator.serviceWorker.controller === null &&
          !ServiceWorkerListener.TESTING) {
        // The request is force refresh (Shift + refresh) or there is no
        // active service worker.
        this.done_ = true;
        return;
      }

      this.done_ = false;

      this.messageQueue_ = [];
      this.queueResult_ = result => this.messageQueue_.push(result);
      this.nextPromise_ = undefined;
      this.resolve_ = this.queueResult_;

      this.handleMessage_ = this.handleMessage_.bind(this);
      this.channel_ = new BroadcastChannel(url);
      this.channel_.addEventListener('message', this.handleMessage_);
    }

    handleMessage_({data: {type, payload}}) {
      switch (type) {
        case 'RESULTS':
          this.resolve_({done: false, value: payload});
          return;
        case 'DONE':
          this.resolve_({done: true, value: payload});
          this.done_ = true;
          this.channel_.removeEventListener('message', this.handleMessage_);
          this.channel_.close();
          return;
        default:
          throw new Error(`Unknown Service Worker message type: ${type}`);
      }
    }

    [Symbol.asyncIterator]() {
      return this;
    }

    async next() {
      if (this.done_) return {done: true};
      if (this.nextPromise_) return await this.nextPromise_;
      if (this.messageQueue_.length) return this.messageQueue_.shift();

      this.nextPromise_ = new Promise(resolve => {
        this.resolve_ = resolve;
      });
      const result = await this.nextPromise_;
      this.resolve_ = this.queueResult_;
      this.nextPromise_ = undefined;
      return result;
    }
  }

  // Set true when running unit tests so ServiceWorkerListener works without an
  // active Service Worker.
  ServiceWorkerListener.TESTING = false;


  return {
    ServiceWorkerListener,
  };
});
