/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

tr.exportTo('cp', () => {
  function setImmutableInternal_(obj, path, value, depth) {
    // Based on dot-prop-immutable:
    // https://github.com/debitoor/dot-prop-immutable/blob/master/index.js
    if (obj === undefined) {
      path = Polymer.Path.normalize(path.slice(0, depth));
      throw new Error(`undefined at ${path}`);
    }
    if (path.length === depth) {
      // Recursive base case.
      if (typeof value === 'function') {
        return value(obj);
      }
      return value;
    }
    let key = path[depth];
    if (Array.isArray(obj)) key = parseInt(key);
    const wrappedValue = setImmutableInternal_(
        obj[key], path, value, depth + 1);
    const clone = Array.isArray(obj) ? Array.from(obj) : {...obj};
    if (Array.isArray(obj)) {
      clone.splice(key, 1, wrappedValue);
    } else {
      clone[key] = wrappedValue;
    }
    return clone;
  }

  /**
   * Like Polymer.Path.set(), but returns a modified clone of root instead of
   * modifying root. In order to compute a new value from the existing value at
   * path efficiently, instead of calling Path.get() and then Path.set(),
   * |value| may be set to a function that takes the existing value and returns
   * a new value.
   *
   * @param {!Object|!Array} root
   * @param {string|!Array} path
   * @param {*|function} value
   * @return {!Object|!Array}
   */
  Polymer.Path.setImmutable = (root, path, value) => {
    if (path === '') {
      path = [];
    } else if (typeof(path) === 'string') {
      path = Polymer.Path.split(path);
    }
    return setImmutableInternal_(root, path, value, 0);
  };

  return {};
});
