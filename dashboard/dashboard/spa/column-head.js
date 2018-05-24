/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ColumnHead extends cp.ElementBase {
    getIcon_(name, sortColumn, sortDescending) {
      if (name !== sortColumn) return '';
      return sortDescending ? 'arrow-downward' : 'arrow-upward';
    }
  }

  ColumnHead.properties = {
    name: {
      type: String,
      value: '',
    },
    sortColumn: {
      type: String,
      value: '',
    },
    sortDescending: {
      type: Boolean,
      value: false,
    },
  };

  cp.ElementBase.register(ColumnHead);

  return {
    ColumnHead,
  };
});
