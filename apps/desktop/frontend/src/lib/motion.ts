/**
 * 动效偏好。index.css 已有全局的 `prefers-reduced-motion: reduce` 降级，但那只管
 * CSS 过渡/动画——由 JS 编排的补间（setTimeout / requestAnimationFrame 逐帧改高度）
 * 不受媒体查询约束，必须自己查一次，否则「降低动效」反而只是让人多等。
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
