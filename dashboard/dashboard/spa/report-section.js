/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  const CHROMIUM_MILESTONES = {
    54: [416640, 423768],
    55: [433391, 433400],
    56: [433400, 445288],
    57: [447949, 454466],
    58: [454523, 463842],
    59: [465221, 474839],
    60: [474952, 488392],
    61: [488576, 498621],
    62: [502840, 508578],
    63: [508578, 520719],
    64: [528754, 530282],
    65: [530424, 540240],
    66: [540302, 543346],
    67: [550534, 554765],
  };
  const CURRENT_MILESTONE = tr.b.math.Statistics.max(
      Object.keys(CHROMIUM_MILESTONES));
  const MIN_MILESTONE = tr.b.math.Statistics.min(
      Object.keys(CHROMIUM_MILESTONES));

  class ReportNamesRequest extends cp.RequestBase {
    get url_() {
      // The ReportHandler doesn't use this query parameter, but it helps caches
      // (such as the browser cache) understand that it returns different data
      // depending on whether the user is authorized to access internal data.
      const internal = this.headers_.has('Authorization');
      return '/api/report_names' + (internal ? '?internal' : '');
    }

    async localhostResponse_() {
      return [
        {name: cp.ReportSection.DEFAULT_NAME, id: 0, modified: 0},
      ];
    }
  }

  class ReportRequest extends cp.RequestBase {
    constructor(options) {
      super(options);
      this.id_ = options.id;
      this.name_ = options.name;
      this.modified_ = options.modified;
      this.revisions_ = options.revisions;
      this.queryParams_ = new URLSearchParams();
      this.queryParams_.set('id', this.id_);
      this.queryParams_.set('modified', this.modified_);
      this.queryParams_.set('revisions', this.revisions_);
    }

    get url_() {
      return `/api/report?${this.queryParams_}`;
    }

    async localhostResponse_() {
      const rows = [];
      const dummyRow = () => {
        const row = {
          testSuites: ['system_health.common_mobile'],
          bots: ['master:bot0', 'master:bot1', 'master:bot2'],
          testCases: [],
        };
        for (const revision of this.revisions_) {
          row[revision] = {
            avg: Math.random() * 1000,
            std: Math.random() * 1000,
          };
        }
        return row;
      };
      for (const group of ['Pixel', 'Android Go']) {
        rows.push({
          ...dummyRow(),
          label: group + ':Memory',
          units: 'sizeInBytes_smallerIsBetter',
          measurement: 'memory:a_size',
        });
        rows.push({
          ...dummyRow(),
          label: group + ':Loading',
          units: 'ms_smallerIsBetter',
          measurement: 'loading',
        });
        rows.push({
          ...dummyRow(),
          label: group + ':Startup',
          units: 'ms_smallerIsBetter',
          measurement: 'startup',
        });
        rows.push({
          ...dummyRow(),
          label: group + ':CPU',
          units: 'ms_smallerIsBetter',
          measurement: 'cpu:a',
        });
        rows.push({
          ...dummyRow(),
          label: group + ':Power',
          units: 'W_smallerIsBetter',
          measurement: 'power',
        });
      }

      return {
        name: this.name_,
        owners: ['benjhayden@chromium.org', 'benjhayden@google.com'],
        url: 'https://v2spa-dot-chromeperf.appspot.com/',
        statistics: ['avg', 'std'],
        rows,
      };
    }
  }

  class ReportTemplateRequest extends cp.RequestBase {
    constructor(options) {
      super(options);
      this.method_ = 'POST';
      this.headers_.set('Content-type', 'application/json');
      this.body_ = JSON.stringify({
        id: options.id,
        name: options.name,
        owners: options.owners,
        url: options.url,
        template: {
          statistics: options.statistics,
          rows: options.rows,
        },
      });
    }

    get url_() {
      return `/api/report`;
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

    async onSelectSource_(event) {
      event.cancelBubble = true;
      await this.dispatch('loadReports', this.statePath);
      if (this.source.selectedOptions.includes(ReportSection.CREATE)) {
        const name = this.shadowRoot.querySelector(
            'paper-input[label="Report Name"]');
        if (name) {
          name.focus();
        }
      }
    }

    async onPreviousMilestone_() {
      await this.dispatch('selectMilestone', this.statePath,
          this.milestone - 1);
    }

    async onNextMilestone_() {
      await this.dispatch('selectMilestone', this.statePath,
          this.milestone + 1);
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

    async onAddAlertsSection_() {
      this.dispatchEvent(new CustomEvent('alerts', {
        bubbles: true,
        composed: true,
        detail: {
          options: {
            reports: this.source.selectedOptions,
            minRevision: this.minRevision,
            maxRevision: this.maxRevision,
          },
        },
      }));
    }

    async onToggleEditing_(event) {
      await this.dispatch('toggleEditing', this.statePath,
          event.model.tableIndex);
      if (this.tables[event.model.tableIndex].isEditing) {
        this.shadowRoot.querySelector('paper-input').focus();
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
      event.cancelBubble = true;
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

    observeUserEmail_(newUserEmail, oldUserEmail) {
      if (oldUserEmail === undefined) return;
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
      return milestone > MIN_MILESTONE;
    }

    isNextMilestone_(milestone) {
      return milestone < CURRENT_MILESTONE;
    }
  }

  ReportSection.canEdit = (table, userEmail) =>
    (location.hostname === 'localhost') ||
    (table && table.owners && userEmail && table.owners.includes(userEmail));

  ReportSection.properties = {
    ...cp.ElementBase.statePathProperties('statePath', {
      anyAlerts: {type: Boolean},
      isLoading: {type: Boolean},
      milestone: {type: Number},
      minRevision: {type: Number},
      maxRevision: {type: Number},
      minRevisionInput: {type: Number},
      maxRevisionInput: {type: Number},
      sectionId: {type: String},
      source: {type: Object},
      tables: {type: Array},
    }),
    userEmail: {
      type: String,
      statePath: 'userEmail',
    },
    userEmail: {
      type: Object,
      statePath: 'userEmail',
      observer: 'observeUserEmail_',
    },
  };

  const DASHES = '-'.repeat(5);
  const PLACEHOLDER_TABLE = {
    name: DASHES,
    isPlaceholder: true,
    statistics: ['avg'],
    rows: [],
  };
  // Keep this the same shape as the default report so that the buttons don't
  // move when the default report loads.
  for (let i = 0; i < 2; ++i) {
    const scalars = [];
    for (let j = 0; j < 4 * PLACEHOLDER_TABLE.statistics.length; ++j) {
      scalars.push({value: 0, unit: tr.b.Unit.byName.count});
    }
    PLACEHOLDER_TABLE.rows.push({
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
        dispatch(ReportSection.actions.selectMilestone(
            statePath, state.milestone));
      }
      await dispatch(ReportSection.actions.loadSources(statePath));

      state = Polymer.Path.get(getState(), statePath);
      if (state.source.selectedOptions.length === 0) {
        dispatch(cp.DropdownInput.actions.focus(statePath + '.source'));
      }
    },

    authChange: statePath => async(dispatch, getState) => {
      dispatch(ReportSection.actions.loadSources(statePath));
    },

    selectMilestone: (statePath, milestone) => async(dispatch, getState) => {
      dispatch({
        type: ReportSection.reducers.selectMilestone.typeName,
        statePath,
        milestone,
      });
      dispatch(ReportSection.actions.loadReports(statePath));
    },

    restoreState: (statePath, options) => async(dispatch, getState) => {
      dispatch({
        type: ReportSection.reducers.restoreState.typeName,
        statePath,
        options,
      });
      dispatch(ReportSection.actions.loadReports(statePath));
    },

    toggleEditing: (statePath, tableIndex) => async(dispatch, getState) => {
      const rootState = getState();
      const state = Polymer.Path.get(rootState, statePath);
      const table = state.tables[tableIndex];
      if (table.canEdit !== true) {
        // TODO isLoading
        await dispatch(ReportSection.actions.renderEditForm(
            statePath, tableIndex));
      }
      dispatch(cp.ElementBase.actions.toggleBoolean(
          `${statePath}.tables.${tableIndex}.isEditing`));
    },

    loadSources: statePath => async(dispatch, getState) => {
      const request = new ReportNamesRequest({});
      const sources = await request.response;
      const rootState = getState();
      const filteredNames = await cp.TeamFilter.get(
          rootState.teamName).reportNames(sources.map(entity => entity.name));
      dispatch({
        type: ReportSection.reducers.receiveSources.typeName,
        statePath,
        sources,
        filteredNames,
      });
      dispatch(ReportSection.actions.loadReports(statePath));
    },

    loadReports: statePath => async(dispatch, getState) => {
      let rootState = getState();
      let state = Polymer.Path.get(rootState, statePath);
      let testSuites = [];
      if (state.source.selectedOptions.includes(ReportSection.CREATE)) {
        testSuites = await cp.TeamFilter.get(rootState.teamName).testSuites(
            await dispatch(cp.ReadTestSuites()));
      }
      dispatch({
        type: ReportSection.reducers.requestReports.typeName,
        statePath,
        testSuites,
      });

      const names = state.source.selectedOptions.filter(name =>
        name !== ReportSection.CREATE);
      const requestedReports = new Set(state.source.selectedOptions);
      const revisions = [state.minRevision, state.maxRevision];

      // If any report names are not in templateIds, early return, wait for
      // loadSources to finish and dispatch loadReports again.
      // TODO use a CacheBase subclass: loadReports is called from both
      // loadSources and restoreState, so the default report may be fetched
      // twice.
      const promises = [];
      for (const name of names) {
        const templateId = state.templateIds.get(name);
        if (templateId === undefined) return;
        promises.push(new ReportRequest({
          ...state.templateIds.get(name),
          revisions,
        }).response);
      }

      const batches = cp.RequestBase.batchResponses(promises);
      for await (const {results} of batches) {
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
              await dispatch(cp.ReadTestSuites()));
        }
        dispatch({
          type: ReportSection.reducers.receiveReports.typeName,
          statePath,
          reports: results,
          testSuites,
        });
        // dispatch(ReportSection.actions.renderEditForms(statePath));
        // dispatch(ReportSection.actions.prefetchCharts(statePath));
      }
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
          await dispatch(cp.ChartSection.actions.describeTestSuites(
              `${statePath}.tables.${tableIndex}.rows.${rowIndex}`));
        }));
        dispatch(cp.ElementBase.actions.updateObject(
            `${statePath}.tables.${tableIndex}`, {canEdit: true}));
      })();
      dispatch(cp.ElementBase.actions.updateObject(
          `${statePath}.tables.${tableIndex}`, {canEdit: promise}));
      await promise;
    },

    renderEditForms: statePath => async(dispatch, getState) => {
      const state = Polymer.Path.get(getState(), statePath);
      await Promise.all(state.tables.map(async(table, tableIndex) => {
        await cp.ElementBase.idlePeriod();
        await dispatch(ReportSection.actions.renderEditForm(
            statePath, tableIndex));
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
        await cp.ElementBase.idlePeriod();
        await dispatch(cp.ChartTimeseries.actions.prefetch(
            statePath, lineDescriptors.slice(i, i + 5)));
      }
    },

    templateName: (statePath, tableIndex, name) =>
      async(dispatch, getState) => {
        dispatch(cp.ElementBase.actions.updateObject(
            `${statePath}.tables.${tableIndex}`, {name}));
      },

    templateOwners: (statePath, tableIndex, owners) =>
      async(dispatch, getState) => {
        dispatch(cp.ElementBase.actions.updateObject(
            `${statePath}.tables.${tableIndex}`, {owners}));
      },

    templateUrl: (statePath, tableIndex, url) =>
      async(dispatch, getState) => {
        dispatch(cp.ElementBase.actions.updateObject(
            `${statePath}.tables.${tableIndex}`, {url}));
      },

    templateRowLabel: (statePath, tableIndex, rowIndex, label) =>
      async(dispatch, getState) => {
        dispatch(cp.ElementBase.actions.updateObject(
            `${statePath}.tables.${tableIndex}.rows.${rowIndex}`,
            {label}));
      },

    templateTestSuite: (statePath, tableIndex, rowIndex) =>
      async(dispatch, getState) => {
        dispatch(cp.ChartSection.actions.describeTestSuites(
            `${statePath}.tables.${tableIndex}.rows.${rowIndex}`));
      },

    templateRemoveRow: (statePath, tableIndex, rowIndex) =>
      async(dispatch, getState) => {
        dispatch({
          type: ReportSection.reducers.templateRemoveRow.typeName,
          statePath,
          tableIndex,
          rowIndex,
        });
      },

    templateAddRow: (statePath, tableIndex, rowIndex) =>
      async(dispatch, getState) => {
        dispatch({
          type: ReportSection.reducers.templateAddRow.typeName,
          statePath: `${statePath}.tables.${tableIndex}`,
          rowIndex,
          testSuites: await dispatch(cp.ReadTestSuites()),
        });
        dispatch(cp.ChartSection.actions.describeTestSuites(
            `${statePath}.tables.${tableIndex}.rows.${rowIndex + 1}`));
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
      dispatch(cp.ElementBase.actions.updateObject(statePath, {
        isLoading: true,
      }));
      const response = await request.response;
      // TODO handle renaming templates
      const sources = [...state.templateIds.values(), response];
      sources.sort((a, b) => a.name.localeCompare(b.name));
      const filteredNames = await cp.TeamFilter.get(
          rootState.teamName).reportNames(sources.map(entity => entity.name));
      dispatch({
        type: ReportSection.reducers.receiveSources.typeName,
        statePath,
        sources,
        filteredNames,
      });
      rootState = getState();
      state = Polymer.Path.get(rootState, statePath);
      dispatch(cp.ElementBase.actions.updateObject(statePath, {
        isLoading: false,
        source: {
          ...state.source,
          selectedOptions: [response.name],
        },
      }));
      dispatch(ReportSection.actions.loadReports(statePath));
    },

    setMinRevision: (statePath, minRevisionInput) =>
      async(dispatch, getState) => {
        dispatch(cp.ElementBase.actions.updateObject(statePath, {
          minRevisionInput,
        }));
        if (!minRevisionInput.match(/^\d{6}$/)) return;
        dispatch(cp.ElementBase.actions.updateObject(statePath, {
          minRevision: minRevisionInput,
        }));
        dispatch(ReportSection.actions.loadReports(statePath));
      },

    setMaxRevision: (statePath, maxRevisionInput) =>
      async(dispatch, getState) => {
        dispatch(cp.ElementBase.actions.updateObject(statePath, {
          maxRevisionInput,
        }));
        if (!maxRevisionInput.match(/^\d{6}$/)) return;
        dispatch(cp.ElementBase.actions.updateObject(statePath, {
          maxRevision: maxRevisionInput,
        }));
        dispatch(ReportSection.actions.loadReports(statePath));
      },
  };

  ReportSection.reducers = {
    selectMilestone: (state, action, rootState) => {
      const [minRevision, maxRevision] = CHROMIUM_MILESTONES[action.milestone];
      return {
        ...state,
        minRevision,
        maxRevision,
        minRevisionInput: minRevision,
        maxRevisionInput: maxRevision,
        milestone: action.milestone,
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
        milestone: parseInt(action.options.milestone),
        minRevision: action.options.minRevision,
        maxRevision: action.options.maxRevision,
        minRevisionInput: action.options.minRevision,
        maxRevisionInput: action.options.maxRevision,
      };
    },

    receiveSources: (state, action, rootState) => {
      const templateIds = new Map(action.sources.map(entity =>
        [entity.name, entity]));
      const source = {...state.source};
      source.options = cp.OptionGroup.groupValues(action.filteredNames);
      if (location.hostname === 'localhost' || rootState.userEmail) {
        source.options.push(ReportSection.CREATE);
      }
      source.label = `Reports (${action.sources.length})`;
      return {...state, source, templateIds};
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

        const rows = report.rows.map(row => ReportSection.transformReportRow(
            row, state.minRevision, state.maxRevision, report.statistics,
            action.testSuites));

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
            selectedOptions: report.statistics,
            required: true,
          },
        });
      }
      return {
        ...state,
        isLoading: false,
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
        errorMessage: 'required',
        query: '',
        required: true,
        selectedOptions: testSuite.selectedOptions || [],
      },
      measurement: {
        errorMessage: 'require exactly one',
        label: 'Measurement',
        options: [],
        query: '',
        requireSingle: true,
        required: true,
        selectedOptions: [],
      },
      bot: {
        errorMessage: 'required',
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

  ReportSection.newStateOptionsFromQueryParams = queryParams => {
    const options = {
      sources: queryParams.getAll('report'),
      milestone: parseInt(queryParams.get('m')) || undefined,
      minRevision: parseInt(queryParams.get('minRev')) || undefined,
      maxRevision: parseInt(queryParams.get('maxRev')) || undefined,
    };
    if (options.maxRevision < options.minRevision) {
      [options.maxRevision, options.minRevision] = [
        options.minRevision, options.maxRevision];
    }
    if (options.milestone === undefined &&
        options.minRevision !== undefined &&
        options.maxRevision !== undefined) {
      const paramRevisions = tr.b.math.Range.fromExplicitRange(
          options.minRevision, options.maxRevision);
      // Find the milestone that most intersects paramRevisions;
      let largestIntersection = -1;
      for (const [milestone, milestoneRevisions] of Object.entries(
          CHROMIUM_MILESTONES)) {
        const intersection = paramRevisions.findIntersection(
            tr.b.math.Range.fromExplicitRange(...milestoneRevisions)).range;
        if (intersection < largestIntersection) break;
        largestIntersection = intersection;
        options.milestone = milestone;
      }
    }
    return options;
  };

  ReportSection.newState = options => {
    const sources = options.sources ? options.sources : [
      ReportSection.DEFAULT_NAME,
    ];
    return {
      isLoading: false,
      source: {
        label: 'Reports (loading)',
        options: [
          ReportSection.DEFAULT_NAME,
          ReportSection.CREATE,
        ],
        query: '',
        selectedOptions: sources,
      },
      templateIds: new Map(),
      milestone: parseInt(options.milestone) || CURRENT_MILESTONE,
      minRevision: options.minRevision,
      maxRevision: options.maxRevision,
      minRevisionInput: options.minRevision,
      maxRevisionInput: options.maxRevision,
      anyAlerts: false,
      tables: [PLACEHOLDER_TABLE],
    };
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

  ReportSection.transformReportRow = (
      row, minRevision, maxRevision, statistics, testSuites) => {
    const origin = location.origin + '#';
    const labelParts = row.label.split(':').map(label => {
      return {
        href: origin + new URLSearchParams('TODO'),
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

    const scalars = [];
    for (const revision of [minRevision, maxRevision]) {
      for (const statistic of statistics) {
        const unit = (statistic === 'count') ? tr.b.Unit.byName.count :
          rowUnit;
        let unitPrefix;
        if (rowUnit.baseUnit === tr.b.Unit.byName.sizeInBytes) {
          unitPrefix = tr.b.UnitPrefixScale.BINARY.KIBI;
        }
        scalars.push({
          unit,
          unitPrefix,
          value: row[revision][statistic],
        });
      }
    }
    for (const statistic of statistics) {
      const unit = ((statistic === 'count') ? tr.b.Unit.byName.count :
        rowUnit).correspondingDeltaUnit;
      const deltaValue = (
        row[maxRevision][statistic] -
        row[minRevision][statistic]);
      const suffix = tr.b.Unit.nameSuffixForImprovementDirection(
          unit.improvementDirection);
      scalars.push({
        unit: tr.b.Unit.byName[`normalizedPercentageDelta${suffix}`],
        value: deltaValue / row[minRevision][statistic],
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
      testSuite: {
        errorMessage: 'required',
        label: `Test suites (${testSuites.count})`,
        options: testSuites.options,
        query: '',
        required: true,
        selectedOptions: row.testSuites,
      },
      measurement: {
        errorMessage: 'require exactly one',
        label: 'Measurement',
        options: [],
        query: '',
        requireSingle: true,
        required: true,
        selectedOptions: [row.measurement],
      },
      bot: {
        errorMessage: 'required',
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
