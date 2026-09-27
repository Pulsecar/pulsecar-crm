import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { Body, Button, Card, H1, open } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';
import { ApiError, useAccount } from '../account';
import { DEMO_ENABLED } from '../config';
import { CONTACT } from '../data';

export default function Login({ subtitle }: { subtitle?: string }) {
  const { t, lang } = useT();
  const acc = useAccount();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const explain = (e: unknown, codeStep: boolean) => {
    const st = e instanceof ApiError ? e.status : 0;
    if (st === 0) return t('errNetwork');
    if (st === 429) return t('errTooMany');
    return codeStep ? t('errCode') : t('errPhone');
  };

  const send = async () => {
    setErr('');
    if (phone.replace(/\D/g, '').length < 9) return setErr(t('errPhone'));
    setBusy(true);
    try { await acc.requestCode(phone, lang); setSent(true); } catch (e) { setErr(explain(e, false)); }
    setBusy(false);
  };
  const verify = async () => {
    setErr('');
    setBusy(true);
    try { await acc.verify(phone, code); } catch (e) { setErr(explain(e, true)); }
    setBusy(false);
  };

  return (
    <View style={{ gap: 14 }}>
      <H1 style={{ fontSize: 26 }}>{t('loginTitle')}</H1>
      <Body muted>{subtitle ?? t('loginSub')}</Body>
      <Card>
        {!sent ? (
          <>
            <Text style={st.label}>{t('phone').replace(' *', '')}</Text>
            <TextInput
              value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber"
              placeholder="+48 600 000 000" placeholderTextColor={colors.muted} style={st.input} onSubmitEditing={send}
            />
            <Button title={t('getCode')} icon="chatbubble-ellipses-outline" onPress={send} style={{ marginTop: 14 }} />
          </>
        ) : (
          <>
            <Text style={st.label}>{t('codeSent')} {phone}</Text>
            <TextInput
              value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad"
              autoComplete="sms-otp" textContentType="oneTimeCode" placeholder="••••••" placeholderTextColor={colors.muted}
              style={[st.input, st.code]} onSubmitEditing={verify} maxLength={6}
            />
            <Button title={t('signIn')} onPress={verify} style={{ marginTop: 14 }} />
            <Button title={t('changePhone')} variant="ghost" onPress={() => { setSent(false); setCode(''); }} />
          </>
        )}
        {busy && <ActivityIndicator color={colors.accent} style={{ marginTop: 10 }} />}
        {!!err && <Text style={st.err}>{err}</Text>}
      </Card>
      <Text style={st.terms} onPress={() => open(CONTACT.privacy)}>{t('terms')}</Text>
      {DEMO_ENABLED && <Button title={t('demo')} variant="outline" icon="eye-outline" onPress={acc.startDemo} />}
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontFamily: fonts.medium, color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    color: colors.text, fontFamily: fonts.medium, fontSize: 17, paddingHorizontal: 14, paddingVertical: 12,
  },
  code: { fontSize: 26, letterSpacing: 8, textAlign: 'center', fontFamily: fonts.bold },
  err: { color: colors.danger, fontFamily: fonts.medium, fontSize: 13, marginTop: 10 },
  terms: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center' },
});
