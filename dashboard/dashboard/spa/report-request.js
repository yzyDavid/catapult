/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ReportRequest extends cp.RequestBase {
    constructor(options) {
      super(options);
      this.name_ = options.name;
      this.method_ = 'POST';
      this.body_ = new FormData();
      this.body_.set('id', options.id);
      this.body_.set('modified', options.modified.getTime());
      this.body_.set('revisions', options.revisions);
    }

    get url_() {
      return '/api/report/generate';
    }

    get channelName() {
      return (location.origin + this.url_ + '?' +
              new URLSearchParams(this.body_));
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

  return {
    ReportRequest,
  };
});
