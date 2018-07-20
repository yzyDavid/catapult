# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

from dashboard.api import api_request_handler
from dashboard.common import utils
from dashboard.models import report_template


CACHE_SECONDS = 60 * 60 * 20


class ReportNamesHandler(api_request_handler.ApiRequestHandler):

  def get(self):
    self.post()

  def _AllowAnonymous(self):
    return True

  def AuthorizedPost(self):
    self.response.headers['Cache-Control'] = '%s, max-age=%d' % (
        'private' if utils.IsInternalUser() else 'public', CACHE_SECONDS)
    return report_template.List()
