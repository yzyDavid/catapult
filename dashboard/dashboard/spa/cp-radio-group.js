/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
(() => {
  class CpRadioGroup extends Polymer.Element {
    static get is() { return 'cp-radio-group'; }

    async ready() {
      super.ready();
      this.addEventListener('change', this.onItemChange_.bind(this));
    }

    async onItemChange_(event) {
      this.selected = event.target.name;
    }

    async observeSelected_() {
      for (const item of this.querySelectorAll('cp-radio')) {
        item.checked = (item.name === this.selected);
      }
      this.dispatchEvent(new CustomEvent('selected-changed', {
        bubbles: true,
        composed: true,
        detail: {value: this.selected},
      }));
    }
  }

  CpRadioGroup.properties = {selected: {type: String}};
  CpRadioGroup.observers = ['observeSelected_(selected)'];

  customElements.define(CpRadioGroup.is, CpRadioGroup);
})();
