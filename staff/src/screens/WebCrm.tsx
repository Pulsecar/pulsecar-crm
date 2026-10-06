import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api, PANEL } from '../api';
import { useT } from '../i18n';
import { colors } from '../theme';
import { ErrorBox, Header, IconBtn, Loading, openUrl } from '../components/ui';

/** Полная CRM (тот же panel.pulsecar.tech) внутри приложения: вход — одноразовым кодом, без повторного ввода пароля */
export default function WebCrm({ path, active }: { path: string; active: boolean }) {
  const t = useT();
  const ref = useRef<WebView>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [canBack, setCanBack] = useState(false);

  const open = useCallback(async (to: string) => {
    setErr(null);
    try {
      const j = await api<{ url: string }>('/mobile/web', { body: { to } });
      setUrl(j.url + '?t=' + Date.now());
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { if (active) open(path); }, [path, active, open]);

  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canBack) { ref.current?.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [active, canBack]);

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('tabCrm')}
        left={canBack ? <IconBtn name="chevron-back" label={t('back')} onPress={() => ref.current?.goBack()} /> : undefined}
        right={<IconBtn name="refresh" label={t('retry')} onPress={() => (url ? ref.current?.reload() : open(path))} />} />
      {err ? <ErrorBox error={err} onRetry={() => open(path)} /> : !url ? <Loading /> : (
        <WebView
          ref={ref}
          source={{ uri: url }}
          style={{ flex: 1, backgroundColor: colors.bg }}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          setSupportMultipleWindows={false}
          pullToRefreshEnabled
          startInLoadingState
          renderLoading={() => <View style={{ position: 'absolute', inset: 0 }}><Loading /></View>}
          onNavigationStateChange={(n) => setCanBack(n.canGoBack)}
          // ссылки на звонок / SMS / почту / другие сайты — во внешние приложения
          onShouldStartLoadWithRequest={(r) => {
            if (r.url.startsWith(PANEL) || r.url.startsWith('about:') || r.url.startsWith('blob:') || r.url.startsWith('data:')) return true;
            openUrl(r.url);
            return false;
          }}
        />
      )}
    </View>
  );
}
