# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import json
import logging

from dashboard.api import api_request_handler
from dashboard.models import report_template


CACHE_SECONDS = 60 * 60 * 20


class ReportHandler(api_request_handler.ApiRequestHandler):

  def get(self):
    self.post()

  def _AllowAnonymous(self):
    return True

  def AuthorizedPost(self):
    if self.request.get('template'):
      return self._PutTemplate()
    return self._GetReport()

  def _PutTemplate(self):
    template = json.loads(self.request.get('template'))
    name = self.request.get('name', None)
    owners = self.request.get('owners', None)
    logging.info('template=%r', template)
    logging.info('name=%r', name)
    logging.info('owners=%r', name)
    if template is None or name is None or owners is None:
      raise api_request_handler.BadRequestError

    owners = owners.split(',')
    template_id = self.request.get('id', None)
    logging.info('id=%r', template_id)
    try:
      report_template.PutTemplate(int(template_id), name, owners, template)
    except ValueError:
      raise api_request_handler.BadRequestError
    return report_template.List()

  def _GetReport(self):
    revisions = self.request.get('revisions', None)
    logging.info('revisions %r', revisions)
    if revisions is None:
      raise api_request_handler.BadRequestError
    try:
      revisions = [int(r) if r != 'latest' else r
                   for r in revisions.split(',')]
    except ValueError:
      raise api_request_handler.BadRequestError

    try:
      template_id = int(self.request.get('id'))
    except ValueError:
      logging.warn('invalid template id')
      raise api_request_handler.BadRequestError

    try:
      report = report_template.GetReport(template_id, revisions)
    except AssertionError:
      # The caller has requested internal-only data but is not authorized.
      logging.warn('unauthorized')
      raise api_request_handler.NotFoundError
    if report is None:
      logging.warn('missing report')
      raise api_request_handler.NotFoundError

    self.response.headers['Cache-Control'] = '%s, max-age=%d' % (
        'private' if report['internal'] else 'public', CACHE_SECONDS)
    return report
