/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  /**
   * Like Polymer.Path.set(), but returns a modified clone of root instead of
   * modifying root. In order to compute a new value from the existing value at
   * path efficiently, instead of calling Path.get() and then Path.set(),
   * `value` may be a callback that takes the existing value and returns
   * a new value.
   *
   * @param {!Object|!Array} root
   * @param {string|!Array} path
   * @param {*|function} value
   * @return {!Object|!Array}
   */
  function setImmutable(root, path, value) {
    if (path === '') {
      path = [];
    } else if (typeof(path) === 'string') {
      path = path.split('.');
    }
    // Based on dot-prop-immutable:
    // https://github.com/debitoor/dot-prop-immutable/blob/master/index.js
    root = Array.isArray(root) ? [...root] : {...root};
    if (path.length === 0) {
      if (typeof value === 'function') {
        return value(root);
      }
      return value;
    }
    let node = root;
    const maxDepth = path.length - 1;
    for (let depth = 0; depth < maxDepth; ++depth) {
      const key = Array.isArray(node) ? parseInt(path[depth]) : path[depth];
      const obj = node[key];
      node[key] = Array.isArray(obj) ? [...obj] : {...obj};
      node = node[key];
    }
    const key = Array.isArray(node) ? parseInt(path[maxDepth]) : path[maxDepth];
    if (typeof value === 'function') {
      node[key] = value(node[key]);
    } else {
      node[key] = value;
    }
    return root;
  }

  function deepFreeze(o) {
    Object.freeze(o);
    for (const [name, value] of Object.entries(o)) {
      if (typeof(value) !== 'object') continue;
      if (Object.isFrozen(value)) continue;
      if (value.__proto__ !== Object.prototype &&
          value.__proto__ !== Array.prototype) {
        continue;
      }
      deepFreeze(value);
    }
  }

  function isElementChildOf(el, potentialParent) {
    if (el === potentialParent) return false;
    while (Polymer.dom(el).parentNode) {
      if (el === potentialParent) return true;
      el = Polymer.dom(el).parentNode;
    }
    return false;
  }

  function getActiveElement() {
    let element = document.activeElement;
    while (element !== null && element.shadowRoot) {
      element = element.shadowRoot.activeElement;
    }
    return element;
  }

  function afterRender() {
    return new Promise(resolve => {
      Polymer.RenderStatus.afterNextRender({}, () => {
        resolve();
      });
    });
  }

  function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function animationFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function idle() {
    new Promise(resolve => requestIdleCallback(resolve));
  }

  function measureTrace() {
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
  }

  function measureHistograms() {
    const histograms = new tr.v.HistogramSet();
    const unit = tr.b.Unit.byName.timeDurationInMs_smallerIsBetter;
    for (const event of measureTrace()) {
      let hist = histograms.getHistogramNamed(event.name);
      if (!hist) {
        hist = histograms.createHistogram(event.name, unit, []);
      }
      hist.addSample(event.duration);
    }
    return histograms;
  }

  function measureTable() {
    const table = [];
    for (const hist of measureHistograms()) {
      table.push([hist.average, hist.name]);
    }
    table.sort((a, b) => (b[0] - a[0]));
    return table.map(p =>
      parseInt(p[0]).toString().padEnd(6) + p[1]).join('\n');
  }

  /*
   * Returns a Polymer properties descriptor object.
   *
   * Usage:
   * const FooState = {
   *   abc: options => options.abc || 0,
   *   def: {reflectToAttribute: true, value: options => options.def || [],},
   * };
   * FooElement.properties = buildProperties('state', FooState);
   * FooElement.buildState = options => buildState(FooState, options);
   */
  function buildProperties(statePropertyName, configs) {
    const statePathPropertyName = statePropertyName + 'Path';
    const properties = {
      [statePathPropertyName]: {type: String},
      [statePropertyName]: {
        readOnly: true,
        statePath(state) {
          const statePath = this[statePathPropertyName];
          if (statePath === undefined) return {};
          return Polymer.Path.get(state, statePath) || {};
        },
      },
    };
    for (const [name, config] of Object.entries(configs)) {
      if (name === statePathPropertyName || name === statePropertyName) {
        throw new Error('Invalid property name: ' + name);
      }
      properties[name] = {
        readOnly: true,
        computed: `identity_(${statePropertyName}.${name})`,
      };
      if (typeof(config) === 'object') {
        for (const [paramName, paramValue] of Object.entries(config)) {
          if (paramName === 'value') continue;
          properties[name][paramName] = paramValue;
        }
      }
    }
    return properties;
  }

  /*
   * Returns a new object with the same shape as `configs` but with values taken
   * from `options`.
   * See buildProperties for description of `configs`.
   */
  function buildState(configs, options) {
    const state = {};
    for (const [name, config] of Object.entries(configs)) {
      switch (typeof(config)) {
        case 'object':
          state[name] = config.value(options);
          break;
        case 'function':
          state[name] = config(options);
          break;
        default:
          throw new Error('Invalid property config: ' + config);
      }
    }
    return state;
  }

  /**
   * BatchIterator reduces processing costs by batching results and errors
   * from an array of tasks. A task can either be a promise or an asynchronous
   * iterator. In other words, use this class when it is costly to iteratively
   * process the output of each task (e.g. when rendering to DOM).
   *
   *   const tasks = urls.map(fetch);
   *   for await (const {results, errors} of new BatchIterator(tasks)) {
   *     render(results);
   *     renderErrors(errors);
   *   }
   */
  class BatchIterator {
    /**
     * type tasks = [task]
     * type task = Promise | AsyncIterator
     * type AsyncIterator = {
     *   next: () => Promise
     * }
     */
    constructor(tasks) {
      this.results_ = [];
      this.errors_ = [];
      this.timeSinceLastCalled_ = undefined;
      this.promises_ = [];

      for (const task of tasks) {
        if (task instanceof Promise) {
          this.promises_.push(this.wrapPromise_(task));
        } else {
          this.wrapIterator_(task);
        }
      }
    }

    wrapPromise_(promise, isAsyncIter = false) {
      const self = (async() => {
        try {
          let result = await promise;
          if (isAsyncIter) {
            if (result.done) return;
            result = result.value;
          }
          this.results_.push(result);
        } catch (err) {
          this.errors_.push(err);
        } finally {
          this.promises_.splice(this.promises_.indexOf(self), 1);
        }
      })();
      return self;
    }

    async wrapIterator_(asyncIter) {
      while (true) {
        const promise = asyncIter.next();
        this.promises_.push(this.wrapPromise_(promise, true));
        const {done} = await promise;
        if (done) break;
      }
    }

    [Symbol.asyncIterator]() {
      return this;
    }

    async next() {
      if (this.promises_.length === 0 && this.results_.length === 0 &&
          this.errors_.length === 0) {
        return {done: true};
      }

      await Promise.race(this.promises_);

      if (this.timeSinceLastCalled_) {
        const timeToProcess = performance.now() - this.timeSinceLastCalled_;
        await Promise.race([
          await timeout(timeToProcess),
          await Promise.all(this.promises_)
        ]);
      }

      const results = this.results_;
      const errors = this.errors_;
      this.results_ = [];
      this.errors_ = [];

      // Measure how long it takes the caller to process yielded results to
      // avoid overloading the caller the next time around.
      this.timeSinceLastCalled_ = performance.now();

      return {
        done: false,
        value: {results, errors}
      };
    }
  }

  function timeEventListeners(cls) {
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
  }

  function timeActions(cls) {
    if (!cls.actions) return;
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
          value: 'timeActions:wrapper',
        });
        return thunkReplacement;
      };
      actionReplacement.implementation = action;
      Object.defineProperty(actionReplacement, 'name', {value: debugName});
      cls.actions[name] = actionReplacement;
    }
  }

  return {
    afterRender,
    animationFrame,
    BatchIterator,
    buildProperties,
    buildState,
    deepFreeze,
    getActiveElement,
    idle,
    isElementChildOf,
    measureHistograms,
    measureTable,
    measureTrace,
    setImmutable,
    timeActions,
    timeEventListeners,
    timeout,
  };
});
