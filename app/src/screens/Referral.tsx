import React, { useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Body, Button, Card, H1 } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';

export default function Referral() {
  const { t } = useT();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, '');
  const canCreate = name.trim().length > 1 && digits.length >= 4;

  const create = () => {
    const clean = name.trim().split(/\s+/)[0].toUpperCase();
    setCode(`${clean}-${digits.slice(-4)}`);
  };

  const share = () => {
    if (!code) return;
    Share.share({ message: t('refShareText').replace('{code}', code) }).catch(() => {});
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <H1 style={{ fontSize: 24 }}>{t('refTitle')}</H1>
      <View style={{ gap: 10, marginVertical: 18 }}>
        {[t('refStep1'), t('refStep2'), t('refStep3')].map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
            <Text style={st.num}>{i + 1}</Text>
            <Body style={{ flex: 1 }}>{s}</Body>
          </View>
        ))}
      </View>

      <Card>
        <Text style={st.label}>{t('yourName')}</Text>
        <TextInput value={name} onChangeText={setName} style={st.input} placeholderTextColor={colors.muted} />
        <Text style={[st.label, { marginTop: 12 }]}>{t('yourPhone')}</Text>
        <TextInput value={phone} onChangeText={setPhone} style={st.input} keyboardType="phone-pad" placeholder="+48" placeholderTextColor={colors.muted} />
        <Button title={t('createCode')} onPress={() => canCreate && create()} style={{ marginTop: 14, opacity: canCreate ? 1 : 0.5 }} />
        <Text style={[st.label, { marginTop: 10, fontSize: 12 }]}>{t('refPrivacy')}</Text>
      </Card>

      {code && (
        <Card style={{ marginTop: 14, borderColor: colors.accent, alignItems: 'center' }}>
          <Text style={st.label}>{t('yourCode')}</Text>
          <Text style={st.code} selectable>{code}</Text>
          <Button title={t('share')} icon="share-social-outline" onPress={share} style={{ alignSelf: 'stretch' }} />
        </Card>
      )}

      <Body muted style={{ fontSize: 13, marginTop: 16 }}>{t('refRules')}</Body>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  num: {
    width: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26, overflow: 'hidden',
    backgroundColor: colors.accent, color: colors.onAccent, fontFamily: fonts.bold, fontSize: 13,
  },
  label: { fontFamily: fonts.medium, color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12,
  },
  code: { fontFamily: fonts.bold, color: colors.accent, fontSize: 30, letterSpacing: 1, marginVertical: 10 },
});
