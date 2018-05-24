# Copyright 2017 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import datetime
import httplib2
import logging

from google.appengine.datastore.datastore_query import Cursor
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
    list_type = args[0]
    more = False
    cursor = None
    try:
      if list_type.startswith('bug_id'):
        bug_id = list_type.replace('bug_id/', '')
        alert_list = group_report.GetAlertsWithBugId(bug_id)
      elif list_type.startswith('keys'):
        keys = list_type.replace('keys/', '').split(',')
        alert_list = group_report.GetAlertsForKeys(keys)
      elif list_type.startswith('rev'):
        rev = list_type.replace('rev/', '')
        alert_list = group_report.GetAlertsAroundRevision(rev)
      elif list_type == 'new_bug':
        return self._FileBug()
      elif list_type == 'recent_bugs':
        return self._RecentBugs()
      elif list_type == 'existing_bug':
        return self._ExistingBug()
      elif list_type.startswith('history'):
        query = anomaly.Anomaly.query()

        sheriff_name = self.request.get('sheriff', 'Chromium Perf Sheriff')
        if sheriff_name:
          sheriff_key = ndb.Key('Sheriff', sheriff_name)
          sheriff = sheriff_key.get()
          if sheriff:
            logging.info('sheriff %s', sheriff_name)
            query = query.filter(anomaly.Anomaly.sheriff == sheriff_key)

        try:
          days = int(list_type.replace('history/', ''))
        except ValueError:
          days = 7
        if days > 0:
          logging.info('days %d', days)
          cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
          query = query.filter(anomaly.Anomaly.timestamp > cutoff)

        limit = self.request.get('limit', None)
        if limit:
          limit = int(limit)

        start_cursor = self.request.get('start_cursor', None)
        if start_cursor:
          start_cursor = Cursor(urlsafe=start_cursor)

        include_triaged = bool(self.request.get('triaged'))
        if not include_triaged:
          logging.info('untriaged')
          query = query.filter(anomaly.Anomaly.bug_id == None)

        include_recovered = bool(self.request.get('recovered'))
        if not include_recovered:
          logging.info('unrecovered')
          query = query.filter(anomaly.Anomaly.recovered == False)

        include_improvements = bool(self.request.get('improvements'))
        if not include_improvements:
          logging.info('regressions')
          query = query.filter(anomaly.Anomaly.is_improvement == False)

        filter_for_benchmark = self.request.get('benchmark')
        if filter_for_benchmark:
          logging.info('benchmark %s', filter_for_benchmark)
          query = query.filter(
              anomaly.Anomaly.benchmark_name == filter_for_benchmark)

        query = query.order(-anomaly.Anomaly.timestamp)

        if limit or start_cursor:
          (alert_list, cursor, more) = query.fetch_page(
              limit, start_cursor=start_cursor)
        else:
          alert_list = query.fetch()
      else:
        raise api_request_handler.BadRequestError(
            'Invalid alert type %s' % list_type)
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

    response = {'anomalies': anomaly_dicts}
    if more and cursor:
      response['cursor'] = cursor.urlsafe()

    return response
