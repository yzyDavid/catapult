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
  }

  ChartParameter.properties = cp.ElementBase.statePathProperties('statePath', {
    canAggregate: {type: Boolean},
    isAggregated: {type: Boolean},
    tags: {type: Object},
    selectedOptions: {type: Array},
  });

  ChartParameter.actions = {
    toggleAggregate: (statePath, isAggregated) => async(dispatch, getState) => {
      dispatch(cp.ElementBase.actions.toggleBoolean(
          `${statePath}.isAggregated`));
    },
  };

  cp.ElementBase.register(ChartParameter);

  return {
    ChartParameter,
  };
});
