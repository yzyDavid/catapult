/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class PivotSection extends cp.ElementBase {
    static get properties() {
      return cp.ElementBase.statePathProperties('statePath', {
        testSuites: {type: Object},
        revisions: {type: Object},
        histograms: {type: Object},
      });
    }

    closeSection_() {
      this.dispatchEvent(new CustomEvent('close-section', {
        bubbles: true,
        composed: true,
        detail: {sectionId: this.sectionId},
      }));
    }
  }

  PivotSection.actions = {
  };

  PivotSection.reducers = {
  };

  PivotSection.newState = options => {
    return {
      testSuites: {
      },
      revisions: {
      },
      histograms: {
      },
    };
  };

  PivotSection.getSessionState = state => {
    return {
    };
  };

  PivotSection.getQueryParams = state => {
    return {};
  };

  cp.ElementBase.register(PivotSection);

  return {
    PivotSection,
  };
});
