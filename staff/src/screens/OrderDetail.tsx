import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, authHeader, fileUrl, Item, Order, Status } from '../api';
import { useT } from '../i18n';
import { can, useSession } from '../session';
import { colors, fonts, radius } from '../theme';
import { Button, Card, carLine, ErrorBox, Header, IconBtn, Loading, money, openUrl, Section, StatusBadge, Txt } from '../components/ui';

export default function OrderDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const t = useT();
  const { me, openCrm } = useSession();
  const insets = useSafeAreaInsets();
  const [o, setO] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { setO(await api<Order>(`/orders/${id}`)); } catch (e) { setErr((e as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const fail = (e: unknown) => Alert.alert(t('appName'), (e as Error).message === 'offline' ? t('offline') : (e as Error).message);

  const setStatus = async (st: Status) => {
    setStatusOpen(false);
    try { await api(`/orders/${id}/status`, { body: { status_id: st.id } }); await load(); } catch (e) { fail(e); }
  };
  const toggleDone = async (i: Item) => {
    setO((x) => x && { ...x, items: x.items.map((y) => (y.id === i.id ? { ...y, done: y.done ? 0 : 1 } : y)) });
    try { await api(`/orders/${id}/items/${i.id}`, { method: 'PUT', body: { done: i.done ? 0 : 1 } }); } catch (e) { fail(e); load(); }
  };
  const sendComment = async () => {
    const text = comment.trim();
    if (!text) return;
    setSending(true);
    try { await api(`/orders/${id}/followup`, { body: { text } }); setComment(''); await load(); } catch (e) { fail(e); } finally { setSending(false); }
  };
  const toggleMedia = async () => {
    if (!o) return;
    try { await api(`/orders/${id}/media`, { body: { done: !o.media_done } }); await load(); } catch (e) { fail(e); }
  };

  /** Фото: камера или системный выбор фото (без доступа ко всей галерее) → уменьшаем до 1920 px → в заказ */
  const addPhotos = async (source: 'camera' | 'library') => {
    try {
      let res: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) { Alert.alert(t('appName'), t('cameraDenied')); return; }
        res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, exif: false });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 20, quality: 0.9, exif: false });
      }
      if (res.canceled || !res.assets.length) return;
      setUploading(t('uploading'));
      const fd = new FormData();
      for (const [k, a] of res.assets.entries()) {
        const big = Math.max(a.width || 0, a.height || 0) > 1920;
        const r = await manipulateAsync(a.uri, big ? [a.width >= a.height ? { resize: { width: 1920 } } : { resize: { height: 1920 } }] : [], { compress: 0.82, format: SaveFormat.JPEG });
        fd.append('files', { uri: r.uri, name: `zdjecie-${Date.now()}-${k + 1}.jpg`, type: 'image/jpeg' } as any);
      }
      await api(`/orders/${id}/files`, { form: fd });
      await load();
    } catch (e) { fail(e); } finally { setUploading(null); }
  };

  if (err && !o) return <View style={{ flex: 1 }}><Header title="" left={<IconBtn name="chevron-back" label={t('back')} onPress={onBack} />} /><ErrorBox error={err} onRetry={load} /></View>;
  if (!o) return <View style={{ flex: 1 }}><Header title="" left={<IconBtn name="chevron-back" label={t('back')} onPress={onBack} />} /><Loading /></View>;

  const statuses = me.statuses.filter((s) => !s.scope || s.scope === 'all' || s.scope === o.kind);
  const phone = o.customer?.phone;
  const labor = o.items.filter((i) => i.kind === 'labor');
  const parts = o.items.filter((i) => i.kind === 'part');
  const images = o.files.filter((f) => /^image\//.test(f.mime));
  const otherFiles = o.files.filter((f) => !/^image\//.test(f.mime));
  const canEdit = can(me, 'orders.edit');
  const line = (i: Item) => (i.price == null ? null : Math.round(i.qty * i.price * (1 - (i.discount || 0) / 100) * 100) / 100);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title={o.number} left={<IconBtn name="chevron-back" label={t('back')} onPress={onBack} />}
        right={<IconBtn name="open-outline" label={t('openInCrm')} onPress={() => openCrm(`orders/${o.id}`)} />} />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl tintColor={colors.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Card>
          <View style={st.row}>
            <StatusBadge name={o.status_name ?? (o as any).status?.name} color={o.status_color ?? (o as any).status?.color} />
            {can(me, 'orders.status') && <Button small variant="outline" icon="swap-horizontal" title={t('changeStatus')} onPress={() => setStatusOpen(true)} />}
          </View>
          <Txt bold size={17} style={{ marginTop: 10 }}>{[carLine(o.car || {}), o.car?.plate].filter(Boolean).join(' · ') || '—'}</Txt>
          {!!o.car?.vin && <Txt muted size={13}>VIN {o.car.vin}</Txt>}
          {o.mileage != null && <Txt muted size={13}>{t('mileage')}: {o.mileage.toLocaleString('pl-PL')} km</Txt>}
          {o.appointments.filter((a) => a.start_at).map((a) => (
            <Txt key={a.id} size={13} style={{ marginTop: 4 }}>🗓 {a.start_at!.slice(0, 16)} · {a.station_name || ''}</Txt>
          ))}
        </Card>

        {o.customer && (
          <Section title={t('customer')}>
            <Card>
              <Txt bold>{o.customer.kind === 'company' && o.customer.company ? o.customer.company : o.customer.name}</Txt>
              {!!phone && <Txt muted>{phone}</Txt>}
              {!!phone && (
                <View style={[st.row, { marginTop: 10, justifyContent: 'flex-start' }]}>
                  <Button small icon="call" title={t('call')} onPress={() => openUrl('tel:' + phone)} />
                  <Button small variant="outline" icon="chatbubble-outline" title={t('sms')} onPress={() => openUrl('sms:' + phone)} />
                </View>
              )}
            </Card>
          </Section>
        )}

        {(!!o.complaint || !!o.mechanic_note) && (
          <Section title={t('complaint')}>
            <Card>
              {!!o.complaint && <Txt>{o.complaint}</Txt>}
              {!!o.mechanic_note && <Txt muted style={{ marginTop: o.complaint ? 8 : 0 }}>{t('mechanicNote')}: {o.mechanic_note}</Txt>}
            </Card>
          </Section>
        )}

        {!!labor.length && (
          <Section title={t('jobs')}>
            <Card style={{ paddingVertical: 4 }}>
              {labor.map((i, k) => (
                <Pressable key={i.id} onPress={() => toggleDone(i)} style={[st.item, k > 0 && st.itemSep]} accessibilityRole="checkbox" accessibilityState={{ checked: !!i.done }}>
                  <Ionicons name={i.done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={i.done ? colors.accent : colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Txt style={i.done ? { color: colors.muted, textDecorationLine: 'line-through' } : undefined}>{i.name}</Txt>
                    <Txt muted size={12}>{i.qty} {i.unit || ''}{i.mechanic_name ? ' · ' + i.mechanic_name : ''}</Txt>
                  </View>
                  {line(i) != null && <Txt size={13}>{money(line(i))}</Txt>}
                </Pressable>
              ))}
            </Card>
          </Section>
        )}
        {!!parts.length && (
          <Section title={t('parts')}>
            <Card style={{ paddingVertical: 4 }}>
              {parts.map((i, k) => (
                <View key={i.id} style={[st.item, k > 0 && st.itemSep]}>
                  <Ionicons name="cube-outline" size={20} color={colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Txt>{i.name}</Txt>
                    <Txt muted size={12}>{i.qty} {i.unit || ''}</Txt>
                  </View>
                  {line(i) != null && <Txt size={13}>{money(line(i))}</Txt>}
                </View>
              ))}
            </Card>
          </Section>
        )}
        {o.total != null && (
          <Card style={{ marginTop: 12 }}>
            <View style={st.row}><Txt bold>{t('total')}</Txt><Txt bold>{money(o.total)}</Txt></View>
            {o.paid != null && <View style={st.row}><Txt muted>{t('paid')}</Txt><Txt muted>{money(o.paid)}</Txt></View>}
          </Card>
        )}

        <Section title={t('photos')} right={<Txt muted size={12}>{o.files.length}</Txt>}>
          {canEdit && (
            <View style={[st.row, { marginBottom: 10 }]}>
              <Button icon="camera" title={t('takePhoto')} onPress={() => addPhotos('camera')} style={{ flex: 1 }} disabled={!!uploading} />
              <Button variant="outline" icon="images-outline" title={t('pickPhoto')} onPress={() => addPhotos('library')} style={{ flex: 1 }} disabled={!!uploading} />
            </View>
          )}
          {uploading && <View style={[st.row, { justifyContent: 'center', marginBottom: 10 }]}><ActivityIndicator color={colors.accent} /><Txt muted>{uploading}</Txt></View>}
          <View style={st.grid}>
            {images.map((f) => (
              <Pressable key={f.id} onPress={() => setView(f.id)} style={st.thumbWrap} accessibilityLabel={f.name}>
                <Image source={{ uri: fileUrl(f.id), headers: authHeader() }} style={st.thumb} />
              </Pressable>
            ))}
          </View>
          {otherFiles.map((f) => (
            <Pressable key={f.id} onPress={() => openCrm(`orders/${o.id}`)} style={[st.row, { justifyContent: 'flex-start', marginTop: 6 }]}>
              <Ionicons name={/pdf/.test(f.mime) ? 'document-text-outline' : 'videocam-outline'} size={18} color={colors.muted} />
              <Txt size={13} numberOfLines={1} style={{ flex: 1 }}>{f.name}</Txt>
            </Pressable>
          ))}
          <Pressable onPress={toggleMedia} style={[st.row, { justifyContent: 'flex-start', marginTop: 10 }]} accessibilityRole="checkbox" accessibilityState={{ checked: !!o.media_done }}>
            <Ionicons name={o.media_done ? 'checkbox' : 'square-outline'} size={22} color={o.media_done ? colors.accent : colors.muted} />
            <Txt>{t('intakeDone')}</Txt>
          </Pressable>
        </Section>

        <Section title={t('comments')}>
          <View style={st.commentBox}>
            <TextInput value={comment} onChangeText={setComment} placeholder={t('addComment')} placeholderTextColor={colors.muted} multiline style={st.commentInput} />
            <IconBtn name="send" label={t('send')} color={comment.trim() ? colors.accent : colors.muted} onPress={sendComment} />
          </View>
          {sending && <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} />}
          {o.comments.filter((c) => c.text).map((c) => (
            <Card key={c.id} style={{ marginTop: 8 }}>
              <Txt style={{ fontFamily: fonts.medium }}>{c.text}</Txt>
              <Txt muted size={12} style={{ marginTop: 4 }}>{[c.staff, (c.at || '').slice(0, 16)].filter(Boolean).join(' · ')}</Txt>
            </Card>
          ))}
        </Section>

        <Button variant="outline" icon="desktop-outline" title={t('openInCrm')} onPress={() => openCrm(`orders/${o.id}`)} style={{ marginTop: 22 }} />
      </ScrollView>

      <Modal visible={statusOpen} transparent animationType="slide" onRequestClose={() => setStatusOpen(false)}>
        <Pressable style={st.backdrop} onPress={() => setStatusOpen(false)} />
        <View style={[st.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <Txt bold size={17} style={{ marginBottom: 10 }}>{t('changeStatus')}</Txt>
          <ScrollView style={{ maxHeight: 420 }}>
            {statuses.map((s) => (
              <Pressable key={s.id} onPress={() => setStatus(s)} style={[st.statusRow, s.id === o.status_id && { borderColor: colors.accent }]}>
                <View style={[st.dot, { backgroundColor: s.color || colors.muted }]} />
                <Txt style={{ flex: 1 }}>{s.name}</Txt>
                {s.id === o.status_id && <Ionicons name="checkmark" size={20} color={colors.accent} />}
              </Pressable>
            ))}
          </ScrollView>
          <Button variant="ghost" title={t('cancel')} onPress={() => setStatusOpen(false)} />
        </View>
      </Modal>

      <Modal visible={view != null} transparent animationType="fade" onRequestClose={() => setView(null)}>
        <View style={st.viewer}>
          {view != null && <Image source={{ uri: fileUrl(view), headers: authHeader() }} style={{ flex: 1 }} resizeMode="contain" />}
          <View style={[st.viewerClose, { top: insets.top + 8 }]}><IconBtn name="close" label={t('close')} onPress={() => setView(null)} /></View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  itemSep: { borderTopWidth: 1, borderTopColor: colors.border },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumbWrap: { width: '32%', aspectRatio: 1, borderRadius: radius, overflow: 'hidden', backgroundColor: colors.surface2 },
  thumb: { width: '100%', height: '100%' },
  commentBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 },
  commentInput: { flex: 1, minHeight: 40, maxHeight: 140, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, borderTopWidth: 1, borderColor: colors.border },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerClose: { position: 'absolute', right: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
});
