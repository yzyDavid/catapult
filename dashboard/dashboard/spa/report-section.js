/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  const CHROMIUM_MILESTONES = {
    // https://omahaproxy.appspot.com/
    // Does not support M<=63
    64: 520840,
    65: 530369,
    66: 540276,
    67: 550428,
    68: 561733,
    69: 576753,
    70: 587811,
  };
  const CURRENT_MILESTONE = tr.b.math.Statistics.max(
      Object.keys(CHROMIUM_MILESTONES));
  const MIN_MILESTONE = tr.b.math.Statistics.min(
      Object.keys(CHROMIUM_MILESTONES));

  class ReportTemplateRequest extends cp.RequestBase {
    constructor(options) {
      super(options);
      this.method_ = 'POST';
      this.body_ = new FormData();
      this.body_.set('template', JSON.stringify({
        url: options.url,
        statistics: options.statistics,
        rows: options.rows,
      }));
      this.body_.set('name', options.name);
      this.body_.set('owners', options.owners.join(','));
      this.body_.set('id', options.id);
    }

    get url_() {
      return `/api/report/template`;
    }

    async localhostResponse_() {
      return {};
    }
  }

  class ReportSection extends cp.ElementBase {
    ready() {
      super.ready();
      this.scrollIntoView(true);
    }

    connectedCallback() {
      super.connectedCallback();
      this.dispatch('connected', this.statePath);
    }

    async onCloseSection_() {
      await this.dispatchEvent(new CustomEvent('close-section', {
        bubbles: true,
        composed: true,
        detail: {sectionId: this.sectionId},
      }));
    }

    async onTagSelect_(event) {
      const {tableIndex, rowIndex} = event.model;
      this.dispatch(cp.ChartParameter.actions.tagFilter(
          `${this.statePath}.tables.${tableIndex}.rows.${rowIndex}.testCase`));
    }

    async onSelectSource_(event) {
      await this.dispatch('loadReports', this.statePath);
      if (this.source.selectedOptions.includes(ReportSection.CREATE)) {
        const name = this.shadowRoot.querySelector('.report_name_input');
        if (name) {
          name.focus();
        }
      }
    }

    prevMstoneButtonLabel_(milestone, maxRevision) {
      return this.prevMstoneLabel_(milestone - 1, maxRevision);
    }

    prevMstoneLabel_(milestone, maxRevision) {
      if (maxRevision === 'latest') milestone += 1;
      return `M${milestone - 1}`;
    }

    curMstoneLabel_(milestone, maxRevision) {
      if (maxRevision === 'latest') return '';
      return `M${milestone}`;
    }

    async onPreviousMilestone_() {
      await this.dispatch('selectMilestone', this.statePath,
          this.milestone - 1);
    }

    async onNextMilestone_() {
      await this.dispatch('selectMilestone', this.statePath,
          this.milestone + 1);
    }

    async onCopy_(event) {
      // TODO maybe use the template to render this table?
      const table = document.createElement('table');
      const statisticsCount = event.model.table.statistics.length;
      for (const row of event.model.table.rows) {
        const tr = document.createElement('tr');
        table.appendChild(tr);
        // b/111692559
        const td = document.createElement('td');
        td.innerText = row.label;
        tr.appendChild(td);

        for (let scalarIndex = 0; scalarIndex < 2 * statisticsCount;
          ++scalarIndex) {
          const td = document.createElement('td');
          tr.appendChild(td);
          const scalar = row.scalars[scalarIndex];
          if (!isNaN(scalar.value)) {
            td.innerText = scalar.unit.format(scalar.value, {
              unitPrefix: scalar.unitPrefix,
            }).match(/^(-?[,0-9]+\.?[0-9]*)/)[0];
          }
        }
      }

      this.$.scratch.appendChild(table);
      const range = document.createRange();
      range.selectNodeContents(this.$.scratch);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
      await this.dispatch('toastCopied', this.statePath, true);
      this.$.scratch.innerText = '';
    }

    async onOpenChart_(event) {
      // The user may have clicked a link for an individual row (in which case
      // labelPartIndex = labelParts.length - 1) or a group of rows (in which
      // case labelPartIndex < labelParts.length - 1). In the latter case,
      // collect all parameters for all rows in the group (all measurements, all
      // bots, all test cases, all test suites).
      function getLabelPrefix(row) {
        return row.labelParts.slice(0, event.model.labelPartIndex + 1).map(
            p => p.label).join(':');
      }
      const labelPrefix = getLabelPrefix(event.model.parentModel.row);
      const table = event.model.parentModel.parentModel.table;
      const testSuites = new Set();
      const measurements = new Set();
      const bots = new Set();
      const testCases = new Set();
      for (const row of table.rows) {
        if (getLabelPrefix(row) !== labelPrefix) continue;
        for (const testSuite of row.testSuite.selectedOptions) {
          testSuites.add(testSuite);
        }
        for (const measurement of row.measurement.selectedOptions) {
          measurements.add(measurement);
        }
        for (const bot of row.bot.selectedOptions) {
          bots.add(bot);
        }
        for (const testCase of row.testCase.selectedOptions) {
          testCases.add(testCase);
        }
      }

      this.dispatchEvent(new CustomEvent('new-chart', {
        bubbles: true,
        composed: true,
        detail: {
          options: {
            minRevision: this.minRevision,
            maxRevision: this.maxRevision,
            parameters: {
              testSuites: [...testSuites],
              measurements: [...measurements],
              bots: [...bots],
              testCases: [...testCases],
            },
          },
        },
      }));
    }

    async onAlerts_(event) {
      this.dispatchEvent(new CustomEvent('alerts', {
        bubbles: true,
        composed: true,
        detail: {
          options: {
            reports: this.source.selectedOptions,
            showingTriaged: true,
            minRevision: '' + this.minRevisionInput,
            maxRevision: '' + this.maxRevisionInput,
          },
        },
      }));
    }

    async onToggleEditing_(event) {
      await this.dispatch('toggleEditing', this.statePath,
          event.model.tableIndex);
      if (this.tables[event.model.tableIndex].isEditing) {
        this.shadowRoot.querySelector('cp-input').focus();
      }
    }

    isValid_(table) {
      return ReportSection.isValid(table);
    }

    isLastRow_(rows) {
      return rows.length === 1;
    }

    async onTemplateNameKeyUp_(event) {
      await this.dispatch('templateName', this.statePath,
          event.model.tableIndex, event.target.value);
    }

    async onTemplateOwnersKeyUp_(event) {
      await this.dispatch('templateOwners', this.statePath,
          event.model.tableIndex, event.target.value);
    }

    async onTemplateUrlKeyUp_(event) {
      await this.dispatch('templateUrl', this.statePath, event.model.tableIndex,
          event.target.value);
    }

    async onTemplateRowLabelKeyUp_(event) {
      await this.dispatch('templateRowLabel', this.statePath,
          event.model.tableIndex, event.model.rowIndex, event.target.value);
    }

    async onTestSuiteSelect_(event) {
      await this.dispatch('templateTestSuite', this.statePath,
          event.model.tableIndex, event.model.rowIndex);
    }

    async onTemplateRemoveRow_(event) {
      await this.dispatch('templateRemoveRow', this.statePath,
          event.model.tableIndex, event.model.rowIndex);
    }

    async onTemplateAddRow_(event) {
      await this.dispatch('templateAddRow', this.statePath,
          event.model.tableIndex, event.model.rowIndex);
    }

    async onTemplateSave_(event) {
      await this.dispatch('templateSave', this.statePath,
          event.model.tableIndex);
    }

    observeUserEmail_(userEmail) {
      this.dispatch('authChange', this.statePath);
    }

    numChangeColumns_(statistics) {
      return 2 * this._len(statistics);
    }

    canEdit_(table, userEmail) {
      return ReportSection.canEdit(table, userEmail);
    }

    async onMinRevisionKeyup_(event) {
      await this.dispatch('setMinRevision', this.statePath, event.target.value);
    }

    async onMaxRevisionKeyup_(event) {
      await this.dispatch('setMaxRevision', this.statePath, event.target.value);
    }

    isPreviousMilestone_(milestone) {
      return milestone > (MIN_MILESTONE + 1);
    }

    isNextMilestone_(milestone) {
      return milestone < CURRENT_MILESTONE;
    }

    async onOverRow_(event) {
      if (!event.model.row.actualDescriptors) return;
      let tr;
      for (const elem of event.path) {
        if (elem.tagName === 'TR') {
          tr = elem;
          break;
        }
      }
      if (!tr) return;
      const td = tr.querySelectorAll('td')[event.model.row.labelParts.length];
      const tdRect = await cp.measureElement(td);
      await this.dispatch('showTooltip', this.statePath, {
        rows: event.model.row.actualDescriptors.map(descriptor => [
          descriptor.testSuite, descriptor.bot, descriptor.testCase]),
        top: tdRect.bottom,
        left: tdRect.left,
      });
    }

    async onOutRow_(event) {
      await this.dispatch('hideTooltip', this.statePath);
    }
  }

  ReportSection.canEdit = (table, userEmail) =>
    window.IS_DEBUG ||
    (table && table.owners && userEmail && table.owners.includes(userEmail));

  ReportSection.State = {
    copiedMeasurements: options => false,
    isLoading: options => false,
    milestone: options => parseInt(options.milestone) || CURRENT_MILESTONE,
    minRevision: options => options.minRevision,
    maxRevision: options => options.maxRevision,
    minRevisionInput: options => options.minRevision,
    maxRevisionInput: options => options.maxRevision,
    sectionId: options => options.sectionId || tr.b.GUID.allocateSimple(),
    source: options => cp.DropdownInput.buildState({
      label: 'Reports (loading)',
      options: [
        ReportSection.DEFAULT_NAME,
        ReportSection.CREATE,
      ],
      selectedOptions: options.sources ? options.sources : [
        ReportSection.DEFAULT_NAME,
      ],
    }),
    tables: options => [PLACEHOLDER_TABLE],
    tooltip: options => {return {};},
  };

  ReportSection.buildState = options => cp.buildState(
      ReportSection.State, options);

  ReportSection.properties = {
    ...cp.buildProperties('state', ReportSection.State),
    userEmail: {statePath: 'userEmail'},
  };
  ReportSection.observers = ['observeUserEmail_(userEmail)'];

  const DASHES = '-'.repeat(5);
  const PLACEHOLDER_TABLE = {
    name: DASHES,
    isPlaceholder: true,
    statistics: ['avg'],
    report: {rows: []},
  };
  // Keep this the same shape as the default report so that the buttons don't
  // move when the default report loads.
  for (let i = 0; i < 4; ++i) {
    const scalars = [];
    for (let j = 0; j < 4 * PLACEHOLDER_TABLE.statistics.length; ++j) {
      scalars.push({value: 0, unit: tr.b.Unit.byName.count});
    }
    PLACEHOLDER_TABLE.report.rows.push({
      labelParts: [
        {
          href: '',
          label: DASHES,
          isFirst: true,
          rowCount: 1,
        },
      ],
      scalars,
    });
  }

  ReportSection.placeholderTable = name => {
    return {
      ...PLACEHOLDER_TABLE,
      name,
    };
  };

  ReportSection.DEFAULT_NAME = 'Chromium Performance Overview';
  ReportSection.CREATE = '[Create new report]';

  ReportSection.actions = {
    connected: statePath => async(dispatch, getState) => {
      let state = Polymer.Path.get(getState(), statePath);
      if (state.minRevision === undefined ||
          state.maxRevision === undefined) {
        ReportSection.actions.selectMilestone(
            statePath, state.milestone)(dispatch, getState);
      }
      await ReportSection.actions.loadSources(statePath)(dispatch, getState);

      state = Polymer.Path.get(getState(), statePath);
      if (state.source.selectedOptions.length === 0) {
        cp.DropdownInput.actions.focus(
            statePath + '.source')(dispatch, getState);
      }
    },

    authChange: statePath => async(dispatch, getState) => {
      ReportSection.actions.loadSources(statePath)(dispatch, getState);
    },

    selectMilestone: (statePath, milestone) => async(dispatch, getState) => {
      dispatch({
        type: ReportSection.reducers.selectMilestone.name,
        statePath,
        milestone,
      });
      ReportSection.actions.loadReports(statePath)(dispatch, getState);
    },

    restoreState: (statePath, options) => async(dispatch, getState) => {
      dispatch({
        type: ReportSection.reducers.restoreState.name,
        statePath,
        options,
      });
      const state = Polymer.Path.get(getState(), statePath);
      if (state.minRevision === undefined ||
          state.maxRevision === undefined) {
        ReportSection.actions.selectMilestone(
            statePath, state.milestone)(dispatch, getState);
      }
      ReportSection.actions.loadReports(statePath)(dispatch, getState);
    },

    toggleEditing: (statePath, tableIndex) => async(dispatch, getState) => {
      const rootState = getState();
      const state = Polymer.Path.get(rootState, statePath);
      const table = state.tables[tableIndex];
      if (table.canEdit !== true) {
        // TODO isLoading
        await ReportSection.actions.renderEditForm(
            statePath, tableIndex)(dispatch, getState);
      }
      dispatch(Redux.TOGGLE(`${statePath}.tables.${tableIndex}.isEditing`));
    },

    loadSources: statePath => async(dispatch, getState) => {
      const reportTemplateInfos = await cp.ReadReportNames()(dispatch,
          getState);
      const rootState = getState();
      const teamFilter = cp.TeamFilter.get(rootState.teamName);
      const reportNames = await teamFilter.reportNames(
          reportTemplateInfos.map(t => t.name));
      dispatch({
        type: ReportSection.reducers.receiveSourceOptions.name,
        statePath,
        reportNames,
      });
      ReportSection.actions.loadReports(statePath)(dispatch, getState);
    },

    loadReports: statePath => async(dispatch, getState) => {
      let rootState = getState();
      let state = Polymer.Path.get(rootState, statePath);
      let testSuites = [];
      if (state.source.selectedOptions.includes(ReportSection.CREATE)) {
        testSuites = await cp.TeamFilter.get(rootState.teamName).testSuites(
            await cp.ReadTestSuites()(dispatch, getState));
      }
      dispatch({
        type: ReportSection.reducers.requestReports.name,
        statePath,
        testSuites,
      });

      const names = state.source.selectedOptions.filter(name =>
        name !== ReportSection.CREATE);
      const requestedReports = new Set(state.source.selectedOptions);
      const revisions = [state.minRevision, state.maxRevision];
      const reportTemplateInfos = await cp.ReadReportNames()(dispatch,
          getState);
      const promises = [];

      for (const name of names) {
        for (const templateInfo of reportTemplateInfos) {
          if (templateInfo.name === name) {
            promises.push(cp.ReadReport({
              ...templateInfo,
              revisions,
              dispatch,
              getState,
            }));
          }
        }
      }

      // Avoid triggering render too rapidly by batching responses.
      const batchIterator = new cp.BatchIterator(promises);

      for await (const {results, errors} of batchIterator) {
        rootState = getState();
        state = Polymer.Path.get(rootState, statePath);
        if (!tr.b.setsEqual(requestedReports, new Set(
            state.source.selectedOptions)) ||
            (state.minRevision !== revisions[0]) ||
            (state.maxRevision !== revisions[1])) {
          return;
        }
        if (testSuites.length === 0) {
          testSuites = await cp.TeamFilter.get(rootState.teamName).testSuites(
              await cp.ReadTestSuites()(dispatch, getState));
        }
        dispatch({
          type: ReportSection.reducers.receiveReports.name,
          statePath,
          reports: results,
          testSuites,
        });
        // ReportSection.actions.renderEditForms(statePath)(dispatch, getState);
        // ReportSection.actions.prefetchCharts(statePath)(dispatch, getState);
      }

      dispatch(Redux.UPDATE(statePath, {isLoading: false}));
    },

    renderEditForm: (statePath, tableIndex) => async(dispatch, getState) => {
      const state = Polymer.Path.get(getState(), statePath);
      const table = state.tables[tableIndex];
      if (table.canEdit === true) return;
      if (table.canEdit !== false) await table.canEdit;
      const promise = (async() => {
        await Promise.all(table.rows.map(async(row, rowIndex) => {
          if (!row.testSuite || !row.testSuite.selectedOptions ||
              !row.testSuite.selectedOptions.length) {
            // TODO this nullcheck should not be necessary
            return;
          }
          const path = `${statePath}.tables.${tableIndex}.rows.${rowIndex}`;
          await cp.ChartSection.actions.describeTestSuites(path)(
              dispatch, getState);
        }));
        const path = `${statePath}.tables.${tableIndex}`;
        dispatch(Redux.UPDATE(path, {canEdit: true}));
      })();
      dispatch(Redux.UPDATE(`${statePath}.tables.${tableIndex}`, {
        canEdit: promise,
      }));
      await promise;
    },

    renderEditForms: statePath => async(dispatch, getState) => {
      const state = Polymer.Path.get(getState(), statePath);
      await Promise.all(state.tables.map(async(table, tableIndex) => {
        await cp.idle();
        await ReportSection.actions.renderEditForm(statePath, tableIndex)(
            dispatch, getState);
      }));
    },

    prefetchCharts: statePath => async(dispatch, getState) => {
      const state = Polymer.Path.get(getState(), statePath);
      const lineDescriptors = [];
      for (const table of state.tables) {
        for (const row of table.rows) {
          if (!row.testSuite || !row.measurement || !row.bot || !row.testCase) {
            continue;
          }
          lineDescriptors.push({
            testSuites: row.testSuite.selectedOptions,
            measurement: row.measurement.selectedOptions[0],
            bots: row.bot.selectedOptions,
            testCases: row.testCase.selectedOptions,
            statistic: 'avg',
            buildType: 'test',
          });
        }
      }
      for (let i = 0; i < lineDescriptors.length; i += 5) {
        await cp.idle();
        await cp.ChartTimeseries.actions.prefetch(
            statePath, lineDescriptors.slice(i, i + 5))(dispatch, getState);
      }
    },

    templateName: (statePath, tableIndex, name) =>
      async(dispatch, getState) => {
        const path = `${statePath}.tables.${tableIndex}`;
        dispatch(Redux.UPDATE(path, {name}));
      },

    templateOwners: (statePath, tableIndex, owners) =>
      async(dispatch, getState) => {
        const path = `${statePath}.tables.${tableIndex}`;
        dispatch(Redux.UPDATE(path, {owners}));
      },

    templateUrl: (statePath, tableIndex, url) =>
      async(dispatch, getState) => {
        dispatch(Redux.UPDATE(`${statePath}.tables.${tableIndex}`, {url}));
      },

    templateRowLabel: (statePath, tableIndex, rowIndex, label) =>
      async(dispatch, getState) => {
        const path = `${statePath}.tables.${tableIndex}.rows.${rowIndex}`;
        dispatch(Redux.UPDATE(path, {label}));
      },

    templateTestSuite: (statePath, tableIndex, rowIndex) =>
      async(dispatch, getState) => {
        const path = `${statePath}.tables.${tableIndex}.rows.${rowIndex}`;
        cp.ChartSection.actions.describeTestSuites(path)(dispatch, getState);
      },

    templateRemoveRow: (statePath, tableIndex, rowIndex) =>
      async(dispatch, getState) => {
        dispatch({
          type: ReportSection.reducers.templateRemoveRow.name,
          statePath,
          tableIndex,
          rowIndex,
        });
      },

    templateAddRow: (statePath, tableIndex, rowIndex) =>
      async(dispatch, getState) => {
        dispatch({
          type: ReportSection.reducers.templateAddRow.name,
          statePath: `${statePath}.tables.${tableIndex}`,
          rowIndex,
          testSuites: await cp.ReadTestSuites()(dispatch, getState),
        });
        const path = `${statePath}.tables.${tableIndex}.rows.${rowIndex + 1}`;
        cp.ChartSection.actions.describeTestSuites(path)(dispatch, getState);
      },

    templateSave: (statePath, tableIndex) => async(dispatch, getState) => {
      let rootState = getState();
      let state = Polymer.Path.get(rootState, statePath);
      const table = state.tables[tableIndex];
      const request = new ReportTemplateRequest({
        id: table.id,
        name: table.name,
        owners: table.owners.split(',').map(o => o.replace(/ /g, '')),
        url: table.url,
        statistics: table.statistic.selectedOptions,
        rows: table.rows.map(row => {
          return {
            label: row.label,
            testSuites: row.testSuite.selectedOptions,
            measurement: row.measurement.selectedOptions[0],
            bots: row.bot.selectedOptions,
            testCases: row.testCase.selectedOptions,
          };
        }),
      });
      dispatch(Redux.UPDATE(statePath, {isLoading: true}));
      const reportTemplateInfos = await request.response;
      dispatch(Redux.UPDATE('', {reportTemplateInfos}));
      const teamFilter = cp.TeamFilter.get(rootState.teamName);
      const reportNames = await teamFilter.reportNames(
          reportTemplateInfos.map(t => t.name));
      dispatch({
        type: ReportSection.reducers.receiveSourceOptions.name,
        statePath,
        reportNames,
      });
      rootState = getState();
      state = Polymer.Path.get(rootState, statePath);
      dispatch(Redux.UPDATE(statePath, {
        isLoading: false,
        source: {
          ...state.source,
          selectedOptions: [table.name],
        },
      }));
      ReportSection.actions.loadReports(statePath)(dispatch, getState);
    },

    setMinRevision: (statePath, minRevisionInput) =>
      async(dispatch, getState) => {
        dispatch(Redux.UPDATE(statePath, {minRevisionInput}));
        if (!minRevisionInput.match(/^\d{6}$/)) return;
        dispatch(Redux.UPDATE(statePath, {minRevision: minRevisionInput}));
        ReportSection.actions.loadReports(statePath)(dispatch, getState);
      },

    setMaxRevision: (statePath, maxRevisionInput) =>
      async(dispatch, getState) => {
        dispatch(Redux.UPDATE(statePath, {maxRevisionInput}));
        if (!maxRevisionInput.match(/^\d{6}$/)) return;
        dispatch(Redux.UPDATE(statePath, {maxRevision: maxRevisionInput}));
        ReportSection.actions.loadReports(statePath)(dispatch, getState);
      },

    toastCopied: statePath => async(dispatch, getState) => {
      dispatch(Redux.UPDATE(statePath, {copiedMeasurements: true}));
      await cp.timeout(5000);
      // TODO return if a different table was copied during the timeout.
      dispatch(Redux.UPDATE(statePath, {copiedMeasurements: false}));
    },

    showTooltip: (statePath, tooltip) => async(dispatch, getState) => {
      dispatch(Redux.UPDATE(statePath, {tooltip}));
    },

    hideTooltip: statePath => async(dispatch, getState) => {
      dispatch(Redux.UPDATE(statePath, {tooltip: {}}));
    },
  };

  ReportSection.reducers = {
    selectMilestone: (state, {milestone}, rootState) => {
      const maxRevision = (milestone === CURRENT_MILESTONE) ?
        'latest' : CHROMIUM_MILESTONES[milestone + 1];
      const minRevision = CHROMIUM_MILESTONES[milestone];
      return {
        ...state,
        minRevision,
        maxRevision,
        minRevisionInput: minRevision,
        maxRevisionInput: maxRevision,
        milestone,
      };
    },

    restoreState: (state, action, rootState) => {
      if (!action.options) return state;
      const source = {
        ...state.source,
        selectedOptions: action.options.sources,
      };
      return {
        ...state,
        source,
        milestone: parseInt(action.options.milestone || CURRENT_MILESTONE),
        minRevision: action.options.minRevision,
        maxRevision: action.options.maxRevision,
        minRevisionInput: action.options.minRevision,
        maxRevisionInput: action.options.maxRevision,
      };
    },

    receiveSourceOptions: (state, {reportNames}, rootState) => {
      const options = cp.OptionGroup.groupValues(reportNames);
      if (window.IS_DEBUG || rootState.userEmail) {
        options.push(ReportSection.CREATE);
      }
      const label = `Reports (${reportNames.length})`;
      return {...state, source: {...state.source, options, label}};
    },

    requestReports: (state, action, rootState) => {
      const tables = [];
      const tableNames = new Set();
      const selectedNames = state.source.selectedOptions;
      for (const table of state.tables) {
        // Remove tables whose names are unselected.
        if (selectedNames.includes(table.name)) {
          tables.push(table);
          tableNames.add(table.name);
        }
      }
      for (const name of selectedNames) {
        // Add placeholderTables for missing names.
        if (!tableNames.has(name)) {
          if (name === ReportSection.CREATE) {
            tables.push(ReportSection.newTemplate(
                rootState.userEmail, action.testSuites));
          } else {
            tables.push(ReportSection.placeholderTable(name));
          }
        }
      }
      return {...state, isLoading: true, tables};
    },

    receiveReports: (state, action, rootState) => {
      const tables = [...state.tables];
      for (const report of action.reports) {
        // Remove the placeholderTable for this report.
        if (!report) continue;
        const placeholderIndex = tables.findIndex(table =>
          table && (table.name === report.name));
        tables.splice(placeholderIndex, 1);

        const rows = report.report.rows.map(
            row => ReportSection.transformReportRow(
                row, state.minRevision, state.maxRevision,
                report.report.statistics, action.testSuites));

        // Right-align labelParts.
        const maxLabelParts = tr.b.math.Statistics.max(rows, row =>
          row.labelParts.length);
        for (const {labelParts} of rows) {
          while (labelParts.length < maxLabelParts) {
            labelParts.unshift({
              href: '',
              isFirst: true,
              label: '',
              rowCount: 1,
            });
          }
        }

        // Compute labelPart.isFirst, labelPart.rowCount.
        for (let rowIndex = 1; rowIndex < rows.length; ++rowIndex) {
          for (let partIndex = 0; partIndex < maxLabelParts; ++partIndex) {
            if (rows[rowIndex].labelParts[partIndex].label !==
                rows[rowIndex - 1].labelParts[partIndex].label) {
              continue;
            }
            rows[rowIndex].labelParts[partIndex].isFirst = false;
            let firstRi = rowIndex - 1;
            while (!rows[firstRi].labelParts[partIndex].isFirst) {
              --firstRi;
            }
            ++rows[firstRi].labelParts[partIndex].rowCount;
          }
        }

        // TODO compute colors for deltaPercent columns

        tables.push({
          ...report,
          ...report.report,
          canEdit: false, // See actions.renderEditForm
          isEditing: false,
          rows,
          maxLabelParts,
          owners: (report.owners || []).join(', '),
          statistic: {
            label: 'Statistics',
            query: '',
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
            selectedOptions: report.report.statistics,
            required: true,
          },
        });
      }
      return {
        ...state,
        tables,
      };
    },

    templateRemoveRow: (state, action, rootState) => {
      const tables = [...state.tables];
      const table = tables[action.tableIndex];
      const rows = [...table.rows];
      rows.splice(action.rowIndex, 1);
      tables[action.tableIndex] = {
        ...table,
        rows,
      };
      return {...state, tables};
    },

    templateAddRow: (table, action, rootState) => {
      const contextRow = table.rows[action.rowIndex];
      const newRow = ReportSection.newTemplateRow({
        testSuite: {
          options: cp.OptionGroup.groupValues(action.testSuites),
          label: `Test suites (${action.testSuites.length})`,
          selectedOptions: [...contextRow.testSuite.selectedOptions],
        },
        bot: {
          selectedOptions: [...contextRow.bot.selectedOptions],
        },
        testCase: {
          selectedOptions: [...contextRow.testCase.selectedOptions],
        },
      });
      const rows = [...table.rows];
      rows.splice(action.rowIndex + 1, 0, newRow);
      return {...table, rows};
    },
  };

  ReportSection.newTemplate = (userEmail, testSuites) => {
    return {
      isEditing: true,
      name: '',
      owners: userEmail,
      url: '',
      statistics: [],
      rows: [ReportSection.newTemplateRow({
        testSuite: {
          options: cp.OptionGroup.groupValues(testSuites),
          label: `Test suites (${testSuites.length})`,
        },
      })],
      statistic: {
        label: 'Statistics',
        query: '',
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
        selectedOptions: ['avg'],
        required: true,
      },
    };
  };

  ReportSection.newTemplateRow = ({testSuite, bot, testCase}) => {
    return {
      label: '',
      testSuite: {
        ...testSuite,
        errorMessage: 'Required',
        query: '',
        required: true,
        selectedOptions: testSuite.selectedOptions || [],
      },
      measurement: {
        errorMessage: 'Require exactly one',
        label: 'Measurement',
        options: [],
        query: '',
        requireSingle: true,
        required: true,
        selectedOptions: [],
      },
      bot: {
        errorMessage: 'Required',
        label: 'Bots',
        options: [],
        query: '',
        required: true,
        selectedOptions: bot ? bot.selectedOptions : [],
      },
      testCase: {
        label: 'Test cases',
        options: [],
        query: '',
        selectedOptions: testCase ? testCase.selectedOptions : [],
      },
    };
  };

  function maybeInt(x) {
    const i = parseInt(x);
    return isNaN(i) ? x : i;
  }

  ReportSection.newStateOptionsFromQueryParams = queryParams => {
    const options = {
      sources: queryParams.getAll('report'),
      milestone: parseInt(queryParams.get('m')) || undefined,
      minRevision: maybeInt(queryParams.get('minRev')) || undefined,
      maxRevision: maybeInt(queryParams.get('maxRev')) || undefined,
    };
    if (options.maxRevision < options.minRevision) {
      [options.maxRevision, options.minRevision] = [
        options.minRevision, options.maxRevision];
    }
    if (options.milestone === undefined &&
        options.minRevision !== undefined &&
        options.maxRevision !== undefined) {
      for (const [milestone, milestoneRevision] of Object.entries(
          CHROMIUM_MILESTONES)) {
        if ((milestoneRevision >= options.minRevision) &&
            ((options.maxRevision === 'latest') ||
             (options.maxRevision >= milestoneRevision))) {
          options.milestone = milestone;
          break;
        }
      }
    }
    return options;
  };

  ReportSection.getSessionState = state => {
    return {
      sources: state.source.selectedOptions,
      milestone: state.milestone,
    };
  };

  ReportSection.getRouteParams = state => {
    const routeParams = new URLSearchParams();
    const selectedOptions = state.source.selectedOptions;
    if (state.containsDefaultSection &&
        selectedOptions.length === 1 &&
        selectedOptions[0] === ReportSection.DEFAULT_NAME) {
      return routeParams;
    }
    for (const option of selectedOptions) {
      if (option === ReportSection.CREATE) continue;
      routeParams.append('report', option);
    }
    routeParams.set('minRev', state.minRevision);
    routeParams.set('maxRev', state.maxRevision);
    return routeParams;
  };

  function chartHref(lineDescriptor) {
    const params = new URLSearchParams({
      measurement: lineDescriptor.measurement,
    });
    for (const testSuite of lineDescriptor.testSuites) {
      params.append('testSuite', testSuite);
    }
    for (const bot of lineDescriptor.testSuites) {
      params.append('bot', bot);
    }
    for (const testCase of lineDescriptor.testSuites) {
      params.append('testCase', testCase);
    }
    return location.origin + '#' + params;
  }

  ReportSection.transformReportRow = (
      row, minRevision, maxRevision, statistics, testSuites) => {
    const href = chartHref(row);
    const labelParts = row.label.split(':').map(label => {
      return {
        href,
        isFirst: true,
        label,
        rowCount: 1,
      };
    });

    let rowUnit = tr.b.Unit.byJSONName[row.units];
    let conversionFactor = 1;
    if (!rowUnit) {
      rowUnit = tr.b.Unit.byName.unitlessNumber;
      const info = tr.v.LEGACY_UNIT_INFO.get(row.units);
      let improvementDirection = tr.b.ImprovementDirection.DONT_CARE;
      if (info) {
        conversionFactor = info.conversionFactor;
        if (info.defaultImprovementDirection !== undefined) {
          improvementDirection = info.defaultImprovementDirection;
        }
        const unitNameSuffix = tr.b.Unit.nameSuffixForImprovementDirection(
            improvementDirection);
        rowUnit = tr.b.Unit.byName[info.name + unitNameSuffix];
      }
    }
    if (rowUnit.improvementDirection === tr.b.ImprovementDirection.DONT_CARE &&
        row.improvement_direction !== 4) {
      const improvementDirection = (row.improvement_direction === 0) ?
        tr.b.ImprovementDirection.BIGGER_IS_BETTER :
        tr.b.ImprovementDirection.SMALLER_IS_BETTER;
      const unitNameSuffix = tr.b.Unit.nameSuffixForImprovementDirection(
          improvementDirection);
      rowUnit = tr.b.Unit.byName[rowUnit.unitName + unitNameSuffix];
    }

    const scalars = [];
    for (const revision of [minRevision, maxRevision]) {
      for (const statistic of statistics) {
        // IndexedDB can return impartial results if there is no data cached for
        // the requested revision.
        if (!row.data[revision]) {
          scalars.push({}); // insert empty column
          continue;
        }

        const unit = (statistic === 'count') ? tr.b.Unit.byName.count :
          rowUnit;
        let unitPrefix;
        if (rowUnit.baseUnit === tr.b.Unit.byName.sizeInBytes) {
          unitPrefix = tr.b.UnitPrefixScale.BINARY.KIBI;
        }
        const running = tr.b.math.RunningStatistics.fromDict(
            row.data[revision].statistics);
        scalars.push({
          unit,
          unitPrefix,
          value: running[statistic],
        });
      }
    }
    for (const statistic of statistics) {
      // IndexedDB can return impartial results if there is no data cached for
      // the requested min or max revision.
      if (!row.data[minRevision] || !row.data[maxRevision]) {
        scalars.push({}); // insert empty relative delta
        scalars.push({}); // insert empty absolute delta
        continue;
      }

      const unit = ((statistic === 'count') ? tr.b.Unit.byName.count :
        rowUnit).correspondingDeltaUnit;
      const deltaValue = (
        tr.b.math.RunningStatistics.fromDict(
            row.data[maxRevision].statistics)[statistic] -
        tr.b.math.RunningStatistics.fromDict(
            row.data[minRevision].statistics)[statistic]);
      const suffix = tr.b.Unit.nameSuffixForImprovementDirection(
          unit.improvementDirection);
      scalars.push({
        unit: tr.b.Unit.byName[`normalizedPercentageDelta${suffix}`],
        value: deltaValue / tr.b.math.RunningStatistics.fromDict(
            row.data[minRevision].statistics)[statistic],
      });
      scalars.push({
        unit,
        value: deltaValue,
      });
    }

    return {
      labelParts,
      scalars,
      label: row.label,
      actualDescriptors: row.data[minRevision].descriptors,
      testSuite: {
        errorMessage: 'Required',
        label: `Test suites (${testSuites.length})`,
        options: testSuites,
        query: '',
        required: true,
        selectedOptions: row.testSuites,
      },
      measurement: {
        errorMessage: 'Require exactly one',
        label: 'Measurement',
        options: [],
        query: '',
        requireSingle: true,
        required: true,
        selectedOptions: [row.measurement],
      },
      bot: {
        errorMessage: 'Required',
        label: 'Bots',
        options: [],
        query: '',
        required: true,
        selectedOptions: row.bots,
      },
      testCase: {
        label: 'Test cases',
        options: [],
        query: '',
        selectedOptions: row.testCases,
      },
    };
  };

  ReportSection.isValid = table => {
    if (!table) return false;
    if (!table.name) return false;
    if (!table.owners) return false;
    if (table.statistic.selectedOptions.length === 0) return false;
    for (const row of table.rows) {
      if (!row.label) return false;
      if (row.testSuite.selectedOptions.length === 0) return false;
      if (row.measurement.selectedOptions.length !== 1) return false;
      if (row.bot.selectedOptions.length === 0) return false;
    }
    return true;
  };

  cp.ElementBase.register(ReportSection);

  return {
    ReportSection,
  };
});
