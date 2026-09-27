import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getLocales } from 'expo-localization';
import { useFonts } from 'expo-font';

import { colors, fonts } from './src/theme';
import { Lang, LANGS, LangContext, useT, UIKey } from './src/i18n';
import { NavContext, Overlay, Tab } from './src/nav';
import { IconName, Logo } from './src/components/ui';
import Home from './src/screens/Home';
import Prices from './src/screens/Prices';
import Test from './src/screens/Test';
import Booking from './src/screens/Booking';
import Contact from './src/screens/Contact';
import Referral from './src/screens/Referral';
import CardScreen from './src/screens/CardScreen';
import Profile from './src/screens/Profile';
import { AccountProvider } from './src/account';

function detectLang(): Lang {
  const code = getLocales()[0]?.languageCode ?? 'pl';
  if (code === 'pl' || code === 'en' || code === 'uk' || code === 'ru') return code;
  if (code === 'be') return 'ru';
  return 'en';
}

const TABS: { id: Tab; icon: IconName; label: UIKey }[] = [
  { id: 'home', icon: 'home-outline', label: 'tabHome' },
  { id: 'prices', icon: 'pricetags-outline', label: 'tabPrices' },
  { id: 'card', icon: 'qr-code-outline', label: 'tabCard' },
  { id: 'booking', icon: 'calendar-outline', label: 'tabBooking' },
  { id: 'profile', icon: 'person-outline', label: 'tabProfile' },
];

export default function App() {
  const [loaded] = useFonts({
    'PulsecarSans-Regular': require('./assets/fonts/PulsecarSans-Regular.ttf'),
    'PulsecarSans-Medium': require('./assets/fonts/PulsecarSans-Medium.ttf'),
    'PulsecarSans-SemiBold': require('./assets/fonts/PulsecarSans-SemiBold.ttf'),
    'PulsecarSans-Bold': require('./assets/fonts/PulsecarSans-Bold.ttf'),
  });
  const [lang, setLang] = useState<Lang>(detectLang);
  const [tab, setTab] = useState<Tab>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [bookingPreset, setPreset] = useState<{ service?: string; note?: string; key: number }>({ key: 0 });

  const nav = useMemo(
    () => ({
      go: (t: Tab, opts?: { service?: string; note?: string }) => {
        if (opts) setPreset((p) => ({ ...opts, key: p.key + 1 }));
        setOverlay(null);
        setTab(t);
      },
      openOverlay: setOverlay,
      bookingPreset,
    }),
    [bookingPreset],
  );

  // Android: кнопка «назад» закрывает подэкран или возвращает на главную
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlay) { setOverlay(null); return true; }
      if (tab !== 'home') { setTab('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [overlay, tab]);

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AccountProvider>
      <LangContext.Provider value={{ lang, setLang }}>
        <NavContext.Provider value={nav}>
          <StatusBar style="light" />
          <SafeAreaView style={st.root} edges={['top', 'left', 'right']}>
            <Header overlay={overlay} onBack={() => setOverlay(null)} />
            <View style={{ flex: 1 }}>
              {overlay === 'referral' && <Referral />}
              {overlay === 'test' && <Test />}
              {overlay === 'contact' && <Contact />}
              {!overlay && (
                <>
                  {tab === 'home' && <Home />}
                  {tab === 'prices' && <Prices />}
                  {tab === 'card' && <CardScreen />}
                  {tab === 'booking' && <Booking />}
                  {tab === 'profile' && <Profile />}
                </>
              )}
            </View>
          </SafeAreaView>
          <TabBar tab={overlay ? null : tab} onTab={(t) => { setOverlay(null); setTab(t); }} />
        </NavContext.Provider>
      </LangContext.Provider>
      </AccountProvider>
    </SafeAreaProvider>
  );
}

function Header({ overlay, onBack }: { overlay: Overlay; onBack: () => void }) {
  const { lang, t } = useT();
  const { setLang } = React.useContext(LangContext);
  return (
    <View style={st.header}>
      {overlay ? (
        <Pressable onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={st.backText}>{t('back')}</Text>
        </Pressable>
      ) : (
        <Logo />
      )}
      <View style={st.langs}>
        {LANGS.map((l) => (
          <Pressable key={l.code} onPress={() => setLang(l.code)} style={[st.lang, lang === l.code && st.langOn]} hitSlop={4}>
            <Text style={[st.langText, lang === l.code && { color: colors.onAccent }]}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function TabBar({ tab, onTab }: { tab: Tab | null; onTab: (t: Tab) => void }) {
  const { t } = useT();
  return (
    <SafeAreaView edges={['bottom']} style={st.tabbar}>
      <View style={{ flexDirection: 'row' }}>
        {TABS.map((x) => {
          const on = tab === x.id;
          const center = x.id === 'card';
          return (
            <Pressable key={x.id} onPress={() => onTab(x.id)} style={st.tabBtn} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <View style={[center && st.centerIcon, center && on && { backgroundColor: colors.accent }]}>
                <Ionicons
                  name={(on ? x.icon.replace('-outline', '') : x.icon) as IconName}
                  size={22}
                  color={center ? (on ? colors.onAccent : colors.accent) : on ? colors.accent : colors.muted}
                />
              </View>
              <Text style={[st.tabText, on && { color: colors.accent }]} numberOfLines={1}>{t(x.label)}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backText: { fontFamily: fonts.medium, color: colors.text, fontSize: 15 },
  langs: { flexDirection: 'row', gap: 4, backgroundColor: colors.surface, borderRadius: 8, padding: 3 },
  lang: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  langOn: { backgroundColor: colors.accent },
  langText: { fontFamily: fonts.semibold, color: colors.muted, fontSize: 12 },
  tabbar: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 6, gap: 3 },
  centerIcon: {
    width: 40, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.accent,
  },
  tabText: { fontFamily: fonts.medium, color: colors.muted, fontSize: 11 },
});
