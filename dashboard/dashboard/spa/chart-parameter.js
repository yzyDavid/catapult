/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ChartParameter extends cp.ElementBase {
    isMultiple_(ary) {
      return ary.length > 1;
    }

    onAggregateChange_(event) {
      this.dispatch('toggleAggregate', this.statePath);
      this.dispatchEvent(new CustomEvent('aggregate'));
    }

    onTagSelect_(event) {
      this.dispatch('tagFilter', this.statePath);
    }
  }

  ChartParameter.properties = cp.ElementBase.statePathProperties('statePath', {
    canAggregate: {type: Boolean},
    isAggregated: {type: Boolean},
    tags: {type: Object},
    selectedOptions: {type: Array},
  });

  ChartParameter.actions = {
    tagFilter: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartParameter.reducers.tagFilter.name,
        statePath,
      });
    },

    toggleAggregate: (statePath, isAggregated) => async(dispatch, getState) => {
      cp.ElementBase.actions.toggleBoolean(
          `${statePath}.isAggregated`)(dispatch, getState);
    },
  };

  ChartParameter.reducers = {
    tagFilter: state => {
      const testCases = new Set(state.optionValues);
      if (state.tags.selectedOptions.length) {
        testCases.clear();
        for (const tag of state.tags.selectedOptions) {
          for (const testCase of state.tags.map.get(tag)) {
            testCases.add(testCase);
          }
        }
      }
      const options = [
        {
          label: `All test cases`,
          isExpanded: true,
          options: cp.OptionGroup.groupValues(testCases),
        },
      ];
      return {...state, options};
    },
  };

  cp.ElementBase.register(ChartParameter);

  return {
    ChartParameter,
  };
});
