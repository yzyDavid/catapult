/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class TriageExisting extends cp.ElementBase {
    ready() {
      super.ready();
      this.addEventListener('blur', this.onBlur_.bind(this));
      this.addEventListener('keyup', this.onKeyup_.bind(this));
      this.style.minWidth = (window.innerWidth * 0.6) + 'px';
    }

    async onKeyup_(event) {
      if (event.key === 'Escape') {
        await this.dispatch('close', this.statePath);
      }
    }

    filterBugs_(recentPerformanceBugs, onlyIntersectingBugs, selectedRange) {
      return TriageExisting.filterBugs(
          recentPerformanceBugs, onlyIntersectingBugs, selectedRange);
    }

    isIdValid_(bugId) {
      return bugId && bugId.match(/^\d+$/) !== null;
    }

    async onSubmit_(event) {
      await this.dispatch('close', this.statePath);
      this.dispatchEvent(new CustomEvent('submit', {
        bubbles: true,
        composed: true,
      }));
    }

    async onBlur_(event) {
      if (event.relatedTarget === this ||
          cp.isElementChildOf(event.relatedTarget, this)) {
        this.$.bug_input.focus();
        return;
      }
      await this.dispatch('close', this.statePath);
    }

    observeIsOpen_() {
      if (this.isOpen) {
        this.$.bug_input.focus();
      }
    }

    async onToggleOnlyIntersectingBugs_(event) {
      await this.dispatch('toggleOnlyIntersectingBugs', this.statePath);
    }

    async onRecentPerformanceBugTap_(event) {
      await this.dispatch('recentPerformanceBug', this.statePath,
          event.model.bug.id);
      this.$.bug_input.focus();
    }

    async onIdKeyup_(event) {
      if (event.key === 'Enter' && this.isIdValid_(this.bugId)) {
        this.onSubmit_(event);
        return;
      }
      await this.dispatch('recentPerformanceBug', this.statePath,
          event.target.value);
    }
  }

  TriageExisting.properties = {
    ...cp.ElementBase.statePathProperties('statePath', {
      bugId: {type: String},
      isOpen: {
        type: Boolean,
        reflectToAttribute: true,
        observer: 'observeIsOpen_',
      },
      onlyIntersectingBugs: {type: Boolean},
      selectedRange: {type: Object},
    }),
    recentPerformanceBugs: {
      type: Array,
      statePath: 'recentPerformanceBugs',
    },
  };

  TriageExisting.DEFAULT_STATE = {
    bugId: '',
    isOpen: false,
    onlyIntersectingBugs: true,
    recentPerformanceBugs: [],
    selectedRange: undefined,
  };

  TriageExisting.openState = selectedAlerts => {
    const selectedRange = new tr.b.math.Range();
    for (const alert of selectedAlerts) {
      selectedRange.addValue(alert.startRevision);
      selectedRange.addValue(alert.endRevision);
    }
    return {
      isOpen: true,
      bugId: '',
      selectedRange,
    };
  };

  TriageExisting.actions = {
    toggleOnlyIntersectingBugs: statePath => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.toggleBoolean(
          `${statePath}.onlyIntersectingBugs`));
    },

    recentPerformanceBug: (statePath, bugId) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.updateObject(statePath, {bugId}));
    },

    close: statePath => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.toggleBoolean(`${statePath}.isOpen`));
    },

    submit: statePath => async(dispatch, getState) => {
    },
  };

  TriageExisting.filterBugs =
    (recentPerformanceBugs, onlyIntersectingBugs, selectedRange) => {
      if (!recentPerformanceBugs || !selectedRange) return [];
      if (!onlyIntersectingBugs) return recentPerformanceBugs;
      return recentPerformanceBugs.filter(bug =>
        bug.revisionRange.intersectsRangeInclusive(selectedRange));
    };


  cp.ElementBase.register(TriageExisting);

  return {
    TriageExisting,
  };
});
