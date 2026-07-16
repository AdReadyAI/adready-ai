import type { ReactNode } from "react";

type MediaGridProps<T> = {
  items: T[];
  renderItem: (item: T) => ReactNode;
};

export default function MediaGrid<T>({ items, renderItem }: MediaGridProps<T>) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
      {items.map((item) => renderItem(item))}
    </div>
  );
}
