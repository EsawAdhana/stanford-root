import React from 'react';
import { cn } from '@/lib/utils';
import { Check, ChevronDown } from 'lucide-react';
import * as Collapsible from '@radix-ui/react-collapsible';

interface FilterGroupProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function FilterGroup({ title, children, defaultOpen = true }: FilterGroupProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="border-b py-4 px-4 last:border-b-0">
      <Collapsible.Trigger className="flex items-center justify-between w-full font-semibold text-sm hover:text-primary transition-colors">
        {title}
        <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen ? "transform rotate-180" : "")} />
      </Collapsible.Trigger>
      <Collapsible.Content className="pt-2 space-y-1">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

interface CheckboxItemProps {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}

export function CheckboxItem({ label, count, checked, onChange }: CheckboxItemProps) {
  return (
    <button
      onClick={onChange}
      className="flex items-center w-full group py-1"
    >
      <div className={cn(
        "h-4 w-4 border rounded mr-2 flex items-center justify-center transition-colors",
        checked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground group-hover:border-primary"
      )}>
        {checked && <Check size={10} strokeWidth={3} />}
      </div>
      <span className={cn("text-sm flex-1 text-left", checked ? "font-medium text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </button>
  );
}
