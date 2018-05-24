# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import datetime
import json
import logging

from google.appengine.ext import ndb

from dashboard import alerts
from dashboard.api import api_auth
from dashboard.api import api_request_handler
from dashboard.api import describe
from dashboard.common import utils
from dashboard.models import anomaly
from dashboard.models import graph_data
from dashboard.models import histogram
from google.appengine.api import memcache


MAX_POINTS = 20000
BORING_COLUMNS = ['revision', 'timestamp']
CACHE_SECONDS = 60 * 60 * 4


@ndb.tasklet
def WaitAnySuccess(futures):
  while futures:
    try:
      yield futures
    except Exception: # pylint: disable=broad-except
      pass
    new_futures = []
    for future in futures:
      if not future.done():
        new_futures.append(future)
        continue
      if future.get_exception():
        logging.info('%r', future.get_exception())
        continue
      result = future.get_result()
      if result:
        raise ndb.Return(result)
    futures = new_futures


@ndb.tasklet
def FindTestInternal(test_suite, measurement, bot, test_case, build_type):
  test_paths = [CompileTest(bot, test_suite, measurement, test_case)]
  if build_type == 'reference':
    test_paths = [
        test_path + '_ref' for test_path in test_paths
    ] + [
        test_path + '/ref' for test_path in test_paths
    ]
  logging.info('test_paths %s', ' '.join(test_paths))
  futures = [utils.TestKey(test_path).get_async() for test_path in test_paths]
  test = yield WaitAnySuccess(futures)
  raise ndb.Return(test)


@ndb.tasklet
def FindTest(
    test_suite, measurement, bot, test_case, statistic, build_type):
  # Prefer the suffixed measurement.
  # TODO make callers merge both suffixed and unsuffixed timeseries.
  test = yield FindTestInternal(
      test_suite, measurement + '_' + statistic, bot, test_case, build_type)
  if test:
    raise ndb.Return(test)
  test = yield FindTestInternal(
      test_suite, measurement, bot, test_case, build_type)
  raise ndb.Return(test)


def CompileTest(bot, test_suite, measurement, test_case):
  suite_name, test_part1_name = describe.ParseTestSuite(test_suite)
  test_suite_hash = describe.Hash(test_suite)
  is_2c74 = test_suite_hash.startswith('2c74dc4e60629fc0bcc621c72d376beb02c1df')

  components = bot.split(':')
  components.append(suite_name)
  if test_part1_name:
    components.append(test_part1_name)

  if describe.IsPolyMeasurement(test_suite) or is_2c74:
    components.extend(measurement.split(':'))
  else:
    components.append(measurement)

  if test_case:
    if (test_suite.startswith('system_health') or
        (test_suite in [
            'tab_switching.typical_25',
            'v8:browsing_desktop',
            'v8:browsing_desktop-future',
            'v8:browsing_mobile',
            'v8:browsing_mobile-future',
            ])):
      test_case = test_case.split(':')
      if test_case[0] == 'long_running_tools':
        components.append(test_case[0])
      else:
        components.append('_'.join(test_case[:2]))
      components.append('_'.join(test_case))
    elif ((test_suite in ['memory.dual_browser_test', 'memory.top_10_mobile'])
          or is_2c74):
      components.extend(test_case.split(':'))
    else:
      components.append(test_case)
  return '/'.join(components)


def TransformRows(
    entities, columns, alert_entities, hist_entities, min_rev, max_rev,
    max_timestamp):
  logging.info('TransformRows %d', len(entities))
  entities = sorted(entities, key=lambda r: r.revision)
  results = []
  for entity in entities:
    if min_rev and (entity.revision < min_rev):
      continue
    if max_rev and (entity.revision > max_rev):
      continue
    if max_timestamp and (entity.timestamp > max_timestamp):
      continue

    row = []
    interesting = False
    for attr in columns:
      if attr == 'alert':
        cell = alert_entities.get(entity.revision)
      elif attr == 'hist':
        cell = hist_entities.get(entity.revision)
      else:
        cell = getattr(entity, attr, None)
        if isinstance(cell, datetime.datetime):
          cell = cell.isoformat()
        elif isinstance(cell, float):
          cell = round(cell, 6)
      row.append(cell)
      if not interesting:
        interesting = attr not in BORING_COLUMNS and cell is not None
    if interesting:
      results.append(row)
  return results


def CacheKey(*args):
  return 'api_timeseries2_' + '_'.join(args)


class Timeseries2Handler(api_request_handler.ApiRequestHandler):
  def _PreGet(self):
    try:
      api_auth.AuthorizeOauthUser()
    except (api_auth.OAuthError, api_auth.NotLoggedInError):
      # If the user isn't signed in or isn't an internal user, then they won't
      # be able to access internal_only timeseries, but they should still be
      # able to access non-internal_only timeseries.
      pass
    self._SetCorsHeadersIfAppropriate()

  def get(self):
    self._PreGet()
    test_suite = self.request.get('testSuite')
    measurement = self.request.get('measurement')
    bot = self.request.get('bot')
    test_case = self.request.get('testCase')
    statistic = self.request.get('statistic')
    build_type = self.request.get('buildType')

    min_rev = self.request.get('minRevision')
    max_rev = self.request.get('maxRevision')
    min_timestamp = self.request.get('minTimestamp')
    max_timestamp = self.request.get('maxTimestamp')

    cache_key = CacheKey(
        test_suite, measurement, bot, test_case, statistic, build_type, min_rev,
        max_rev, min_timestamp, max_timestamp)
    cached = memcache.get(cache_key)
    if cached is not None:
      logging.info('cached %s', cache_key)
      self._SetCacheControlHeader(True)
      self.response.write(cached)
      return

    if min_rev:
      min_rev = int(min_rev)
    if max_rev:
      max_rev = int(max_rev)
    if min_timestamp:
      min_timestamp = datetime.datetime.utcfromtimestamp(min_timestamp)
    if max_timestamp:
      max_timestamp = datetime.datetime.utcfromtimestamp(max_timestamp)

    test = FindTest( # pylint: disable=assignment-from-no-return
        test_suite, measurement, bot, test_case, statistic,
        build_type).get_result()

    if not test:
      self.response.set_status(404)
      self.response.write(json.dumps({'error': 'timeseries not found'}))
      return
    logging.info('found %r', test.key.id())

    internal_only = describe.AnyPrivate(
        [bot], test.suite_name, test.test_part1_name)

    columns = self.request.get('columns')
    if not columns:
      self.response.set_status(400)
      self.response.write(json.dumps({'error': 'missing "columns" parameter'}))
      return
    columns = columns.split(',')

    rows = graph_data.Row.query().filter(
        graph_data.Row.parent_test == utils.OldStyleTestKey(test.key.id()))
    rows = rows.order(-graph_data.Row.revision)
    if min_timestamp:
      rows = rows.filter(graph_data.Row.timestamp > min_timestamp)

    alert_entities = {}
    if 'alert' in columns:
      alert_entities = dict(
          (entity.end_revision, alerts.GetAnomalyDict(entity))
          for entity in anomaly.Anomaly.GetAlertsForTest(test))
    hist_entities = {}
    if 'hist' in columns:
      hist_entities = dict(
          (entity.revision, entity.data)
          for entity in histogram.Histogram.query().filter(
              histogram.Histogram.test == test.key.id()))

    response_json = json.dumps({
        'timeseries': TransformRows(
            rows.fetch(MAX_POINTS), columns, alert_entities, hist_entities,
            min_rev, max_rev, max_timestamp),
        'units': test.units,
    })
    self._SetCacheControlHeader(internal_only)
    self.response.out.write(response_json)
    if len(response_json) < 1000000:
      memcache.add(cache_key, response_json, time=CACHE_SECONDS)

  def _SetCacheControlHeader(self, private):
    self.response.headers['Cache-Control'] = '%s, max-age=%d' % (
        'private' if private else 'public', CACHE_SECONDS)
