# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import datetime
import json

from dashboard.api import api_auth
from dashboard.api import api_request_handler
from dashboard.common import utils
from google.appengine.api import memcache
from dashboard.models import table_config


CACHE_SECONDS = 60 * 60 * 20
EPOCH = datetime.datetime.utcfromtimestamp(0)


def EpochMs(dt):
  return int((dt - EPOCH).total_seconds() * 1000)


def RenderEntity(entity):
  return {
      'id': entity.key.id(),
      'modified': EpochMs(entity.modified),
      'name': entity.name,
  }


def CacheKey(is_internal_user):
  return 'api_report_names' + ('_internal' if is_internal_user else '')


class ReportNamesHandler(api_request_handler.ApiRequestHandler):

  def get(self):
    self._PreGet()
    is_internal_user = utils.IsInternalUser()
    cache_key = CacheKey(is_internal_user)
    cached = memcache.get(cache_key)
    if cached is not None:
      self.response.write(cached)
      return

    # It's important that the user always gets the latest names and modified
    # timestamps. The ReportHandler deletes these memcache entries when
    # ReportTemplates are created or updated, but browser and GFE caches can't
    # be invalidated so easily, so don't set the Cache-Control header.

    entities = table_config.ReportTemplate.query()
    if not is_internal_user:
      entities = entities.filter(
          table_config.ReportTemplate.internal_only == False)
    entities = [RenderEntity(entity) for entity in entities.fetch()]
    entities.sort(key=lambda d: d['name'])
    entities = json.dumps(entities)
    self.response.write(entities)
    memcache.add(cache_key, entities, time=CACHE_SECONDS)

  def _PreGet(self):
    try:
      api_auth.AuthorizeOauthUser()
    except (api_auth.OAuthError, api_auth.NotLoggedInError):
      # If the user isn't signed in or isn't an internal user, then they won't
      # be able to access internal_only timeseries, but they should still be
      # able to access non-internal_only timeseries.
      pass
    self._SetCorsHeadersIfAppropriate()
