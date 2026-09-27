import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Card, H1, IconName, open } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { CONTACT, SYMPTOMS } from '../data';

export default function Test() {
  const { t, p } = useT();
  const nav = useNav();
  const [sid, setSid] = useState<string | null>(null);
  const [vi, setVi] = useState<number | null>(null);
  const sym = SYMPTOMS.find((x) => x.id === sid);
  const variant = sym && vi !== null ? sym.variants[vi] : null;

  const reset = () => { setSid(null); setVi(null); };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <H1 style={{ fontSize: 26 }}>{t('testTitle')}</H1>

      <View style={st.progress}>
        <View style={[st.bar, { backgroundColor: colors.accent }]} />
        <View style={[st.bar, { backgroundColor: sym ? colors.accent : colors.border }]} />
      </View>

      {!sym && (
        <>
          <Text style={st.step}>{t('testStep1')}</Text>
          <View style={{ gap: 8 }}>
            {SYMPTOMS.map((x) => (
              <Pressable key={x.id} onPress={() => setSid(x.id)} style={({ pressed }) => [st.option, pressed && { borderColor: colors.accent }]}>
                <Ionicons name={x.icon as IconName} size={22} color={colors.accent} />
                <Text style={st.optText}>{p(x.title)}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
          <Body muted style={{ fontSize: 13, marginTop: 16 }}>{t('noSymptom')}</Body>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button small title={t('book')} onPress={() => nav.go('booking')} />
            <Button small variant="outline" icon="call-outline" title={CONTACT.phone} onPress={() => open(`tel:${CONTACT.phoneRaw}`)} />
          </View>
        </>
      )}

      {sym && !variant && (
        <>
          <Text style={st.step}>{t('testStep2')}</Text>
          <Text style={st.symTitle}>{p(sym.title)}</Text>
          <View style={{ gap: 8 }}>
            {sym.variants.map((v, i) => (
              <Pressable key={i} onPress={() => setVi(i)} style={({ pressed }) => [st.option, pressed && { borderColor: colors.accent }]}>
                <Text style={st.optText}>{p(v.q)}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
          <Button variant="ghost" icon="arrow-back" title={t('back')} onPress={reset} style={{ marginTop: 12, alignSelf: 'flex-start' }} />
        </>
      )}

      {sym && variant && (
        <>
          <Text style={st.step}>{p(sym.title)} → {p(variant.q)}</Text>
          <Card>
            <Text style={st.resTitle}>{t('testResult')}</Text>
            {variant.causes.map((c, i) => (
              <View key={i} style={st.cause}>
                <Text style={st.num}>{i + 1}</Text>
                <Body style={{ flex: 1 }}>{p(c)}</Body>
              </View>
            ))}
          </Card>
          <Card style={{ marginTop: 12, borderColor: colors.accent }}>
            <Text style={[st.step, { marginTop: 0 }]}>{t('suggested')}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <Text style={[st.resTitle, { flex: 1, marginBottom: 0 }]}>{p(sym.service)}</Text>
              <Text style={st.price}>{sym.price}</Text>
            </View>
            <Button
              title={t('book')} icon="calendar-outline" style={{ marginTop: 14 }}
              onPress={() => nav.go('booking', { note: `${sym.title[0]} — ${variant.q[0]}` })}
            />
          </Card>
          <Body muted style={{ fontSize: 13, marginTop: 14 }}>{t('testDisclaimer')}</Body>
          <Button variant="outline" icon="refresh" title={t('restart')} onPress={reset} style={{ marginTop: 14 }} />
        </>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, marginTop: 14 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  step: { fontFamily: fonts.medium, color: colors.muted, fontSize: 13, marginTop: 16, marginBottom: 12 },
  symTitle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 18, marginBottom: 12 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  optText: { flex: 1, fontFamily: fonts.medium, color: colors.text, fontSize: 15 },
  resTitle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 17, marginBottom: 8 },
  cause: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 8 },
  num: {
    width: 24, height: 24, borderRadius: 12, textAlign: 'center', lineHeight: 24, overflow: 'hidden',
    backgroundColor: colors.accentDim, color: colors.accent, fontFamily: fonts.bold, fontSize: 13,
  },
  price: { fontFamily: fonts.bold, color: colors.accent, fontSize: 16 },
});
