import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Image from 'next/image';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import {
  LayoutDashboard,
  Sparkles,
  Bell,
  ClipboardList,
  Users as UsersIcon,
  Settings,
  LogOut,
  Menu
} from 'lucide-react';

import '../app/globals.css';
import { getCurrentUser, logout } from '../lib/api.js';
import { currentRole as fallbackRole } from '../lib/role.js';
import { Button } from '../components/ui/button.jsx';
import { Badge } from '../components/ui/badge.jsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip.jsx';
import { cn } from '../lib/utils.js';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

const ROLE_ORDER = ['viewer', 'operator', 'admin'];

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, minRole: 'viewer' },
  { label: 'Assistant', href: '/assistant', icon: Sparkles, minRole: 'operator' },
  { label: 'Alerts', href: '/alerts', icon: Bell, minRole: 'viewer' },
  { label: 'Logs', href: '/logs', icon: ClipboardList, minRole: 'viewer' },
  { label: 'Users', href: '/users', icon: UsersIcon, minRole: 'admin' },
  { label: 'Settings', href: '/settings', icon: Settings, minRole: 'admin', disabled: true, tooltip: 'Coming soon' }
];

function roleSatisfies(role, minRole) {
  const currentIndex = ROLE_ORDER.indexOf(String(role || 'viewer').toLowerCase());
  const minIndex = ROLE_ORDER.indexOf(String(minRole || 'viewer').toLowerCase());
  if (currentIndex === -1 || minIndex === -1) return false;
  return currentIndex >= minIndex;
}

function roleBadgeVariant(role) {
  const normalized = String(role || 'viewer').toLowerCase();
  if (normalized === 'admin') return 'destructive';
  if (normalized === 'operator') return 'warning';
  return 'secondary';
}

function roleRequirementText(minRole) {
  const normalized = String(minRole || 'viewer').toLowerCase();
  if (normalized === 'admin') return 'Requires Admin';
  if (normalized === 'operator') return 'Requires Operator';
  return 'Requires Viewer';
}

export default function ArgusApp({ Component, pageProps }) {
  const router = useRouter();
  const [role, setRole] = useState(fallbackRole);
  const [currentUser, setCurrentUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const authRoutes = ['/login', '/change-password'];
  const isAuthRoute = authRoutes.includes(router.pathname);

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      try {
        const user = await getCurrentUser();
        if (cancelled) return;
        setCurrentUser(user);
        const normalized = String(user?.role || fallbackRole).toLowerCase();
        setRole(normalized);
        if (user?.mustChangePassword && !authRoutes.includes(router.pathname)) {
          router.replace(`/change-password?username=${encodeURIComponent(user.username || '')}`);
        }
      } catch (error) {
        if (cancelled) return;
        setCurrentUser(null);
        setRole('viewer');
        if (error?.status === 401 && !authRoutes.includes(router.pathname)) {
          router.replace('/login');
        }
      }
    }

    if (!isAuthRoute) {
      loadRole();
    }

    return () => {
      cancelled = true;
    };
  }, [router.pathname, router]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleRouteChange = () => setSidebarOpen(false);
    router.events?.on('routeChangeComplete', handleRouteChange);
    return () => {
      router.events?.off('routeChangeComplete', handleRouteChange);
    };
  }, [sidebarOpen, router.events]);

  const handleLogout = async () => {
    if (logoutLoading) return;
    setLogoutLoading(true);
    try {
      await logout();
      setCurrentUser(null);
      setRole('viewer');
      router.replace('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setLogoutLoading(false);
    }
  };

  const shell = (
    <div className="flex h-screen bg-background text-foreground">
      <TooltipProvider>
        <Sidebar
          navItems={NAV_ITEMS}
          role={role}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          pathname={router.pathname}
        />
      </TooltipProvider>
      <div className="flex flex-1 flex-col">
        {!isAuthRoute && (
          <Header
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            onLogout={handleLogout}
            logoutLoading={logoutLoading}
            role={role}
          />
        )}
        <main className="flex-1 overflow-y-auto bg-background/80 px-4 py-6 sm:px-6 md:px-10">
          <Component {...pageProps} currentUser={currentUser} userRole={role} />
        </main>
      </div>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );

  return (
    <div className={cn(inter.variable, 'min-h-screen bg-background font-sans text-foreground')}>
      {isAuthRoute ? (
        <Component {...pageProps} />
      ) : (
        shell
      )}
    </div>
  );
}

function Sidebar({ navItems, role, sidebarOpen, setSidebarOpen, pathname }) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border/70 bg-card/95 p-6 backdrop-blur transition-transform duration-200 ease-out md:static md:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      )}
    >
      <div className="mb-8 flex items-center gap-3 text-lg font-semibold tracking-tight text-foreground">
        <Image src="/argus-logo.png" alt="Argus" width={140} height={44} className="h-auto w-[140px]" />
      </div>
      <nav className="mt-2 flex flex-1 flex-col gap-1 text-sm">
        {navItems.map((item) => {
          const Icon = item.icon;
          const allowed = roleSatisfies(role, item.minRole);
          const disabled = item.disabled || !allowed;
          const tooltipText = item.tooltip || (!allowed ? roleRequirementText(item.minRole) : null);
          const isActive = !disabled && pathname === item.href;
          const content = (
            <span
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                isActive && !disabled
                  ? 'bg-secondary/40 text-foreground shadow-soft'
                  : 'text-muted-foreground hover:bg-secondary/20 hover:text-foreground',
                disabled && 'cursor-not-allowed text-muted-foreground/60 hover:bg-transparent hover:text-muted-foreground/60'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </span>
          );

          if (disabled) {
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <span>{content}</span>
                </TooltipTrigger>
                {tooltipText && <TooltipContent>{tooltipText}</TooltipContent>}
              </Tooltip>
            );
          }

          return (
            <Link key={item.label} href={item.href} onClick={() => setSidebarOpen(false)}>
              {content}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function Header({ onToggleSidebar, onLogout, logoutLoading, role }) {
  const badgeVariant = roleBadgeVariant(role);
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/70 bg-background/90 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6 md:px-10">
      <div className="flex items-center gap-3">
        <Button type="button" size="icon" variant="outline" className="md:hidden" onClick={onToggleSidebar}>
          <Menu className="h-4 w-4" />
        </Button>
        <h1 className="hidden text-lg font-semibold tracking-tight text-muted-foreground md:block">Argus Control Plane</h1>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={badgeVariant} className="capitalize">
          {roleLabel}
        </Badge>
        <Button type="button" variant="outline" onClick={onLogout} disabled={logoutLoading}>
          <LogOut className="mr-2 h-4 w-4" />
          {logoutLoading ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </header>
  );
}
