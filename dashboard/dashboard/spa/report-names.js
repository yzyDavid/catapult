/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ReportNamesRequest extends cp.RequestBase {
    constructor(options) {
      super(options);
      this.method_ = 'POST';
    }

    get url_() {
      return '/api/report/names';
    }

    async localhostResponse_() {
      return [
        {name: cp.ReportSection.DEFAULT_NAME, id: 0, modified: 0},
      ];
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

  const ReadReportNames = async() => await new ReportNamesRequest({}).response;

  return {
    ReadReportNames,
  };
});
