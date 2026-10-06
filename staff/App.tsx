import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';

import { colors, fonts } from './src/theme';
import { detectLang, Lang, LangContext, useT, UIKey } from './src/i18n';
import { api, loadToken, logout, Me, setExpiredHandler } from './src/api';
import { can, Session, SessionCtx, Tab } from './src/session';
import { registerPush } from './src/push';
import { ErrorBox, IconName, Loading } from './src/components/ui';
import Login from './src/screens/Login';
import Schedule from './src/screens/Schedule';
import Orders from './src/screens/Orders';
import OrderDetail from './src/screens/OrderDetail';
import WebCrm from './src/screens/WebCrm';
import Profile from './src/screens/Profile';

SplashScreen.preventAutoHideAsync().catch(() => {});

const TABS: { id: Tab; icon: IconName; label: UIKey; perm?: string }[] = [
  { id: 'schedule', icon: 'calendar-outline', label: 'tabSchedule', perm: 'calendar.view' },
  { id: 'orders', icon: 'construct-outline', label: 'tabOrders', perm: 'orders.view' },
  { id: 'quotes', icon: 'document-text-outline', label: 'tabQuotes', perm: 'quotes.manage' },
  { id: 'crm', icon: 'desktop-outline', label: 'tabCrm' },
  { id: 'more', icon: 'person-circle-outline', label: 'tabMore' },
];

export default function App() {
  const [loaded] = useFonts({
    'PulsecarSans-Regular': require('./assets/fonts/PulsecarSans-Regular.ttf'),
    'PulsecarSans-Medium': require('./assets/fonts/PulsecarSans-Medium.ttf'),
    'PulsecarSans-SemiBold': require('./assets/fonts/PulsecarSans-SemiBold.ttf'),
    'PulsecarSans-Bold': require('./assets/fonts/PulsecarSans-Bold.ttf'),
  });
  const [lang, setLangState] = useState<Lang>(detectLang);
  useEffect(() => { if (Platform.OS !== 'web') SecureStore.getItemAsync('pc_lang').then((l) => l && setLangState(l as Lang)).catch(() => {}); }, []);
  const langCtx = useMemo(() => ({ lang, setLang: (l: Lang) => { setLangState(l); if (Platform.OS !== 'web') SecureStore.setItemAsync('pc_lang', l).catch(() => {}); } }), [lang]);

  useEffect(() => { if (loaded) SplashScreen.hideAsync().catch(() => {}); }, [loaded]);
  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <LangContext.Provider value={langCtx}>
        <StatusBar style="light" />
        <SafeAreaView style={st.root} edges={['top', 'left', 'right']}>
          <Root />
        </SafeAreaView>
      </LangContext.Provider>
    </SafeAreaProvider>
  );
}

function Root() {
  const t = useT();
  const [phase, setPhase] = useState<'boot' | 'login' | 'app'>('boot');
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    setErr(null);
    try { setMe(await api<Me>('/me')); setPhase('app'); } catch (e) { setErr((e as Error).message); }
  }, []);

  useEffect(() => {
    setExpiredHandler(() => { setMe(null); setNotice(t('sessionExpired')); setPhase('login'); });
    loadToken().then((tok) => (tok ? loadMe() : setPhase('login')));
  }, []);

  if (phase === 'login') return <Login notice={notice} onDone={() => { setNotice(null); setPhase('boot'); loadMe(); }} />;
  if (!me) return err ? <ErrorBox error={err} onRetry={loadMe} /> : <Loading />;
  return <Main me={me} reloadMe={loadMe} onSignOut={async () => { await logout(); setMe(null); setPhase('login'); }} />;
}

function Main({ me, reloadMe, onSignOut }: { me: Me; reloadMe: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const t = useT();
  const tabs = TABS.filter((x) => !x.perm || can(me, x.perm));
  const [tab, setTab] = useState<Tab>(tabs[0].id);
  const [stack, setStack] = useState<number[]>([]);
  const [crmPath, setCrmPath] = useState('');
  const [crmSeen, setCrmSeen] = useState(false);

  const go = (x: Tab) => { setStack([]); setTab(x); if (x === 'crm') setCrmSeen(true); };
  const ctx: SessionCtx = useMemo(() => ({
    me, reloadMe, signOut: onSignOut,
    openOrder: (id) => setStack((s) => [...s, id]),
    openCrm: (p = '') => { setCrmPath(p + (p.includes('?') ? '&' : '?') + '_=' + Date.now()); setCrmSeen(true); setStack([]); setTab('crm'); },
    go,
  }), [me]);

  // push: разрешение спрашиваем после входа; нажатие на уведомление открывает заказ / терминарз
  useEffect(() => { registerPush(true).catch(() => {}); }, []);
  const last = Platform.OS === 'web' ? null : Notifications.useLastNotificationResponse();
  useEffect(() => {
    const d: any = last?.notification.request.content.data;
    if (!d) return;
    if (d.order_id) ctx.openOrder(Number(d.order_id));
    else if (d.event === 'booking' && tabs.some((x) => x.id === 'schedule')) go('schedule');
  }, [last]);

  // кнопка «Назад» на Android закрывает карточку заказа
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) { setStack((s) => s.slice(0, -1)); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length]);

  const top = stack[stack.length - 1];
  return (
    <Session.Provider value={ctx}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, display: top ? 'none' : 'flex' }}>
          {tab === 'schedule' && <Schedule />}
          {tab === 'orders' && <Orders kind="order" key="o" />}
          {tab === 'quotes' && <Orders kind="quote" key="q" />}
          {tab === 'more' && <Profile />}
          {crmSeen && <View style={{ flex: 1, display: tab === 'crm' ? 'flex' : 'none' }}><WebCrm path={crmPath} active={tab === 'crm'} /></View>}
        </View>
        {top ? <OrderDetail key={top + '-' + stack.length} id={top} onBack={() => setStack((s) => s.slice(0, -1))} /> : null}
      </View>
      <SafeAreaView edges={['bottom']} style={st.tabbar}>
        {tabs.map((x) => {
          const on = tab === x.id && !top;
          return (
            <Pressable key={x.id} onPress={() => go(x.id)} style={st.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t(x.label)}>
              <Ionicons name={on ? (x.icon.replace('-outline', '') as IconName) : x.icon} size={23} color={on ? colors.accent : colors.muted} />
              <Text style={[st.tabText, on && { color: colors.accent }]} numberOfLines={1}>{t(x.label)}</Text>
            </Pressable>
          );
        })}
      </SafeAreaView>
    </Session.Provider>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabbar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  tab: { flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 6, gap: 2 },
  tabText: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted },
});
