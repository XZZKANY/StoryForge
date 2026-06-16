/**
 * 性能优化配置
 * 减少不必要的重渲染和优化大列表渲染
 */

export const PERF_CONFIG = {
  // 文件树虚拟滚动阈值（节点数超过此值启用虚拟滚动）
  VIRTUAL_SCROLL_THRESHOLD: 500,

  // 历史记录最大数量
  MAX_HISTORY_ITEMS: 20,

  // 项目列表最大数量
  MAX_PROJECTS: 12,

  // 防抖延迟（ms）
  DEBOUNCE_DELAY: 150,

  // 节流延迟（ms）
  THROTTLE_DELAY: 100,
};
