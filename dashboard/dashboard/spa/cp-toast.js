/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
(() => {
  class CpToast extends Polymer.Element {
    static get is() { return 'cp-toast'; }

    async open(ms = 5000) {
      this.opened = true;
      if (ms <= 0) return;
      const start = this.openedTimestamp_ = performance.now();
      await cp.timeout(ms);
      if (this.openedTimestamp_ !== start) return;
      this.opened = false;
    }
  }

  CpToast.properties = {
    opened: {
      type: Boolean,
      reflectToAttribute: true,
    },
  };

  customElements.define(CpToast.is, CpToast);
})();
