/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

tr.exportTo('cp', () => {
  const MEASURING_ELEMENTS = [];

  let scheduledFrame = false;

  function measureAllElements() {
    for (const {element, callback} of MEASURING_ELEMENTS) {
      callback(element.getBoundingClientRect());
    }
    MEASURING_ELEMENTS.splice(0, MEASURING_ELEMENTS.length);
    scheduledFrame = false;
  }

  /**
   * Returns a Promise which resolves with the bounding rect of the given
   * element. Does not force layout. Centralizing this functionality allows for
   * a single animation frame callback to handle measuring a large number of
   * elements.
   *
   * @param {!Element} element
   * @return {!Promise.<BoundingRect>}
   */
  function measureElement(element) {
    let callback;
    const promise = new Promise(resolve => {
      callback = resolve;
    });
    MEASURING_ELEMENTS.push({element, callback});
    if (!scheduledFrame) {
      requestAnimationFrame(measureAllElements);
      scheduledFrame = true;
    }
    return promise;
  }

  return {
    measureElement,
  };
});
