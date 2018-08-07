/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class CpCheckbox extends cp.ElementBase {
    onChange_(event) {
      this.dispatchEvent(new CustomEvent('change', {
        bubbles: true,
        composed: true,
      }));
    }
  }

  CpCheckbox.properties = {
    checked: {type: Boolean},
    disabled: {type: Boolean},
  };

  cp.ElementBase.register(CpCheckbox);

  return {
    CpCheckbox,
  };
});
