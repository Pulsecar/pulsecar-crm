import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Card, H1, H2, IconBadge } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT, UIKey } from '../i18n';
import { useNav } from '../nav';
import { Car, Tx, Visit, useAccount } from '../account';
import Login from './Login';
import { DemoBanner, fmtPts, fmtZl } from './CardScreen';

const fmtDate = (d: string | null) => {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
};
const carTitle = (c: Car) => [c.make, c.model].filter(Boolean).join(' ') || c.plate || c.vin || '—';

export default function Profile() {
  const { t } = useT();
  const acc = useAccount();
  const nav = useNav();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openCar, setOpenCar] = useState<number | null>(null);

  if (!acc.session) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Login />
        <Button title={t('contactsHours')} variant="ghost" icon="location-outline" onPress={() => nav.openOverlay('contact')} style={{ marginTop: 18 }} />
      </ScrollView>
    );
  }

  const me = acc.me;
  const txLabel: Record<Tx['type'], UIKey> = { earn: 'txEarn', redeem: 'txRedeem', bonus: 'txBonus', adjust: 'txAdjust' };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={acc.loading} onRefresh={acc.refresh} tintColor={colors.accent} />}
    >
      <DemoBanner />
      <H1 style={{ fontSize: 26 }}>{me?.customer.name || t('tabProfile')}</H1>
      <Body muted style={{ fontSize: 14 }}>{me?.customer.phone} · {t('cardNoLabel')} {acc.session.cardNo}</Body>

      {me && (
        <Pressable onPress={() => nav.go('card')} style={st.pp}>
          <View>
            <Text style={st.small}>Pulse Points · {me.loyalty.tier.name}</Text>
            <Text style={st.ppNum}>{fmtPts(me.loyalty.balance)} <Text style={st.ppUnit}>{t('pts')}</Text></Text>
          </View>
          <View style={st.qrBtn}>
            <Ionicons name="qr-code" size={22} color={colors.onAccent} />
          </View>
        </Pressable>
      )}

      {/* Текущие заказы и записи */}
      {!!me?.activeOrders?.length && (
        <>
          <H2 style={{ marginTop: 26, marginBottom: 12 }}>{t('inService')}</H2>
          <View style={{ gap: 10 }}>
            {me.activeOrders.map((v) => (
              <Card key={v.orderNo} style={{ borderColor: v.statusColor || colors.accent }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <Text style={st.carTitle}>{v.orderNo}</Text>
                  <Text style={[st.status, { backgroundColor: v.statusColor || colors.accent }]}>{v.status}</Text>
                </View>
                {v.items.slice(0, 5).map((it, i) => <Text key={i} style={st.itemName}>• {it.name}</Text>)}
                {!!v.total && <Text style={[st.visitTotal, { marginTop: 6 }]}>{fmtZl(v.total)}</Text>}
              </Card>
            ))}
          </View>
        </>
      )}
      {!!me?.appointments?.length && (
        <>
          <H2 style={{ marginTop: 26, marginBottom: 12 }}>{t('upcoming')}</H2>
          <Card style={{ gap: 8 }}>
            {me.appointments.map((a, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Ionicons name="calendar-outline" size={18} color={colors.accent} />
                <Text style={st.txTitle}>{a.start ? `${fmtDate(a.start)} ${a.start.slice(11, 16)}` : t('awaitingTime')}</Text>
                <Text style={[st.small, { flex: 1 }]} numberOfLines={1}>{a.title || ''}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {/* Автомобили */}
      <H2 style={{ marginTop: 26, marginBottom: 4 }}>{t('myCars')}</H2>
      <Text style={[st.small, { marginBottom: 12 }]}>{t('updatedWeekly')}</Text>
      {me && me.cars.length === 0 && me.otherVisits.length === 0 && <Card><Body muted>{t('noCars')}</Body></Card>}
      <View style={{ gap: 10 }}>
        {me?.cars.map((car) => {
          const open = openCar === car.id;
          return (
            <Card key={car.id} style={{ padding: 0, overflow: 'hidden' }}>
              <Pressable onPress={() => setOpenCar(open ? null : car.id)} style={st.carHead}>
                <IconBadge name="car-sport-outline" />
                <View style={{ flex: 1 }}>
                  <Text style={st.carTitle}>{carTitle(car)} {car.year ? <Text style={st.small}>{car.year}</Text> : null}</Text>
                  <Text style={st.plate}>{car.plate || car.vin}</Text>
                  <Text style={st.small}>
                    {car.lastMileage ? `${t('mileage')}: ${fmtPts(car.lastMileage)} km · ` : ''}{t('visitsN')}: {car.visits.length}
                  </Text>
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
              </Pressable>
              {open && (
                <View style={st.visits}>
                  {car.visits.map((v) => <VisitRow key={v.orderNo} v={v} />)}
                  <Button
                    small variant="outline" icon="calendar-outline" title={t('bookThisCar')} style={{ margin: 14 }}
                    onPress={() => nav.go('booking', { note: `${carTitle(car)} ${car.plate || ''}`.trim() })}
                  />
                </View>
              )}
            </Card>
          );
        })}
        {!!me?.otherVisits.length && (
          <Card style={{ padding: 0 }}>
            <Text style={[st.carTitle, { padding: 14 }]}>{t('otherVisits')}</Text>
            <View style={st.visits}>{me.otherVisits.map((v) => <VisitRow key={v.orderNo} v={v} />)}</View>
          </Card>
        )}
      </View>

      {/* История баллов */}
      {!!me?.transactions.length && (
        <>
          <H2 style={{ marginTop: 26, marginBottom: 12 }}>{t('history')}</H2>
          <Card style={{ paddingVertical: 4 }}>
            {me.transactions.slice(0, 30).map((x, i) => (
              <View key={i} style={[st.txRow, i > 0 && st.border]}>
                <View style={{ flex: 1 }}>
                  <Text style={st.txTitle}>{x.note === 'welcome' ? t('welcome') : t(txLabel[x.type])}{x.orderNo ? ` · ${x.orderNo}` : ''}</Text>
                  <Text style={st.small}>{fmtDate(x.date)}{x.amount ? ` · ${fmtZl(x.amount)}` : ''}</Text>
                </View>
                <Text style={[st.txPts, { color: x.points < 0 ? colors.danger : colors.accent }]}>
                  {x.points > 0 ? '+' : ''}{fmtPts(x.points)}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}

      <View style={{ gap: 10, marginTop: 26 }}>
        <Button title={t('contactsHours')} variant="outline" icon="location-outline" onPress={() => nav.openOverlay('contact')} />
        <Button title={t('logout')} variant="outline" icon="log-out-outline" onPress={acc.logout} />
        {!confirmDelete ? (
          <Button title={t('deleteAccount')} variant="ghost" onPress={() => setConfirmDelete(true)} />
        ) : (
          <Card style={{ borderColor: colors.danger }}>
            <Body style={{ fontSize: 14 }}>{t('deleteConfirm')}</Body>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button small title={t('cancel')} variant="outline" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }} />
              <Button small title={t('yesDelete')} onPress={() => acc.deleteAccount().catch(() => {})} style={{ flex: 1, backgroundColor: colors.danger, borderColor: colors.danger }} />
            </View>
          </Card>
        )}
      </View>
    </ScrollView>
  );
}

function VisitRow({ v }: { v: Visit }) {
  const { t } = useT();
  return (
    <View style={st.visit}>
      <View style={st.visitHead}>
        <Text style={st.visitDate}>{fmtDate(v.date)}</Text>
        {v.total !== null && <Text style={st.visitTotal}>{fmtZl(v.total)}</Text>}
      </View>
      <Text style={st.small}>
        {t('orderNo')} {v.orderNo}{v.mileage ? ` · ${fmtPts(v.mileage)} km` : ''}
      </Text>
      <View style={{ marginTop: 6, gap: 3 }}>
        {v.items.map((it, i) => (
          <View key={i} style={st.item}>
            <Text style={st.itemName}>• {it.name}{it.qty && it.qty !== 1 ? ` ×${it.qty}` : ''}</Text>
            {it.price !== null && <Text style={st.itemPrice}>{fmtZl(it.price * (it.qty || 1))}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  small: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
  pp: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16,
    padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentDim,
  },
  ppNum: { fontFamily: fonts.bold, color: colors.accent, fontSize: 28 },
  ppUnit: { fontFamily: fonts.medium, color: colors.muted, fontSize: 14 },
  qrBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  carHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  carTitle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 16 },
  plate: {
    alignSelf: 'flex-start', fontFamily: fonts.bold, color: colors.text, fontSize: 12, letterSpacing: 1,
    borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, marginVertical: 3,
  },
  visits: { borderTopWidth: 1, borderTopColor: colors.border },
  visit: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  visitHead: { flexDirection: 'row', justifyContent: 'space-between' },
  visitDate: { fontFamily: fonts.semibold, color: colors.text, fontSize: 15 },
  visitTotal: { fontFamily: fonts.semibold, color: colors.accent, fontSize: 15 },
  item: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  itemName: { flex: 1, fontFamily: fonts.regular, color: colors.text, fontSize: 13 },
  itemPrice: { fontFamily: fonts.regular, color: colors.muted, fontSize: 13 },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  border: { borderTopWidth: 1, borderTopColor: colors.border },
  txTitle: { fontFamily: fonts.medium, color: colors.text, fontSize: 14 },
  txPts: { fontFamily: fonts.bold, fontSize: 16 },
  status: { fontFamily: fonts.bold, fontSize: 12, color: '#000', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
});
