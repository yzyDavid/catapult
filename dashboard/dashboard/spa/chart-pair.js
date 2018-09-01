/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  /**
   * ChartPair synchronizes revision ranges and axis properties between two
   * charts. Typical use-case includes a minimap for overview and a chart for
   * mouse-over details.
   */
  class ChartPair extends cp.ElementBase {
    hideOptions_(minimapLayout) {
      return this.$.minimap.showPlaceholder(
          (minimapLayout && minimapLayout.isLoading),
          (minimapLayout ? minimapLayout.lines : []));
    }

    async onMenuKeyup_(event) {
      if (event.key === 'Escape') {
        await this.dispatch('showOptions', this.statePath, false);
      }
    }

    async onMenuBlur_(event) {
      if (cp.isElementChildOf(event.relatedTarget, this.$.options_container)) {
        return;
      }
      await this.dispatch('showOptions', this.statePath, false);
    }

    async onOptionsToggle_(event) {
      await this.dispatch('showOptions', this.statePath,
          !this.isShowingOptions);
    }

    async onMinimapBrush_(event) {
      if (event.detail.sourceEvent.detail.state !== 'end') return;
      await this.dispatch('brushMinimap', this.statePath);
      if (this.isLinked) {
        await this.dispatch('updateLinkedRevisions', this.linkedStatePath,
            this.minRevision, this.maxRevision);
      }
    }

    async onChartClick_(event) {
      await this.dispatch('chartClick', this.statePath);
    }

    async onDotClick_(event) {
      await this.dispatch('dotClick', this.statePath,
          event.detail.ctrlKey,
          event.detail.lineIndex,
          event.detail.datumIndex);
    }

    async onDotMouseOver_(event) {
      await this.dispatch('dotMouseOver', this.statePath,
          event.detail.lineIndex);
    }

    async onDotMouseOut_(event) {
      await this.dispatch('dotMouseOut', this.statePath);
    }

    async onBrush_(event) {
      await this.dispatch('brushChart', this.statePath,
          event.detail.brushIndex,
          event.detail.value);
    }

    async onToggleLinked_(event) {
      await this.dispatch('toggleLinked', this.statePath, this.linkedStatePath);
    }

    async onToggleZeroYAxis_(event) {
      await this.dispatch('toggleZeroYAxis', this.statePath);
      if (this.isLinked) {
        await this.dispatch('toggleLinkedZeroYAxis', this.linkedStatePath);
      }
    }

    async onToggleFixedXAxis_(event) {
      await this.dispatch('toggleFixedXAxis', this.statePath);
      if (this.isLinked) {
        await this.dispatch('toggleLinkedFixedXAxis', this.linkedStatePath);
      }
    }

    observeLineDescriptors_(newLineDescriptors, oldLineDescriptors) {
      if (newLineDescriptors === oldLineDescriptors) return; // WTF, polymer
      this.dispatch('load', this.statePath);
    }

    observeLinkedCursorRevision_() {
      if (!this.isLinked) return;
      // TODO
    }

    observeLinkedRevisions_() {
      if (!this.isLinked) return;
      this.dispatch('updateRevisions', this.statePath,
          this.linkedMinRevision, this.linkedMaxRevision);
    }

    observeLinkedMode_() {
      if (!this.isLinked) return;
      if (this.mode === this.linkedMode) return;
      this.dispatch('mode', this.statePath, this.linkedMode);
    }

    observeLinkedZeroYAxis_() {
      if (!this.isLinked) return;
      if (this.zeroYAxis === this.linkedZeroYAxis) return;
      this.dispatch('toggleZeroYAxis', this.statePath);
    }

    observeLinkedFixedXAxis_() {
      if (!this.isLinked) return;
      if (this.fixedXAxis === this.linkedFixedXAxis) return;
      this.dispatch('toggleFixedXAxis', this.statePath);
    }

    onModeChange_(event) {
      this.dispatch('mode', this.statePath, event.detail.value);
      if (this.isLinked) {
        this.dispatch('linkedMode', this.linkedStatePath, event.detail.value);
      }
    }

    observeChartLoading_(newLoading, oldLoading) {
      if (oldLoading && !newLoading) {
        this.dispatch('updateStale', this.statePath);
      }
    }
  }

  ChartPair.State = {
    lineDescriptors: {
      value: options => [],
      observer: 'observeLineDescriptors_',
    },
    isExpanded: options => options.isExpanded !== false,
    minimapLayout: options => {
      const minimapLayout = {
        ...cp.ChartTimeseries.buildState({}),
        dotCursor: '',
        dotRadius: 0,
        graphHeight: 40,
      };
      minimapLayout.xAxis.height = 15;
      minimapLayout.yAxis.width = 50;
      minimapLayout.yAxis.generateTicks = false;
      return minimapLayout;
    },
    chartLayout: options => {
      const chartLayout = cp.ChartTimeseries.buildState({});
      chartLayout.xAxis.height = 15;
      chartLayout.xAxis.showTickLines = true;
      chartLayout.yAxis.width = 50;
      chartLayout.yAxis.showTickLines = true;
      return chartLayout;
    },
    isShowingOptions: options => false,
    isLinked: options => options.isLinked !== false,
    cursorRevision: options => 0,
    minRevision: options => 0,
    maxRevision: options => 0,
    mode: options => options.mode || 'normalizeUnit',
    zeroYAxis: options => options.zeroYAxis || false,
    fixedXAxis: options => options.fixedXAxis !== false,
  };

  ChartPair.buildState = options => cp.buildState(ChartPair.State, options);

  ChartPair.observers = [
    'observeLinkedCursorRevision_(linkedCursorRevision)',
    'observeLinkedRevisions_(linkedMinRevision, linkedMaxRevision)',
    'observeLinkedMode_(linkedMode)',
    'observeLinkedZeroYAxis_(linkedZeroYAxis)',
    'observeLinkedFixedXAxis_(linkedFixedXAxis)',
  ];

  ChartPair.LinkedState = {
    linkedCursorRevision: options => 0,
    linkedMinRevision: options => 0,
    linkedMaxRevision: options => 0,
    linkedMode: options => 'normalizeUnit',
    linkedZeroYAxis: options => false,
    linkedFixedXAxis: options => true,
  };

  ChartPair.properties = {
    ...cp.buildProperties('state', ChartPair.State),
    ...cp.buildProperties('linkedState', ChartPair.LinkedState),
    isChartLoading: {
      computed: 'identity_(chartLayout.isLoading)',
      observer: 'observeChartLoading_',
    },
  };

  ChartPair.actions = {
    updateRevisions: (statePath, minRevision, maxRevision) =>
      async(dispatch, getState) => {
        dispatch(Redux.UPDATE(statePath, {minRevision, maxRevision}));
        ChartPair.actions.load(statePath)(dispatch, getState);
      },

    updateStale: statePath => async(dispatch, getState) => {
      dispatch({type: ChartPair.reducers.updateStale.name, statePath});
    },

    updateLinkedRevisions: (
        linkedStatePath, linkedMinRevision, linkedMaxRevision) =>
      async(dispatch, getState) => {
        dispatch(Redux.UPDATE(linkedStatePath, {
          linkedMinRevision, linkedMaxRevision,
        }));
      },

    toggleLinked: (statePath, linkedStatePath) => async(dispatch, getState) => {
      const linkedState = Polymer.Path.get(getState(), linkedStatePath);
      dispatch(Redux.UPDATE(statePath, {
        isLinked: true,
        cursorRevision: linkedState.linkedCursorRevision,
        minRevision: linkedState.linkedMinRevision,
        maxRevision: linkedState.linkedMaxRevision,
        mode: linkedState.mode,
        zeroYAxis: linkedState.linkedZeroYAxis,
        fixedXAxis: linkedState.linkedFixedXAxis,
      }));
      ChartPair.actions.load(statePath)(dispatch, getState);
    },

    toggleZeroYAxis: statePath => async(dispatch, getState) => {
      dispatch(Redux.TOGGLE(`${statePath}.zeroYAxis`));
      ChartPair.actions.load(statePath)(dispatch, getState);
    },

    toggleLinkedZeroYAxis: linkedStatePath => async(dispatch, getState) => {
      dispatch(Redux.TOGGLE(`${linkedStatePath}.linkedZeroYAxis`));
    },

    toggleFixedXAxis: statePath => async(dispatch, getState) => {
      dispatch(Redux.TOGGLE(`${statePath}.fixedXAxis`));
      ChartPair.actions.load(statePath)(dispatch, getState);
    },

    toggleLinkedFixedXAxis: linkedStatePath => async(dispatch, getState) => {
      dispatch(Redux.TOGGLE(`${linkedStatePath}.linkedFixedXAxis`));
    },

    showOptions: (statePath, isShowingOptions) => async(dispatch, getState) => {
      dispatch(Redux.UPDATE(statePath, {isShowingOptions}));
    },

    brushMinimap: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartPair.reducers.brushMinimap.name,
        statePath,
      });
      ChartPair.actions.load(statePath)(dispatch, getState);
    },

    brushChart: (statePath, brushIndex, value) =>
      async(dispatch, getState) => {
        const path = `${statePath}.chartLayout.xAxis.brushes.${brushIndex}`;
        dispatch(Redux.UPDATE(path, {xPct: value + '%'}));
      },

    load: statePath => async(dispatch, getState) => {
      const state = Polymer.Path.get(getState(), statePath);
      if (!state || !state.lineDescriptors ||
          state.lineDescriptors.length === 0) {
        dispatch(Redux.CHAIN(
            Redux.UPDATE(`${statePath}.minimapLayout`, {lineDescriptors: []}),
            Redux.UPDATE(`${statePath}.chartLayout`, {lineDescriptors: []}),
        ));
        return;
      }

      const {firstNonEmptyLineDescriptor, timeserieses} =
        await ChartPair.findFirstNonEmptyLineDescriptor(
            state.lineDescriptors, `${statePath}.minimapLayout`, dispatch,
            getState);

      let firstRevision = tr.b.math.Statistics.min(timeserieses.map(ts => {
        if (!ts || !ts.data) return Infinity;
        const hist = ts.data[0];
        if (hist === undefined) return Infinity;
        return cp.ChartTimeseries.getX(hist);
      }));
      if (firstRevision === Infinity) {
        firstRevision = undefined;
      }

      let lastRevision = tr.b.math.Statistics.max(timeserieses.map(ts => {
        if (!ts || !ts.data) return -Infinity;
        const hist = ts.data[ts.data.length - 1];
        if (hist === undefined) return -Infinity;
        return cp.ChartTimeseries.getX(hist);
      }));
      if (lastRevision === -Infinity) {
        lastRevision = undefined;
      }

      let minRevision = state.minRevision;
      if (minRevision === undefined ||
          minRevision >= lastRevision) {
        let closestTimestamp = Infinity;
        const minTimestampMs = new Date() - cp.MS_PER_MONTH;
        for (const timeseries of timeserieses) {
          const hist = tr.b.findClosestElementInSortedArray(
              timeseries.data,
              cp.ChartTimeseries.getTimestamp,
              minTimestampMs);
          if (hist) {
            const timestamp = cp.ChartTimeseries.getTimestamp(hist);
            if (Math.abs(timestamp - minTimestampMs) <
                Math.abs(closestTimestamp - minTimestampMs)) {
              minRevision = cp.ChartTimeseries.getX(hist);
              closestTimestamp = timestamp;
            }
          }
        }
      }

      let maxRevision = state.maxRevision;
      if (maxRevision === undefined || maxRevision <= firstRevision) {
        maxRevision = lastRevision;
        dispatch(Redux.UPDATE(statePath, {maxRevision}));
      }

      const minimapLineDescriptors = [];
      if (firstNonEmptyLineDescriptor) {
        minimapLineDescriptors.push({
          ...firstNonEmptyLineDescriptor,
          icons: [],
        });
      }

      dispatch(Redux.UPDATE(`${statePath}.minimapLayout`, {
        lineDescriptors: minimapLineDescriptors,
        brushRevisions: [minRevision, maxRevision],
        fixedXAxis: state.fixedXAxis,
      }));

      let lineDescriptors = state.lineDescriptors;
      if (lineDescriptors.length === 1) {
        lineDescriptors = [...lineDescriptors];
        lineDescriptors.push({
          ...state.lineDescriptors[0],
          buildType: 'ref',
          icons: [],
        });
      }

      dispatch(Redux.UPDATE(`${statePath}.chartLayout`, {
        lineDescriptors,
        minRevision,
        maxRevision,
        brushRevisions: [],
        fixedXAxis: state.fixedXAxis,
        mode: state.mode,
        zeroYAxis: state.zeroYAxis,
      }));
    },

    chartClick: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartPair.reducers.chartClick.name,
        statePath,
      });
    },

    dotClick: (statePath, ctrlKey, lineIndex, datumIndex) =>
      async(dispatch, getState) => {
        dispatch({
          type: ChartPair.reducers.dotClick.name,
          statePath,
          ctrlKey,
          lineIndex,
          datumIndex,
        });
      },

    dotMouseOver: (statePath, lineIndex) => async(dispatch, getState) => {
    },

    dotMouseOut: (statePath, lineIndex) => async(dispatch, getState) => {
    },

    mode: (statePath, mode) => async(dispatch, getState) => {
      dispatch(Redux.UPDATE(statePath, {mode}));
      ChartPair.actions.load(statePath)(dispatch, getState);
    },

    linkedMode: (linkedStatePath, linkedMode) => async(dispatch, getState) => {
      dispatch(Redux.UPDATE(linkedStatePath, {linkedMode}));
    }
  };

  ChartPair.reducers = {
    receiveTestSuites: (state, action, rootState) => {
      if (rootState.userEmail &&
          (action.options.length < state.testSuite.options.length)) {
        // The loadTestSuites() in actions.connected might race with the
        // loadTestSuites() in actions.authChange. If the internal test suites
        // load first then the public test suites load, ignore the public test
        // suites. If the user signs out, then userEmail will become
        // the empty string, so load the public test suites.
        return state;
      }
      const testSuite = {
        ...state.testSuite,
        options: action.options,
        label: `Test suites (${action.count})`,
      };
      return {...state, testSuite};
    },

    brushMinimap: (state, action, rootState) => {
      if (state.minimapLayout.lines.length === 0) return state;
      const range = new tr.b.math.Range();
      for (const brush of state.minimapLayout.xAxis.brushes) {
        const index = tr.b.findLowIndexInSortedArray(
            state.minimapLayout.lines[0].data,
            datum => parseFloat(datum.xPct),
            parseFloat(brush.xPct));
        const datum = state.minimapLayout.lines[0].data[index];
        range.addValue(datum.x);
      }
      const minRevision = range.min;
      const maxRevision = range.max;
      return {
        ...state,
        minRevision,
        maxRevision,
        chartLayout: {
          ...state.chartLayout,
          minRevision,
          maxRevision,
        },
      };
    },

    updateLegendColors: (state, action, rootState) => {
      if (!state.legend) return state;
      const colorMap = new Map();
      for (const line of state.chartLayout.lines) {
        colorMap.set(cp.ChartTimeseries.stringifyDescriptor(
            line.descriptor), line.color);
      }
      function handleLegendEntry(entry) {
        if (entry.children) {
          return {...entry, children: entry.children.map(handleLegendEntry)};
        }
        const color = colorMap.get(cp.ChartTimeseries.stringifyDescriptor(
            entry.lineDescriptor));
        return {...entry, color};
      }
      return {...state, legend: state.legend.map(handleLegendEntry)};
    },

    buildLegend: (state, action, rootState) => {
      const legend = ChartPair.buildLegend(
          ChartPair.parameterMatrix(state));
      return {...state, legend};
    },

    updateTitle: (state, action, rootState) => {
      if (state.isTitleCustom) return state;
      let title = state.measurement.selectedOptions.join(', ');
      if (state.bot.selectedOptions.length > 0 &&
          state.bot.selectedOptions.length < 4) {
        title += ' on ' + state.bot.selectedOptions.join(', ');
      }
      if (state.testCase.selectedOptions.length > 0 &&
          state.testCase.selectedOptions.length < 4) {
        title += ' for ' + state.testCase.selectedOptions.join(', ');
      }
      return {
        ...state,
        title,
      };
    },

    receiveDescriptor: (state, action, rootState) => {
      const measurement = {
        ...state.measurement,
        optionValues: action.descriptor.measurements,
        options: cp.OptionGroup.groupValues(action.descriptor.measurements),
        label: `Measurements (${action.descriptor.measurements.size})`,
      };

      const botOptions = cp.OptionGroup.groupValues(action.descriptor.bots);
      const bot = {
        ...state.bot,
        optionValues: action.descriptor.bots,
        options: botOptions.map(option => {
          return {...option, isExpanded: true};
        }),
        label: `Bots (${action.descriptor.bots.size})`,
      };

      const testCaseOptions = [];
      if (action.descriptor.testCases.size) {
        testCaseOptions.push({
          label: `All ${action.descriptor.testCases.size} test cases`,
          isExpanded: true,
          value: '*',
          options: cp.OptionGroup.groupValues(action.descriptor.testCases),
        });
      }

      const testCase = {
        ...state.testCase,
        optionValues: action.descriptor.testCases,
        options: testCaseOptions,
        label: `Test cases (${action.descriptor.testCases.size})`,
        tags: {
          ...state.testCase.tags,
          options: cp.OptionGroup.groupValues(action.descriptor.testCaseTags),
        },
      };

      return {...state, measurement, bot, testCase};
    },

    finalizeParameters: (state, action, rootState) => {
      const measurement = {
        ...state.measurement,
        selectedOptions: state.measurement.selectedOptions.filter(m =>
          state.measurement.optionValues.has(m)),
      };

      const bot = {...state.bot};

      if (bot.selectedOptions.length === 0 ||
          ((bot.selectedOptions.length === 1) &&
          (bot.selectedOptions[0] === '*'))) {
        bot.selectedOptions = [...bot.optionValues];
      } else {
        bot.selectedOptions = bot.selectedOptions.filter(b =>
          bot.optionValues.has(b));
      }

      const testCase = {
        ...state.testCase,
        selectedOptions: state.testCase.selectedOptions.filter(t =>
          state.testCase.optionValues.has(t)),
      };

      return {...state, measurement, bot, testCase};
    },

    chartClick: (state, action, rootState) => {
      return {
        ...state,
        chartLayout: {
          ...state.chartLayout,
          xAxis: {
            ...state.chartLayout.xAxis,
            brushes: [],
          },
        },
        histograms: undefined,
      };
    },

    dotClick: (state, action, rootState) => {
      const sequence = state.chartLayout.lines[action.lineIndex];
      if (!sequence || !sequence.data[action.datumIndex]) return state;
      const datumX = parseFloat(sequence.data[action.datumIndex].xPct);
      let prevX = 0;
      if (action.datumIndex > 0) {
        prevX = parseFloat(sequence.data[action.datumIndex - 1].xPct);
      }
      let nextX = 100;
      if (action.datumIndex < sequence.data.length - 1) {
        nextX = parseFloat(sequence.data[action.datumIndex + 1].xPct);
      }
      const brushes = [
        {xPct: ((datumX + prevX) / 2) + '%'},
        {xPct: ((datumX + nextX) / 2) + '%'},
      ];
      if (action.ctrlKey) {
        brushes.push.apply(brushes, state.chartLayout.xAxis.brushes);
      }
      return {
        ...state,
        chartLayout: {
          ...state.chartLayout,
          xAxis: {
            ...state.chartLayout.xAxis,
            brushes,
          },
        },
      };
    },

    updateStale: (state, action, rootState) => {
      // Add an icon to the last datum of a line if it's stale.
      if ((state.minimapLayout.lines.length === 0) ||
          (state.minimapLayout.brushRevisions[1] <
           state.minimapLayout.lines[0].data[
               state.minimapLayout.lines[0].data.length - 1].x)) {
        return state;
      }

      const now = new Date();
      const staleMs = window.IS_DEBUG ? 100 : MILLIS_PER_DAY;
      const staleTimestamp = now - staleMs;
      let anyStale = false;
      const lines = state.chartLayout.lines.map(line => {
        const minDate = cp.ChartTimeseries.getTimestamp(
            line.data[line.data.length - 1].hist);
        if (minDate >= staleTimestamp) return line;
        let iconColor = 'hsl(49, 95%, 60%)';
        if (minDate < (now - (28 * staleMs))) {
          iconColor = 'hsl(4, 90%, 60%)';
        } else if (minDate < (now - (28 * staleMs))) {
          iconColor = 'hsl(37, 95%, 55%)';
        }
        anyStale = true;
        line = cp.setImmutable(line, `data.${line.data.length - 1}`, datum => {
          return {...datum, icon: 'cp:clock', iconColor};
        });
        return line;
      });
      if (!anyStale) return state;
      return {...state, chartLayout: {...state.chartLayout, lines}};
    },
  };

  const MILLIS_PER_DAY = tr.b.convertUnit(
      1, tr.b.UnitScale.TIME.DAY, tr.b.UnitScale.TIME.MILLI_SEC);

  ChartPair.findFirstNonEmptyLineDescriptor = async(
    lineDescriptors, refStatePath, dispatch, getState) => {
    for (const lineDescriptor of lineDescriptors) {
      const fetchDescriptors = cp.ChartTimeseries.createFetchDescriptors(
          lineDescriptor);

      const results = await Promise.all(fetchDescriptors.map(
          async fetchDescriptor => {
            const reader = cp.TimeseriesReader({
              lineDescriptor,
              fetchDescriptor,
              refStatePath,
              dispatch,
              getState,
            });
            for await (const result of reader) {
              return result;
            }
          }
      ));

      const timeserieses = results.map(result => result.timeseries);

      for (const timeseries of timeserieses) {
        if (!timeseries || !timeseries.data) {
          throw new Error('Timeseries data formatted incorrectly', timeseries);
        }
        if (timeseries.data.length) {
          return {
            firstNonEmptyLineDescriptor: lineDescriptor,
            timeserieses,
          };
        }
      }
    }

    return {
      timeserieses: [],
    };
  };

  cp.ElementBase.register(ChartPair);

  return {
    ChartPair,
  };
});
