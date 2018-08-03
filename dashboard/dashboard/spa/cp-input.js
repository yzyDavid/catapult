/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class CpInput extends cp.ElementBase {
    connectedCallback() {
      super.connectedCallback();
      if (this.autofocus) {
        this.focus();
      }
    }

    get nativeInput() {
      return this.$.input;
    }

    async focus() {
      this.nativeInput.focus();
      while (cp.ElementBase.getActiveElement() !== this.nativeInput) {
        await cp.ElementBase.timeout(50);
        this.nativeInput.focus();
      }
    }

    async blur() {
      this.nativeInput.blur();
      while (cp.ElementBase.getActiveElement() === this.nativeInput) {
        await cp.ElementBase.timeout(50);
        this.nativeInput.blur();
      }
    }

    async onKeyup_(event) {
      this.value = event.target.value;
    }
  }

  CpInput.properties = {
    autofocus: {type: Boolean},
    disabled: {
      type: Boolean,
      reflectToAttribute: true,
    },
    placeholder: {type: String},
    value: {type: String},
  };

  cp.ElementBase.register(CpInput);

  return {
    CpInput,
  };
});
