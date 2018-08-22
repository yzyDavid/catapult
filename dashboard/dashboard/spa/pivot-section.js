/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class PivotSection extends cp.ElementBase {
    closeSection_() {
      this.dispatchEvent(new CustomEvent('close-section', {
        bubbles: true,
        composed: true,
        detail: {sectionId: this.sectionId},
      }));
    }
  }

  PivotSection.State = {
    sectionId: options => options.sectionId || tr.b.GUID.allocateSimple(),
  };

  PivotSection.buildState = options => cp.buildState(
      PivotSection.State, options);

  PivotSection.properties = cp.buildProperties('state', PivotSection.State);

  PivotSection.actions = {
  };

  PivotSection.reducers = {
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
