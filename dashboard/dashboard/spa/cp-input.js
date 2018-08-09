/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
(() => {
  class CpInput extends Polymer.Element {
    static get is() { return 'cp-input'; }

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
      while (cp.getActiveElement() !== this.nativeInput) {
        await cp.timeout(50);
        this.nativeInput.focus();
      }
    }

    async blur() {
      this.nativeInput.blur();
      while (cp.getActiveElement() === this.nativeInput) {
        await cp.timeout(50);
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

  customElements.define(CpInput.is, CpInput);
})();
