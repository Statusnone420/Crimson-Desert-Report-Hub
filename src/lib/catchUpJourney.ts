export type JourneyBox = { top: number; height: number };

export function containedScrollDeltaFromRects(container: JourneyBox, child: JourneyBox, padding = 0): number {
  const viewTop = container.top + padding;
  const viewBottom = container.top + container.height - padding;
  const childBottom = child.top + child.height;
  if (child.height > container.height - padding * 2) return child.top - viewTop;
  if (child.top < viewTop) return child.top - viewTop;
  if (childBottom > viewBottom) return childBottom - viewBottom;
  return 0;
}

export function scrollChildWithinContainer(container: HTMLElement, child: HTMLElement, padding = 0) {
  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const delta = containedScrollDeltaFromRects(
    { top: containerRect.top, height: container.clientHeight },
    { top: childRect.top, height: childRect.height },
    padding,
  );
  if (delta !== 0) container.scrollTop += delta;
  return delta;
}

export function chapterProgressExtent(chapter: { offsetTop: number; offsetHeight: number } | null | undefined) {
  if (!chapter) return 0;
  return Math.max(0, chapter.offsetTop + chapter.offsetHeight);
}
