import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, Card, H1, IconBadge, IconName, open } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { CONTACT, PRICES, SERVICES } from '../data';

export default function Prices() {
  const { t, p, lang } = useT();
  const nav = useNav();
  const [mode, setMode] = useState<'prices' | 'services'>('prices');
  const [q, setQ] = useState('');
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({ diag: true });

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return PRICES;
    return PRICES.map((g) => ({
      ...g,
      items: g.items.filter((i) => p(i.name).toLowerCase().includes(needle) || i.name[0].toLowerCase().includes(needle)),
    })).filter((g) => g.items.length);
  }, [q, lang]);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <H1 style={{ fontSize: 26 }}>{mode === 'prices' ? t('prices') : t('services')}</H1>

      <View style={st.seg}>
        {(['prices', 'services'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[st.segBtn, mode === m && st.segOn]}>
            <Text style={[st.segText, mode === m && { color: colors.onAccent }]}>{m === 'prices' ? t('prices') : t('services')}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'services' ? (
        <View style={{ gap: 10 }}>
          {SERVICES.map((sv) => (
            <Card key={sv.id}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <IconBadge name={sv.icon as IconName} />
                <View style={{ flex: 1 }}>
                  <Text style={st.title}>{p(sv.name)}</Text>
                  <Body muted style={{ fontSize: 14, marginTop: 2 }}>{p(sv.desc)}</Body>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <Button small title={t('book')} onPress={() => nav.go('booking', { service: sv.id })} />
                    <Button small variant="outline" title="pulsecar.pl" icon="open-outline"
                      onPress={() => open(`${CONTACT.site}/${lang === 'uk' ? 'ua' : lang}/services/${sv.url}`)} />
                  </View>
                </View>
              </View>
            </Card>
          ))}
        </View>
      ) : (
        <>
          <View style={st.search}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder={t('search')} placeholderTextColor={colors.muted} style={st.input} />
          </View>
          <View style={{ gap: 10 }}>
            {groups.map((g) => {
              const isOpen = !!q || openIds[g.id];
              return (
                <View key={g.id} style={st.group}>
                  <Pressable style={st.groupHead} onPress={() => setOpenIds((o) => ({ ...o, [g.id]: !o[g.id] }))}>
                    <Text style={st.title}>
                      {p(g.title)} <Text style={{ color: colors.muted }}>({g.items.length})</Text>
                    </Text>
                    <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.muted} />
                  </Pressable>
                  {isOpen &&
                    g.items.map((it, i) => (
                      <Pressable
                        key={i}
                        style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.surface2 }]}
                        onPress={() => nav.go('booking', { note: it.name[0] })}
                      >
                        <Text style={st.rowName}>{p(it.name)}</Text>
                        <Text style={st.price}>
                          {it.from ? `${t('from')} ` : ''}{it.price} zł
                        </Text>
                      </Pressable>
                    ))}
                </View>
              );
            })}
          </View>
          <Body muted style={{ fontSize: 13, marginTop: 14 }}>{t('pricesNote')}</Body>
        </>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 10, padding: 4, marginVertical: 16, borderWidth: 1, borderColor: colors.border },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 7, alignItems: 'center' },
  segOn: { backgroundColor: colors.accent },
  segText: { fontFamily: fonts.semibold, color: colors.text, fontSize: 14 },
  title: { fontFamily: fonts.semibold, color: colors.text, fontSize: 16 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 12,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 11 },
  group: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border,
  },
  rowName: { flex: 1, fontFamily: fonts.regular, color: colors.text, fontSize: 14, lineHeight: 20 },
  price: { fontFamily: fonts.semibold, color: colors.accent, fontSize: 14 },
});
