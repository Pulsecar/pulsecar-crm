import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Body, Button, H1, open } from '../components/ui';
import { colors, fonts } from '../theme';
import { useT } from '../i18n';
import { useNav } from '../nav';
import { CONTACT, SERVICES } from '../data';
import { useAccount } from '../account';

export default function Booking() {
  const { t, p } = useT();
  const { bookingPreset } = useNav();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [service, setService] = useState<string | null>(null);
  const [car, setCar] = useState('');
  const [problem, setProblem] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(false);
  const [preferred, setPreferred] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const acc = useAccount();

  // для вошедших клиентов подставляем имя и телефон
  useEffect(() => {
    if (acc.me) {
      if (!name && acc.me.customer.name) setName(acc.me.customer.name);
      if (!phone && acc.me.customer.phone) setPhone(acc.me.customer.phone);
    }
  }, [acc.me]);

  useEffect(() => {
    if (bookingPreset.service) setService(bookingPreset.service);
    if (bookingPreset.note) setProblem(bookingPreset.note);
  }, [bookingPreset.key]);

  const label = (k: Parameters<typeof t>[0]) => t(k).replace(' *', '');
  const svc = SERVICES.find((x) => x.id === service);

  const buildMessage = () =>
    [
      t('bookMsgHead'),
      `${label('name')}: ${name}`,
      `${label('phone')}: ${phone}`,
      svc ? `${t('service')}: ${p(svc.name)}` : '',
      car ? `${t('car')}: ${car}` : '',
      problem ? `${t('problem')}: ${problem}` : '',
    ].filter(Boolean).join('\n');

  const valid = () => {
    const okForm = !!name.trim() && phone.replace(/\D/g, '').length >= 7 && consent;
    setError(!okForm);
    return okForm;
  };

  const submit = async () => {
    if (!valid()) return;
    setState('sending');
    try {
      await acc.sendBooking({ name, phone, service: svc ? svc.name[0] : '', car, problem, preferred });
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  const send = (via: 'wa' | 'sms' | 'mail') => {
    if (!valid()) return;
    const msg = encodeURIComponent(buildMessage());
    if (via === 'wa') open(`${CONTACT.whatsapp}?text=${msg}`);
    if (via === 'sms') open(`sms:${CONTACT.phoneRaw}${Platform.OS === 'ios' ? '&' : '?'}body=${msg}`);
    if (via === 'mail') open(`mailto:${CONTACT.email}?subject=${encodeURIComponent(t('bookMsgHead'))}&body=${msg}`);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <H1 style={{ fontSize: 26 }}>{t('bookTitle')}</H1>
        <Body muted style={{ marginTop: 6, marginBottom: 18 }}>{t('bookSub')}</Body>

        <Field label={t('name')} value={name} onChangeText={setName} autoComplete="name" />
        <Field label={t('phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="+48" />

        <Text style={st.label}>{t('service')}</Text>
        <View style={st.chips}>
          {SERVICES.map((sv) => {
            const on = service === sv.id;
            return (
              <Pressable key={sv.id} onPress={() => setService(on ? null : sv.id)} style={[st.chip, on && st.chipOn]}>
                <Text style={[st.chipText, on && { color: colors.onAccent }]}>{p(sv.name)}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field label={t('car')} value={car} onChangeText={setCar} placeholder="BMW 320d 2016" />
        <Field label={t('problem')} value={problem} onChangeText={setProblem} multiline />
        <Field label={t('preferred')} value={preferred} onChangeText={setPreferred} placeholder="np. wtorek rano" />

        <Pressable style={st.consent} onPress={() => setConsent(!consent)} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
          <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={22} color={consent ? colors.accent : colors.muted} />
          <Text style={st.consentText}>
            {t('consent')}{' '}
            <Text style={{ color: colors.accent }} onPress={() => open(CONTACT.privacy)}>{t('privacy')}</Text>
          </Text>
        </Pressable>

        {error && <Text style={st.error}>{t('required')}</Text>}

        {state === 'sent' ? (
          <View style={st.sent}>
            <Ionicons name="checkmark-circle" size={36} color={colors.accent} />
            <Text style={st.sentTitle}>{t('sentTitle')}</Text>
            <Body muted style={{ textAlign: 'center', fontSize: 14 }}>{t('sentText')}</Body>
            <Button small variant="outline" title={t('newRequest')} onPress={() => { setState('idle'); setProblem(''); setService(null); setPreferred(''); }} style={{ marginTop: 10 }} />
          </View>
        ) : (
          <Button title={t('sendRequest')} icon="calendar-outline" onPress={submit} style={{ marginTop: 18, opacity: state === 'sending' ? 0.6 : 1 }} />
        )}
        {state === 'failed' && <Text style={st.error}>{t('errNetwork')}</Text>}

        <Text style={[st.label, { marginTop: 18 }]}>{t('orWrite')}</Text>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="WhatsApp" icon="logo-whatsapp" variant="outline" onPress={() => send('wa')} style={{ flex: 1 }} />
            <Button title="SMS" icon="chatbubble-outline" variant="outline" onPress={() => send('sms')} style={{ flex: 1 }} />
          </View>
        </View>

        <Pressable onPress={() => open(`tel:${CONTACT.phoneRaw}`)} style={{ marginTop: 22 }}>
          <Body muted style={{ textAlign: 'center' }}>
            {t('faster')} <Text style={{ color: colors.accent, fontFamily: fonts.semibold }}>{CONTACT.phone}</Text>
          </Body>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, multiline, ...rest }: { label: string; multiline?: boolean } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[st.input, multiline && { minHeight: 96, textAlignVertical: 'top' }]}
        {...rest}
      />
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontFamily: fonts.medium, color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fonts.medium, color: colors.text, fontSize: 13 },
  consent: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 4 },
  consentText: { flex: 1, fontFamily: fonts.regular, color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { fontFamily: fonts.medium, color: colors.danger, fontSize: 13, marginTop: 10 },
  sent: { alignItems: 'center', gap: 6, marginTop: 18, padding: 18, borderRadius: 14, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentDim },
  sentTitle: { fontFamily: fonts.bold, color: colors.text, fontSize: 18 },
});
