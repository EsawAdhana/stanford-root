import React from 'react';
import { User } from 'lucide-react';

interface InstructorListProps {
  instructors: string[];
  limit?: number;
}

export function InstructorList({ instructors, limit = 5 }: InstructorListProps) {
  if (!instructors || instructors.length === 0) {
    return (
      <div className="flex items-center gap-2" title="Unknown Instructor">
        <User size={14} className="shrink-0" />
        <span className="truncate">Unknown Instructor</span>
      </div>
    );
  }

  const displayed = instructors.slice(0, limit);
  const remaining = instructors.length - limit;

  return (
    <div className="flex items-center gap-2 min-w-0" title={instructors.join(', ')}>
      <User size={14} className="shrink-0" />
      <div className="text-xs break-words">
        {displayed.join(', ')}
        {remaining > 0 && <span className="text-muted-foreground ml-1">+{remaining} more</span>}
      </div>
    </div>
  );
}
