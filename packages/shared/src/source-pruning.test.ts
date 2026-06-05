// @ts-expect-error shared 根出口不应继续导出手写 API 错误响应类型。
import type { ApiErrorResponse } from './index';

// @ts-expect-error shared 根出口不应继续导出手写 Provider 能力类型。
import type { ProviderCapability } from './index';

// @ts-expect-error shared 根出口不应继续导出手写 Provider 解析类型。
import type { ProviderResolution } from './index';

// @ts-expect-error shared 根出口不应继续导出手写 JobRun 摘要类型。
import type { JobRunSummary } from './index';

export type SharedRootPruningSentinel =
  | ApiErrorResponse
  | ProviderCapability
  | ProviderResolution
  | JobRunSummary;
