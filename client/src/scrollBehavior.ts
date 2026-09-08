export const AUTO_SCROLL_THRESHOLD_PX = 48;

export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= AUTO_SCROLL_THRESHOLD_PX;
}