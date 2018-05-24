# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

from google.appengine.ext import ndb
from dashboard.models import internal_only_model


class ReportTemplate(internal_only_model.InternalOnlyModel):
  name = ndb.StringProperty()
  owners = ndb.StringProperty(repeated=True)
  url = ndb.StringProperty()
  template = ndb.JsonProperty()
  internal_only = ndb.BooleanProperty(indexed=True)
  modified = ndb.DateTimeProperty(indexed=False, auto_now=True)
