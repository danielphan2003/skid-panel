/**
 * OpenCode Go quota data layer. React-free / SCSS-free.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, OpencodeGoQuotaState } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  OPENCODE_GO_PROVIDER,
  OPENCODE_GO_REQUEST_HEADERS,
  OPENCODE_GO_USAGE_URL,
  parseOpencodeGoUsage,
} from '@/services/api/opencodeGoQuota';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import { createStatusError, isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

type OpencodeGoQuotaData = Pick<OpencodeGoQuotaState, 'windows'>;

export const isOpencodeGoFile = (file: AuthFileItem) =>
  resolveAuthProvider(file) === OPENCODE_GO_PROVIDER;

const fetchOpencodeGoQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<OpencodeGoQuotaData> => {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) {
    throw new Error(t('opencode_go_quota.missing_auth_index'));
  }

  const generation = captureQuotaCacheGeneration(file.name);
  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: OPENCODE_GO_USAGE_URL,
    header: { ...OPENCODE_GO_REQUEST_HEADERS },
  });
  if (!commitIfQuotaCacheCurrent(generation, () => {})) {
    throw new Error(t('opencode_go_quota.stale_request'));
  }

  if (result.statusCode === 401 || result.statusCode === 403) {
    throw createStatusError(t('opencode_go_quota.unauthorized'), result.statusCode);
  }
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const windows = parseOpencodeGoUsage(result.body ?? result.bodyText);
  if (!windows) {
    throw new Error(t('opencode_go_quota.empty_data'));
  }
  return { windows };
};

export const OPENCODE_GO_CONFIG: QuotaProviderData<OpencodeGoQuotaState, OpencodeGoQuotaData> = {
  type: 'opencode-go',
  i18nPrefix: 'opencode_go_quota',
  filterFn: (file) => isOpencodeGoFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchOpencodeGoQuota,
  storeSelector: (state) => state.opencodeGoQuota,
  storeSetter: 'setOpencodeGoQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
};
