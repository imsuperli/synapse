/**
 * CategoryDropZone - 分类拖拽目标区域组件
 *
 * 包裹 CategoryItem，使其成为拖拽目标。
 * 接受 WINDOW_CARD、SSH_PROFILE_CARD 和 GROUP_CARD 类型的拖拽项。
 * 拖拽悬停时显示高亮效果，放置时调用对应的 store 方法。
 */

import React, { useRef } from 'react';
import { useDrop } from 'react-dnd';
import { DragItemTypes, WindowCardDragItem, GroupCardDragItem, SSHProfileCardDragItem } from './types';
import { useWindowStore } from '../../stores/windowStore';

type DragItem = WindowCardDragItem | GroupCardDragItem | SSHProfileCardDragItem;

interface CategoryDropZoneProps {
  /** 目标分类 ID */
  categoryId: string;
  /** 分类中已有的窗口 ID 列表 */
  windowIds: string[];
  /** 分类中已有的组 ID 列表 */
  groupIds: string[];
  /** 分类中已有的 SSH 配置 ID 列表 */
  sshProfileIds?: string[];
  /** 子元素 */
  children: React.ReactNode;
}

export const CategoryDropZone: React.FC<CategoryDropZoneProps> = ({
  categoryId,
  windowIds,
  groupIds,
  sshProfileIds = [],
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const addWindowToCategory = useWindowStore((s) => s.addWindowToCategory);
  const addGroupToCategory = useWindowStore((s) => s.addGroupToCategory);
  const addSSHProfileToCategory = useWindowStore((s) => s.addSSHProfileToCategory);

  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>({
    accept: [DragItemTypes.WINDOW_CARD, DragItemTypes.GROUP_CARD, DragItemTypes.SSH_PROFILE_CARD],
    canDrop: (item) => {
      if (item.type === DragItemTypes.WINDOW_CARD) {
        // 不允许拖到已包含该窗口的分类
        return !windowIds.includes(item.windowId);
      }
      if (item.type === DragItemTypes.GROUP_CARD) {
        return !groupIds.includes(item.groupId);
      }
      if (item.type === DragItemTypes.SSH_PROFILE_CARD) {
        return !sshProfileIds.includes(item.profileId);
      }
      return false;
    },
    drop: (item) => {
      if (item.type === DragItemTypes.WINDOW_CARD) {
        addWindowToCategory(categoryId, item.windowId);
      } else if (item.type === DragItemTypes.GROUP_CARD) {
        addGroupToCategory(categoryId, item.groupId);
      } else if (item.type === DragItemTypes.SSH_PROFILE_CARD) {
        addSSHProfileToCategory(categoryId, item.profileId);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  });

  drop(ref);

  const showHighlight = isOver && canDrop;

  return (
    <div
      ref={ref}
      style={{
        borderRadius: '8px',
        border: showHighlight ? '2px solid rgba(59, 130, 246, 0.7)' : '2px solid transparent',
        backgroundColor: showHighlight ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
        transition: 'border-color 150ms ease, background-color 150ms ease',
      }}
    >
      {children}
    </div>
  );
};

CategoryDropZone.displayName = 'CategoryDropZone';
