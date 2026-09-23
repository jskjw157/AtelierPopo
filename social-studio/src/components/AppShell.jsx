import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity, BarChart3, CalendarDays, ChevronLeft, ChevronRight, FileImage,
  LayoutDashboard, LogOut, Menu, Package, PenSquare, Plug, Settings, X, Megaphone
} from 'lucide-react';
import { api, classNames } from '../lib/api.js';

const links = [
  ['/dashboard', '대시보드', LayoutDashboard],
  ['/compose', '콘텐츠 작성', PenSquare],
  ['/calendar', '예약 캘린더', CalendarDays],
  ['/library', '미디어', FileImage],
  ['/products', '상품', Package],
  ['/accounts', '계정 연동', Plug],
  ['/analytics', '성과', BarChart3],
  ['/ads', '광고 관리', Megaphone],
  ['/activity', '활동 기록', Activity],
  ['/settings', '설정', Settings]
];

export default function AppShell({ user, onLogout }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    onLogout();
  }

  const nav = (
    <>
      <div className="brand-block">
        <div className="brand-mark">H</div>
        {!collapsed ? <div><strong>HAAR</strong><span>Social Studio</span></div> : null}
        <button className="icon-button desktop-only" onClick={() => setCollapsed((value) => !value)} aria-label="사이드바 접기">
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>
        <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)} aria-label="메뉴 닫기"><X size={19} /></button>
      </div>
      <nav className="side-nav">
        {links.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} onClick={() => setMobileOpen(false)} className={({ isActive }) => classNames('nav-link', isActive && 'active')}>
            <Icon size={19} />
            {!collapsed ? <span>{label}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        {!collapsed ? <div className="user-summary"><span>{user.email}</span><small>{user.role}</small></div> : null}
        <button className="nav-link button-reset" onClick={logout}><LogOut size={19} />{!collapsed ? <span>로그아웃</span> : null}</button>
      </div>
    </>
  );

  return (
    <div className={classNames('app-layout', collapsed && 'sidebar-collapsed')}>
      <aside className="sidebar desktop-sidebar">{nav}</aside>
      {mobileOpen ? <div className="mobile-drawer"><div className="drawer-scrim" onClick={() => setMobileOpen(false)} /><aside className="sidebar">{nav}</aside></div> : null}
      <main className="main-area">
        <header className="mobile-header"><button className="icon-button" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><strong>HAAR</strong><span>Social Studio</span></header>
        <Outlet />
      </main>
    </div>
  );
}
