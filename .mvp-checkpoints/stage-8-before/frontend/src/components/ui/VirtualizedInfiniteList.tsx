import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

interface VirtualizedInfiniteListProps<T> {
  items: T[];
  estimateSize?: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  renderItem: (item: T, index: number) => ReactNode;
}

export function VirtualizedInfiniteList<T>({
  items,
  estimateSize = 112,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  renderItem,
}: VirtualizedInfiniteListProps<T>) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(580);
  const overscan = 6;

  useEffect(() => {
    const element = parentRef.current;
    if (!element) {
      return;
    }

    const measure = () => setViewportHeight(element.clientHeight || 580);
    measure();

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());

    resizeObserver?.observe(element);
    window.addEventListener("resize", measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / estimateSize) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / estimateSize) + overscan,
  );
  const totalSize = items.length * estimateSize;
  const virtualItems = useMemo(
    () =>
      items.slice(startIndex, endIndex).map((item, offset) => {
        const index = startIndex + offset;
        return {
          index,
          item,
          key: index,
          start: index * estimateSize,
        };
      }),
    [endIndex, estimateSize, items, startIndex],
  );

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || !onLoadMore) {
      return;
    }

    if (endIndex >= items.length - 2) {
      onLoadMore();
    }
  }, [endIndex, hasNextPage, isFetchingNextPage, items.length, onLoadMore]);

  return (
    <div
      ref={parentRef}
      className="virtual-list-shell"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        style={{
          height: `${Math.max(totalSize, viewportHeight)}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(virtualItem.item, virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
