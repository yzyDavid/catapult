/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class TriageNew extends cp.ElementBase {
    ready() {
      super.ready();
      this.addEventListener('blur', this.onBlur_.bind(this));
      this.addEventListener('keyup', this.onKeyup_.bind(this));
    }

    async onKeyup_(event) {
      if (event.key === 'Escape') {
        await this.dispatch('close', this.statePath);
      }
    }

    async onBlur_(event) {
      await this.dispatch('close', this.statePath);
    }

    observeIsOpen_() {
      if (this.isOpen) {
        this.$.description.focus();
      }
    }

    async onSummary_(event) {
      await this.dispatch('summary', this.statePath, event.target.value);
    }

    async onDescription_(event) {
      if (event.ctrlKey && (event.key === 'Enter')) {
        await this.onSubmit_(event);
        return;
      }
      await this.dispatch('description', this.statePath, event.target.value);
    }

    async onLabel_(event) {
      await this.dispatch('label', this.statePath, event.model.label.name);
    }

    async onComponent_(event) {
      await this.dispatch('component', this.statePath,
          event.model.component.name);
    }

    async onOwner_(event) {
      await this.dispatch('owner', this.statePath, event.target.value);
    }

    async onCC_(event) {
      await this.dispatch('cc', this.statePath, event.target.value);
    }

    async onSubmit_(event) {
      await this.dispatch('close', this.statePath);
      this.dispatchEvent(new CustomEvent('submit', {
        bubbles: true,
        composed: true,
      }));
    }
  }

  TriageNew.properties = cp.ElementBase.statePathProperties('statePath', {
    cc: {type: String},
    components: {type: Array},
    description: {type: String},
    isOpen: {
      type: Boolean,
      reflectToAttribute: true,
      observer: 'observeIsOpen_',
    },
    labels: {type: Array},
    owner: {type: String},
    summary: {type: String},
  });

  TriageNew.actions = {
    close: statePath => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(
          statePath, {isOpen: false}));
    },

    summary: (statePath, summary) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(statePath, {summary}));
    },

    owner: (statePath, owner) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(statePath, {owner}));
    },

    cc: (statePath, cc) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(statePath, {cc}));
    },

    description: (statePath, description) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(statePath, {description}));
    },

    label: (statePath, name) => async(dispatch, getState) => {
      dispatch({
        type: TriageNew.reducers.toggleLabel.typeName,
        statePath,
        name,
      });
    },

    component: (statePath, name) => async(dispatch, getState) => {
      dispatch({
        type: TriageNew.reducers.toggleComponent.typeName,
        statePath,
        name,
      });
    },
  };

  TriageNew.reducers = {
    toggleLabel: (state, action, rootState) => {
      for (let i = 0; i < state.labels.length; ++i) {
        if (state.labels[i].name === action.name) {
          return Polymer.Path.setImmutable(
              state, `labels.${i}.isEnabled`, e => !e);
        }
      }
      return state;
    },

    toggleComponent: (state, action, rootState) => {
      for (let i = 0; i < state.components.length; ++i) {
        if (state.components[i].name === action.name) {
          return Polymer.Path.setImmutable(
              state, `components.${i}.isEnabled`, e => !e);
        }
      }
      return state;
    },
  };

  TriageNew.newState = (alerts, userEmail) => {
    return {
      cc: userEmail,
      components: TriageNew.collectComponents(alerts),
      description: '',
      isOpen: true,
      labels: TriageNew.collectLabels(alerts),
      owner: '',
      summary: TriageNew.summarize(alerts),
    };
  };

  TriageNew.summarize = alerts => {
    const pctDeltaRange = new tr.b.math.Range();
    const revisionRange = new tr.b.math.Range();
    let measurements = new Set();
    for (const alert of alerts) {
      if (!alert.improvement) {
        pctDeltaRange.addValue(Math.abs(100 * alert.percentDeltaValue));
      }
      // TODO handle non-numeric revisions
      revisionRange.addValue(alert.startRevision);
      revisionRange.addValue(alert.endRevision);
      measurements.add(alert.measurement);
    }
    measurements = Array.from(measurements);
    measurements.sort((x, y) => x.localeCompare(y));
    measurements = measurements.join(',');

    let pctDeltaString = pctDeltaRange.min.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    }) + '%';
    if (pctDeltaRange.min !== pctDeltaRange.max) {
      pctDeltaString += '-' + pctDeltaRange.max.toLocaleString(undefined, {
        maximumFractionDigits: 1,
      }) + '%';
    }

    let revisionString = revisionRange.min;
    if (revisionRange.min !== revisionRange.max) {
      revisionString += ':' + revisionRange.max;
    }

    return (
      `${pctDeltaString} regression in ${measurements} at ${revisionString}`
    );
  };

  TriageNew.collectLabels = alerts => {
    let labels = new Set();
    labels.add('Pri-2');
    labels.add('Type-Bug-Regression');
    for (const alert of alerts) {
      for (const label of alert.bugLabels) {
        labels.add(label);
      }
    }
    labels = Array.from(labels);
    labels.sort((x, y) => x.localeCompare(y));
    return labels.map(name => {
      return {
        isEnabled: true,
        name,
      };
    });
  };

  TriageNew.collectComponents = alerts => {
    let components = new Set();
    for (const alert of alerts) {
      for (const component of alert.bugComponents) {
        components.add(component);
      }
    }
    components = Array.from(components);
    components.sort((x, y) => x.localeCompare(y));
    return components.map(name => {
      return {
        isEnabled: true,
        name,
      };
    });
  };

  cp.ElementBase.register(TriageNew);

  return {
    TriageNew,
  };
});
