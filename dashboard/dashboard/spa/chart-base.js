/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  PolymerSvgTemplate('chart-base');

  class ChartBase extends Polymer.GestureEventListeners(cp.ElementBase) {
    collectIcons_(line) {
      return line.data.filter(datum => datum.icon);
    }

    antiBrushes_(brushes) {
      return ChartBase.antiBrushes(brushes);
    }

    onDotClick_(event) {
      event.cancelBubble = true;
      this.dispatchEvent(new CustomEvent('dot-click', {
        bubbles: true,
        composed: true,
        detail: {
          ctrlKey: event.detail.sourceEvent.ctrlKey,
          datum: event.model.datum,
          datumIndex: event.model.datumIndex,
          line: event.model.parentModel.line,
          lineIndex: event.model.parentModel.lineIndex,
        },
      }));
    }

    onMainClick_(event) {
      this.dispatchEvent(new CustomEvent('chart-click', {
        bubbles: true,
        composed: true,
      }));
    }

    async onDotMouseOver_(event) {
      const chartRect = await cp.measureElement(this.$.main);
      this.dispatch('dotMouseOver', this.statePath,
          chartRect,
          event.model.parentModel.lineIndex,
          event.model.datum);
      this.dispatchEvent(new CustomEvent('dot-mouseover', {
        bubbles: true,
        composed: true,
        detail: {
          datum: event.model.datum,
          datumIndex: event.model.datumIndex,
          line: event.model.parentModel.line,
          lineIndex: event.model.parentModel.lineIndex,
          sourceEvent: event,
        },
      }));
    }

    tooltipHidden_(tooltip) {
      return !tooltip || !tooltip.isVisible || this._empty(tooltip.rows);
    }

    onDotMouseOut_(event) {
      this.dispatch('dotMouseOut', this.statePath,
          event.model.parentModel.lineIndex);
      this.dispatchEvent(new CustomEvent('dot-mouseout', {
        bubbles: true,
        composed: true,
        detail: {
          datum: event.model.datum,
          datumIndex: event.model.datumIndex,
          line: event.model.parentModel.line,
          lineIndex: event.model.parentModel.lineIndex,
          sourceEvent: event,
        },
      }));
    }

    async onTrackBrushHandle_(event) {
      const xPct = ChartBase.computeBrush(
          event.detail.x, await cp.measureElement(this.$.main));
      this.dispatch('brushX', this.statePath, event.model.brushIndex, xPct);
      this.dispatchEvent(new CustomEvent('brush', {
        bubbles: true,
        composed: true,
        detail: {
          brushIndex: event.model.brushIndex,
          sourceEvent: event,
        },
      }));
    }

    brushPointSize_(brushSize) {
      if (isNaN(brushSize)) return 0;
      return brushSize * 1.5;
    }

    brushPointPx_(brushSize) {
      return this.brushPointSize_(brushSize) + 'px';
    }

    totalHeight_(graphHeight, brushSize, xAxisHeight) {
      return graphHeight + this.brushPointSize_(brushSize) + xAxisHeight;
    }
  }

  ChartBase.properties = cp.ElementBase.statePathProperties('statePath', {
    bars: {type: Array, value: []},
    brushSize: {type: Number, value: 10},
    columns: {type: Array, value: []},
    dotCursor: {type: String},
    dotRadius: {type: Number, value: 6},
    graphHeight: {type: Number, value: 200},
    lines: {type: Array, value: []},
    tooltip: {type: Object},
    xAxis: {type: Object, value: {height: 0}},
    yAxis: {type: Object, value: {width: 0}},
  });

  ChartBase.newState = () => {
    return {
      bars: [],
      brushSize: 10,
      columns: [],
      dotCursor: 'pointer',
      dotRadius: 6,
      graphHeight: 200,
      lines: [],
      tooltip: {
        isVisible: false,
        left: '',
        right: '',
        top: '',
        bottom: '',
        color: '',
        rows: [],
      },
      xAxis: {
        brushes: [],
        height: 0,
        range: new tr.b.math.Range(),
        showTickLines: false,
        ticks: [],
      },
      yAxis: {
        brushes: [],
        range: new tr.b.math.Range(),
        showTickLines: false,
        ticks: [],
        width: 0,
      },
    };
  };

  ChartBase.actions = {
    brushX: (statePath, brushIndex, xPct) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(
          `${statePath}.xAxis.brushes.${brushIndex}`,
          {xPct}));
    },

    boldLine: (statePath, lineIndex) => async(dispatch, getState) => {
      dispatch({
        type: ChartBase.reducers.boldLine.typeName,
        statePath,
        lineIndex,
      });
    },

    dotMouseOver: (statePath, chartRect, lineIndex, datum) =>
      async(dispatch, getState) => {
        dispatch(ChartBase.actions.boldLine(statePath, lineIndex));
        dispatch({
          type: ChartBase.reducers.dotMouseOver.typeName,
          statePath,
          chartRect,
          lineIndex,
          datum,
        });
      },

    tooltip: (statePath, rows) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(
          statePath + '.tooltip', {rows}));
    },

    unboldLines: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartBase.reducers.unboldLines.typeName,
        statePath,
      });
    },

    dotMouseOut: (statePath, lineIndex) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(
          `${statePath}.tooltip`, {isVisible: false}));
      dispatch({
        type: ChartBase.reducers.unboldLines.typeName,
        statePath,
      });
    },
  };

  const COS_45 = Math.cos(Math.PI / 4);
  const ERROR_ICON_RADIUS_PX = 10.8;

  ChartBase.reducers = {
    unboldLines: (state, action, rootState) => {
      const lines = state.lines.map(line => {
        return {...line, strokeWidth: 1};
      });
      return {...state, lines};
    },

    boldLine: (state, action, rootState) => {
      const lines = Array.from(state.lines);
      // Set its strokeWidth:2
      const line = lines[action.lineIndex];
      lines.splice(action.lineIndex, 1, {
        ...line,
        strokeWidth: 2,
      });
      if (action.lineIndex !== (lines.length - 1)) {
        // Move action.lineIndex to the end so it is drawn over top of any other
        // lines.
        [lines[action.lineIndex], lines[lines.length - 1]] =
          [lines[lines.length - 1], lines[action.lineIndex]];
      }
      return {...state, lines};
    },

    dotMouseOver: (state, action, rootState) => {
      let dotRadius = state.dotRadius;
      if (action.datum.icon === 'error') dotRadius = ERROR_ICON_RADIUS_PX;
      const offset = COS_45 * dotRadius;

      // All these coordinates are pixels relative to the top left corner of
      // #main.
      const dotCenter = {
        x: action.chartRect.width * parseFloat(action.datum.xPct) / 100,
        y: action.chartRect.height * parseFloat(action.datum.yPct) / 100,
      };
      const chartCenter = {
        x: action.chartRect.width / 2,
        y: action.chartRect.height / 2,
      };

      const roundPx = x => (Math.round(10 * (x + offset)) / 10) + 'px';

      let top = '';
      let bottom = '';
      if (dotCenter.y > chartCenter.y) {
        bottom = roundPx(action.chartRect.height - dotCenter.y);
      } else {
        top = roundPx(dotCenter.y);
      }

      let left = '';
      let right = '';
      if (dotCenter.x > chartCenter.x) {
        right = roundPx(action.chartRect.width - dotCenter.x);
      } else {
        left = roundPx(dotCenter.x);
      }

      return {
        ...state,
        tooltip: {
          bottom,
          color: state.lines[action.lineIndex].color,
          isVisible: true,
          left,
          right,
          rows: [], // Embedder must dispatch actions.tooltip
          top,
        },
      };
    },
  };

  ChartBase.antiBrushes = brushes => {
    if (!brushes || brushes.length === 0) return [];
    if (brushes.length % 2 === 1) throw new Error('Odd number of brushes');
    brushes = brushes.map(brush =>
      parseFloat(brush.xPct)).sort((a, b) => a - b);
    let previous = {start: 0, length: undefined};
    const antiBrushes = [previous];
    for (let i = 0; i < brushes.length; i += 2) {
      previous.length = (brushes[i] - previous.start) + '%';
      previous.start += '%';
      if (brushes[i + 1] === 100) return antiBrushes;
      previous = {start: brushes[i + 1], length: undefined};
      antiBrushes.push(previous);
    }
    previous.length = (100 - previous.start) + '%';
    previous.start += '%';
    return antiBrushes;
  };

  ChartBase.fixLinesXInPlace = lines => {
    let rawXs = new Set();
    for (const line of lines) {
      for (const datum of line.data) {
        rawXs.add(datum.x);
      }
    }
    rawXs = Array.from(rawXs);
    rawXs.sort((x, y) => x - y);
    for (const line of lines) {
      for (const datum of line.data) {
        datum.xFixed = rawXs.indexOf(datum.x);
      }
    }
    return rawXs;
  };

  function getX(datum) {
    return (datum.xFixed !== undefined) ? datum.xFixed : datum.x;
  }

  ChartBase.layoutLinesInPlace = state => {
    let rawXs;
    if (state.fixedXAxis) {
      rawXs = cp.ChartBase.fixLinesXInPlace(state.lines);
    }

    // Extend xRange by 1% in both directions in order to make it easier to
    // click on the endpoint dots. Without this, only half of the endpoint
    // dots would be drawn and clickable. Chart width can vary widely, but
    // 600px is is a good enough approximation.
    const xExtension = state.dotRadius ? 0.01 : 0;

    // Extend yRange by 3.75% in both directions in order to make it easier to
    // click on extreme dots. Without this, only half of the extreme dots
    // would be drawn and clickable. The main chart is 200
    // px tall and has dots with radius=6px, which is 3% of 200. This will
    // also reduce clipping yAxis.ticks, which are 15px tall and so can extend
    // 7.5px (3.75% of 200px) above/below extreme points if they happen to be
    // a round number.
    const yExtension = state.dotRadius ? 0.0375 : 0;

    const {xRange, yRangeForUnitName} = cp.ChartBase.normalizeLinesInPlace(
        state.lines, {
          mode: state.mode,
          zeroYAxis: state.zeroYAxis,
          xExtension,
          yExtension,
        });

    if (state.xAxis.generateTicks) {
      state = ChartBase.generateXTicksReducer(state, xRange, rawXs);
    }

    if (state.yAxis.generateTicks) {
      state = ChartBase.generateYTicksReducer(
          state, yRangeForUnitName, yExtension);
    }

    return state;
  };

  ChartBase.generateXTicksReducer = (state, xRange, rawXs) => {
    const xTickRange = new tr.b.math.Range();
    for (const line of state.lines) {
      if (line.data.length === 0) continue;
      xTickRange.addValue(line.data[0].x);
      xTickRange.addValue(line.data[line.data.length - 1].x);
    }

    const ticks = ChartBase.generateTicks(xTickRange).map(text => {
      let x = text;
      if (rawXs) {
        x = tr.b.findLowIndexInSortedArray(rawXs, x => x, text);
      }
      return {
        text,
        xPct: cp.roundDigits(xRange.normalize(x) * 100, 1) + '%',
      };
    });
    return {...state, xAxis: {...state.xAxis, ticks}};
  };

  ChartBase.normalizeLinesInPlace = (lines, opt_options) => {
    const options = opt_options || {};
    const mode = options.mode || 'normalizeUnit';
    const zeroYAxis = options.zeroYAxis || false;
    const yExtension = options.yExtension || 0;
    const xExtension = options.xExtension || 0;

    const xRange = new tr.b.math.Range();
    const yRangeForUnitName = new Map();
    let maxLineLength = 0;
    const maxLineRangeForUnitName = new Map();
    for (const line of lines) {
      maxLineLength = Math.max(maxLineLength, line.data.length);
      line.yRange = new tr.b.math.Range();
      if (zeroYAxis) line.yRange.addValue(0);

      for (const datum of line.data) {
        xRange.addValue(getX(datum));
        line.yRange.addValue(datum.y);
      }

      if (!yRangeForUnitName.has(line.unit.unitName)) {
        yRangeForUnitName.set(line.unit.unitName, new tr.b.math.Range());
      }

      line.yRange.min -= line.yRange.range * yExtension;
      line.yRange.max += line.yRange.range * yExtension;

      yRangeForUnitName.get(line.unit.unitName).addRange(line.yRange);

      if (line.yRange.range > (maxLineRangeForUnitName.get(
          line.unit.unitName) || 0)) {
        maxLineRangeForUnitName.set(line.unit.unitName, line.yRange.range);
      }
    }

    if (mode === 'center') {
      for (const line of lines) {
        const halfMaxLineRange = maxLineRangeForUnitName.get(
            line.unit.unitName) / 2;
        // Extend line.yRange to be as large as the largest range.
        line.yRange = tr.b.math.Range.fromExplicitRange(
            line.yRange.center - halfMaxLineRange,
            line.yRange.center + halfMaxLineRange);
      }
    }

    xRange.min -= xRange.range * xExtension;
    xRange.max += xRange.range * xExtension;

    // Round to tenth of a percent.
    const round = x => roundDigits(x * 100, 1);

    const isNormalizeLine = (
      mode === 'normalizeLine' || mode === 'center');
    for (const line of lines) {
      line.path = '';
      line.shadePoints = '';
      const yRange = isNormalizeLine ? line.yRange :
        yRangeForUnitName.get(line.unit.unitName);
      for (const datum of line.data) {
        datum.xPct = round(xRange.normalize(getX(datum)));
        // Y coordinates increase downwards.
        datum.yPct = round(1 - yRange.normalize(datum.y));
        if (isNaN(datum.xPct)) datum.xPct = '50';
        if (isNaN(datum.yPct)) datum.yPct = '50';
        const command = line.path ? ' L' : 'M';
        line.path += command + datum.xPct + ',' + datum.yPct;
        // Convert to strings for <circle>
        datum.xPct += '%';
        datum.yPct += '%';
        if (datum.shadeRange) {
          const shadeMax = round(1 - yRange.normalize(datum.shadeRange.max));
          line.shadePoints += ' ' + datum.xPct.slice(0, -1) + ',' + shadeMax;
        }
      }
      for (let i = line.data.length - 1; i >= 0; --i) {
        const datum = line.data[i];
        if (datum.shadeRange) {
          const shadeMin = round(1 - yRange.normalize(datum.shadeRange.min));
          line.shadePoints += ' ' + datum.xPct.slice(0, -1) + ',' + shadeMin;
        }
      }
    }
    return {xRange, yRangeForUnitName};
  };

  ChartBase.generateYTicksReducer = (
      state, yRangeForUnitName, yExtension) => {
    let yAxis = state.yAxis;
    let ticks = [];
    if (state.mode === 'normalizeLine' || state.mode === 'center') {
      for (const line of state.lines) {
        line.ticks = ChartBase.generateYTicks(
            line.yRange, line.unit, yExtension);
      }
      if (state.lines.length === 1) {
        ticks = state.lines[0].ticks;
      }
    } else {
      const ticksForUnitName = new Map();
      for (const [unitName, range] of yRangeForUnitName) {
        const unit = tr.b.Unit.byName[unitName];
        const ticks = ChartBase.generateYTicks(
            range, unit, yExtension);
        ticksForUnitName.set(unitName, ticks);
      }
      yAxis = {...yAxis, ticksForUnitName};
      if (ticksForUnitName.size === 1) {
        ticks = [...ticksForUnitName.values()][0];
      }
    }
    yAxis = {...yAxis, ticks};
    return {...state, yAxis};
  };

  ChartBase.generateYTicks = (displayRange, unit, yExtension) => {
    // Use the extended range to compute yPct, but the unextended range
    // to compute the ticks. TODO store both in normalizeLinesInPlace
    const dataRange = tr.b.math.Range.fromExplicitRange(
        displayRange.min + (displayRange.range * yExtension),
        displayRange.max - (displayRange.range * yExtension));
    return ChartBase.generateTicks(dataRange).map(y => {
      return {
        text: unit.format(y),
        yPct: cp.roundDigits(100 * (1 - displayRange.normalize(y)), 1) + '%',
      };
    });
  };

  ChartBase.generateTicks = range => {
    const ticks = [];
    if (range.min >= 0) {
      let tickDelta = tr.b.math.lesserPower(range.range);
      if ((range.range / tickDelta) < 5) tickDelta /= 10;
      if (range.min > 0) {
        range = tr.b.math.Range.fromExplicitRange(
            (range.min + tickDelta), range.max);
      }
      range = tr.b.math.Range.fromExplicitRange(
          (range.min - (range.min % tickDelta)),
          (range.max - (range.max % tickDelta)));
      tickDelta = range.range / 5;
      for (let x = range.min; x <= range.max; x += tickDelta) {
        ticks.push(x);
      }
    } else if (range.max <= 0) {
      const negRange = tr.b.math.Range.fromExplicitRange(
          -range.max, -range.min);
      for (const tick of ChartBase.generateTicks(negRange)) {
        ticks.push(-tick);
      }
    } else {
      const negTicks = ChartBase.generateTicks(
          tr.b.math.Range.fromExplicitRange(range.min, 0));
      const posTicks = ChartBase.generateTicks(
          tr.b.math.Range.fromExplicitRange(0, range.max)).slice(1);
      ticks.push(negTicks[0]);
      ticks.push(negTicks[2]);
      ticks.push(0);
      ticks.push(posTicks[2]);
      ticks.push(posTicks[4]);
    }
    ticks.sort((x, y) => x - y);
    return ticks;
  };

  ChartBase.computeBrush = (x, containerRect) => {
    const value = tr.b.math.normalize(
        x, containerRect.left, containerRect.right);
    return tr.b.math.clamp(100 * value, 0, 100) + '%';
  };

  cp.ElementBase.register(ChartBase);

  function roundDigits(value, digits) {
    const power = Math.pow(10, digits);
    return Math.round(value * power) / power;
  }

  return {
    ChartBase,
    roundDigits,
  };
});
