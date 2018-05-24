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

  Object.deepFreeze = o => {
    Object.freeze(o);
    for (const [name, value] of Object.entries(o)) {
      if (typeof(value) !== 'object') continue;
      if (Object.isFrozen(value)) continue;
      if (value instanceof tr.b.Unit) continue;
      Object.deepFreeze(value);
    }
  };

  // In order for ElementBase to be useful in multiple different apps, the
  // default state must be empty, and each app must populate it.
  const DEFAULT_STATE = {};

  // Maps from string "action type" to synchronous
  // function(!Object state, !Object action):!Object state.
  const REDUCERS = new Map();

  // When true, state is recursively frozen so that improper property setting
  // causes an error to be thrown. Freezing significantly impacts performance,
  // so set to false in order to measure performance on localhost.
  const DEBUG = location.hostname === 'localhost';

  // Forwards (state, action) to action.reducer.
  function rootReducer(state, action) {
    if (state === undefined) {
      state = DEFAULT_STATE;
    }
    if (typeof(action.type) === 'function') {
      throw new Error(action.type.typeName);
    }
    if (!REDUCERS.has(action.type)) return state;
    if (DEBUG) Object.deepFreeze(state);
    return REDUCERS.get(action.type)(state, action);
  }

  // This is all that is needed from redux-thunk to enable asynchronous action
  // creators.
  // https://tur-nr.github.io/polymer-redux/docs#async-actions
  const THUNK = ({dispatch, getState}) => next => action => {
    if (typeof action === 'function') {
      return action(dispatch, getState);
    }
    try {
      return next(action);
    } catch (error) {
      const state = getState();
      // eslint-disable-next-line no-console
      console.error(error, action, state);
      return state;
    }
  };

  const STORE = Redux.createStore(
      rootReducer, DEFAULT_STATE, Redux.applyMiddleware(THUNK));

  const ReduxMixin = PolymerRedux(STORE);

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
  }

  /**
    * Subclasses should use this to bind properties to redux state.
    * @param {String} statePathPropertyName Typically 'statePath'.
    * @param {!Object} configs
    * @return {!Object} properties
    */
  ElementBase.statePathProperties = (statePathPropertyName, configs) => {
    const properties = {};
    properties[statePathPropertyName] = {type: String};

    for (const [name, config] of Object.entries(configs)) {
      properties[name] = {
        ...config,
        readOnly: true,
        statePath(state) {
          const statePath = this[statePathPropertyName];
          if (statePath === undefined) return undefined;
          try {
            state = Polymer.Path.get(state, statePath);
            if (state === undefined) return undefined;
            return state[name];
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error, {
              tagName: this.tagName,
              statePathPropertyName,
              statePath,
              name,
            });
            return undefined;
          }
        },
      };
    }

    return properties;
  };

  ElementBase.statePathReducer = reducer => {
    const replacement = (rootState, action) => {
      const statePath = action.statePath || '';
      try {
        return Polymer.Path.setImmutable(rootState, statePath, state => {
          const mark = tr.b.Timing.mark('reducer', reducer.typeName);
          const newState = reducer(state, action, rootState);
          mark.end();
          return newState;
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(replacement.typeName, error, action, rootState);
        return rootState;
      }
    };
    Object.defineProperty(replacement, 'name', {
      value: 'ElementBase.statePathReducer.wrapper',
    });
    return replacement;
  };

  ElementBase.registerReducers = cls => {
    if (!cls.reducers) return;
    if (cls !== ElementBase &&
        cls.reducers === ElementBase.reducers) {
      return;
    }
    for (const [name, reducer] of Object.entries(cls.reducers)) {
      reducer.typeName = `${cls.name}.reducers.${name}`;
      Object.defineProperty(reducer, 'name', {value: reducer.typeName});
      REDUCERS.set(reducer.typeName, ElementBase.statePathReducer(reducer));
    }
  };

  ElementBase.registerEventListeners = cls => {
    // Polymer handles the addEventListener() calls, this method just wraps
    // 'on*_' methods with Timing marks.
    for (const name of Object.getOwnPropertyNames(cls.prototype)) {
      if (!name.startsWith('on')) continue;
      if (!name.endsWith('_')) continue;
      (() => {
        const wrapped = cls.prototype[name];
        const debugName = cls.name + '.' + name;

        cls.prototype[name] = async function eventListenerWrapper(event) {
          // Measure the time from when the browser receives the event to when
          // we receive the event.
          if (event && event.timeStamp) {
            tr.b.Timing.mark('listener', debugName, event.timeStamp).end();
          }

          const firstPaintMark = tr.b.Timing.mark('firstPaint', debugName);
          // Measure the first paint latency by starting the event listener
          // without awaiting it.
          const resultPromise = wrapped.call(this, event);
          (async() => {
            await ElementBase.afterRender();
            firstPaintMark.end();
          })();
          const result = await resultPromise;
          const lastPaintMark = tr.b.Timing.mark('lastPaint', debugName);
          (async() => {
            await ElementBase.afterRender();
            lastPaintMark.end();
          })();
          return result;
        };
      })();
    }
  };

  ElementBase.registerActions = cls => {
    if (!cls.actions) return;
    if (cls !== ElementBase &&
        cls.actions === ElementBase.actions) {
      return;
    }

    for (const [name, action] of Object.entries(cls.actions)) {
      const debugName = `${cls.name}.actions.${name}`;
      const actionReplacement = (...args) => {
        const thunk = action(...args);
        Object.defineProperty(thunk, 'name', {value: debugName});
        const thunkReplacement = async(dispatch, getState) => {
          const mark = tr.b.Timing.mark('action', debugName);
          const result = await thunk(dispatch, getState);
          mark.end();
          return result;
        };
        Object.defineProperty(thunkReplacement, 'name', {
          value: 'ElementBase.action.wrapper',
        });
        return thunkReplacement;
      };
      actionReplacement.implementation = action;
      Object.defineProperty(actionReplacement, 'name', {value: debugName});
      cls.actions[name] = actionReplacement;
    }
  };

  ElementBase.register = subclass => {
    subclass.is = Polymer.CaseMap.camelToDashCase(subclass.name).substr(1);
    customElements.define(subclass.is, subclass);
    ElementBase.registerEventListeners(subclass);
    ElementBase.registerActions(subclass);
    ElementBase.registerReducers(subclass);
  };

  ElementBase.afterRender = () => new Promise(resolve => {
    Polymer.RenderStatus.afterNextRender({}, () => {
      resolve();
    });
  });

  ElementBase.beforeRender = () => new Promise(resolve => {
    Polymer.RenderStatus.beforeNextRender({}, () => {
      resolve();
    });
  });

  ElementBase.timeout = ms => new Promise(resolve => setTimeout(resolve, ms));
  ElementBase.animationFrame = () => new Promise(resolve =>
    requestAnimationFrame(resolve));

  ElementBase.idlePeriod = () => new Promise(resolve =>
    requestIdleCallback(resolve));

  ElementBase.measureInputLatency = async(groupName, functionName, event) => {
    const mark = tr.b.Timing.mark(
        groupName, functionName,
        event.timeStamp || event.detail.sourceEvent.timeStamp);
    await ElementBase.afterRender();
    mark.end();
  };

  ElementBase.actions = {
    updateObject: (statePath, delta) => async(dispatch, getState) => {
      dispatch({
        type: ElementBase.reducers.updateObject.typeName,
        statePath,
        delta,
      });
    },

    toggleBoolean: statePath => async(dispatch, getState) => {
      dispatch({
        type: ElementBase.reducers.toggleBoolean.typeName,
        statePath,
      });
    },

    ensureObject: (path, opt_defaultLeaf) => async(dispatch, getState) => {
      if (Polymer.Path.get(getState(), path) !== undefined) return;
      dispatch({
        type: ElementBase.reducers.ensureObject.typeName,
        // Note: not statePath! statePathReducer would muck it up.
        path,
        defaultLeaf: opt_defaultLeaf || {},
      });
    },

    chain: (statePath, actions) => async(dispatch, getState) => {
      dispatch({
        type: ElementBase.reducers.chain.typeName,
        statePath,
        actions,
      });
    },
  };

  ElementBase.reducers = {
    updateObject: (state, action, rootState) => {
      return {...state, ...action.delta};
    },

    toggleBoolean: (state, action, rootState) => !state,

    ensureObject: (rootState, action, rootStateAgain) => {
      rootState = {...rootState};
      let node = rootState;
      const parts = Polymer.Path.split(action.path);
      for (let i = 0; i < parts.length - 1; ++i) {
        const part = parts[i];
        if (node[part] === undefined) {
          node[part] = {};
        }
        node = node[part];
      }
      const lastPart = parts[parts.length - 1];
      if (node[lastPart] === undefined) {
        node[lastPart] = action.defaultLeaf;
      }
      return rootState;
    },

    chain: (state, {actions}, rootState) => {
      for (const action of actions) {
        if (!REDUCERS.has(action.type)) continue;
        state = REDUCERS.get(action.type)(state, action);
      }
      return state;
    },
  };

  ElementBase.registerReducers(ElementBase);

  ElementBase.getActiveElement = () => {
    let element = document.activeElement;
    while (element !== null && element.shadowRoot) {
      element = element.shadowRoot.activeElement;
    }
    return element;
  };

  ElementBase.measureTrace = () => {
    const events = [];
    const loadTimes = Object.entries(performance.timing.toJSON()).filter(p =>
      p[1] > 0);
    loadTimes.sort((a, b) => a[1] - b[1]);
    const start = loadTimes.shift()[1];
    for (const [name, timeStamp] of loadTimes) {
      events.push({
        name: 'load:' + name,
        start,
        end: timeStamp,
        duration: timeStamp - start,
      });
    }
    for (const measure of performance.getEntriesByType('measure')) {
      const name = measure.name.replace(/[ \.]/g, ':').replace(
          ':reducers:', ':').replace(':actions:', ':');
      events.push({
        name,
        start: measure.startTime,
        duration: measure.duration,
        end: measure.startTime + measure.duration,
      });
    }
    return events;
  };

  ElementBase.measureHistograms = () => {
    const histograms = new tr.v.HistogramSet();
    const unit = tr.b.Unit.byName.timeDurationInMs_smallerIsBetter;
    for (const event of ElementBase.measureTrace()) {
      let hist = histograms.getHistogramNamed(event.name);
      if (!hist) {
        hist = histograms.createHistogram(event.name, unit, []);
      }
      hist.addSample(measure.duration);
    }
    return histograms;
  };

  ElementBase.measureTable = () => {
    const table = [];
    for (const hist of cp.ElementBase.measureHistograms()) {
      table.push([hist.average, hist.name]);
    }
    table.sort((a, b) => (a[0] - b[0]));
    return table.map(p =>
      ('' + parseInt(p[0])).padEnd(6) + p[1]).join('\n');
  };

  async function sha256(s) {
    s = new TextEncoder('utf-8').encode(s);
    const hash = await crypto.subtle.digest('SHA-256', s);
    const view = new DataView(hash);
    let hex = '';
    for (let i = 0; i < view.byteLength; i += 4) {
      hex += ('00000000' + view.getUint32(i).toString(16)).slice(-8);
    }
    return hex;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
    'Oct', 'Nov', 'Dec'];

  function abbreviateMonth(date) {
    return MONTHS[date.getMonth()];
  }

  function succintDateRange(minDate, maxDate) {
    const minYear = minDate.getYear();
    const minMonth = abbreviateMonth(minDate);
    const maxMonth = abbreviateMonth(maxDate);
    if (minDate.getYear() !== maxDate.getYear()) {
      return `${minYear} ${minMonth} - ${maxDate.getYear()} ${maxMonth}`;
    }
    if (minDate.getMonth() !== maxDate.getMonth()) {
      return `${minYear} ${minMonth} ${minDate.getDate()} - ` +
        `${maxMonth} ${maxDate.getDate()}`;
    }
    if (minDate.getDate() !== maxDate.getDate()) {
      return `${minYear} ${minMonth} ${minDate.getDate()} - ` +
        maxDate.getDate();
    }
    return `${minYear} ${minMonth} ${minDate.getDate()} ` +
      `${minDate.getHours()}:${('0' + minDate.getMinutes()).slice(-2)} - ` +
      `${maxDate.getHours()}:${('0' + maxDate.getMinutes()).slice(-2)}`;
  }

  return {
    ElementBase,
    sha256,
  };
});
