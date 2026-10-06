import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { api, OrderRow } from '../api';
import { useT } from '../i18n';
import { useSession } from '../session';
import { colors, fonts } from '../theme';
import { Card, carLine, Empty, ErrorBox, Field, Header, Loading, money, StatusBadge, Txt } from '../components/ui';

export default function Orders({ kind }: { kind: 'order' | 'quote' }) {
  const t = useT();
  const { openOrder } = useSession();
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (p = 0) => {
    const my = ++seq.current;
    setErr(null);
    try {
      const qs = `kind=${kind}&page=${p}${onlyOpen ? '&status=open' : ''}${q.trim() ? '&q=' + encodeURIComponent(q.trim()) : ''}`;
      const j = await api<{ rows: OrderRow[]; total: number }>('/orders?' + qs);
      if (my !== seq.current) return;
      setRows((r) => (p === 0 ? j.rows : [...(r || []), ...j.rows]));
      setTotal(j.total); setPage(p);
    } catch (e) { if (my === seq.current) setErr((e as Error).message); }
  }, [kind, onlyOpen, q]);

  useEffect(() => {
    const h = setTimeout(() => load(0), q ? 350 : 0); // поиск — с небольшой задержкой при вводе
    return () => clearTimeout(h);
  }, [load]);

  const loadMore = async () => {
    if (more || !rows || rows.length >= total) return;
    setMore(true); await load(page + 1); setMore(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title={t(kind === 'quote' ? 'tabQuotes' : 'tabOrders')} />
      <View style={{ padding: 12, paddingBottom: 6 }}>
        <Field icon="search" placeholder={t('search')} value={q} onChangeText={setQ} autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" />
        <View style={st.chips}>
          {[true, false].map((v) => (
            <Pressable key={String(v)} onPress={() => setOnlyOpen(v)} style={[st.chip, onlyOpen === v && st.chipOn]} accessibilityRole="button">
              <Txt size={13} style={onlyOpen === v ? { color: colors.accent } : undefined}>{t(v ? 'open' : 'all')}</Txt>
            </Pressable>
          ))}
          {rows && <Txt muted size={13} style={{ marginLeft: 'auto' }}>{total}</Txt>}
        </View>
      </View>
      {err && !rows ? <ErrorBox error={err} onRetry={() => load(0)} /> : !rows ? <Loading /> : (
        <FlatList
          data={rows}
          keyExtractor={(o) => String(o.id)}
          contentContainerStyle={{ padding: 12, paddingTop: 4, paddingBottom: 40 }}
          ListEmptyComponent={<Empty text={t('empty')} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={more ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} /> : null}
          refreshControl={<RefreshControl tintColor={colors.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(0); setRefreshing(false); }} />}
          renderItem={({ item: o }) => (
            <Card style={{ marginBottom: 10 }} onPress={() => openOrder(o.id)}>
              <View style={st.row}>
                <Txt bold>{o.number}</Txt>
                <Txt muted size={12}>{(o.planned_at || o.created_at || '').slice(0, 10)}</Txt>
              </View>
              <Txt style={{ marginTop: 4, fontFamily: fonts.medium }} numberOfLines={1}>{[carLine(o), o.plate].filter(Boolean).join(' · ') || '—'}</Txt>
              {!!o.customer_name && <Txt muted size={13} numberOfLines={1}>{o.customer_name}</Txt>}
              {!!o.last_comment && <Txt size={13} numberOfLines={2} style={st.comment}>💬 {o.last_comment}</Txt>}
              <View style={[st.row, { marginTop: 8 }]}>
                <StatusBadge name={o.status_name} color={o.status_color} />
                {o.total != null && <Txt bold size={14}>{money(o.total)}</Txt>}
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  comment: { marginTop: 6, color: '#FFD479', fontFamily: fonts.medium },
});
