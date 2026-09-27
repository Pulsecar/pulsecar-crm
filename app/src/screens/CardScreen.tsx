import React, { useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { Body, Card, H2 } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';
import { useAccount } from '../account';
import { makeQr } from '../qr';
import { QR_STEP_SECONDS } from '../config';
import Login from './Login';

export const fmtPts = (n: number) => Math.round(n).toLocaleString('pl-PL');
export const fmtZl = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('pl-PL', { minimumFractionDigits: n % 1 ? 2 : 0 })} zł`;

export function DemoBanner() {
  const { t } = useT();
  const { session } = useAccount();
  if (!session?.demo) return null;
  return (
    <View style={st.demo}>
      <Ionicons name="eye-outline" size={14} color={colors.onAccent} />
      <Text style={st.demoText}>{t('demoBanner')}</Text>
    </View>
  );
}

export default function CardScreen() {
  const { t } = useT();
  const acc = useAccount();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!acc.session) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Login subtitle={t('loginForCard')} />
      </ScrollView>
    );
  }

  const s = acc.session;
  const L = acc.me?.loyalty;
  const qr = makeQr(s.qrSecret, s.cardNo, now + acc.clockOffset);
  const progress = qr.secondsLeft / QR_STEP_SECONDS;
  const R = L?.rules;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={acc.loading} onRefresh={acc.refresh} tintColor={colors.accent} />}
    >
      <DemoBanner />
      {/* Карта */}
      <View style={st.card}>
        <View style={st.cardTop}>
          <Image source={require('../../assets/logo-header.png')} style={{ width: 86, height: 34 }} resizeMode="contain" />
          {L && <Text style={st.tier}>{L.tier.name}</Text>}
        </View>
        <Text style={st.name} numberOfLines={1}>{acc.me?.customer.name || acc.me?.customer.phone || ''}</Text>

        <View style={st.qrBox}>
          <QRCode value={qr.payload} size={210} color="#000000" backgroundColor="#FFFFFF" ecl="M" quietZone={8} />
        </View>
        <Text style={st.hint}>{t('showAtCheckout')}</Text>
        <View style={st.bar}><View style={[st.barFill, { width: `${progress * 100}%` }]} /></View>
        <View style={st.codeRow}>
          <Text style={st.small}>{t('manualCode')}: <Text style={st.code}>{qr.code6.slice(0, 3)} {qr.code6.slice(3)}</Text></Text>
          <Text style={st.small}>{t('newCodeIn')} {qr.secondsLeft} {t('sec')}</Text>
        </View>
        <Text style={[st.small, { marginTop: 4 }]}>{t('cardNoLabel')}: {s.cardNo}</Text>
      </View>

      {/* Баланс и уровень */}
      {L && (
        <Card style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={st.small}>{t('balance')}</Text>
              <Text style={st.balance}>{fmtPts(L.balance)} <Text style={st.balanceUnit}>{t('pts')}</Text></Text>
            </View>
            <Text style={st.worth}>= {fmtZl(L.valuePln)} {t('worth')}</Text>
          </View>
          <View style={st.divider} />
          <Text style={st.small}>{t('level')}: <Text style={{ color: colors.accent, fontFamily: fonts.semibold }}>{L.tier.name}</Text> · {String(L.tier.rate).replace('.', ',')} {t('perZl')}</Text>
          {L.next ? (
            <>
              <View style={[st.bar, { marginTop: 10 }]}>
                <View style={[st.barFill, { width: `${Math.min(100, (L.spend12m / L.next.from) * 100)}%` }]} />
              </View>
              <Text style={[st.small, { marginTop: 6 }]}>
                {t('toNext')} {L.next.name} ({String(L.next.rate).replace('.', ',')} {t('perZl')}) {t('toNextLeft')} {fmtZl(L.next.remaining)}
              </Text>
            </>
          ) : (
            <Text style={[st.small, { marginTop: 6 }]}>{t('maxLevel')}</Text>
          )}
        </Card>
      )}

      {/* Правила */}
      {R && L && (
        <>
          <H2 style={{ marginTop: 26, marginBottom: 10 }}>{t('howItWorks')}</H2>
          <Card style={{ gap: 10 }}>
            {[
              ['qr-code-outline', t('ruleScan')],
              ['trending-up-outline', `${String(L.tier.rate).replace('.', ',')} ${t('ruleEarn')}`],
              ['pricetag-outline', t('ruleValue').replace('{v}', String(R.pointValuePln).replace('.', ',')).replace('{min}', String(R.minRedeem))],
              ['pie-chart-outline', t('ruleShare').replace('{s}', String(Math.round(R.maxRedeemShare * 100)))],
              ['gift-outline', t('ruleWelcome').replace('{b}', String(R.welcomeBonus))],
            ].map(([icon, text]) => (
              <View key={icon} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Ionicons name={icon as any} size={20} color={colors.accent} />
                <Body style={{ flex: 1, fontSize: 14 }}>{text}</Body>
              </View>
            ))}
          </Card>

          <H2 style={{ marginTop: 26, marginBottom: 10 }}>{t('tiers')}</H2>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {R.tiers.map((tr) => {
              const on = tr.id === L.tier.id;
              return (
                <View key={tr.id} style={[st.tierBox, on && { borderColor: colors.accent, backgroundColor: colors.accentDim }]}>
                  <Text style={[st.tierName, on && { color: colors.accent }]}>{tr.name}</Text>
                  <Text style={st.tierRate}>{String(tr.rate).replace('.', ',')}</Text>
                  <Text style={st.small}>{t('perZl')}</Text>
                  <Text style={[st.small, { marginTop: 6, textAlign: 'center' }]}>
                    {tr.from ? t('tierFrom').replace('{x}', fmtPts(tr.from)) : t('tierStart')}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  demo: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', backgroundColor: colors.accent,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 12,
  },
  demoText: { fontFamily: fonts.semibold, color: colors.onAccent, fontSize: 12 },
  card: {
    backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.accent, padding: 18, alignItems: 'center',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', alignSelf: 'stretch' },
  tier: {
    fontFamily: fonts.bold, fontSize: 12, color: colors.onAccent, backgroundColor: colors.accent,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, overflow: 'hidden',
  },
  name: { fontFamily: fonts.semibold, color: colors.text, fontSize: 16, alignSelf: 'stretch', marginTop: 8 },
  qrBox: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 6, marginTop: 14 },
  hint: { fontFamily: fonts.medium, color: colors.text, fontSize: 14, marginTop: 12, textAlign: 'center' },
  bar: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 12, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 8, flexWrap: 'wrap', gap: 6 },
  small: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
  code: { fontFamily: fonts.bold, color: colors.text, fontSize: 15, letterSpacing: 1 },
  balance: { fontFamily: fonts.bold, color: colors.accent, fontSize: 34, lineHeight: 42 },
  balanceUnit: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted },
  worth: { fontFamily: fonts.semibold, color: colors.text, fontSize: 14, marginBottom: 8 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  tierBox: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tierName: { fontFamily: fonts.bold, color: colors.text, fontSize: 15 },
  tierRate: { fontFamily: fonts.bold, color: colors.text, fontSize: 24, marginTop: 4 },
});
