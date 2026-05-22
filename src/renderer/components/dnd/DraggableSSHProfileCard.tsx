import React, { useRef } from 'react';
import { useDrag } from 'react-dnd';
import { DragItemTypes, SSHProfileCardDragItem } from './types';

interface DraggableSSHProfileCardProps {
  profileId: string;
  profileName: string;
  children: React.ReactNode;
}

export const DraggableSSHProfileCard: React.FC<DraggableSSHProfileCardProps> = ({
  profileId,
  profileName,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag<SSHProfileCardDragItem, unknown, { isDragging: boolean }>({
    type: DragItemTypes.SSH_PROFILE_CARD,
    item: {
      type: DragItemTypes.SSH_PROFILE_CARD,
      profileId,
      profileName,
      source: 'cardGrid',
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  drag(ref);

  return (
    <div
      ref={ref}
      className="h-full w-full"
      style={{
        opacity: isDragging ? 0.4 : 1,
        cursor: 'grab',
      }}
    >
      {children}
    </div>
  );
};

DraggableSSHProfileCard.displayName = 'DraggableSSHProfileCard';
