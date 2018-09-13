# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import logging

from google.appengine.ext import ndb

from dashboard.common import bot_configurations
from dashboard.common import descriptor
from dashboard.common import stored_object
from dashboard.common import utils
from dashboard.models import graph_data
from tracing.value import histogram as histogram_module


def TableRowDescriptors(table_row):
  for test_suite in table_row['testSuites']:
    for bot in table_row['bots']:
      for case in table_row['testCases']:
        yield descriptor.Descriptor(
            test_suite, table_row['measurement'], bot, case)
      if not table_row['testCases']:
        yield descriptor.Descriptor(test_suite, table_row['measurement'], bot)


class ReportQuery(object):
  """Take a template and revisions. Return a report.

  Templates look like this: {
    statistics: ['avg', 'std'],
    rows: [
      {label, testSuites, measurement, bots, testCases},
    ],
  }

  Reports look like this: {
    statistics: ['avg', 'std'],
    rows: [
      {
        label, testSuites, measurement, bots, testCases, units,
        improvement_direction,
        data: {
          [revision]: {
            statistics: RunningStatisticsDict,
            descriptors: [{suite, bot, case, revision}],
          },
        },
      },
      ...
    ],
  }
  """

  def __init__(self, template, revisions):
    # Clone the template so that we can set table_row['data'] and the client
    # still gets to see the statistics, row testSuites, measurement, etc.
    self._report = dict(template)
    self._revisions = revisions
    self._max_revs = {}
    self._fetch_statistics = list({'avg', 'count'}.union(
        self._report['statistics']))
    self._commit_pos_bots = []
    self._chromium_commit_pos_bots = []
    self._revisions_by_bot_suite = {}

    self._report['rows'] = []
    for row in template['rows']:
      row = dict(row)
      row['data'] = {}
      for rev in self._revisions:
        row['data'][rev] = []
      self._report['rows'].append(row)

  def FetchSync(self):
    return self.FetchAsync().get_result()

  @ndb.tasklet
  def FetchAsync(self):
    yield [bot_configurations.Prefetch(), descriptor.PrefetchConfiguration()]
    yield self._ResolveCommitPositions()

    # Get data for each descriptor in each table row in parallel.
    futures = []
    for tri, table_row in enumerate(self._report['rows']):
      for desc in TableRowDescriptors(table_row):
        futures.append(self._GetRow(tri, table_row['data'], desc))
    yield futures

    # _GetRow can't know whether a datum will be merged until all the data have
    # been fetched, so post-process.
    for tri, table_row in enumerate(self._report['rows']):
      self._IgnoreStaleData(tri, table_row)
      self._IgnoreIncomparableData(table_row)
      self._SetRowUnits(table_row)
      self._IgnoreDataWithWrongUnits(table_row)
      self._MergeData(table_row)

    raise ndb.Return(self._report)

  @ndb.tasklet
  def _ResolveCommitPositions(self):
    commit_pos_bots, chromium_commit_pos_bots = yield [
        stored_object.GetCachedAsync('bots_with_different_r_commit_pos'),
        stored_object.GetCachedAsync(
            'bots_with_different_r_chromium_commit_pos')]
    self._commit_pos_bots, self._chromium_commit_pos_bots = (
        commit_pos_bots, chromium_commit_pos_bots)

    def PropertyNameForBot(bot):
      if bot in commit_pos_bots:
        return 'r_commit_pos'
      if bot in chromium_commit_pos_bots:
        return 'r_chromium_commit_pos'

    # Resolve revisions for each bot+suite in parallel before fetching data.
    # Multiple rows might need the same revisions, so speed things up by
    # resolving them only once.
    descriptors_by_bot_suite = {}
    for table_row in self._report['rows']:
      for desc in TableRowDescriptors(table_row):
        prop_name = PropertyNameForBot(desc.bot)
        if prop_name is None:
          continue
        bot_suite = (desc.bot, desc.test_suite)
        descriptors_by_bot_suite.setdefault(bot_suite, []).append(desc)

    futures = []
    for bot_suite, descriptors in descriptors_by_bot_suite.iteritems():
      futures.extend([self._ResolveCommitPosition(
          descriptors, rev, PropertyNameForBot(descriptors[0].bot))
                      for rev in self._revisions
                      if rev != 'latest'])
    yield futures

  @ndb.tasklet
  def _ResolveCommitPosition(self, descriptors, cr_commit_pos, property_name):
    for desc in descriptors:
      desc = desc.Clone()
      for stat in [None, 'avg']:
        desc.statistic = stat
        test_paths = yield desc.ToTestPathsAsync()
        test_keys = [
            utils.TestMetadataKey(test_path) for test_path in test_paths
        ] + [
            utils.OldStyleTestKey(test_path) for test_path in test_paths
        ]
        data_rows = yield [
            self._BisectRevision(test_key, cr_commit_pos, property_name)
            for test_key in test_keys]

        closest = None
        for data_row in data_rows:
          if data_row is None:
            continue
          if closest is None or (
              abs(int(getattr(data_row, property_name)) - cr_commit_pos) <
              abs(int(getattr(closest, property_name)) - cr_commit_pos)):
            closest = data_row

        if closest:
          bot_suite = (desc.bot, desc.test_suite)
          self._revisions_by_bot_suite.setdefault(bot_suite, {})[
              cr_commit_pos] = closest.revision
          raise ndb.Return()

  @ndb.tasklet
  def _BisectRevision(self, test_key, cr_commit_pos, property_name):
    # cr_commit_pos is the target chromium commit position requested by the
    # frontend.
    # property_name is one of 'r_commit_pos' or 'r_chromium_commit_pos'.
    [min_row, max_row] = yield [
        graph_data.Row.query(graph_data.Row.parent_test == test_key).order(
            graph_data.Row.revision).get_async(),
        graph_data.Row.query(graph_data.Row.parent_test == test_key).order(
            -graph_data.Row.revision).get_async(),
    ]
    if (min_row is None or
        max_row is None or
        not hasattr(min_row, property_name) or
        not hasattr(max_row, property_name) or
        int(getattr(min_row, property_name)) > cr_commit_pos or
        int(getattr(max_row, property_name)) < cr_commit_pos):
      raise ndb.Return(None)
    min_revision = min_row.revision
    max_revision = max_row.revision
    while min_revision < max_revision:
      mid_revision = (min_revision + max_revision) / 2
      data_row = yield self._GetDataRowAtRevision(test_key, mid_revision)
      current_commit_pos = int(getattr(data_row, property_name))
      if current_commit_pos == cr_commit_pos:
        break
      elif current_commit_pos > cr_commit_pos:
        max_revision = mid_revision - 1
      else:
        min_revision = mid_revision + 1
    raise ndb.Return(data_row)

  def _IgnoreStaleData(self, tri, table_row):
    # Ignore data from test cases that were removed.
    for rev, data in table_row['data'].iteritems():
      new_data = []
      for datum in data:
        max_rev_key = (
            datum['descriptor'].test_suite, datum['descriptor'].bot, tri, rev)
        if datum['revision'] == self._max_revs[max_rev_key]:
          new_data.append(datum)
      table_row['data'][rev] = new_data

  def _IgnoreIncomparableData(self, table_row):
    # Ignore data from test cases that are not present for every rev.
    for rev, data in table_row['data'].iteritems():
      new_data = []
      for datum in data:
        all_revs = True
        for other_data in table_row['data'].itervalues():
          any_desc = False
          for other_datum in other_data:
            if other_datum['descriptor'] == datum['descriptor']:
              any_desc = True
              break

          if not any_desc:
            all_revs = False
            break

        if all_revs:
          new_data.append(datum)

      table_row['data'][rev] = new_data

  def _SetRowUnits(self, table_row):
    # Copy units from the first datum to the table_row.
    # Sort data first so this is deterministic.
    for rev in self._revisions:
      data = table_row['data'][rev] = sorted(
          table_row['data'][rev], key=lambda datum: datum['descriptor'])
      if data:
        table_row['units'] = data[0]['units']
        table_row['improvement_direction'] = data[0]['improvement_direction']
        break

  def _IgnoreDataWithWrongUnits(self, table_row):
    for rev, data in table_row['data'].iteritems():
      new_data = []
      for datum in data:
        if datum['units'] == table_row['units']:
          new_data.append(datum)
        else:
          logging.warn('Expected units=%r; %r', table_row['units'], datum)
      table_row['data'][rev] = new_data

  def _MergeData(self, table_row):
    for rev, data in table_row['data'].iteritems():
      statistics = histogram_module.RunningStatistics()
      for datum in data:
        statistics = statistics.Merge(datum['statistics'])
      revision = rev
      if data:
        revision = data[0]['revision']
      table_row['data'][rev] = {
          'statistics': statistics.AsDict(),
          'descriptors': [
              {
                  'testSuite': datum['descriptor'].test_suite,
                  'bot': datum['descriptor'].bot,
                  'testCase': datum['descriptor'].test_case,
              }
              for datum in data
          ],
          'revision': revision,
      }

  @ndb.tasklet
  def _GetRow(self, tri, table_row, desc):
    # First try to find the unsuffixed test.
    test_paths = yield desc.ToTestPathsAsync()
    unsuffixed_tests = yield [utils.TestMetadataKey(test_path).get_async()
                              for test_path in test_paths]
    unsuffixed_tests = [t for t in unsuffixed_tests if t]

    if not unsuffixed_tests:
      # Fall back to suffixed tests.
      yield [self._GetSuffixedCell(tri, table_row, desc, rev)
             for rev in self._revisions]

    for test in unsuffixed_tests:
      test_path = utils.TestPath(test.key)
      yield [self._GetUnsuffixedCell(tri, table_row, desc, test, test_path, rev)
             for rev in self._revisions]

  @ndb.tasklet
  def _GetUnsuffixedCell(self, tri, table_row, desc, test, test_path, rev):
    data_row = yield self._GetDataRow(test_path, rev, desc)
    if data_row is None:
      # Fall back to suffixed tests.
      yield self._GetSuffixedCell(tri, table_row, desc, rev)
      raise ndb.Return()

    statistics = {
        stat: getattr(data_row, 'd_' + stat)
        for stat in descriptor.STATISTICS
        if hasattr(data_row, 'd_' + stat)
    }
    if 'avg' not in statistics:
      statistics['avg'] = data_row.value
    if 'std' not in statistics and data_row.error:
      statistics['std'] = data_row.error
    datum = dict(
        descriptor=desc,
        units=test.units,
        improvement_direction=test.improvement_direction,
        revision=data_row.revision,
        statistics=_MakeRunningStatistics(statistics))
    table_row[rev].append(datum)

    max_rev_key = (desc.test_suite, desc.bot, tri, rev)
    self._max_revs[max_rev_key] = max(
        self._max_revs.get(max_rev_key, 0), data_row.revision)

  @ndb.tasklet
  def _GetSuffixedCell(self, tri, table_row, desc, rev):
    datum = {'descriptor': desc}
    statistics = yield [self._GetStatistic(datum, desc, rev, stat)
                        for stat in self._fetch_statistics]
    statistics = {
        self._fetch_statistics[i]: statistics[i]
        for i in xrange(len(statistics))
        if statistics[i] is not None}
    if 'avg' not in statistics:
      raise ndb.Return()

    table_row[rev].append(datum)
    datum['statistics'] = _MakeRunningStatistics(statistics)

    max_rev_key = (desc.test_suite, desc.bot, tri, rev)
    self._max_revs[max_rev_key] = max(
        self._max_revs.get(max_rev_key, 0), datum['revision'])

  @ndb.tasklet
  def _GetStatistic(self, datum, desc, rev, stat):
    desc = desc.Clone()
    desc.statistic = stat
    test_paths = yield desc.ToTestPathsAsync()
    suffixed_tests = yield [utils.TestMetadataKey(test_path).get_async()
                            for test_path in test_paths]
    suffixed_tests = [t for t in suffixed_tests if t]
    if not suffixed_tests:
      raise ndb.Return(None)

    last_data_row = None
    for test in suffixed_tests:
      if stat == 'avg':
        datum['units'] = test.units
        datum['improvement_direction'] = test.improvement_direction
      test_path = utils.TestPath(test.key)
      data_row = yield self._GetDataRow(test_path, rev, desc)
      if not data_row:
        continue
      if not last_data_row or data_row.revision > last_data_row.revision:
        last_data_row = data_row
    if not last_data_row:
      raise ndb.Return(None)
    datum['revision'] = last_data_row.revision
    raise ndb.Return(last_data_row.value)

  @ndb.tasklet
  def _GetDataRow(self, test_path, rev, desc):
    entities = yield [
        self._GetDataRowForKey(utils.TestMetadataKey(test_path), rev, desc),
        self._GetDataRowForKey(utils.OldStyleTestKey(test_path), rev, desc)]
    entities = [e for e in entities if e]
    if not entities:
      raise ndb.Return(None)
    if len(entities) > 1:
      logging.warn('Found too many Row entities: %r %r', rev, test_path)
      raise ndb.Return(None)
    raise ndb.Return(entities[0])

  @ndb.tasklet
  def _GetDataRowForKey(self, test_key, rev, desc):
    # The frontend sets rev to 6-digit chromium commit positions.
    # Some bot+suites have chromium commit positions in r_commit_pos, some in
    # r_chromium_commit_pos. Whitelist them for bisection, fall back to querying
    # Row.revision for other bot+suites.
    data_row = None
    if rev == 'latest':
      data_row = yield self._GetDataRowAtRevision(test_key, None)
    elif rev in self._revisions_by_bot_suite.get(
        (desc.bot, desc.test_suite), {}):
      rev = self._revisions_by_bot_suite[desc.bot, desc.test_suite][rev]
      data_row = yield self._GetDataRowAtRevision(test_key, rev)
    elif desc.bot in self._commit_pos_bots:
      data_row = yield self._BisectRevision(test_key, rev, 'r_commit_pos')
      if data_row and (rev in self._revisions_by_bot_suite.get(
          (desc.bot, desc.test_suite), {})):
        rev = self._revisions_by_bot_suite[desc.bot, desc.test_suite][rev]
        if rev != data_row.revision:
          logging.warn('_GetDataRowForKey difference %r %r',
                       data_row.revision, rev)
          data_row = None
    elif desc.bot in self._chromium_commit_pos_bots:
      data_row = yield self._BisectRevision(
          test_key, rev, 'r_chromium_commit_pos')
    if data_row is None:
      # Some test suites in commit_pos_bots set revision=r_commit_pos, so fall
      # back to this normal logic:
      data_row = yield self._GetDataRowAtRevision(
          test_key, None if rev == 'latest' else rev)
    raise ndb.Return(data_row)

  @ndb.tasklet
  def _GetDataRowAtRevision(self, test_key, rev):
    query = graph_data.Row.query(graph_data.Row.parent_test == test_key)
    if rev is not None:
      query = query.filter(graph_data.Row.revision <= rev)
    query = query.order(-graph_data.Row.revision)
    data_row = yield query.get_async()
    raise ndb.Return(data_row)


def _MakeRunningStatistics(statistics):
  if statistics.get('avg') is None:
    return None
  count = statistics.get('count', 10)
  std = statistics.get('std', 0)
  return histogram_module.RunningStatistics.FromDict([
      count,
      statistics.get('max', statistics['avg']),
      0,  # meanlogs for geometricMean
      statistics['avg'],
      statistics.get('min', statistics['avg']),
      statistics.get('sum', statistics['avg'] * count),
      std * std * (count - 1)])
