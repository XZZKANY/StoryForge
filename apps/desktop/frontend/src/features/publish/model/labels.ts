import type { PipelineStatus, PlatformSessionStatus, RiskStatus } from './types';

export function pipelineStatusLabel(status: PipelineStatus): string {
  switch (status) {
    case 'idea':
      return '构思';
    case 'writing':
      return '写作中';
    case 'polish':
      return '打磨';
    case 'ready':
      return '可排期';
    case 'scheduled':
      return '已排期';
    case 'opened':
      return '已开书';
    case 'serializing':
      return '连载中';
    case 'dropped':
      return '已止损';
    default:
      return status;
  }
}

export function riskStatusLabel(status: RiskStatus): string {
  switch (status) {
    case 'normal':
      return '正常';
    case 'watch':
      return '观察';
    case 'blocked':
      return '熔断';
    default:
      return status;
  }
}

export function sessionStatusLabel(status: PlatformSessionStatus): string {
  switch (status) {
    case 'pending':
      return '待确认';
    case 'logged_in':
      return '已登录';
    case 'logged_out':
      return '已退出';
    case 'expired':
      return '可能失效';
    default:
      return '未知';
  }
}
