/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  // TODO compute this based on how multiple timeseries x coordinates line up
  const MAX_POINTS = 500;

  class TimeseriesIterator {
    constructor(lineDescriptor, timeseries, range) {
      this.minTimestampMs_ = range.minTimestampMs;
      this.maxTimestampMs_ = range.maxTimestampMs;
      this.minRevision_ = range.minRevision;
      this.maxRevision_ = range.maxRevision;
      this.lineDescriptor_ = lineDescriptor;
      this.timeseries_ = timeseries;
      this.index_ = this.findStartIndex_();
      // The index of the last Histogram that will be yielded:
      this.endIndex_ = Math.min(
          this.findEndIndex_(), this.timeseries_.length - 1);
      this.indexDelta_ = Math.max(
          1, (this.endIndex_ - this.index_) / MAX_POINTS);
    }

    findStartIndex_() {
      if (this.minTimestampMs_) {
        return tr.b.findLowIndexInSortedArray(
            this.timeseries_, ChartTimeseries.getTimestamp,
            this.minTimestampMs_);
      }
      if (this.minRevision_) {
        return tr.b.findLowIndexInSortedArray(
            this.timeseries_, ChartTimeseries.getX,
            this.minRevision_);
      }
      return 0;
    }

    findEndIndex_() {
      if (this.maxTimestampMs_) {
        return tr.b.findLowIndexInSortedArray(
            this.timeseries_, ChartTimeseries.getTimestamp,
            this.maxTimestampMs_);
      }
      if (this.maxRevision_) {
        return tr.b.findLowIndexInSortedArray(
            this.timeseries_, ChartTimeseries.getX,
            this.maxRevision_);
      }
      return this.timeseries_.length - 1;
    }

    get current() {
      return this.timeseries_[Math.min(this.roundIndex_, this.endIndex_)];
    }

    get roundIndex_() {
      return Math.round(this.index_);
    }

    get done() {
      return !this.current || (this.roundIndex_ > this.endIndex_);
    }

    next() {
      this.index_ += this.indexDelta_;
    }
  }

  class MultiTimeseriesIterator {
    constructor(lineDescriptor, timeserieses, range) {
      this.iterators_ = timeserieses.map(timeseries => new TimeseriesIterator(
          lineDescriptor, timeseries, range));
    }

    get allDone_() {
      for (const iterator of this.iterators_) {
        if (!iterator.done) return false;
      }
      return true;
    }

    * [Symbol.iterator]() {
      while (!this.allDone_) {
        const merged = new cp.FastHistogram();
        let minX = Infinity;
        for (const iterator of this.iterators_) {
          if (!iterator.current) continue;
          merged.addHistogram(iterator.current);
          if (!iterator.done) {
            minX = Math.min(minX, ChartTimeseries.getX(iterator.current));
          }
        }
        yield [minX, merged];

        // Increment all iterators whose X coordinate is minX.
        for (const iterator of this.iterators_) {
          if (!iterator.done &&
              ChartTimeseries.getX(iterator.current) === minX) {
            iterator.next();
          }
        }
      }
    }
  }

  class ChartTimeseries extends cp.ElementBase {
    showPlaceholder(isLoading, lines) {
      return !isLoading && this._empty(lines);
    }

    observeLineDescriptors_() {
      // Changing any of lineDescriptors/minRevision/maxRevision causes Polymer
      // to call this method. Changing all 3 at once causes Polymer to call it 3
      // times within the same task, so use debounce to only call load() once.
      this.debounce('load', () => {
        this.dispatch('load', this.statePath);
      }, Polymer.Async.microTask);
    }

    onDotMouseOver_(event) {
      this.dispatch('dotMouseOver_', this.statePath,
          event.detail.line, event.detail.datum);
    }

    onDotMouseOut_(event) {
      this.dispatch('dotMouseOut_', this.statePath);
    }

    observeLines_(newLines, oldLines) {
      const newLength = newLines ? newLines.length : 0;
      const oldLength = oldLines ? oldLines.length : 0;
      if (newLength === oldLength) return;
      this.dispatchEvent(new CustomEvent('line-count-change', {
        bubbles: true,
        composed: true,
      }));
    }
  }

  ChartTimeseries.properties = {
    ...cp.ElementBase.statePathProperties('statePath', {
      isLoading: {type: Boolean},
      zeroYAxis: {
        type: Boolean,
        observer: 'observeLineDescriptors_',
      },
      fixedXAxis: {
        type: Boolean,
        observer: 'observeLineDescriptors_',
      },
      mode: {
        type: String,
        observer: 'observeLineDescriptors_',
      },
      maxRevision: {
        type: Number,
        observer: 'observeLineDescriptors_',
      },
      minRevision: {
        type: Number,
        observer: 'observeLineDescriptors_',
      },
      lines: {
        type: Array,
        observer: 'observeLines_',
      },
      lineDescriptors: {
        type: Array,
        observer: 'observeLineDescriptors_',
      },
    }),
  };

  ChartTimeseries.newState = () => {
    const state = cp.ChartBase.newState();
    return {
      ...state,
      lineDescriptors: [],
      minRevision: undefined,
      maxRevision: undefined,
      brushRevisions: [],
      isLoading: false,
      xAxis: {
        ...state.xAxis,
        generateTicks: true,
      },
      yAxis: {
        ...state.yAxis,
        generateTicks: true,
      },
    };
  };

  function arraySetEqual(a, b) {
    if (a.length !== b.length) return false;
    for (const e of a) {
      if (!b.includes(e)) return false;
    }
    return true;
  }

  ChartTimeseries.lineDescriptorEqual = (a, b) => {
    if (a === b) return true;
    if (!arraySetEqual(a.testSuites, b.testSuites)) return false;
    if (!arraySetEqual(a.bots, b.bots)) return false;
    if (!arraySetEqual(a.testCases, b.testCases)) return false;
    if (a.measurement !== b.measurement) return false;
    if (a.statistic !== b.statistic) return false;
    if (a.buildType !== b.buildType) return false;
    if (a.minTimestampMs !== b.minTimestampMs) return false;
    if (a.maxTimestampMs !== b.maxTimestampMs) return false;
    if (a.minRevision !== b.minRevision) return false;
    if (a.maxRevision !== b.maxRevision) return false;
    return true;
  };

  ChartTimeseries.actions = {
    prefetch: (statePath, lineDescriptors) => async(dispatch, getState) => {
      for (const lineDescriptor of lineDescriptors) {
        dispatch(ChartTimeseries.actions.fetchLineDescriptor(
            statePath, lineDescriptor));
      }
    },

    load: statePath => async(dispatch, getState) => {
      let state = Polymer.Path.get(getState(), statePath);
      if (!state) return;

      cp.ElementBase.actions.updateObject(statePath, {
        isLoading: true,
        lines: [],
      })(dispatch, getState);

      // Load each lineDescriptor in parallel.
      await Promise.all(state.lineDescriptors.map(lineDescriptor =>
        dispatch(ChartTimeseries.actions.loadLineDescriptor_(
            statePath, lineDescriptor))));
      state = Polymer.Path.get(getState(), statePath);
      if (!state) return;
      dispatch(cp.ElementBase.actions.updateObject(
          statePath, {isLoading: false}));
    },

    fetchLineDescriptor: (statePath, lineDescriptor) =>
      async(dispatch, getState) => {
        const fetchDescriptors = ChartTimeseries.createFetchDescriptors(
            lineDescriptor);
        // Don't display anything until we have all the data back.
        // TODO batch and display partial data with animated dashed lines.
        return await Promise.all(fetchDescriptors.map(async fetchDescriptor => {
          try {
            const ts = await dispatch(cp.ReadTimeseries({
              fetchDescriptor,
              refStatePath: statePath,
            }));
            return ts;
          } catch (err) {
          }
        }));
      },

    loadLineDescriptor_: (statePath, lineDescriptor) =>
      async(dispatch, getState) => {
        const { fetchLineDescriptor, measureYTicks_ } = ChartTimeseries.actions;

        let timeserieses = await dispatch(
            ChartTimeseries.actions.fetchLineDescriptor(
                statePath, lineDescriptor));
        timeserieses = timeserieses.filter(ts => ts.data.length > 0);
        if (timeserieses.length === 0) return;

        await cp.ElementBase.afterRender(); // TODO remove

        const state = Polymer.Path.get(getState(), statePath);

        if (!state) {
          // This chart is no longer in the redux store.
          return;
        }

        if (0 === state.lineDescriptors.filter(other =>
          ChartTimeseries.lineDescriptorEqual(
              lineDescriptor, other)).length) {
          // This lineDescriptor is no longer in state.lineDescriptors, so
          // ignore it.
          return;
        }

        for (const line of state.lines) {
          if (ChartTimeseries.lineDescriptorEqual(
              line.descriptor, lineDescriptor)) {
            // |lineDescriptor| is already in state.lines, so ignore it.
            return;
          }
        }

        dispatch({
          type: ChartTimeseries.reducers.layout.typeName,
          statePath,
          lineDescriptor,
          timeserieses,
        });
        dispatch(
            ChartTimeseries.actions.measureYTicks_(statePath, lineDescriptor));
      },

    measureYTicks_: (statePath, lineDescriptor) =>
      async(dispatch, getState) => {
        const state = Polymer.Path.get(getState(), statePath);
        const ticks = new Set();
        if (state.yAxis.ticksForUnitName) {
          for (const unitTicks of state.yAxis.ticksForUnitName.values()) {
            for (const tick of unitTicks) {
              ticks.add(tick.text);
            }
          }
        }
        for (const line of state.lines) {
          if (!line.ticks) continue;
          for (const tick of line.ticks) {
            ticks.add(tick.text);
          }
        }
        if (ticks.size === 0) return;
        const rects = await Promise.all([...ticks].map(tick =>
          cp.measureText(tick)));
        const width = tr.b.math.Statistics.max(rects, rect => rect.width);
        cp.ElementBase.actions.updateObject(statePath + '.yAxis', {
          width,
        })(dispatch, getState);
      },

    dotMouseOver_: (statePath, line, datum) => async(dispatch, getState) => {
      dispatch({
        type: ChartTimeseries.reducers.mouseYTicks.typeName,
        statePath,
        line,
      });
      const rows = [];
      rows.push({name: 'value', value: line.unit.format(datum.y)});
      const commitPos = datum.hist.diagnostics.get(
          tr.v.d.RESERVED_NAMES.CHROMIUM_COMMIT_POSITIONS);
      if (commitPos) {
        const range = new tr.b.math.Range();
        for (const pos of commitPos) range.addValue(pos);
        let value = range.min;
        if (range.range) value += '-' + range.max;
        rows.push({name: 'chromium', value});
      }
      const uploadTimestamp = datum.hist.diagnostics.get(
          tr.v.d.RESERVED_NAMES.UPLOAD_TIMESTAMP);
      if (uploadTimestamp) {
        rows.push({
          name: 'upload timestamp',
          value: uploadTimestamp.toString(),
        });
      }
      rows.push({name: 'build type', value: line.descriptor.buildType});
      if (line.descriptor.testSuites.length === 1) {
        rows.push({
          name: 'test suite',
          value: line.descriptor.testSuites[0],
        });
      }
      rows.push({name: 'measurement', value: line.descriptor.measurement});
      if (line.descriptor.bots.length === 1) {
        rows.push({name: 'bot', value: line.descriptor.bots[0]});
      }
      if (line.descriptor.testCases.length === 1) {
        rows.push({
          name: 'test case',
          value: line.descriptor.testCases[0],
        });
      }
      cp.ChartBase.actions.tooltip(statePath, rows)(dispatch, getState);
    },

    dotMouseOut_: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartTimeseries.reducers.mouseYTicks.typeName,
        statePath,
      });
    },
  };

  const SHADE_FILL_ALPHA = 0.2;

  ChartTimeseries.assignColors = lines => {
    const isTestLine = line => line.descriptor.buildType !== 'ref';
    const testLines = lines.filter(isTestLine);
    const colors = cp.generateColors(testLines.length, {hueOffset: 0.64});
    const colorByDescriptor = new Map();
    for (const line of testLines) {
      const color = colors.shift();
      colorByDescriptor.set(ChartTimeseries.stringifyDescriptor(
          {...line.descriptor, buildType: undefined}), color);
      line.color = color.toString();
      line.shadeFill = color.withAlpha(SHADE_FILL_ALPHA).toString();
    }
    for (const line of lines) {
      if (isTestLine(line)) continue;
      if (lines.length === (1 + testLines.length)) {
        // There's only a single ref build line, so make it black for visual
        // simplicity. Chart-legend entries that aren't selected are grey, and
        // x-axis lines are grey, so disambiguate by avoiding grey here.
        line.color = 'rgba(0, 0, 0, 1)';
        line.shadeFill = `rgba(0, 0, 0, ${SHADE_FILL_ALPHA})`;
        break;
      }
      const color = colorByDescriptor.get(ChartTimeseries.stringifyDescriptor(
          {...line.descriptor, buildType: undefined}));
      if (color) {
        const hsl = color.toHSL();
        const adjusted = tr.b.Color.fromHSL({
          h: hsl.h,
          s: 1,
          l: 0.9,
        });
        line.color = adjusted.toString();
        line.shadeFill = adjusted.withAlpha(SHADE_FILL_ALPHA).toString();
      } else {
        line.color = 'white';
        line.shadeFill = 'white';
      }
    }
  };

  ChartTimeseries.reducers = {
    layout: (state, action, rootState) => {
      // Transform action.timeserieses to build a line to append to state.lines.
      const timeserieses = action.timeserieses.map(ts => ts.data);
      const data = ChartTimeseries.mergeTimeserieses(
          action.lineDescriptor, timeserieses, {
            minRevision: state.minRevision,
            maxRevision: state.maxRevision,
            minTimestamp: state.minTimestamp,
            maxTimestamp: state.maxTimestamp,
          });
      if (data.length === 0) return state;

      let unit = action.timeserieses[0].unit;
      if (state.mode === 'delta') {
        unit = unit.correspondingDeltaUnit;
        const offset = data[0].y;
        for (const datum of data) {
          datum.y -= offset;
        }
      }

      state = ChartTimeseries.cloneLines(state);
      state.lines.push({
        descriptor: action.lineDescriptor,
        unit,
        data,
        strokeWidth: 1,
      });
      ChartTimeseries.assignColors(state.lines);
      state = cp.ChartBase.layoutLinesInPlace(state);
      state = ChartTimeseries.brushRevisions(state);
      return state;
    },

    mouseYTicks: (state, action, rootState) => {
      if (!state.yAxis.generateTicks) return state;
      if (!((state.mode === 'normalizeLine') || (state.mode === 'center')) &&
          (state.yAxis.ticksForUnitName.size === 1)) {
        return state;
      }
      let ticks = [];
      if (action.line) {
        if (state.mode === 'normalizeLine' || state.mode === 'center') {
          ticks = action.line.ticks;
        } else {
          ticks = state.yAxis.ticksForUnitName.get(
              action.line.unit.unitName);
        }
      }
      return {...state, yAxis: {...state.yAxis, ticks}};
    },
  };

  ChartTimeseries.brushRevisions = state => {
    const brushes = state.brushRevisions.map(x => {
      let closestDatum;
      for (const line of state.lines) {
        const datum = tr.b.findClosestElementInSortedArray(
            line.data, d => d.x, x);
        if (closestDatum === undefined ||
            (Math.abs(closestDatum.x - x) > Math.abs(datum.x - x))) {
          closestDatum = datum;
        }
      }
      return {...closestDatum, x};
    });
    return {...state, xAxis: {...state.xAxis, brushes}};
  };

  ChartTimeseries.cloneLines = state => {
    // Clone the line object so we can reassign its color later.
    // Clone the data so we can re-normalize it later along with the new
    // line.
    return {...state, lines: state.lines.map(line => {
      return {...line, data: line.data.map(datum => {
        return {...datum};
      })};
    })};
  };

  // Strip out min/maxRevision/Timestamp and ensure a consistent key order.
  ChartTimeseries.stringifyDescriptor = lineDescriptor => JSON.stringify([
    lineDescriptor.testSuites,
    lineDescriptor.measurement,
    lineDescriptor.bots,
    lineDescriptor.testCases,
    lineDescriptor.statistic,
    lineDescriptor.buildType,
  ]);

  ChartTimeseries.createFetchDescriptors = lineDescriptor => {
    let testCases = lineDescriptor.testCases;
    if (testCases.length === 0) testCases = [undefined];
    const fetchDescriptors = [];
    for (const testSuite of lineDescriptor.testSuites) {
      for (const bot of lineDescriptor.bots) {
        for (const testCase of testCases) {
          fetchDescriptors.push({
            testSuite,
            bot,
            measurement: lineDescriptor.measurement,
            testCase,
            statistic: lineDescriptor.statistic,
            buildType: lineDescriptor.buildType,
            levelOfDetail: cp.LEVEL_OF_DETAIL.XY,
          });
        }
      }
    }
    return fetchDescriptors;
  };

  ChartTimeseries.mergeTimeserieses = (lineDescriptor, timeserieses, range) => {
    function getIcon(hist) {
      if (hist.alert) return hist.alert.improvement ? 'thumb-up' : 'error';
      if (!lineDescriptor.icons) return '';
      // TODO remove lineDescriptor.icons
      const revisions = [...hist.diagnostics.get(
          tr.v.d.RESERVED_NAMES.CHROMIUM_COMMIT_POSITIONS)];
      for (const icon of lineDescriptor.icons) {
        if (revisions.includes(icon.revision)) return icon.icon;
      }
      return '';
    }

    const lineData = [];
    const iter = new MultiTimeseriesIterator(
        lineDescriptor, timeserieses, range);
    for (const [x, hist] of iter) {
      lineData.push({
        hist,
        x,
        y: hist.running[lineDescriptor.statistic],
        icon: getIcon(hist),
      });
    }
    lineData.sort((a, b) => a.x - b.x);
    return lineData;
  };

  ChartTimeseries.getX = hist => {
    // TODO revisionTimestamp
    const commitPos = hist.diagnostics.get(
        tr.v.d.RESERVED_NAMES.CHROMIUM_COMMIT_POSITIONS);
    if (commitPos) {
      return tr.b.math.Statistics.min(commitPos);
    }
    return ChartTimeseries.getTimestamp(hist).getTime();
  };

  ChartTimeseries.getTimestamp = hist => {
    const timestamp = hist.diagnostics.get(
        tr.v.d.RESERVED_NAMES.UPLOAD_TIMESTAMP);
    return timestamp.minDate;
  };

  cp.ElementBase.register(ChartTimeseries);

  return {
    ChartTimeseries,
    MultiTimeseriesIterator,
  };
});
