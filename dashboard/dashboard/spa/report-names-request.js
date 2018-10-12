/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ReportNamesRequest extends cp.RequestBase {
    constructor() {
      super({});
      this.method_ = 'POST';
    }

    get url_() {
      return '/api/report/names';
    }

    // `modified` comes back as ISO8601, but we need a Date object.
    postProcess_(json) {
      return json.map(report => {
        return {
          ...report,
          modified: new Date(report.modified),
        };
      });
    }
  }

  return {ReportNamesRequest};
});
