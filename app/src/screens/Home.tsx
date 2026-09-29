import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Card, H1, H2, IconBadge, IconName, open } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { CONTACT, SERVICES, WHY } from '../data';
import { openStatus } from '../hours';
import { useAccount } from '../account';

export const SOCIALS: { label: string; icon: IconName; url: string }[] = [
  { label: 'WhatsApp', icon: 'logo-whatsapp', url: CONTACT.whatsapp },
  { label: 'Telegram', icon: 'paper-plane-outline', url: CONTACT.telegram },
  { label: 'Instagram', icon: 'logo-instagram', url: CONTACT.instagram },
  { label: 'Facebook', icon: 'logo-facebook', url: CONTACT.facebook },
];

export default function Home() {
  const { t, p } = useT();
  const nav = useNav();
  const st = openStatus();
  const acc = useAccount();
  const active = acc.session ? acc.me?.activeOrders?.[0] : undefined;
  const quotesN = acc.session ? acc.me?.quotes?.filter((q) => !q.accepted).length || 0 : 0;

  const promo: { icon: IconName; title: string; text: string; cta: string; onPress: () => void }[] = [
    { icon: 'qr-code-outline', title: t('cardPromoTitle'), text: t('cardPromoText'), cta: t('cardPromoCta'), onPress: () => nav.go('card') },
    { icon: 'help-buoy-outline', title: t('cardTestTitle'), text: t('cardTestText'), cta: t('cardTestCta'), onPress: () => nav.openOverlay('test') },
    {
      icon: 'search-outline', title: t('cardBuyTitle'), text: t('cardBuyText'), cta: t('cardBuyCta'),
      onPress: () => nav.go('booking', { service: 'inspection' }),
    },
    { icon: 'gift-outline', title: t('cardRefTitle'), text: t('cardRefText'), cta: t('cardRefCta'), onPress: () => nav.openOverlay('referral') },
  ];

  return (
    <ScrollView contentContainerStyle={st_.wrap}>
      <View style={st_.status}>
        <View style={[st_.dot, { backgroundColor: st.open ? colors.accent : colors.danger }]} />
        <Text style={st_.statusText}>
          {st.open ? `${t('openNow')} · ${t('until')} ${st.closesAt}:00` : t('closedNow')}
        </Text>
      </View>

      {!!active && (
        <Pressable onPress={() => nav.go('profile')} style={[st_.banner, { borderColor: active.statusColor || colors.accent }]}>
          <Ionicons name="car-sport" size={22} color={active.statusColor || colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={st_.bannerTitle}>{t('activeBanner')}</Text>
            <Text style={st_.bannerSub}>{active.orderNo}{active.status ? ` · ${active.status}` : ''}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      )}
      {quotesN > 0 && (
        <Pressable onPress={() => nav.go('profile')} style={[st_.banner, { borderColor: colors.accent }]}>
          <Ionicons name="document-text-outline" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={st_.bannerTitle}>{t('quotesTitle')} · {quotesN}</Text>
            <Text style={st_.bannerSub}>{t('quoteOpen')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      )}

      <H1 style={{ textAlign: 'center' }}>
        {t('heroTitle')} – <Text style={{ color: colors.accent }}>Pulsecar</Text>
      </H1>
      <Body muted style={{ textAlign: 'center', marginTop: 10 }}>{t('heroSub')}</Body>

      <View style={{ gap: 10, marginTop: 22 }}>
        <Button title={t('book')} icon="calendar-outline" onPress={() => nav.go('booking')} />
        <Button title={`${t('call')}: ${CONTACT.phone}`} icon="call-outline" variant="outline" onPress={() => open(`tel:${CONTACT.phoneRaw}`)} />
      </View>

      <View style={st_.socials}>
        {SOCIALS.map((x) => (
          <Pressable key={x.label} onPress={() => open(x.url)} style={st_.social} accessibilityLabel={x.label}>
            <Ionicons name={x.icon} size={18} color={colors.text} />
            <Text style={st_.socialText}>{x.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ gap: 12, marginTop: 28 }}>
        {promo.map((c) => (
          <Card key={c.title} onPress={c.onPress}>
            <View style={{ flexDirection: 'row', gap: 14 }}>
              <IconBadge name={c.icon} />
              <View style={{ flex: 1 }}>
                <Text style={st_.cardTitle}>{c.title}</Text>
                <Body muted style={{ fontSize: 14, marginTop: 4 }}>{c.text}</Body>
                <Text style={st_.cta}>{c.cta} →</Text>
              </View>
            </View>
          </Card>
        ))}
      </View>

      <H2 style={{ marginTop: 32, marginBottom: 12 }}>{t('servicesTitle')}</H2>
      <View style={st_.grid}>
        {SERVICES.map((sv) => (
          <Pressable key={sv.id} style={st_.tile} onPress={() => nav.go('booking', { service: sv.id })}>
            <Ionicons name={sv.icon as IconName} size={24} color={colors.accent} />
            <Text style={st_.tileText} numberOfLines={2}>{p(sv.name)}</Text>
          </Pressable>
        ))}
      </View>
      <Button title={t('tabPrices')} variant="outline" icon="pricetags-outline" onPress={() => nav.go('prices')} style={{ marginTop: 12 }} />

      <H2 style={{ marginTop: 32, marginBottom: 12 }}>{t('whyTitle')}</H2>
      <View style={{ gap: 10 }}>
        {WHY.map((w) => (
          <View key={w.icon} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <IconBadge name={w.icon as IconName} size={18} />
            <View style={{ flex: 1 }}>
              <Text style={st_.cardTitle}>{p(w.title)}</Text>
              <Body muted style={{ fontSize: 13 }}>{p(w.text)}</Body>
            </View>
          </View>
        ))}
      </View>

      <Button title={t('contactsHours')} variant="outline" icon="location-outline" onPress={() => nav.openOverlay('contact')} style={{ marginTop: 24 }} />
      <Button title={`★  ${t('review')}`} variant="outline" onPress={() => open(CONTACT.review)} style={{ marginTop: 10 }} />
    </ScrollView>
  );
}

const st_ = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 40 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, backgroundColor: colors.surface, marginBottom: 12 },
  bannerTitle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 15 },
  bannerSub: { fontFamily: fonts.regular, color: colors.muted, fontSize: 13 },
  status: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: fonts.medium, color: colors.text, fontSize: 13 },
  socials: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 },
  social: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1, borderColor: colors.border,
  },
  socialText: { fontFamily: fonts.medium, color: colors.text, fontSize: 13 },
  cardTitle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 16 },
  cta: { fontFamily: fonts.semibold, color: colors.accent, fontSize: 14, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%', flexGrow: 1, minHeight: 92, padding: 14, gap: 8, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tileText: { fontFamily: fonts.medium, color: colors.text, fontSize: 13, lineHeight: 18 },
});
