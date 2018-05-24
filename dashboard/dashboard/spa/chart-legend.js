/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ChartLegend extends Polymer.GestureEventListeners(cp.ElementBase) {
    onLeafMouseOver_(event) {
      this.dispatchEvent(new CustomEvent('leaf-mouseover', {
        bubbles: true,
        composed: true,
        detail: event.model.item,
      }));
    }

    onLeafMouseOut_(event) {
      this.dispatchEvent(new CustomEvent('leaf-mouseout', {
        bubbles: true,
        composed: true,
        detail: event.model.item,
      }));
    }

    onLeafTap_(event) {
      event.cancelBubble = true;
      this.dispatchEvent(new CustomEvent('leaf-tap', {
        bubbles: true,
        composed: true,
        detail: event.model.item,
      }));
    }
  }

  ChartLegend.properties = {
    items: {type: Array},
  };

  cp.ElementBase.register(ChartLegend);

  return {
    ChartLegend,
  };
});
