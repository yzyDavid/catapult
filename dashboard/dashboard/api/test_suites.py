# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import hashlib
import json
import logging

from dashboard.api import api_auth
from dashboard.api import api_request_handler
from dashboard.common import utils
from dashboard.models import graph_data
from google.appengine.api import memcache


PARTIAL_TEST_SUITE_HASHES = [
    '147e82faca64a021f4af180c2acbeaa8be6a43478105110702869e353cda8c46',
]


GROUPABLE_TEST_SUITE_PREFIXES = [
    'autoupdate_',
    'blink_perf.',
    'cheets_',
    'graphics_',
    'smoothness.',
    'thread_times.',
    'v8.',
    'video_',
    'xr.',
]


def CacheKey(is_internal_user):
  return 'api_test_suites' + ('_internal' if is_internal_user else '')


def FetchRootTestKeys(is_internal_user, test_suites):
  query = graph_data.TestMetadata.query()
  query = query.filter(graph_data.TestMetadata.parent_test == None)
  query = query.filter(graph_data.TestMetadata.deprecated == False)
  if is_internal_user:
    public = memcache.get(CacheKey(False))
    if public is not None:
      for test_suite in json.loads(public):
        test_suites.add(test_suite)
      query = query.filter(graph_data.TestMetadata.internal_only == True)
  else:
    query = query.filter(graph_data.TestMetadata.internal_only == False)
  return query.fetch(keys_only=True)


def GroupableTestSuite(test_suite):
  if test_suite.startswith('resource_sizes '):
    return 'resource_sizes:' + test_suite[16:-1]

  for prefix in GROUPABLE_TEST_SUITE_PREFIXES:
    if test_suite.startswith(prefix):
      return prefix[:-1] + ':' + test_suite[len(prefix):]

  return test_suite


def IsPartialTestSuite(test_suite):
  sha = hashlib.sha256(bytes(test_suite)).hexdigest()
  return sha in PARTIAL_TEST_SUITE_HASHES


def FetchSubTestKeys(parent_test):
  subquery = graph_data.TestMetadata.query()
  subquery = subquery.filter(
      graph_data.TestMetadata.parent_test == parent_test)
  subquery = subquery.filter(graph_data.TestMetadata.deprecated == False)
  return subquery.fetch(keys_only=True)


CACHE_SECONDS = 60 * 60 * 20


class TestSuitesHandler(api_request_handler.ApiRequestHandler):

  def get(self):
    self._PreGet()
    is_internal_user = utils.IsInternalUser()
    cache_key = CacheKey(is_internal_user)
    logging.info('ck:%r, i:%r, ue:%r', cache_key, is_internal_user,
                 utils.GetUserEmail())
    cached = memcache.get(cache_key)
    if cached is not None:
      self._SetCacheControlHeader(is_internal_user)
      self.response.write(cached)
      return

    test_suites = set()
    keys = FetchRootTestKeys(is_internal_user, test_suites)
    for key in keys:
      test_suite = GroupableTestSuite(utils.TestSuiteName(key))
      if not test_suite:
        continue
      if not IsPartialTestSuite(test_suite):
        test_suites.add(test_suite)
        continue
      for subkey in FetchSubTestKeys(key):
        test_suites.add(test_suite + ':' + subkey.id().split('/')[3])

    test_suites = json.dumps(list(sorted(test_suites)))
    self._SetCacheControlHeader(is_internal_user)
    self.response.write(test_suites)
    memcache.add(cache_key, test_suites, time=60*60*24)

  def _PreGet(self):
    try:
      api_auth.AuthorizeOauthUser()
    except (api_auth.OAuthError, api_auth.NotLoggedInError):
      # If the user isn't signed in or isn't an internal user, then they won't
      # be able to access internal_only timeseries, but they should still be
      # able to access non-internal_only timeseries.
      pass
    self._SetCorsHeadersIfAppropriate()

  def _SetCacheControlHeader(self, private):
    self.response.headers['Cache-Control'] = '%s, max-age=%d' % (
        'private' if private else 'public', CACHE_SECONDS)
