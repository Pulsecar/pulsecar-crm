import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, login, PANEL } from '../api';
import { LANGS, useLang, useT } from '../i18n';
import { colors, fonts } from '../theme';
import { Button, Field, H1, Logo, openUrl, Txt } from '../components/ui';

export default function Login({ onDone, notice }: { onDone: () => void; notice?: string | null }) {
  const t = useT();
  const { lang, setLang } = useLang();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(notice || null);

  const submit = async () => {
    if (!user.trim() || !pass) return;
    setBusy(true); setErr(null);
    try {
      await login(user.trim(), pass);
      setPass('');
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 0 ? t('offline') : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <Logo height={46} />
          <Txt muted style={{ marginTop: 6, fontFamily: fonts.semibold, letterSpacing: 2 }}>CRM</Txt>
        </View>
        <H1>{t('loginTitle')}</H1>
        <Txt muted style={{ marginTop: 4, marginBottom: 20 }}>{t('loginSub')}</Txt>
        <Field icon="person-outline" placeholder={t('login')} value={user} onChangeText={setUser} autoCapitalize="none" autoCorrect={false}
          textContentType="username" autoComplete="username" returnKeyType="next" accessibilityLabel={t('login')} />
        <View style={{ height: 12 }} />
        <View>
          <Field icon="lock-closed-outline" placeholder={t('password')} value={pass} onChangeText={setPass} secureTextEntry={!show}
            textContentType="password" autoComplete="password" returnKeyType="go" onSubmitEditing={submit} accessibilityLabel={t('password')} style={{ paddingRight: 36 }} />
          <Pressable onPress={() => setShow(!show)} style={st.eye} hitSlop={10} accessibilityLabel={t('showPass')}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
          </Pressable>
        </View>
        {err ? <Txt style={st.err}>{err}</Txt> : null}
        <Button title={t('signIn')} icon="log-in-outline" onPress={submit} busy={busy} disabled={!user.trim() || !pass} style={{ marginTop: 20 }} />
        <Txt muted size={13} style={{ marginTop: 18, textAlign: 'center' }}>{t('noAccount')}</Txt>

        <View style={st.langs}>
          {LANGS.map((l) => (
            <Pressable key={l.code} onPress={() => setLang(l.code)} style={[st.lang, lang === l.code && st.langOn]} accessibilityRole="button">
              <Txt size={13} style={lang === l.code ? { color: colors.accent } : undefined}>{l.label}</Txt>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => openUrl(PANEL + '/privacy-crm-app.html')} style={{ alignSelf: 'center', marginTop: 14 }}>
          <Txt muted size={13} style={{ textDecorationLine: 'underline' }}>{t('privacy')}</Txt>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  eye: { position: 'absolute', right: 12, top: 14 },
  err: { color: colors.danger, marginTop: 12 },
  langs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 28 },
  lang: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  langOn: { borderColor: colors.accent },
});
