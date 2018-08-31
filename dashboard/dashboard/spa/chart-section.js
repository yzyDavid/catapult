/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ChartSection extends cp.ElementBase {
    ready() {
      super.ready();
      this.scrollIntoView(true);
    }

    connectedCallback() {
      super.connectedCallback();
      this.dispatch('connected', this.statePath);
    }

    isLoading_(isLoading, minimapLayout, chartLayout) {
      if (isLoading) return true;
      if (minimapLayout && minimapLayout.isLoading) return true;
      if (chartLayout && chartLayout.isLoading) return true;
      return false;
    }

    isShowingPivotTable_(histograms, isExpanded) {
      return isExpanded && !this._empty(histograms);
    }

    isLegendOpen_(isExpanded, legend, histograms) {
      return isExpanded && !this._empty(legend) && this._empty(histograms);
    }

    testSuiteHref_(testSuites) {
      return 'http://go/chrome-speed';
    }

    onTestSuiteSelect_(event) {
      this.dispatch('describeTestSuites', this.statePath);
      this.dispatch('maybeLoadTimeseries', this.statePath);
    }

    onTestSuiteAggregate_(event) {
      this.dispatch('aggregateTestSuite', this.statePath);
    }

    onMeasurementSelect_(event) {
      this.dispatch('measurement', this.statePath);
    }

    onBotSelect_(event) {
      this.dispatch('bot', this.statePath);
    }

    onBotAggregate_(event) {
      this.dispatch('aggregateBot', this.statePath);
    }

    onTestCaseSelect_(event) {
      this.dispatch('testCase', this.statePath);
    }

    onTestCaseAggregate_(event) {
      this.dispatch('aggregateTestCase', this.statePath);
    }

    onStatisticSelect_(event) {
      this.dispatch('statistic', this.statePath);
    }

    onTitleKeyup_(event) {
      this.dispatch('setTitle', this.statePath, event.target.value);
    }

    onClose_(event) {
      this.dispatchEvent(new CustomEvent('close-section', {
        bubbles: true,
        composed: true,
        detail: {sectionId: this.sectionId},
      }));
    }

    onChartClick_(event) {
      this.dispatch('chartClick', this.statePath);
    }

    onDotClick_(event) {
      this.dispatch('dotClick', this.statePath,
          event.detail.ctrlKey,
          event.detail.lineIndex,
          event.detail.datumIndex);
    }

    onDotMouseOver_(event) {
      this.dispatch('dotMouseOver', this.statePath, event.detail.lineIndex);
    }

    onDotMouseOut_(event) {
      this.dispatch('dotMouseOut', this.statePath);
    }

    onBrush_(event) {
      this.dispatch('brushChart', this.statePath,
          event.detail.brushIndex,
          event.detail.value);
    }

    onLegendMouseOver_(event) {
      this.dispatch('legendMouseOver', this.statePath,
          event.detail.lineDescriptor);
    }

    onLegendMouseOut_(event) {
      this.dispatch('legendMouseOut', this.statePath);
    }

    onLegendLeafTap_(event) {
      this.dispatch('legendLeafTap', this.statePath,
          event.detail.lineDescriptor);
    }

    async onLegendTap_(event) {
      this.dispatch('legendTap', this.statePath);
    }

    async onRelatedTabTap_(event) {
      this.dispatch('selectRelatedTab', this.statePath, event.model.tab.name);
    }

    async onSparklineTap_(event) {
      this.dispatchEvent(new CustomEvent('new-chart', {
        bubbles: true,
        composed: true,
        detail: {options: event.model.sparkline.chartOptions},
      }));
    }

    onLineCountChange_() {
      this.dispatch('updateLegendColors', this.statePath);
    }

    observeUserEmail_() {
      this.dispatch('authChange', this.statePath);
    }

    observeRevisions_() {
      this.dispatch('updateSparklineRevisions', this.statePath);
    }
  }

  ChartSection.State = {
    sectionId: options => options.sectionId || tr.b.GUID.allocateSimple(),
    ...cp.ChartPair.State,
    lineDescriptors: options => [],
    title: options => options.title || '',
    isTitleCustom: options => false,
    legend: options => undefined,
    minRevision: options => options.minRevision,
    maxRevision: options => options.maxRevision,
    relatedTabs: options => [],
    selectedLineDescriptorHash: options => options.selectedLineDescriptorHash,
    isLoading: options => false,
    testSuite: options => cp.ChartParameter.buildState({
      label: 'Test Suites (loading)',
      canAggregate: true,
      isAggregated: (options.parameters || {}).testSuitesAggregated || false,
      selectedOptions: (options.parameters || {}).testSuites || [],
    }),
    bot: options => cp.ChartParameter.buildState({
      label: 'Bots',
      canAggregate: true,
      isAggregated: (options.parameters || {}).botsAggregated !== false,
      selectedOptions: (options.parameters || {}).bots || [],
    }),
    measurement: options => cp.ChartParameter.buildState({
      label: 'Measurements',
      canAggregate: false,
      selectedOptions: (options.parameters || {}).measurements || [],
    }),
    testCase: options => cp.ChartParameter.buildState({
      label: 'Test Cases',
      canAggregate: true,
      isAggregated: (options.parameters || {}).testCasesAggregated !== false,
      selectedOptions: (options.parameters || {}).testCases || [],
      tags: {
        selectedOptions: (options.parameters || {}).testCaseTags || [],
      },
    }),
    statistic: options => cp.ChartParameter.buildState({
      label: 'Statistics',
      canAggregate: false,
      selectedOptions: (options.parameters || {}).statistics || ['avg'],
      options: [
        'avg',
        'std',
        'count',
        'min',
        'max',
        'median',
        'iqr',
        '90%',
        '95%',
        '99%',
      ],
    }),
    selectedRelatedTabName: options => options.selectedRelatedTabName || '',
    histograms: options => undefined,
  };

  ChartSection.buildState = options => cp.buildState(
      ChartSection.State, options);

  ChartSection.properties = {
    ...cp.buildProperties('state', ChartSection.State),
    ...cp.buildProperties('linkedState', {
      // ChartSection only needs the linkedStatePath property to forward to
      // ChartPair.
    }),
    userEmail: {statePath: 'userEmail'},
  };
  ChartSection.observers = ['observeUserEmail_(userEmail)'];

  ChartSection.observers = [
    'observeRevisions_(minRevision, maxRevision)',
  ];

  ChartSection.actions = {
    connected: statePath => async(dispatch, getState) => {
      let state = Polymer.Path.get(getState(), statePath);
      ChartSection.actions.loadTestSuites(statePath)(dispatch, getState);
      if (state.testSuite.selectedOptions.length) {
        await ChartSection.actions.describeTestSuites(statePath)(
            dispatch, getState);
        ChartSection.actions.maybeLoadTimeseries(statePath)(dispatch, getState);
      } else {
        cp.DropdownInput.actions.focus(`${statePath}.testSuite`)(
            dispatch, getState);
      }
      state = Polymer.Path.get(getState(), statePath);
    },

    authChange: statePath => async(dispatch, getState) => {
      ChartSection.actions.loadTestSuites(statePath)(dispatch, getState);
    },

    loadTestSuites: statePath => async(dispatch, getState) => {
      const rootState = getState();
      const testSuites = await cp.TeamFilter.get(rootState.teamName).testSuites(
          await cp.ReadTestSuites()(dispatch, getState));
      dispatch({
        type: ChartSection.reducers.receiveTestSuites.name,
        statePath,
        testSuites,
      });
    },

    describeTestSuites: statePath => async(dispatch, getState) => {
      let state = Polymer.Path.get(getState(), statePath);
      if (state.testSuite.selectedOptions.length === 0) {
        dispatch({
          type: ChartSection.reducers.receiveDescriptor.name,
          statePath,
          descriptor: {
            measurements: new Set(),
            bots: new Set(),
            testCases: new Set(),
            testCaseTags: new Map(),
          },
        });
        dispatch({
          type: ChartSection.reducers.finalizeParameters.name,
          statePath,
        });
        return;
      }

      // Test suite descriptors might already be in local memory, or it might
      // take the backend up to a minute to compute them, or it might take a
      // couple of seconds to serve them from memcache, so fetch them in
      // parallel.
      const testSuites = new Set(state.testSuite.selectedOptions);
      const descriptorStream = cp.ReadTestSuiteDescriptors({
        testSuites: state.testSuite.selectedOptions,
      })(dispatch, getState);
      for await (const descriptor of descriptorStream) {
        state = Polymer.Path.get(getState(), statePath);
        if (!state.testSuite || !tr.b.setsEqual(
            testSuites, new Set(state.testSuite.selectedOptions))) {
          // The user changed the set of selected testSuites, so stop handling
          // the old set of testSuites. The new set of testSuites will be
          // handled by a new dispatch of this action creator.
          return;
        }
        dispatch({
          type: ChartSection.reducers.receiveDescriptor.name,
          statePath,
          descriptor,
        });
      }
      dispatch({
        type: ChartSection.reducers.finalizeParameters.name,
        statePath,
      });

      state = Polymer.Path.get(getState(), statePath);

      if (state.measurement.selectedOptions.length === 0) {
        cp.DropdownInput.actions.focus(`${statePath}.measurement`)(
            dispatch, getState);
      }
    },

    aggregateTestSuite: statePath => async(dispatch, getState) => {
      ChartSection.actions.maybeLoadTimeseries(statePath)(dispatch, getState);
    },

    measurement: statePath => async(dispatch, getState) => {
      ChartSection.actions.maybeLoadTimeseries(statePath)(dispatch, getState);
    },

    bot: statePath => async(dispatch, getState) => {
      ChartSection.actions.maybeLoadTimeseries(statePath)(dispatch, getState);
    },

    aggregateBot: statePath => async(dispatch, getState) => {
      ChartSection.actions.maybeLoadTimeseries(statePath)(dispatch, getState);
    },

    testCase: statePath => async(dispatch, getState) => {
      ChartSection.actions.maybeLoadTimeseries(statePath)(dispatch, getState);
    },

    aggregateTestCase: statePath => async(dispatch, getState) => {
      ChartSection.actions.maybeLoadTimeseries(statePath)(dispatch, getState);
    },

    statistic: statePath => async(dispatch, getState) => {
      ChartSection.actions.maybeLoadTimeseries(statePath)(dispatch, getState);
    },

    setTitle: (statePath, title) => async(dispatch, getState) => {
      dispatch(Redux.UPDATE(statePath, {title, isTitleCustom: true}));
    },

    showOptions: (statePath, isShowingOptions) => async(dispatch, getState) => {
      dispatch(Redux.UPDATE(statePath, {isShowingOptions}));
    },

    brushMinimap: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartSection.reducers.brushMinimap.name,
        statePath,
      });
      ChartSection.actions.loadTimeseries(statePath)(dispatch, getState);
    },

    brushChart: (statePath, brushIndex, value) =>
      async(dispatch, getState) => {
        const path = `${statePath}.chartLayout.xAxis.brushes.${brushIndex}`;
        dispatch(Redux.UPDATE(path, {xPct: value + '%'}));
      },

    maybeLoadTimeseries: statePath => async(dispatch, getState) => {
      // If the first 3 components are filled, then load the timeseries.
      const state = Polymer.Path.get(getState(), statePath);
      if (state.testSuite.selectedOptions.length &&
          state.measurement.selectedOptions.length &&
          state.statistic.selectedOptions.length) {
        ChartSection.actions.loadTimeseries(statePath)(dispatch, getState);
      } else {
        ChartSection.actions.clearTimeseries(statePath)(dispatch, getState);
      }
    },

    clearTimeseries: statePath => async(dispatch, getState) => {
      const state = Polymer.Path.get(getState(), statePath);
      if (state.minimapLayout.lines.length) {
        dispatch(Redux.UPDATE(`${statePath}.minimapLayout`, {
          lineDescriptors: [],
        }));
      }
      if (state.chartLayout.lines.length) {
        dispatch(Redux.UPDATE(`${statePath}.chartLayout`, {
          lineDescriptors: [],
        }));
      }
      if (state.relatedTabs.length) {
        dispatch({
          type: ChartSection.reducers.clearTimeseries.name,
          statePath,
        });
      }
    },

    loadTimeseries: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartSection.reducers.loadTimeseries.name,
        statePath,
      });

      const state = Polymer.Path.get(getState(), statePath);

      // Wait to populateColumns until after the user selects a memory
      // measurement.
      if (!state.measurement.columns &&
          state.measurement.selectedOptions.filter(
              m => m.startsWith('memory:')).length) {
        cp.DropdownInput.actions.populateColumns(
            `${statePath}.measurement`)(dispatch, getState);
      }

      if (state.selectedLineDescriptorHash) {
        // Restore from URL. This needs to be in the action creator because
        // sha is async.
        for (const lineDescriptor of state.lineDescriptors) {
          const lineDescriptorHash = await cp.sha(
              cp.ChartTimeseries.stringifyDescriptor(lineDescriptor));
          if (!lineDescriptorHash.startsWith(
              state.selectedLineDescriptorHash)) {
            continue;
          }
          dispatch(Redux.UPDATE(statePath, {
            lineDescriptors: [lineDescriptor],
          }));
          break;
        }
      }

      /* TODO Use a throttling priority queue to prevent starting too many
       * requests at once, which janks the main thread and overwhelms the
       * backend.
      // Copying sparklines to renderedSparklines causes chart-timeseries to
      // load. They won't be displayed until the tab is selected, so this is
      // effectively just prefetching the timeseries and pre-stamping the DOM.
      let state = Polymer.Path.get(getState(), statePath);
      for (let tabIndex = 0; tabIndex < state.relatedTabs.length; ++tabIndex) {
        await cp.idle();
        state = Polymer.Path.get(getState(), statePath);
        if (tabIndex >= state.relatedTabs.length) break;
        dispatch(Redux.UPDATE(`${statePath}.relatedTabs.${tabIndex}`, {
          renderedSparklines: state.relatedTabs[tabIndex].sparklines,
        }));
      }
      */
    },

    selectRelatedTab: (statePath, selectedRelatedTabName) =>
      async(dispatch, getState) => {
        const state = Polymer.Path.get(getState(), statePath);
        if (selectedRelatedTabName === state.selectedRelatedTabName) {
          selectedRelatedTabName = '';
        }

        const selectedRelatedTabIndex = state.relatedTabs.findIndex(tab =>
          tab.name === selectedRelatedTabName);
        if (selectedRelatedTabIndex >= 0 &&
            state.relatedTabs[selectedRelatedTabIndex].renderedSparklines ===
            undefined) {
          const path = `${statePath}.relatedTabs.${selectedRelatedTabIndex}`;
          const relatedTab = state.relatedTabs[selectedRelatedTabIndex];
          dispatch(Redux.UPDATE(path, {
            renderedSparklines: relatedTab.sparklines,
          }));
        }

        dispatch(Redux.UPDATE(statePath, {selectedRelatedTabName}));
      },

    chartClick: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartSection.reducers.chartClick.name,
        statePath,
      });
    },

    dotClick: (statePath, ctrlKey, lineIndex, datumIndex) =>
      async(dispatch, getState) => {
        // TODO load histograms
      },

    dotMouseOver: (statePath, lineIndex) => async(dispatch, getState) => {
    },

    dotMouseOut: (statePath, lineIndex) => async(dispatch, getState) => {
    },

    legendMouseOver: (statePath, lineDescriptor) =>
      async(dispatch, getState) => {
        const state = Polymer.Path.get(getState(), statePath);
        lineDescriptor = JSON.stringify(lineDescriptor);
        for (let lineIndex = 0; lineIndex < state.chartLayout.lines.length;
          ++lineIndex) {
          if (JSON.stringify(state.chartLayout.lines[lineIndex].descriptor) ===
              lineDescriptor) {
            cp.ChartBase.actions.boldLine(
                statePath + '.chartLayout', lineIndex)(dispatch, getState);
            break;
          }
        }
      },

    legendMouseOut: statePath => async(dispatch, getState) => {
      cp.ChartBase.actions.unboldLines(statePath + '.chartLayout')(
          dispatch, getState);
    },

    legendLeafTap: (statePath, lineDescriptor) => async(dispatch, getState) => {
      dispatch({
        type: ChartSection.reducers.selectLine.name,
        statePath,
        lineDescriptor,
        selectedLineDescriptorHash: await cp.sha(
            cp.ChartTimeseries.stringifyDescriptor(lineDescriptor)),
      });
    },

    legendTap: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartSection.reducers.deselectLine.name,
        statePath,
      });
    },

    updateLegendColors: statePath => async(dispatch, getState) => {
      const state = Polymer.Path.get(getState(), statePath);
      if (!state || !state.legend) return;
      dispatch({
        type: ChartSection.reducers.updateLegendColors.name,
        statePath,
      });
    },

    updateSparklineRevisions: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartSection.reducers.updateSparklineRevisions.name,
        statePath,
      });
    },
  };

  ChartSection.reducers = {
    loadTimeseries: (state, action, rootState) => {
      const title = ChartSection.computeTitle(state);
      const legend = ChartSection.buildLegend(
          ChartSection.parameterMatrix(state));
      const parameterMatrix = ChartSection.parameterMatrix(state);
      const lineDescriptors = ChartSection.createLineDescriptors(
          parameterMatrix);
      state = ChartSection.reducers.buildRelatedTabs(state);
      return {
        ...state,
        title,
        legend,
        lineDescriptors,
      };
    },

    selectLine: (state, action, rootState) => {
      if (state.selectedLineDescriptorHash ===
          action.selectedLineDescriptorHash) {
        return ChartSection.reducers.deselectLine(state, action, rootState);
      }
      return {
        ...state,
        lineDescriptors: [action.lineDescriptor],
        selectedLineDescriptorHash: action.selectedLineDescriptorHash,
      };
    },

    deselectLine: (state, action, rootState) => {
      const parameterMatrix = ChartSection.parameterMatrix(state);
      const lineDescriptors = ChartSection.createLineDescriptors(
          parameterMatrix);
      return {
        ...state,
        lineDescriptors,
        selectedLineDescriptorHash: undefined,
      };
    },

    receiveTestSuites: (state, action, rootState) => {
      const groupedOptions = cp.OptionGroup.groupValues(action.testSuites);
      if (rootState.userEmail &&
          (groupedOptions.length < state.testSuite.options.length)) {
        // The loadTestSuites() in actions.connected might race with the
        // loadTestSuites() in actions.authChange. If the internal test suites
        // load first then the public test suites load, ignore the public test
        // suites. If the user signs out, then userEmail will become
        // the empty string, so load the public test suites.
        return state;
      }
      const testSuite = {
        ...state.testSuite,
        options: groupedOptions,
        label: `Test Suites (${action.testSuites.length})`,
      };
      return {...state, testSuite};
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
            entry.lineDescriptor)) || 'grey';
        return {...entry, color};
      }
      return {...state, legend: state.legend.map(handleLegendEntry)};
    },

    receiveDescriptor: (state, {descriptor}, rootState) => {
      const measurement = {
        ...state.measurement,
        optionValues: descriptor.measurements,
        options: cp.OptionGroup.groupValues(descriptor.measurements),
        label: `Measurements (${descriptor.measurements.size})`,
      };

      const botOptions = cp.OptionGroup.groupValues(descriptor.bots);
      const bot = {
        ...state.bot,
        optionValues: descriptor.bots,
        options: botOptions.map(option => {
          return {...option, isExpanded: true};
        }),
        label: `Bots (${descriptor.bots.size})`,
      };

      const testCaseOptions = [];
      if (descriptor.testCases.size) {
        testCaseOptions.push({
          label: `All test cases`,
          isExpanded: true,
          options: cp.OptionGroup.groupValues(descriptor.testCases),
        });
      }

      const testCase = cp.ChartParameter.reducers.tagFilter({
        ...state.testCase,
        optionValues: descriptor.testCases,
        options: testCaseOptions,
        label: `Test cases (${descriptor.testCases.size})`,
        tags: {
          ...state.testCase.tags,
          map: descriptor.testCaseTags,
          options: cp.OptionGroup.groupValues(descriptor.testCaseTags.keys()),
        },
      });

      return {...state, measurement, bot, testCase};
    },

    finalizeParameters: (state, action, rootState) => {
      const measurement = {...state.measurement};
      if (measurement.optionValues.size === 1) {
        measurement.selectedOptions = [...measurement.optionValues];
      } else {
        measurement.selectedOptions = state.measurement.selectedOptions.filter(
            m => state.measurement.optionValues.has(m));
      }
      const recommendedMeasurements = [
        {
          value: 'memory:chrome:all_processes:' +
          'reported_by_chrome:effective_size',
          label: 'Total Memory',
        },
        {
          value: 'memory:chrome:renderer_processes:' +
          'reported_by_chrome:effective_size',
          label: 'Renderer Memory',
        },
        'Total:count',
        'Total:duration',
      ].filter(option => measurement.optionValues.has(
          cp.OptionGroup.getValuesFromOption(option)[0]));
      if (recommendedMeasurements.length) {
        measurement.recommended = {options: recommendedMeasurements};
      }

      const bot = {...state.bot};
      if ((bot.optionValues.size === 1) ||
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

    receiveHistograms: (state, action, rootState) => {
      return {
        ...state,
        isLoading: false,
        histograms: action.histograms,
      };
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

    clearTimeseries: (state, action, rootState) => {
      return {
        ...state,
        histograms: undefined,
        relatedTabs: [],
      };
    },

    buildRelatedTabs: (state, action, rootState) => {
      const relatedTabs = [];
      const parameterMatrix = ChartSection.parameterMatrix(state);
      const revisions = {
        minRevision: state.minRevision,
        maxRevision: state.maxRevision,
        zeroYAxis: state.zeroYAxis,
        fixedXAxis: state.fixedXAxis,
        mode: state.mode,
      };

      const sparkLayout = cp.ChartTimeseries.buildState({});
      sparkLayout.dotRadius = 0;
      sparkLayout.yAxis.generateTicks = false;
      sparkLayout.xAxis.generateTicks = false;
      sparkLayout.graphHeight = 150;

      function maybeAddParameterTab(propertyName, tabName, matrixName) {
        let options = state[propertyName].selectedOptions;
        if (options.length === 0) {
          // If zero testSuites or bots are selected, then buildRelatedTabs
          // wouldn't be called. If zero testCases are selected, then build
          // sparklines for all available testCases.
          options = []; // Do not append to state[propertyName].selectedOptions!
          for (const option of state[propertyName].options) {
            options.push(...cp.OptionGroup.getValuesFromOption(option));
          }
          if (options.length === 0) return;
        } else if (options.length === 1 ||
                   !state[propertyName].isAggregated) {
          return;
        }
        relatedTabs.push({
          name: tabName,
          sparklines: options.map(option =>
            ChartSection.createSparkline(option, sparkLayout, revisions, {
              ...parameterMatrix,
              [matrixName]: [[option]],
            })),
        });
      }
      maybeAddParameterTab('testSuite', 'Test suites', 'testSuiteses');

      const rails = ['Response', 'Animation', 'Idle', 'Load', 'Startup'];

      const measurements = state.measurement.selectedOptions;
      // TODO use RelatedNameMaps instead of this hard-coded mess
      const processSparklines = [];
      const componentSparklines = [];
      const railSparklines = [];

      if (state.testSuite.selectedOptions.filter(
          ts => ts.startsWith('v8:browsing')).length) {
        if (measurements.filter(
            m => (!rails.includes(m.split('_')[0]) &&
                  !m.startsWith('memory:'))).length) {
          for (const rail of rails) {
            railSparklines.push(ChartSection.createSparkline(
                rail, sparkLayout, revisions, {
                  ...parameterMatrix,
                  measurements: measurements.map(m => rail + '_' + m),
                }));
          }
        }

        if (measurements.filter(
            m => (m.startsWith('Total:') &&
                  ['count', 'duration'].includes(m.split(':')[1]))).length) {
          for (const relatedName of ['Blink C++', 'V8-Only']) {
            componentSparklines.push(ChartSection.createSparkline(
                relatedName, sparkLayout, revisions, {
                  ...parameterMatrix,
                  measurements: measurements.map(
                      m => relatedName + ':' + m.split(':')[1]),
                }));
          }
        }

        const v8Only = measurements.filter(m => m.includes('V8-Only:'));
        if (v8Only.length) {
          for (const relatedName of [
            'API',
            'Compile',
            'Compile-Background',
            'GC',
            'IC',
            'JavaScript',
            'Optimize',
            'Parse',
            'Parse-Background',
            'V8 C++',
          ]) {
            componentSparklines.push(ChartSection.createSparkline(
                relatedName, sparkLayout, revisions, {
                  ...parameterMatrix,
                  measurements: v8Only.map(
                      m => m.replace('V8-Only', relatedName)),
                }));
          }
        }

        const gc = measurements.filter(m => m.includes('GC:'));
        if (gc.length) {
          for (const relatedName of [
            'MajorMC', 'Marking', 'MinorMC', 'Other', 'Scavenger', 'Sweeping',
          ]) {
            componentSparklines.push(ChartSection.createSparkline(
                relatedName, sparkLayout, revisions, {
                  ...parameterMatrix,
                  measurements: gc.map(
                      m => m.replace('GC', 'GC-Background-' + relatedName)),
                }));
          }
        }
      }

      for (const measurement of state.measurement.selectedOptions) {
        const measurementAvg = measurement + '_avg';
        if (d.MEMORY_PROCESS_RELATED_NAMES.has(measurementAvg)) {
          for (let relatedMeasurement of d.MEMORY_PROCESS_RELATED_NAMES.get(
              measurementAvg)) {
            if (relatedMeasurement.endsWith('_avg')) {
              relatedMeasurement = relatedMeasurement.slice(0, -4);
            }
            if (relatedMeasurement === measurement) continue;
            const relatedParts = relatedMeasurement.split(':');
            processSparklines.push(ChartSection.createSparkline(
                relatedParts[2], sparkLayout, revisions, {
                  ...parameterMatrix,
                  measurements: [relatedMeasurement],
                }));
          }
        }
        if (d.MEMORY_COMPONENT_RELATED_NAMES.has(measurementAvg)) {
          for (let relatedMeasurement of d.MEMORY_COMPONENT_RELATED_NAMES.get(
              measurementAvg)) {
            if (relatedMeasurement.endsWith('_avg')) {
              relatedMeasurement = relatedMeasurement.slice(0, -4);
            }
            if (relatedMeasurement === measurement) continue;
            const relatedParts = relatedMeasurement.split(':');
            const name = relatedParts.slice(
                4, relatedParts.length - 1).join(':');
            componentSparklines.push(ChartSection.createSparkline(
                name, sparkLayout, revisions, {
                  ...parameterMatrix,
                  measurements: [relatedMeasurement],
                }));
          }
        }
      }
      if (processSparklines.length) {
        relatedTabs.push({
          name: 'Process',
          sparklines: processSparklines,
        });
      }
      if (componentSparklines.length) {
        relatedTabs.push({
          name: 'Component',
          sparklines: componentSparklines,
        });
      }
      if (railSparklines.length) {
        relatedTabs.push({
          name: 'RAILS',
          sparklines: railSparklines,
        });
      }

      maybeAddParameterTab('bot', 'Bots', 'botses');
      maybeAddParameterTab('testCase', 'Test cases', 'testCaseses');

      if (state.selectedRelatedTabName) {
        const selectedRelatedTabIndex = relatedTabs.findIndex(tab =>
          tab.name === state.selectedRelatedTabName);
        relatedTabs[selectedRelatedTabIndex].renderedSparklines =
          relatedTabs[selectedRelatedTabIndex].sparklines;
      }

      return {...state, relatedTabs};
    },

    updateSparklineRevisions: (state, action, rootState) => {
      function updateSparkline(sparkline) {
        return {
          ...sparkline,
          layout: {
            ...sparkline.layout,
            minRevision: state.minRevision,
            maxRevision: state.maxRevision,
          },
        };
      }
      return {
        ...state,
        relatedTabs: state.relatedTabs.map(tab => {
          let renderedSparklines;
          if (tab.renderedSparklines) {
            renderedSparklines = tab.renderedSparklines.map(updateSparkline);
          }
          return {
            ...tab,
            sparklines: tab.sparklines.map(updateSparkline),
            renderedSparklines,
          };
        }),
      };
    },
  };

  ChartSection.createSparkline = (name, sparkLayout, revisions, matrix) => {
    return {
      name: cp.AlertsSection.breakWords(name),
      chartOptions: {
        parameters: ChartSection.parametersFromMatrix(matrix),
        ...revisions,
      },
      layout: {
        ...sparkLayout,
        ...revisions,
        lineDescriptors: ChartSection.createLineDescriptors(matrix),
      },
    };
  };

  ChartSection.newStateOptionsFromQueryParams = routeParams => {
    return {
      parameters: {
        testSuites: routeParams.getAll('testSuite'),
        testSuitesAggregated: routeParams.get('aggSuites') !== null,
        measurements: routeParams.getAll('measurement'),
        bots: routeParams.getAll('bot'),
        botsAggregated: routeParams.get('splitBots') === null,
        testCases: routeParams.getAll('testCase'),
        testCaseTags: routeParams.getAll('caseTag'),
        testCasesAggregated: routeParams.get('splitCases') === null,
        statistics: routeParams.get('stat') ? routeParams.getAll('stat') :
          ['avg'],
      },
      isExpanded: !routeParams.has('compact'),
      minRevision: parseInt(routeParams.get('minRev')) || undefined,
      maxRevision: parseInt(routeParams.get('maxRev')) || undefined,
      selectedRelatedTabName: routeParams.get('spark') || '',
      mode: routeParams.get('mode') || undefined,
      fixedXAxis: !routeParams.has('natural'),
      zeroYAxis: routeParams.has('zeroY'),
      selectedLineDescriptorHash: routeParams.get('select'),
    };
  };

  ChartSection.createLineDescriptors = ({
    testSuiteses, measurements, botses, testCaseses, statistics,
    buildTypes,
  }) => {
    const lineDescriptors = [];
    for (const testSuites of testSuiteses) {
      for (const measurement of measurements) {
        for (const bots of botses) {
          for (const testCases of testCaseses) {
            for (const statistic of statistics) {
              for (const buildType of buildTypes) {
                lineDescriptors.push({
                  testSuites,
                  measurement,
                  bots,
                  testCases,
                  statistic,
                  buildType,
                });
              }
            }
          }
        }
      }
    }
    return lineDescriptors;
  };

  function legendEntry(label, children) {
    if (children.length === 1) {
      return {...children[0], label};
    }
    return {label, children};
  }

  ChartSection.buildLegend = ({
    testSuiteses, measurements, botses, testCaseses, statistics,
    buildTypes,
  }) => {
    // Return [{label, children: [{label, lineDescriptor, color}]}}]
    let legendItems = testSuiteses.map(testSuites =>
      legendEntry(testSuites[0], measurements.map(measurement =>
        legendEntry(measurement, botses.map(bots =>
          legendEntry(bots[0], testCaseses.map(testCases =>
            legendEntry(testCases[0], statistics.map(statistic =>
              legendEntry(statistic, buildTypes.map(buildType => {
                const lineDescriptor = {
                  testSuites,
                  measurement,
                  bots,
                  testCases,
                  statistic,
                  buildType,
                };
                return {
                  label: buildType,
                  lineDescriptor,
                  color: '',
                };
              })))))))))));

    if (legendItems.length === 1) legendItems = legendItems[0].children;

    function stripSharedPrefix(items) {
      if (items === undefined) return;
      let sharedPrefixLength = items[0].label.length;
      for (let i = 1; i < items.length; ++i) {
        for (let c = 0; c < sharedPrefixLength; ++c) {
          if (items[0].label[c] === items[i].label[c]) continue;
          sharedPrefixLength = c - 1;
          break;
        }
      }
      sharedPrefixLength = items[0].label.slice(
          0, sharedPrefixLength + 1).lastIndexOf(':');
      if (sharedPrefixLength > 0) {
        for (let i = 0; i < items.length; ++i) {
          items[i].label = items[i].label.slice(sharedPrefixLength + 1);
        }
      }

      for (const child of items) {
        if (!child.children) continue;
        stripSharedPrefix(child.children);
      }
    }
    stripSharedPrefix(legendItems);

    return legendItems;
  };

  ChartSection.parameterMatrix = state => {
    // Aggregated parameters look like [[a, b, c]].
    // Unaggregated parameters look like [[a], [b], [c]].
    let testSuiteses = state.testSuite.selectedOptions;
    if (state.testSuite.isAggregated) {
      testSuiteses = [testSuiteses];
    } else {
      testSuiteses = testSuiteses.map(testSuite => [testSuite]);
    }
    let botses = state.bot.selectedOptions;
    if (state.bot.isAggregated) {
      botses = [botses];
    } else {
      botses = botses.map(bot => [bot]);
    }
    let testCaseses = state.testCase.selectedOptions.filter(x => x);
    if (state.testCase.isAggregated) {
      testCaseses = [testCaseses];
    } else {
      testCaseses = testCaseses.map(testCase => [testCase]);
    }
    if (testCaseses.length === 0) testCaseses.push([]);
    const measurements = state.measurement.selectedOptions;
    const statistics = state.statistic.selectedOptions;
    const buildTypes = ['test'];
    return {
      testSuiteses,
      measurements,
      botses,
      testCaseses,
      statistics,
      buildTypes,
    };
  };

  ChartSection.parametersFromMatrix = matrix => {
    const parameters = {
      testSuites: [],
      testSuitesAggregated: ((matrix.testSuiteses.length === 1) &&
                             (matrix.testSuiteses[0].length > 1)),
      measurements: matrix.measurements,
      bots: [],
      botsAggregated: ((matrix.botses.length === 1) &&
                       (matrix.botses[0].length > 1)),
      testCases: [],
      testCasesAggregated: ((matrix.testCaseses.length === 1) &&
                            (matrix.testCaseses[0].length > 1)),
      statistics: matrix.statistics,
    };
    for (const testSuites of matrix.testSuiteses) {
      parameters.testSuites.push(...testSuites);
    }
    for (const bots of matrix.botses) {
      parameters.bots.push(...bots);
    }
    for (const testCases of matrix.testCaseses) {
      parameters.testCases.push(...testCases);
    }
    return parameters;
  };

  ChartSection.getSessionState = state => {
    return {
      parameters: {
        testSuites: state.testSuite.selectedOptions,
        testSuitesAggregated: state.testSuite.isAggregated,
        measurements: state.measurement.selectedOptions,
        bots: state.bot.selectedOptions,
        botsAggregated: state.bot.isAggregated,
        testCases: state.testCase.selectedOptions,
        testCasesAggregated: state.testCase.isAggregated,
        statistics: state.statistic.selectedOptions,
      },
      isExpanded: state.isExpanded,
      title: state.title,
      minRevision: state.minRevision,
      maxRevision: state.maxRevision,
      zeroYAxis: state.zeroYAxis,
      fixedXAxis: state.fixedXAxis,
      mode: state.mode,
      selectedRelatedTabName: state.selectedRelatedTabName,
      selectedLineDescriptorHash: state.selectedLineDescriptorHash,
    };
  };

  ChartSection.getRouteParams = state => {
    const allBotsSelected = state.bot.selectedOptions.length ===
        cp.OptionGroup.countDescendents(state.bot.options);

    if (state.testSuite.selectedOptions.length > 2 ||
        state.testCase.selectedOptions.length > 2 ||
        state.measurement.selectedOptions.length > 2 ||
        ((state.bot.selectedOptions.length > 2) && !allBotsSelected)) {
      return undefined;
    }

    const routeParams = new URLSearchParams();
    for (const testSuite of state.testSuite.selectedOptions) {
      routeParams.append('testSuite', testSuite);
    }
    if (state.testSuite.isAggregated) {
      routeParams.set('aggSuites', '');
    }
    for (const measurement of state.measurement.selectedOptions) {
      routeParams.append('measurement', measurement);
    }
    if (allBotsSelected) {
      routeParams.set('bot', '*');
    } else {
      for (const bot of state.bot.selectedOptions) {
        routeParams.append('bot', bot);
      }
    }
    if (!state.bot.isAggregated) {
      routeParams.set('splitBots', '');
    }
    for (const testCase of state.testCase.selectedOptions) {
      routeParams.append('testCase', testCase);
    }
    for (const tag of state.testCase.tags.selectedOptions) {
      routeParams.append('caseTag', tag);
    }
    if (!state.testCase.isAggregated) {
      routeParams.set('splitCases', '');
    }
    const statistics = state.statistic.selectedOptions;
    if (statistics.length > 1 || statistics[0] !== 'avg') {
      for (const statistic of statistics) {
        routeParams.append('stat', statistic);
      }
    }
    if (state.minRevision !== undefined) {
      routeParams.set('minRev', state.minRevision);
    }
    if (state.maxRevision !== undefined) {
      routeParams.set('maxRev', state.maxRevision);
    }
    if (state.mode !== 'normalizeUnit') {
      routeParams.set('mode', state.mode);
    }
    if (state.selectedLineDescriptorHash) {
      routeParams.set('select', state.selectedLineDescriptorHash.slice(0, 6));
    }
    if (!state.fixedXAxis) {
      routeParams.set('natural', '');
    }
    if (state.zeroYAxis) {
      routeParams.set('zeroY', '');
    }
    if (state.selectedRelatedTabName) {
      routeParams.set('spark', state.selectedRelatedTabName);
    }
    if (!state.isExpanded) {
      routeParams.set('compact', '');
    }
    return routeParams;
  };

  ChartSection.computeTitle = state => {
    if (state.isTitleCustom) return state.title;
    let title = state.measurement.selectedOptions.join(', ');
    if (state.bot.selectedOptions.length > 0 &&
        state.bot.selectedOptions.length < 4) {
      title += ' on ' + state.bot.selectedOptions.join(', ');
    }
    if (state.testCase.selectedOptions.length > 0 &&
        state.testCase.selectedOptions.length < 4) {
      title += ' for ' + state.testCase.selectedOptions.join(', ');
    }
    return title;
  };

  ChartSection.isEmpty = state => (
    state.testSuite.selectedOptions.length === 0 &&
    state.measurement.selectedOptions.length === 0 &&
    state.bot.selectedOptions.length === 0 &&
    state.testCase.selectedOptions.length === 0);

  ChartSection.matchesOptions = (state, options) => {
    if (options === undefined) return false;
    if (options.parameters) {
      if (options.parameters.testSuites && !tr.b.setsEqual(
          new Set(options.parameters.testSuites),
          new Set(state.testSuite.selectedOptions))) {
        return false;
      }
      if (options.parameters.measurements && !tr.b.setsEqual(
          new Set(options.parameters.measurements),
          new Set(state.measurement.selectedOptions))) {
        return false;
      }
      if (options.parameters.bots && !tr.b.setsEqual(
          new Set(options.parameters.bots),
          new Set(state.bot.selectedOptions))) {
        return false;
      }
      if (options.parameters.testCases && !tr.b.setsEqual(
          new Set(options.parameters.testCases),
          new Set(state.testCase.selectedOptions))) {
        return false;
      }
      // TODO testSuitesAggregated, botsAggregated, testCasesAggregated
      // TODO statistics
    }
    // TODO minRevision, maxRevision, selectedRelatedTabName
    return true;
  };

  cp.ElementBase.register(ChartSection);

  return {
    ChartSection,
  };
});
