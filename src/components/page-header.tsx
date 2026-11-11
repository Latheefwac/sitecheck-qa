export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b px-4 pb-5 pt-16 sm:flex-row sm:items-end sm:justify-between md:px-8 md:pt-8">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const PageBody = ({ children }: { children: React.ReactNode }) => <div className="space-y-6 px-4 py-6 md:px-8">{children}</div>;
