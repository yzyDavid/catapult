/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  const TEAM_FILTERS_BY_NAME = new Map();

  class TeamFilter {
    async reportNames(allReportNames) {
      return (await Promise.all(allReportNames.map(async reportName => {
        if (await this.reportNameMatches_(reportName)) return reportName;
        return undefined;
      }))).filter(x => x);
    }

    async sheriffNames(allSheriffNames) {
      return (await Promise.all(allSheriffNames.map(async sheriffName => {
        if (await this.sheriffNameMatches_(sheriffName)) return sheriffName;
        return undefined;
      }))).filter(x => x);
    }

    async testSuites(allTestSuites) {
      return (await Promise.all(allTestSuites.map(async testSuite => {
        if (await this.testSuiteMatches_(testSuite)) return testSuite;
        return undefined;
      }))).filter(x => x);
    }

    async reportNameMatches_(reportName) {
      throw new Error('subclasses must override reportNameMatches_');
    }

    async sheriffNameMatches_(sheriffName) {
      throw new Error('subclasses must override sheriffNameMatches_');
    }

    async testSuiteMatches_(testSuite) {
      throw new Error('subclasses must override testSuiteMatches_');
    }
  }

  class PermitAll extends TeamFilter {
    async reportNameMatches_(reportName) {
      return true;
    }

    async sheriffNameMatches_(sheriffName) {
      return true;
    }

    async testSuiteMatches_(testSuite) {
      return true;
    }
  }

  const PERMIT_ALL = new PermitAll();

  TeamFilter.get = teamName => {
    const teamFilter = TEAM_FILTERS_BY_NAME.get(teamName);
    if (teamFilter) return teamFilter;
    return PERMIT_ALL;
  };

  class HashFilter extends TeamFilter {
    constructor() {
      super();
      this.reportNameHashes_ = new Set([]);
      this.sheriffNameHashes_ = new Set([]);
      this.testSuiteHashes_ = new Set([]);
    }

    async reportNameMatches_(reportName) {
      return this.reportNameHashes_.has(await cp.sha256(reportName));
    }

    async sheriffNameMatches_(sheriffName) {
      return this.sheriffNameHashes_.has(await cp.sha256(testSuite));
    }

    async testSuiteMatches_(testSuite) {
      return this.testSuiteHashes_.has(await cp.sha256(testSuite));
    }
  }

  TEAM_FILTERS_BY_NAME.set('fuchsia',
      new class FuchsiaFilter extends HashFilter {
        constructor() {
          super();
          /* eslint-disable max-len */
          this.testSuiteHashes_.add('ced35239215489f5e01a5c68981d1b6f32f2d0260a0785022d73622ccfc83fd0');
          /* eslint-enable max-len */
        }

        async reportNameMatches_(reportName) {
          if (reportName === cp.ReportSection.DEFAULT_NAME) return true;
          return false;
        }

        async sheriffNameMatches_(sheriffName) {
          return true;
        }
      });

  return {
    TeamFilter,
  };
});
