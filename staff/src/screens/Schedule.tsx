import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, Appt } from '../api';
import { LOCALE, useLang, useT } from '../i18n';
import { useSession } from '../session';
import { colors, fonts } from '../theme';
import { Card, carLine, Empty, ErrorBox, Header, IconBtn, Loading, StatusBadge, Txt } from '../components/ui';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addMin = (hhmm: string, m: number) => {
  const [h, mi] = hhmm.split(':').map(Number);
  const x = h * 60 + mi + m;
  return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

export default function Schedule() {
  const t = useT();
  const { lang } = useLang();
  const { me, openOrder } = useSession();
  const [day, setDay] = useState(() => new Date());
  const [rows, setRows] = useState<Appt[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const j = await api<{ rows: Appt[] }>(`/appointments?from=${ymd(day)}&to=${ymd(day)}`);
      setRows(j.rows);
    } catch (e) { setErr((e as Error).message); }
  }, [day]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const shift = (n: number) => setDay((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  const isToday = ymd(day) === ymd(new Date());
  const title = day.toLocaleDateString(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'long' });

  const byStation = me.stations.map((s) => ({ s, list: (rows || []).filter((a) => a.station_id === s.id) })).filter((g) => g.list.length);

  return (
    <View style={{ flex: 1 }}>
      <Header title={t('tabSchedule')} />
      <View style={st.dayBar}>
        <IconBtn name="chevron-back" label={t('back')} onPress={() => shift(-1)} />
        <Pressable onPress={() => setDay(new Date())} style={{ flex: 1, alignItems: 'center' }} accessibilityRole="button">
          <Txt bold style={{ textTransform: 'capitalize' }}>{title}</Txt>
          {!isToday && <Txt size={12} style={{ color: colors.accent }}>{t('today')}</Txt>}
        </Pressable>
        <IconBtn name="chevron-forward" label=">" onPress={() => shift(1)} />
      </View>
      {err && !rows ? <ErrorBox error={err} onRetry={load} /> : !rows ? <Loading /> : (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
          refreshControl={<RefreshControl tintColor={colors.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
          {!byStation.length && <Empty icon="calendar-clear-outline" text={t('noVisits')} />}
          {byStation.map(({ s, list }) => (
            <View key={s.id} style={{ marginBottom: 16 }}>
              <Txt style={st.station}>{s.name}</Txt>
              {list.map((a) => {
                const start = a.start_at.slice(11, 16);
                const who = a.customer_name || a.contact_name || a.title || '';
                const jobs = (a.jobs || []).slice(0, 4);
                return (
                  <Card key={a.id} style={[st.card, { borderLeftColor: a.status_color || colors.border }]} onPress={a.order_id ? () => openOrder(a.order_id!) : undefined}>
                    <View style={st.row}>
                      <Txt bold>{start}–{addMin(start, a.duration_min)}</Txt>
                      {a.order_number ? <Txt muted size={13}>{a.order_number}</Txt> : a.status === 'request' ? <Txt size={13} style={{ color: colors.accent }}>{t('request')}</Txt> : null}
                    </View>
                    <Txt bold style={{ marginTop: 4 }} numberOfLines={1}>{[carLine(a), a.plate].filter(Boolean).join(' · ') || who}</Txt>
                    {!!who && !!carLine(a) && <Txt muted size={13} numberOfLines={1}>{who}</Txt>}
                    {jobs.map((j, i) => (
                      <View key={i} style={st.job}>
                        <Ionicons name={j.done ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={j.done ? colors.accent : colors.muted} />
                        <Txt size={13} numberOfLines={1} style={{ flex: 1 }}>{j.name}</Txt>
                      </View>
                    ))}
                    {!jobs.length && !!a.note && <Txt muted size={13} numberOfLines={2}>{a.note}</Txt>}
                    <View style={[st.row, { marginTop: 8 }]}>
                      <StatusBadge name={a.status_name} color={a.status_color} />
                      {!!a.mechanic_name && <Txt muted size={12}>{a.mechanic_name}</Txt>}
                    </View>
                  </Card>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  dayBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  station: { fontFamily: fonts.semibold, color: colors.muted, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  card: { borderLeftWidth: 4, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
});
