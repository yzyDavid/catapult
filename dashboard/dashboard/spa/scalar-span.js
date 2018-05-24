/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  class ScalarSpan extends cp.ElementBase {
    change_(unit, value) {
      if (!unit) return '';
      if (!unit.isDelta) return '';
      if (unit.improvementDirection === tr.b.ImprovementDirection.DONT_CARE) {
        return '';
      }
      if (value === 0) return '';
      if (unit.improvementDirection ===
          tr.b.ImprovementDirection.BIGGER_IS_BETTER) {
        return this.value > 0 ? 'improvement' : 'regression';
      }
      return this.value < 0 ? 'improvement' : 'regression';
    }

    title_(unit, value) {
      return this.change_(unit, value);
    }

    format_(unit, value, maximumFractionDigits, unitPrefix) {
      if (!unit) return '';
      return unit.format(value, {maximumFractionDigits, unitPrefix});
    }
  }

  ScalarSpan.properties = {
    maximumFractionDigits: {type: Number},
    unit: {type: Object},
    unitPrefix: {type: Object},
    value: {type: Number},
  };

  cp.ElementBase.register(ScalarSpan);

  return {
    ScalarSpan,
  };
});
