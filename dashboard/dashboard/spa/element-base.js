/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';

tr.exportTo('cp', () => {
  // In order for ElementBase to be useful in multiple different apps, the
  // default state must be empty, and each app must populate it.
  const DEFAULT_STATE = {};

  // Maps from string "action type" to synchronous
  // function(!Object state, !Object action):!Object state.
  const REDUCERS = new Map();

  // When true, state is recursively frozen so that improper property setting
  // causes an error to be thrown. Freezing significantly impacts performance,
  // so set to false in order to measure performance on localhost.
  const IS_DEBUG = location.hostname === 'localhost';

  // When in production, tell Redux Dev Tools to disable automatic recording.
  const PRODUCTION_ORIGIN = 'v2spa-dot-chromeperf.appspot.com';
  const PRODUCTION_URL = `https://${PRODUCTION_ORIGIN}`;
  const IS_PRODUCTION = location.hostname === PRODUCTION_ORIGIN;

  // Forwards (state, action) to action.reducer.
  function rootReducer(state, action) {
    if (state === undefined) {
      state = DEFAULT_STATE;
    }
    if (typeof(action.type) === 'function') {
      throw new Error(action.type.typeName);
    }
    if (!REDUCERS.has(action.type)) return state;
    if (IS_DEBUG) cp.deepFreeze(state);
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

  let MIDDLEWARE = Redux.applyMiddleware(THUNK);

  if (window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) {
    MIDDLEWARE = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
      // Do not record changes automatically when in a production environment.
      shouldRecordChanges: !IS_PRODUCTION,

      // Increase the maximum number of actions stored in the history tree. The
      // oldest actions are removed once maxAge is reached. It's critical for
      // performance.
      maxAge: 75,
    })(MIDDLEWARE);
  }

  const STORE = Redux.createStore(rootReducer, DEFAULT_STATE, MIDDLEWARE);
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
          try {
            return reducer(state, action, rootState);
          } finally {
            mark.end();
          }
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

  tr.b.Timing.ANALYTICS_FILTERS.push(mark =>
    ['firstPaint', 'fetch', 'load'].includes(mark.groupName) ||
    (mark.durationMs > 100));

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

          // Measure the first paint latency by starting the event listener
          // without awaiting it.
          const firstPaintMark = tr.b.Timing.mark('firstPaint', debugName);
          const resultPromise = wrapped.call(this, event);
          (async() => {
            await cp.afterRender();
            firstPaintMark.end();
          })();

          const result = await resultPromise;

          const lastPaintMark = tr.b.Timing.mark('lastPaint', debugName);
          (async() => {
            await cp.afterRender();
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
          try {
            return await thunk(dispatch, getState);
          } finally {
            mark.end();
          }
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

    chain: actions => async(dispatch, getState) => {
      dispatch({
        type: ElementBase.reducers.chain.typeName,
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

    chain: (rootState, {actions}, rootStateAgain) => {
      for (const action of actions) {
        if (!REDUCERS.has(action.type)) {
          // eslint-disable-next-line no-console
          console.warn('Unrecognized action type', action);
          continue;
        }
        rootState = REDUCERS.get(action.type)(rootState, action);
      }
      return rootState;
    },
  };

  ElementBase.registerReducers(ElementBase);

  return {
    ElementBase,
    IS_DEBUG,
    IS_PRODUCTION,
    PRODUCTION_URL,
  };
});
