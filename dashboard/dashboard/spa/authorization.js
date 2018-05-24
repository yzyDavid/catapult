/* Copyright 2018 The Chromium Authors. All rights reserved.
   Use of this source code is governed by a BSD-style license that can be
   found in the LICENSE file.
*/
'use strict';
tr.exportTo('cp', () => {
  async function authorizationHeaders() {
    if (window.gapi === undefined) return [];
    if (gapi.auth2 === undefined) return [];

    const auth = gapi.auth2.getAuthInstance();
    if (!auth) return [];
    const user = auth.currentUser.get();
    let response = user.getAuthResponse();

    if (response.expires_at === undefined) {
      // The user is not signed in.
      return [];
    }

    if (response.expires_at < new Date()) {
      // The token has expired, so reload it.
      response = await user.reloadAuthResponse();
    }

    return [
      ['Authorization', response.token_type + ' ' + response.access_token],
    ];
  }

  return {
    authorizationHeaders,
  };
});
