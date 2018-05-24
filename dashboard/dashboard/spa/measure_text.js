/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

tr.exportTo('cp', () => {
  const HOST_ELEMENT = document.createElement('div');
  HOST_ELEMENT.style.position = 'fixed';
  HOST_ELEMENT.style.visibility = 'hidden';
  HOST_ELEMENT.style.zIndex = -1000;
  window.addEventListener('load', () =>
    document.body.appendChild(HOST_ELEMENT));

  const CACHE = new Map();

  /**
   * Returns a Promise which resolves with the bounding rect of the given
   * textContent after applying the given opt_options to a <span> containing
   * textContent. Does not force layout. Centralizing this functionality allows
   * for a single animation frame callback to handle measuring a large number of
   * texts. Caches results for speed.
   *
   * @param {!String} textContent
   * @param {Object=} opt_options
   * @return {!Promise.<BoundingRect>}
   */
  async function measureText(textContent, opt_options) {
    let cacheKey = {textContent, ...opt_options};
    cacheKey = JSON.stringify(cacheKey, Object.keys(cacheKey).sort());
    if (CACHE.has(cacheKey)) return await CACHE.get(cacheKey);

    const span = document.createElement('span');
    span.style.whiteSpace = 'nowrap';
    span.style.display = 'inline-block';
    span.textContent = textContent;
    Object.assign(span.style, opt_options);
    HOST_ELEMENT.appendChild(span);
    const promise = cp.measureElement(span);
    CACHE.set(cacheKey, promise);
    const rect = await promise;
    CACHE.set(cacheKey, rect);
    HOST_ELEMENT.removeChild(span);
    return rect;
  }

  return {
    measureText,
  };
});
