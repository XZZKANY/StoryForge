import { DEFAULT_PUBLISH_SETTINGS } from '../../model/types';
import type { PlatformPack } from '../types';
import {
  FANQIE_CHECKLIST_LABELS,
  FANQIE_DEFAULT_SETTINGS,
  FANQIE_OPEN_PACK_README,
  FANQIE_PACK_ID,
} from './defaults';
import {
  FANQIE_AUTHOR_HOME_URL,
  FANQIE_LOGIN_URL,
  FANQIE_OPEN_URL_ALLOWLIST,
  isAllowedFanqieUrl,
} from './urls';
import { FANQIE_API_BASE_URL, FANQIE_API_ENDPOINTS } from './api';

export const fanqiePack: PlatformPack = {
  id: FANQIE_PACK_ID,
  label: '番茄小说',
  ready: true,
  defaultMonthlyOpenLimit: FANQIE_DEFAULT_SETTINGS.defaultMonthlyOpenLimit,
  settingsDefaults: {
    ...FANQIE_DEFAULT_SETTINGS,
    defaultPlatform: FANQIE_PACK_ID,
  },
  checklistLabels: FANQIE_CHECKLIST_LABELS,
  openPackReadme: FANQIE_OPEN_PACK_README,
  authorHomeUrl: FANQIE_AUTHOR_HOME_URL,
  loginUrl: FANQIE_LOGIN_URL,
  openUrlAllowlist: FANQIE_OPEN_URL_ALLOWLIST,
  isAllowedOpenUrl: isAllowedFanqieUrl,
  apiBaseUrl: FANQIE_API_BASE_URL,
  apiEndpoints: FANQIE_API_ENDPOINTS,
};

export {
  FANQIE_PACK_ID,
  FANQIE_DEFAULT_SETTINGS,
  FANQIE_CHECKLIST_LABELS,
  FANQIE_OPEN_PACK_README,
  FANQIE_AUTHOR_HOME_URL,
  FANQIE_LOGIN_URL,
  FANQIE_OPEN_URL_ALLOWLIST,
  isAllowedFanqieUrl,
  DEFAULT_PUBLISH_SETTINGS,
};
