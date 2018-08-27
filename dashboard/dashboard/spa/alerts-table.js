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

    getTableHeightPx_() {
      return Math.max(122, window.innerHeight - 483);
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

    allTriaged_(alertGroups, showingTriaged) {
      if (showingTriaged) return alertGroups.length === 0;
      return alertGroups.filter(group =>
        group.alerts.length > group.triaged.count).length === 0;
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

    isExpandedGroup_(groupIsExpanded, triagedIsExpanded) {
      return groupIsExpanded || triagedIsExpanded;
    }

    shouldDisplayAlert_(
        areAlertGroupsPlaceholders, showingTriaged, alertGroup, alertIndex,
        triagedExpanded) {
      if (areAlertGroupsPlaceholders) return true;
      if (showingTriaged) return alertGroup.isExpanded || (alertIndex === 0);

      if (!alertGroup.alerts[alertIndex]) return false;
      const isTriaged = alertGroup.alerts[alertIndex].bugId;
      const firstUntriagedIndex = alertGroup.alerts.findIndex(a => !a.bugId);
      if (alertGroup.isExpanded) {
        return !isTriaged || triagedExpanded || (
          alertIndex === firstUntriagedIndex);
      }
      if (isTriaged) return triagedExpanded;
      return alertIndex === firstUntriagedIndex;
    }

    shouldDisplayExpandGroupButton_(
        alertGroup, alertIndex, showingTriaged, sortColumn, sortDescending) {
      if (showingTriaged) {
        return (alertIndex === 0) && alertGroup.alerts.length > 1;
      }
      return (alertIndex === alertGroup.alerts.findIndex(a => !a.bugId)) && (
        alertGroup.alerts.length > (1 + alertGroup.triaged.count));
    }

    getExpandGroupButtonLabel_(alertGroup, showingTriaged) {
      if (showingTriaged) return alertGroup.alerts.length;
      return alertGroup.alerts.length - alertGroup.triaged.count;
    }

    shouldDisplayExpandTriagedButton_(
        showingTriaged, alertGroup, alertIndex, sortColumn, sortDescending) {
      if (showingTriaged || (alertGroup.triaged.count === 0)) return false;
      return alertIndex === alertGroup.alerts.findIndex(a => !a.bugId);
    }

    shouldDisplaySelectedCount_(
        showingTriaged, alertGroup, alertIndex, sortColumn, sortDescending) {
      if (showingTriaged) return alertIndex === 0;
      return alertIndex === alertGroup.alerts.findIndex(a => !a.bugId);
    }

    isAlertIgnored_(bugId) {
      return bugId < 0;
    }

    async onSelectAll_(event) {
      event.target.checked = !event.target.checked;
      await this.dispatch('selectAllAlerts', this.statePath);
      this.dispatchEvent(new CustomEvent('selected', {
        bubbles: true,
        composed: true,
      }));
    }

    async onSelect_(event) {
      await this.dispatch('selectAlert', this.statePath,
          event.model.parentModel.alertGroupIndex,
          event.model.alertIndex,
          event.shiftKey);
      this.dispatchEvent(new CustomEvent('selected', {
        bubbles: true,
        composed: true,
      }));
      document.getSelection().removeAllRanges();
    }

    async onSort_(event) {
      await this.dispatch('sort', this.statePath, event.target.name);
      this.dispatchEvent(new CustomEvent('sort', {
        bubbles: true,
        composed: true,
      }));
    }

    async onRowTap_(event) {
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

  AlertsTable.PLACEHOLDER_ALERT_GROUPS = [];
  const DASHES = '-'.repeat(5);
  for (let i = 0; i < 5; ++i) {
    AlertsTable.PLACEHOLDER_ALERT_GROUPS.push({
      isSelected: false,
      triaged: {
        count: 0,
        isExpanded: false,
      },
      alerts: [
        {
          bugId: DASHES,
          revisions: DASHES,
          testSuite: DASHES,
          measurement: DASHES,
          master: DASHES,
          bot: DASHES,
          testCase: DASHES,
          deltaValue: 0,
          deltaUnit: tr.b.Unit.byName.countDelta_biggerIsBetter,
          percentDeltaValue: 0,
          percentDeltaUnit:
            tr.b.Unit.byName.normalizedPercentageDelta_biggerIsBetter,
        },
      ],
    });
  }

  AlertsTable.State = {
    previousSelectedAlertKey: options => undefined,
    alertGroups: options => AlertsTable.PLACEHOLDER_ALERT_GROUPS,
    areAlertGroupsPlaceholders: options => true,
    showBugColumn: options => true,
    showMasterColumn: options => true,
    showTestCaseColumn: options => true,
    showTriagedColumn: options => true,
    showingTriaged: options => options.showingTriaged || false,
    sortColumn: options => options.sortColumn || 'revisions',
    sortDescending: options => options.sortDescending || false,
  };

  AlertsTable.properties = cp.buildProperties('state', AlertsTable.State);
  AlertsTable.buildState = options => cp.buildState(AlertsTable.State, options);

  AlertsTable.actions = {
    selectAllAlerts: statePath => async(dispatch, getState) => {
      dispatch({
        type: AlertsTable.reducers.selectAllAlerts.name,
        statePath,
      });
    },

    selectAlert: (statePath, alertGroupIndex, alertIndex, shiftKey) =>
      async(dispatch, getState) => {
        dispatch({
          type: AlertsTable.reducers.selectAlert.name,
          statePath,
          alertGroupIndex,
          alertIndex,
          shiftKey,
        });
      },

    sort: (statePath, sortColumn) => async(dispatch, getState) => {
      dispatch({
        type: AlertsTable.reducers.sort.name,
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
        let toggleAll = false;
        if (!alertGroup.isExpanded) {
          if (state.showingTriaged) {
            toggleAll = action.alertIndex === 0;
          } else {
            toggleAll = action.alertIndex === alertGroup.alerts.findIndex(
                a => !a.bugId);
          }
        }
        if (toggleAll) {
          alerts = alerts.map(alert => {
            return {
              ...alert,
              isSelected,
            };
          });
        } else {
          // Only toggle this alert.
          alerts = cp.setImmutable(
              alerts, `${action.alertIndex}.isSelected`, isSelected);
        }

        alertGroups = cp.setImmutable(
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
