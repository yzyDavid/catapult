# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

from dashboard import update_test_suite_descriptors
from dashboard.api import api_request_handler
from dashboard.common import timing
from dashboard.common import utils


CACHE_SECONDS = 60 * 60 * 20


class DescribeHandler(api_request_handler.ApiRequestHandler):
  """API handler for describing test suites."""

  def get(self, *args):
    self.post(*args)

  def _AllowAnonymous(self):
    return True

  def PrivilegedPost(self, *args):
    return self.UnprivilegedPost(*args)

  def UnprivilegedPost(self, *args):
    # TODO(benjhayden): Replace IsInternalUser with descriptor['any_internal'].
    self.response.headers['Cache-Control'] = '%s, max-age=%d' % (
        'private' if utils.IsInternalUser() else 'public', CACHE_SECONDS)
    with timing.WallTimeLogger('Describe'), timing.CpuTimeLogger('Describe'):
      return update_test_suite_descriptors.FetchCachedTestSuiteDescriptor(
          args[0])
