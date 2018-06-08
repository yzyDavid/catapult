# Copyright 2017 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import datetime
import httplib2
import logging
import time

from google.appengine.datastore import datastore_query
from google.appengine.ext import ndb

from dashboard import alerts
from dashboard import file_bug
from dashboard import group_report
from dashboard.api import api_request_handler
from dashboard.api import describe
from dashboard.api import test_suites
from dashboard.common import request_handler
from dashboard.common import utils
from dashboard.models import anomaly
from dashboard.services import issue_tracker_service


ISO_8601_FORMAT = '%Y-%m-%dT%H:%M:%S'


def _InequalityFilters(query, inequality_property,
                       min_end_revision, max_end_revision,
                       min_start_revision, max_start_revision,
                       min_timestamp, max_timestamp):
  # A query cannot have more than one inequality filter.
  # inequality_property allows users to decide which property to filter in the
  # query, which can significantly affect performance. If other inequalities are
  # specified, they will be handled by post_filters.

  # If callers set inequality_property without actually specifying a
  # corresponding inequality filter, then reset the inequality_property and
  # compute it automatically as if it were not specified.
  if inequality_property == 'start_revision':
    if min_start_revision is None and max_start_revision is None:
      inequality_property = None
  elif inequality_property == 'end_revision':
    if min_end_revision is None and max_end_revision is None:
      inequality_property = None
  elif inequality_property == 'timestamp':
    if min_timestamp is None and max_timestamp is None:
      inequality_property = None
  else:
    inequality_property = None

  if inequality_property is None:
    # Compute a default inequality_property.
    if min_start_revision or max_start_revision:
      inequality_property = 'start_revision'
    elif min_end_revision or max_end_revision:
      inequality_property = 'end_revision'
    elif min_timestamp or max_timestamp:
      inequality_property = 'timestamp'

  post_filters = []
  if not inequality_property:
    return query, post_filters

  if min_start_revision:
    min_start_revision = int(min_start_revision)
    if inequality_property == 'start_revision':
      logging.info('filter:min_start_revision=%d', min_start_revision)
      query = query.filter(anomaly.Anomaly.start_revision >= min_start_revision)
      query = query.order(-anomaly.Anomaly.start_revision)
    else:
      post_filters.append(lambda a: a.start_revision >= min_start_revision)

  if max_start_revision:
    max_start_revision = int(max_start_revision)
    if inequality_property == 'start_revision':
      logging.info('filter:max_start_revision=%d', max_start_revision)
      query = query.filter(anomaly.Anomaly.start_revision <= max_start_revision)
      query = query.order(-anomaly.Anomaly.start_revision)
    else:
      post_filters.append(lambda a: a.start_revision <= max_start_revision)

  if min_end_revision:
    min_end_revision = int(min_end_revision)
    if inequality_property == 'end_revision':
      logging.info('filter:min_end_revision=%d', min_end_revision)
      query = query.filter(anomaly.Anomaly.end_revision >= min_end_revision)
      query = query.order(-anomaly.Anomaly.end_revision)
    else:
      post_filters.append(lambda a: a.end_revision >= min_end_revision)

  if max_end_revision:
    max_end_revision = int(max_end_revision)
    if inequality_property == 'end_revision':
      logging.info('filter:max_end_revision=%d', max_end_revision)
      query = query.filter(anomaly.Anomaly.end_revision <= max_end_revision)
      query = query.order(-anomaly.Anomaly.end_revision)
    else:
      post_filters.append(lambda a: a.end_revision <= max_end_revision)

  if min_timestamp:
    min_timestamp = datetime.datetime.strptime(min_timestamp, ISO_8601_FORMAT)
    if inequality_property == 'timestamp':
      logging.info('filter:min_timestamp=%d', min_timestamp)
      query = query.filter(anomaly.Anomaly.timestamp >= min_timestamp)
    else:
      post_filters.append(lambda a: a.timestamp >= min_timestamp)

  if max_timestamp:
    max_timestamp = datetime.datetime.strptime(max_timestamp, ISO_8601_FORMAT)
    if inequality_property == 'timestamp':
      logging.info('filter:max_timestamp=%d', max_timestamp)
      query = query.filter(anomaly.Anomaly.timestamp <= max_timestamp)
    else:
      post_filters.append(lambda a: a.timestamp <= max_timestamp)

  return query, post_filters


def QueryAnomalies(
    bot_name=None,
    bug_id=None,
    inequality_property=None,
    is_improvement=None,
    key=None,
    limit=100,
    master_name=None,
    max_end_revision=None,
    max_start_revision=None,
    max_timestamp=None,
    min_end_revision=None,
    min_start_revision=None,
    min_timestamp=None,
    recovered=None,
    sheriff=None,
    start_cursor=None,
    test=None,
    test_suite_name=None):
  if key:
    logging.info('key')
    try:
      return [ndb.Key(urlsafe=key).get()], None
    except AssertionError:
      return [], None

  query = anomaly.Anomaly.query()
  if sheriff is not None:
    sheriff_key = ndb.Key('Sheriff', sheriff)
    sheriff_entity = sheriff_key.get()
    if not sheriff_entity:
      raise api_request_handler.BadRequestError('Invalid sheriff %s' % sheriff)
    logging.info('filter:sheriff=%s', sheriff)
    query = query.filter(anomaly.Anomaly.sheriff == sheriff_key)
  if is_improvement is not None:
    logging.info('filter:is_improvement=%r', is_improvement)
    query = query.filter(anomaly.Anomaly.is_improvement == is_improvement)
  if bug_id is not None:
    if bug_id == '':
      bug_id = None
    else:
      bug_id = int(bug_id)
    logging.info('filter:bug_id=%r', bug_id)
    query = query.filter(anomaly.Anomaly.bug_id == bug_id)
  if recovered is not None:
    logging.info('filter:recovered=%r', recovered)
    query = query.filter(anomaly.Anomaly.recovered == recovered)
  if test:
    logging.info('filter:test=%s', test)
    query = query.filter(anomaly.Anomaly.test == utils.TestMetadataKey(test))
  if master_name:
    logging.info('filter:master=%s', master_name)
    query = query.filter(anomaly.Anomaly.master_name == master_name)
  if bot_name:
    logging.info('filter:bot_name=%s', bot_name)
    query = query.filter(anomaly.Anomaly.bot_name == bot_name)
  if test_suite_name:
    logging.info('filter:test_suite=%s', test_suite_name)
    query = query.filter(anomaly.Anomaly.benchmark_name == test_suite_name)
  # TODO measurement_name, test_case name

  query, post_filters = _InequalityFilters(
      query, inequality_property, min_end_revision, max_end_revision,
      min_start_revision, max_start_revision, min_timestamp, max_timestamp)
  query = query.order(-anomaly.Anomaly.timestamp)

  if start_cursor:
    logging.info('start_cursor')
  else:
    start_cursor = None

  start = time.time()
  results, next_cursor, more = query.fetch_page(
      limit, start_cursor=start_cursor)
  duration = time.time() - start
  logging.info('query_duration=%f', duration)
  logging.info('query_results_count=%d', len(results))
  logging.info('duration_per_result=%f', duration / len(results))
  if post_filters:
    logging.info('post_filters_count=%d', len(post_filters))
    results = [alert for alert in results
               if all(post_filter(alert) for post_filter in post_filters)]
    logging.info('filtered_results_count=%d', len(results))
  if more:
    logging.info('more')
  else:
    next_cursor = None
  return results, next_cursor


def QueryAnomaliesUntilFound(
    bot_name=None,
    bug_id=None,
    deadline_seconds=50,
    inequality_property=None,
    is_improvement=None,
    key=None,
    limit=100,
    master_name=None,
    max_end_revision=None,
    max_start_revision=None,
    max_timestamp=None,
    min_end_revision=None,
    min_start_revision=None,
    min_timestamp=None,
    recovered=None,
    sheriff=None,
    start_cursor=None,
    test=None,
    test_suite_name=None):
  # post_filters can cause alert_list to be empty, depending on the shape of the
  # data and which filters are applied in the query and which filters are
  # applied after the query. Automatically chase cursors until some results are
  # found, but stay under the request timeout.
  alert_list = []
  deadline = time.time() + deadline_seconds
  while not alert_list and time.time() < deadline:
    alert_list, start_cursor = QueryAnomalies(
        bot_name=bot_name,
        bug_id=bug_id,
        inequality_property=inequality_property,
        is_improvement=is_improvement,
        key=key,
        limit=limit,
        master_name=master_name,
        max_end_revision=max_end_revision,
        max_start_revision=max_start_revision,
        max_timestamp=max_timestamp,
        min_end_revision=min_end_revision,
        min_start_revision=min_start_revision,
        min_timestamp=min_timestamp,
        recovered=recovered,
        sheriff=sheriff,
        start_cursor=start_cursor,
        test=test,
        test_suite_name=test_suite_name)
    if not start_cursor:
      break
  return alert_list, start_cursor
>>>>>>> Generalize the /api/alerts request handler.


class AlertsHandler(api_request_handler.ApiRequestHandler):
  """API handler for various alert requests."""

  def _AuthorizedHttp(self):
    # TODO(benjhayden): Use this instead of ServiceAccountHttp in order to use
    # the user's account. That will require changing the google-signin's
    # client-id in chromeperf-app.html to a client-id that is whitelisted by the
    # issue tracker service, which will require either adding
    # v2spa-dot-chromeperf.appspot.com to the list of domains for an existing
    # client id, or else launching v2spa to chromeperf.appspot.com.
    http = httplib2.Http()
    orig_request = http.request
    def NewRequest(uri, method='GET', body=None, headers=None,
                   redirections=httplib2.DEFAULT_MAX_REDIRECTS,
                   connection_type=None):
      headers = dict(headers or {})
      headers['Authorization'] = self.request.headers.get('Authorization')
      return orig_request(uri, method, body, headers, redirections,
                          connection_type)
    http.request = NewRequest
    return http

  def _FileBug(self):
    if not utils.IsValidSheriffUser():
      raise api_request_handler.BadRequestError(
          'Only chromium.org accounts may file bugs')

    owner = self.request.get('owner')
    cc = self.request.get('cc')
    if owner and not owner.endswith('@chromium.org'):
      raise api_request_handler.BadRequestError(
          'Owner email address must end with @chromium.org')

    summary = self.request.get('summary')
    description = self.request.get('description')
    labels = self.request.get_all('label')
    components = self.request.get_all('component')
    keys = self.request.get_all('key')
    http = utils.ServiceAccountHttp()  # TODO use self._AuthorizedHttp()
    return file_bug.FileBug(
        http, keys, summary, description, labels, components, owner, cc)

  def _RecentBugs(self):
    if not utils.IsValidSheriffUser():
      raise api_request_handler.BadRequestError(
          'Only chromium.org accounts may query recent bugs')
    http = utils.ServiceAccountHttp()  # TODO use self._AuthorizedHttp()
    issue_tracker = issue_tracker_service.IssueTrackerService(http)
    response = issue_tracker.List(
        q='opened-after:today-5', label='Type-Bug-Regression,Performance',
        sort='-id')
    return {'bugs': response.get('items', [])}

  def _ExistingBug(self):
    keys = self.request.get_all('key')
    bug_id = int(self.request.get('bug_id'))
    alert_entities = ndb.get_multi([ndb.Key(urlsafe=k) for k in keys])
    for a in alert_entities:
      a.bug_id = bug_id
    ndb.put_multi(alert_entities)
    return {}

  def AuthorizedPost(self, *args):
    """Returns alert data in response to API requests.

    Possible list types:
      keys: A comma-separated list of urlsafe Anomaly keys.
      bug_id: A bug number on the Chromium issue tracker.
      rev: A revision number.

    Outputs:
      Alerts data; see README.md.
    """
    alert_list = None
    response = {}
    try:
      if len(args) == 0:
        is_improvement = self.request.get('is_improvement', None)
        assert is_improvement in [None, 'true', 'false'], is_improvement
        if is_improvement:
          is_improvement = is_improvement == 'true'
        recovered = self.request.get('recovered', None)
        assert recovered in [None, 'true', 'false'], recovered
        if recovered:
          recovered = recovered == 'true'
        start_cursor = self.request.get('cursor', None)
        if start_cursor:
          start_cursor = datastore_query.Cursor(urlsafe=start_cursor)
        min_timestamp = self.request.get('min_timestamp', None)
        if min_timestamp:
          min_timestamp = datetime.datetime.strptime(
              min_timestamp, ISO_8601_FORMAT)
        max_timestamp = self.request.get('max_timestamp', None)
        if max_timestamp:
          max_timestamp = datetime.datetime.strptime(
              max_timestamp, ISO_8601_FORMAT)

        try:
          alert_list, next_cursor, _ = anomaly.Anomaly.QueryAsync(
              bot_name=self.request.get('bot', None),
              bug_id=self.request.get('bug_id', None),
              is_improvement=is_improvement,
              key=self.request.get('key', None),
              limit=int(self.request.get('limit', 100)),
              master_name=self.request.get('master', None),
              max_end_revision=self.request.get('max_end_revision', None),
              max_start_revision=self.request.get('max_start_revision', None),
              max_timestamp=max_timestamp,
              min_end_revision=self.request.get('min_end_revision', None),
              min_start_revision=self.request.get('min_start_revision', None),
              min_timestamp=min_timestamp,
              recovered=recovered,
              sheriff=self.request.get('sheriff', None),
              start_cursor=start_cursor,
              test=self.request.get('test', None),
              test_suite_name=self.request.get('test_suite', None)).get_result()
        except AssertionError:
          alert_list, next_cursor = [], None
        if next_cursor:
          response['next_cursor'] = next_cursor.urlsafe()
      else:
        list_type = args[0]
        if list_type == 'new_bug':
          return self._FileBug()
        elif list_type == 'recent_bugs':
          return self._RecentBugs()
        elif list_type == 'existing_bug':
          return self._ExistingBug()
    except request_handler.InvalidInputError as e:
      raise api_request_handler.BadRequestError(e.message)

    anomaly_dicts = alerts.AnomalyDicts(
        [a for a in alert_list if a.key.kind() == 'Anomaly'])
    for ad in anomaly_dicts:
      test_parts = ad['test'].split('/')
      ad['testsuite2'] = test_suites.GroupableTestSuite(ad['testsuite'])
      test_part1_name = None
      if test_suites.IsPartialTestSuite(ad['testsuite2']):
        test_part1_name = test_parts.pop(0)
        ad['testsuite2'] += ':' + test_part1_name
      ad['measurement'], ad['testcase'] = describe.ParseTestPath(
          test_parts, ad['testsuite'], test_part1_name, [])
      stripped = describe.StripSuffix(ad['measurement'])
      if len(stripped) < len(ad['measurement']):
        ad['statistic'] = ad['measurement'][len(stripped) + 1:]
        ad['measurement'] = stripped

    response['anomalies'] = anomaly_dicts
    return response
