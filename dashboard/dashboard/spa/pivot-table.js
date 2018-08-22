/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class PivotTable extends cp.ElementBase {
    visibleRows_(rows) {
      return PivotTable.visibleRows(rows, 0);
    }

    static visibleRows(groupedRows, depth) {
      const rows = [];
      for (const row of groupedRows) {
        row.depth = depth;
        rows.push(row);
        if (row.isExpanded) {
          rows.push.apply(rows, PivotTable.visibleRows(
              row.subRows, depth + 1));
        }
      }
      return rows;
    }

    getCommonDiagnostic_(diagnosticName, columnName) {
      return PivotTable.getCommonDiagnostic(
          diagnosticName, columnName, this.rows);
    }

    static getCommonDiagnostic(diagnosticName, columnName, rows) {
      return rows[0].columns[columnName].diagnostics.get(diagnosticName);
    }

    sort_(event) {
      // TODO
    }
  }

  PivotTable.State = {
  };

  PivotTable.properties = cp.buildProperties('state', PivotTable.State);
  PivotTable.buildState = options => cp.buildState(PivotTable.State, options);

  cp.ElementBase.register(PivotTable);

  return {
    PivotTable,
  };
});
