/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  const ReduxMixin = PolymerRedux(Redux.createSimpleStore({
    devtools: {
      // Do not record changes automatically when in a production environment.
      shouldRecordChanges: !window.IS_PRODUCTION,

      // Increase the maximum number of actions stored in the history tree. The
      // oldest actions are removed once maxAge is reached. It's critical for
      // performance.
      maxAge: 75,
    },
  }));

  /*
   * This base class mixes Polymer.Element with Polymer-Redux and provides
   * utility functions to help data-bindings in elements perform minimal
   * computation without computed properties.
   */
  class ElementBase extends ReduxMixin(Polymer.Element) {
    constructor() {
      super();
      this.debounceJobs_ = new Map();
    }

    _add() {
      let sum = arguments[0];
      for (const arg of Array.from(arguments).slice(1)) {
        sum += arg;
      }
      return sum;
    }

    _eq() {
      const test = arguments[0];
      for (const arg of Array.from(arguments).slice(1)) {
        if (arg !== test) return false;
      }
      return true;
    }

    _len(seq) {
      if (seq === undefined) return 0;
      if (seq === null) return 0;
      if (seq instanceof Array || typeof(seq) === 'string') return seq.length;
      if (seq instanceof Map || seq instanceof Set) return seq.size;
      if (seq instanceof tr.v.HistogramSet) return seq.length;
      return Object.keys(seq).length;
    }

    _multiple(seq) {
      return this._len(seq) > 1;
    }

    _empty(seq) {
      return this._len(seq) === 0;
    }

    _plural(num) {
      return num === 1 ? '' : 's';
    }

    /**
     * Wrap Polymer.Debouncer in a friendlier syntax.
     *
     * @param {*} jobName
     * @param {Function()} callback
     * @param {Object=} asyncModule See Polymer.Async.
     */
    debounce(jobName, callback, opt_asyncModule) {
      const asyncModule = opt_asyncModule || Polymer.Async.microTask;
      this.debounceJobs_.set(jobName, Polymer.Debouncer.debounce(
          this.debounceJobs_.get(jobName), asyncModule, callback));
    }

    // This is used to bind state properties in `buildProperties()` in utils.js.
    identity_(x) { return x; }
  }

  ElementBase.register = subclass => {
    subclass.is = Polymer.CaseMap.camelToDashCase(subclass.name).substr(1);
    customElements.define(subclass.is, subclass);
    if (subclass.reducers) {
      Redux.registerReducers(subclass.reducers, [
        Redux.renameReducer(subclass.name + '.'),
        ...Redux.DEFAULT_REDUCER_WRAPPERS,
      ]);
    }
    cp.timeActions(subclass);
    cp.timeEventListeners(subclass);
  };

  return {ElementBase};
});
