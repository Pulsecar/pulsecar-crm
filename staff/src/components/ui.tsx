import React from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '../theme';
import { useT } from '../i18n';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export const openUrl = (url: string) => Linking.openURL(url).catch(() => {});

export function Txt({ children, style, muted, bold, size, numberOfLines }: { children: React.ReactNode; style?: TextStyle | TextStyle[]; muted?: boolean; bold?: boolean; size?: number; numberOfLines?: number }) {
  return (
    <Text numberOfLines={numberOfLines} style={[s.body, muted && { color: colors.muted }, bold && { fontFamily: fonts.semibold }, size ? { fontSize: size, lineHeight: Math.round(size * 1.4) } : null, style as TextStyle]}>
      {children}
    </Text>
  );
}
export const H1 = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => <Text style={[s.h1, style]}>{children}</Text>;
export const H2 = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => <Text style={[s.h2, style]}>{children}</Text>;

export function Button({ title, onPress, icon, variant = 'primary', style, small, disabled, busy }: {
  title: string; onPress: () => void; icon?: IconName; variant?: 'primary' | 'outline' | 'ghost' | 'danger'; style?: ViewStyle; small?: boolean; disabled?: boolean; busy?: boolean;
}) {
  const primary = variant === 'primary';
  const fg = primary ? colors.onAccent : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [s.btn, small && s.btnSmall, primary && { backgroundColor: colors.accent, borderColor: colors.accent },
        variant === 'ghost' && { borderColor: 'transparent' }, variant === 'danger' && { borderColor: colors.danger }, (pressed || disabled) && { opacity: 0.6 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[]; onPress?: () => void }) {
  if (onPress)
    return <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { borderColor: colors.accent }, style as ViewStyle]}>{children}</Pressable>;
  return <View style={[s.card, style as ViewStyle]}>{children}</View>;
}

/** Цветная метка статуса (цвет — из настроек статусов CRM) */
export function StatusBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return null;
  const c = color || colors.muted;
  return (
    <View style={[s.badge, { borderColor: c, backgroundColor: c + '26' }]}>
      <View style={[s.dot, { backgroundColor: c }]} />
      <Text style={s.badgeText} numberOfLines={1}>{name}</Text>
    </View>
  );
}

export function Field(props: TextInputProps & { icon?: IconName }) {
  const { icon, style, ...rest } = props;
  return (
    <View style={s.field}>
      {icon && <Ionicons name={icon} size={18} color={colors.muted} />}
      <TextInput placeholderTextColor={colors.muted} style={[s.input, style]} {...rest} />
    </View>
  );
}

export function Loading() {
  const t = useT();
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Txt muted style={{ marginTop: 10 }}>{t('loading')}</Txt>
    </View>
  );
}
export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <View style={s.center}>
      <Ionicons name="cloud-offline-outline" size={40} color={colors.muted} />
      <Txt muted style={{ marginVertical: 10, textAlign: 'center' }}>{error === 'offline' ? t('offline') : error}</Txt>
      {onRetry && <Button small variant="outline" icon="refresh" title={t('retry')} onPress={onRetry} />}
    </View>
  );
}
export function Empty({ text, icon = 'file-tray-outline' }: { text: string; icon?: IconName }) {
  return (
    <View style={[s.center, { paddingVertical: 48 }]}>
      <Ionicons name={icon} size={36} color={colors.muted} />
      <Txt muted style={{ marginTop: 8, textAlign: 'center' }}>{text}</Txt>
    </View>
  );
}

export function Header({ title, left, right }: { title: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      <View style={s.headerSide}>{left}</View>
      <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={[s.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}
export function IconBtn({ name, onPress, label, color = colors.text }: { name: IconName; onPress: () => void; label: string; color?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.6 }]}>
      <Ionicons name={name} size={22} color={color} />
    </Pressable>
  );
}

export function Logo({ height = 30 }: { height?: number }) {
  return <Image source={require('../../assets/logo-header.png')} style={{ height, width: height * (300 / 119) }} resizeMode="contain" accessibilityLabel="Pulsecar" />;
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export const money = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł');
export const carLine = (x: { make?: string | null; model?: string | null }) => [x.make, x.model].filter(Boolean).join(' ');

export const s = StyleSheet.create({
  h1: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 34, color: colors.text },
  h2: { fontFamily: fonts.semibold, fontSize: 19, lineHeight: 26, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.text },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, minHeight: 48 },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, minHeight: 38 },
  btnText: { fontFamily: fonts.semibold, fontSize: 15 },
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 9, alignSelf: 'flex-start', maxWidth: 220 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: 12, minHeight: 48 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text, paddingVertical: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 52, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
  headerSide: { width: 72, flexDirection: 'row', gap: 6 },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17, color: colors.text },
  iconBtn: { padding: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
});
