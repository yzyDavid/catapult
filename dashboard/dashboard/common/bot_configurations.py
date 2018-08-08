# Copyright 2018 The Chromium Authors. All rights reserved.
# Use of this source code is governed by a BSD-style license that can be
# found in the LICENSE file.

import string

from google.appengine.ext import ndb

from dashboard.common import namespaced_stored_object


BOT_CONFIGURATIONS_KEY = 'bot_configurations'

@ndb.tasklet
def Prefetch():
  yield namespaced_stored_object.GetCachedAsync(BOT_CONFIGURATIONS_KEY)


def Get(name):
  configurations = namespaced_stored_object.GetCached(BOT_CONFIGURATIONS_KEY)
  configuration = configurations[name]
  if 'alias' in configuration:
    return configurations[configuration['alias']]
  return configuration


def GetAliasesIfCached(bot):
  aliases = {bot}
  configurations = namespaced_stored_object.GetIfCached(BOT_CONFIGURATIONS_KEY)
  if configurations is None:
    return None
  if bot not in configurations:
    return aliases
  if 'alias' in configurations[bot]:
    bot = configurations[bot]['alias']
    aliases.add(bot)
  for name, configuration in configurations.iteritems():
    if configuration.get('alias') == bot:
      aliases.add(name)
  return aliases

@ndb.tasklet
def GetAliasesAsync(bot):
  configurations = namespaced_stored_object.GetIfCached(BOT_CONFIGURATIONS_KEY)
  if configurations is None:
    yield namespaced_stored_object.GetCachedAsync(BOT_CONFIGURATIONS_KEY)
  raise ndb.Return(GetAliasesIfCached(bot))


def List():
  bot_configurations = namespaced_stored_object.Get(BOT_CONFIGURATIONS_KEY)
  canonical_names = [name for name, value in bot_configurations.iteritems()
                     if 'alias' not in value]
  return sorted(canonical_names, key=string.lower)
