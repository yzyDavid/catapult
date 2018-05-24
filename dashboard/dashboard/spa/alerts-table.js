/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class AlertsTable extends cp.ElementBase {
    ready() {
      super.ready();
      this.scrollIntoView(true);
    }

    anySelectedAlerts_(alertGroups) {
      return cp.AlertsSection.getSelectedAlerts(alertGroups).length > 0;
    }

    selectedCount_(alertGroup) {
      if (!alertGroup) return '';
      if (alertGroup.alerts.length === 1) return '';
      let count = 0;
      for (const alert of alertGroup.alerts) {
        if (alert.isSelected) ++count;
      }
      if (count === 0) return '';
      return `${count}/${alertGroup.alerts.length}`;
    }

    alertRevisionString_(alert) {
      if (alert.startRevision === alert.endRevision) return alert.startRevision;
      return alert.startRevision + '-' + alert.endRevision;
    }

    alertRevisionHref_(alert) {
      if (alert.master === 'ChromiumPerf') return `http://test-results.appspot.com/revision_range?start=${alert.startRevision}&end=${alert.endRevision}&n=1000`;
      return '';
    }

    breakWords_(str) {
      return cp.AlertsSection.breakWords(str);
    }

    shouldDisplayAlert_(alertGroup, alertIndex) {
      return alertGroup.isExpanded || (alertIndex === 0);
    }

    shouldDisplayExpandGroupButton_(alertGroup, alertIndex) {
      if (alertIndex !== 0) return false;
      return alertGroup.alerts.length > 1;
    }

    isAlertIgnored_(bugId) {
      return bugId <= 0;
    }

    onSelectAll_(event) {
      event.target.checked = !event.target.checked;
      this.dispatch('selectAllAlerts', this.statePath);
      this.dispatchEvent(new CustomEvent('selected', {
        bubbles: true,
        composed: true,
      }));
    }

    onSelect_(event) {
      this.dispatch('selectAlert', this.statePath,
          event.model.parentModel.alertGroupIndex,
          event.model.alertIndex,
          event.detail.sourceEvent.shiftKey);
      this.dispatchEvent(new CustomEvent('selected', {
        bubbles: true,
        composed: true,
      }));
      document.getSelection().removeAllRanges();
    }

    onSort_(event) {
      this.dispatch('sort', this.statePath, event.target.name);
      this.dispatchEvent(new CustomEvent('sort', {
        bubbles: true,
        composed: true,
      }));
    }

    onRowTap_(event) {
      if (event.target.tagName !== 'TD') return;
      this.dispatchEvent(new CustomEvent('select-alert', {
        bubbles: true,
        composed: true,
        detail: {
          alertGroupIndex: event.model.alertGroupIndex,
          alertIndex: event.model.alertIndex,
        },
      }));
    }
  }

  AlertsTable.properties = cp.ElementBase.statePathProperties('statePath', {
    alertGroups: {type: Array},
    areAlertGroupsPlaceholders: {type: Boolean},
    showBugColumn: {type: Boolean},
    showMasterColumn: {type: Boolean},
    showTestCaseColumn: {type: Boolean},
    sortColumn: {type: String},
    sortDescending: {type: Boolean},
    tableHeightPx: {type: Number},
  });

  AlertsTable.actions = {
    selectAllAlerts: statePath => async(dispatch, getState) => {
      dispatch({
        type: AlertsTable.reducers.selectAllAlerts.typeName,
        statePath,
      });
    },

    selectAlert: (statePath, alertGroupIndex, alertIndex, shiftKey) =>
      async(dispatch, getState) => {
        dispatch({
          type: AlertsTable.reducers.selectAlert.typeName,
          statePath,
          alertGroupIndex,
          alertIndex,
          shiftKey,
        });
      },

    sort: (statePath, sortColumn) => async(dispatch, getState) => {
      dispatch({
        type: AlertsTable.reducers.sort.typeName,
        statePath,
        sortColumn,
      });
    },
  };

  AlertsTable.reducers = {
    sort: (state, action, rootState) => {
      const sortDescending = state.sortDescending ^ (state.sortColumn ===
          action.sortColumn);
      const alertGroups = cp.AlertsSection.sortGroups(
          state.alertGroups, action.sortColumn, sortDescending);
      return {
        ...state,
        sortColumn: action.sortColumn,
        sortDescending,
        alertGroups,
      };
    },

    selectAlert: (state, action, rootState) => {
      let alertGroups = state.alertGroups;
      const alertGroup = alertGroups[action.alertGroupIndex];
      let alerts = alertGroup.alerts;
      const alert = alerts[action.alertIndex];
      const isSelected = !alert.isSelected;

      if (action.shiftKey) {
        // [De]select all alerts between previous selected alert and |alert|.
        // Deep-copy alerts so that we can freely modify them.
        // Copy references to individual alerts out of their groups to reflect
        // the flat list of checkboxes that the user sees.
        const flatList = [];
        alertGroups = alertGroups.map(g => {
          return {
            ...g,
            alerts: g.alerts.map(a => {
              const clone = {...a};
              flatList.push(clone);
              return clone;
            }),
          };
        });
        // Find the indices of the previous selected alert and |alert| in
        // flatList.
        const indices = new tr.b.math.Range();
        const keys = [state.previousSelectedAlertKey, alert.key];
        for (let i = 0; i < flatList.length; ++i) {
          if (keys.includes(flatList[i].key)) indices.addValue(i);
        }
        if (state.previousSelectedAlertKey === undefined) indices.addValue(0);
        // Set isSelected for all alerts that appear in the table between the
        // previous selected alert and |alert|.
        for (let i = indices.min; i <= indices.max; ++i) {
          flatList[i].isSelected = isSelected;
        }
      } else {
        if (!alertGroup.isExpanded && (action.alertIndex === 0)) {
          // Toggle all alerts in this group
          alerts = alerts.map(alert => {
            return {
              ...alert,
              isSelected,
            };
          });
        } else {
          // Only toggle this alert.
          alerts = Polymer.Path.setImmutable(
              alerts, `${action.alertIndex}.isSelected`, isSelected);
        }

        alertGroups = Polymer.Path.setImmutable(
            state.alertGroups, `${action.alertGroupIndex}.alerts`, alerts);
      }

      const selectedAlertsCount = cp.AlertsSection.getSelectedAlerts(
          alertGroups).length;
      return {
        ...state,
        alertGroups,
        previousSelectedAlertKey: alert.key,
        selectedAlertsCount,
      };
    },

    selectAllAlerts: (state, action, rootState) => {
      const select = (state.selectedAlertsCount === 0);
      const alertGroups = state.alertGroups.map(alertGroup => {
        return {
          ...alertGroup,
          alerts: alertGroup.alerts.map(alert => {
            return {
              ...alert,
              isSelected: select,
            };
          }),
        };
      });
      return {
        ...state,
        alertGroups,
        selectedAlertsCount: cp.AlertsSection.getSelectedAlerts(
            alertGroups).length,
      };
    },
  };

  cp.ElementBase.register(AlertsTable);

  return {
    AlertsTable,
  };
});
