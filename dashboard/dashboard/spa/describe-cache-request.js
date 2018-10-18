/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

import KeyValueCacheRequest from './key-value-cache-request.js';

export default class DescribeCacheRequest extends KeyValueCacheRequest {
  async getDatabaseKey() {
    const clone = this.fetchEvent.request.clone();
    const body = await clone.formData();
    const testSuite = body.get('test_suite');
    return `describe_${testSuite}${this.isAuthorized ? '_internal' : ''}`;
  }
}
