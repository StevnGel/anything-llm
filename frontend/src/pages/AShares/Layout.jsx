import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { NavLink, Outlet } from "react-router-dom";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import PasswordModal, { usePasswordModal } from "@/components/Modals/Password";
import { FullScreenLoader } from "@/components/Preloader";
import paths from "@/utils/paths";
import "./ashares.css";

const ASharesContext = createContext(null);

export function useASharesView() {
  return useContext(ASharesContext);
}

const NAVIGATION = [
  { label: "股票工作台", to: paths.ashares.home(), end: true },
  { label: "多股比较", to: paths.ashares.compare() },
  { label: "标签与分组", to: paths.ashares.collections() },
  { label: "数据浏览", to: paths.ashares.data() },
  { label: "数据中心", to: paths.ashares.dataCenter() },
];

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 900px)").matches
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const handleChange = () => setNarrow(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);
  return narrow;
}

export default function ASharesLayout() {
  const { loading, requiresAuth, mode } = usePasswordModal();
  const narrow = useNarrowViewport();
  const [compareSymbols, setCompareSymbols] = useState([]);
  const context = useMemo(
    () => ({ compareSymbols, setCompareSymbols }),
    [compareSymbols]
  );

  if (loading) return <FullScreenLoader />;
  if (requiresAuth !== false) {
    return <>{requiresAuth !== null && <PasswordModal mode={mode} />}</>;
  }

  return (
    <ASharesContext.Provider value={context}>
      <div className="ashares-shell">
        {narrow ? <SidebarMobileHeader /> : <Sidebar />}
        <main className="ashares-main">
          <header className="ashares-topbar">
            <div className="ashares-topbar-title">A 股</div>
            <nav aria-label="A 股页面" className="ashares-nav">
              {NAVIGATION.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `ashares-nav-link${isActive ? " active" : ""}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </header>
          <div className="ashares-page">
            <Outlet />
          </div>
        </main>
      </div>
    </ASharesContext.Provider>
  );
}
