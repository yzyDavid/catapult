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

  async function sha(s) {
    s = new TextEncoder('utf-8').encode(s);
    const hash = await crypto.subtle.digest('SHA-256', s);
    const view = new DataView(hash);
    let hex = '';
    for (let i = 0; i < view.byteLength; i += 4) {
      hex += ('00000000' + view.getUint32(i).toString(16)).slice(-8);
    }
    return hex;
  }

  /*
   * Returns the bounding rect of the given element.
   */
  async function measureElement(element) {
    if (!measureElement.READY) {
      measureElement.READY = cp.animationFrame().then(() => {
        measureElement.READY = undefined;
      });
    }
    await measureElement.READY;
    return element.getBoundingClientRect();
  }

  // measureText() below takes a string and optional style options, renders the
  // text in this div, and returns the size of the text. This div helps
  // measureText() render its arguments invisibly.
  const MEASURE_TEXT_HOST = document.createElement('div');
  MEASURE_TEXT_HOST.style.position = 'fixed';
  MEASURE_TEXT_HOST.style.visibility = 'hidden';
  MEASURE_TEXT_HOST.style.zIndex = -1000;
  window.addEventListener('load', () =>
    document.body.appendChild(MEASURE_TEXT_HOST));

  // Assuming the computed style of MEASURE_TEXT_HOST doesn't change, measuring
  // a string with the same options should always return the same size, so the
  // measurements can be memoized. Also, measuring text is asynchronous, so this
  // cache can store promises in case callers try to measure the same text twice
  // in the same frame.
  const MEASURE_TEXT_CACHE = new Map();
  const MAX_MEASURE_TEXT_CACHE_SIZE = 1000;

  /*
   * Returns the bounding rect of the given textContent after applying the given
   * opt_options to a <span> containing textContent.
   */
  async function measureText(textContent, opt_options) {
    let cacheKey = {textContent, ...opt_options};
    cacheKey = JSON.stringify(cacheKey, Object.keys(cacheKey).sort());
    if (MEASURE_TEXT_CACHE.has(cacheKey)) {
      return await MEASURE_TEXT_CACHE.get(cacheKey);
    }

    const span = document.createElement('span');
    span.style.whiteSpace = 'nowrap';
    span.style.display = 'inline-block';
    span.textContent = textContent;
    Object.assign(span.style, opt_options);
    MEASURE_TEXT_HOST.appendChild(span);

    const promise = cp.measureElement(span).then(({width, height}) => {
      return {width, height};
    });
    while (MEASURE_TEXT_CACHE.size > MAX_MEASURE_TEXT_CACHE_SIZE) {
      MEASURE_TEXT_CACHE.delete(MEASURE_TEXT_CACHE.keys().next().value);
    }
    MEASURE_TEXT_CACHE.set(cacheKey, promise);
    const rect = await promise;
    MEASURE_TEXT_CACHE.set(cacheKey, rect);
    MEASURE_TEXT_HOST.removeChild(span);
    return rect;
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

  /**
   * Wrap Google Sign-in client library to build the Authorization header, if
   * one is available. Automatically reloads the token if necessary.
   */
  async function authorizationHeaders() {
    if (window.gapi === undefined) return [];
    if (gapi.auth2 === undefined) return [];

    const auth = gapi.auth2.getAuthInstance();
    if (!auth) return [];
    const user = auth.currentUser.get();
    let response = user.getAuthResponse();

    if (response.expires_at === undefined) {
      // The user is not signed in.
      return [];
    }

    if (response.expires_at < new Date()) {
      // The token has expired, so reload it.
      response = await user.reloadAuthResponse();
    }

    return [
      ['Authorization', response.token_type + ' ' + response.access_token],
    ];
  }

  /**
   * Generate pretty colors!
   * http://basecase.org/env/on-rainbows
   * https://mycarta.wordpress.com/2012/10/06/the-rainbow-is-deadlong-live-the-rainbow-part-3/
   *
   * Set brightnessPct = 0 to always generate black.
   * Set brightnessPct = 1 to always generate white.
   * Set brightnessPct = .5 to generate saturated colors.
   *
   * @param {number} huePct
   * @param {number} brightnessPct
   * @return {!tr.b.Color}
   */
  function sinebowColor(huePct, brightnessPct) {
    // TODO smooth huePct using spline
    const h = -(huePct + .5);
    let r = Math.sin(Math.PI * h);
    let g = Math.sin(Math.PI * (h + 1 / 3));
    let b = Math.sin(Math.PI * (h + 2 / 3));
    r *= r;
    g *= g;
    b *= b;

    // Roughly correct for human perception.
    // https://en.wikipedia.org/wiki/Luma_%28video%29
    // Multiply by 2 to normalize all values to 0.5.
    // (Halfway between black and white.)
    const y = 2 * (0.2989 * r + 0.5870 * g + 0.1140 * b);
    r /= y;
    g /= y;
    b /= y;

    if (brightnessPct <= 0.5) {
      r *= brightnessPct * 2;
      g *= brightnessPct * 2;
      b *= brightnessPct * 2;
    } else {
      const brightness = tr.b.math.normalize(brightnessPct, .5, 1);
      r = tr.b.math.lerp(brightness, r, 1);
      g = tr.b.math.lerp(brightness, g, 1);
      b = tr.b.math.lerp(brightness, b, 1);
    }
    r *= 256;
    g *= 256;
    b *= 256;
    r = Math.round(r);
    g = Math.round(g);
    b = Math.round(b);
    return new tr.b.Color(r, g, b);
  }

  /**
   * Compute a given number of colors by evenly spreading them around the
   * sinebow hue circle, or, if a Range of brightnesses is given, the hue x
   * brightness cylinder.
   *
   * @param {Number} numColors
   * @param {!Range} opt_options.brightnessRange
   * @param {Number} opt_options.brightnessPct
   * @param {Number} opt_options.hueOffset
   * @return {!Array.<!tr.b.Color>}
   */
  function generateColors(numColors, opt_options) {
    const options = opt_options || {};
    const brightnessRange = options.brightnessRange;
    const hueOffset = options.hueOffset || 0;
    const colors = [];
    if (numColors > 15 && brightnessRange) {
      // Evenly spread numColors around the surface of the hue x brightness
      // cylinder. Maximize distance between (huePct, brightnessPct) vectors.
      const numCycles = Math.round(numColors / 15);
      for (let i = 0; i < numCycles; ++i) {
        colors.push.apply(colors, generateColors(15, {
          brightnessPct: brightnessRange.lerp(i / (numCycles - 1)),
        }));
      }
    } else {
      // Evenly spread numColors throughout the sinebow hue circle.
      const brightnessPct = (options.brightnessPct === undefined) ? 0.5 :
        options.brightnessPct;
      for (let i = 0; i < numColors; ++i) {
        const huePct = hueOffset + (i / numColors);
        colors.push(sinebowColor(huePct, brightnessPct));
      }
    }
    return colors;
  }

  function normalize(columns, cells) {
    const dict = {};
    for (let i = 0; i < columns.length; ++i) {
      dict[columns[i]] = cells[i];
    }
    return dict;
  }

  return {
    afterRender,
    animationFrame,
    authorizationHeaders,
    BatchIterator,
    buildProperties,
    buildState,
    deepFreeze,
    generateColors,
    getActiveElement,
    idle,
    isElementChildOf,
    measureElement,
    measureHistograms,
    measureTable,
    measureText,
    measureTrace,
    normalize,
    setImmutable,
    sha,
    timeActions,
    timeEventListeners,
    timeout,
  };
});
