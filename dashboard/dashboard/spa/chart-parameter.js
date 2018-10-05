/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ChartParameter extends cp.ElementBase {
    onAggregateChange_(event) {
      this.dispatch('toggleAggregate', this.statePath);
      this.dispatchEvent(new CustomEvent('aggregate'));
    }

    onTagSelect_(event) {
      this.dispatch('tagFilter', this.statePath);
    }
  }

  ChartParameter.State = {
    ...cp.MenuInput.State,
    canAggregate: options => options.canAggregate || false,
    isAggregated: options => options.isAggregated || false,
    tags: options => cp.OptionGroup.buildState(options.tags || {}),
  };

  ChartParameter.properties = cp.buildProperties('state', ChartParameter.State);
  ChartParameter.buildState = options => cp.buildState(
      ChartParameter.State, options);

  ChartParameter.actions = {
    tagFilter: statePath => async(dispatch, getState) => {
      dispatch({
        type: ChartParameter.reducers.tagFilter.name,
        statePath,
      });
    },

    toggleAggregate: (statePath, isAggregated) => async(dispatch, getState) => {
      dispatch(Redux.TOGGLE(`${statePath}.isAggregated`));
    },
  };

  ChartParameter.reducers = {
    tagFilter: state => {
      const testCases = new Set(state.optionValues);
      if (state.tags && state.tags.selectedOptions &&
          state.tags.selectedOptions.length) {
        testCases.clear();
        for (const tag of state.tags.selectedOptions) {
          const tagCases = state.tags.map.get(tag);
          if (!tagCases) continue;
          for (const testCase of tagCases) {
            testCases.add(testCase);
          }
        }
      }
      const options = [];
      if (testCases.size) {
        options.push({
          label: `All test cases`,
          isExpanded: true,
          options: cp.OptionGroup.groupValues(testCases),
        });
      }
      return {...state, options};
    },
  };

  cp.ElementBase.register(ChartParameter);

  return {
    ChartParameter,
  };
});
