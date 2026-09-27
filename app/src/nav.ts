import { createContext, useContext } from 'react';

export type Tab = 'home' | 'prices' | 'card' | 'booking' | 'profile';
export type Overlay = 'referral' | 'test' | 'contact' | null;

export type Nav = {
  go: (tab: Tab, opts?: { service?: string; note?: string }) => void;
  openOverlay: (o: Overlay) => void;
  bookingPreset: { service?: string; note?: string; key: number };
};

export const NavContext = createContext<Nav>({
  go: () => {},
  openOverlay: () => {},
  bookingPreset: { key: 0 },
});
export const useNav = () => useContext(NavContext);
