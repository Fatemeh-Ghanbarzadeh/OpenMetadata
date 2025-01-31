/*
 *  Copyright 2022 Collate.
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *  http://www.apache.org/licenses/LICENSE-2.0
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import {
  AuthenticationResult,
  InteractionRequiredAuthError,
  InteractionStatus,
} from '@azure/msal-browser';
import { useAccount, useMsal } from '@azure/msal-react';
import { AxiosError } from 'axios';
import { get } from 'lodash';
import React, {
  forwardRef,
  Fragment,
  ReactNode,
  useEffect,
  useImperativeHandle,
} from 'react';
import { useMutex } from 'react-context-mutex';
import { toast } from 'react-toastify';
import { useApplicationStore } from '../../../hooks/useApplicationStore';
import { msalLoginRequest } from '../../../utils/AuthProvider.util';
import { getPopupSettingLink } from '../../../utils/BrowserUtils';
import { Transi18next } from '../../../utils/CommonUtils';
import {
  AuthenticatorRef,
  OidcUser,
  UserProfile,
} from '../AuthProviders/AuthProvider.interface';

interface Props {
  children: ReactNode;
  onLoginSuccess: (user: OidcUser) => void;
  onLoginFailure: (error: AxiosError) => void;
  onLogoutSuccess: () => void;
}

const MsalAuthenticator = forwardRef<AuthenticatorRef, Props>(
  (
    { children, onLoginSuccess, onLogoutSuccess, onLoginFailure }: Props,
    ref
  ) => {
    const { setOidcToken, getOidcToken } = useApplicationStore();
    const { instance, accounts, inProgress } = useMsal();
    const account = useAccount(accounts[0] || {});
    const MutexRunner = useMutex();
    const mutex = new MutexRunner('fetchIdToken');

    const handleOnLogoutSuccess = () => {
      for (const key in localStorage) {
        if (key.includes('-login.windows.net-') || key.startsWith('msal.')) {
          localStorage.removeItem(key);
        }
      }
      onLogoutSuccess();
    };

    const login = () => {
      try {
        instance.loginPopup(msalLoginRequest);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        onLoginFailure(error as AxiosError);
      }
    };

    const logout = () => {
      handleOnLogoutSuccess();
    };

    const parseResponse = (response: AuthenticationResult): OidcUser => {
      // Call your API with the access token and return the data you need to save in state
      const { idToken, scopes, account } = response;

      const user = {
        id_token: idToken,
        scope: scopes.join(),
        profile: {
          email: get(account, 'idTokenClaims.email', ''),
          name: account?.name || '',
          picture: '',
          preferred_username: get(
            account,
            'idTokenClaims.preferred_username',
            ''
          ),
          sub: get(account, 'idTokenClaims.sub', ''),
        } as UserProfile,
      };

      setOidcToken(idToken);

      return user;
    };

    const fetchIdToken = async (
      shouldFallbackToPopup = false
    ): Promise<OidcUser> => {
      const tokenRequest = {
        account: account || accounts[0], // This is an example - Select account based on your app's requirements
        scopes: msalLoginRequest.scopes,
      };
      try {
        const response = await instance.ssoSilent(tokenRequest);

        return parseResponse(response);
      } catch (error) {
        if (
          error instanceof InteractionRequiredAuthError &&
          shouldFallbackToPopup
        ) {
          const response = await instance
            .loginPopup(tokenRequest)
            .catch((e) => {
              // eslint-disable-next-line no-console
              console.error(e);
              if (e?.message?.includes('popup_window_error')) {
                toast.error(
                  <Transi18next
                    i18nKey="message.popup-block-message"
                    renderElement={
                      <a
                        href={getPopupSettingLink()}
                        rel="noopener noreferrer"
                        target="_blank"
                      />
                    }
                  />
                );
              }

              throw e;
            });

          return parseResponse(response);
        } else {
          // eslint-disable-next-line no-console
          console.error(error);

          throw error;
        }
      }
    };

    const renewIdToken = async () => {
      const user = await fetchIdToken();

      return user.id_token;
    };

    useEffect(() => {
      const oidcUserToken = getOidcToken();
      if (
        !oidcUserToken &&
        inProgress === InteractionStatus.None &&
        (accounts.length > 0 || account?.idTokenClaims)
      ) {
        mutex.run(async () => {
          mutex.lock();
          fetchIdToken(true)
            .then((user) => {
              if ((user as OidcUser).id_token) {
                onLoginSuccess(user as OidcUser);
              }
            })
            .catch(onLoginFailure)
            .finally(() => {
              mutex.unlock();
            });
        });
      }
    }, [inProgress, accounts, instance, account]);

    useImperativeHandle(ref, () => ({
      invokeLogin: login,
      invokeLogout: logout,
      renewIdToken: renewIdToken,
    }));

    return <Fragment>{children}</Fragment>;
  }
);

MsalAuthenticator.displayName = 'MsalAuthenticator';

export default MsalAuthenticator;
