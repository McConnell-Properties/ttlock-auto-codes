import DashboardTabs from './tabs';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <DashboardTabs />
      {children}
    </div>
  );
}
