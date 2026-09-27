import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Card, H1, H2, IconBadge, IconName, open } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';
import { CONTACT, TRAVEL, WARRANTY } from '../data';
import { todayIndex } from '../hours';
import { SOCIALS } from './Home';

export default function Contact() {
  const { t, p } = useT();
  const today = todayIndex();

  const rows: { icon: IconName; label: string; value: string; url: string }[] = [
    { icon: 'location-outline', label: t('address'), value: CONTACT.address, url: CONTACT.maps },
    { icon: 'call-outline', label: t('phone').replace(' *', ''), value: CONTACT.phone, url: `tel:${CONTACT.phoneRaw}` },
    { icon: 'mail-outline', label: 'E-mail', value: CONTACT.email, url: `mailto:${CONTACT.email}` },
    { icon: 'globe-outline', label: t('website'), value: 'pulsecar.pl', url: CONTACT.site },
  ];

  const hours = [
    { d: t('monFri'), v: '09:00–18:00', on: today >= 1 && today <= 5 },
    { d: t('sat'), v: '09:00–15:00', on: today === 6 },
    { d: t('sun'), v: t('closed'), on: today === 0 },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <H1 style={{ fontSize: 26, marginBottom: 16 }}>{t('tabContact')}</H1>

      <Card style={{ padding: 0 }}>
        {rows.map((r, i) => (
          <Pressable key={r.label} onPress={() => open(r.url)} style={[st.row, i > 0 && st.divider]}>
            <IconBadge name={r.icon} size={18} />
            <View style={{ flex: 1 }}>
              <Text style={st.small}>{r.label}</Text>
              <Text style={st.value}>{r.value}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
      </Card>

      <Button title={t('route')} icon="navigate-outline" onPress={() => open(CONTACT.mapsRoute)} style={{ marginTop: 12 }} />

      <H2 style={st.h2}>{t('hours')}</H2>
      <Card>
        {hours.map((h) => (
          <View key={h.d} style={st.hourRow}>
            <Text style={[st.value, h.on && { color: colors.accent }]}>{h.d}</Text>
            <Text style={[st.value, h.on && { color: colors.accent }]}>{h.v}</Text>
          </View>
        ))}
      </Card>

      <H2 style={st.h2}>{t('howToGet')}</H2>
      <Card>
        {TRAVEL.map((x) => (
          <View key={x.from} style={st.hourRow}>
            <Text style={[st.value, { flex: 1, fontSize: 14 }]}>{x.from}</Text>
            <Text style={st.muted}>~{x.min} min · {x.km} km</Text>
          </View>
        ))}
        <Text style={[st.small, { marginTop: 8 }]}>{t('howToGetNote')}</Text>
      </Card>

      <H2 style={st.h2}>{t('warranty')}</H2>
      <View style={{ gap: 10 }}>
        {WARRANTY.map((w, i) => (
          <Card key={i}>
            <Text style={[st.big, i === 2 && { color: colors.text }]}>{p(w.big)}</Text>
            <Body muted style={{ fontSize: 14 }}>{p(w.text)}</Body>
          </Card>
        ))}
      </View>

      <H2 style={st.h2}>{t('follow')}</H2>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {SOCIALS.map((x) => (
          <Button key={x.label} small variant="outline" icon={x.icon} title={x.label} onPress={() => open(x.url)} />
        ))}
      </View>

      <Body muted style={{ fontSize: 13, marginTop: 20, textAlign: 'center' }}>
        {t('languagesSpoken')}: PL · EN · UA · RU · BY
      </Body>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  small: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
  value: { fontFamily: fonts.medium, color: colors.text, fontSize: 15 },
  muted: { fontFamily: fonts.regular, color: colors.muted, fontSize: 13 },
  h2: { marginTop: 28, marginBottom: 12 },
  hourRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 7 },
  big: { fontFamily: fonts.bold, color: colors.accent, fontSize: 20, marginBottom: 2 },
});
