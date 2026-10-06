import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { api, PANEL } from '../api';
import { LANGS, UIKey, useLang, useT } from '../i18n';
import { pushState, PushState, registerPush } from '../push';
import { useSession } from '../session';
import { colors } from '../theme';
import { Button, Card, Header, IconName, openUrl, Section, Txt } from '../components/ui';

export default function Profile() {
  const t = useT();
  const { lang, setLang } = useLang();
  const { me, signOut } = useSession();
  const [dev, setDev] = useState<{ events: string[]; available: string[] } | null>(null);
  const [push, setPush] = useState<PushState>('undetermined');

  const load = useCallback(async () => {
    setPush(await pushState());
    try { setDev(await api('/mobile/device')); } catch {}
  }, []);
  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load()); // вернулись из настроек телефона
    return () => sub.remove();
  }, [load]);

  const toggle = async (ev: string, on: boolean) => {
    if (!dev) return;
    const events = on ? [...new Set([...dev.events, ev])] : dev.events.filter((e) => e !== ev);
    setDev({ ...dev, events });
    try { await api('/mobile/device', { method: 'PUT', body: { events } }); } catch { load(); }
  };
  const confirmLogout = () => Alert.alert(t('logout'), t('logoutConfirm'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('logout'), style: 'destructive', onPress: () => signOut() },
  ]);
  const link = (icon: IconName, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={st.link} accessibilityRole="link">
      <Ionicons name={icon} size={20} color={colors.muted} />
      <Txt style={{ flex: 1 }}>{label}</Txt>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('tabMore')} />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        <Card>
          <Txt bold size={18}>{me.user.name}</Txt>
          <Txt muted>{t(('role_' + me.user.role) as UIKey)} · {me.user.login}</Txt>
          <Txt muted size={13} style={{ marginTop: 4 }}>{t('branch')}: {me.branch.name}</Txt>
        </Card>

        <Section title={t('notifications')}>
          <Card>
            {push === 'granted' ? (dev?.available || []).map((ev) => (
              <View key={ev} style={st.switchRow}>
                <Txt style={{ flex: 1 }}>{t(('ev_' + ev) as UIKey)}</Txt>
                <Switch value={dev!.events.includes(ev)} onValueChange={(v) => toggle(ev, v)} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#fff" />
              </View>
            )) : push === 'denied' ? (
              <>
                <Txt muted>{t('pushOff')}</Txt>
                <Button small variant="outline" icon="settings-outline" title={t('openSettings')} onPress={() => Linking.openSettings()} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
              </>
            ) : push === 'undetermined' ? (
              <Button small icon="notifications-outline" title={t('enablePush')} onPress={async () => setPush(await registerPush(true))} style={{ alignSelf: 'flex-start' }} />
            ) : <Txt muted>—</Txt>}
          </Card>
        </Section>

        <Section title={t('language')}>
          <View style={st.langs}>
            {LANGS.map((l) => (
              <Pressable key={l.code} onPress={() => setLang(l.code)} style={[st.lang, lang === l.code && st.langOn]} accessibilityRole="button">
                <Txt size={14} style={lang === l.code ? { color: colors.accent } : undefined}>{l.label}</Txt>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title={t('support')}>
          <Card style={{ paddingVertical: 2 }}>
            {link('shield-checkmark-outline', t('privacy'), () => openUrl(PANEL + '/privacy-crm-app.html'))}
            {link('help-circle-outline', t('support'), () => openUrl(PANEL + '/support-crm-app.html'))}
          </Card>
        </Section>

        <Section title={t('deleteAccount')}>
          <Card>
            <Txt muted size={14}>{t('deleteAccountText')}</Txt>
            <Button small variant="outline" icon="mail-outline" title={t('requestDeletion')} style={{ marginTop: 10, alignSelf: 'flex-start' }}
              onPress={() => openUrl(`mailto:admin@pulsecar.pl?subject=${encodeURIComponent('Pulsecar CRM – usunięcie konta / account deletion')}&body=${encodeURIComponent(`Login: ${me.user.login}\n${me.branch.name}`)}`)} />
          </Card>
        </Section>

        <Button variant="danger" icon="log-out-outline" title={t('logout')} onPress={confirmLogout} style={{ marginTop: 24 }} />
        <Txt muted size={12} style={{ textAlign: 'center', marginTop: 16 }}>{t('version')} {Application.nativeApplicationVersion} ({Application.nativeBuildVersion})</Txt>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  langs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  lang: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  langOn: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
});
