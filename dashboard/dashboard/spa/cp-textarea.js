/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class CpTextarea extends cp.ElementBase {
    async connectedCallback() {
      super.connectedCallback();
      if (this.autofocus) {
        while (cp.ElementBase.getActiveElement() !== this.nativeInput) {
          this.$.input.focus();
          await cp.ElementBase.timeout(50);
        }
      }
    }

    get nativeInput() {
      return this.$.input;
    }

    focus() {
      this.nativeInput.focus();
    }

    async onKeyup_(event) {
      this.value = event.target.value;
    }
  }

  CpTextarea.properties = {
    autofocus: {type: Boolean},
    value: {type: String},
    placeholder: {type: String},
  };

  cp.ElementBase.register(CpTextarea);

  return {
    CpTextarea,
  };
});
